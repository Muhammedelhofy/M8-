/**
 * M8 M3-lite Conjecture Generator v2 — lib/conjecture-gen.js  (Build-15, S8)
 *
 * The GENERATOR rung of the ladder (M1 ✅ → M3-lite ✅ → M2 → M3-full,
 * NORTH_STAR REV 2). v2 implements the team round-3 rulings
 * (M8_Team_Round3_Synthesis_2026_06_13.md, design critique in BUILD_15_SPEC.md):
 *
 *   GATE v2 (round-3 Q2, Manus/Gemini ruling): cohort 120 per side; the gate is
 *   the Wilson/Newcombe 95% lower bound of (mined − baseline survival) > 0.
 *   The raw ratio is DEMOTED to a tracked metric. High seed variance now fails
 *   honestly (lower bound below zero) instead of flickering around 2.0×.
 *   The baseline cohort is generated to MATCH the mined cohort's template
 *   composition — Wilson on different template mixes would be a silent bias
 *   (spec critique A1; in nobody's team reply).
 *
 *   MICRO-PROVER pre-falsifier (round-3 Q4, unanimous): zero-variance identity
 *   check + covering-set residue decidability (n mod 2^J, J ≤ 8), applied to
 *   BOTH cohorts before falsification. A claim whose quantity is pinned by
 *   residue arithmetic alone is a provable identity, not a sequence property —
 *   dropped as 'trivial', reported in its own bucket. This GENERALIZES the
 *   Build-14 hand-coded σ-class exclusions (which stay as belt-and-suspenders
 *   but stop growing) — and it correctly retires B_nu_geo wholesale: ν₂(3n+1)
 *   is a function of n mod 2^(k+1), so the geometric law is provable (A2).
 *   Under-kill bias by construction (A3): covering-set fires only on residue-
 *   defined domains, with every bucket ≥3 members on a ≤4096-member slice.
 *
 *   TEMPLATE v1.1 (round-3 Q3): ONE cross-feature conditional template, both
 *   realizations — A_cond_nu_peak ("ν₂ ≥ k ⇒ peak/n ≤ c") and B_cond_peak_nu
 *   ("among peak/n ≥ t, frequency of ν₂=1 ≥ p"). Asymptotic/unbounded shapes
 *   stay excluded by construction (unanimous round-3 reject).
 *
 *   NOVELTY (M2 hook): survivors are checked against the curated literature
 *   seed pack (lib/seed-pack.js, deterministic template/slot comparator —
 *   canonical-form first; the embedding adjacency pass is async and lives in
 *   memory-graph.js). A hit is narrated "matches a known result FORM — the
 *   general form is known mathematics; the specific finite-bound figure is
 *   machine-derived" (A4: never "already proven", never silently novel).
 *
 * HONESTY (unchanged, load-bearing):
 *   - Survivors are "machine-generated, survived falsification up to N" —
 *     NEVER interesting/promising/established (round-2 Q1 lock).
 *   - The gate measures GENERATION QUALITY, not truth. The packet says so and
 *     REQUIRES the verdict (rates + lower bound) in the reply.
 *   - Margins/tolerances FIXED in code; one falsifier path for both cohorts.
 *   - v2 runs are stamped gen v2 (packet) + m3_gen_version 2 (metadata): the
 *     same seed gives different output than Build-14 — never compare silently (A9).
 *
 * CONTAMINATION GUARDS (memory-graph.js): own thread collatz-m3, node status
 * tested_to_<N>, MACHINE-GENERATED recall labels, persistence cap.
 *
 * Pure functions; sync CPU; fails safe (detection returns {gen:false}).
 */
const { parseBoundToNumber, splitSentences } = require("./discovery");
const { computeFeatureTable } = require("./collatz-probes");
// Fail-safe require: a broken seed-pack JSON must degrade novelty labeling to
// "no matches", never take the orchestrator down with it (this module loads at
// /api/chat cold start).
let seedKnownMatch = () => null;
try { seedKnownMatch = require("./seed-pack").seedKnownMatch; } catch (e) {
  console.error("[M8] seed-pack unavailable (non-fatal, novelty labels off):", e.message);
}

// ── tunables (FIXED — not run-tunable; spec critique A1 of Build-14) ──────────
const GEN_VERSION   = 2;        // generation/falsification/gate — UNCHANGED in M3-full
const NOVELTY_VERSION = 1;      // M3-full (Build-16): novelty-aware PERSISTENCE layer
                                // (down-rank known-form survivors). Generation is
                                // byte-identical to gen v2 for a given seed; only the
                                // persisted top-N ORDER can change, so this is stamped
                                // separately (the A9 "never compare silently" rule —
                                // GEN_VERSION does NOT move, because the gate did not).
const TEST_DEFAULT  = 100000;
const TEST_MIN      = 20000;
const TEST_MAX      = 300000;   // exhaustive falsification stays sub-second here
const TRAIN_CAP     = 20000;    // train = min(test/10, TRAIN_CAP) — strict prefix
const COHORT_SIZE   = 120;      // v2 (round-3 Q2): big enough for honest Wilson CIs
const M3_MAX_SURVIVORS = 5;     // persistence cap per run (spam guard)
const SEED_DEFAULT  = 1337;
const WILSON_Z      = 1.96;     // 95% two-sided

// Fixed margins (Type A) / tolerances (Type B) — identical for every run.
const MARGIN_FACTOR   = 1.10;   // Type A: claimed c = train max × 1.10
const B_FREQ_SLACK_PP = 0.5;    // Type B: claimed p = train freq − 0.5pp
const B_GAP_FACTOR    = 0.5;    // Type B: claimed gap = train gap × 0.5
const B_NU_EPS_PP     = 0.25;   // Type B: |observed − 2^-k| ≤ 0.25pp

// ── detection (unchanged from Build-14 — live-verified routing boundary) ──────
const M3_TARGET = /\b(?:collatz|3n\s*\+\s*1|3x\s*\+\s*1)\b/i;
const M3_GEN_RE = /\b(?:conjecture\s+generat(?:or|ion)|generate\s+(?:some\s+|new\s+|\d+\s+)?conjectures?|m3[-\s]?lite|m3\s+(?:generator|run)|run\s+m3)\b/i;
const M3_RUN_VERB = /\b(?:run|generate|execute|launch|fire|start|kick\s+off)\b/i;
const M3_BOUND_RE = /\b(?:up\s+to|below|under|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|thousand|k|m))?|10\s*\^\s*\d+|\d[eE]\d+|2\s*\^\s*\d+)\b/i;
const M3_SEED_RE  = /\bseed\s+(\d{1,9})\b/i;

function clampTestBound(raw) {
  const n = parseBoundToNumber(raw);
  if (n == null || !isFinite(n)) return TEST_DEFAULT;
  return Math.max(TEST_MIN, Math.min(TEST_MAX, Math.floor(n)));
}

function detectConjectureGenCore(s) {
  if (!M3_TARGET.test(s) || !M3_GEN_RE.test(s) || !M3_RUN_VERB.test(s)) return { gen: false };
  const bm = s.match(M3_BOUND_RE);
  const sm = s.match(M3_SEED_RE);
  return {
    gen: true,
    testBound: clampTestBound(bm ? bm[1] : null),
    seed: sm ? (parseInt(sm[1], 10) >>> 0) || SEED_DEFAULT : SEED_DEFAULT,
  };
}

// Same long-message discipline as detectDiscovery / detectStructuralProbe (the
// S6 coda-leak lesson): a pasted brief mentioning "collatz", "generate" and
// "conjectures" across different sentences must not launch a run.
const SHORT_ASK_MAX = 240;
function detectConjectureGen(message) {
  const s = String(message || "").trim();
  if (s.length < 12) return { gen: false };
  if (s.length <= SHORT_ASK_MAX) return detectConjectureGenCore(s);
  for (const sent of splitSentences(s)) {
    if (sent.length < 12) continue;
    const d = detectConjectureGenCore(sent);
    if (d.gen) return d;
  }
  return { gen: false };
}

// ── seeded PRNG (mulberry32 — deterministic, reproducible runs) ───────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// ── parameter domains (shared by mining AND baseline — same shapes) ───────────
// v2: expanded so 120 UNIQUE mined statements exist (mined constants are
// deterministic per (template, slots) — Build-14 domains topped out near 80,
// which made the locked n=120 arithmetically impossible; spec critique A1).
const MODS      = [3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 18];
const NU_KS     = [2, 3, 4, 5, 6, 7];
const SIGMA_TS  = [3, 5, 8, 12, 16, 20, 30];
const PEAK_ES   = [1.5, 2, 2.5, 3, 3.5, 4];
const LOG_AS    = [4, 6, 8, 10, 12, 14, 16, 20];
const PEAK_RATIO_TS = [2, 5, 10, 20];   // B_cond_peak_nu condition thresholds

// Residue classes for σ/σ∞/ν₂ templates must contain odd n (an all-even class
// makes σ trivially 1). m odd → mixed class, fine; m even → r must be odd.
function classHasOdd(m, r) { return m % 2 === 1 || r % 2 === 1; }

// Build-14 hand exclusion (kept as belt-and-suspenders; the micro-prover now
// catches this class automatically): n ≡ 1 (mod 4) has σ(n) = 3 PROVABLY, so
// σ-templates must not draw classes whose residue pins n ≡ 1 (mod 4).
function sigmaClassNontrivial(m, r) {
  return classHasOdd(m, r) && !(m % 4 === 0 && r % 4 === 1);
}

function fmtNum(x) {
  return Number.isInteger(x) ? x.toLocaleString("en-US") : Number(x).toFixed(2);
}

// ── canonical statements (the graph dedup key — keep deterministic) ───────────
function statementFor(t) {
  const N = fmtNum(t.N);
  switch (t.template) {
    case "A_res_sigma_max": return `for all n <= ${N} with n = ${t.r} (mod ${t.m}): stopping time sigma(n) <= ${t.c}`;
    case "A_res_total_max": return `for all n <= ${N} with n = ${t.r} (mod ${t.m}): total stopping time sigma_inf(n) <= ${t.c}`;
    case "A_nu_total_max":  return `for all odd n <= ${N} with nu2(3n+1) >= ${t.k}: total stopping time sigma_inf(n) <= ${t.c}`;
    case "A_total_log":     return `for all 2 <= n <= ${N}: sigma_inf(n) <= ${t.a}*log2(n) + ${t.b}`;
    case "A_peak_power":    return `for all 2 <= n <= ${N}: max excursion peak(n) <= ${fmtNum(t.c)}*n^${t.e}`;
    case "A_cond_nu_peak":  return `for all odd n <= ${N} with nu2(3n+1) >= ${t.k}: max excursion peak(n) <= ${fmtNum(t.c)}*n`;
    case "B_sigma_freq":    return `at least ${t.p.toFixed(2)}% of n <= ${N} have stopping time sigma(n) <= ${t.t}`;
    case "B_res_total_gap": return `mean total stopping time over n = ${t.r1} (mod ${t.m}) exceeds the mean over n = ${t.r2} (mod ${t.m}) by at least ${t.d.toFixed(2)} steps, for n <= ${N}`;
    case "B_nu_geo":        return `the fraction of odd n <= ${N} with nu2(3n+1) = ${t.k} is within ${t.eps.toFixed(2)}pp of 2^-${t.k} (${(100 / Math.pow(2, t.k)).toFixed(2)}%)`;
    case "B_cond_peak_nu":  return `among odd n <= ${N} with peak(n)/n >= ${t.t}, the frequency of nu2(3n+1) = 1 is at least ${t.p.toFixed(2)}%`;
    default: return null;
  }
}

const FEATURES = {
  A_res_sigma_max: ["stopping_time", "residue_census"],
  A_res_total_max: ["total_stopping_time", "residue_census"],
  A_nu_total_max:  ["two_adic", "total_stopping_time"],
  A_total_log:     ["total_stopping_time", "record_setters"],
  A_peak_power:    ["max_excursion", "record_setters"],
  A_cond_nu_peak:  ["two_adic", "max_excursion"],
  B_sigma_freq:    ["stopping_time", "residue_census"],
  B_res_total_gap: ["total_stopping_time", "residue_census"],
  B_nu_geo:        ["two_adic", "residue_census"],
  B_cond_peak_nu:  ["max_excursion", "two_adic"],
};

// ── train-census helpers (mined constants come ONLY from n ≤ trainN) ──────────
function trainClassMax(ft, trainN, m, r, which) {
  let mx = 0;
  for (let n = 2; n <= trainN; n++) if (n % m === r) {
    const v = which === "sigma" ? ft.sigma[n] : ft.total[n];
    if (v > mx) mx = v;
  }
  return mx;
}
function trainNuTotalMax(ft, trainN, k) {
  let mx = 0;
  for (let n = 3; n <= trainN; n += 2) if (ft.nu[n] >= k && ft.total[n] > mx) mx = ft.total[n];
  return mx;
}
function trainSigmaFreq(ft, trainN, t) {
  let c = 0;
  for (let n = 2; n <= trainN; n++) if (ft.sigma[n] <= t) c++;
  return (100 * c) / (trainN - 1);
}
function trainClassMean(ft, trainN, m, r) {
  let s = 0, c = 0;
  for (let n = 2; n <= trainN; n++) if (n % m === r) { s += ft.total[n]; c++; }
  return c ? s / c : 0;
}
function trainCondPeakMax(ft, trainN, k) {
  let mx = 0;
  for (let n = 3; n <= trainN; n += 2) if (ft.nu[n] >= k) {
    const ratio = ft.peak[n] / n;
    if (ratio > mx) mx = ratio;
  }
  return mx;
}
function trainCondNuFreq(ft, trainN, t) {
  let cnt = 0, dom = 0;
  for (let n = 3; n <= trainN; n += 2) if (ft.peak[n] / n >= t) {
    dom++;
    if (ft.nu[n] === 1) cnt++;
  }
  return dom >= 50 ? (100 * cnt) / dom : null;   // thin train domain → no claim
}

// ── candidate construction ────────────────────────────────────────────────────
// makeCandidate fills the claim constant either from the TRAIN census (mined)
// or blind from a generic domain (baseline). Identical templates + structural
// slots both ways — only the constants differ (the gate measures exactly that).
function makeCandidate(template, rnd, ft, trainN, testN, mined) {
  const t = { template, N: testN, type: template[0] === "A" ? "A" : "B" };
  switch (template) {
    case "A_res_sigma_max":
    case "A_res_total_max": {
      t.m = pick(rnd, MODS);
      const admit = template === "A_res_sigma_max" ? sigmaClassNontrivial : classHasOdd;
      const rs = [];
      for (let r = 0; r < t.m; r++) if (admit(t.m, r)) rs.push(r);
      t.r = pick(rnd, rs);
      const which = template === "A_res_sigma_max" ? "sigma" : "total";
      t.c = mined
        ? Math.ceil(trainClassMax(ft, trainN, t.m, t.r, which) * MARGIN_FACTOR)
        : Math.floor(rnd() * (which === "sigma" ? 120 : 350)) + 1;
      break;
    }
    case "A_nu_total_max": {
      t.k = pick(rnd, NU_KS);
      t.c = mined
        ? Math.ceil(trainNuTotalMax(ft, trainN, t.k) * MARGIN_FACTOR)
        : Math.floor(rnd() * 350) + 1;
      break;
    }
    case "A_total_log": {
      t.a = pick(rnd, LOG_AS);
      if (mined) {
        let need = -Infinity;
        for (let n = 2; n <= trainN; n++) {
          const gap = ft.total[n] - t.a * Math.log2(n);
          if (gap > need) need = gap;
        }
        t.b = Math.ceil(need * MARGIN_FACTOR + 1);
      } else {
        t.b = Math.floor(rnd() * 120) - 20;
      }
      break;
    }
    case "A_peak_power": {
      t.e = pick(rnd, PEAK_ES);
      if (mined) {
        let need = 0;
        for (let n = 2; n <= trainN; n++) {
          const ratio = ft.peak[n] / Math.pow(n, t.e);
          if (ratio > need) need = ratio;
        }
        t.c = Math.ceil(need * MARGIN_FACTOR * 100) / 100;
      } else {
        t.c = Math.ceil(rnd() * 50 * 100) / 100 / 10; // 0.01 .. 5.00 blind
      }
      break;
    }
    case "A_cond_nu_peak": {   // v1.1 cross-feature conditional (round-3 Q3)
      t.k = pick(rnd, NU_KS);
      if (mined) {
        const need = trainCondPeakMax(ft, trainN, t.k);
        if (need <= 0) return null;          // empty train domain → no claim
        t.c = Math.ceil(need * MARGIN_FACTOR * 100) / 100;
      } else {
        t.c = Math.ceil(rnd() * 200 * 100) / 100 / 10; // 0.01 .. 20.00 blind
      }
      break;
    }
    case "B_sigma_freq": {
      t.t = pick(rnd, SIGMA_TS);
      t.p = mined
        ? Math.max(0.1, trainSigmaFreq(ft, trainN, t.t) - B_FREQ_SLACK_PP)
        : Math.floor(rnd() * 9900) / 100 + 1; // 1.00 .. 99.99 blind
      break;
    }
    case "B_res_total_gap": {
      t.m = pick(rnd, MODS);
      t.r1 = Math.floor(rnd() * t.m);
      t.r2 = (t.r1 + 1 + Math.floor(rnd() * (t.m - 1))) % t.m;
      if (mined) {
        const gap = trainClassMean(ft, trainN, t.m, t.r1) - trainClassMean(ft, trainN, t.m, t.r2);
        if (gap <= 0.5) return null;        // no real train gap → no claim (not a vacuous one)
        t.d = Math.round(gap * B_GAP_FACTOR * 100) / 100;
      } else {
        t.d = Math.round((rnd() * 30 + 0.5) * 100) / 100;
      }
      break;
    }
    case "B_nu_geo": {
      t.k = pick(rnd, NU_KS);
      t.eps = B_NU_EPS_PP;                  // fixed both ways — k is the only slot
      if (!mined && rnd() < 0.5) t.eps = Math.round(rnd() * 5 * 100) / 100 + 0.01;
      break;
    }
    case "B_cond_peak_nu": {   // v1.1 cross-feature conditional, B realization
      t.t = pick(rnd, PEAK_RATIO_TS);
      if (mined) {
        const f = trainCondNuFreq(ft, trainN, t.t);
        if (f == null) return null;          // thin train domain → no claim
        t.p = Math.max(0.1, f - B_FREQ_SLACK_PP);
      } else {
        t.p = Math.floor(rnd() * 9900) / 100 + 1;
      }
      break;
    }
    default: return null;
  }
  t.mined = !!mined;
  t.statement = statementFor(t);
  t.features = FEATURES[template];
  if (!t.statement) return null;
  return t;
}

const TEMPLATES = Object.keys(FEATURES);

// v2 cohort generation (spec critique A1). Mined: exhaustion-safe round-robin —
// a template that can't yield a NEW unique statement after FAIL_LIMIT straight
// attempts is retired (mined statements are deterministic per slot tuple, so
// small-domain templates exhaust well before 120/10 each). Baseline: generated
// to MATCH the mined cohort's template composition exactly — Wilson on two
// different template mixes would silently bias the gate.
const FAIL_LIMIT = 25;
function generateMinedCohort(rnd, ft, trainN, testN, count) {
  const out = [];
  const seen = new Set();
  const fails = new Map(TEMPLATES.map((t) => [t, 0]));
  const active = new Set(TEMPLATES);
  let ti = 0;
  let spins = 0;
  while (out.length < count && active.size && spins++ < count * 60) {
    const template = TEMPLATES[ti % TEMPLATES.length];
    ti++;
    if (!active.has(template)) continue;
    const c = makeCandidate(template, rnd, ft, trainN, testN, true);
    if (!c || seen.has(c.statement)) {
      fails.set(template, fails.get(template) + 1);
      if (fails.get(template) >= FAIL_LIMIT) active.delete(template);
      continue;
    }
    fails.set(template, 0);
    seen.add(c.statement);
    out.push(c);
  }
  return out;
}
function generateMatchedBaseline(rnd, ft, trainN, testN, allocation) {
  const out = [];
  const seen = new Set();
  for (const template of allocation) {
    let made = null;
    for (let a = 0; a < 40 && !made; a++) {
      const c = makeCandidate(template, rnd, ft, trainN, testN, false);
      if (c && !seen.has(c.statement)) made = c;
    }
    if (made) { seen.add(made.statement); out.push(made); }
  }
  return out;
}

// ── MICRO-PROVER pre-falsifier (round-3 Q4 — Gemini zero-variance + Grok/Manus
// covering-set, merged). A candidate whose claim-relevant quantity is pinned by
// residue arithmetic alone (constant, or constant within every n mod 2^J bucket
// over a residue-DEFINED domain) is a provable structural identity — it says
// nothing about Collatz dynamics and is dropped before falsification, BOTH
// cohorts. Under-kill bias (spec A3): big slice, ≥3 members per bucket, and the
// covering-set test never fires on dynamics-defined domains (B_cond_peak_nu's
// "peak/n ≥ t" — there the VALUE may be residue-pinned but the claim is about
// the domain's composition, which residue arithmetic does not decide).
// The ×2-invariance idea folds into the mod-2^J partition (it IS the 2-adic
// structure); no separate check.
const MP_SLICE_CAP  = 4096;
const MP_MIN_SLICE  = 16;
const MP_J_MAX      = 8;
const MP_MIN_BUCKET = 3;

// Domain + claim-relevant quantity per template, over n ≤ trainN (train side is
// enough: an identity that holds structurally shows up on any honest slice).
// residueDomain marks domains that are unions of residue classes — the
// precondition for the covering-set inference to be sound.
function domainSlice(c, ft, trainN) {
  const ns = [], vals = [];
  const push = (n, v) => { if (ns.length < MP_SLICE_CAP) { ns.push(n); vals.push(v); } };
  switch (c.template) {
    case "A_res_sigma_max":
      for (let n = 2; n <= trainN && ns.length < MP_SLICE_CAP; n++) if (n % c.m === c.r) push(n, ft.sigma[n]);
      return { ns, vals, residueDomain: true };
    case "A_res_total_max":
      for (let n = 2; n <= trainN && ns.length < MP_SLICE_CAP; n++) if (n % c.m === c.r) push(n, ft.total[n]);
      return { ns, vals, residueDomain: true };
    case "A_nu_total_max":
      for (let n = 3; n <= trainN && ns.length < MP_SLICE_CAP; n += 2) if (ft.nu[n] >= c.k) push(n, ft.total[n]);
      return { ns, vals, residueDomain: true };   // ν₂≥k ⇔ a residue class mod 2^k
    case "A_total_log":
      for (let n = 2; n <= trainN && ns.length < MP_SLICE_CAP; n++) push(n, ft.total[n]);
      return { ns, vals, residueDomain: true };
    case "A_peak_power":
      for (let n = 2; n <= trainN && ns.length < MP_SLICE_CAP; n++) push(n, ft.peak[n] / Math.pow(n, c.e));
      return { ns, vals, residueDomain: true };
    case "A_cond_nu_peak":
      for (let n = 3; n <= trainN && ns.length < MP_SLICE_CAP; n += 2) if (ft.nu[n] >= c.k) push(n, ft.peak[n] / n);
      return { ns, vals, residueDomain: true };
    case "B_sigma_freq":
      for (let n = 2; n <= trainN && ns.length < MP_SLICE_CAP; n++) push(n, ft.sigma[n] <= c.t ? 1 : 0);
      return { ns, vals, residueDomain: true };
    case "B_nu_geo":
      for (let n = 3; n <= trainN && ns.length < MP_SLICE_CAP; n += 2) push(n, ft.nu[n] === c.k ? 1 : 0);
      return { ns, vals, residueDomain: true };
    case "B_cond_peak_nu":
      for (let n = 3; n <= trainN && ns.length < MP_SLICE_CAP; n += 2) if (ft.peak[n] / n >= c.t) push(n, ft.nu[n] === 1 ? 1 : 0);
      return { ns, vals, residueDomain: false };  // dynamics-defined domain
    default:
      return null;   // B_res_total_gap handled by its own two-class rule below
  }
}

function residueDecided(ns, vals, residueDomain) {
  if (!ns || ns.length < MP_MIN_SLICE) return { trivial: false };
  // 1) zero-variance: the quantity is CONSTANT on its domain — a structural
  //    identity independent of dynamics (the σ=3 on n≡1 mod 4 class dies here).
  let constant = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[0]) { constant = false; break; }
  if (constant) return { trivial: true, reason: "zero_variance" };
  // 2) covering-set: constant within EVERY n mod 2^J bucket (sound only when
  //    the domain itself is residue-defined).
  if (!residueDomain) return { trivial: false };
  for (let J = 1; J <= MP_J_MAX; J++) {
    const mod = 1 << J;
    const bv = new Map(), bc = new Map();
    let ok = true;
    for (let i = 0; i < ns.length; i++) {
      const b = ns[i] % mod;
      if (!bv.has(b)) { bv.set(b, vals[i]); bc.set(b, 1); }
      else {
        if (bv.get(b) !== vals[i]) { ok = false; break; }
        bc.set(b, bc.get(b) + 1);
      }
    }
    if (!ok) continue;                       // some bucket varies → try finer J
    let occupied = true;
    for (const cnt of bc.values()) if (cnt < MP_MIN_BUCKET) { occupied = false; break; }
    if (!occupied) break;                    // buckets too thin — finer J only thinner
    if (bv.size >= 2) return { trivial: true, reason: `covering_set_mod_2^${J}` };
  }
  return { trivial: false };
}

function microProve(c, ft, trainN) {
  if (c.template === "B_res_total_gap") {
    // trivial only if σ∞ is residue-decided on BOTH classes (then the gap is a
    // finite residue computation). σ∞ is dynamics-dependent — expected never.
    const s1 = { ns: [], vals: [] }, s2 = { ns: [], vals: [] };
    for (let n = 2; n <= trainN && (s1.ns.length < MP_SLICE_CAP || s2.ns.length < MP_SLICE_CAP); n++) {
      if (n % c.m === c.r1 && s1.ns.length < MP_SLICE_CAP) { s1.ns.push(n); s1.vals.push(ft.total[n]); }
      else if (n % c.m === c.r2 && s2.ns.length < MP_SLICE_CAP) { s2.ns.push(n); s2.vals.push(ft.total[n]); }
    }
    const d1 = residueDecided(s1.ns, s1.vals, true);
    const d2 = residueDecided(s2.ns, s2.vals, true);
    return d1.trivial && d2.trivial
      ? { trivial: true, reason: `${d1.reason}+${d2.reason}` }
      : { trivial: false };
  }
  const slice = domainSlice(c, ft, trainN);
  if (!slice) return { trivial: false };
  return residueDecided(slice.ns, slice.vals, slice.residueDomain);
}

// ── falsifier (one code path for both cohorts) ────────────────────────────────
// Type A: scan the full test range; first violating n is recorded and kills.
// Survivors also report cNeed — the minimal constant that would still survive —
// so the vacuity floor below can compare claim vs observed reality.
// Type B: exhaustive count over the full test range; the observed value is
// recorded either way (survivor margin = how close the claim ran).
function falsify(c, ft, testN) {
  switch (c.template) {
    case "A_res_sigma_max":
    case "A_res_total_max": {
      const arr = c.template === "A_res_sigma_max" ? ft.sigma : ft.total;
      let mx = 0;
      for (let n = 2; n <= testN; n++) if (n % c.m === c.r) {
        if (arr[n] > c.c) return { killed: true, counterexample: n, observed: arr[n] };
        if (arr[n] > mx) mx = arr[n];
      }
      return { killed: false, cNeed: mx };
    }
    case "A_nu_total_max": {
      let mx = 0;
      for (let n = 3; n <= testN; n += 2) if (ft.nu[n] >= c.k) {
        if (ft.total[n] > c.c) return { killed: true, counterexample: n, observed: ft.total[n] };
        if (ft.total[n] > mx) mx = ft.total[n];
      }
      return { killed: false, cNeed: mx };
    }
    case "A_total_log": {
      let need = -Infinity;
      for (let n = 2; n <= testN; n++) {
        if (ft.total[n] > c.a * Math.log2(n) + c.b)
          return { killed: true, counterexample: n, observed: ft.total[n] };
        const gap = ft.total[n] - c.a * Math.log2(n);
        if (gap > need) need = gap;
      }
      return { killed: false, cNeed: need };
    }
    case "A_peak_power": {
      let need = 0;
      for (let n = 2; n <= testN; n++) {
        if (ft.peak[n] > c.c * Math.pow(n, c.e))
          return { killed: true, counterexample: n, observed: ft.peak[n] };
        const ratio = ft.peak[n] / Math.pow(n, c.e);
        if (ratio > need) need = ratio;
      }
      return { killed: false, cNeed: need };
    }
    case "A_cond_nu_peak": {
      let need = 0;
      for (let n = 3; n <= testN; n += 2) if (ft.nu[n] >= c.k) {
        const ratio = ft.peak[n] / n;
        if (ratio > c.c) return { killed: true, counterexample: n, observed: ft.peak[n] };
        if (ratio > need) need = ratio;
      }
      return { killed: false, cNeed: need };
    }
    case "B_sigma_freq": {
      let cnt = 0;
      for (let n = 2; n <= testN; n++) if (ft.sigma[n] <= c.t) cnt++;
      const obs = (100 * cnt) / (testN - 1);
      return obs >= c.p ? { killed: false, observed: obs } : { killed: true, observed: obs };
    }
    case "B_res_total_gap": {
      let s1 = 0, c1 = 0, s2 = 0, c2 = 0;
      for (let n = 2; n <= testN; n++) {
        if (n % c.m === c.r1) { s1 += ft.total[n]; c1++; }
        else if (n % c.m === c.r2) { s2 += ft.total[n]; c2++; }
      }
      if (!c1 || !c2) return { killed: true, observed: 0, vacuous: true };
      const gap = s1 / c1 - s2 / c2;
      return gap >= c.d ? { killed: false, observed: gap } : { killed: true, observed: gap };
    }
    case "B_nu_geo": {
      let cnt = 0, odd = 0;
      for (let n = 3; n <= testN; n += 2) { if (ft.nu[n] === c.k) cnt++; odd++; }
      const obs = (100 * cnt) / odd;
      const dev = Math.abs(obs - 100 / Math.pow(2, c.k));
      return dev <= c.eps ? { killed: false, observed: obs, deviation: dev }
                          : { killed: true, observed: obs, deviation: dev };
    }
    case "B_cond_peak_nu": {
      let cnt = 0, dom = 0;
      for (let n = 3; n <= testN; n += 2) if (ft.peak[n] / n >= c.t) {
        dom++;
        if (ft.nu[n] === 1) cnt++;
      }
      if (!dom) return { killed: true, observed: 0, vacuous: true };
      const obs = (100 * cnt) / dom;
      return obs >= c.p ? { killed: false, observed: obs, domain: dom }
                        : { killed: true, observed: obs, domain: dom };
    }
    default: return { killed: true, invalid: true };
  }
}

// ── vacuity floor (round-2 Q3: survival is gameable by trivial-slack claims) ──
// FIXED constants, applied to BOTH cohorts identically: vacuous survivors are
// excluded from survival counts, the gate, and persistence.
const VACUITY_RATIO  = 1.5;   // Type A: claimed c > needed c × 1.5 → vacuous
const VAC_LOG_SLACK  = 30;    // A_total_log: b − needed b > 30 → vacuous
const VAC_FREQ_PP    = 5;     // B freq claims: observed − claimed p > 5pp → vacuous
const VAC_GAP_RATIO  = 4;     // B_res_total_gap: observed gap > claimed d × 4 → vacuous
const VAC_NU_EPS_PP  = 1.0;   // B_nu_geo: tolerance wider than 1pp → vacuous

function isVacuous(c, res) {
  if (res.killed) return false;
  switch (c.template) {
    case "A_res_sigma_max":
    case "A_res_total_max":
    case "A_nu_total_max": return c.c > Math.max(res.cNeed, 1) * VACUITY_RATIO;
    case "A_total_log":    return c.b - res.cNeed > VAC_LOG_SLACK;
    case "A_peak_power":
    case "A_cond_nu_peak": return c.c > Math.max(res.cNeed, 1e-6) * VACUITY_RATIO;
    case "B_sigma_freq":
    case "B_cond_peak_nu": return (res.observed || 0) - c.p > VAC_FREQ_PP;
    case "B_res_total_gap": return (res.observed || 0) > c.d * VAC_GAP_RATIO;
    case "B_nu_geo":       return c.eps > VAC_NU_EPS_PP;
    default: return false;
  }
}

// ── GATE v2 statistics (round-3 Q2 — Wilson per cohort, Newcombe difference) ──
function wilsonCI(k, n, z = WILSON_Z) {
  if (!n) return { lo: 0, hi: 0 };
  const p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}
// 95% lower bound of (p1 − p2), Newcombe's score-interval method.
function newcombeDiffLower(k1, n1, k2, n2, z = WILSON_Z) {
  const p1 = n1 ? k1 / n1 : 0, p2 = n2 ? k2 / n2 : 0;
  const w1 = wilsonCI(k1, n1, z), w2 = wilsonCI(k2, n2, z);
  return (p1 - p2) - Math.sqrt(Math.pow(p1 - w1.lo, 2) + Math.pow(w2.hi - p2, 2));
}

// Survivor ranking: template diversity first (one per template before seconds),
// then tightest margin — tighter claims carry more information.
function marginOf(c, res) {
  if (c.type === "B") {
    if (c.template === "B_nu_geo") return (c.eps - (res.deviation || 0));
    return Math.abs((res.observed || 0) - (c.p != null ? c.p : c.d));
  }
  return c.c != null ? c.c : (c.b != null ? c.b : 0); // smaller constant = tighter
}
function rankWithinGroup(survivors) {
  const byTemplate = new Map();
  for (const s of survivors) {
    if (!byTemplate.has(s.c.template)) byTemplate.set(s.c.template, []);
    byTemplate.get(s.c.template).push(s);
  }
  for (const arr of byTemplate.values()) arr.sort((a, b) => marginOf(a.c, a.res) - marginOf(b.c, b.res));
  const out = [];
  let round = 0;
  while (out.length < survivors.length) {
    let added = false;
    for (const arr of byTemplate.values()) {
      if (arr[round]) { out.push(arr[round]); added = true; }
    }
    if (!added) break;
    round++;
  }
  return out;
}

// M3-full (Build-16) — NOVELTY-AWARE PERSISTENCE. A survivor whose FORM matches
// the curated literature seed pack (`s.known`, set by the caller via
// seedKnownMatch) is DOWN-RANKED below every unmatched survivor. Live runs survive
// ~20+ candidates against a persistence cap of M3_MAX_SURVIVORS, so when the cap
// bites the notebook slots go to candidates with NO match in our pack rather than
// to re-derivations of (e.g.) Terras-form stopping-time density facts.
//
// LOAD-BEARING INVARIANTS:
//   • This NEVER touches survival, the gate, or the baseline — gate v2 owns
//     survival (Wilson/Newcombe over full cohorts), the micro-prover owns provable
//     exclusion symmetrically on BOTH cohorts. Novelty is a PRESENTATION/persistence
//     concern only (kickoff open-Q3 ruling), so it cannot reintroduce the template-
//     composition bias gate v2 was built to kill (spec A1).
//   • A down-ranked survivor is STILL reported in the packet WITH its known-form
//     label — nothing is hidden; only the persisted ORDER changes.
//   • Ranking is a spam-cap heuristic, NEVER a novelty or truth verdict (a top-
//     ranked survivor is not "more novel" or "more true" — see the honesty contract).
// When `s.known` is unset (e.g. a direct test call) every survivor is "unmatched",
// so the ordering is identical to the gen-v2 round-robin.
function rankSurvivors(survivors) {
  const unmatched = survivors.filter((s) => !s.known);
  const known     = survivors.filter((s) => s.known);
  return [...rankWithinGroup(unmatched), ...rankWithinGroup(known)];
}

// ── run + packet ──────────────────────────────────────────────────────────────
const M3_THREAD = "collatz-m3";
const M3_TAG = "machine-generated conjecture from M8's M3-lite generator — survived deterministic falsification, NOT established, NOT literature, NOT verified beyond the stated bound";

/**
 * Execute one full M3-lite v2 run. Returns:
 *   packet — deterministic GROUND-TRUTH block the LLM narrates
 *   notes  — staged notebook writes (≤ M3_MAX_SURVIVORS conjecture notes to
 *            thread collatz-m3 + one status summary), persisted at STORE
 *   gate   — { pass, minedRate, baselineRate, diffLower95, ratio (metric) }
 */
function runConjectureGen({ testBound, seed } = {}) {
  const testN = clampTestBound(testBound);
  const ft = computeFeatureTable(testN);
  const N = ft.N;                                 // honest range on overflow
  const trainN = Math.min(Math.floor(N / 10), TRAIN_CAP);
  const usedSeed = (seed >>> 0) || SEED_DEFAULT;

  const rndMined = mulberry32(usedSeed);
  const rndBase  = mulberry32(usedSeed ^ 0x9E3779B9);   // decorrelated baseline stream

  const mined    = generateMinedCohort(rndMined, ft, trainN, N, COHORT_SIZE);
  const baseline = generateMatchedBaseline(rndBase, ft, trainN, N, mined.map((c) => c.template));

  // pipeline per candidate: micro-prover → falsifier → vacuity floor.
  const evalCohort = (cands) => cands.map((c) => {
    const mp = microProve(c, ft, trainN);
    if (mp.trivial) return { c, res: { killed: true, trivial: true }, trivial: true, trivialReason: mp.reason };
    const res = falsify(c, ft, N);
    return { c, res, vacuous: isVacuous(c, res) };
  });
  const minedRes = evalCohort(mined);
  const baseRes  = evalCohort(baseline);

  // survival = not trivial, not falsified, not vacuous — full cohort stays the
  // denominator (the vacuity-floor precedent: drops never shrink n).
  const minedSurv = minedRes.filter((x) => !x.trivial && !x.res.killed && !x.vacuous);
  const baseSurv  = baseRes.filter((x) => !x.trivial && !x.res.killed && !x.vacuous);
  const minedVac  = minedRes.filter((x) => !x.trivial && !x.res.killed && x.vacuous).length;
  const baseVac   = baseRes.filter((x) => !x.trivial && !x.res.killed && x.vacuous).length;
  const minedTriv = minedRes.filter((x) => x.trivial).length;
  const baseTriv  = baseRes.filter((x) => x.trivial).length;
  const minedRate = mined.length ? minedSurv.length / mined.length : 0;
  const baseRate  = baseline.length ? baseSurv.length / baseline.length : 0;

  // GATE v2: Wilson/Newcombe 95% lower bound of the survival difference > 0.
  // The raw ratio is a TRACKED METRIC only (round-3 Q2 demotion).
  const diffLower95 = newcombeDiffLower(minedSurv.length, mined.length, baseSurv.length, baseline.length);
  const gatePass = minedSurv.length >= 1 && diffLower95 > 0;
  const ratio = baseRate > 0 ? minedRate / baseRate : (minedRate > 0 ? Infinity : 0);

  // M2/M3-full novelty gate v1 — deterministic pass (canonical form / template+
  // slots vs the curated literature seed pack). A hit means the FORM is known
  // mathematics; the finite-bound figure is still machine-derived. Fail-safe: no
  // pack, no labels. We tag every SURVIVOR (never the baseline, never pre-gate) so
  // rankSurvivors can DOWN-RANK known-form matches in persistence — survival, the
  // gate, and the matched baseline are all left exactly as gate v2 computed them.
  const knownOf = (c) => { try { return seedKnownMatch(c); } catch (_) { return null; } };
  minedSurv.forEach((x) => { x.known = knownOf(x.c); });
  const minedKnown = minedSurv.filter((x) => x.known).length;

  const ranked = rankSurvivors(minedSurv).slice(0, M3_MAX_SURVIVORS);

  // staged notes — survivors only (the falsified majority is packet-reported,
  // never persisted: kills are the product, not ledger spam)
  const notes = ranked.map(({ c, res, known: km }) => {
    return {
      kind: "conjecture", stance: null, status: null,
      thread: M3_THREAD, importance: 3,
      content: `[M3-lite ${M3_TAG}] Conjecture (type ${c.type}, template ${c.template}): ${c.statement}. ` +
        (c.type === "A"
          ? `Survived exhaustive falsification for all n <= ${fmtNum(N)} (no counterexample found below the bound).`
          : `Observed through n = ${fmtNum(N)} by exhaustive count (observed value ${res.observed != null ? Number(res.observed).toFixed(2) : "n/a"}).`) +
        (km ? ` MATCHES A KNOWN RESULT FORM: ${km.title} — the general form is known mathematics; only the specific finite-bound figure here is machine-derived.` : "") +
        ` Mined from the n <= ${fmtNum(trainN)} census, seed ${usedSeed}. Status: tested to ${fmtNum(N)} only.`,
      metadata: {
        m3_generated: true, provenance: "generated", tested_to: N, train_bound: trainN,
        m3_template: c.template, m3_type: c.type, m3_seed: usedSeed, m3_gen_version: GEN_VERSION,
        m3_full: true, m3_novelty_version: NOVELTY_VERSION,
        ...(km ? { known_match: km.id } : {}),
      },
    };
  });
  notes.push({
    kind: "status", stance: null, status: "open",
    thread: M3_THREAD, importance: 2,
    content: `M3-lite v${GEN_VERSION} (M3-full novelty v${NOVELTY_VERSION}) run (seed ${usedSeed}, train ${fmtNum(trainN)}, test ${fmtNum(N)}): ${mined.length} mined candidates — ${minedTriv} dropped by the micro-prover as provable structural identities, ${minedSurv.length} survived (${minedVac} vacuous excluded); baseline ${baseline.length} random candidates — ${baseTriv} micro-proved, ${baseSurv.length} survived (${baseVac} vacuous excluded). GATE v2 (Wilson 95% lower bound of survival difference > 0): ${gatePass ? "PASS" : "FAIL"} — mined ${(minedRate * 100).toFixed(1)}% vs baseline ${(baseRate * 100).toFixed(1)}%, difference lower bound ${(diffLower95 * 100).toFixed(1)}pp (raw ratio ${isFinite(ratio) ? ratio.toFixed(1) + "x" : "inf"}, tracked metric only). ${ranked.length} survivor(s) persisted (cap ${M3_MAX_SURVIVORS}${minedKnown ? `; ${minedKnown}/${minedSurv.length} survivors match a known result FORM in the curated pack and were down-ranked so persistence favors candidates with no pack match — an ordering heuristic, NOT a novelty or truth verdict` : ""}). Generation-quality metric only — not evidence any survivor is true.`,
    metadata: { m3_run_summary: true, m3_seed: usedSeed, tested_to: N, m3_gen_version: GEN_VERSION, m3_full: true, m3_novelty_version: NOVELTY_VERSION, m3_known_form: minedKnown },
  });

  // packet — ground truth for the narration
  const exampleKills = minedRes.filter((x) => !x.trivial && x.res.killed).slice(0, 3).map(({ c, res }) =>
    `- KILLED: ${c.statement} — ${c.type === "A"
      ? `counterexample n = ${fmtNum(res.counterexample)} (observed ${fmtNum(res.observed)})`
      : `observed ${res.observed != null ? Number(res.observed).toFixed(2) : "n/a"} vs claimed ${c.p != null ? c.p.toFixed(2) : (c.d != null ? c.d.toFixed(2) : c.eps)}`}`);

  const exampleTrivial = minedRes.filter((x) => x.trivial).slice(0, 2).map(({ c, trivialReason }) =>
    `- MICRO-PROVED (${trivialReason}): ${c.statement} — the quantity is pinned by residue arithmetic alone; a provable identity, not a conjecture about the dynamics`);

  const survivorLines = ranked.map(({ c, res, known: km }, i) => {
    return `${i + 1}. [type ${c.type} | ${c.template} | machine-generated, tested to ${fmtNum(N)}] ${c.statement}` +
      (c.type === "B" && res.observed != null ? ` (observed ${Number(res.observed).toFixed(2)})` : "") +
      (km ? ` — MATCHES KNOWN RESULT FORM: ${km.title} (the form is known mathematics; the finite-bound figure is ours)` : "");
  });

  const packet = [
    `M3-LITE CONJECTURE GENERATOR v${GEN_VERSION} (M3-FULL novelty-aware persistence v${NOVELTY_VERSION}) — RUN RESULTS, COMPUTED DETERMINISTICALLY IN CODE by M8 (not by you). Seed ${usedSeed}; constants mined from the n <= ${fmtNum(trainN)} census; every candidate falsified EXHAUSTIVELY over 2 <= n <= ${fmtNum(N)}.${ft.overflowed ? " (Feature pass aborted early on overflow guard — bounds reflect the honest range.)" : ""}`,
    ``,
    `GENERATION: ${mined.length} mined candidates (Type A predicate+bound, Type B trend/frequency, incl. one cross-feature conditional family) from the M1 feature families. MICRO-PROVER dropped ${minedTriv} pre-falsification as provable structural identities (zero-variance or residue covering-set — both cohorts get the same check). ${minedSurv.length} survived falsification, ${mined.length - minedTriv - minedSurv.length - minedVac} killed, ${minedVac} vacuous (claim too slack vs observed reality — excluded from survival, both cohorts).`,
    `RANDOM BASELINE (template composition matched to the mined cohort): ${baseline.length} structure-blind candidates. ${baseTriv} micro-proved, ${baseSurv.length} survived, ${baseVac} vacuous.`,
    `GATE v2 (Wilson 95% lower bound of [mined survival - baseline survival] > 0): ${gatePass ? "PASS" : "FAIL"} — mined ${minedSurv.length}/${mined.length} (${(minedRate * 100).toFixed(1)}%) vs baseline ${baseSurv.length}/${baseline.length} (${(baseRate * 100).toFixed(1)}%); difference lower bound ${(diffLower95 * 100).toFixed(1)}pp. Raw ratio ${isFinite(ratio) ? ratio.toFixed(1) + "x" : "(baseline 0)"} is a TRACKED METRIC only, no longer the gate. This gate measures GENERATION QUALITY (mining beats blind parameters with statistical confidence); it is NOT evidence that any surviving conjecture is true. Never present it as one.`,
    ``,
    `NOVELTY (M2 seed pack, deterministic FORM match — M3-full): ${minedKnown} of ${minedSurv.length} surviving conjecture(s) match a known result FORM in the curated literature pack. Their general form is known mathematics; only the finite-bound figure is machine-derived. Known-form survivors are DOWN-RANKED in persistence so the notebook keeps survivors with NO match in our pack — an ordering / spam-cap heuristic, NOT a novelty or truth verdict. A non-match means only "not in our curated seed pack" — it is NOT a literature search and NOT a novelty claim. The deterministic form match is authoritative; any embedding-adjacency note below is suggestive only.`,
    ``,
    `SURVIVORS (top ${ranked.length} of ${minedSurv.length}, persistence-capped at ${M3_MAX_SURVIVORS}; survivors with NO match in the curated pack are ranked first):`,
    survivorLines.length ? survivorLines.join("\n") : "(none — every mined candidate was micro-proved, falsified, or vacuous)",
    ``,
    `EXAMPLE KILLS (falsification is the product):`,
    exampleKills.length ? exampleKills.join("\n") : "(no kills)",
    exampleTrivial.length ? `EXAMPLE MICRO-PROVER DROPS:\n${exampleTrivial.join("\n")}` : ``,
    ``,
    `HONESTY CONTRACT: every figure above is ground truth from the code run. Survivors are MACHINE-GENERATED conjectures that merely survived testing to ${fmtNum(N)} — narrate them ONLY as "machine-generated, tested to ${fmtNum(N)}"; NEVER call them interesting, promising, established, basically true, known results, or literature. A survivor marked "MATCHES KNOWN RESULT FORM" has a KNOWN general form — say so plainly, cite the named result as the literature side, and keep our finite-bound figure machine-derived; do NOT claim the literature states our exact figure, and do NOT call unmatched survivors novel (the novelty check compares against a curated seed pack, not all of mathematics). The persistence ORDER — and which survivors were recorded vs left only in this packet — is a SPAM-CAP heuristic that de-prioritizes known-form matches; it is NOT a novelty or truth ranking, so do NOT present a persisted or top-ranked survivor as more novel, stronger, or more likely true than any other. Type B claims are "observed through N", never "holds". Do NOT extrapolate beyond n <= ${fmtNum(N)}. Your reply MUST state the candidate counts (mined, micro-proved, killed) and the GATE v2 verdict with both survival rates AND the difference lower bound — the gate result is load-bearing information, never omit it, and always frame it as generation quality, not truth. The survivors are being recorded to the research notebook thread "${M3_THREAD}" automatically with machine-generated provenance — acknowledge that in one short line at the end.`,
  ].join("\n");

  return {
    packet, notes,
    gate: { pass: gatePass, minedRate, baselineRate: baseRate, diffLower95, ratio },
    survivors: ranked.map((x) => x.c.statement),
    counts: {
      mined: mined.length, minedSurvived: minedSurv.length, minedVacuous: minedVac, minedTrivial: minedTriv,
      minedKnownForm: minedKnown,
      baseline: baseline.length, baselineSurvived: baseSurv.length, baselineVacuous: baseVac, baselineTrivial: baseTriv,
    },
    testN: N, trainN, seed: usedSeed, overflowed: ft.overflowed, genVersion: GEN_VERSION, noveltyVersion: NOVELTY_VERSION,
  };
}

module.exports = {
  detectConjectureGen, runConjectureGen,
  // exported for tests:
  detectConjectureGenCore, mulberry32, makeCandidate, falsify, isVacuous, statementFor,
  generateMinedCohort, generateMatchedBaseline, rankSurvivors, rankWithinGroup, clampTestBound,
  classHasOdd, sigmaClassNontrivial, microProve, residueDecided, domainSlice,
  wilsonCI, newcombeDiffLower,
  M3_TARGET, M3_GEN_RE, M3_RUN_VERB, TEMPLATES, FEATURES,
  TEST_DEFAULT, TEST_MIN, TEST_MAX, TRAIN_CAP, COHORT_SIZE, M3_MAX_SURVIVORS,
  SEED_DEFAULT, M3_THREAD, GEN_VERSION, NOVELTY_VERSION,
};
