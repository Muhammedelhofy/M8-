/**
 * M8 Memory — api/memory.js
 *
 * Progressive enhancement architecture:
 *   Phase 1 (NOW)    → Keyword-filtered recall from raw conversation history
 *   Phase 2 (NEXT)   → Rolling LLM summaries replace raw message injection
 *   Phase 3 (FUTURE) → Vector embedding semantic search
 *
 * Only Phase 1 is active. Phase 2 & 3 are stubbed with clear TODO markers.
 */
const { createClient } = require("@supabase/supabase-js");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ─────────────────────────────────────────────────────────────────
// KEYWORD ENGINE (Phase 1)
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
  return text
    .toLowerCase()
    .replace(/[^\w\s؀-ۿ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function relevanceScore(content, keywords) {
  const lower = content.toLowerCase();
  return keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE: recallMemory (Phase 1 — keyword-filtered)
// ─────────────────────────────────────────────────────────────────

/**
 * Retrieve relevant memories from past sessions.
 * Fetches recent rows, scores by keyword overlap with current message,
 * returns top matches in chronological order for prompt injection.
 * Non-fatal — always returns [] on any error.
 *
 * @param {string} currentSessionId  Exclude current session from recall.
 * @param {string} currentMessage    Used to extract keywords for relevance scoring.
 * @param {number} limit             Max memories to return (default 6).
 */
async function recallMemory(currentSessionId, currentMessage = "", limit = 6) {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("m8_conversations")
      .select("id, role, content, session_id, importance")  // id needed for chronological re-sort
      .neq("session_id", currentSessionId)
      .order("id", { ascending: false })
      .limit(80); // cast wide net, then score down

    if (error || !data || data.length === 0) return [];

    const keywords = extractKeywords(currentMessage);

    if (keywords.length === 0) {
      // No keywords → return most-recent N rows in chronological order
      return data.slice(0, limit).reverse();
    }

    // Score and rank by relevance + importance
    const scored = data
      .map((row) => ({
        ...row,
        _score: relevanceScore(row.content, keywords) + (row.importance || 1) - 1,
      }))
      .filter((row) => row._score > 0)
      .sort((a, b) => b._score - a._score);

    const top = scored.length > 0 ? scored.slice(0, limit) : data.slice(0, limit);

    // Re-sort by id ASC to restore true chronological order for prompt injection.
    // .reverse() would only be correct if the array were still in DESC order —
    // it is NOT after a relevance sort, so we sort explicitly instead.
    return top.sort((a, b) => a.id - b.id);
  } catch (err) {
    console.error("Memory recall error (non-fatal):", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE: saveMemory
// ─────────────────────────────────────────────────────────────────

/**
 * Persist a user/assistant exchange.
 * topic, summary, importance columns will be populated by
 * the rolling summary engine in Phase 2.
 */
async function saveMemory(sessionId, userMessage, assistantResponse) {
  try {
    const supabase = getClient();
    await supabase.from("m8_conversations").insert([
      { session_id: sessionId, role: "user",      content: userMessage },
      { session_id: sessionId, role: "assistant", content: assistantResponse },
    ]);
  } catch (err) {
    console.error("Memory save error (non-fatal):", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// PHASE 2 STUBS — Rolling Summary Engine
// Architected now. Activated in Milestone 2.
// ─────────────────────────────────────────────────────────────────

/**
 * [STUB — Phase 2]
 * Generate a 3-sentence LLM summary of a completed session.
 * Stores result as role='summary', importance=2 for priority recall.
 * Replaces raw message injection with compressed, high-signal context.
 *
 * Activation: call at session end / on a cron after inactivity.
 */
async function summarizeSession(sessionId) {
  // TODO Phase 2:
  // 1. SELECT all rows WHERE session_id = sessionId ORDER BY id ASC
  // 2. Build compression prompt: "Summarize this conversation in 3 sentences..."
  // 3. Call llm.generate({ systemInstruction, contents })
  // 4. INSERT { session_id, role: 'summary', content: summary, importance: 2 }
  console.log(`[STUB] summarizeSession(${sessionId}) — Phase 2`);
}

/**
 * [STUB — Phase 2]
 * Retrieve pre-computed session summaries instead of raw messages.
 * Phase 2 drop-in replacement for recallMemory() in orchestrator.js.
 * One line change in orchestrator to activate.
 */
async function recallSummaries(currentSessionId, limit = 5) {
  // TODO Phase 2:
  // SELECT content, importance FROM m8_conversations
  // WHERE role = 'summary' AND session_id != currentSessionId
  // ORDER BY id DESC LIMIT limit
  return [];
}

/**
 * [STUB — Phase 3]
 * Semantic search via vector embeddings.
 * Requires: pgvector extension on Supabase + embedding column on m8_conversations.
 */
async function semanticRecall(currentSessionId, queryEmbedding, limit = 6) {
  // TODO Phase 3:
  // SELECT content, 1 - (embedding <=> queryEmbedding) AS similarity
  // FROM m8_conversations
  // WHERE session_id != currentSessionId
  // ORDER BY similarity DESC LIMIT limit
  return [];
}

module.exports = {
  recallMemory,
  saveMemory,
  summarizeSession,
  recallSummaries,
  semanticRecall,
};
