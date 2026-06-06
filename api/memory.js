/**
 * M8 Memory — api/memory.js
 *
 * Architecture (Milestone 2b):
 *   - Raw turns           → append-only user/assistant rows (audit trail)
 *   - Session summaries   → rolling, structured, one CURRENT per session
 *   - Canonical facts     → one CURRENT row per memory_key; updates supersede
 *   - Recall              → always inject current canonical facts +
 *                           keyword-scored recent summaries/raw rows
 *
 * Supersession model (per GPT review): facts mutate over time. We never
 * overwrite and never let stale facts surface. A changed fact marks the old
 * row is_current=false (kept for history) and inserts a new current row.
 *
 * Phase 3 (FUTURE): semanticRecall() via pgvector — stub retained below.
 */
const { createClient } = require("@supabase/supabase-js");
const { generate }     = require("./llm");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// How many NEW raw rows must accumulate before we (re)summarize a session.
const SUMMARY_ROW_THRESHOLD = parseInt(process.env.SUMMARY_ROW_THRESHOLD || "10", 10);

// Summaries are background work — prefer FREE non-Gemini providers so the
// scarce Gemini daily quota stays available for live user turns.
const SUMMARY_PROVIDER_ORDER = process.env.SUMMARY_PROVIDER_ORDER || "groq,cerebras,openrouter,gemini";

// ─────────────────────────────────────────────────────────────────
// KEYWORD ENGINE
// ─────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  // English
  "the","a","an","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","shall","should","may","might",
  "must","can","could","i","you","he","she","it","we","they","what","which",
  "who","how","when","where","why","this","that","these","those","and","or",
  "but","in","on","at","to","for","of","with","by","from","about","just",
  "get","got","tell","me","my","your",
  // Arabic common
  "ال","في","من","على","إلى","هل","ما","هذا","هذه","كيف","لا","نعم",
  "عن","مع","هو","هي","أنا","أنت","كان","كانت","يكون","تكون",
]);

function extractKeywords(text) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^\w\s؀-ۿ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  // Light singular/plural folding so "drivers" matches "driver".
  const expanded = new Set();
  for (const w of words) {
    expanded.add(w);
    if (w.endsWith("ies") && w.length > 4) expanded.add(w.slice(0, -3) + "y");
    else if (w.endsWith("es") && w.length > 4) expanded.add(w.slice(0, -2));
    else if (w.endsWith("s")  && w.length > 3) expanded.add(w.slice(0, -1));
  }
  return [...expanded];
}

function relevanceScore(content, keywords) {
  const lower = (content || "").toLowerCase();
  return keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE: recallMemory — current facts (always) + scored summaries/raw
// ─────────────────────────────────────────────────────────────────

/**
 * Retrieve relevant memories from PAST sessions.
 *
 * Two tiers (fixes the old "newest-80-rows-then-score" cap that hid old
 * but important facts):
 *   Tier 1 — all CURRENT canonical facts (profile/operational). Always
 *            included, never keyword-filtered. These are M8's living profile.
 *   Tier 2 — recent session summaries + raw turns, scored by keyword overlap
 *            and importance; recent rows win ties.
 *
 * Stale rows (is_current=false) are excluded by default.
 * Non-fatal — returns [] on any error.
 */
async function recallMemory(currentSessionId, currentMessage = "", limit = 6) {
  try {
    const supabase = getClient();

    // Tier 1 — current canonical facts (uncapped by recency).
    const factsRes = await supabase
      .from("m8_conversations")
      .select("id, role, content, importance, memory_type")
      .neq("session_id", currentSessionId)
      .eq("is_current", true)
      .in("memory_type", ["profile", "operational"])
      .order("id", { ascending: false })
      .limit(20);
    const facts = factsRes.data || [];

    // Tier 2 — recent pool (summaries + raw), excluding the canonical facts.
    const poolRes = await supabase
      .from("m8_conversations")
      .select("id, role, content, importance, memory_type")
      .neq("session_id", currentSessionId)
      .eq("is_current", true)
      .order("id", { ascending: false })
      .limit(120);
    const pool = (poolRes.data || []).filter(
      (r) => r.memory_type !== "profile" && r.memory_type !== "operational"
    );

    const keywords = extractKeywords(currentMessage);

    let scoredPool;
    if (keywords.length === 0) {
      scoredPool = pool.slice(0, limit);
    } else {
      scoredPool = pool
        .map((row) => {
          const typeWeight = row.role === "summary" ? 0.8 : 1.0;
          const imp = (row.importance || 1) - 1;
          return { ...row, _score: relevanceScore(row.content, keywords) * typeWeight + imp * 2 };
        })
        .filter((row) => row._score > 0)
        .sort((a, b) => (b._score - a._score) || (b.id - a.id)) // recency breaks ties
        .slice(0, limit);
    }

    // Merge facts + scored pool, dedupe by id, return in chronological order.
    const byId = new Map();
    for (const r of [...facts, ...scoredPool]) byId.set(r.id, r);
    return [...byId.values()].sort((a, b) => a.id - b.id);
  } catch (err) {
    console.error("Memory recall error (non-fatal):", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE: saveMemory — append raw turns (audit trail)
// ─────────────────────────────────────────────────────────────────
async function saveMemory(sessionId, userMessage, assistantResponse) {
  try {
    const supabase = getClient();
    await supabase.from("m8_conversations").insert([
      { session_id: sessionId, role: "user",      content: userMessage,       memory_type: "session" },
      { session_id: sessionId, role: "assistant", content: assistantResponse, memory_type: "session" },
    ]);
  } catch (err) {
    console.error("Memory save error (non-fatal):", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// ROLLING STRUCTURED SUMMARIES (Milestone 2b — ACTIVE)
// ─────────────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You compress a conversation into a compact JSON memory record for a personal AI agent. Output ONLY valid JSON — no prose, no markdown, no code fences.

Schema:
{
  "summary": "2-3 sentence recap of what was discussed and decided",
  "topic": "short_snake_case_topic",
  "importance": 1,
  "entities": ["proper nouns: names, places, companies"],
  "facts": [
    { "key": "snake_case_stable_key", "statement": "one sentence stating the CURRENT fact", "memory_type": "operational", "importance": 5 }
  ]
}

Rules:
- "facts" = ONLY durable, current truths worth long-term memory (e.g. fleet_size, a supplier rate, an active/signed contract, a stated preference, identity details). Reuse a stable snake_case key so a later update to the same fact reuses the same key.
- Do NOT put transient chit-chat, questions, or one-off lookups in "facts". If none, use "facts": [].
- memory_type: "profile" = identity (name, role, city, nationality); "operational" = current business state (fleet size, rates, contracts, projects).
- Preserve exact numbers, names, dates and amounts inside statements.
- "importance": session summary 1-3; facts 4-5.
- Keep the summary concise and in the conversation's main language.`;

function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = s.indexOf("{");
  const last  = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
}

/**
 * Insert/refresh a canonical fact with supersession.
 * If the same memory_key already has a current row:
 *   - identical statement → no-op (avoid duplicates)
 *   - changed statement   → mark old is_current=false (kept for history),
 *                           insert new current row.
 */
async function upsertFact(supabase, sessionId, fact) {
  const key       = (fact?.key || "").trim();
  const statement = (fact?.statement || fact?.value || "").trim();
  if (!key || !statement) return;
  const memoryType = fact.memory_type === "profile" ? "profile" : "operational";
  const importance = Math.min(5, Math.max(1, parseInt(fact.importance, 10) || 5));

  const existing = await supabase
    .from("m8_conversations")
    .select("id, content")
    .eq("memory_key", key)
    .eq("is_current", true)
    .limit(1);
  const cur = existing.data?.[0];

  if (cur) {
    if (cur.content === statement) return; // unchanged
    await supabase
      .from("m8_conversations")
      .update({ is_current: false, superseded_at: new Date().toISOString() })
      .eq("id", cur.id);
  }

  await supabase.from("m8_conversations").insert([{
    session_id:  sessionId,
    role:        "summary",
    content:     statement,
    memory_type: memoryType,
    memory_key:  key,
    importance,
    is_current:  true,
    metadata:    { from_session: sessionId },
  }]);
}

/**
 * Summarize a session into one structured, current summary row (+ canonical
 * facts). Self-gating:
 *   - skips if fewer than SUMMARY_ROW_THRESHOLD new raw rows since last summary
 *   - skips if nothing new since last summary (content unchanged)
 * Runs on free providers (SUMMARY_PROVIDER_ORDER) to spare Gemini quota.
 * Non-fatal — never throws to the caller.
 */
async function summarizeSession(sessionId) {
  try {
    const supabase = getClient();

    // Raw turns for this session, oldest first.
    const rawRes = await supabase
      .from("m8_conversations")
      .select("id, role, content")
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("id", { ascending: true });
    const raw = rawRes.data || [];
    if (raw.length === 0) return { status: "empty" };
    const maxRawId = raw[raw.length - 1].id;

    // Last summary marker for this session.
    const markRes = await supabase
      .from("m8_conversations")
      .select("id, metadata")
      .eq("session_id", sessionId)
      .eq("role", "summary")
      .eq("memory_type", "session")
      .eq("is_current", true)
      .order("id", { ascending: false })
      .limit(1);
    const lastSummary = markRes.data?.[0];
    const lastRowId   = lastSummary?.metadata?.last_row_id || 0;

    const newRows = raw.filter((r) => r.id > lastRowId).length;
    if (newRows < SUMMARY_ROW_THRESHOLD) return { status: "below_threshold", newRows };

    // Build transcript and compress.
    const transcript = raw
      .map((r) => `${r.role === "assistant" ? "M8" : "Muhammad"}: ${r.content}`)
      .join("\n");

    const out = await generate({
      systemInstruction: SUMMARY_SYSTEM,
      contents: [{ role: "user", parts: [{ text: transcript }] }],
      providerOrder: SUMMARY_PROVIDER_ORDER,
      genConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    });
    const parsed = parseJsonLoose(out);
    if (!parsed || !parsed.summary) {
      console.error("[M8] summarize: unparseable summary output");
      return { status: "parse_failed" };
    }

    const importance = Math.min(3, Math.max(1, parseInt(parsed.importance, 10) || 2));
    const metadata = {
      entities:      Array.isArray(parsed.entities) ? parsed.entities.slice(0, 30) : [],
      facts:         Array.isArray(parsed.facts) ? parsed.facts : [],
      session_start: raw[0].id,
      session_end:   maxRawId,
      last_row_id:   maxRawId,
    };

    // One current session summary per session: supersede the prior one.
    if (lastSummary) {
      await supabase
        .from("m8_conversations")
        .update({ is_current: false, superseded_at: new Date().toISOString() })
        .eq("id", lastSummary.id);
    }

    await supabase.from("m8_conversations").insert([{
      session_id:  sessionId,
      role:        "summary",
      content:     String(parsed.summary).slice(0, 2000),
      memory_type: "session",
      topic:       (parsed.topic || "").toString().slice(0, 80) || null,
      importance,
      is_current:  true,
      metadata,
    }]);

    // Canonical facts (supersede by key).
    if (Array.isArray(parsed.facts)) {
      for (const fact of parsed.facts.slice(0, 12)) {
        await upsertFact(supabase, sessionId, fact);
      }
    }

    console.log(`[M8] summarized session ${sessionId}: ${newRows} new rows, ${metadata.facts.length} facts`);
    return { status: "summarized", newRows, facts: metadata.facts.length };
  } catch (err) {
    console.error("[M8] summarizeSession error (non-fatal):", err.message);
    return { status: "error", error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// PHASE 3 STUB — semantic recall (pgvector, Milestone 4)
// ─────────────────────────────────────────────────────────────────
async function semanticRecall(currentSessionId, queryEmbedding, limit = 6) {
  // TODO Milestone 4: SELECT … 1 - (embedding <=> queryEmbedding) AS similarity
  return [];
}

module.exports = {
  recallMemory,
  saveMemory,
  summarizeSession,
  semanticRecall,
};
