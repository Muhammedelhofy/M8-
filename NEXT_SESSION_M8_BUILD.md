# M8 app — next-session build brief

**Model/effort:** Opus + MAX (orchestrator + a money DB + the live 7am brief).
**Branch:** worktree `m8-scifi` on `fun/scifi-ui`. Pushing `main` AUTO-DEPLOYS prod
`m8-alpha.vercel.app` — **never deploy without Muhammad's OK.** Repo `Muhammedelhofy/M8-`.
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions**. NEVER add a new
`api/*.js`. Fold endpoints via the `?fn=` rewrite (handler body in `lib/handlers/`,
a `case` in `api/ops.js`, a `vercel.json` rewrite). Check `ls api/*.js | wc -l` ≤ 12.

## LIVE on prod (origin/main = d2f7854) — all shipped + verified
- Deploy-fix (wallet folded into `ops`, 12 funcs) + `/api/wallet` GATE (`x-m8-key` ==
  env `M8_WALLET_KEY`, fail-closed). Open Money → enter the key once (stored on device).
- Read-only Money view (ring + In/Out + insight cards) + "Open Family Wallet" button.
- Tasks v2 chat lane + passive due-task reminders in the 7am brief.
- Voice auto-detect (`lang:"auto"`; toggle steers only the reply voice).
- UI low-noise pass (calm cyan orb no rings, one "•••" menu launcher, stop-only-while-
  speaking, aligned input bar).
- **Money chat + ADD-EXPENSE — WORKING + round-trip verified.** "add 30 sar lunch" →
  confirm → `yes` → inserts (tagged `[M8]`, audited to `m8_wallet_writes`); "how much
  did I spend"/"groceries this month" → code-computed totals. Privacy: money replies
  are stripped from LLM history (amounts never reach a model prompt).

## ★ Wallet REST auth — both env vars matter (cost a debug cycle, now fixed)
- `WALLET_SUPABASE_URL`, `WALLET_JWT_SECRET` (the JWT **Secret** — a plain string, NOT a
  key `eyJ…`), **`WALLET_SUPABASE_ANON_KEY`** (the wallet's PUBLIC anon key — required as
  the gateway `apikey`; the minted custom-role JWT is NOT accepted as apikey). All set.
  `lib/wallet.js` logs the Supabase body on 401/403 only (auth msgs, never rows) for future debugging.

## QUEUED (Muhammad's architecture — next builds)
- **Tasks work/personal category:** `ALTER TABLE m8_tasks ADD COLUMN category text DEFAULT
  'personal'`; tab filter (js/tasks.js); parse in the chat lane ("add work task …").
- **NOTES vs TASKS vs MONEY router:** M8 chat classifies what you tell it → to-do →
  `m8_tasks`; money-note → wallet candidate (confirm to add); general note → memory.
  NOTES are a SEPARATE store, never in the Tasks tab. Answer from any of the three.
- **Offer to migrate existing M8 money-notes** ("30 SAR Omar lunch" held in memory) →
  confirm-gated add to the wallet, one at a time; never silently.
- **Active Web Push** (reminders): VAPID env, `m8_push_subscriptions` table,
  `/api/push-subscribe` (FOLD into ops via `?fn=`), `sw.js` push+notificationclick,
  a due-task cron. Email-at-due-time is the simpler fallback.

## Device tests still worth a glance
Voice EN+AR auto-detects (no toggle needed); typed→silent / spoken→spoken reply in the
spoken language; Tasks panel persists; PWA v2 icon installs; Money unlocks with the key
and shows real numbers; "add 30 sar lunch" in chat round-trips with an `[M8]` tag.

## Privacy wall (keep holding it)
Wallet text (note/category/counterparty/amount) NEVER enters an LLM prompt or a log. The
Money view + chat answers are deterministic + code-templated; money turns are stripped
from LLM history. Parse with code, not the model.
