/**
 * Web Push subscription sink  ·  /api/push-subscribe  (folded into ops via ?fn=)
 *   GET    -> { publicKey }            (the PUBLIC VAPID key, so the client can subscribe)
 *   POST   { subscription }            (save/upsert a PushSubscription)
 *   DELETE { endpoint }                (remove on unsubscribe / 410)
 * M8's own Supabase, service key. No secrets are ever returned (public key only).
 */
"use strict";
const { createClient } = require("@supabase/supabase-js");
function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
    }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};
    const sub = body.subscription || body;

    if (req.method === "POST") {
      const endpoint = sub && sub.endpoint;
      const p256dh = sub && sub.keys && sub.keys.p256dh;
      const auth = sub && sub.keys && sub.keys.auth;
      if (!endpoint || !p256dh || !auth) return res.status(400).json({ ok: false, error: "invalid subscription" });
      const { error } = await db()
        .from("m8_push_subscriptions")
        .upsert({ endpoint, p256dh, auth }, { onConflict: "endpoint" });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const endpoint = sub && sub.endpoint;
      if (!endpoint) return res.status(400).json({ ok: false, error: "endpoint required" });
      const { error } = await db().from("m8_push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    console.error("[push-subscribe] error", e && e.message);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};
