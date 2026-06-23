/**
 * Due-task Web Push cron  ·  /api/push-cron  (folded into ops via ?fn=)
 * Vercel cron (every 15 min). Sends one push per device for tasks that have come
 * due (due_at <= end of today KSA), are not done, and haven't been reminded yet —
 * then stamps reminded_at so the same task is never pinged twice. Quiet hours:
 * only 07:00–21:59 KSA. Auth: CRON_SECRET bearer (Vercel injects it). No-op (200)
 * when VAPID keys aren't set, so it's safe to ship before the keys exist.
 */
"use strict";
const { createClient } = require("@supabase/supabase-js");
function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }
function ksaNow() { return new Date(Date.now() + 3 * 3600 * 1000); }
function ksaTodayISO() { const d = ksaNow(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(200).json({ ok: true, skipped: "VAPID keys not set" });
  }
  const h = ksaNow().getUTCHours();
  if (h < 7 || h >= 22) return res.status(200).json({ ok: true, skipped: "quiet hours", ksaHour: h });

  try {
    const sb = db();
    const todayEnd = ksaTodayISO() + "T23:59:59+03:00";
    const { data: due, error } = await sb.from("m8_tasks")
      .select("id, title, due_at, category")
      .eq("done", false).is("reminded_at", null)
      .not("due_at", "is", null).lte("due_at", todayEnd)
      .order("due_at", { ascending: true }).limit(20);
    if (error) throw error;
    if (!due || !due.length) return res.status(200).json({ ok: true, sent: 0, due: 0 });

    const { data: subs, error: sErr } = await sb.from("m8_push_subscriptions").select("*").limit(50);
    if (sErr) throw sErr;
    if (!subs || !subs.length) return res.status(200).json({ ok: true, sent: 0, due: due.length, note: "no subscriptions" });

    const webpush = require("web-push");
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:mohd.hofy@gmail.com",
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

    const titles = due.map((t) => t.title).slice(0, 4);
    const payload = JSON.stringify({
      title: due.length === 1 ? "Task due" : `${due.length} tasks due`,
      body: due.length === 1 ? titles[0] : titles.join(" · "),
      url: "/",
    });

    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        const code = e && e.statusCode;
        if (code === 404 || code === 410) { try { await sb.from("m8_push_subscriptions").delete().eq("endpoint", s.endpoint); } catch (_) {} }
      }
    }
    await sb.from("m8_tasks").update({ reminded_at: new Date().toISOString() }).in("id", due.map((t) => t.id));
    return res.status(200).json({ ok: true, sent, due: due.length });
  } catch (e) {
    console.error("[push-cron] error", e && e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
