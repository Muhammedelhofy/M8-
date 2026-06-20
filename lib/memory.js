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
const { createClient }  = require("@supabase/supabase-js");
const { generate }      = require("./llm");
const { GoogleGenAI }   = require("@google/genai");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ─────────────────────────────────────────────────────────────────
// BUILD-81: EMBEDDING GENERATION (Gemini text-embedding-004, 768d)
// Used at write time (upsertFact, summarizeSession) and at recall
// time (recallMemory Tier 2 semantic search).
// Falls back gracefully — returns null on any failure so keyword
// scoring takes over and nothing breaks.
// ─────────────────────────────────────────────────────────────────
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMS  = 768;

async function generateEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
  if (!apiKey || !text || text.length < 3) return null;
  try {
    const ai  = new GoogleGenAI({ apiKey });
    const res = await ai.models.embedContent({
      model:   EMBEDDING_MODEL,
      content: { parts: [{ text: String(text).slice(0, 2000) }] },
    });
    const values = res?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) return null;
    return values;
  } catch (_) { return null; }
}

// Observability: log each summarization OUTCOME so failures are visible, not
// silent. Non-fatal + tolerant of the summary_runs table not existing yet.
async function logSummaryRun(supabase, fields) {
  try {
    await (supabase || getClient()).from("summary_runs").insert([{
      session_id:  fields.session_id ?? null,
      status:      fields.status ?? null,
      new_rows:    fields.new_rows ?? null,
      facts_count: fields.facts_count ?? null,
      error:       fields.error ? String(fields.error).slice(0, 300) : null,
    }]);
  } catch (_) { /* table may not exist yet — never block summarization */ }
}

// Observability: log one row per chat request (intent, provider, timings…) so
// "M8 gave a weird answer" / silent failures become inspectable. Non-fatal.
async function logTrace(fields) {
  try {
    await getClient().from("request_traces").insert([{
      session_id:    fields.session_id ?? null,
      intent:        fields.intent ?? null,
      provider:      fields.provider ?? null,
      recovered:     fields.recovered ?? null,
      search_fired:  fields.search_fired ?? null,
      search_results:fields.search_results ?? null,
      memory_rows:   fields.memory_rows ?? null,
      playbooks:     fields.playbooks ?? null,
      latency_ms:    fields.latency_ms ?? null,
      memory_ms:     fields.memory_ms ?? null,
      fleet_ms:      fields.fleet_ms ?? null,
      router_ms:     fields.router_ms ?? null,
      search_ms:     fields.search_ms ?? null,
      llm_ms:        fields.llm_ms ?? null,
      summary_ms:    fields.summary_ms ?? null,
      ok:            fields.ok ?? null,
      error:         fields.error ? String(fields.error).slice(0, 300) : null,
      tool_decision: fields.tool_decision ?? null,   // L4 Build-4: which truth-tool handled the turn
    }]);
  } catch (_) { /* table may not exist yet — never block the response */ }
}

// How many NEW raw rows must accumulate before we (re)summarize a session.
// Lowered from 10 → 4 (Build-79): most short sessions never hit 10, so their
// durable facts were never extracted. 4 catches the typical 3-5 turn session.
const SUMMARY_ROW_THRESHOLD = parseInt(process.env.SUMMARY_ROW_THRESHOLD || "4", 10);

// Summaries are background work — prefer FREE non-Gemini providers so the
// scarce Gemini daily quota stays available for live user turns.
const SUMMARY_PROVIDER_ORDER = process.env.SUMMARY_PROVIDER_ORDER || "groq,cerebras,mistral,openrouter,gemini2,gemini";

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
// EPHEMERAL SESSIONS: a sessionId starting with "eval" (the eval harness, smoke
// tests) is treated as stateless — it neither RECALLS nor SAVES long-term memory.
// This keeps the eval hermetic (probes can't cross-contaminate each other via
// shared recall — the bug where the admin-override probe's "1,000,000 SAR" leaked
// into the roleplay probe) AND stops test traffic from polluting Muhammad's real
// memory store. No real session uses an "eval"-prefixed id.
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// ─────────────────────────────────────────────────────────────────
// PROVENANCE TAGGING (Build-30, PROVENANCE_TAGGING_DESIGN.md)
// ─────────────────────────────────────────────────────────────────
// Classify every m8_conversations row at WRITE time by session-id prefix.
// trust_level gates RECALL: default recall requires >= RECALL_MIN_TRUST (3),
// which permanently excludes eval_probe rows (od_/battery_/l5_/eval_ session
// prefixes -- the Odysseus/loop runs that caused the Build-26 contamination
// bug, where confabulated triage verdicts were recalled as real memory).
// Replaces the LOOP_TRIAGE_CONTAMINATION content regex: filtering is now by
// WHERE a row came from, not what it says -- permanent, no content maintenance.
const RECALL_MIN_TRUST = 3;
function inferSourceType(sessionId) {
  const sid = String(sessionId || "");
  if (/^(?:l5_|eval_|od_|battery_)/i.test(sid)) return { source_type: "eval_probe", trust_level: 1 };
  if (/^cron[_-]/i.test(sid)) return { source_type: "cron_session", trust_level: 2 };
  return { source_type: "user_session", trust_level: 4 };
}

async function recallMemory(currentSessionId, currentMessage = "", limit = 6) {
  if (isEphemeralSession(currentSessionId)) return [];
  try {
    const supabase = getClient();

    // Tier 1 — current canonical facts (uncapped by recency).
    // Build-80 fix: do NOT exclude currentSessionId here. The memory_type filter
    // (profile/operational) already prevents raw session turns from leaking in.
    // Excluding by session meant facts written by Build-79 this session were
    // invisible until the NEXT session — defeating the point of live extraction.
    let factsRes = await supabase
      .from("m8_conversations")
      .select("id, role, content, importance, memory_type, trust_level, source_type, created_at")
      .eq("is_current", true)
      .gte("trust_level", RECALL_MIN_TRUST)
      .in("memory_type", ["profile", "operational"])
      .is("merged_into", null)        // Build-85e: never recall soft-merged duplicates
      .order("created_at", { ascending: false })
      .limit(20);
    // Build-85e: degrade gracefully if the merged_into column isn't migrated yet
    // (pre-consolidation there are no merged rows, so unfiltered == filtered).
    if (factsRes.error && /merged_into/i.test(factsRes.error.message || "")) {
      factsRes = await supabase
        .from("m8_conversations")
        .select("id, role, content, importance, memory_type, trust_level, source_type, created_at")
        .eq("is_current", true)
        .gte("trust_level", RECALL_MIN_TRUST)
        .in("memory_type", ["profile", "operational"])
        .order("created_at", { ascending: false })
        .limit(20);
    }
    const facts = factsRes.data || [];

    // Tier 2 — semantic search (Build-81), keyword fallback when embedding unavailable.
    // Try semantic first: embed the current message and call match_memories() RPC.
    // If we get >= 2 results, use them. Otherwise fall back to keyword scoring over
    // a recent pool so short/keyword-free messages still get decent recall.
    let scoredPool = [];
    const queryEmbedding = currentMessage ? await generateEmbedding(currentMessage) : null;

    if (queryEmbedding) {
      const semantic = await semanticRecall(currentSessionId, queryEmbedding, limit);
      // Filter out profile/operational — those are Tier 1 already
      const filtered = semantic.filter(r => r.memory_type !== "profile" && r.memory_type !== "operational");
      if (filtered.length >= 2) {
        scoredPool = filtered;
      }
    }

    // Keyword fallback: used when no embedding available OR semantic returned < 2 hits
    if (scoredPool.length < 2) {
      let poolRes = await supabase
        .from("m8_conversations")
        .select("id, role, content, importance, memory_type, trust_level, source_type, created_at")
        .neq("session_id", currentSessionId)
        .eq("is_current", true)
        .gte("trust_level", RECALL_MIN_TRUST)
        .is("merged_into", null)        // Build-85e: never recall soft-merged duplicates
        .order("created_at", { ascending: false })
        .limit(120);
      // Build-85e: degrade gracefully if the merged_into column isn't migrated yet.
      if (poolRes.error && /merged_into/i.test(poolRes.error.message || "")) {
        poolRes = await supabase
          .from("m8_conversations")
          .select("id, role, content, importance, memory_type, trust_level, source_type, created_at")
          .neq("session_id", currentSessionId)
          .eq("is_current", true)
          .gte("trust_level", RECALL_MIN_TRUST)
          .order("created_at", { ascending: false })
          .limit(120);
      }
      const pool = (poolRes.data || []).filter(
        (r) => r.memory_type !== "profile" && r.memory_type !== "operational"
      );
      const keywords = extractKeywords(currentMessage);
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
          .sort((a, b) => (b._score - a._score) || (new Date(b.created_at) - new Date(a.created_at)))
          .slice(0, limit);
      }
    }

    // Merge facts + scored pool, dedupe by id, return in chronological order.
    const byId = new Map();
    for (const r of [...facts, ...scoredPool]) byId.set(r.id, r);
    return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } catch (err) {
    console.error("Memory recall error (non-fatal):", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// BUILD-79: IMMEDIATE FACT EXTRACTION
// Runs in the background after every saveMemory call (fire-and-forget).
// Uses cheap free providers only — never burns Gemini quota.
// Detects durable facts in the user message and upserts them immediately
// so short sessions (< SUMMARY_ROW_THRESHOLD turns) don't lose key facts.
// ─────────────────────────────────────────────────────────────────
const FACT_EXTRACT_SYSTEM = `You are a fact detector for a personal AI agent called M8.
Look at the USER MESSAGE below. If it contains a DURABLE FACT worth long-term memory, output ONLY this JSON:
{"key":"short_snake_case_key","statement":"one precise sentence stating the fact","memory_type":"profile or operational","importance":4}

If there is NO durable fact, output ONLY: {"key":null}

DURABLE = fleet config, business rule, stated preference, identity detail, recurring schedule, supplier rate, named person's role.
NOT DURABLE = questions, one-off lookups, greetings, data queries, results of a calculation.
NEVER extract: driver/fleet earnings, daily net/gross, today's totals — live data only, never stored.
memory_type: "profile" = identity (name, role, city). "operational" = business state (fleet size, rules, rates, preferences).
Be conservative — only extract when clearly and explicitly stated.`;

async function _maybeExtractFact(sessionId, userMessage) {
  if (isEphemeralSession(sessionId)) return;
  if (!userMessage || userMessage.length < 10) return;
  try {
    const out = await generate({
      systemInstruction: FACT_EXTRACT_SYSTEM,
      contents: [{ role: "user", parts: [{ text: `USER MESSAGE: ${String(userMessage).slice(0, 600)}` }] }],
      providerOrder: process.env.FACT_EXTRACT_PROVIDER_ORDER || "groq,cerebras,mistral",
      genConfig: { temperature: 0.1, maxOutputTokens: 120 },
    });
    const parsed = parseJsonLoose(out);
    if (!parsed || !parsed.key || !parsed.statement) return;
    await upsertFact(getClient(), sessionId, {
      key:         parsed.key,
      statement:   parsed.statement,
      memory_type: parsed.memory_type || "operational",
      importance:  parsed.importance  || 4,
    });
  } catch (_) { /* background, non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE: saveMemory — append raw turns (audit trail)
// ─────────────────────────────────────────────────────────────────
async function saveMemory(sessionId, userMessage, assistantResponse) {
  if (isEphemeralSession(sessionId)) return;
  try {
    const supabase = getClient();
    const { source_type, trust_level } = inferSourceType(sessionId);
    await supabase.from("m8_conversations").insert([
      { session_id: sessionId, role: "user",      content: userMessage,       memory_type: "session", source_type, trust_level },
      { session_id: sessionId, role: "assistant", content: assistantResponse, memory_type: "session", source_type, trust_level },
    ]);
    // Build-79: extract any durable fact from this turn immediately (background).
    _maybeExtractFact(sessionId, userMessage).catch(() => {});
    // Build-83c: extract named entities (people/books/problems/etc) in background.
    try { require("./entity-graph")._maybeExtractEntities(sessionId, userMessage).catch(() => {}); } catch (_) {}
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
- NEVER store fleet or driver EARNINGS / REVENUE figures as facts: daily or period net/gross, a day's fleet totals, "top performer = X SAR", "net today/yesterday", per-driver day numbers, a multi-day breakdown. These are LIVE DATA the agent reads from the fleet system on demand — storing them as memory is WRONG (they go stale and corrupt later answers). Business CONFIG is fine (rent, salaries, monthly targets/budgets, headcount, names, supplier rates).
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
// A fleet/driver EARNINGS or REVENUE figure (net/gross/daily-net, a day's total,
// "top performer … SAR") must NEVER be stored as a durable recallable fact — the
// live fleet spine is the single source of truth for these. Storing them poisons
// memory: they go stale, and if the LLM ever guesses a value it becomes a
// "remembered fact" served on later turns (this is exactly what happened with the
// fabricated per-driver breakdowns). Business CONFIG (rent, targets, budgets,
// names) is fine — it has no "net/gross earnings", "daily net", or "top performer".
function isFleetFigureFact(key, statement) {
  const k = (key || "").toLowerCase();
  const s = (statement || "").toLowerCase();
  if (/(net|gross)[_\s]?(earnings?|revenue)|daily[_\s]?net|net[_\s](today|yesterday)|earnings_(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|fleet[_\s]?net/.test(k)) return true;
  if (/\b(net|gross)\s+(earnings?|revenue)\b/.test(s) && /\bsar\b|\briyals?\b/.test(s)) return true;
  if (/\bdaily\s+net\b/.test(s)) return true;
  if (/\btop\s+performer\b/.test(s) && /\bsar\b/.test(s)) return true;
  return false;
}

async function upsertFact(supabase, sessionId, fact) {
  const key       = (fact?.key || "").trim();
  const statement = (fact?.statement || fact?.value || "").trim();
  if (!key || !statement) return;
  // Never persist transient fleet earnings/revenue as a fact (the spine owns them).
  if (isFleetFigureFact(key, statement)) return;
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

  const { source_type, trust_level } = inferSourceType(sessionId);
  // Build-81: generate embedding for semantic recall (null-safe — falls back to keyword)
  const embedding = await generateEmbedding(statement);
  await supabase.from("m8_conversations").insert([{
    session_id:  sessionId,
    role:        "summary",
    content:     statement,
    memory_type: memoryType,
    memory_key:  key,
    importance,
    is_current:  true,
    source_type,
    trust_level,
    embedding,
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
  if (isEphemeralSession(sessionId)) return;
  try {
    const supabase = getClient();

    // Raw turns for this session, oldest first.
    const rawRes = await supabase
      .from("m8_conversations")
      .select("id, role, content, created_at")
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true });
    const raw = rawRes.data || [];
    if (raw.length === 0) return { status: "empty" };
    const lastCreatedAt = raw[raw.length - 1].created_at;

    // Last summary marker for this session.
    const markRes = await supabase
      .from("m8_conversations")
      .select("id, metadata")
      .eq("session_id", sessionId)
      .eq("role", "summary")
      .eq("memory_type", "session")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1);
    const lastSummary = markRes.data?.[0];
    const lastAt      = lastSummary?.metadata?.last_summarized_at || "";

    // NOTE: id is a UUID (not numeric) — order/compare by created_at (sortable ISO).
    const newRows = raw.filter((r) => r.created_at > lastAt).length;
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
      await logSummaryRun(supabase, { session_id: sessionId, status: "parse_failed", new_rows: newRows });
      return { status: "parse_failed" };
    }

    const importance = Math.min(3, Math.max(1, parseInt(parsed.importance, 10) || 2));
    const metadata = {
      entities:           Array.isArray(parsed.entities) ? parsed.entities.slice(0, 30) : [],
      facts:              Array.isArray(parsed.facts) ? parsed.facts : [],
      session_start:      raw[0].created_at,
      last_summarized_at: lastCreatedAt,
    };

    // One current session summary per session: supersede the prior one.
    if (lastSummary) {
      await supabase
        .from("m8_conversations")
        .update({ is_current: false, superseded_at: new Date().toISOString() })
        .eq("id", lastSummary.id);
    }

    const { source_type, trust_level } = inferSourceType(sessionId);
    // Build-81: embed the summary text for semantic recall of past sessions.
    const summaryText = String(parsed.summary).slice(0, 2000);
    const embedding   = await generateEmbedding(summaryText);
    await supabase.from("m8_conversations").insert([{
      session_id:  sessionId,
      role:        "summary",
      content:     summaryText,
      memory_type: "session",
      topic:       (parsed.topic || "").toString().slice(0, 80) || null,
      importance,
      is_current:  true,
      source_type,
      trust_level,
      embedding,
      metadata,
    }]);

    // Canonical facts (supersede by key).
    if (Array.isArray(parsed.facts)) {
      for (const fact of parsed.facts.slice(0, 12)) {
        await upsertFact(supabase, sessionId, fact);
      }
    }

    console.log(`[M8] summarized session ${sessionId}: ${newRows} new rows, ${metadata.facts.length} facts`);
    await logSummaryRun(supabase, { session_id: sessionId, status: "success", new_rows: newRows, facts_count: metadata.facts.length });
    return { status: "summarized", newRows, facts: metadata.facts.length };
  } catch (err) {
    console.error("[M8] summarizeSession error (non-fatal):", err.message);
    await logSummaryRun(null, { session_id: sessionId, status: "error", error: err.message });
    return { status: "error", error: err.message };
  }
}

/**
 * Self-heal sweep (for the daily cron): re-run summarizeSession on recent
 * sessions. summarizeSession self-gates (skips below-threshold / already-done),
 * so this only actually summarizes sessions that are stuck. Bounded.
 */
async function sweepStuckSessions(maxSessions = 8) {
  try {
    const supabase = getClient();
    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("m8_conversations")
      .select("session_id")
      .in("role", ["user", "assistant"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    const sessions = [...new Set((data || []).map((r) => r.session_id))].slice(0, maxSessions);
    const results = [];
    for (const sid of sessions) {
      const r = await summarizeSession(sid);
      results.push({ sid, status: r?.status });
    }
    return { swept: sessions.length, results };
  } catch (e) {
    return { error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// BUILD-81: SEMANTIC RECALL via pgvector (Phase 3 — now implemented)
// Calls the match_memories() Postgres function (migration B81_semantic_recall.sql).
// Returns rows ordered by cosine similarity to queryEmbedding.
// Non-fatal — returns [] on any error so keyword fallback takes over.
// ─────────────────────────────────────────────────────────────────
async function semanticRecall(currentSessionId, queryEmbedding, limit = 6) {
  if (!queryEmbedding || !Array.isArray(queryEmbedding)) return [];
  try {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: queryEmbedding,
      current_session: currentSessionId || "",
      match_threshold: parseFloat(process.env.SEMANTIC_THRESHOLD || "0.70"),
      match_count:     limit,
      min_trust:       RECALL_MIN_TRUST,
    });
    if (error) { console.error("[M8] semanticRecall RPC error:", error.message); return []; }
    return data || [];
  } catch (err) {
    console.error("[M8] semanticRecall error (non-fatal):", err.message);
    return [];
  }
}

module.exports = {
  recallMemory,
  saveMemory,
  summarizeSession,
  sweepStuckSessions,
  logTrace,
  semanticRecall,
  inferSourceType,
  extractImmediateFact: _maybeExtractFact,
};
