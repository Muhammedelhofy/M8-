/**
 * M8 Build-92 — Conjecture Outcome Memory  (lib/conjecture-memory.js)
 *
 * Closes the learning loop. The conjecture generator (lib/conjecture-gen.js)
 * proposed each run with NO memory of what had verified before — when a Lean leaf
 * verified, the signal disappeared. This module persists those outcomes and feeds
 * them back so each run is no longer blind.
 *
 *   recordOutcome      — fire-and-forget write when a Lean leaf verifies (loop.js).
 *   getSuccessPatterns — last 5 verified rows for a problem (conjecture-gen.js).
 *   buildFeedbackBlock — PURE; formats those rows into a proposer prompt block.
 *
 * HONESTY: a verified leaf is ONE Lean machine-check, NOT a proof of the conjecture.
 * Nothing here ever writes "proven" — rows are outcomes, tags are technique labels,
 * and a defensive filter drops any model-emitted "proven"/"proved" tag.
 *
 * FAIL-SAFE: recordOutcome never throws and never blocks the verification path;
 * getSuccessPatterns returns [] on any error. The feature is ADDITIVE — with the
 * table empty or unreachable the generator behaves exactly as before.
 *
 * buildFeedbackBlock is mirror-tested in tests/B92-feedback-verify.ps1.
 */

const OUTCOMES_TABLE = "m8_conjecture_outcomes";

// Single domain in the engine today (the M3 target is Collatz). loop.js records
// and conjecture-gen.js reads with this same id so the loop carries signal.
const COLLATZ_PROBLEM_ID = "collatz";

const PATTERN_LIMIT  = 5;
const TAG_TIMEOUT_MS = 2000;

// ── PURE (PS-mirror-tested) ──────────────────────────────────────────────────

/**
 * Format verified-conjecture rows into a proposer feedback block. Empty input
 * returns "" so the generator stays byte-identical to a no-memory run. PURE, sync.
 */
function buildFeedbackBlock(patterns) {
  if (!patterns || !patterns.length) return "";
  const lines = ["VERIFIED CONJECTURE PATTERNS — what has worked before for this problem:"];
  for (const p of patterns) {
    const tags = Array.isArray(p.structural_tags) && p.structural_tags.length
      ? `[${p.structural_tags.join(", ")}] `
      : "";
    const text = String(p.conjecture_text || "").replace(/\s+/g, " ").trim();
    const when = String(p.verified_at || "").slice(0, 10);
    lines.push(`• ${tags}"${text}"${when ? ` — verified ${when}` : ""}`);
  }
  lines.push("Propose structurally DIFFERENT conjectures. Do NOT re-propose variations of these.");
  return lines.join("\n");
}

/** Normalize a raw model tag list into 2-5 lowercase snake_case technique tags. */
function parseTags(raw) {
  return String(raw || "")
    .replace(/^\s*tags?\s*[:\-]/i, "")
    .replace(/[\[\]"'`.]/g, " ")
    .split(/[,\n;]/)
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((t) => t.length > 0 && t.length <= 40 && !/proven|proved/.test(t))
    .slice(0, 5);
}

// ── TAG EXTRACTION (cheap Gemini, 2s hard cap; non-fatal) ─────────────────────
// Lazy-require ./llm so the pure path (and module load) never pulls the Gemini SDK.
async function extractStructuralTags(conjectureText, leanProofSketch) {
  try {
    const { generateOnce } = require("./llm");
    const claim  = String(conjectureText || "").slice(0, 600);
    const sketch = String(leanProofSketch || "").slice(0, 600);
    const gen = generateOnce({
      provider: "gemini", model: null,
      systemInstruction:
        "Extract 2-5 short lowercase structural tags for the mathematical techniques/structure of a Lean-verified lemma. " +
        "Examples: induction, modular_arithmetic, base_case, parity, casework, inequality, divisibility, recursion. " +
        "Output ONLY a comma-separated list of tags. Do not use the words 'proven' or 'proved'.",
      contents: [{ role: "user", parts: [{ text: `Conjecture: ${claim}\nProof sketch: ${sketch}\n\nTags:` }] }],
      genConfig: { temperature: 0, maxOutputTokens: 60 },
    });
    const raw = await Promise.race([
      gen,
      new Promise((resolve) => setTimeout(() => resolve(null), TAG_TIMEOUT_MS)),
    ]);
    return (raw && typeof raw === "string") ? parseTags(raw) : [];
  } catch (_) {
    return [];
  }
}

// ── SUPABASE (fail-safe) ──────────────────────────────────────────────────────

// Insert the outcome, then best-effort attach tags. The insert is invoked
// synchronously (before the first await) so recordOutcome's caller is guaranteed
// the write was initiated; the tag UPDATE is non-fatal — tags stay null on timeout.
async function insertAndTag(db, payload) {
  const ins = await db.from(OUTCOMES_TABLE).insert([payload]).select("id").single();
  const id = ins && ins.data ? ins.data.id : null;
  if (!id) return;
  const tags = await extractStructuralTags(payload.conjecture_text, payload.lean_proof_sketch);
  if (tags && tags.length) {
    await db.from(OUTCOMES_TABLE).update({ structural_tags: tags }).eq("id", id);
  }
}

/**
 * Fire-and-forget. NEVER throws, NEVER blocks — call WITHOUT await from the
 * verification path. The async write is detached; a rejection is logged, never
 * surfaced.
 */
function recordOutcome(db, { problemId, conjectureText, leanProofSketch, loopRunId } = {}) {
  try {
    const payload = {
      problem_id:        problemId || COLLATZ_PROBLEM_ID,
      conjecture_text:   String(conjectureText || ""),
      lean_proof_sketch: leanProofSketch != null ? String(leanProofSketch) : null,
      loop_run_id:       loopRunId || null,
    };
    const p = insertAndTag(db, payload);
    if (p && typeof p.catch === "function") {
      p.catch((e) => console.error("[M8] recordOutcome async error (non-fatal):", e && e.message));
    }
  } catch (e) {
    console.error("[M8] recordOutcome error (non-fatal):", e && e.message);
  }
}

/** Last PATTERN_LIMIT verified rows for problemId, newest first. [] on any error. */
async function getSuccessPatterns(db, problemId) {
  try {
    const { data, error } = await db
      .from(OUTCOMES_TABLE)
      .select("conjecture_text, structural_tags, verified_at, lean_proof_sketch")
      .eq("problem_id", problemId || COLLATZ_PROBLEM_ID)
      .order("verified_at", { ascending: false })
      .limit(PATTERN_LIMIT);
    if (error) {
      console.error("[M8] getSuccessPatterns error (non-fatal):", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("[M8] getSuccessPatterns exception (non-fatal):", e && e.message);
    return [];
  }
}

module.exports = {
  // pure (PS-mirror-tested)
  buildFeedbackBlock, parseTags,
  // fail-safe Supabase + Gemini
  recordOutcome, getSuccessPatterns, extractStructuralTags,
  COLLATZ_PROBLEM_ID, OUTCOMES_TABLE, PATTERN_LIMIT, TAG_TIMEOUT_MS,
};
