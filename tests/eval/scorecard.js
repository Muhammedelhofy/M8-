/**
 * M8 Eval — Scorecard Aggregation + Calibration (tests/eval/scorecard.js)
 *
 * Turns raw per-check results into NUMBERS:
 *   • per-probe score (0..1)         = weighted mean of its checks
 *   • per-category score (0..5)      = mean of its probes × 5
 *   • overall score (0..5)           = CATEGORY_WEIGHTS-weighted mean of categories
 *   • trend vs the previous run      = delta per category (history.jsonl)
 *   • CALIBRATION                    = M8's own self-rating vs the measured score
 *
 * The calibration block is the point of the whole exercise: a self-assessment
 * that ~matches the measured scorecard (and owns its weak spots) is itself
 * evidence of good calibration; a vague self-5 on something the battery scored
 * lower is a *finding*, not a pass.
 */

const { CATEGORIES, CATEGORY_WEIGHTS } = require("./probes");

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// ── aggregate a single probe's graded turns into a 0..1 score ─────────────────
function scoreProbe(probeResult) {
  // probeResult.checks = flat list of { pass, score, weight } across all turns
  const checks = probeResult.checks || [];
  if (!checks.length) return 0;
  let num = 0, den = 0;
  for (const c of checks) { const w = c.weight ?? 1; num += (c.score ?? (c.pass ? 1 : 0)) * w; den += w; }
  return den ? num / den : 0;
}

// ── aggregate probe results → category & overall scores (0..5) ────────────────
function aggregate(probeResults) {
  const byCat = {};
  for (const cat of CATEGORIES) byCat[cat] = [];
  for (const pr of probeResults) {
    const s = scoreProbe(pr);
    pr.score01 = s;
    (byCat[pr.category] || (byCat[pr.category] = [])).push({ id: pr.id, score: s, weight: pr.weight ?? 1 });
  }

  const categories = {};
  for (const cat of CATEGORIES) {
    const ps = byCat[cat] || [];
    if (!ps.length) { categories[cat] = null; continue; }   // no probe ran → not scored
    let num = 0, den = 0;
    for (const p of ps) { num += p.score * p.weight; den += p.weight; }
    categories[cat] = round1((num / den) * 5);
  }

  // overall = category-weighted mean over the categories that actually ran
  let onum = 0, oden = 0;
  for (const cat of CATEGORIES) {
    if (categories[cat] == null) continue;
    const w = CATEGORY_WEIGHTS[cat] ?? 1;
    onum += categories[cat] * w; oden += w;
  }
  const overall = oden ? round2(onum / oden) : 0;

  return { categories, overall, byCat };
}

// ── trend vs the previous scorecard (per category) ────────────────────────────
function trend(current, previous) {
  const out = {};
  for (const cat of CATEGORIES) {
    const c = current.categories[cat], p = previous?.categories?.[cat];
    if (c == null || p == null) { out[cat] = null; continue; }
    out[cat] = round1(c - p);
  }
  out.overall = previous?.overall != null ? round2(current.overall - previous.overall) : null;
  return out;
}

// ── parse M8's free-text self-assessment into per-aspect 0..5 scores ──────────
// Maps the probe's self-assessment dimensions onto our category keys and pulls
// the "X/5" rating it gave each. Robust to "Grounding/Anti-Fabrication: 5/5".
const SELF_ALIASES = {
  grounding:      /grounding|anti[\s-]?fabrication/i,
  honesty:        /honesty|calibration/i,
  fleet_intel:    /fleet\s+intelligence|fleet[\s-]?intel/i,
  reasoning:      /reasoning|logic/i,
  state_tracking: /state|sequence/i,
  memory:         /\bmemory\b/i,
  latency:        /latency/i,
};
function parseSelfAssessment(text) {
  const scores = {};
  const lines = (text || "").split(/\r?\n/);
  for (const [cat, re] of Object.entries(SELF_ALIASES)) {
    for (const line of lines) {
      if (!re.test(line)) continue;
      const m = line.match(/(\d(?:\.\d)?)\s*\/\s*5/);
      if (m) { scores[cat] = parseFloat(m[1]); break; }
    }
  }
  return scores;
}

// ── calibration: self-rating vs measured (or a supplied baseline) ─────────────
// `measured` is either the harness's own category scores or, when the full
// battery wasn't run live, a baseline (e.g. the team-adjusted scorecard).
function calibrate(selfScores, measured, opts = {}) {
  const overTol = opts.overTol ?? 0.75;   // self − measured beyond this = over-rating
  const rows = [];
  for (const cat of CATEGORIES) {
    const self = selfScores[cat];
    const meas = measured[cat];
    if (self == null || meas == null) continue;
    const delta = round1(self - meas);
    let verdict = "calibrated";
    if (delta >= overTol) verdict = "OVER-rated";
    else if (delta <= -overTol) verdict = "under-rated";
    rows.push({ category: cat, self, measured: meas, delta, verdict });
  }
  const avgAbs = rows.length ? round2(rows.reduce((a, r) => a + Math.abs(r.delta), 0) / rows.length) : 0;
  const overs = rows.filter((r) => r.verdict === "OVER-rated");
  // Calibration score (0..5): perfect when avg |delta| = 0, degrades ~1pt per
  // 0.5 of average drift, with an extra penalty for any over-rating (the
  // dangerous direction for an anti-fabrication agent).
  const calScore = round1(Math.max(0, 5 - avgAbs * 2 - overs.length * 0.5));
  return { rows, avgAbsDelta: avgAbs, overRated: overs.map((r) => r.category), calScore };
}

// ── render a human-readable markdown scorecard ────────────────────────────────
function renderMarkdown({ agg, trd, calibration, meta }) {
  const bar = (v) => v == null ? "—" : "█".repeat(Math.round(v)) + "░".repeat(5 - Math.round(v));
  const arrow = (d) => d == null ? "" : d > 0 ? ` ▲+${d}` : d < 0 ? ` ▼${d}` : " =";
  const L = [];
  L.push(`# M8 Self-Scorecard — ${meta.runId}`);
  L.push("");
  L.push(`**Overall: ${agg.overall} / 5**${arrow(trd?.overall)}  ·  target ${meta.target || "live /api/chat"}  ·  ${meta.note || ""}`);
  L.push("");
  L.push("| Category | Score | | Δ vs last |");
  L.push("|---|---|---|---|");
  for (const cat of CATEGORIES) {
    const v = agg.categories[cat];
    L.push(`| ${cat} | ${v == null ? "—" : v.toFixed(1)} | \`${bar(v)}\` |${arrow(trd?.[cat])} |`);
  }
  if (calibration) {
    L.push("");
    L.push(`## Calibration — self-rating vs measured (cal score ${calibration.calScore}/5)`);
    L.push(`Avg |Δ| = ${calibration.avgAbsDelta}. Over-rated: ${calibration.overRated.join(", ") || "none"}.`);
    L.push("");
    L.push("| Aspect | M8 self | Measured | Δ | Verdict |");
    L.push("|---|---|---|---|---|");
    for (const r of calibration.rows) {
      L.push(`| ${r.category} | ${r.self} | ${r.measured} | ${r.delta > 0 ? "+" + r.delta : r.delta} | ${r.verdict} |`);
    }
  }
  return L.join("\n");
}

module.exports = {
  scoreProbe, aggregate, trend, parseSelfAssessment, calibrate, renderMarkdown, round1, round2,
};
