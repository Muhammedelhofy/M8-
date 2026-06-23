# M8 app — next-session build brief

**Model/effort:** Opus + MAX. **Branch:** worktree `m8-scifi` on `fun/scifi-ui`.
Pushing `main` AUTO-DEPLOYS prod `m8-alpha.vercel.app` — **never deploy without Muhammad's OK.**
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions** (currently AT 12, verified).
NEVER add `api/*.js` — fold via `?fn=` (handler in `lib/handlers/` + a case in `api/ops.js`
+ a `vercel.json` rewrite). `ls api/*.js | wc -l` must stay ≤ 12.

## ✅ DONE this session — the assistant architecture, all 4 builds — DEPLOYED to prod ✅
**LIVE on `m8-alpha.vercel.app`** — `main` = `origin/main` = **98d6d32** (deploy `dpl_7LSjj5…` READY,
`/api/health` ok, sha 98d6d32, **12/12** functions). Builds 1–3 are usable now; **Build #4 (Web Push)
is live but DORMANT until VAPID env is set** (push-cron is a no-op without keys). `fun/scifi-ui` may
sit 1 doc-commit ahead of `main` — that's fine.

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

## ⬜ REMAINING — activate Web Push (1–3 are already deployed + usable)
- **Activate #4 Web Push** (`tests/WEB_PUSH_SETUP_LIVE_TEST.md`): (1) double-click
  `generate-vapid.html` → set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` in Vercel
  (Production); (2) deploy; (3) install the PWA from PROD on Android, open Tasks, tap 🔔, Allow;
  (4) add a task due today → run `push-cron` from the Vercel dashboard → confirm the notification.
  Hobby = daily cron (7am KSA); Pro + `*/15` = minute-level due-time. NEVER paste the VAPID
  private key in chat.

## Privacy wall (hold it)
Wallet text NEVER enters an LLM prompt/log. Money replies carry `MONEY_SENTINEL` (stripped from
history). Notes are general memory (separate from the walled wallet). Parse with code, not the model.

## No-node host
Verify JS via the browser-preview `new Function()` syntax check + run pure parsers via
`preview_eval`. Money DB writes need a round-trip audit (add → `[M8]` tag + `m8_wallet_writes`
row → delete). Preview: launch config **"m8-scifi"** (serve.ps1 honors `$env:PORT`; autoPort on
because 4188 is OS-reserved).
