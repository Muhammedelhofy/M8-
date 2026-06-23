# M8 app — next-session build brief

**Model/effort:** Opus + MAX. **Branch:** worktree `m8-scifi` on `fun/scifi-ui`.
Pushing `main` AUTO-DEPLOYS prod `m8-alpha.vercel.app` — **never deploy without Muhammad's OK.**
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions** (currently AT 12, verified).
NEVER add `api/*.js` — fold via `?fn=` (handler in `lib/handlers/` + a case in `api/ops.js`
+ a `vercel.json` rewrite). `ls api/*.js | wc -l` must stay ≤ 12.

## ✅ DONE this session — the assistant architecture, all 4 builds — DEPLOYED to prod ✅
**LIVE on `m8-alpha.vercel.app`** — `main` = `origin/main` = **8509dfb** (12/12 functions, `/api/health`
ok). All 4 builds deployed. **Web Push ACTIVATED + verified end-to-end on Muhammad's Android**
(VAPID env set; PWA installed; 🔔 → FCM subscription saved; "remind me to test push today" → ran
`/api/push-cron` → notification delivered, tap opened M8, `reminded_at` stamped). `fun/scifi-ui`
tracks `main`.

1. **Tasks work/personal category** (63bcf24) — `m8_tasks.category` + `api/tasks.js` + chat parse
   (EN+AR) + Tasks-tab ALL/WORK/PERSONAL filter (doubles as add-target) + amber WORK tag.
2. **Task/Note/Money front door** (ba701c0) — new `m8_notes` + `lib/notes.js` + `handleNotesCommand`
   (both paths): explicit note capture/recall + confirm-gated free-form offers (imperative→task,
   money-fact→note) + confirm-commit. Guards stop chat/fleet hijack.
3. **Migrate old money-notes** (3c620d5) — `handleMoneyNoteMigration`: "migrate my money notes"
   → one-at-a-time → wallet (confirm/skip/stop), marks handled in metadata. TIGHT matcher (incl
   3/3 / excl 12/12 vs real data); surfaces the pending Omar lunch 30 SAR.
4. **Active Web Push reminders** (1f550a1) — `m8_push_subscriptions` + `m8_tasks.reminded_at`;
   `lib/handlers/push-subscribe.js` + `lib/handlers/push-cron.js` folded into `api/ops.js`
   (still 12/12); `vercel.json` rewrites + a daily `push-cron`; `web-push` dep; `sw.js`
   push/notificationclick; 🔔 toggle in the Tasks header. **Built + structurally verified, NOT
   activated** (needs VAPID env + device test).

Verified on the no-node host: syntax-compiled, parsers pass (10 + 28 + matcher 15/15), DB
round-trips, UI screenshots, function count 12/12. Live-test docs in `tests/`.

## ✅ Web Push — ACTIVATED + verified (nothing left to set up)
VAPID env is set in Vercel Prod; an Android FCM subscription is live in `m8_push_subscriptions`;
the cron delivered a real notification. Cron = **daily 7am KSA** (Hobby once/day cap). Future: Pro
+ change `push-cron` schedule to `*/15` for minute-level due-time. NEVER paste the VAPID private key.

## ⬜ OPTIONAL — leftover items (Muhammad's call)
- **Migrate the Omar money-note:** say "migrate my money notes" → "yes" to add Omar lunch 30 SAR to
  the wallet (real write; round-trip-audit the `[M8]` tag). Not yet run.
- Clear the throwaway **`test push`** task from the Tasks tab if you like.

## Privacy wall (hold it)
Wallet text NEVER enters an LLM prompt/log. Money replies carry `MONEY_SENTINEL` (stripped from
history). Notes are general memory (separate from the walled wallet). Parse with code, not the model.

## No-node host
Verify JS via the browser-preview `new Function()` syntax check + run pure parsers via
`preview_eval`. Money DB writes need a round-trip audit (add → `[M8]` tag + `m8_wallet_writes`
row → delete). Preview: launch config **"m8-scifi"** (serve.ps1 honors `$env:PORT`; autoPort on
because 4188 is OS-reserved).
