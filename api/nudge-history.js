/**
 * M8 Track-A — GET /api/nudge-history  (Build-96)
 *
 * The read side of the driver-nudge audit trail (m8_nudge_log, written by
 * lib/nudge-logger.js when lib/nudges.js drafts messages).
 *
 *   /api/nudge-history?driver=<name>&days=<N>   -> one driver's recent nudges
 *   /api/nudge-history?days=<N>                 -> fleet-wide weekly summary only
 *
 * Fails SAFE: any error returns JSON, never throws to Vercel. days defaults to 7
 * and is clamped to [1, 365]; missing driver returns the summary with empty history.
 */
const { getNudgeHistory, getNudgeSummary, clampDays } = require("../lib/nudge-logger");

module.exports = async function handler(req, res) {
  try {
    const q = req.query || {};
    const driver = (q.driver || "").toString().trim();
    const days = clampDays(q.days);

    if (!driver) {
      // No driver -> fleet-wide summary (no per-driver history).
      const summary = await getNudgeSummary(null, days);
      return res.status(200).json({
        driver: null,
        days,
        history: [],
        summary: { count: summary.totalSent, tones: summary.byTone },
      });
    }

    const rows = await getNudgeHistory(null, driver, days);
    const history = rows.map((r) => ({
      tone: r.tone_bucket,
      preview: r.message_preview,
      triggerReason: r.trigger_reason,
      driverNet: r.driver_net_sar,
      sentAt: r.created_at,
    }));
    const tones = {};
    for (const h of history) tones[h.tone] = (tones[h.tone] || 0) + 1;

    return res.status(200).json({
      driver,
      days,
      history,
      summary: { count: history.length, tones },
    });
  } catch (e) {
    console.error("[M8 nudge-history] error (non-fatal):", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
