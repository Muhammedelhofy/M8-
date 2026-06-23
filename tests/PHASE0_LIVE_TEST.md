# Phase 0 — Safety Net · Live Chat Test

**Branch:** `phase0-safety-net` · **What changed:** `lib/orchestrator.js` only (added `capabilityFallback()` + 2 call-sites). Nothing deployed.

**Goal:** confirm M8 no longer loops on money/task/note requests it can't fulfil — it now says plainly what it *can* do. General chat must stay normal.

## How to read results
- ✅ PASS = M8 gives the clear capability message (or a normal answer for general chat), **no clarifying-question loop**.
- ❌ FAIL = M8 asks "which wallet / which Sara / what's the balance"-style loop, or wrongly hijacks a general question.

## A. The exact loops from the screenshots (must now be clean)
| # | Type this | Expect |
|---|---|---|
| 1 | `what was the last expense sara did on the wallet?` | "I can add, edit, or total your expenses… but I can't look up past transactions from chat — open the Wallet app." **No "which Sara" loop.** |
| 2 | `remove the last expense of 50 sar` | Same money capability message. **No "what's the balance" loop.** |
| 3 | `remove the last transaction 50 sar from the wallet` | Same money capability message. |

## B. Money — still works (regression check; must NOT show the fallback)
| # | Type this | Expect |
|---|---|---|
| 4 | `add 50 sar lunch` | 🧾 Confirm card (then `yes` logs it). Unchanged. |
| 5 | `how much did I spend this month?` | The real spend total. Unchanged. |

## C. Tasks / Notes
| # | Type this | Expect |
|---|---|---|
| 6 | `scratch the gym task` *(if no such task exists / not parsed)* | Task capability message ("I can add, complete, or delete tasks…"), no loop. |
| 7 | `what's a good task app?` | **Normal general answer** — NOT the capability message. |

## D. General chat — untouched
| # | Type this | Expect |
|---|---|---|
| 8 | `what's the weather today` | Normal answer (live search), no capability message. |
| 9 | `make me rich` | Normal conversational answer. |

## E. Arabic (covered here since the PS mirror is English-only)
| # | Type this | Expect |
|---|---|---|
| 10 | `احذف آخر مصروف ٥٠ ريال` | Arabic money capability message (أقدر أضيف، أعدّل، أو أجمع…), no loop. |
| 11 | `وش آخر مصروف سجلته سارة؟` | Arabic money capability message. |
| 12 | `كم صرفت هذا الشهر؟` | Real spend total (unchanged) — NOT the fallback. |

## Offline check already done
`tests/phase0-safety-net-test.ps1` → **ALL 12 CASES PASSED** (English routing logic).

---
If A + E pass and B/C-7/D stay normal → Phase 0 is good → say "go" to deploy, then we move to Phase 1.
