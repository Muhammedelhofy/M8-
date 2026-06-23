# M8 app — next-session build brief

**Model/effort:** Opus + MAX. **Branch:** worktree `m8-scifi` on `fun/scifi-ui`.
Pushing `main` AUTO-DEPLOYS prod `m8-alpha.vercel.app` — **never deploy without Muhammad's OK.**
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions** (currently AT 12).
NEVER add `api/*.js` — fold via `?fn=` (handler in `lib/handlers/` + a case in `api/ops.js`
+ a `vercel.json` rewrite). `ls api/*.js | wc -l` must stay ≤ 12.

## ✅ DONE this session — the assistant architecture (on branch, VERIFIED, NOT deployed)
`origin/main` = d2f7854. Branch HEAD = **3c620d5** (docs + 3 builds ahead).
The DB changes are ALREADY LIVE on the BOLT Supabase (additive/safe — old prod code ignores them).

1. **Tasks work/personal category** (63bcf24) — `m8_tasks.category` (default 'personal',
   backfilled, CHECK) · `api/tasks.js` validates + `?category` filter · chat parses
   "work/personal task" (EN+AR) · Tasks tab ALL/WORK/PERSONAL filter (doubles as the
   add-target) + amber WORK row tag. Verified 10/10 parser + UI screenshot.
2. **Task/Note/Money front door** (ba701c0) — new `m8_notes` store + `lib/notes.js`. Early
   lane `handleNotesCommand` (mirrored in both paths): explicit note capture ("note:" /
   "remember …" / AR) + code-templated recall ("my notes" / "notes about X") + confirm-gated
   free-form offers (imperative → task, personal money-fact → note) + confirm-commit from
   history. Guards stop chat/fleet/finance hijack; "remember/don't forget to …" route to TASK.
   Verified 28 parser cases + DB round-trip.
3. **Migrate old money-notes** (3c620d5) — "migrate my money notes" scans `m8_conversations`
   operational facts and offers ONE at a time → wallet (confirm yes/skip/stop), marking handled
   rows in `metadata` (never dropped). TIGHT matcher: personal-expense context + amount+currency,
   EXCLUDES fleet/business figures. Verified vs the real memory rows: include 3/3 (Omar lunch,
   deduped from 3 copies), exclude 12/12. Real item it will surface: **Omar Lord lunch 30 SAR → Dining**.

Live-test docs: `tests/TASKS_CATEGORY_LIVE_TEST.md`, `NOTES_ROUTER_LIVE_TEST.md`,
`MIGRATE_MONEY_NOTES_LIVE_TEST.md`.

## ⬜ NEXT — Build #4: ACTIVE Web Push reminders (Muhammad is on ANDROID → push works well)
Design (all folds into the 12-fn cap — NO new `api/*.js`):
- **dep:** add `web-push` to `package.json` (Vercel installs on build).
- **table** `m8_push_subscriptions` (endpoint text PK, p256dh, auth, created_at).
- **endpoint:** `lib/handlers/push-subscribe.js` + case in `api/ops.js` (`?fn=push-subscribe`)
  + `vercel.json` rewrite `/api/push-subscribe → /api/ops?fn=push-subscribe`.
  GET → `{publicKey: VAPID_PUBLIC_KEY}`; POST saves the subscription; DELETE removes it.
- **sw.js:** add `push` (registration.showNotification) + `notificationclick` (focus/open) handlers.
- **frontend:** an "Enable reminders" toggle → `Notification.requestPermission()` →
  `pushManager.subscribe({userVisibleOnly:true, applicationServerKey: urlB64ToUint8(publicKey)})`
  → POST `/api/push-subscribe`.
- **due-task cron:** `lib/handlers/push-cron.js` + case in ops (`?fn=push-cron`) + rewrite
  `/api/push-cron → /api/ops?fn=push-cron` + `vercel.json` cron `{path:"/api/push-cron",
  schedule:"*/15 * * * *"}` (CRON_SECRET bearer, like loop-attest). Reads `m8_tasks` due now &
  not done, sends web-push to all subs.
- **Muhammad's manual steps (non-eng → give click-by-click):** generate a VAPID keypair (no node
  on host → browser Web Crypto snippet or vapidkeys.com), set Vercel env `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (mailto:), deploy, install the PWA **from PRODUCTION**
  (previews are 401-walled), tap Enable reminders, device-test. NEVER paste the PRIVATE key in chat.

## Privacy wall (hold it)
Wallet text NEVER enters an LLM prompt/log. Money replies carry `MONEY_SENTINEL` (stripped from
history). Notes are general memory (separate from the walled wallet). Parse with code, not the model.

## No-node host
Verify JS via the browser-preview `new Function()` syntax check + run pure parsers via
`preview_eval`. Money DB writes need a round-trip audit (add → `[M8]` tag + `m8_wallet_writes`
row → delete). Preview: launch config **"m8-scifi"** (serve.ps1 now honors `$env:PORT`; autoPort
is on because 4188 is OS-reserved).
