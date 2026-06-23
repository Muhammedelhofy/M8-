# M8 app — next-session build brief

**Model/effort:** Opus + MAX (orchestrator + a money DB + the live 7am brief).
**Branch:** worktree `m8-scifi` on `fun/scifi-ui`. Pushing `main` AUTO-DEPLOYS prod
`m8-alpha.vercel.app` — **never deploy without Muhammad's OK.** Repo `Muhammedelhofy/M8-`.
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions**. NEVER add a new
`api/*.js`. Fold endpoints via the `?fn=` rewrite (handler body in `lib/handlers/`,
a `case` in `api/ops.js`, a `vercel.json` rewrite). Check `ls api/*.js | wc -l` ≤ 12.

## LIVE on prod (origin/main = b4cbbd3)
Deploy fix + wallet gate + read-only Money view + Tasks v2 chat lane + passive
reminders. `/api/wallet` is GATED: needs `x-m8-key` == env `M8_WALLET_KEY` (set),
fail-closed. To use Money: open it → enter the key once (stored on device).

## Built, AWAITING DEPLOY OK (fun/scifi-ui is 3 ahead of main)
- `c684de8` voice auto-detect (`lang:"auto"`; toggle now only steers reply voice).
- `b3b0fed` UI low-noise pass (orb rings removed, thinking→cyan/speaking→teal,
  header collapsed into one "•••" menu launcher, stop-button only while speaking,
  input-bar align-items:center).
- `bc3601f` money add-expense BACKEND + "Open Family Wallet" button (NOT wired yet).
→ Push `fun/scifi-ui`→`main` on OK to ship these.

## NEXT: finish add-expense + money chat (the write scope Muhammad wants)
Backend is in `lib/wallet.js` (`addExpense`, `auditWalletWrite`, `getCategorySpend`,
`inferCategory`). To make it work:

**Step 1 — run SQL on the WALLET DB `sjomysminfzohkbauahw` (SQL editor):**
```sql
GRANT INSERT (household_id, member_id, type, category, amount, currency, occurred_on, note, payment_method)
  ON public.transactions TO m8_wallet;
CREATE POLICY m8_wallet_insert_hofy ON public.transactions
  FOR INSERT TO m8_wallet
  WITH CHECK (household_id = '3c55a0a3-837c-41b8-96a9-abfe5395d3d7');
```
**Step 2 — run SQL on M8's OWN DB `ltqpoupferwituusxwal` (audit trail):**
```sql
CREATE TABLE IF NOT EXISTS public.m8_wallet_writes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action        text NOT NULL,
  wallet_txn_id text,
  amount        numeric,
  currency      text,
  category      text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```
(If `transactions.created_by` is NOT NULL without a default, the insert will fail —
the round-trip audit will show it; then either default it or grant+send created_by.)

**Step 3 — wire the money CHAT lane** in `lib/orchestrator.js` (mirror the Tasks v2
lane: a deterministic hard-route in both `orchestrate()` and `orchestrateStream()`,
on `baseMessage`+`history`, emit-once so it never streams past):
- "add 30 sar lunch" / "spent 30 on lunch" / "صرفت ٣٠ على الغداء" → parse amount +
  currency + note, `inferCategory()` → **confirm prompt** ("🧾 Confirm expense — add
  30 SAR · Dining · lunch? reply yes"). On "yes"/"نعم" with a matching confirm as the
  last history turn → `wallet.addExpense()`. Confirm-gate is stateless: re-parse the
  user's add command from `history[-2]` when `history[-1]` is the confirm prompt.
- "how much did I spend [this month]" → `getSummary().expense` (+ per-currency, delta);
  "groceries this month" → `getCategorySpend()`. Templated, numbers only.
- **🔒 CRITICAL PRIVACY FIX:** money-lane replies contain amounts → they must be
  EXCLUDED from the history that goes to the LLM on later turns (the wall says
  `amount` never enters a model prompt). Tag money replies with a sentinel and
  filter them out where `history` is mapped into the LLM messages (one place in
  orchestrate/orchestrateStream). Do this BEFORE shipping the lane.
- Offer to migrate existing M8 money-notes (e.g. "30 SAR Omar lunch") — confirm-gated,
  one at a time; never silently.

**Step 4 — deploy + AUDIT (before saying done):** add a test expense via M8 → confirm
it lands in the wallet WITH the `[M8]` note → confirm a row in `m8_wallet_writes` →
remove the test row. Re-confirm as `m8_wallet`: DELETE denied, balances/loans/cards
untouched. Privacy grep: no `console.log`/prompt contains a txn note/category/amount.

## ALSO QUEUED
- **Tasks work/personal category:** add a `category` column to `m8_tasks`
  (`ALTER TABLE m8_tasks ADD COLUMN category text DEFAULT 'personal'`), a tab filter
  (js/tasks.js), and parse it in the chat lane ("add work task …"). Tasks↔chat shared
  store already works (Build 2).
- **NOTES vs TASKS vs MONEY router:** M8 chat classifies what you tell it and routes:
  to-do → `m8_tasks`; money-note → wallet candidate (confirm to add); general note →
  memory. NOTES are a SEPARATE store, never shown in the Tasks tab. Answer from any.
- **Active Web Push** (reminders): VAPID env, `m8_push_subscriptions` table,
  `/api/push-subscribe` (FOLD into ops via `?fn=`), `sw.js` push+notificationclick,
  a due-task cron. Email-at-due-time is the simpler fallback.

## Device tests still outstanding
Voice EN+AR now auto-detects (no toggle needed). Confirm: typed→silent text /
spoken→spoken reply in the spoken language; Tasks panel persists; PWA v2 icon installs;
Money unlocks with the key.

## Privacy wall (keep holding it)
Wallet text (note/category/counterparty/amount) NEVER enters an LLM prompt or a log.
The Money VIEW + chat answers are deterministic + code-templated. Parse with code, not
the model; exclude money replies from LLM history.
