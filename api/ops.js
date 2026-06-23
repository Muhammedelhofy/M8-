/**
 * api/ops.js — Router (Hobby 12-function consolidation, 2026-06-21)
 *
 * health + loop-attest + notify-prefs share ONE serverless function, dispatched by
 * ?fn=. The handler bodies are UNCHANGED — each lives verbatim in lib/handlers/.
 * vercel.json rewrites preserve the externally-FIXED URLs so their callers (which
 * we cannot edit) keep working unchanged:
 *   /api/health       -> /api/ops?fn=health        (GET provider/Supabase status + SHA)
 *   /api/loop-attest  -> /api/ops?fn=loop-attest    (POST Odysseus attestation; nightly
 *                                                    local grader, CRON_SECRET bearer)
 *   /api/notify-prefs -> /api/ops?fn=notify-prefs   (GET un/resubscribe link in brief
 *                                                    emails; returns an HTML page)
 *   /api/wallet       -> /api/ops?fn=wallet         (GET privacy-walled Family Wallet
 *                                                    money summary; see lib/handlers/wallet)
 * Query params (notify-prefs action/token) and POST body/headers (loop-attest bearer)
 * pass through the rewrite untouched.
 */
"use strict";

const health       = require("../lib/handlers/health");
const loopAttest   = require("../lib/handlers/loop-attest");
const notifyPrefs  = require("../lib/handlers/notify-prefs");
const wallet       = require("../lib/handlers/wallet");
const pushSubscribe = require("../lib/handlers/push-subscribe");
const pushCron      = require("../lib/handlers/push-cron");

module.exports = async (req, res) => {
  const fn = String((req.query && req.query.fn) || "").toLowerCase();
  switch (fn) {
    case "health":         return health(req, res);
    case "loop-attest":    return loopAttest(req, res);
    case "notify-prefs":   return notifyPrefs(req, res);
    case "wallet":         return wallet(req, res);
    case "push-subscribe": return pushSubscribe(req, res);
    case "push-cron":      return pushCron(req, res);
    default:
      return res.status(404).json({ error: `unknown ops fn: '${fn}'` });
  }
};

module.exports.config = { maxDuration: 30 };
