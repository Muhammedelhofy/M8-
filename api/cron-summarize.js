/**
 * M8 Self-Heal Cron — GET /api/cron-summarize
 * Daily Vercel cron: sweeps recent sessions and re-runs the summarizer on any
 * that are stuck (summarizeSession self-gates, so it only acts on real gaps).
 * Catches sessions abandoned before their summary succeeded.
 */
const { sweepStuckSessions } = require("../lib/memory");

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
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
