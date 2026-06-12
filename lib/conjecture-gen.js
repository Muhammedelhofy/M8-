/**
 * M8 M3-lite Conjecture Generator v1 — lib/conjecture-gen.js  (Build-14, S7)
 *
 * The first GENERATOR rung of the ladder (M1 ✅ → M3-lite → M2 → M3-full,
 * NORTH_STAR REV 2 / team round 2): M8 proposes falsifiable structure instead
 * of only verifying what it is asked. Candidates are mined from the M1 feature
 * families over a TRAIN census, falsified deterministically over a 10× larger
 * TEST range, and the run is gated on beating a structure-blind random baseline
 * ≥2× (round-2 Q3). Full design + adversarial review: BUILD_14_SPEC.md.
 *
 * SCHEMA (round-2 Q2):
 *   Type A — computable predicate + explicit bound; one counterexample kills.
 *   Type B — trend/frequency claim over a bounded sample, evaluated by
 *            EXHAUSTIVE deterministic count; narrated only "observed through N".
 *
 * HONESTY (load-bearing):
 *   - Survivors are "machine-generated, survived falsification up to N" —
 *     NEVER "interesting"/"promising"/"established" (Q1 ruling: that framing is
 *     locked until the M2 novelty gate + M3-full exist).
 *   - The ≥2× gate is a GENERATION-QUALITY metric (mining beats blind
 *     parameters), not evidence any candidate is true. The packet says so.
 *   - Margins/tolerances are FIXED in code (spec critique A1 — an honest gate
 *     can't have a tuning knob); mined + baseline share one falsifier path.
 *   - Provable Collatz local identities are excluded by construction (A2):
 *     σ-residue templates require classes containing odd n; the ν₂ implication
 *     targets σ∞ (non-local), never σ.
 *
 * CONTAMINATION GUARDS (this build's other half, see memory-graph.js):
 *   survivors persist to their OWN thread "collatz-m3" (never hijacking
 *   latestConjectureNode("collatz") as a supports-edge target, A3) with
 *   metadata.m3_generated → node status tested_to_<N> → recall labels them
 *   MACHINE-GENERATED with a provenance warning (A4). Persistence is capped
 *   at M3_MAX_SURVIVORS (A6).
 *
 * Pure functions; sync CPU; fails safe (detection returns {gen:false}).
 */
const { parseBoundToNumber, splitSentences } = require("./discovery");
const { computeFeatureTable } = require("./collatz-probes");

// ── tunables (FIXED — not run-tunable; see spec critique A1) ──────────────────
const TEST_DEFAULT  = 100000;
const TEST_MIN      = 20000;
const TEST_MAX      = 300000;   // exhaustive falsification stays sub-second here
const TRAIN_CAP     = 20000;    // train = min(test/10, TRAIN_CAP) — strict prefix
const COHORT_SIZE   = 30;       // mined candidates per run (= baseline size)
const M3_MAX_SURVIVORS = 5;     // persistence cap per run (spam guard, A6)
const SEED_DEFAULT  = 1337;

// Fixed margins (Type A) / tolerances (Type B) — identical for every run.
const MARGIN_FACTOR   = 1.10;   // Type A: claimed c = train max × 1.10
const B_FREQ_SLACK_PP = 0.5;    // Type B: claimed p = train freq − 0.5pp
const B_GAP_FACTOR    = 0.5;    // Type B: claimed gap = train gap × 0.5
const B_NU_EPS_PP     = 0.25;   // Type B: |observed − 2^-k| ≤ 0.25pp

// ── detection ─────────────────────────────────────────────────────────────────
// Fires ONLY on an explicit run-the-generator ask. Recall asks ("what
// conjectures do we have?") have no generator-run shape and stay with the
// graph/notebook lanes. Must be checked ABOVE the M1 lane in the orchestrator:
// "run the conjecture generator on the structural features" would otherwise be
// claimed by M1's pack regex.
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

// ── parameter domains (shared by mining AND baseline — A1: same shapes) ───────
const MODS      = [3, 5, 6, 7, 9, 12];
const NU_KS     = [2, 3, 4, 5];
const SIGMA_TS  = [3, 5, 8, 12];
const PEAK_ES   = [2, 2.5, 3];
const LOG_AS    = [4, 6, 8, 10, 12];

// Residue classes for σ/σ∞/ν₂ templates must contain odd n (A2: an all-even
// class makes σ trivially 1). m odd → mixed class, fine; m even → r must be odd.
function classHasOdd(m, r) { return m % 2 === 1 || r % 2 === 1; }

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
    case "B_sigma_freq":    return `at least ${t.p.toFixed(2)}% of n <= ${N} have stopping time sigma(n) <= ${t.t}`;
    case "B_res_total_gap": return `mean total stopping time over n = ${t.r1} (mod ${t.m}) exceeds the mean over n = ${t.r2} (mod ${t.m}) by at least ${t.d.toFixed(2)} steps, for n <= ${N}`;
    case "B_nu_geo":        return `the fraction of odd n <= ${N} with nu2(3n+1) = ${t.k} is within ${t.eps.toFixed(2)}pp of 2^-${t.k} (${(100 / Math.pow(2, t.k)).toFixed(2)}%)`;
    default: return null;
  }
}

const FEATURES = {
  A_res_sigma_max: ["stopping_time", "residue_census"],
  A_res_total_max: ["total_stopping_time", "residue_census"],
  A_nu_total_max:  ["two_adic", "total_stopping_time"],
  A_total_log:     ["total_stopping_time", "record_setters"],
  A_peak_power:    ["max_excursion", "record_setters"],
  B_sigma_freq:    ["stopping_time", "residue_census"],
  B_res_total_gap: ["total_stopping_time", "residue_census"],
  B_nu_geo:        ["two_adic", "residue_census"],
};

// ── train-census helpers (mined constants come ONLY from n ≤ trainN, A7) ──────
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
      const rs = [];
      for (let r = 0; r < t.m; r++) if (classHasOdd(t.m, r)) rs.push(r);
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
    default: return null;
  }
  t.mined = !!mined;
  t.statement = statementFor(t);
  t.features = FEATURES[template];
  if (!t.statement) return null;
  return t;
}

const TEMPLATES = Object.keys(FEATURES);

function generateCohort(rnd, ft, trainN, testN, mined, count) {
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const c = makeCandidate(TEMPLATES[out.length % TEMPLATES.length], rnd, ft, trainN, testN, mined);
    if (!c || seen.has(c.statement)) continue;
    seen.add(c.statement);
    out.push(c);
  }
  return out;
}

// ── falsifier (one code path for both cohorts — A1) ───────────────────────────
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
    default: return { killed: true, invalid: true };
  }
}

// ── vacuity floor (round-2 Q3: survival is gameable by trivial survivors) ─────
// A "survivor" whose claim is far slacker than observed reality carries no
// information — "sigma(n) <= 119" when the real max is 60 is a trivial win the
// random baseline would otherwise farm. FIXED constants (A1), applied to BOTH
// cohorts identically: vacuous survivors are excluded from survival counts,
// the gate, and persistence; they are reported as their own bucket.
const VACUITY_RATIO  = 1.5;   // Type A: claimed c > needed c × 1.5 → vacuous
const VAC_LOG_SLACK  = 30;    // A_total_log: b − needed b > 30 → vacuous (additive — b can be near 0)
const VAC_FREQ_PP    = 5;     // B_sigma_freq: observed − claimed p > 5pp → vacuous
const VAC_GAP_RATIO  = 4;     // B_res_total_gap: observed gap > claimed d × 4 → vacuous
const VAC_NU_EPS_PP  = 1.0;   // B_nu_geo: tolerance wider than 1pp → vacuous

function isVacuous(c, res) {
  if (res.killed) return false;
  switch (c.template) {
    case "A_res_sigma_max":
    case "A_res_total_max":
    case "A_nu_total_max": return c.c > Math.max(res.cNeed, 1) * VACUITY_RATIO;
    case "A_total_log":    return c.b - res.cNeed > VAC_LOG_SLACK;
    case "A_peak_power":   return c.c > Math.max(res.cNeed, 1e-6) * VACUITY_RATIO;
    case "B_sigma_freq":   return (res.observed || 0) - c.p > VAC_FREQ_PP;
    case "B_res_total_gap": return (res.observed || 0) > c.d * VAC_GAP_RATIO;
    case "B_nu_geo":       return c.eps > VAC_NU_EPS_PP;
    default: return false;
  }
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
function rankSurvivors(survivors) {
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

// ── run + packet ──────────────────────────────────────────────────────────────
const M3_THREAD = "collatz-m3";
const M3_TAG = "machine-generated conjecture from M8's M3-lite generator — survived deterministic falsification, NOT established, NOT literature, NOT verified beyond the stated bound";

/**
 * Execute one full M3-lite run. Returns:
 *   packet — deterministic GROUND-TRUTH block the LLM narrates
 *   notes  — staged notebook writes (≤ M3_MAX_SURVIVORS conjecture notes to
 *            thread collatz-m3 + one status summary), persisted at STORE
 *   gate   — { pass, minedRate, baselineRate, ratio }
 */
function runConjectureGen({ testBound, seed } = {}) {
  const testN = clampTestBound(testBound);
  const ft = computeFeatureTable(testN);
  const N = ft.N;                                 // honest range on overflow
  const trainN = Math.min(Math.floor(N / 10), TRAIN_CAP);
  const usedSeed = (seed >>> 0) || SEED_DEFAULT;

  const rndMined = mulberry32(usedSeed);
  const rndBase  = mulberry32(usedSeed ^ 0x9E3779B9);   // decorrelated baseline stream

  const mined    = generateCohort(rndMined, ft, trainN, N, true,  COHORT_SIZE);
  const baseline = generateCohort(rndBase,  ft, trainN, N, false, COHORT_SIZE);

  const evalCohort = (cands) => cands.map((c) => {
    const res = falsify(c, ft, N);
    return { c, res, vacuous: isVacuous(c, res) };
  });
  const minedRes = evalCohort(mined);
  const baseRes  = evalCohort(baseline);

  // survival = not falsified AND not vacuous (round-2 Q3 trivial-survivor guard)
  const minedSurv = minedRes.filter((x) => !x.res.killed && !x.vacuous);
  const baseSurv  = baseRes.filter((x) => !x.res.killed && !x.vacuous);
  const minedVac  = minedRes.filter((x) => !x.res.killed && x.vacuous).length;
  const baseVac   = baseRes.filter((x) => !x.res.killed && x.vacuous).length;
  const minedRate = mined.length ? minedSurv.length / mined.length : 0;
  const baseRate  = baseline.length ? baseSurv.length / baseline.length : 0;
  const ratio = baseRate > 0 ? minedRate / baseRate : (minedRate > 0 ? Infinity : 0);
  const gatePass = minedSurv.length >= 1 && (baseRate === 0 ? true : minedRate >= 2 * baseRate);

  const ranked = rankSurvivors(minedSurv).slice(0, M3_MAX_SURVIVORS);

  // staged notes — survivors only (the falsified majority is packet-reported,
  // never persisted: kills are the product, not ledger spam)
  const notes = ranked.map(({ c, res }) => ({
    kind: "conjecture", stance: null, status: null,
    thread: M3_THREAD, importance: 3,
    content: `[M3-lite ${M3_TAG}] Conjecture (type ${c.type}, template ${c.template}): ${c.statement}. ` +
      (c.type === "A"
        ? `Survived exhaustive falsification for all n <= ${fmtNum(N)} (no counterexample found below the bound).`
        : `Observed through n = ${fmtNum(N)} by exhaustive count (observed value ${res.observed != null ? Number(res.observed).toFixed(2) : "n/a"}).`) +
      ` Mined from the n <= ${fmtNum(trainN)} census, seed ${usedSeed}. Status: tested to ${fmtNum(N)} only.`,
    metadata: {
      m3_generated: true, provenance: "generated", tested_to: N, train_bound: trainN,
      m3_template: c.template, m3_type: c.type, m3_seed: usedSeed,
    },
  }));
  notes.push({
    kind: "status", stance: null, status: "open",
    thread: M3_THREAD, importance: 2,
    content: `M3-lite run (seed ${usedSeed}, train ${fmtNum(trainN)}, test ${fmtNum(N)}): ${mined.length} mined candidates, ${minedSurv.length} survived (${minedVac} vacuous excluded); baseline ${baseline.length} random candidates, ${baseSurv.length} survived (${baseVac} vacuous excluded). Gate (mined survival >= 2x baseline): ${gatePass ? "PASS" : "FAIL"} (${(minedRate * 100).toFixed(1)}% vs ${(baseRate * 100).toFixed(1)}%). ${ranked.length} survivor(s) persisted (cap ${M3_MAX_SURVIVORS}). Generation-quality metric only — not evidence any survivor is true.`,
    metadata: { m3_run_summary: true, m3_seed: usedSeed, tested_to: N },
  });

  // packet — ground truth for the narration
  const exampleKills = minedRes.filter((x) => x.res.killed).slice(0, 3).map(({ c, res }) =>
    `- KILLED: ${c.statement} — ${c.type === "A"
      ? `counterexample n = ${fmtNum(res.counterexample)} (observed ${fmtNum(res.observed)})`
      : `observed ${res.observed != null ? Number(res.observed).toFixed(2) : "n/a"} vs claimed ${c.p != null ? c.p.toFixed(2) : (c.d != null ? c.d.toFixed(2) : c.eps)}`}`);

  const survivorLines = ranked.map(({ c, res }, i) =>
    `${i + 1}. [type ${c.type} | ${c.template} | machine-generated, tested to ${fmtNum(N)}] ${c.statement}` +
    (c.type === "B" && res.observed != null ? ` (observed ${Number(res.observed).toFixed(2)})` : ""));

  const packet = [
    `M3-LITE CONJECTURE GENERATOR — RUN RESULTS, COMPUTED DETERMINISTICALLY IN CODE by M8 (not by you). Seed ${usedSeed}; constants mined from the n <= ${fmtNum(trainN)} census; every candidate falsified EXHAUSTIVELY over 2 <= n <= ${fmtNum(N)}.${ft.overflowed ? " (Feature pass aborted early on overflow guard — bounds reflect the honest range.)" : ""}`,
    ``,
    `GENERATION: ${mined.length} mined candidates (Type A predicate+bound, Type B trend/frequency) from the M1 feature families. ${minedSurv.length} survived falsification, ${mined.length - minedSurv.length - minedVac} killed, ${minedVac} vacuous (claim too slack vs observed reality — excluded from survival, both cohorts get the same floor).`,
    `RANDOM BASELINE: ${baseline.length} structure-blind candidates (same templates, blind constants). ${baseSurv.length} survived, ${baseVac} vacuous.`,
    `GATE (survival >= 2x random baseline): ${gatePass ? "PASS" : "FAIL"} — mined ${(minedRate * 100).toFixed(1)}% vs baseline ${(baseRate * 100).toFixed(1)}%${isFinite(ratio) ? ` (${ratio.toFixed(1)}x)` : " (baseline 0)"} . This gate measures GENERATION QUALITY (mining beats blind parameters); it is NOT evidence that any surviving conjecture is true. Never present it as one.`,
    ``,
    `SURVIVORS (top ${ranked.length} of ${minedSurv.length}, persistence-capped at ${M3_MAX_SURVIVORS}):`,
    survivorLines.length ? survivorLines.join("\n") : "(none — every mined candidate was falsified)",
    ``,
    `EXAMPLE KILLS (falsification is the product):`,
    exampleKills.length ? exampleKills.join("\n") : "(no kills)",
    ``,
    `HONESTY CONTRACT: every figure above is ground truth from the code run. Survivors are MACHINE-GENERATED conjectures that merely survived testing to ${fmtNum(N)} — narrate them ONLY as "machine-generated, tested to ${fmtNum(N)}"; NEVER call them interesting, promising, established, basically true, known results, or literature. Type B claims are "observed through N", never "holds". Do NOT extrapolate beyond n <= ${fmtNum(N)}. The survivors are being recorded to the research notebook thread "${M3_THREAD}" automatically with machine-generated provenance — acknowledge that in one short line at the end.`,
  ].join("\n");

  return {
    packet, notes,
    gate: { pass: gatePass, minedRate, baselineRate: baseRate, ratio },
    survivors: ranked.map((x) => x.c.statement),
    counts: { mined: mined.length, minedSurvived: minedSurv.length, minedVacuous: minedVac, baseline: baseline.length, baselineSurvived: baseSurv.length, baselineVacuous: baseVac },
    testN: N, trainN, seed: usedSeed, overflowed: ft.overflowed,
  };
}

module.exports = {
  detectConjectureGen, runConjectureGen,
  // exported for tests:
  detectConjectureGenCore, mulberry32, makeCandidate, falsify, isVacuous, statementFor,
  generateCohort, rankSurvivors, clampTestBound, classHasOdd,
  M3_TARGET, M3_GEN_RE, M3_RUN_VERB, TEMPLATES, FEATURES,
  TEST_DEFAULT, TEST_MIN, TEST_MAX, TRAIN_CAP, COHORT_SIZE, M3_MAX_SURVIVORS,
  SEED_DEFAULT, M3_THREAD,
};
