/**
 * M8 Build-92 — Conjecture Outcome Memory  (lib/conjecture-memory.js)
 *
 * Closes the learning loop. The conjecture generator (lib/conjecture-gen.js)
 * proposed each run with NO memory of what had verified before — when a Lean leaf
 * verified, the signal disappeared. This module persists those outcomes and feeds
 * them back so each run is no longer blind.
 *
 *   recordOutcome      — write when a Lean leaf verifies (loop.js). Build-110:
 *                        returns an awaitable, never-rejecting promise so the cron
 *                        can `await` it (the old detached write froze out on Vercel).
 *   getSuccessPatterns — last 5 verified rows for a problem (conjecture-gen.js).
 *   buildFeedbackBlock — PURE; formats those rows into a proposer prompt block.
 *
 * HONESTY: a verified leaf is ONE Lean machine-check, NOT a proof of the conjecture.
 * Nothing here ever writes "proven" — rows are outcomes, tags are technique labels,
 * and a defensive filter drops any model-emitted "proven"/"proved" tag.
 *
 * FAIL-SAFE: recordOutcome never throws (awaiting it can never reject);
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
const FAILED_LIMIT   = 10;   // Build-99: how many recent failed-approach rows to surface
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

/**
 * Build-99 — OUTCOME-BIASED proposer, AVOID side. Format failed-approach rows into a
 * proposer block that names the structural techniques already tried where Lean
 * returned `sorry` (proof never closed), and tells the proposer to steer clear.
 *
 * Takes the rows returned by getFailedApproaches and unions their structural_tags
 * (deduped case-insensitively, first-seen order). Empty input — or failures that
 * carry no extracted tags — return "" so the packet stays byte-identical to a
 * no-memory run. PURE, sync — PS-mirror-tested. HONEST: this is "tried, left sorry",
 * never "disproven".
 */
function buildAvoidBlock(failedPatterns) {
  if (!failedPatterns || !failedPatterns.length) return "";
  const tags = [];
  const seen = new Set();
  for (const p of failedPatterns) {
    const st = Array.isArray(p && p.structural_tags) ? p.structural_tags : [];
    for (const raw of st) {
      const tag = String(raw || "").trim();
      const key = tag.toLowerCase();
      if (tag && !seen.has(key)) { seen.add(key); tags.push(tag); }
    }
  }
  if (!tags.length) return "";
  return [
    "AVOID THESE STRUCTURAL APPROACHES (already tried, Lean returned sorry):",
    tags.map((t) => `[${t}]`).join(", "),
    "Generate a conjecture that is STRUCTURALLY DIFFERENT from the AVOID list above. " +
      "Prefer approaches similar to VERIFIED APPROACHES if any exist.",
  ].join("\n");
}

/**
 * Build-99 — classify a persisted outcome row. A row is a FAILED approach when its
 * Lean sketch is absent (null/blank) or still carries a `sorry` (the proof never
 * closed); the complement is a verified-leaf success. PURE, sync — PS-mirror-tested.
 * Used to split the single m8_conjecture_outcomes table into the verified (success)
 * and avoid (failed) feedback streams without a schema change.
 */
function isFailedOutcome(row) {
  const s = row && row.lean_proof_sketch;
  if (s == null) return true;
  const str = String(s).trim();
  if (str === "") return true;
  return /\bsorry\b/i.test(str);
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
 * recordOutcome — NEVER throws. Build-110 (Brain CPR): now RETURNS an awaitable,
 * NEVER-REJECTING promise so the nightly cron (loop.js runVerifyPhase) can simply
 * `await` it. The cron is latency-insensitive and its handler is awaited by
 * Vercel, so awaiting here is the simplest way to guarantee the m8_conjecture_outcomes
 * write lands before the lambda freezes (the old detached write was dropped).
 * Fire-and-forget callers may still ignore the return value — the internal .catch
 * means an un-awaited call can never surface an unhandled rejection.
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
    if (p && typeof p.then === "function") {
      return p
        .then(() => { console.log("[persist:conjecture-outcome] +1"); })
        .catch((e) => console.error("[M8] recordOutcome async error (non-fatal):", e && e.message));
    }
  } catch (e) {
    console.error("[M8] recordOutcome error (non-fatal):", e && e.message);
  }
  return Promise.resolve();
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
    // Build-99: the table now also holds FAILED (sorry/absent-sketch) rows. Keep the
    // VERIFIED block clean by dropping those here — only genuine verified-leaf
    // successes feed buildFeedbackBlock. (Query shape unchanged; filter is in JS.)
    return (data || []).filter((r) => !isFailedOutcome(r));
  } catch (e) {
    console.error("[M8] getSuccessPatterns exception (non-fatal):", e && e.message);
    return [];
  }
}

/**
 * Build-99 — last `limit` FAILED-approach rows for problemId, newest first. A failed
 * approach is an outcome whose Lean sketch is absent or still carries a `sorry`
 * (isFailedOutcome). Returns the rows WITH their structural_tags so buildAvoidBlock
 * can union them into an AVOID list. Over-fetches then filters in JS (avoids any
 * PostgREST ilike-wildcard ambiguity). [] on any error — fail-safe, like the rest.
 */
async function getFailedApproaches(db, problemId, limit = FAILED_LIMIT) {
  try {
    const lim = Math.max(1, Math.floor(limit));
    const { data, error } = await db
      .from(OUTCOMES_TABLE)
      .select("conjecture_text, structural_tags, verified_at, lean_proof_sketch")
      .eq("problem_id", problemId || COLLATZ_PROBLEM_ID)
      .order("verified_at", { ascending: false })
      .limit(lim * 4);
    if (error) {
      console.error("[M8] getFailedApproaches error (non-fatal):", error.message);
      return [];
    }
    return (data || []).filter(isFailedOutcome).slice(0, lim);
  } catch (e) {
    console.error("[M8] getFailedApproaches exception (non-fatal):", e && e.message);
    return [];
  }
}

/**
 * Build-111 — DURABLE, IDEMPOTENT reconciliation of verified scaffolds into outcome rows.
 *
 * WHY: recordOutcome only fires on the newlyVerified TRANSITION edge — the single run a
 * leaf FIRST verifies. If that one write is missed (the pre-Build-110 un-awaited write
 * Vercel dropped on freeze, a cold-Lean night, a deploy gap, or a flaky re-check), the
 * leaf verifies, its scaffold flips to leaves_done, and it PERMANENTLY exits the recheck
 * pool (fetchPendingScaffold filters status='open'; recheckScaffold only touches
 * {lean_pending,lean_error}). newlyVerified can then never re-fire, so the verified leaf
 * is stranded out of m8_conjecture_outcomes forever — exactly why the table sat at 0
 * despite real verified leaves in the graph.
 *
 * WHAT: guarantees EVERY currently Lean-verified scaffold has exactly one verified
 * (success) outcome row. Insert-if-absent, keyed on (problem_id, normalized
 * conjecture_text) among NON-failed rows only — so (a) it is safe to run on every
 * cron-verify, a flip-flopping leaf can never spawn daily duplicates, and (b) a prior
 * `sorry` row for the same conjecture does NOT suppress recording its later verified
 * success (the two coexist; getSuccessPatterns/getFailedApproaches each filter their own).
 *
 * `scaffolds` come from lemma-dag.fetchVerifiedScaffolds() = [{ id, target, sketch }].
 * Fail-safe: never throws; returns the count of rows inserted.
 */
async function reconcileVerifiedOutcomes(db, problemId, scaffolds) {
  try {
    const pid  = problemId || COLLATZ_PROBLEM_ID;
    const list = (Array.isArray(scaffolds) ? scaffolds : []).filter((s) => s && s.target);
    if (!list.length) return 0;

    const { data, error } = await db
      .from(OUTCOMES_TABLE)
      .select("conjecture_text, lean_proof_sketch")
      .eq("problem_id", pid)
      .limit(2000);
    if (error) {
      console.error("[M8] reconcileVerifiedOutcomes select error (non-fatal):", error.message);
      return 0;
    }
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    // Only VERIFIED (non-failed) rows count as "already recorded".
    const have = new Set((data || []).filter((r) => !isFailedOutcome(r)).map((r) => norm(r.conjecture_text)));

    let inserted = 0;
    for (const s of list) {
      const key = norm(s.target);
      if (!key || have.has(key)) continue;
      // Verified by construction (came from leaves_verified>0). Force a non-empty,
      // non-`sorry` sketch so isFailedOutcome classifies the row as a SUCCESS even in the
      // degenerate case where a verified leaf carried no stored code.
      const raw = s.sketch != null ? String(s.sketch) : "";
      const sketch = (/\S/.test(raw) && !/\bsorry\b/i.test(raw)) ? raw : "lean_verified";
      await recordOutcome(db, {
        problemId: pid,
        conjectureText: s.target,
        leanProofSketch: sketch,
        loopRunId: s.loopRunId || null,
      });
      have.add(key);   // guard against duplicate targets within this same batch
      inserted++;
    }
    return inserted;
  } catch (e) {
    console.error("[M8] reconcileVerifiedOutcomes exception (non-fatal):", e && e.message);
    return 0;
  }
}

module.exports = {
  // pure (PS-mirror-tested)
  buildFeedbackBlock, buildAvoidBlock, isFailedOutcome, parseTags,
  // fail-safe Supabase + Gemini
  recordOutcome, getSuccessPatterns, getFailedApproaches, extractStructuralTags,
  // Build-111: durable idempotent reconciliation (closes the table-stuck-at-0 gap)
  reconcileVerifiedOutcomes,
  COLLATZ_PROBLEM_ID, OUTCOMES_TABLE, PATTERN_LIMIT, FAILED_LIMIT, TAG_TIMEOUT_MS,
};
