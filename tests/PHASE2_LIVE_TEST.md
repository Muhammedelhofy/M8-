# Phase 2 — Reference Resolution · Live Chat Test

**Branch:** `phase2-reference` · **Changed:** `lib/orchestrator.js` (wallet lane: new
`parseReference` / `refHasAnaphor` / `walletRefContext` + `handleWalletReference`, wired before the
Phase-1 intent brain; Tier-2 gate relaxed to fuzzy anaphors with money context).
**Privacy:** unchanged — references are pure regex; no stored data ever reaches a model; amounts
parsed deterministically. **Confirm-gated:** edits still show a card. **No new delete power.**
**Kill switch:** `M8_INTENT_BRAIN_DISABLED=1` only disables the Tier-2 LLM fallback; the deterministic
reference resolver (Tier 1) keeps working.

**Goal:** "it / that / the last one / undo / scratch / change that to N" resolve to the SINGLE last
M8-added expense — but ONLY right after a wallet turn (so a stray "remove it" in a task/notes chat is
not hijacked). Never guesses between rows; only ever targets the last M8 write.

## SETUP (creates the wallet context every reference test needs)
| # | Type this | Expect |
|---|---|---|
| 0 | `throw 30 egp to groceries` → `yes` | 🧾 Confirm → **logged** 30 EGP · Groceries (tagged [M8]) |

## A. Edit by reference (no "expense/entry" keyword → old parser missed these)
| # | Type this (right after #0) | Expect |
|---|---|---|
| 1 | `change that to 40` | 🧾 Update last expense (30 EGP · Groceries) → 40 EGP? → `yes` → updated |
| 2 | `make it 45` | 🧾 Update last expense (… ) → 45 EGP? (resolves "it" to the same row) |
| 3 | `change it` (no number) | "Change it to what? Give me the amount in digits." (never invents a figure) |

## B. Delete by reference (understood + honest — chat has NO delete power)
| # | Type this (right after a log) | Expect |
|---|---|---|
| 4 | `remove it` | "You mean 30 EGP · Groceries? I can't delete from chat, but I can edit it … or the Wallet app." |
| 5 | `scratch it` / `undo that` | same honest message, naming the resolved expense |
| 6 | `get rid of the last one` | same — resolves "the last one" to the last M8 write |

## C. Show / Arabic
| # | Type this | Expect |
|---|---|---|
| 7 | `the last one` | "Your last logged expense: 30 EGP · Groceries." |
| 8 | `احذف آخر مصروف` (after a log) | تقصد 30 EGP · Groceries؟ ما أقدر أحذف من المحادثة، بس أقدر أعدّله… |
| 9 | `خله ٤٠` (after a log) | 🧾 تعديل آخر مصروف (…) → 40 EGP؟ → `نعم` → عدّلت |

## D. While a confirm card is still open (pending, before `yes`)
| # | Type this | Expect |
|---|---|---|
| 10 | `add 20 sar coffee` then `make it 25` | re-issues the confirm with **25** (edits the pending add, not an old row) |
| 11 | `add 20 sar coffee` then `scratch it` | "Okay, scrapped it — nothing was logged." |

## E. Must NOT be hijacked (no money context → reference ignored)
| # | Type this | Expect |
|---|---|---|
| 12 | `what's the weather` then `remove it` | NOT a wallet reply — normal handling (no "last expense" card). The 2nd msg's "it" is not money. |
| 13 | After a NON-money turn: `change that to 40` | not claimed by the wallet (no money context) |

## Offline checks already done
- `tests/phase2-reference-test.ps1` → **32/32 PASS** (parseReference EN+AR, negatives, paste guard,
  Tier-2 handoff, walletRefContext add/edit/recent/null). Async DB/LLM bits prove live only (Node absent).

## What to watch for
- ✅ References resolve to the right (last) row and edits go through a confirm card.
- ✅ Delete references give the honest "can't delete from chat" message — they NEVER silently remove.
- 🔴 If a reference targets the WRONG/older expense, or fires when the chat wasn't about money → tell me.
  Note (pre-existing, not introduced here): after an edit, the "old" value shown can be stale because
  `getLastM8Write` reads the original add row — the edit still applies to the correct txn by id.
