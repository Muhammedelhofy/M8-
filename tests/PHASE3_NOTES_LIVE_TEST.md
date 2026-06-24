# Phase 3b — Note Reference Resolution · Live Chat Test

**Branch:** `phase3-notes` (stacked on `phase3-tasks`) · **Changed:** `lib/orchestrator.js` (Notes lane:
new `parseNoteReference` / `noteRefContext` / `handleNoteReference`) + `lib/wallet.js` (Build-127
edit-overlay fix). Note context is detected from the prior note reply's TEXT (no sentinel) — precise
enough to ignore the capture OFFER. Notes have REAL delete → reference-DELETE is **confirm-gated** +
title-guarded. No "done" (notes aren't completable). Only ever the single newest note (never guesses).

**Goal:** "delete it / remove that / the last one" work on notes without the exact text.

## SETUP
| # | Type this | Expect |
|---|---|---|
| 0 | `note that the car insurance is due next week` | "📝 Saved as a note." (or a save offer → `yes`) |

## A. Delete by reference — CONFIRM-GATED
| # | Type this (right after a note turn) | Expect |
|---|---|---|
| 1 | `delete it` / `remove that` / `scratch it` | "🗒️ Delete note "car insurance…"? yes/no" → `yes` → "Deleted the note" |
| 2 | (at the card) `no` | "Okay, kept it — nothing deleted." |
| 3 | `get rid of the last one` | confirm card on the newest note |

## B. Show / Arabic
| # | Type this | Expect |
|---|---|---|
| 4 | `the last one` / `the last note` | "Your last note: "…"." |
| 5 | `دوّن إن الإيجار مستحق` then `احذفها` | "🗒️ حذف ملاحظة «…»؟" → `نعم` → حُذفت |

## C. Must NOT be hijacked
| # | Type this | Expect |
|---|---|---|
| 6 | After a note offer ("save this as a note?") `yes` | still SAVES (the offer is not treated as a deletable note) |
| 7 | After general chat: `delete it` | not claimed by notes (no note context) |

## D. Build-127 — wallet edit no longer shows a stale old value
| # | Type this | Expect |
|---|---|---|
| 8 | `throw 30 egp to groceries` → `yes` → `change that to 40` → `yes` → `change it to 50` | the 2nd card shows **"(40 EGP · Groceries) → 50"** (current 40, NOT the stale 30) |

## Offline checks already done
- `tests/phase3-note-reference-test.ps1` → **27/27** (parseNoteReference EN+AR, negatives, paste guard,
  noteRefContext incl. capture-offer isolation, pending-delete content parse, + the Build-127 overlay merge).

## What to watch for
- ✅ Deletes ask before destroying; the `yes` deletes the SAME note (content-guarded).
- ✅ "the last one" = the newest note. To delete an older one, name it ("delete the note about taxes").
- 🔴 If a reference hits the wrong note, or fires outside a note chat → tell me.
