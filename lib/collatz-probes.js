/**
 * M8 Collatz Structural Probe Pack — lib/collatz-probes.js  (Build-13, M1)
 *
 * The first MIDDLE LAYER of the North-Star ladder (M1 → M3-lite → M2 → … → L5,
 * NORTH_STAR REV 2): a deterministic, code-owned feature census over Collatz
 * trajectories that lands in the research memory graph as NEUTRAL evidence
 * nodes — the raw structural material the M3 conjecture generator will mine.
 *
 * SEVEN FEATURE FAMILIES (one evidence node each, per run):
 *   stopping_time         σ(n)  = least k with C^k(n) < n  — census
 *   total_stopping_time   σ∞(n) = steps to reach 1         — census
 *   max_excursion         largest value on the trajectory  — extremes
 *   parity_vectors        first-8-step parity prefix census (Terras structure)
 *   two_adic              ν₂(3n+1) distribution for odd n vs geometric 2^-k
 *   residue_census        σ/σ∞ means by n mod 6
 *   record_setters        σ∞ and excursion record sequences
 *
 * CONVENTIONS (stated per family in every note): step counts use the full
 * Collatz map C(n) = n/2 (even) / 3n+1 (odd); the parity-vector family uses
 * the SHORTCUT (Terras) map T(n) = n/2 / (3n+1)/2 — under C an odd step always
 * lands even ("11" impossible, only Fib(w+2) prefixes), under T every length-k
 * parity vector has density 2^-k, which is the informative census.
 *
 * HONESTY (load-bearing):
 *   - A census is a NEUTRAL structural observation — descriptive data about
 *     trajectories below a bound. It is NOT evidence for or against the
 *     conjecture and the notes say so. metadata.neutral=true suppresses the
 *     graph's code-owned supports-edge (an honest miss beats a wrong edge).
 *   - Everything is computed IN THIS FILE, deterministically. The LLM only
 *     narrates the packet. "Observed up to N" framing, never extrapolation.
 *   - HARD caps everywhere: bound ≤ 500,000 (Vercel runtime), note content
 *     ≤ 1,900 chars (ledger cap is 2,000), record lists truncated in code.
 *
 * CONTEXT-DILUTION GUARD (the other half of M1, per team round 2 / Gemini):
 *   these nodes multiply fast — the per-turn evidence cap lives in
 *   memory-graph.js buildGraphContext (GRAPH_EVIDENCE_CAP), shipped together
 *   with this file.
 *
 * Pure functions; fails safe (detection returns {probe:false} on any doubt).
 */
const { parseBoundToNumber, splitSentences } = require("./discovery");

// ── detection ─────────────────────────────────────────────────────────────────
// Fires ONLY on an explicit RUN-the-probes ask: target + run-verb + (pack word
// or ≥1 named family). Recall questions ("what do we know about collatz
// stopping times?") have no run-verb and stay with the graph lane — running a
// fresh census when Muhammad asked what's already recorded would be wrong.
const M1_TARGET   = /\b(?:collatz|3n\s*\+\s*1|3x\s*\+\s*1)\b/i;
// NOTE: no "do" — "what DO we know about collatz stopping times" is a recall
// question and must stay with the graph lane (caught by m1-probes-verify.ps1).
const M1_RUN_VERB = /\b(?:run|compute|probe|generate|build|calculate|scan|execute|refresh)\b/i;
const M1_PACK_RE  = /\b(?:structural\s+probes?|probe\s+pack|m1\s+(?:probes?|pack)|structural\s+(?:features?|analysis|census|pack)|feature\s+(?:pack|census))\b/i;

const FAMILY_RES = [
  // order matters: total_stopping_time must win over the plain stopping_time
  ["total_stopping_time", /\btotal\s+stopping\s+times?\b/i],
  ["stopping_time",       /(?<!total\s)\bstopping\s+times?\b/i],
  ["max_excursion",       /\b(?:max(?:imum)?\s+)?excursions?\b|\bpeak\s+values?\b|\btrajectory\s+peaks?\b/i],
  ["parity_vectors",      /\bparity\s+(?:vectors?|patterns?|prefix(?:es)?|census)\b/i],
  ["two_adic",            /\b(?:2|two)[\s-]?adic\b|\bvaluations?\b/i],
  ["residue_census",      /\bresidues?(?:\s+(?:census|class(?:es)?))?\b|\bmod\s*6\b/i],
  ["record_setters",      /\brecord[\s-]?(?:setters?|holders?|breakers?)\b|\brecords?\b/i],
];
const ALL_FAMILIES = FAMILY_RES.map(([f]) => f);

const M1_BOUND_RE = /\b(?:up\s+to|below|under|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|thousand|k|m))?|10\s*\^\s*\d+|\d[eE]\d+|2\s*\^\s*\d+)\b/i;

const BOUND_DEFAULT = 100000;
const BOUND_MIN     = 1000;
const BOUND_MAX     = 500000;   // hard runtime cap — Vercel 30s budget incl. embeds

function clampBound(raw) {
  const n = parseBoundToNumber(raw);
  if (n == null || !isFinite(n)) return BOUND_DEFAULT;
  return Math.max(BOUND_MIN, Math.min(BOUND_MAX, Math.floor(n)));
}

function detectStructuralProbeCore(s) {
  if (!M1_TARGET.test(s) || !M1_RUN_VERB.test(s)) return { probe: false };
  const families = FAMILY_RES.filter(([, re]) => re.test(s)).map(([f]) => f);
  const pack = M1_PACK_RE.test(s);
  if (!pack && families.length === 0) return { probe: false };
  const bm = s.match(M1_BOUND_RE);
  return {
    probe: true,
    families: pack || families.length === 0 ? ALL_FAMILIES.slice() : families,
    bound: clampBound(bm ? bm[1] : null),
    requestedBound: bm ? bm[1] : null,
  };
}

// Same long-message discipline as detectDiscovery (the S6 coda-leak lesson):
// a pasted brief that happens to contain "collatz", "run" and "records" in
// different sentences must not launch a probe run.
const SHORT_ASK_MAX = 240;
function detectStructuralProbe(message) {
  const s = String(message || "").trim();
  if (s.length < 12) return { probe: false };
  if (s.length <= SHORT_ASK_MAX) return detectStructuralProbeCore(s);
  for (const sent of splitSentences(s)) {
    if (sent.length < 12) continue;
    const d = detectStructuralProbeCore(sent);
    if (d.probe) return d;
  }
  return { probe: false };
}

// ── the census computation (deterministic, memoized single pass) ──────────────
// For each n: walk C until the value drops below n (memo point). σ(n) is the
// step count at that drop; totals/peaks chain through the memo. Average σ is
// ~3.5, so the pass is near-linear. Float64Array holds step counts and peaks
// exactly (all values < 2^53 at these bounds; guarded anyway).
const OVERFLOW_GUARD = 4.5e15;
const PARITY_WINDOW  = 8;

function computeCensus(boundRaw) {
  const N = clampBound(boundRaw);
  const totals = new Float64Array(N + 1);   // σ∞(i) for i ≤ N
  const peaks  = new Float64Array(N + 1);   // max excursion of i for i ≤ N
  totals[1] = 0; peaks[1] = 1;

  // accumulators
  let sigmaSum = 0, sigmaMax = 0, sigmaArgmax = 2;
  const sigmaHist = new Map();              // σ value → count
  let totalSum = 0, totalMax = 0, totalArgmax = 1;
  const totalHist = new Map();              // bucket(25 steps) → count
  let peakMax = 1, peakArgmax = 1;
  const ratioTop = [];                      // top peak/n ratios [{n, peak, ratio}]
  const totalRecords = [];                  // [{n, steps}] strictly increasing steps
  const peakRecords  = [];                  // [{n, peak}]  strictly increasing peak
  let runTotalRec = -1, runPeakRec = 0;
  const residue = Array.from({ length: 6 }, () => ({ count: 0, sigmaSum: 0, totalSum: 0 }));
  let overflowed = false;
  let lastComplete = 1;     // stats cover 2..lastComplete (≠ N only on overflow)

  for (let n = 2; n <= N; n++) {
    let v = n, steps = 0, peak = n, sigma = 0;
    while (true) {
      v = (v % 2 === 0) ? v / 2 : 3 * v + 1;
      steps++;
      if (v > peak) peak = v;
      if (v > OVERFLOW_GUARD) { overflowed = true; break; }
      if (v < n) {
        sigma = steps;                       // first drop below n = stopping time
        steps += totals[v];
        if (peaks[v] > peak) peak = peaks[v];
        break;
      }
    }
    if (overflowed) break;
    totals[n] = steps; peaks[n] = peak;
    lastComplete = n;

    sigmaSum += sigma;
    if (sigma > sigmaMax) { sigmaMax = sigma; sigmaArgmax = n; }
    sigmaHist.set(sigma, (sigmaHist.get(sigma) || 0) + 1);

    totalSum += steps;
    if (steps > totalMax) { totalMax = steps; totalArgmax = n; }
    const bucket = Math.floor(steps / 25) * 25;
    totalHist.set(bucket, (totalHist.get(bucket) || 0) + 1);

    if (peak > peakMax) { peakMax = peak; peakArgmax = n; }
    const ratio = peak / n;
    if (ratioTop.length < 5 || ratio > ratioTop[ratioTop.length - 1].ratio) {
      ratioTop.push({ n, peak, ratio });
      ratioTop.sort((a, b) => b.ratio - a.ratio);
      if (ratioTop.length > 5) ratioTop.pop();
    }

    if (steps > runTotalRec) { runTotalRec = steps; totalRecords.push({ n, steps }); }
    if (peak  > runPeakRec)  { runPeakRec  = peak;  peakRecords.push({ n, peak }); }

    const r = residue[n % 6];
    r.count++; r.sigmaSum += sigma; r.totalSum += steps;
  }

  const NEff = overflowed ? lastComplete : N;   // honest census range on overflow

  // parity-vector census on the SHORTCUT (Terras) map T(n) = n/2 (even),
  // (3n+1)/2 (odd) — under the full map an odd step always lands even, so "11"
  // never occurs and only Fib(w+2) prefixes are possible (55 for w=8; verified
  // in m1-probes-verify.ps1). Under T every length-k parity vector occurs with
  // density exactly 2^-k (Terras 1976) — THAT census is the structurally
  // informative one. Continues through the 1→2→1 T-cycle for small n.
  const parityCounts = new Map();           // 8-bit pattern string → count
  for (let n = 2; n <= NEff; n++) {
    let v = n, bits = "";
    for (let i = 0; i < PARITY_WINDOW; i++) {
      if (v % 2 === 0) { bits += "0"; v = v / 2; }
      else             { bits += "1"; v = (3 * v + 1) / 2; }
    }
    parityCounts.set(bits, (parityCounts.get(bits) || 0) + 1);
  }

  // ν₂(3n+1) distribution over odd n ≤ N (prediction: P(ν=k) = 2^-k)
  const nuCounts = new Map();
  let oddCount = 0, nuMax = 0, nuArgmax = 3;
  for (let n = 3; n <= NEff; n += 2) {
    let x = 3 * n + 1, k = 0;
    while (x % 2 === 0) { x /= 2; k++; }
    nuCounts.set(k, (nuCounts.get(k) || 0) + 1);
    if (k > nuMax) { nuMax = k; nuArgmax = n; }
    oddCount++;
  }

  return {
    N: NEff, overflowed, count: NEff - 1,
    sigma: { sum: sigmaSum, max: sigmaMax, argmax: sigmaArgmax, hist: sigmaHist },
    total: { sum: totalSum, max: totalMax, argmax: totalArgmax, hist: totalHist },
    peak:  { max: peakMax, argmax: peakArgmax, ratioTop },
    records: { total: totalRecords, peak: peakRecords },
    residue,
    parity: { counts: parityCounts, window: PARITY_WINDOW },
    nu: { counts: nuCounts, oddCount, max: nuMax, argmax: nuArgmax },
  };
}

// ── per-family note content (each ≤ ~1,500 chars; ledger cap is 2,000) ────────
const NEUTRAL_TAG = "NEUTRAL structural census — descriptive data about trajectories up to the bound; NOT evidence for or against the Collatz conjecture, and not a proof of anything.";

function fmt(x, d = 2) { return Number(x).toFixed(d); }
function fmtInt(x) { return Math.round(Number(x)).toLocaleString("en-US"); }

function familyContent(family, c) {
  const FULL_MAP = "Collatz map C(n)=n/2 (even) / 3n+1 (odd)";
  const head = (name, mapNote) => `[M1 structural probe — ${name}, ${mapNote || FULL_MAP}, computed deterministically in code for 2 ≤ n ≤ ${fmtInt(c.N)}] `;

  if (family === "stopping_time") {
    const top = [...c.sigma.hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([s, k]) => `σ=${s}: ${fmt(100 * k / c.count, 1)}%`).join(", ");
    return head("stopping time σ(n) = least k with C^k(n) < n")
      + `Mean σ = ${fmt(c.sigma.sum / c.count, 3)}; max σ = ${c.sigma.max} at n = ${fmtInt(c.sigma.argmax)}. `
      + `Most common values: ${top}. Every n ≤ ${fmtInt(c.N)} has finite stopping time (observed). ${NEUTRAL_TAG}`;
  }
  if (family === "total_stopping_time") {
    const top = [...c.total.hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([b, k]) => `${b}–${b + 24} steps: ${fmt(100 * k / c.count, 1)}%`).join(", ");
    return head("total stopping time σ∞(n) = steps to reach 1")
      + `Mean σ∞ = ${fmt(c.total.sum / c.count, 2)}; max σ∞ = ${c.total.max} at n = ${fmtInt(c.total.argmax)}. `
      + `Distribution (25-step buckets, top 5): ${top}. ${NEUTRAL_TAG}`;
  }
  if (family === "max_excursion") {
    const top = c.peak.ratioTop.map((r) => `n=${fmtInt(r.n)} peaks at ${fmtInt(r.peak)} (×${fmtInt(r.ratio)})`).join("; ");
    return head("max excursion (largest trajectory value)")
      + `Largest excursion: n = ${fmtInt(c.peak.argmax)} reaches ${fmtInt(c.peak.max)}. `
      + `Top expansion ratios peak/n: ${top}. ${NEUTRAL_TAG}`;
  }
  if (family === "parity_vectors") {
    const entries = [...c.parity.counts.entries()];
    const total = c.count;
    const uniform = 100 / Math.pow(2, c.parity.window);
    entries.sort((a, b) => b[1] - a[1]);
    const hi = entries.slice(0, 3).map(([p, k]) => `${p}: ${fmt(100 * k / total, 2)}%`).join(", ");
    const lo = entries.slice(-2).map(([p, k]) => `${p}: ${fmt(100 * k / total, 2)}%`).join(", ");
    return head(`parity vectors (first ${c.parity.window} steps, 1=odd, continuing through the 1→2 T-cycle for small n)`,
                "SHORTCUT map T(n)=n/2 (even) / (3n+1)/2 (odd) — Terras' map, where every length-k parity vector has density 2^-k")
      + `${entries.length} of ${Math.pow(2, c.parity.window)} possible ${c.parity.window}-bit prefixes observed. `
      + `Uniform expectation ${fmt(uniform, 2)}% each; most frequent: ${hi}; least frequent: ${lo}. `
      + `(Terras: each length-k parity prefix has natural density 2^-k.) ${NEUTRAL_TAG}`;
  }
  if (family === "two_adic") {
    const rows = [];
    for (let k = 1; k <= 8; k++) {
      const obs = 100 * (c.nu.counts.get(k) || 0) / c.nu.oddCount;
      rows.push(`ν=${k}: ${fmt(obs, 2)}% (predicted ${fmt(100 / Math.pow(2, k), 2)}%)`);
    }
    return head("2-adic valuations ν₂(3n+1) over odd n")
      + `Sample: ${fmtInt(c.nu.oddCount)} odd n. Observed vs geometric 2^-k prediction — ${rows.join(", ")}. `
      + `Max ν = ${c.nu.max} at n = ${fmtInt(c.nu.argmax)}. ${NEUTRAL_TAG}`;
  }
  if (family === "residue_census") {
    const rows = c.residue.map((r, i) =>
      r.count ? `n≡${i} (mod 6): mean σ∞ = ${fmt(r.totalSum / r.count, 1)}, mean σ = ${fmt(r.sigmaSum / r.count, 2)} (${fmtInt(r.count)} values)` : null
    ).filter(Boolean).join("; ");
    return head("residue census (means by n mod 6)") + rows + `. ${NEUTRAL_TAG}`;
  }
  if (family === "record_setters") {
    const tr = c.records.total.slice(-10).map((r) => `${fmtInt(r.n)}→${r.steps}`).join(", ");
    const pr = c.records.peak.slice(-8).map((r) => `${fmtInt(r.n)}→${fmtInt(r.peak)}`).join(", ");
    return head("record-setters")
      + `σ∞ records (${c.records.total.length} total; last 10 as n→steps): ${tr}. `
      + `Excursion records (${c.records.peak.length} total; last 8 as n→peak): ${pr}. ${NEUTRAL_TAG}`;
  }
  return null;
}

// ── run + packet ──────────────────────────────────────────────────────────────
/**
 * Execute the requested families over one census pass. Returns:
 *   packet — the deterministic GROUND-TRUTH block the LLM narrates
 *   notes  — staged notebook writes (kind evidence, NEUTRAL metadata —
 *            persisted at STORE by the orchestrator; metadata.neutral
 *            suppresses the graph's supports-edge)
 * Synchronous, pure CPU; ~hundreds of ms at the max bound.
 */
function runStructuralProbes({ families, bound } = {}) {
  const fams = (families && families.length ? families : ALL_FAMILIES)
    .filter((f) => ALL_FAMILIES.includes(f));
  const census = computeCensus(bound);

  const notes = [];
  const blocks = [];
  for (const f of fams) {
    const content = familyContent(f, census);
    if (!content) continue;
    blocks.push(`— ${f.replace(/_/g, " ").toUpperCase()} —\n${content.slice(0, 1900)}`);
    notes.push({
      kind: "evidence", stance: null, status: null,
      thread: "collatz", importance: 3,
      content: content.slice(0, 1900),
      metadata: { m1_family: f, bound: census.N, neutral: true },
    });
  }

  const packet = [
    `M1 STRUCTURAL PROBE PACK — Collatz feature census, COMPUTED DETERMINISTICALLY IN CODE by M8 (not by you) for all 2 ≤ n ≤ ${fmtInt(census.N)}.${census.overflowed ? " (Run aborted early: a value exceeded the overflow guard — report that honestly.)" : ""}`,
    `Families in this run: ${fams.join(", ")}.`,
    ``,
    blocks.join("\n\n"),
    ``,
    `HONESTY CONTRACT: every figure above is ground truth from the code run — narrate and explain, but do NOT invent figures, do NOT extrapolate beyond n ≤ ${fmtInt(census.N)} as fact, and NEVER frame any of this as evidence that the Collatz conjecture is true or false — it is a neutral structural census ("observed up to N"). Each family is being recorded to the research notebook thread "collatz" automatically as a neutral evidence entry — acknowledge that in one short line at the end.`,
  ].join("\n");

  return { packet, notes, families: fams, bound: census.N, overflowed: census.overflowed };
}

module.exports = {
  detectStructuralProbe, runStructuralProbes, computeCensus,
  // exported for tests:
  detectStructuralProbeCore, familyContent, clampBound,
  M1_TARGET, M1_RUN_VERB, M1_PACK_RE, FAMILY_RES, ALL_FAMILIES,
  BOUND_DEFAULT, BOUND_MIN, BOUND_MAX, PARITY_WINDOW,
};
