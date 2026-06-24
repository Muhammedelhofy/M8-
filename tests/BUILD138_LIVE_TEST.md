# Build-138 — pronouns + specific-date expense queries — LIVE TEST

Fixes the two misses from the 2026-06-25 live chat:
1. **"what was HER last expense"** returned the *household* latest ("Your last expense: 30 SAR")
   instead of Sara's — pronouns weren't resolved to a member.
2. **"her total expenses ON 23rd of june"** hit the canned decline — no specific-date query existed.

## What shipped
- **Pronoun resolution** (`resolveMemberCtx`): "her/his/she/he/my wife" → the member most
  recently named in the conversation (anaphora); else a gendered fallback for the household
  (female→non-owner = Sara, male→owner = Muhammad). Wired into the recent, spend-total, and
  date lanes + the intent brain.
- **Specific-date queries** (`parseExpenseDate` + `getExpensesByDate`): "on June 23",
  "23rd of june", "yesterday", "today", ISO dates → totals for that day, optionally per member.
  Privacy-safe (no `note`), read-only.

## Offline (passed)
- `M8/tests/build138-pronoun-date-test.ps1` → **14/14** (date parsing + pronoun resolution).
  Regressions 135 (15/15), 136 (12/12), 137 (16/16) all green.

## Live chat questions (run on m8-alpha after deploy)

| # | Type this (after establishing Sara in chat) | Expect (verified vs live DB) |
|---|-----------|--------|
| 1 | `what was her last expense?` | **Sara's last expense: 350 EGP · Needs from manshya · …** (not "Your … 30 SAR") |
| 2 | `what were her total expenses on 23rd of june?` | **Sara's expenses on Jun 23: 763 EGP (3 entries)** |
| 3 | `what did I spend on june 23?` | household total for Jun 23 |
| 4 | `expenses yesterday` | yesterday's total |
| 5 | `Sara's last expense` (explicit, no pronoun) | still works (Build-136) |
| 6 | `what's my last expense?` | household latest (no false member filter) |

**Pass bar:** 1–2 are the exact failures from tonight — they must now return Sara's real figures.

## Notes / limits
- Specific **single day** + relative (yesterday/today) supported; ranges ("last week",
  "between X and Y") are NOT yet — a possible follow-up.
- Pronoun → member uses conversation context first; if no one was named recently it falls back
  to the household roles. Explicit names always win.
- Privacy wall unchanged: amounts/category/date only, `note` never read; no money to any LLM.
