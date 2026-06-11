/**
 * M8 Eval — Runner (tests/eval/run-eval.js)
 *
 * Drives the live agent against the probe battery and writes a scored card.
 *
 *   node tests/eval/run-eval.js                 # full battery vs prod
 *   node tests/eval/run-eval.js --base http://localhost:3000
 *   node tests/eval/run-eval.js --only grounding,prompt_bypass
 *   node tests/eval/run-eval.js --self          # ALSO run + calibrate the self-assessment probe
 *   node tests/eval/run-eval.js --dry           # print the plan, no network
 *
 * Each probe runs as its OWN session (fresh sessionId) so memory/registry gates
 * behave like a cold start; multi-turn probes carry the running `history` and a
 * shared capture bag. Output → tests/eval/results/<runId>.{json,md} and one
 * appended line in results/history.jsonl (the tracked-over-time number).
 *
 * No local node? The grader/scorecard LOGIC is verified by the PowerShell
 * .NET-regex port (verify-port.ps1); this runner is what executes once node is
 * available (locally or in CI), and it costs live LLM quota — run it deliberately.
 */

const fs   = require("fs");
const path = require("path");
const { PROBES, CATEGORIES } = require("./probes");
const { gradeCheck } = require("./graders");
const {
  aggregate, trend, parseSelfAssessment, calibrate, renderMarkdown,
} = require("./scorecard");
const { SELF_ASSESSMENT_PROMPT, LATEST_SELF_ANSWER, TEAM_BASELINE } = require("./self-assessment");

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getFlag = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] || true) : null; };
const BASE  = getFlag("--base") || process.env.M8_EVAL_BASE || "https://m8-alpha.vercel.app";
const ONLY  = (getFlag("--only") || "").toString().split(",").map((s) => s.trim()).filter(Boolean);
const SELF  = argv.includes("--self");
const DRY   = argv.includes("--dry");
const RESULTS_DIR = path.join(__dirname, "results");

// ── one /api/chat call ─────────────────────────────────────────────────────────
async function ask(message, sessionId, history) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId, history }),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return { text: data.response || "", latencyMs };
}

// ── run one probe (single- or multi-turn) ───────────────────────────────────────
async function runProbe(probe) {
  const sessionId = `eval_${probe.id}_${Date.now()}`;
  const history = [];
  const captures = {};
  const checks = [];           // flat list of graded checks across all turns
  let lastLatency = 0;

  for (const turn of probe.turns) {
    let reply;
    try {
      reply = await ask(turn.send, sessionId, history.slice());
      // Cold-dependency retry (e.g. Lean /check warming): an honest "pending"
      // reply isn't a fail — wait once, re-ask once, grade the second answer.
      if (turn.retryOn && turn.retryOn.test(reply.text || "")) {
        await new Promise((r) => setTimeout(r, turn.retryDelayMs || 75000));
        reply = await ask(turn.send, sessionId, history.slice());
      }
    } catch (e) {
      // A failed call fails every check on this turn (and the probe) — honestly.
      for (const c of (turn.checks || [])) checks.push({ pass: false, score: 0, label: c.label, detail: `call failed: ${e.message}`, weight: c.weight });
      checks.push({ pass: false, score: 0, label: "endpoint reachable", detail: e.message });
      break;
    }
    lastLatency = reply.latencyMs;
    history.push({ role: "user", content: turn.send });
    history.push({ role: "assistant", content: reply.text });

    const ctx = { text: reply.text, latencyMs: reply.latencyMs, captures };
    for (const c of (turn.checks || [])) {
      const r = gradeCheck(c, ctx);
      checks.push({ ...r, weight: c.weight });
    }
  }
  return { id: probe.id, category: probe.category, title: probe.title, weight: probe.weight, checks, latencyMs: lastLatency };
}

// ── self-assessment: run the probe live, parse its self-scores, calibrate ─────────
async function runSelfAssessment(measuredCategories) {
  let answer = LATEST_SELF_ANSWER;
  if (!DRY) {
    try {
      const r = await ask(SELF_ASSESSMENT_PROMPT, `eval_self_${Date.now()}`, []);
      answer = r.text || LATEST_SELF_ANSWER;
    } catch (e) {
      console.warn(`[eval] self-assessment call failed (${e.message}) — scoring the banked answer instead.`);
    }
  }
  const selfScores = parseSelfAssessment(answer);
  // Prefer this run's MEASURED category scores; fall back to the team baseline
  // for any category the battery didn't cover, so calibration is always grounded.
  const measured = {};
  for (const cat of CATEGORIES) measured[cat] = measuredCategories[cat] ?? TEAM_BASELINE[cat];
  const calibration = calibrate(selfScores, measured);
  return { answer, selfScores, calibration };
}

// ── main ─────────────────────────────────────────────────────────────────────
(async function main() {
  const probes = PROBES.filter((p) => !ONLY.length || ONLY.includes(p.category) || ONLY.includes(p.id));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  if (DRY) {
    console.log(`DRY RUN — ${probes.length} probes vs ${BASE}`);
    for (const p of probes) console.log(`  [${p.category}] ${p.id} — ${p.title} (${p.turns.length} turn${p.turns.length > 1 ? "s" : ""})`);
    if (SELF) console.log(`  [calibration] self-assessment probe (scores the banked answer in --dry)`);
  }

  const probeResults = [];
  for (const p of probes) {
    process.stdout.write(`• ${p.id} … `);
    if (DRY) { console.log("(dry)"); continue; }
    const r = await runProbe(p);
    probeResults.push(r);
    const passed = r.checks.filter((c) => c.pass).length;
    console.log(`${passed}/${r.checks.length} checks · ${r.latencyMs}ms`);
  }

  const agg = DRY ? { categories: Object.fromEntries(CATEGORIES.map((c) => [c, null])), overall: 0 } : aggregate(probeResults);

  // calibration (optional)
  let calibration = null, selfBlock = null;
  if (SELF) {
    selfBlock = await runSelfAssessment(agg.categories);
    calibration = selfBlock.calibration;
  }

  // trend vs the previous run
  const historyFile = path.join(RESULTS_DIR, "history.jsonl");
  let previous = null;
  try {
    const lines = fs.readFileSync(historyFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
    if (lines.length) previous = JSON.parse(lines[lines.length - 1]);
  } catch { /* first run */ }
  const trd = previous ? trend(agg, previous) : null;

  const meta = { runId, target: BASE, note: SELF ? "with calibration" : "" };
  const md = renderMarkdown({ agg, trd, calibration, meta });
  console.log("\n" + md + "\n");

  if (!DRY) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const full = { runId, base: BASE, categories: agg.categories, overall: agg.overall, calibration, probes: probeResults };
    fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify(full, null, 2));
    fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.md`), md);
    fs.appendFileSync(historyFile, JSON.stringify({ runId, categories: agg.categories, overall: agg.overall, calScore: calibration?.calScore ?? null }) + "\n");
    console.log(`→ results/${runId}.json · results/${runId}.md · appended history.jsonl`);
  }
})().catch((e) => { console.error("eval runner failed:", e); process.exit(1); });
