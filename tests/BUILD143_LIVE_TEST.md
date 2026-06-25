# Build-143 — comparisons + budgets/bills in chat — LIVE TEST

Sequence item #4 (remaining wallet gaps).

## What shipped
- **Comparison** (`parseComparison` + `getMemberTotals`):
  - members: "Sara vs me", "who spent more", "compare us" → each member's spend for the
    period, ranked (native per-currency).
  - period: "am I spending more than last month?" → this vs last month (household) with %.
- **Budgets in chat** (`parseBudgetQuery` → getSummary.budgets): "am I over budget?",
  "budget status" → spent/limit/% per budget, ⚠️ over flag. Empty → "no budgets set up".
- **Bills in chat** (`parseBillsQuery` → getSummary.bills): "what bills are due?",
  "upcoming bills" → bills due in next 7 days. Empty → "none due".

## Offline (passed)
- `M8/tests/build143-compare-budgets-test.ps1` → **16/16**. Regressions 135–142 green.

## Live chat questions (vs live DB)
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `who spent more this month?` | Sara (EGP, the larger) vs Muhammad (SAR), ranked |
| 2 | `Sara vs me this month` | both members' totals |
| 3 | `am I spending more than last month?` | this vs last month with up/down % |
| 4 | `am I over budget?` | "No budgets are set up in the app yet" (none configured) |
| 5 | `what bills are due?` | "No bills due in the next 7 days" (the one bill has no due date) |

**Pass bar:** 1–3 show real comparison numbers; 4–5 degrade gracefully (accurate).

## Notes
- Cross-currency ranking uses the household rate; amounts shown native.
- Period comparison is month-over-month (household) via getSummary's delta.
- Budgets/bills reflect what's configured in the Family Wallet app — set them there to
  see richer output.
