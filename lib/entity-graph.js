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
const { GoogleGenAI }  = require("@google/genai");

const ENTITY_MODEL        = "gemini-2.0-flash-lite";
const VALID_TYPES         = new Set(["person", "book", "problem", "place", "concept", "company"]);
const ENTITY_MIN_MSG_LEN  = 12;   // skip very short messages
const ENTITY_MAX_MENTIONS = 3;    // max mentions to store per session turn

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
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
  if (!apiKey) return [];
  try {
    const ai  = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: ENTITY_MODEL,
      contents: [{ role: "user", parts: [{ text: userMessage.slice(0, 1500) }] }],
      config:   { systemInstruction: ENTITY_SYSTEM, temperature: 0, maxOutputTokens: 400 },
    });
    const raw = (res?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const a = raw.indexOf("["), b = raw.lastIndexOf("]");
    if (a === -1 || b <= a) return [];
    const parsed = JSON.parse(raw.slice(a, b + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

// Build-85b: fire-and-forget Gemini summarizer — updates m8_entity_mentions.summary
// after a mention row is inserted. Never blocks the main response path.
async function summarizeEntityContext(db, mentionId, entityName, context) {
  if (!context || !mentionId) return;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
  if (!apiKey) return;
  try {
    const ai  = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model:    ENTITY_MODEL,
      contents: [{ role: "user", parts: [{ text: `Summarize in 1 sentence what was said about "${entityName}" in this context: ${context.slice(0, 500)}` }] }],
      config:   { temperature: 0, maxOutputTokens: 60 },
    });
    const summary = (res?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().slice(0, 200);
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

  // Merge attributes with existing ones
  const { data: existing } = await db
    .from("m8_entities")
    .select("id, attributes, mention_count")
    .ilike("name", name)
    .eq("entity_type", type)
    .maybeSingle();

  if (existing) {
    const merged = { ...existing.attributes, ...(attributes || {}) };
    await db.from("m8_entities").update({
      attributes:    merged,
      last_seen:     new Date().toISOString(),
      mention_count: (existing.mention_count || 1) + 1,
    }).eq("id", existing.id);

    const { data: mention } = await db.from("m8_entity_mentions").insert({
      entity_id:  existing.id,
      session_id: sessionId,
      context:    (context || "").slice(0, 300),
    }).select("id").single();

    // Build-85b: fire-and-forget summary
    if (mention?.id && context) {
      summarizeEntityContext(db, mention.id, name, context).catch(() => {});
    }
  } else {
    const { data: inserted } = await db.from("m8_entities").insert({
      name,
      entity_type: type,
      attributes:  attributes || {},
      summary:     (context || "").slice(0, 300),
    }).select("id").single();

    if (inserted?.id) {
      const { data: mention } = await db.from("m8_entity_mentions").insert({
        entity_id:  inserted.id,
        session_id: sessionId,
        context:    (context || "").slice(0, 300),
      }).select("id").single();

      // Build-85b: fire-and-forget summary
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
 * Recall entities relevant to the current message.
 * Build-85b: includes last 3 session summaries as a temporal arc per entity.
 */
async function recallEntities(currentMessage, limit = 5) {
  if (!currentMessage || currentMessage.length < 3) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const { data: candidates } = await db
      .from("m8_entities")
      .select("id, name, entity_type, summary, attributes, mention_count, last_seen")
      .order("mention_count", { ascending: false })
      .limit(50);

    if (!candidates || candidates.length === 0) return null;

    const msgLower = currentMessage.toLowerCase();
    const hits = candidates.filter(e =>
      msgLower.includes(e.name.toLowerCase()) ||
      (e.name.length > 3 && e.name.split(/\s+/).some(w => w.length > 3 && msgLower.includes(w.toLowerCase())))
    ).slice(0, limit);

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

module.exports = {
  _maybeExtractEntities,
  recallEntities,
  getEntityCard,   // Build-85b
};
