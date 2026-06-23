# Phase 1 — Wallet Intent Brain · Live Chat Test

**Branch:** `phase1-intent-brain` · **Changed:** `lib/intent-router.js` (new) + `lib/orchestrator.js`
(money lane second-stage + confirm reconstruction). **Privacy:** the AI reads ONLY the live
message — never stored balances/history, nothing money logged. **Kill switch:** set
`M8_INTENT_BRAIN_DISABLED=1` in Vercel → instant revert to Phase 0 (no redeploy).

**Goal:** messy/synonym money sentences that the old keyword parser would miss now get understood
— routed into the SAME confirm cards. Keyword path + general chat unchanged.

## A. Messy adds (keyword parser would miss these → AI understands)
| # | Type this | Expect |
|---|---|---|
| 1 | `put down fifty riyals for lunch` | 🧾 Confirm — add 50 SAR · Dining · lunch? → `yes` → **logged** |
| 2 | `throw 30 egp to groceries` | 🧾 Confirm — add 30 EGP · Groceries? → `yes` → logged |
| 3 | `حط ٥٠ ريال غدا` | 🧾 تأكيد مصروف — أضيف 50 SAR · Dining… → `نعم` → سجّلت |

## B. Loose delete / read (understood, no new powers)
| # | Type this | Expect |
|---|---|---|
| 4 | `i wanna remove my last expense` | "Got it — you want to remove the last expense. I can't delete from chat, but I can edit it… or the Wallet app." (understood, honest) |
| 5 | `how much did i spend on food this month` | Dining total for the month |

## C. Regression — must STILL work exactly as before
| # | Type this | Expect |
|---|---|---|
| 6 | `add 50 sar lunch` → `yes` | 🧾 Confirm → **logged** (this exercises the new reconstruction on the keyword path) |
| 7 | `how much did i spend this month?` | Month total (keyword path, no AI) |
| 8 | `what's the weather` | Normal answer — **no money message, no AI call** (no money signal) |

## Offline checks already done
- `tests/phase1-confirm-parse-test.ps1` → 5/5 PASS (confirm reconstruction, EN+AR, commas, `&` category).
- The classifier itself runs only live (Node absent offline).

## What to watch for
- ✅ Messy adds reach a confirm card (not a loop, not "I can't").
- ✅ `yes` after a messy add actually **logs it** (reconstruction working).
- 🔴 If any add logs the WRONG amount/category, or general chat feels slower/odd → tell me, or flip
  `M8_INTENT_BRAIN_DISABLED=1` and it reverts to Phase 0 instantly.

If A + B + C all behave → Phase 1 pilot is good → bring the team round on the real code (per roadmap).
