"use strict";

/**
 * lib/entity-graph.js — Build-83c: cross-session entity memory
 *
 * Extracts named entities (people, books, problems, companies, places, concepts)
 * from user messages and persists them in m8_entities + m8_entity_mentions.
 * On recall, fetches entities whose names appear in the current message and
 * returns them as a formatted context block for the system prompt.
 *
 * Fire-and-forget: extraction never blocks the main response.
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

/**
 * Upsert an entity row and log the mention.
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

    await db.from("m8_entity_mentions").insert({
      entity_id:  existing.id,
      session_id: sessionId,
      context:    (context || "").slice(0, 300),
    });
  } else {
    const { data: inserted } = await db.from("m8_entities").insert({
      name,
      entity_type: type,
      attributes:  attributes || {},
      summary:     (context || "").slice(0, 300),
    }).select("id").single();

    if (inserted?.id) {
      await db.from("m8_entity_mentions").insert({
        entity_id:  inserted.id,
        session_id: sessionId,
        context:    (context || "").slice(0, 300),
      });
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
 * Searches for entity names that appear as substrings in the message.
 * Returns a formatted string or null.
 */
async function recallEntities(currentMessage, limit = 5) {
  if (!currentMessage || currentMessage.length < 3) return null;
  const db = getDb();
  if (!db) return null;

  try {
    // Fetch the most-mentioned entities (the ones M8 knows best)
    const { data: candidates } = await db
      .from("m8_entities")
      .select("name, entity_type, summary, attributes, mention_count, last_seen")
      .order("mention_count", { ascending: false })
      .limit(50);

    if (!candidates || candidates.length === 0) return null;

    const msgLower = currentMessage.toLowerCase();
    const hits = candidates.filter(e =>
      msgLower.includes(e.name.toLowerCase()) ||
      (e.name.length > 3 && e.name.split(/\s+/).some(w => w.length > 3 && msgLower.includes(w.toLowerCase())))
    ).slice(0, limit);

    if (hits.length === 0) return null;

    return hits.map(e => {
      const attrs = Object.entries(e.attributes || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      const attrStr = attrs ? ` (${attrs})` : "";
      return `[${e.entity_type}] ${e.name}${attrStr} — ${e.summary || "tracked entity"} · seen ${e.mention_count}×`;
    }).join("\n");
  } catch (_) { return null; }
}

module.exports = {
  _maybeExtractEntities,
  recallEntities,
};
