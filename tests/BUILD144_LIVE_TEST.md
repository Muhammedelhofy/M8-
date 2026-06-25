# Build-144 — surface the note ("what for") — LIVE TEST

Sequence item #5. The APPROVED privacy relaxation: show the transaction note to the
OWNER in the reply, NEVER to an LLM.

## Safety (the whole point)
- The note is read ONLY when a display lane opts in (`includeNote`), rendered into a
  deterministic, code-templated reply tagged MONEY_SENTINEL.
- That reply is **stripped from LLM history** (stripMoneyHistory) and the wallet turn
  **early-returns before saveMemory** (orchestrator.js:2997) — so the note is NEVER
  persisted to M8 memory, NEVER placed in an LLM prompt, NEVER logged.
- Kill switch: `M8_WALLET_SHOW_NOTES_DISABLED=1` reverts to no-notes instantly.
- The "[M8]" tag on M8-added notes is stripped for display.

## What shipped
- `getRecentExpenses` / `getExpensesByDate` gain `includeNote` (default false).
- `renderRecentExpenses` + `renderExpenseList` append ` · <note>` when present.
- Display lanes (last-expense, itemized detail) pass includeNote=true.

## Offline (passed)
- `M8/tests/build144-show-notes-test.ps1` → **11/11** (cleanNote, kill switch, render).
  Regressions 135–143 all green.

## Live chat questions (vs live DB)
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `what was the last expense logged?` | shows note when present, e.g. `… · Food · Launch` |
| 2 | `detailed expenses on june 24` | line items include the note ("what for") |
| 3 | `detailed expenses on june 21` | `… · Groceries · Super market` |

**Pass bar:** notes appear in the reply (owner display); totals/aggregates unchanged.

## Notes
- Aggregates/totals/breakdowns still never read the note — only the per-entry display
  lanes do. Many entries have no note (then only category shows).
