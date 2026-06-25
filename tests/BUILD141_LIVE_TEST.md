# Build-141 — date ranges + income / net — LIVE TEST

Sequence item #2. Adds period queries and the income side (M8 was expense-only).

## What shipped
- **Date ranges** (`parseDateRange`): "this week", "last week", "last N days",
  "this month", "last month", "in June", "between June 1 and June 10" → a [start,end)
  window. (KSA week starts Saturday.)
- **Income / net** (`parseMoneyKind` + `getTxnsByRange`): "how much did we earn",
  "are we net positive", "profit this month" → income, or net = income − expense.
- **Per-member + per-period**: "what did Sara spend last week", "her income in June".
- Native per-currency (SAR + EGP shown separately — no fake conversion). Privacy-safe,
  read-only, no `note`. Category-specific queries are deferred to the category lane (#3).

## Offline (passed)
- `M8/tests/build141-range-income-test.ps1` → **12/12** (range boundaries + intent).
  Regressions 135–140 all green.

## Live chat questions (verified vs live DB, current month)
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `how much did we earn this month?` | **income this month: 23,500 EGP + 6,000 SAR** |
| 2 | `are we net positive this month?` | **net this month: 16,858 EGP + 5,578 SAR** (income − spent) |
| 3 | `how much did I spend this week?` | this week's expense total |
| 4 | `what did Sara spend last week?` | Sara's expense for last week |
| 5 | `expenses in June` | June total |
| 6 | `how much did I spend this month?` | 6,642 EGP + 422 SAR (no regression) |

**Pass bar:** 1–2 prove the income/net side; 3–5 prove ranges; 6 no regression.

## Limits
- Category + range ("groceries last week") is deferred to #3 (category insight).
- Net is per-currency (income−expense in each currency); no cross-currency conversion.
