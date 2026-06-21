/**
 * M8 Self-Heal Cron — GET /api/cron-summarize
 * Daily Vercel cron: sweeps recent sessions and re-runs the summarizer on any
 * that are stuck (summarizeSession self-gates, so it only acts on real gaps).
 * Catches sessions abandoned before their summary succeeded.
 *
 * Build-10: also runs the research-memory-graph sweep (embedding backfill +
 * Gemini extraction over unprocessed notebook entries, budget-capped). Reuses
 * this function on purpose — Vercel Hobby's 12-function cap stays respected.
 * The graph sweep is fail-safe and NEVER affects the summary sweep result.
 */
const { sweepStuckSessions, sweepEntityExtraction } = require("../lib/memory");

module.exports = async function handler(req, res) {
  // Optional protection: if CRON_SECRET is set, require it (Vercel cron sends it).
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }
  try {
    const result = await sweepStuckSessions();

    // Build-10 graph sweep — lazy require + own catch: a graph bug can neither
    // crash this function nor mask a successful summary sweep.
    let graph = null;
    if (process.env.GRAPH_DISABLED !== "1") {
      try {
        const { runGraphSweep } = require("../lib/memory-graph");
        graph = await runGraphSweep();
      } catch (gErr) {
        graph = { error: gErr.message };
      }
    }

    // Build-110 (item 2): nightly entity-extraction sweep — own try/catch so a
    // failure can neither crash this function nor mask the summary/graph sweeps.
    let entities = null;
    if (process.env.ENTITY_SWEEP_DISABLED !== "1") {
      try {
        entities = await sweepEntityExtraction();
      } catch (eErr) {
        entities = { error: eErr.message };
      }
    }

    res.status(200).json({ ok: true, ...result, graph, entities });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
