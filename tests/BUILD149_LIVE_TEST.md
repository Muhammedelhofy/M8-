# Build-149 — the 3 QA-sweep polish fixes — LIVE TEST

Fixes the 3 minor items found in the B-135→148 sweep.

## What shipped
- **Fix 1 — Arabic period labels**: `parseDateRange` now returns `arLabel`; `rangeLabel`
  picks the right language. Wired into PERIOD, category-insight, comparison, payment lanes.
  ("this week" → "هذا الأسبوع", "last month" → "الشهر الماضي", …)
- **Fix 2 — category over a range**: the PERIOD lane now matches the query against the
  wallet's OWN category names (standard + custom, apostrophe-normalized, "Other" excluded),
  so "how much on Iqos last week" filters instead of totalling. Removed the old catWord defer.
- **Fix 3 — vs-last-month %**: the household this-month expense total again appends
  "up/down N% vs last month" (from getSummary).

## Offline (passed)
- `M8/tests/build149-polish-test.ps1` → **10/10** (labels + category match). Full
  regression 135–148: **0 failures**.

## Live chat questions
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `how much on Iqos this month?` | Iqos this month: 300 SAR (1 entry) |
| 2 | `how much did I spend this month?` | total + "up/down N% vs last month" |
| 3 | `كم صرفت هذا الأسبوع؟` | "...هذا الأسبوع" (Arabic label, not "this week") |
| 4 | `how much on Alia's clothes this month?` | matches the curly-apostrophe category |
| 5 | `how much on groceries this week?` | Groceries this week (was previously this-month) |

**Pass bar:** 1,4,5 filter to the category over the period; 2 shows the delta; 3 Arabic label.
