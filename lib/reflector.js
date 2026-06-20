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

// ── Latency budgets (env-tunable) ────────────────────────────────────────────
// REFLECT_BUDGET_MS is the 2s spec ceiling on the SCORING call: if it times out
// we skip and return the original. The rewrite gets its own bound.
const REFLECT_BUDGET_MS = parseInt(process.env.M8_REFLECT_BUDGET_MS || "2000", 10);
const REWRITE_BUDGET_MS = parseInt(process.env.M8_REWRITE_BUDGET_MS || "4000", 10);

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

// ── Prompt builders (pure — mirrored byte-for-byte in the PS verifier) ───────
function buildReflectPrompt(question, answer, sourcesUsed) {
  return [
    "Score this answer on 3 axes. Return JSON only:",
    "{relevance: 1-5, overclaim: true/false, missed_source: true/false}",
    "Question: " + truncate(question, Q_CAP),
    "Answer: " + truncate(answer, A_CAP),
    "Sources used: " + truncate(sourcesUsed, S_CAP),
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
function normalizeScore(obj) {
  if (!obj || typeof obj !== "object") return null;
  let rel = parseInt(obj.relevance, 10);
  if (!Number.isFinite(rel)) rel = 3;                 // neutral default → no rewrite
  rel = Math.max(1, Math.min(5, rel));
  const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";
  return {
    relevance: rel,
    overclaim: truthy(obj.overclaim),
    missed_source: truthy(obj.missed_source),
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
  if (score.relevance < 3) issues.push("the answer does not directly address the question");
  if (score.overclaim) issues.push("the answer overclaims — states unverified things as established fact");
  if (score.missed_source) issues.push("the answer may have missed relevant context in the knowledge base");
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
  if (score && score.overclaim) { out = stripUnverified(out); changed = true; }
  if (score && score.missed_source) { out = addMissedSourceNote(out); changed = true; }
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

// ── logReflection(sessionId, question, score, rewritten) — fire-and-forget ───
// Saves one row to m8_reflections. NEVER awaited, NEVER throws out.
function logReflection(sessionId, question, score, rewritten) {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const row = {
      session_id: sessionId || null,
      question: truncate(question, 200),
      relevance_score: score ? score.relevance : null,
      overclaim_flag: score ? !!score.overclaim : null,
      missed_source_flag: score ? !!score.missed_source : null,
      was_rewritten: !!rewritten,
    };
    // fire-and-forget: kick off the insert, swallow any rejection
    Promise.resolve(db.from("m8_reflections").insert(row))
      .catch((e) => console.error("[M8 reflector] log insert error (non-fatal):", e && e.message));
  } catch (e) {
    console.error("[M8 reflector] logReflection error (non-fatal):", e && e.message);
  }
}

// ── reflect(question, answer, sourcesUsed[, opts]) — the entry point ─────────
// Returns { score, issues, revised, rewritten }. `revised` is null when the
// answer passes clean (caller keeps the original). NEVER throws.
async function reflect(question, answer, sourcesUsed, opts = {}) {
  const result = { score: null, issues: [], revised: null, rewritten: false };
  const original = (answer == null ? "" : String(answer));
  if (!original.trim()) return result;            // nothing to reflect on

  let score = null;
  try {
    score = await scoreAnswer(question, original, sourcesUsed);
  } catch (_) {
    return result;                                // timeout / provider fail → original
  }
  if (!score) return result;                      // unparseable → original

  result.score = score;
  const issues = issuesFromScore(score);
  result.issues = issues;

  if (score.relevance < 3) {
    const rw = await rewrite(question, original, issues);
    if (rw && rw.trim() && rw.trim() !== original.trim()) {
      result.revised = rw;
      result.rewritten = true;
    }
  } else {
    const light = applyLightFixes(original, score);
    if (light != null) result.revised = light;
  }

  // fire-and-forget telemetry — never await, never let it throw out of reflect()
  try { logReflection(opts.sessionId, question, score, result.rewritten); } catch (_) {}

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
