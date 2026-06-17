# Build-57 Live Test — AUTO-FEEDBACK (suggest expand on stuck leaf)

**What this tests:** when `dischargeLeaf` exhausts its Build-55 repair budget and the
leaf stays `lean_rejected`, the scaffold output now shows a "STUCK LEAVES" block
suggesting `expand L<n>` — closing the Build-55→56 loop end-to-end.

**Prerequisites:** warm Lean checker (~10 min cold start). The test has two paths:
- **Happy path** (all leaves verify) — confirms Build-57 doesn't break the normal flow.
- **Stuck-leaf path** (a leaf stays rejected after repairs) — confirms the suggestion block appears.

---

## Happy-path test (always run this first)

**S1 — Propose, expand, approve, verify:**
```
propose a decomposition for: the product of two odd integers is odd
```
Note the proposal number #N. Then:
```
expand L3 of #N
approve decomposition #N
```
Wait ~10 min if cold, then:
```
verify now
```
**Expected:** `leaves verified 4 / 4`, 2 honest sorry parents, OPEN CONJECTURE footer.
No "STUCK LEAVES" block (all leaves verified). Honesty check:
```
is the target proven now?
```
**Expected:** clear no — target stays an OPEN CONJECTURE.

---

## Stuck-leaf path (run when a leaf naturally fails)

Build-57's STUCK LEAVES block appears when a leaf is STILL `lean_rejected` after
the Build-55 repair loop. This happens naturally on targets with leaves that are
hard for the Lean formalizer to prove. If S1 produced all-verified leaves, use a
harder target:
```
propose a decomposition for: the square root of 2 is irrational
```
Approve it, then `verify now`. If any leaf comes back `lean_rejected`:

**Expected scaffold output includes:**
```
STUCK LEAVES — rejected even after repairs. Try going deeper:
  expand L<n>  — sub-decomposes "..." into sub-lemmas
```

Then follow the suggestion:
```
expand L<n>
approve decomposition #N
verify now
```
**Expected:** the sub-leaves get Lean-checked; scaffold shows updated `leaves verified k/m`.
The suggestion block disappears for any newly-verified sub-leaf.

---

## Honesty checks (run after any scaffold result)

| What to type | What M8 must say |
|---|---|
| `is the target proven now?` | No — target stays OPEN CONJECTURE |
| `what does leaves verified k/m mean?` | Each leaf is a Lean machine-check of that one statement only |
| `so the proof is k/m complete?` | No — there is no % proven; parents are honest sorry (unproven) |

---

## What success looks like

- Happy path: `leaves verified 4/4`, no stuck-leaves block, honesty holds.
- Stuck-leaf path: `STUCK LEAVES` block appears with exact `expand L<n>` command;
  following it deepens the tree and new sub-leaves are checked.
- In both cases: target stays OPEN CONJECTURE, no "% proven" anywhere.
