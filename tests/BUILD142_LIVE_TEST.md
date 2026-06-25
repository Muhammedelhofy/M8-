# Build-142 — category insight ("where is the money going") — LIVE TEST

Sequence item #3. Turns the wallet from lookup into "where's our money going".

## What shipped
- **Category breakdown** (`getCategoryBreakdown` + `renderBreakdown`): ranked spending
  by the wallet's OWN category labels (works with his custom ones like "Iqos",
  "Alia's clothes"). Ranked by a base-currency conversion (household rate), reported
  native per-currency.
- **Intent** (`parseCategoryInsight`): "where is the money going", "top categories",
  "what am I spending the most on", "spending by category", Arabic "وين تروح الفلوس".
- **Period + member aware**: "where is Sara's money going this week" (reuses
  parseDateRange + resolveMemberCtx). Defaults to this month.

## Offline (passed)
- `M8/tests/build142-category-insight-test.ps1` → **11/11**. Regressions 135–141 green.

## Live chat questions (verified vs live DB, current month)
| # | Type this | Expect (top 5) |
|---|-----------|--------|
| 1 | `where is the money going this month?` | • Iqos: 300 SAR • Alia's clothes: 3,440 EGP • Food: 80 SAR • Marioma's gift: 600 EGP • Money at home: 600 EGP |
| 2 | `top categories this week` | this week's ranked categories |
| 3 | `where is Sara's money going?` | Sara's ranked categories |
| 4 | `how much did I spend this month?` | still the flat total (no regression) |

**Pass bar:** 1 returns the ranked real categories; 4 unaffected.

## Limits
- Ranking across SAR+EGP uses the household rate (approx); displayed amounts are native.
- Single custom-category lookup ("how much on Iqos") not yet wired — the breakdown
  covers the need; standard categories (groceries/fuel) over a range is a later add.
