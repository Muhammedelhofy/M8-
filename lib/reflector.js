/**
 * M8 Reflector — lib/reflector.js  (Build-85c: Self-Reflection Loop)
 *
 * A SECOND PASS over M8's first answer, run BEFORE the user sees it. A cheap
 * gemini-2.5-flash scoring call rates the draft answer on 3 axes; then:
 *   • relevance < 3      → rewrite the answer (one more gemini-2.5-flash call)
 *   • overclaim: true    → strip/flag unverified claims (wrap with [unverified])
 *   • missed_source:true → append a "more context may exist" note
 *
 * EVERYTHING FAILS SAFE. Any provider error, any timeout, any unparseable score
 * returns the ORIGINAL answer untouched (reflect() never throws). The scoring
 * call is held to a 2-second budget per the build spec; the optional rewrite has
 * its own (larger) bound so a hung rewrite can't wedge the turn either.
 *
 * SCOPE (enforced by the orchestrator gate, not here): ONLY the general +
 * knowledge lanes call reflect(). Fleet / finance / EOSB / compute / research
 * answers already carry deterministic ground-truth packets and must NEVER be
 * second-guessed by a probabilistic reflector — that would be the exact
 * "narration exceeds evidence" failure the rest of the system guards against.
 */
const { generate } = require("./llm");
const { safePersist } = require("./persistence"); // Build-110: survive the Vercel freeze

// ── Latency budgets (env-tunable) ────────────────────────────────────────────
// REFLECT_BUDGET_MS bounds the SCORING call: if it times out we skip and return
// the original. Build-110 (live-verify): the original 2s ceiling was too tight for
// free-Gemini's real latency here (13-19s on big calls) — the scoring call timed
// out EVERY general turn and bailed before logReflection ever ran, so m8_reflections
// stayed at 0. Raised the default to 8s so the (small, 150-token) scoring call
// actually completes and the reflection lands. Still env-tunable for ops.
const REFLECT_BUDGET_MS = parseInt(process.env.M8_REFLECT_BUDGET_MS || "8000", 10);
const REWRITE_BUDGET_MS = parseInt(process.env.M8_REWRITE_BUDGET_MS || "8000", 10);

// The model the spec names. gemini-first order so it is actually the one used
// (the free Gemini stack — see [[feedback-fable5-meaning]] default-to-free).
const REFLECT_MODEL = process.env.M8_REFLECT_MODEL || "gemini-2.5-flash";
const REFLECT_ORDER = "gemini,gemini2";

const MISSED_SOURCE_NOTE = "Note: additional context may exist in knowledge base";
const UNVERIFIED_TAG = "[unverified]";

// Input caps so a runaway answer/source blob can't blow the scoring prompt.
const Q_CAP = 1000, A_CAP = 4000, S_CAP = 2000;

function truncate(s, n) {
  s = (s == null ? "" : String(s));
  return s.length > n ? s.slice(0, n) : s;
}

// Build-85g (Gemini review): Binary rubric replaces 1-5 relevance scale.
// Same-model 1-5 scoring triggers self-preference bias — models rubber-stamp their
// own output. Binary deterministic criteria are more reliable.
// Critique-before-score forces the model to find the flaw before rating it.
function buildReflectPrompt(question, answer, sourcesUsed) {
  return [
    "You are auditing an AI answer. Write ONE sentence critique, then output JSON.",
    "Critique: identify the single biggest flaw (or write 'none' if the answer is solid).",
    "Then return ONLY this JSON (no extra text):",
    '{"cited_source": true/false, "exceeded_scope": true/false, "unsourced_claim": true/false}',
    "cited_source=true if the answer references [KG], [Memory], [Entity], [Fleet], a book, or an author.",
    "exceeded_scope=true if the answer addresses topics the question did not ask about.",
    "unsourced_claim=true if the answer asserts a specific fact with NO source backing it.",
    "Question: " + truncate(question, Q_CAP),
    "Answer: " + truncate(answer, A_CAP),
    "Sources available: " + truncate(sourcesUsed, S_CAP),
  ].join("\n");
}

function buildRewritePrompt(question, answer, issues) {
  const issueText = Array.isArray(issues) ? issues.join("; ") : String(issues || "");
  return (
    "Rewrite this answer fixing these issues: " + issueText + ". " +
    "Keep the same facts, improve accuracy and sourcing. " +
    "Question: " + truncate(question, Q_CAP) + ". " +
    "Original: " + truncate(answer, A_CAP)
  );
}

// ── Score parsing (robust — Gemini may fence it, or mirror the prompt's
//    UNQUOTED keys; tolerate both, clamp relevance to 1..5) ───────────────────
// Build-85g: parse new binary schema. Tolerates old {relevance,overclaim,missed_source}
// shape from cached test fixtures — maps it to the new shape so tests don't break.
function normalizeScore(obj) {
  if (!obj || typeof obj !== "object") return null;
  const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";
  // New binary schema (Build-85g)
  if ("cited_source" in obj || "exceeded_scope" in obj || "unsourced_claim" in obj) {
    return {
      cited_source:    truthy(obj.cited_source),
      exceeded_scope:  truthy(obj.exceeded_scope),
      unsourced_claim: truthy(obj.unsourced_claim),
      // legacy compat fields so downstream checks don't crash
      relevance: truthy(obj.unsourced_claim) ? 2 : 4,
      overclaim: truthy(obj.exceeded_scope),
      missed_source: !truthy(obj.cited_source),
    };
  }
  // Legacy fallback for old shape (keeps tests green on existing fixtures)
  let rel = parseInt(obj.relevance, 10);
  if (!Number.isFinite(rel)) rel = 3;
  rel = Math.max(1, Math.min(5, rel));
  return {
    relevance: rel,
    overclaim: truthy(obj.overclaim),
    missed_source: truthy(obj.missed_source),
    cited_source: !truthy(obj.missed_source),
    exceeded_scope: truthy(obj.overclaim),
    unsourced_claim: rel < 3,
  };
}

function parseScore(raw) {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;
  // strip ``` / ```json fences
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj = null;
  try {
    obj = JSON.parse(m[0]);
  } catch (_) {
    // tolerate unquoted object keys (the prompt example shows them unquoted)
    try {
      const fixed = m[0].replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      obj = JSON.parse(fixed);
    } catch (_2) {
      return null;
    }
  }
  return normalizeScore(obj);
}

// ── Issue list + light (no-LLM) remediations ─────────────────────────────────
function issuesFromScore(score) {
  const issues = [];
  if (!score) return issues;
  if (score.unsourced_claim)  issues.push("the answer does not directly address the question");
  if (score.exceeded_scope)   issues.push("the answer overclaims — states unverified things as established fact");
  if (!score.cited_source)    issues.push("the answer may have missed relevant context in the knowledge base");
  return issues;
}

// overclaim:true → flag the answer as carrying unverified claims. We cannot
// surgically excise WHICH sentence is the overclaim within the latency budget,
// so the conservative, deterministic fix is to wrap the remainder with an
// [unverified] marker (idempotent — never double-tags).
function stripUnverified(answer) {
  const a = (answer == null ? "" : String(answer)).trim();
  if (!a) return a;
  if (a.indexOf(UNVERIFIED_TAG) === 0) return a;
  return UNVERIFIED_TAG + " " + a;
}

// missed_source:true → append the standing note (idempotent).
function addMissedSourceNote(answer) {
  const a = (answer == null ? "" : String(answer));
  if (a.indexOf(MISSED_SOURCE_NOTE) !== -1) return a;
  return a.replace(/\s+$/, "") + "\n\n" + MISSED_SOURCE_NOTE;
}

// Apply the non-rewrite fixes; returns the modified answer or null if nothing
// changed (so the caller leaves the original byte-for-byte untouched).
function applyLightFixes(answer, score) {
  let out = answer;
  let changed = false;
  if (score && score.exceeded_scope)  { out = stripUnverified(out); changed = true; }
  if (score && !score.cited_source)   { out = addMissedSourceNote(out); changed = true; }
  return changed ? out : null;
}

// ── Timeout wrapper ──────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error((label || "op") + " timed out after " + ms + "ms")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ── Gemini scoring call (held to REFLECT_BUDGET_MS) ──────────────────────────
async function scoreAnswer(question, answer, sourcesUsed) {
  const prompt = buildReflectPrompt(question, answer, sourcesUsed);
  const raw = await withTimeout(
    generate({
      systemInstruction: "You are a strict answer-quality auditor. Return ONLY the JSON object described, with no surrounding prose.",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      providerOrder: REFLECT_ORDER,
      genConfig: { temperature: 0, maxOutputTokens: 150, geminiModel: REFLECT_MODEL },
      meta: {},
    }),
    REFLECT_BUDGET_MS,
    "reflect-score"
  );
  return parseScore(raw);
}

// ── rewrite(question, answer, issues) — one more gemini-2.5-flash call ───────
// Returns an improved answer, or the ORIGINAL on any failure/empty/timeout.
async function rewrite(question, answer, issues) {
  const original = (answer == null ? "" : String(answer));
  const prompt = buildRewritePrompt(question, original, issues);
  try {
    const raw = await withTimeout(
      generate({
        systemInstruction: "You rewrite answers to be more accurate and better-sourced. Keep every real fact from the original; never invent new facts or sources. Return only the rewritten answer.",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        providerOrder: REFLECT_ORDER,
        genConfig: { temperature: 0.2, maxOutputTokens: 500, geminiModel: REFLECT_MODEL },
        meta: {},
      }),
      REWRITE_BUDGET_MS,
      "reflect-rewrite"
    );
    const out = (raw == null ? "" : String(raw)).trim();
    return out || original;     // never return empty
  } catch (_) {
    return original;            // fail safe → original answer
  }
}

// ── logReflection(sessionId, question, score, rewritten) ─────────────────────
// Saves one row to m8_reflections. Build-110 (Brain CPR): returns the safePersist
// promise so reflect() can AWAIT it. Live verify showed waitUntil does NOT flush
// from M8's legacy (req,res) handlers — the deferred insert never got a request
// context and died on the freeze (table at 0). Awaiting the cheap insert (~100ms)
// is the guaranteed fix and adds negligible latency (reflect() is already awaited).
// safePersist still wraps with waitUntil (belt-and-suspenders) + logs +1; never
// throws. This function NEVER throws out either.
function logReflection(sessionId, question, score, rewritten) {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const row = {
      session_id:         sessionId || null,
      question:           truncate(question, 200),
      // Build-85g: store binary fields; legacy relevance_score kept for existing rows
      relevance_score:    score ? score.relevance : null,
      overclaim_flag:     score ? !!score.exceeded_scope : null,
      missed_source_flag: score ? !score.cited_source : null,
      was_rewritten:      !!rewritten,
    };
    // Build-110: awaited by reflect() so it lands before the lambda freezes.
    return safePersist(db.from("m8_reflections").insert(row), "reflect");
  } catch (e) {
    console.error("[M8 reflector] logReflection error (non-fatal):", e && e.message);
  }
  return Promise.resolve();
}

// ── reflect(question, answer, sourcesUsed[, opts]) — the entry point ─────────
// Returns { score, issues, revised, rewritten }. `revised` is null when the
// answer passes clean (caller keeps the original). NEVER throws.
async function reflect(question, answer, sourcesUsed, opts = {}) {
  const result = { score: null, issues: [], revised: null, rewritten: false };
  const original = (answer == null ? "" : String(answer));
  console.error("[M8 reflector DIAG] reflect() called len=" + original.length); // Build-110 DIAG (temp)
  if (!original.trim()) return result;
  // Build-85g (Gemini review): skip reflection on short answers — self-reflection
  // only adds signal on long-form synthesis; on short/deterministic answers it adds
  // latency and hallucination risk without meaningful quality improvement.
  if (original.length < 200) { console.error("[M8 reflector DIAG] skip <200"); return result; }

  let score = null;
  try {
    score = await scoreAnswer(question, original, sourcesUsed);
  } catch (e) {
    console.error("[M8 reflector DIAG] scoreAnswer THREW: " + (e && e.message)); // DIAG
    return result;                                // timeout / provider fail → original
  }
  if (!score) { console.error("[M8 reflector DIAG] score NULL (unparseable)"); return result; } // DIAG
  console.error("[M8 reflector DIAG] score OK -> will logReflection"); // DIAG

  result.score = score;
  const issues = issuesFromScore(score);
  result.issues = issues;

  if (score.unsourced_claim) {
    const rw = await rewrite(question, original, issues);
    if (rw && rw.trim() && rw.trim() !== original.trim()) {
      result.revised = rw;
      result.rewritten = true;
    }
  } else {
    const light = applyLightFixes(original, score);
    if (light != null) result.revised = light;
  }

  // Build-110: AWAIT the telemetry write so it lands before the lambda freezes
  // (waitUntil doesn't flush from M8's legacy handlers). Cheap insert; never throws.
  try { await logReflection(opts.sessionId, question, score, result.rewritten); } catch (_) {}

  return result;
}

module.exports = {
  reflect,
  rewrite,
  logReflection,
  // exported for tests/B85c-reflector-verify.ps1 (pure-logic mirror)
  buildReflectPrompt,
  buildRewritePrompt,
  parseScore,
  normalizeScore,
  issuesFromScore,
  stripUnverified,
  addMissedSourceNote,
  applyLightFixes,
  truncate,
  withTimeout,
  REFLECT_BUDGET_MS,
  REWRITE_BUDGET_MS,
  REFLECT_MODEL,
  MISSED_SOURCE_NOTE,
  UNVERIFIED_TAG,
};
