/**
 * M8 Reverse-and-Add (Lychrel / "196") Structural Probe Pack — lib/lychrel-probes.js
 * Build-43 Option C — the SECOND problem domain (prove the engine generalizes).
 *
 * A structural twin of lib/collatz-probes.js (M1), pointed at a DIFFERENT open
 * problem so we can show the same census + conjecture machinery is general, not a
 * one-trick Collatz machine. The map is the reverse-and-add iteration:
 *
 *     R(n) = n + reverse_digits(n)
 *
 * Iterating R, most numbers quickly reach a base-10 PALINDROME (e.g. 56 -> 121 in
 * 1 step). A few — famously 196 — are not known to reach one no matter how far you
 * run; whether they ever do is UNSOLVED ("Lychrel candidates"). This module runs a
 * deterministic census of steps-to-palindrome over [1..N] and surfaces the suspected
 * Lychrel seeds — as OPEN observations, never claims.
 *
 * HONESTY (load-bearing, inherited from M1):
 *   - NEVER "196 is Lychrel" (unproven/open) and NEVER "all numbers reach a
 *     palindrome" (open). Only "observed: reached a palindrome in k steps for
 *     n <= N", or "no palindrome within K steps for n <= N -- suspected Lychrel,
 *     OPEN". A census is NEUTRAL descriptive data, not evidence + not a proof.
 *   - Everything is computed IN THIS FILE, deterministically, with BigInt (the
 *     iterates explode past 10^80 fast). The LLM only narrates the packet.
 *   - Machine-generated template conjectures are deterministically FALSIFIED over
 *     the census range; a survivor is "tested to N, still OPEN", NEVER proven.
 *   - HARD caps: N <= 50,000, step cap K <= 1,000, suspected-list <= 40 entries.
 *
 * Pure functions; fails safe (detection returns {probe:false} on any doubt).
 */
const { parseBoundToNumber, splitSentences } = require("./discovery");

// ── detection ─────────────────────────────────────────────────────────────────
// Fires only on an explicit RUN ask: target + run/census verb. A recall question
// ("what's a Lychrel number?") has no run-verb and stays with the graph lane.
const LY_TARGET = /\b(?:reverse[\s-]?and[\s-]?add|lychrel|196[\s-]?problem|palindrome\s+problem|digit[\s-]?revers(?:al|e|ing))\b/i;
const LY_RUN_VERB = /\b(?:run|compute|probe|generate|build|calculate|scan|execute|refresh|census)\b/i;
const LY_PACK_RE = /\b(?:structural\s+probes?|probe\s+pack|census|engine|feature\s+(?:pack|census))\b/i;

const LY_BOUND_RE = /\b(?:up\s+to|below|under|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|thousand|k|m))?|10\s*\^\s*\d+|\d[eE]\d+)\b/i;
const LY_STEPS_RE = /\bwithin\s+(\d[\d,_]*)\s+(?:steps|iterations|reverse[\s-]?and[\s-]?adds?)\b/i;

const BOUND_DEFAULT = 10000;
const BOUND_MIN     = 100;
const BOUND_MAX     = 50000;     // hard runtime cap (BigInt iteration)
const STEPCAP_DEFAULT = 500;
const STEPCAP_MIN     = 30;
const STEPCAP_MAX     = 1000;
const SUSPECT_CAP     = 40;

function clampBound(raw) {
  const n = parseBoundToNumber(raw);
  if (n == null || !isFinite(n)) return BOUND_DEFAULT;
  return Math.max(BOUND_MIN, Math.min(BOUND_MAX, Math.floor(n)));
}
function clampStepCap(raw) {
  const n = raw == null ? NaN : parseInt(String(raw).replace(/[,_]/g, ""), 10);
  if (!isFinite(n)) return STEPCAP_DEFAULT;
  return Math.max(STEPCAP_MIN, Math.min(STEPCAP_MAX, Math.floor(n)));
}

function detectLychrelProbeCore(s) {
  if (!LY_TARGET.test(s) || !LY_RUN_VERB.test(s)) return { probe: false };
  const bm = s.match(LY_BOUND_RE);
  const sm = s.match(LY_STEPS_RE);
  return {
    probe: true,
    bound: clampBound(bm ? bm[1] : null),
    stepCap: clampStepCap(sm ? sm[1] : null),
    requestedBound: bm ? bm[1] : null,
  };
}

// Long-message discipline (the M1 coda-leak lesson): a pasted brief that happens to
// contain the words in different sentences must not launch a run.
const SHORT_ASK_MAX = 240;
function detectLychrelProbe(message) {
  const s = String(message || "").trim();
  if (s.length < 12) return { probe: false };
  if (s.length <= SHORT_ASK_MAX) return detectLychrelProbeCore(s);
  for (const sent of splitSentences(s)) {
    if (sent.length < 12) continue;
    const d = detectLychrelProbeCore(sent);
    if (d.probe) return d;
  }
  return { probe: false };
}

// ── PURE CORE — the reverse-and-add map (BigInt) ──────────────────────────────
/** reverse the decimal digits of a BigInt (>= 0). reverse(100) -> 1 (BigInt drops leading zeros). */
function reverseBig(v) {
  const s = v.toString();
  let r = "";
  for (let i = s.length - 1; i >= 0; i--) r += s[i];
  return BigInt(r);
}
function isPalindromeBig(v) {
  const s = v.toString();
  for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false;
  return true;
}
function oneStep(v) { return v + reverseBig(v); }

/**
 * Steps of reverse-and-add until n reaches a palindrome, capped at K.
 *   0     -> n is already a palindrome
 *   k>=1  -> reached a palindrome after k reverse-and-add operations
 *   null  -> no palindrome within K steps (suspected Lychrel within this cap)
 * PURE, deterministic. BigInt throughout (iterates grow huge).
 */
function stepsToPalindrome(n, K) {
  let v = typeof n === "bigint" ? n : BigInt(n);
  if (isPalindromeBig(v)) return 0;
  for (let k = 1; k <= K; k++) {
    v = oneStep(v);
    if (isPalindromeBig(v)) return k;
  }
  return null;
}

// ── the census (deterministic single pass) ────────────────────────────────────
/**
 * Census of steps-to-palindrome over n in [1..N], step cap K. Returns aggregates +
 * a per-n step array (Int32Array; -1 = unresolved within K) for the conjecture pass.
 */
function computeCensus(boundRaw, stepCapRaw) {
  const N = clampBound(boundRaw);
  const K = clampStepCap(stepCapRaw);
  const steps = new Int32Array(N + 1);     // steps[n] = k, or -1 unresolved
  const hist = new Map();                   // step count -> how many n
  let resolved = 0, stepSum = 0, stepMax = 0, stepArgmax = 1;
  const unresolved = [];                    // suspected Lychrel seeds (capped)
  let unresolvedCount = 0;
  const records = [];                       // most-delayed palindromes: n -> steps (strictly increasing)
  let runRec = -1;

  for (let n = 1; n <= N; n++) {
    const k = stepsToPalindrome(n, K);
    if (k === null) {
      steps[n] = -1;
      unresolvedCount++;
      if (unresolved.length < SUSPECT_CAP) unresolved.push(n);
      continue;
    }
    steps[n] = k;
    resolved++;
    stepSum += k;
    hist.set(k, (hist.get(k) || 0) + 1);
    if (k > stepMax) { stepMax = k; stepArgmax = n; }
    if (k > runRec) { runRec = k; records.push({ n, steps: k }); }
  }

  return {
    N, K, count: N,
    resolved, unresolvedCount, unresolved,
    step: { sum: stepSum, max: stepMax, argmax: stepArgmax, hist },
    records,
    stepsArr: steps,
  };
}

// ── per-family note content (each <= ~1,500 chars; ledger cap is 2,000) ────────
const NEUTRAL_TAG = "NEUTRAL structural census -- descriptive data about reverse-and-add trajectories up to the bound; NOT a proof, and NOT a claim that any number is or is not Lychrel (that is an OPEN problem).";

function fmt(x, d = 2) { return Number(x).toFixed(d); }
function fmtInt(x) { return Math.round(Number(x)).toLocaleString("en-US"); }

function familyContent(family, c) {
  const head = (name) => `[Reverse-and-add structural probe -- ${name}, R(n)=n+reverse(n), computed deterministically in code for 1 <= n <= ${fmtInt(c.N)}, step cap K=${c.K}] `;

  if (family === "steps_to_palindrome") {
    const top = [...c.step.hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([s, k]) => `${s} step${s === 1 ? "" : "s"}: ${fmt(100 * k / Math.max(1, c.resolved), 1)}%`).join(", ");
    const mean = c.resolved ? c.step.sum / c.resolved : 0;
    return head("steps to reach a palindrome (resolved n only)")
      + `Of ${fmtInt(c.resolved)} resolved n, mean = ${fmt(mean, 3)} steps; max = ${c.step.max} steps at n = ${fmtInt(c.step.argmax)}. `
      + `Most common: ${top}. (Observed up to N only.) ${NEUTRAL_TAG}`;
  }
  if (family === "resolution_census") {
    const pct = fmt(100 * c.resolved / Math.max(1, c.count), 3);
    return head("resolution census (reached a palindrome within K vs not)")
      + `${fmtInt(c.resolved)} of ${fmtInt(c.count)} n (${pct}%) reached a palindrome within K=${c.K} steps; `
      + `${fmtInt(c.unresolvedCount)} did NOT within that cap (suspected Lychrel within this cap -- OPEN, not a proof). ${NEUTRAL_TAG}`;
  }
  if (family === "suspected_lychrel") {
    const list = c.unresolved.slice(0, SUSPECT_CAP).join(", ");
    const more = c.unresolvedCount > c.unresolved.length ? ` (+${fmtInt(c.unresolvedCount - c.unresolved.length)} more)` : "";
    return head("suspected Lychrel seeds (no palindrome within K)")
      + `${fmtInt(c.unresolvedCount)} seeds in [1..${fmtInt(c.N)}] did not reach a palindrome within K=${c.K} steps: ${list}${more}. `
      + `These are SUSPECTED Lychrel within this cap -- whether any ever reaches a palindrome is an OPEN problem (the smallest, 196, is unproven either way). Not a claim. ${NEUTRAL_TAG}`;
  }
  if (family === "record_setters") {
    const tr = c.records.slice(-12).map((r) => `${fmtInt(r.n)}->${r.steps}`).join(", ");
    return head("most-delayed palindromes (record steps-to-palindrome)")
      + `${c.records.length} record-setters; last 12 as n->steps: ${tr}. (A larger n needing strictly more steps than every smaller n.) ${NEUTRAL_TAG}`;
  }
  return null;
}
const ALL_FAMILIES = ["steps_to_palindrome", "resolution_census", "suspected_lychrel", "record_setters"];

// ── M3 generator port: template conjectures, deterministically falsified ───────
// Closed, code-checkable templates over the census's per-n step array. Each is
// FALSIFIED over [1..N]; a survivor is "tested to N, still OPEN", never proven.
function proposeAndFalsify(c) {
  const out = [];
  const N = c.N, steps = c.stepsArr;

  // T1 — "every n <= N reaches a palindrome within K steps". FALSE iff any
  // unresolved seed exists (e.g. 196). Demonstrates honest falsification.
  {
    let counter = null;
    for (let n = 1; n <= N; n++) { if (steps[n] === -1) { counter = n; break; } }
    out.push(counter
      ? { claim: `every n <= ${fmtInt(N)} reaches a palindrome within K=${c.K} reverse-and-add steps`, status: "falsified", counterexample: counter }
      : { claim: `every n <= ${fmtInt(N)} reaches a palindrome within K=${c.K} reverse-and-add steps`, status: "survived" });
  }

  // T2 — a "gap" conjecture: the smallest step-count value s in [1..max] that NO
  // resolved n achieves below N. "no n <= N reaches a palindrome in exactly s
  // steps." Survives to N by construction -> a genuine machine-generated,
  // tested-to-N, still-OPEN claim (could fail beyond N). Null if no gap.
  {
    const present = new Set();
    for (let n = 1; n <= N; n++) { if (steps[n] > 0) present.add(steps[n]); }
    let gap = null;
    for (let s = 1; s <= c.step.max; s++) { if (!present.has(s)) { gap = s; break; } }
    if (gap != null) {
      out.push({ claim: `no n <= ${fmtInt(N)} reaches a palindrome in exactly ${gap} reverse-and-add steps`, status: "survived", note: "tested to N, still open -- could fail beyond N" });
    }
  }

  return out;
}

// ── run + packet ──────────────────────────────────────────────────────────────
/**
 * Execute the census + the conjecture pass. Returns:
 *   packet — the deterministic GROUND-TRUTH block the LLM narrates
 *   notes  — staged notebook writes (NEUTRAL evidence, thread "lychrel")
 * Synchronous, pure CPU/BigInt.
 */
function runLychrelProbes({ bound, stepCap } = {}) {
  const census = computeCensus(bound, stepCap);
  const notes = [];
  const blocks = [];
  for (const f of ALL_FAMILIES) {
    const content = familyContent(f, census);
    if (!content) continue;
    blocks.push(`-- ${f.replace(/_/g, " ").toUpperCase()} --\n${content.slice(0, 1900)}`);
    notes.push({
      kind: "evidence", stance: null, status: null,
      thread: "lychrel", importance: 3,
      content: content.slice(0, 1900),
      metadata: { lychrel_family: f, bound: census.N, step_cap: census.K, neutral: true },
    });
  }

  const conj = proposeAndFalsify(census);
  const conjLines = conj.map((x) =>
    x.status === "falsified"
      ? `  - FALSIFIED: "${x.claim}" -- first counterexample n = ${fmtInt(x.counterexample)} (a suspected Lychrel seed). Honest: the claim is FALSE as stated.`
      : `  - SURVIVED (tested to N, still OPEN, NOT proven): "${x.claim}"${x.note ? ` [${x.note}]` : ""}.`
  ).join("\n");

  const packet = [
    `REVERSE-AND-ADD STRUCTURAL PROBE PACK (the "196"/Lychrel problem) -- COMPUTED DETERMINISTICALLY IN CODE by M8 (not by you) for all 1 <= n <= ${fmtInt(census.N)}, step cap K=${census.K}.`,
    `This is the engine's SECOND problem domain (a structural twin of the Collatz M1 census) -- it shows the same machinery generalizes.`,
    ``,
    blocks.join("\n\n"),
    ``,
    `MACHINE-GENERATED CONJECTURES (deterministically falsified over 1..${fmtInt(census.N)}):`,
    conjLines,
    ``,
    `HONESTY CONTRACT: every figure is ground truth from the code run -- narrate and explain, but do NOT invent figures, do NOT extrapolate beyond n <= ${fmtInt(census.N)} as fact, NEVER state that any number "is Lychrel" or that "all numbers reach a palindrome" (both are OPEN), and present a survived conjecture as "tested to N, still open", never proven. Each family is recorded to the research notebook thread "lychrel" as a neutral evidence entry -- acknowledge that in one short line.`,
  ].join("\n");

  return { packet, notes, bound: census.N, stepCap: census.K, unresolvedCount: census.unresolvedCount };
}

module.exports = {
  detectLychrelProbe, runLychrelProbes, computeCensus,
  // pure core (mirror-tested):
  reverseBig, isPalindromeBig, oneStep, stepsToPalindrome, proposeAndFalsify,
  // exported for tests:
  detectLychrelProbeCore, familyContent, clampBound, clampStepCap,
  LY_TARGET, LY_RUN_VERB, ALL_FAMILIES,
  BOUND_DEFAULT, BOUND_MIN, BOUND_MAX, STEPCAP_DEFAULT, STEPCAP_MAX, SUSPECT_CAP,
};
