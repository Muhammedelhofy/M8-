# Build-57 — M4 AUTO-FEEDBACK (suggest expand on stuck leaf)

## Problem
Build-55 added a bounded repair loop (lean_rejected -> redraft up to MAX_LEAF_REPAIRS
times). Build-56 added recursive sub-decomposition (expand L<n> of #N). These two
rungs were independent: a stuck leaf after repairs gave no guidance toward Build-56.
The loop end-to-end was open: repair budget exhausted -> dead end.

## What Build-57 adds
When `dischargeLeaf` exits the Build-55 repair loop with the leaf STILL `lean_rejected`
(budget exhausted, draft threw, or rewrite was banned/unformalizable), the return value
now carries `suggestExpand: true`. `scaffoldProof` propagates this flag onto the lemma.
`renderScaffoldPacket` collects stuck leaves and appends a "STUCK LEAVES" block:

    STUCK LEAVES — rejected even after repairs. Try going deeper:
      expand L2  — sub-decomposes "The product of two integers of the form..." into sub-lemmas

The user can paste that exact command, triggering Build-56's mergeSubDAG to graft a
sub-DAG under the stuck leaf. The loop is now closed end-to-end:
  Build-55 repairs -> Build-57 suggests expand -> Build-56 expands -> new sub-leaves checked

## Honesty invariants (unchanged)
- `suggestExpand` is set ONLY on `lean_rejected` leaves — never on `lean_verified`,
  `lean_stated`, `lean_pending`, or parent `scaffolded` lemmas.
- The suggestion is advisory only. M8 NEVER auto-expands; Muhammad triggers the expand.
- Expanding a stuck leaf adds more leaves to check; the target stays an OPEN CONJECTURE.
- `/check` remains the sole truth judge. No `suggestExpand` path touches Lean directly.

## Code changes (lib/lemma-dag.js only)
1. `dischargeLeaf` return (main code path after the feedback loop):
   added `suggestExpand: result.kind === "lean_rejected"`
2. `scaffoldProof` loop: added `lemma.suggestExpand = r.suggestExpand || false`
3. `renderScaffoldPacket`: after the lemma list, added `stuckLeaves` block
   (filter `l.suggestExpand`, prose truncated at 70 chars, placed before GATE line)

No new endpoint, no migration, no DB change.

## Latency
Zero added latency — `suggestExpand` is derived from the already-computed
`result.kind`; the stuck-leaves render is pure string ops.

## Offline verification
`tests/build57-autofeedback-verify.ps1` 21/21:
- suggestExpand truth table (7 kinds)
- stuck-leaves render (empty, one stuck, two stuck, long-prose truncation)
- source sanity (6 checks on lib/lemma-dag.js)

No-regression: lemma-dag 42/42, feedback-loop 31/31, multilevel-dag 36/36.

## Live verification (needs OK + Gemini quota + warm checker)
1. `propose a decomposition for: <some target>`
2. `approve decomposition #N` (with warm checker)
3. If any leaf stays `lean_rejected` after repairs: scaffold output should show
   "STUCK LEAVES" block with `expand L<n>` suggestion
4. Type `expand L<n>` -> Build-56 grafts sub-DAG -> re-approve -> new sub-leaves verified
