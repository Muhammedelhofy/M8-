# Phase 3a — Task Reference Resolution · Live Chat Test

**Branch:** `phase3-tasks` · **Changed:** `lib/orchestrator.js` (Tasks lane: new `parseTaskReference` /
`taskRefContext` / `handleTaskReference` + `TASK_SENTINEL`; `handleTasksCommand` now takes `history`).
**Mirrors Phase 2 (wallet).** KEY DIFFERENCE: Tasks have REAL delete, so a reference-DELETE is
**confirm-gated** ("Delete task X? yes/no"); "done" applies directly (recoverable + it names the task).
**Gating = safety:** references are claimed ONLY right after a task turn, so a stray "remove it" in a
money/notes chat is not hijacked. Only ever targets the single newest open task (never guesses).

**Goal:** "scratch it / mark it done / remove the last one / the last one" work without the exact task name.

## SETUP (creates the task context references need)
| # | Type this | Expect |
|---|---|---|
| 0 | `remind me to buy milk` | "Added to your list: "buy milk"." |

## A. Done by reference (applies directly, names the task)
| # | Type this (right after a task turn) | Expect |
|---|---|---|
| 1 | `mark it done` | "Marked "buy milk" as done ✓" |
| 2 | (after adding another) `did it` / `finished it` | marks the newest open task done |

## B. Delete by reference — CONFIRM-GATED (this is the safety difference)
| # | Type this | Expect |
|---|---|---|
| 3 | `remind me to call Sara` then `scratch it` | "🗑️ Delete task "call Sara"? Reply yes/no" → `yes` → "Deleted" |
| 4 | `remove it` / `delete that` / `get rid of the last one` | same confirm card on the newest open task |
| 5 | (at a delete card) `no` | "Okay, kept it — nothing deleted." |

## C. Show / Arabic
| # | Type this | Expect |
|---|---|---|
| 6 | `the last one` | "Your last task: "…"." |
| 7 | `ذكّرني اشتري حليب` then `احذفها` | "🗑️ حذف مهمة «اشتري حليب»؟" → `نعم` → حُذفت |
| 8 | `خلصتها` (after adding a task) | "علّمت «…» كمكتملة ✓" |

## D. Must NOT be hijacked (no task context → reference ignored)
| # | Type this | Expect |
|---|---|---|
| 9 | `throw 30 egp to groceries` → `yes`, then `remove it` | this is a WALLET turn → the money lane handles "it" (honest can't-delete), NOT tasks |
| 10 | after general chat: `scratch it` | not claimed by tasks (no task context) → normal handling |

## Offline checks already done
- `tests/phase3-task-reference-test.ps1` → **29/29** (parseTaskReference EN+AR, negatives, paste guard,
  taskRefContext incl. money-sentinel isolation, pending-delete title parse). DB writes prove live only.

## What to watch for
- ✅ "done" references mark the right (newest open) task; deletes ask before destroying.
- ✅ A delete confirm only deletes the SAME task (title-guarded); if it changed, M8 says so.
- 🔴 If a reference hits the WRONG task, or fires when the chat wasn't about tasks → tell me.
  Note: "the newest open task" = "it/that/the last one". If you've many open tasks and mean an older
  one, name it ("delete buy milk") — references only ever target the single most-recent open task.
