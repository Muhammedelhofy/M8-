/**
 * M8 L5 Phase B — VERIFY   ·   GET /api/cron-verify
 * Daily Vercel cron (01:15 — 15min after phase A, inside the warm window). Gates on
 * GET /health; if warm, re-checks a HUMAN-architected scaffold's already-drafted
 * leaf code via /check (NO re-draft, NO LLM) — the cold-start payoff. If cold, M4
 * skips and the run still counts (M4 is "where applicable"; the gate doesn't depend
 * on it). Then recomputes the promotion gate. Fail-safe. Kill: L5_LOOP_DISABLED=1.
 *
 * Auth: CRON_SECRET bearer.
 */
const { runVerifyPhase } = require("../lib/loop");

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
    const result = await runVerifyPhase({ log });
    res.status(200).json({ ok: true, phase: "verify", ...result, events });
  } catch (e) {
    res.status(200).json({ ok: false, phase: "verify", error: e.message, events });
  }
};
