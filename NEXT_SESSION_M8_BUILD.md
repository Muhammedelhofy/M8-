# M8 app — next-session build brief

**Model/effort:** Opus + MAX (touches the orchestrator + a money DB + the live 7am brief).
**Branch:** worktree `m8-scifi` on `fun/scifi-ui`. Pushing `main` AUTO-DEPLOYS prod
`m8-alpha.vercel.app` — **never deploy without Muhammad's OK.** Repo `Muhammedelhofy/M8-`.

## Where things stand (2026-06-23b)
Built this session, **committed on `fun/scifi-ui`, NOT yet deployed** (4 commits ahead of
`origin/main`, linear/no conflict). Nothing is live until you push to `main`.
- **Build 1 — Money view (READ-ONLY)** ✅ `lib/wallet.js` + `api/wallet.js` (GET) + `js/money.js`
  + money panel. Slide-in 💰 panel: spend ring + In/Out tiles + templated insight cards.
  **Privacy wall:** `note` never read; no txn text logged/returned/sent to an LLM; strings
  code-templated. Render verified locally (success + error states).
- **Build 2 — Tasks v2 (chat/voice)** ✅ `handleTasksCommand()` in `lib/orchestrator.js`
  (hard-route lane in `orchestrate()` + `orchestrateStream()`, EN+AR). Classifier verified.
- **Build 3 (passive) — due tasks in 7am brief** ✅ `attachDueTasks()` in `lib/morning-brief.js`
  + renderers + cron. Zero regression when nothing is due; fails safe.

## ⚠️ SCOPE GAP — Build 1 was EXPANDED in this brief mid-session; the expansion is NOT built
The brief was updated 2026-06-23 (commits 29cceb7/15809a1, after the read-only build started) to
make Build 1 broader. **The read-only Money view above is done; the WRITE + money-CHAT scope below
is still TODO** and is "the part Muhammad actually tested + wants":
- **ADD an expense.** First extend the wallet grants (needs Muhammad's explicit OK on the money DB
  — he gave it 2026-06-23):
  `GRANT INSERT (household_id, member_id, type, category, amount, currency, occurred_on, note, payment_method) ON public.transactions TO m8_wallet;`
  + RLS INSERT policy `with check (household_id = '3c55a0a3-837c-41b8-96a9-abfe5395d3d7')`.
  Still NO delete; nothing on loans/cards/balances. Add `POST` add-expense to `api/wallet.js`,
  **every write confirm-gated** ("Add 30 SAR · lunch · Omar? yes/no").
- **Money CHAT lane** (mirror the Tasks v2 hard-route): "add 30 sar lunch", "how much did I spend",
  "what's groceries this month" → DETERMINISTIC parse → confirm → insert/read → templated reply
  (voice too). Privacy wall holds: the parse is code, not an LLM; stored txn text never goes to a model.
- **SAFETY/AUDIT (Muhammad asked):** (a) M8-added transactions carry a `[M8]` marker in `note` so
  they're findable in the Wallet app. (b) NEW `m8_wallet_writes` table in **M8's own** Supabase
  (`ltqpoupferwituusxwal`) logs every write (action, wallet txn id, amount, category, note, ts) —
  independent trail to reconcile/undo.
- **Money panel additions:** an **"Open Wallet"** button → `family-wallet.vercel.app`.
- Note: `js/money.js` currently has only the GET summary panel; the add-expense POST + the chat lane
  are not wired yet. (A parallel session may be working this — coordinate before overlapping files.)

## START HERE next session: DEPLOY + live-verify (gated on Muhammad's OK)
Backends can only be truly tested on a real deploy (local `serve.ps1` is static; `/api/*` 404s).
1. **Decide /api/wallet auth** 🔴 — currently UNAUTHENTICATED like `/api/tasks`. Returns financial
   totals only (no line-item text), but money is sensitive. Leave as-is / gate with a secret /
   PIN-gate the panel. Decide before prod.
2. **Maybe set `WALLET_SUPABASE_ANON_KEY`** — if Money 401s with "No API key", add the wallet's
   PUBLIC anon key (in `FamilyWallet/config.js`) as this env var. Code prefers it, falls back to the JWT.
3. **Deploy** (only on OK): push `fun/scifi-ui` → `main`. Vercel build is atomic (bad build keeps old).
4. **Live-verify:** open 💰 Money (real Hofy Home numbers; if "couldn't reach", check Vercel `[wallet]`
   logs). Chat: "add task test", "what's on my list", "mark test done", "delete test" (EN+AR). Next
   7am brief shows "Tasks due today" if any.

## Device tests still outstanding (need the installed app on his phone)
- Voice: speak EN **and** AR → transcribes? 🔴 **Language is a manual toggle (defaults EN), not
  auto-detect** — to dictate Arabic, tap عر first, else Whisper is forced to `en`. (Consider
  auto-detect — omit the `language` param in `/api/transcribe`.)
- Modality: typed → silent text; spoken → spoken reply. Tasks v1 panel persists. PWA installs with v2 icon.

## THEN BUILD — active Web Push (the "bigger" reminder build, deferred)
Real ping when the app is closed: VAPID keys (env), `m8_push_subscriptions` table, `POST
/api/push-subscribe`, `push`+`notificationclick` handlers in `sw.js`, a `/api/cron-reminders` that
sends due-task pushes. Email-at-due-time is the simpler fallback.

## FINAL NOTES (2026-06-23, restored)
- **Existing M8 money-notes must NOT be lost.** M8 holds a few money mentions in memory (e.g.
  "30 SAR Omar lunch"). On wallet write go-live, M8 should OFFER to add them (confirm-gated, one at
  a time), not silently drop them.
- **JWT minting:** HS256 `{ role:"m8_wallet" }` + short exp, signed with `WALLET_JWT_SECRET`.
  `jsonwebtoken` is NOT in package.json → already hand-rolled with Node `crypto` in `lib/wallet.js`.
- **Post-build AUDIT before saying done (Muhammad values this):** round-trip — add a test expense via
  M8 → confirm it lands in the wallet WITH the `[M8]` note → confirm a row in `m8_wallet_writes` →
  remove the test row. Re-confirm as `m8_wallet`: DELETE denied, balances/loans/cards untouched.
- **Privacy re-check:** grep the wallet code — no `console.log`/prompt string ever contains a txn's
  note/category/amount/counterparty. (Read path already clean.)

## Privacy wall (keep holding it)
Family-wallet transaction text must NEVER enter an LLM prompt or a log. The Money VIEW is a
deterministic screen on purpose. For the money chat lane, parse with CODE (like Tasks v2) and confirm
— never feed stored transaction text to the model. Totals-only, code-templated.

## Nav
Tasks + Diagnostics + Money are slide-in panels off header glyphs. Promote to a real bottom nav
(Chat | Tasks | Money | Home) only when it earns it; keep low-noise.
