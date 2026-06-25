# Build-139 — itemized expense breakdown + "those entries" follow-up — LIVE TEST

Fixes the drift from the 2026-06-25 afternoon chat: M8 gave **totals** but couldn't
itemize ("what were the 3 entries for?") and lost the thread on "those 3 entries".

## What shipped
- **Itemized rendering** (`renderExpenseList`): a detail/breakdown request lists each
  line item as `• amount · category` + a total, instead of just the total. The wallet
  CATEGORY is the "what for" (privacy wall holds — the `note` free-text is never read).
- **Detail intent** (`isDetailRequest`): "what were the entries for", "detailed
  expenses", "breakdown", "itemize", Arabic "تفاصيل" → breakdown mode.
- **Anaphora recovery** (`lastWalletQueryContext`): "what are the details of THOSE 3
  entries" with no date/name → reconstructs {date, member} from the previous wallet
  reply ("Sara's expenses on Jun 23: …") and lists them.

## Offline (passed)
- `M8/tests/build139-itemized-detail-test.ps1` → **11/11** (detail intent + anaphora).
  Regressions 135/136/137/138 all green (15/12/16/14).

## Live chat questions (run on m8-alpha after deploy)

| # | Type this | Expect (verified vs live DB) |
|---|-----------|--------|
| 1 | `detailed expenses for sara on june 23` | 3 lines: `• 350 EGP · Lunch` / `• 250 EGP · Food for alia (mac)` / `• 163 EGP · Groceries` + `Total: 763 EGP` |
| 2 | (after "her total on 23rd of june") `what were those 3 entries for?` | same itemized breakdown (anaphora) |
| 3 | `what's Sara's last expense?` then `what was it for?` | answers from the category |
| 4 | `her total expenses on 23rd of june` | still the one-line **total** (no regression) |
| 5 | `what was the last expense sara logged` | still the single latest (no regression) |

**Pass bar:** 1–2 are the exact drift from this afternoon — must now itemize.

## Limits / notes
- Breakdown is by **category** (the wallet label). Per-entry free-text notes are
  deliberately never read (privacy wall).
- Anaphora reaches back ~6 turns for the last wallet reply; if none found it doesn't
  guess — falls through rather than inventing a date.
