# Build-147 — contradiction handling (detect + flag, never auto-delete) — LIVE TEST

Sequence item #8. The two-Saras lesson shapes it: a same-name different-role fact may be
TWO real people, so we FLAG and ask — never silently delete or merge.

## What shipped (lib/memory.js + orchestrator.js)
- `_findConflictingPersonFact`: when a relationship is captured ("X is my <rel>"), look
  for an existing CURRENT profile fact about the same name with a DIFFERENT role.
- `upsertFact`: sets `contradiction_flag` + `contradiction_reason` when a conflict is
  passed (the dormant columns now used). Both facts stay current — no deletion.
- `recallMemory` now selects the flag; `orchestrate` injects a directive so the model
  ASKS the user to clarify (same person or two different people?) instead of guessing.
- `getContradictions()` reader exported for surfacing/debug.

## Offline (passed)
- `M8/tests/build147-contradiction-test.ps1` → **4/4** (conflict / same-slot / different
  name / empty). Full regression 135–146: 0 failures.

## Live behaviour
- Tell M8 "X is my wife", then later "X is my sister" (same name) → both stored, the
  newer flagged; next "who is X?" → M8 asks you to clarify rather than picking one.
- The original two-Saras (wife vs the retired test "accountant") would now be flagged on
  capture instead of silently coexisting.

## Design note (deliberate)
- NO auto-resolution: flagging only. Auto-deleting on a name match would wrongly merge
  two different people who share a name. Resolution stays the user's call.
