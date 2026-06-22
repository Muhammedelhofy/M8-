/**
 * Build-115 — Engine Learn Status (lib/learn-status.js)
 *
 * Deterministic, READ-ONLY chat lane that surfaces what the math engine
 * has accumulated: survivor productivity by template (m8_research_notes)
 * and the generation-steering state (m8_loop_runs.metadata).
 *
 * HONESTY (preserved verbatim from B113/B114 contracts):
 *   - A survivor is computational EVIDENCE of falsification-resistance, never proof.
 *   - The gate (N-verifications threshold) measures GENERATION QUALITY, not truth.
 *   - This module never writes to any table.
 *
 * FAIL-SAFE: fetchLearnStatus never throws; returns { survivors:[], loopRun:null }
 * on any error. buildLearnStatusPacket is PURE and PS-mirror-tested.
 */

const NOTES_TABLE  = "m8_research_notes";
const RUNS_TABLE   = "m8_loop_runs";
const M3_MARKER    = "[M3-lite machine-generated conjecture";
const NOTES_LIMIT  = 1000;

// ── DETECTION ────────────────────────────────────────────────────────────────
// Catch "what has the engine learned", "show survivor productivity",
// "loop learn status", "what's M8 learned", "show me what the engine knows" —
// WITHOUT clashing with the loop-recall RE (which owns "loop results / findings /
// what did the loop find overnight") or the review-queue / graph lanes.
const LEARN_STATUS_RE = /\b(?:what(?:\s+has|\s+did|'s|\s+does)?\s+(?:the\s+)?(?:engine|m8)\s+(?:learn(?:ed)?|know|discover(?:ed)?|remember(?:ed)?)\b|show\s+(?:me\s+)?(?:survivor\s+productivity\b|what\s+(?:the\s+)?(?:engine|m8)\s+(?:learn(?:ed)?|knows?|found?)\b)|(?:loop|engine)\s+learn\s+(?:status|state)\b|survivor\s+(?:productivity\b|leaderboard\b|template\s+stats?\b|stats?\s+by\s+template\b)|what(?:\s+does)?\s+(?:the\s+engine|m8)\s+(?:know|remember)\s+(?:about\s+)?(?:collatz\s+)?(?:patterns?|templates?)\b)/i;

function detectLearnStatus(message) {
  const s = String(message || "").trim();
  if (s.length < 6) return false;
  return LEARN_STATUS_RE.test(s);
}

// ── PURE PARSING HELPERS (PS-mirror-tested) ──────────────────────────────────

// Extract the template name from a M3-lite note, e.g.
//   "Conjecture (type A, template A_peak_power): for all..." -> "A_peak_power"
const _TMPL_RE = /template\s+([A-Za-z][A-Za-z0-9_]+)\)/;
function parseTemplate(content) {
  const m = _TMPL_RE.exec(String(content || ""));
  return m ? m[1] : null;
}

// Extract the numeric test bound from a M3-lite note.
// Content contains either "n <= 100,000" or "tested to 100,000 only".
const _BOUND_RE = /(?:n\s*<=|tested\s+to)\s*([\d,]+)/i;
function parseBound(content) {
  const m = _BOUND_RE.exec(String(content || ""));
  if (!m) return 0;
  return parseInt(m[1].replace(/,/g, ""), 10) || 0;
}

// ── SUPABASE READS (fail-safe) ────────────────────────────────────────────────

async function fetchLearnStatus(db) {
  let survivors = [];
  let loopRun   = null;

  // (a) Survivor leaderboard from m8_research_notes
  try {
    const { data, error } = await db
      .from(NOTES_TABLE)
      .select("content")
      .eq("thread", "collatz-m3")
      .ilike("content", `%${M3_MARKER}%`)
      .limit(NOTES_LIMIT);
    if (error) {
      console.error("[M8] learn-status notes query error (non-fatal):", error.message);
    } else {
      const counts    = {};
      const maxBounds = {};
      for (const row of (data || [])) {
        const tmpl = parseTemplate(row.content);
        if (!tmpl) continue;
        counts[tmpl]    = (counts[tmpl] || 0) + 1;
        const b = parseBound(row.content);
        if (b > (maxBounds[tmpl] || 0)) maxBounds[tmpl] = b;
      }
      survivors = Object.keys(counts)
        .map((template) => ({ template, count: counts[template], maxBound: maxBounds[template] || 0 }))
        .sort((a, b) => b.count - a.count || a.template.localeCompare(b.template));
    }
  } catch (e) {
    console.error("[M8] learn-status notes exception (non-fatal):", e && e.message);
  }

  // (b) Steering / learn state from m8_loop_runs
  try {
    const { data, error } = await db
      .from(RUNS_TABLE)
      .select("run_date, metadata")
      .order("run_date", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[M8] learn-status runs query error (non-fatal):", error.message);
    } else if (data && data.length) {
      loopRun = data[0];
    }
  } catch (e) {
    console.error("[M8] learn-status runs exception (non-fatal):", e && e.message);
  }

  return { survivors, loopRun };
}

// ── PURE FORMATTER (PS-mirror-tested) ────────────────────────────────────────

function buildLearnStatusPacket({ survivors, loopRun }) {
  const lines = [];

  lines.push("ENGINE LEARN STATUS — deterministic read (Build-115). Read-only view of accumulated evidence.");
  lines.push("Evidence is COMPUTATIONAL, never proof. The gate measures GENERATION QUALITY, not truth.");
  lines.push("");

  // ── (a) Survivor productivity leaderboard ──────────────────────────────────
  lines.push("SURVIVOR PRODUCTIVITY LEADERBOARD");
  lines.push("(templates whose conjectures most often survive exhaustive falsification)");
  if (!survivors || survivors.length === 0) {
    lines.push("  No M3-lite survivor notes recorded yet in m8_research_notes.");
  } else {
    const total = survivors.reduce((s, r) => s + (r.count || 0), 0);
    for (const r of survivors) {
      const pct   = total > 0 ? Math.round(((r.count || 0) / total) * 100) : 0;
      const bound = r.maxBound > 0
        ? Number(r.maxBound).toLocaleString("en-US")
        : "?";
      lines.push(`  ${r.template.padEnd(22)}  x${r.count} survivors (${pct}%)  tested to ${bound}`);
    }
    lines.push("");
    lines.push(`  Total survivor notes: ${total}  |  Distinct templates: ${survivors.length}`);
    lines.push("  NOTE: high count = template repeatedly survives falsification — NOT that the conjecture is true or novel.");
  }

  lines.push("");

  // ── (b) Generation-steering state ─────────────────────────────────────────
  lines.push("GENERATION STEERING STATE (Build-112/113):");
  if (!loopRun) {
    lines.push("  No m8_loop_runs rows found — cron has not run yet.");
  } else {
    const meta  = loopRun.metadata || {};
    const learn = meta.learn || {};
    const genV  = meta.gen_version != null ? meta.gen_version : "?";
    lines.push(`  Latest cron run: ${loopRun.run_date}   gen_version: ${genV}`);

    if (String(genV) === "2") {
      lines.push("  B112 FEEDBACK: generator reads verified Lean outcomes when proposing.");
      lines.push(`    success_patterns: ${learn.success_patterns || 0}  |  failed_patterns: ${learn.failed_patterns || 0}`);
      lines.push("  B113 COHORT STEERING: pending next cron-explore run (gen_version will flip to 3).");
    } else if (Number(genV) >= 3) {
      lines.push("  B113 COHORT STEERING active — generator down-weights over-explored template regions.");
      if (learn.gen_steered  != null) lines.push(`    gen_steered:      ${learn.gen_steered}`);
      if (learn.down_weighted != null) lines.push(`    down_weighted:    ${learn.down_weighted}`);
      if (learn.survivor_templates != null) lines.push(`    survivor_templates used: ${learn.survivor_templates}`);
      if (learn.success_patterns   != null) lines.push(`    success_patterns: ${learn.success_patterns}`);
      if (learn.failed_patterns    != null) lines.push(`    failed_patterns:  ${learn.failed_patterns}`);
    } else {
      lines.push("  Loop metadata present but gen_version unknown — output raw.");
      lines.push(`    raw learn: ${JSON.stringify(learn)}`);
    }

    const ep = learn.earned_patterns;
    if (ep == null || ep === 0) {
      lines.push("");
      lines.push("  LEAN GATE: earned_patterns: 0");
      lines.push("  No template region has yet verified >= " + (learn.min_verifs || 3) + " times in Lean.");
      lines.push("  The PREFER (steer-toward) block is SILENT — correct and cautious by design.");
      lines.push("  Steering becomes active only once a technique accumulates verified leaves.");
    } else {
      lines.push("");
      lines.push(`  LEAN GATE: earned_patterns: ${ep} — ${ep} template region(s) have verified >= ${learn.min_verifs || 3} times`);
      lines.push("  and now actively steer generation toward those structural approaches.");
    }
  }

  lines.push("");
  lines.push("HONESTY CONTRACT:");
  lines.push("  Survivors are machine-generated, falsification-tested to the stated bound ONLY.");
  lines.push("  A survivor is NOT proven true, NOT established, NOT novel.");
  lines.push("  The gate and leaderboard measure GENERATION QUALITY — how often a template");
  lines.push("  avoids easy disproof — not mathematical truth or novelty.");

  return lines.join("\n");
}

module.exports = {
  detectLearnStatus,
  fetchLearnStatus,
  buildLearnStatusPacket,
  // pure helpers (exported for PS mirror tests)
  parseTemplate,
  parseBound,
  LEARN_STATUS_RE,
  NOTES_TABLE,
  RUNS_TABLE,
  M3_MARKER,
};
