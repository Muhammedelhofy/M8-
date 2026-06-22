"use strict";

/**
 * lib/entity-graph.js — Build-85b: Entity Timeline (extends Build-83c)
 *
 * Build-83c: Extracts named entities from user messages, persists them in
 * m8_entities + m8_entity_mentions, and recalls them as a formatted block.
 *
 * Build-85b additions:
 * - summarizeEntityContext(): fire-and-forget Gemini call that writes a 1-sentence
 *   summary to m8_entity_mentions.summary after each mention is inserted.
 * - recallEntities(): now fetches last 3 session summaries per entity and formats
 *   them as a temporal arc in the recall output.
 * - getEntityCard(name): fetches full entity with all mention summaries for direct
 *   "tell me about X" / "who is X" queries.
 *
 * Fire-and-forget: extraction and summarization never block the main response.
 */

const { createClient } = require("@supabase/supabase-js");
const { generate }     = require("./llm");

// Build-110 (live-verify): the old direct GoogleGenAI call used gemini-2.0-flash-lite,
// which is part of the retired 2.0-flash family (404), so extraction silently
// returned [] and m8_entities never got a row. Route through llm.js on GROQ first
// (free, fast, non-thinking, separate quota from the main Gemini answer) like the
// reflector/chain — then cerebras, then a VALID non-thinking Gemini. Env-overridable.
const ENTITY_ORDER        = process.env.M8_ENTITY_ORDER || "groq,cerebras,gemini";
const ENTITY_MODEL        = process.env.M8_ENTITY_MODEL || "gemini-2.5-flash-lite";
const VALID_TYPES         = new Set(["person", "book", "problem", "place", "concept", "company"]);
const ENTITY_MIN_MSG_LEN  = 12;   // skip very short messages
const ENTITY_MAX_MENTIONS = 3;    // max mentions to store per session turn

// Session-2 "brain-surface": entity types that bridge to research-graph nodes.
// Kept to person/company (the kinds the graph extracts via B109 vocab) so the
// ENTITY <-> GRAPH bridge reinforces Boss's people/companies, not books/places.
const BRIDGE_TYPES        = new Set(["person", "company"]);

// ── Supabase ──────────────────────────────────────────────────────────────────
function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── Extraction prompt ─────────────────────────────────────────────────────────
const ENTITY_SYSTEM = `You are M8's entity extractor. Given a user message, identify named entities that are worth tracking across conversations.

Extract ONLY entities that are clearly named and specific. Output JSON array only, no other text:
[{"name":"<canonical name>","type":"person|book|problem|place|concept|company","attributes":{"key":"value"},"context":"<what was said about this entity in 1 sentence>"}]

Types:
- person: named individuals (drivers, people mentioned by name)
- book: titled books or texts
- problem: named unsolved problems or research topics
- company: named companies or organizations
- place: named locations
- concept: named theoretical or technical concepts

Rules:
- Skip pronouns, generic nouns, and unnamed references
- Normalize Arabic and English names consistently (use the clearest form)
- attributes: extract only facts explicitly stated (e.g. {"model":"S","earnings":"5000 SAR"})
- Max 4 entities per message
- If no named entities, return []`;

// ── Core functions ────────────────────────────────────────────────────────────

async function callExtractor(userMessage) {
  try {
    const raw = await generate({
      systemInstruction: ENTITY_SYSTEM,
      contents: [{ role: "user", parts: [{ text: String(userMessage).slice(0, 1500) }] }],
      providerOrder: ENTITY_ORDER,
      genConfig: { temperature: 0, maxOutputTokens: 400, geminiModel: ENTITY_MODEL },
    });
    const s = (raw == null ? "" : String(raw)).trim();
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a === -1 || b <= a) return [];
    const parsed = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

// Build-85b: fire-and-forget Gemini summarizer — updates m8_entity_mentions.summary
// after a mention row is inserted. Never blocks the main response path.
async function summarizeEntityContext(db, mentionId, entityName, context) {
  if (!context || !mentionId) return;
  try {
    const raw = await generate({
      systemInstruction: "Summarize in ONE short sentence what was said. No preamble.",
      contents: [{ role: "user", parts: [{ text: `What was said about "${entityName}" here: ${String(context).slice(0, 500)}` }] }],
      providerOrder: ENTITY_ORDER,
      genConfig: { temperature: 0, maxOutputTokens: 60, geminiModel: ENTITY_MODEL },
    });
    const summary = (raw == null ? "" : String(raw)).trim().slice(0, 200);
    if (summary) {
      await db.from("m8_entity_mentions").update({ summary }).eq("id", mentionId);
    }
  } catch (_) {}
}

/**
 * Upsert an entity row and log the mention.
 * Build-85b: captures the mention ID and fires summarizeEntityContext off-thread.
 */
async function upsertEntity(db, sessionId, { name, type, attributes, context }) {
  if (!name || !VALID_TYPES.has(type)) return;

  // Build-90: slug-based deduplication — resolve Arabic/transliteration variants
  // to their canonical existing entity before doing the ilike lookup.
  let canonicalName = name;
  let entitySlug = null;
  try {
    const { findCanonical, toSlug } = require("./entity-slug");
    entitySlug = toSlug(name);
    const { data: recent } = await db.from("m8_entities")
      .select("name").order("mention_count", { ascending: false }).limit(200);
    const existingNames = (recent || []).map(r => r.name);
    canonicalName = findCanonical(name, existingNames) || name;
  } catch (_) { /* fail-safe: use original name if slug lookup throws */ }

  // Merge attributes with existing ones (use canonicalName for lookup so slug-matched
  // variants hit the same row; keep .ilike("name", name) as the literal-match fallback)
  const lookupName = canonicalName !== name ? canonicalName : name;
  const { data: existing } = await db
    .from("m8_entities")
    .select("id, attributes, mention_count")
    .ilike("name", name)
    .eq("entity_type", type)
    .maybeSingle();

  // slug-matched to a different existing entity (different name, same slug)
  const { data: slugMatch } = canonicalName !== name ? await db
    .from("m8_entities")
    .select("id, attributes, mention_count")
    .ilike("name", lookupName)
    .eq("entity_type", type)
    .maybeSingle() : { data: null };

  const target = existing || slugMatch;

  if (target) {
    const merged = { ...target.attributes, ...(attributes || {}) };
    const patch = { attributes: merged, last_seen: new Date().toISOString(),
      mention_count: (target.mention_count || 1) + 1 };
    patch.slug = entitySlug || undefined;
    const updateEntityRow = patch;
    await db.from("m8_entities").update(updateEntityRow).eq("id", target.id);

    const { data: mention } = await db.from("m8_entity_mentions").insert({
      entity_id:  target.id,
      session_id: sessionId,
      context:    (context || "").slice(0, 300),
    }).select("id").single();

    if (mention?.id && context) {
      summarizeEntityContext(db, mention.id, name, context).catch(() => {});
    }
  } else {
    const row = { name, entity_type: type, attributes: attributes || {},
      summary: (context || "").slice(0, 300) };
    row.slug = entitySlug || undefined;
    const insertEntityRow = row;
    const { data: inserted } = await db.from("m8_entities")
      .insert(insertEntityRow).select("id").single();

    if (inserted?.id) {
      const { data: mention } = await db.from("m8_entity_mentions").insert({
        entity_id:  inserted.id,
        session_id: sessionId,
        context:    (context || "").slice(0, 300),
      }).select("id").single();

      if (mention?.id && context) {
        summarizeEntityContext(db, mention.id, name, context).catch(() => {});
      }
    }
  }
}

/**
 * Extract entities from a user message and persist them.
 * Fire-and-forget — never throws.
 */
async function _maybeExtractEntities(sessionId, userMessage) {
  if (!userMessage || userMessage.length < ENTITY_MIN_MSG_LEN) return;
  const db = getDb();
  if (!db) return;

  try {
    const entities = await callExtractor(userMessage);
    const top = entities.slice(0, ENTITY_MAX_MENTIONS);
    for (const e of top) {
      await upsertEntity(db, sessionId, e).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Session-2 "brain-surface": shared entity matcher behind BOTH recallEntities
 * and bridgeEntitiesToGraph. Returns the array of matched entity rows (id, name,
 * entity_type, summary, attributes, mention_count, last_seen), or [] on any miss.
 * recallEntities' formatted output is UNCHANGED — it still formats exactly these
 * hits. Never throws.
 */
async function _matchEntities(currentMessage, limit = 5) {
  if (!currentMessage || currentMessage.length < 3) return [];
  const db = getDb();
  if (!db) return [];

  try {
    // Build-85f fix: filter by name substring IN the query (not after limit=50)
    // so entities ranked >50 by mention_count are never silently missed.
    const msgLower = currentMessage.toLowerCase();
    const words = [...new Set(msgLower.split(/\s+/).filter(w => w.length > 3))].slice(0, 8);
    if (words.length === 0) return [];

    let query = db
      .from("m8_entities")
      .select("id, name, entity_type, summary, attributes, mention_count, last_seen");

    // OR-filter: match any word from the message against entity name
    const orFilter = words.map(w => `name.ilike.%${w}%`).join(",");
    query = query.or(orFilter);

    const { data: candidates } = await query
      .order("mention_count", { ascending: false })
      .limit(50);

    if (!candidates || candidates.length === 0) return [];

    return candidates.filter(e =>
      msgLower.includes(e.name.toLowerCase()) ||
      (e.name.length > 3 && e.name.split(/\s+/).some(w => w.length > 3 && msgLower.includes(w.toLowerCase())))
    ).slice(0, limit);
  } catch (_) { return []; }
}

/**
 * Recall entities relevant to the current message.
 * Build-85b: includes last 3 session summaries as a temporal arc per entity.
 */
async function recallEntities(currentMessage, limit = 5) {
  const db = getDb();
  if (!db) return null;

  try {
    const hits = await _matchEntities(currentMessage, limit);
    if (hits.length === 0) return null;

    // Build-85b: fetch last 3 arc summaries per hit entity in a single batch query
    const hitIds = hits.map(e => e.id).filter(Boolean);
    const arcMap = {};
    if (hitIds.length > 0) {
      try {
        const { data: mentions } = await db
          .from("m8_entity_mentions")
          .select("entity_id, session_id, summary, created_at")
          .in("entity_id", hitIds)
          .not("summary", "is", null)
          .order("created_at", { ascending: false })
          .limit(hitIds.length * 3);

        if (mentions) {
          for (const m of mentions) {
            if (!arcMap[m.entity_id]) arcMap[m.entity_id] = [];
            if (arcMap[m.entity_id].length < 3) {
              arcMap[m.entity_id].push(`${m.session_id} "${m.summary}"`);
            }
          }
        }
      } catch (_) {}
    }

    return hits.map(e => {
      const attrs = Object.entries(e.attributes || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      const attrStr = attrs ? ` (${attrs})` : "";
      const arc = arcMap[e.id];
      const arcStr = arc && arc.length > 0 ? ` Arc: ${arc.join(" · ")}` : "";
      return `[${e.entity_type}] ${e.name}${attrStr} — ${e.summary || "tracked entity"} · seen ${e.mention_count}×${arcStr}`;
    }).join("\n");
  } catch (_) { return null; }
}

/**
 * Build-85b: fetch the full entity card for a named entity.
 * Includes all mention summaries as a temporal arc, newest first.
 * Falls back to the basic recall output if no summaries exist yet.
 */
async function getEntityCard(name) {
  if (!name || name.length < 2) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const { data: entity } = await db
      .from("m8_entities")
      .select("id, name, entity_type, summary, attributes, mention_count, first_seen, last_seen")
      .ilike("name", name.trim())
      .maybeSingle();

    if (!entity) return null;

    const { data: mentions } = await db
      .from("m8_entity_mentions")
      .select("session_id, summary, created_at")
      .eq("entity_id", entity.id)
      .not("summary", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);

    const attrs = Object.entries(entity.attributes || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const attrStr = attrs ? ` (${attrs})` : "";

    const firstSeen = entity.first_seen ? entity.first_seen.slice(0, 10) : "unknown";
    const lastSeen  = entity.last_seen  ? entity.last_seen.slice(0, 10)  : "unknown";

    let card = `[${entity.entity_type}] ${entity.name}${attrStr}\n`;
    card += `  First seen: ${firstSeen} · Last seen: ${lastSeen} · Mentioned: ${entity.mention_count}×\n`;

    if (entity.summary) {
      card += `  Summary: ${entity.summary}\n`;
    }

    if (mentions && mentions.length > 0) {
      card += `  Session arc (newest first):\n`;
      for (const m of mentions) {
        const date = m.created_at ? m.created_at.slice(0, 10) : "?";
        card += `  • ${m.session_id} (${date}): "${m.summary}"\n`;
      }
    } else {
      // Fallback: basic recall output when no summaries exist yet
      const basic = await recallEntities(name, 1);
      if (basic) return basic;
    }

    return card.trim();
  } catch (_) { return null; }
}

/**
 * Session-2 "brain-surface": ENTITY <-> GRAPH bridge for chat recall.
 *
 * For each tracked person/company mentioned in the turn, surface its 1-hop
 * connections in the research memory graph (m8_graph_nodes) so M8 can reason
 * over how Boss's people/companies relate — reinforcing the flat entity card
 * with the graph's relational structure.
 *
 * Default: READ-ONLY (only entities that already exist as graph nodes — e.g.
 * seeded by the nightly B109 extraction — surface links). When the opt-in env
 * M8_ENTITY_GRAPH_BRIDGE_WRITE=1 is set, an entity with no graph node yet is
 * seeded into the graph (awaited) so the two stores converge over time.
 *
 * Returns a compact block string (one line per bridged entity) or null.
 * Kill switch: ENTITY_GRAPH_BRIDGE_DISABLED=1. Never throws.
 */
async function bridgeEntitiesToGraph(currentMessage, limit = 5) {
  if (process.env.ENTITY_GRAPH_BRIDGE_DISABLED === "1") return null;
  try {
    const hits = await _matchEntities(currentMessage, limit);
    if (!hits.length) return null;

    const bridgeable = hits.filter(e => BRIDGE_TYPES.has(e.entity_type)).slice(0, 3);
    if (!bridgeable.length) return null;

    // Lazy require — memory-graph.js does NOT require this module, so there is no
    // load-time cycle, but lazy keeps parity with the orchestrator's pattern and
    // avoids pulling the graph layer in for callers that never bridge.
    const { graphRelationsForEntity, bridgeEntityNode } = require("./memory-graph");

    const lines = [];
    for (const e of bridgeable) {
      let rel = null;
      try { rel = await graphRelationsForEntity(e.name, e.entity_type); } catch (_) {}
      if (rel && rel.line) {
        lines.push(`[${e.entity_type}] ${e.name}: ${rel.line}`);
      } else if (!rel) {
        // Not a graph node yet — optionally seed one so the stores converge
        // (no-op unless M8_ENTITY_GRAPH_BRIDGE_WRITE=1). Awaited so it lands.
        try { await bridgeEntityNode(e.name, e.entity_type, e.summary); } catch (_) {}
      }
    }
    return lines.length ? lines.join("\n") : null;
  } catch (_) { return null; }
}

module.exports = {
  _maybeExtractEntities,
  recallEntities,
  getEntityCard,        // Build-85b
  _matchEntities,       // Session-2 (shared matcher; exported for tests/reuse)
  bridgeEntitiesToGraph, // Session-2 entity <-> graph bridge
};
