/**
 * M8 Track-A — GET /api/morning-brief  (Build-68)
 *
 * Daily Vercel cron (3:00 AM UTC = 6:00 AM Riyadh): fetches the live fleet data,
 * computes the 3-section morning brief deterministically, and upserts ONE row per
 * date into m8_morning_briefs (so a re-run the same morning overwrites). The chat
 * path (lib/orchestrator.js -> getTodayBrief) reads this row so the brief is
 * instant and consistent all day.
 *
 * Fails SAFE: any error returns a JSON error, never throws to Vercel.
 */
const { getFleetRecord, decodeHistory } = require("../lib/fleet");
const { generateMorningBrief, saveBrief, formatBriefHTML, attachNudgeActivity, attachDueTasks } = require("../lib/morning-brief");
const { isBriefEmailEnabled, ensureBriefPrefs, sendEmail, unsubscribeUrl } = require("../lib/notify");

module.exports = async function handler(req, res) {
  // Optional protection: if CRON_SECRET is set, require it (Vercel cron sends it).
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  try {
    const record = await getFleetRecord();
    if (!record) {
      return res.status(200).json({ ok: false, error: "no fleet record available" });
    }
    const entries = decodeHistory(record);
    const brief = generateMorningBrief(entries);
    await attachNudgeActivity(brief).catch(() => {}); // Build-96: weekly nudge line in cron email
    await attachDueTasks(brief).catch(() => {});      // Reminders: due-today tasks in cron email

    // Persist (one row per date). saveBrief fails SAFE (null), so a Supabase
    // hiccup still returns the computed brief to the caller.
    await saveBrief(brief);

    // ── DELIVERY (Build-70): email the brief — inert without RESEND_API_KEY,
    // silenced by the env hard-off or the unsubscribe flag. Fails SAFE: an email
    // problem never fails the cron (the brief is already stored).
    let email = { skipped: true };
    try {
      if (await isBriefEmailEnabled()) {
        const prefs = await ensureBriefPrefs();
        const html = formatBriefHTML(brief, unsubscribeUrl(prefs.unsubscribe_token));
        const subjBits = [`Fleet brief ${brief.asOfDate || brief.date}`];
        if (brief.counts.dropped) subjBits.push(`⚠ ${brief.counts.dropped} dropped`);
        subjBits.push(`${brief.counts.onTrack} on track / ${brief.counts.below} below`);
        email = await sendEmail({ to: prefs.recipient, subject: subjBits.join(" · "), html });
      }
    } catch (mailErr) {
      console.error("[M8 morning-brief] email error (non-fatal):", mailErr.message);
      email = { ok: false, error: mailErr.message };
    }

    return res.status(200).json({
      ok: true,
      date: brief.date,
      asOfDate: brief.asOfDate || null,
      driversOnTrack: brief.counts.onTrack,
      driversBelow: brief.counts.below,
      droppedYesterday: brief.counts.dropped,
      email,
    });
  } catch (e) {
    console.error("[M8 morning-brief] fatal (non-fatal to cron):", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
