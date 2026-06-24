# Build-135 — Wallet "latest / recent expense" read — LIVE TEST

**What shipped:** M8 can now answer *"what's my last expense?"* — including expenses
you logged **in the Wallet app**, not just ones M8 itself added. Read-only, privacy
wall intact (amount / category / date only — the note free-text is never read).

**Why:** before this, that question hit a hard-coded "I can't look up past
transactions" decline, because M8 only knew about its *own* writes (`getLastM8Write`)
and aggregate totals — never an individual wallet row.

---

## Offline (already passed)
- `M8/tests/build135-wallet-recent-test.ps1` → **15/15** routing cases (EN + AR,
  accept + reject, Arabic-Indic digit counts).

## Live chat questions (run on m8-alpha after deploy)

| # | Type this | Expect |
|---|-----------|--------|
| 1 | `what's my last expense?` | `Your last expense: 30 SAR · Food · yesterday.` (or today's newest) |
| 2 | `show my last 3 expenses` | a 3-line list, newest first |
| 3 | `ما آخر مصروف؟` | `آخر مصروف: …` in Arabic with relative date |
| 4 | `آخر ٣ مصاريف` | 3-line Arabic list |
| 5 | `what did i last spend on?` | the latest expense (not a monthly total) |
| 6 | `change the last expense to 40` | still the **edit** confirm card — NOT a read (write lane unaffected) |
| 7 | `how much did i spend this month?` | still the monthly **total** — NOT the recent list |
| 8 | `what's the weather` | normal answer — no wallet route |

**Pass bar:** 1–5 return a real recent expense with a date; 6–8 keep their old
behavior (no regression in the add / edit / total lanes).

## Privacy check
- The reply must NEVER contain the transaction note/free-text — only amount,
  category, and date. (`getRecentExpenses` does not select the `note` column.)
- Money replies still carry `MONEY_SENTINEL`, so they're stripped from LLM history.
