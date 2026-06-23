# Web Push reminders — setup + live test (assistant-architecture build #4)

Push notifications for tasks that have come due. Code is in; activation needs YOUR
VAPID keys + an Android device test. No new serverless function was added (folded
into `api/ops.js` — still 12/12).

## 1. Generate VAPID keys (no Node needed)
1. Double-click `generate-vapid.html` (opens in Chrome). It shows a Public + Private key.
2. Keep that tab open — you'll copy from it. (The private key is a secret — don't share it.)

## 2. Set env vars in Vercel (M8 project → Settings → Environment Variables → Production)
- `VAPID_PUBLIC_KEY`  = the public value
- `VAPID_PRIVATE_KEY` = the private value
- `VAPID_SUBJECT`     = `mailto:mohd.hofy@gmail.com`
Save. (CRON_SECRET is already set for the other crons — the cron reuses it.)

## 3. Deploy
Merge `fun/scifi-ui` → `main` (auto-deploys prod). Build installs the new `web-push`
dependency. If the build complains about a 5th cron on Hobby, see the note at the bottom.

## 4. Subscribe on your phone (Android)
1. Open `m8-alpha.vercel.app` in Chrome and **Install** the PWA (from PRODUCTION — previews are 401-walled).
2. Open the app → Tasks (•••) → tap the **🔔** in the Tasks header → **Allow** notifications.
   The bell turns cyan = this device is subscribed (`m8_push_subscriptions` gets a row).

## 5. Test delivery
- Add a task **due today** (e.g. "add task test reminder" with today's date, or "remind me to test today").
- Trigger the cron without waiting for 7am: Vercel → your project → **Crons** → `/api/push-cron` → **Run**.
- A notification should arrive on your phone. Tapping it focuses/opens M8.
- The task's `reminded_at` is stamped so it won't ping again.

## Frequency note (Hobby vs Pro)
- Vercel **Hobby caps cron frequency at once/day**, so the reminder runs **daily at 7:00 KSA**
  (it pings everything due that day, plus anything overdue not yet reminded). The 7am email
  brief still lists due tasks too.
- For true minute-level due-time pings, upgrade to **Pro** and change the `push-cron` schedule
  in `vercel.json` from `0 4 * * *` to `*/15 * * * *` (the handler already guards quiet hours 07–22 KSA).

## Privacy / safety
- Only the PUBLIC VAPID key is ever sent to the browser. The cron is CRON_SECRET-gated and
  is a no-op (HTTP 200) until the VAPID keys exist, so shipping before setup is safe.
