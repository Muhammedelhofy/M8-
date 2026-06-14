/**
 * M8 L5 Phase A — OBSERVE   ·   GET /api/cron-explore
 * Daily Vercel cron (01:00). Warmup-ping the Lean checker (starts the ~9.5min
 * Mathlib import so phase B finds it warm), then run the cheap, Lean-free legs:
 * M1 observe -> M3 hypothesize/test (PURE CODE, NO LLM) -> M3.1 cluster/queue ->
 * record the day's m8_loop_runs row. Fail-safe: a leg error degrades the run; the
 * row is still written. Kill: L5_LOOP_DISABLED=1.
 *
 * Auth: CRON_SECRET bearer (Vercel cron sends it) — same posture as cron-summarize.
 */
const { runObservePhase } = require("../lib/loop");

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }
  const events = [];
  const log = (ev, data) => events.push({ ev, ...(data || {}) });
  try {
    const result = await runObservePhase({ log });
    res.status(200).json({ ok: true, phase: "observe", ...result, events });
  } catch (e) {
    // runObservePhase fails safe, but never let the handler 500 silently.
    res.status(200).json({ ok: false, phase: "observe", error: e.message, events });
  }
};
