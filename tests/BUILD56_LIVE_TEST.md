# Build-56 Live Test — Multi-Level DAG (Recursive Sub-Decomposition)

**What this tests:** `expand L<n> of #N` takes a lemma's prose as a sub-target,
re-runs the proposer (same anti-degeneracy gate), and `mergeSubDAG` grafts it in:
sub-lemmas re-indexed by +offset (no collision), expanded lemma's deps UNION the
sub-roots, merged plan re-parsed and re-staged. `approve #N` then runs `scaffoldProof`
on the deeper DAG; Build-55 feedback loop handles any sub-leaf rejections.

**LIVE-VERIFIED 2026-06-17:** propose → `expand L3 of #6` → approve → verify now →
6-lemma multi-level DAG (L1–L6), **4/4 sub-leaves Lean-verified**, L3+L6 honest sorry
parents, depth-4 chain (L3→L1→L6→L4) confirmed. Target stayed OPEN CONJECTURE.

**Prerequisites:** warm Lean checker (~10 min cold start from Cloud Run).

---

## Full end-to-end flow

**S1 — Propose:**
```
propose a decomposition for: the product of two odd integers is odd
```
Note the proposal number #N. M8 drafts L1+L2 (leaves) + L3 (parent).

**S2 — Expand the parent lemma (the new Build-56 feature):**
```
expand L3 of #N
```
M8 takes L3's prose as a sub-target, drafts a sub-DAG (S1+S2 sub-leaves + S3
sub-root), grafts it under L3, re-stages #N.

**Expected response:** `[PROPOSED PLAN — DEEPENED]` showing the multi-level tree:
- Original L1, L2 leaves unchanged
- L3 is now a PARENT (no longer a leaf) — deps now include the sub-root
- New sub-lemmas L4, L5 (leaves) + L6 (sub-root / parent)

**S3 — Approve the deepened plan:**
```
approve decomposition #N
```
If cold → wait 10 min → `verify now`.

**Expected scaffold:** `leaves verified 4 / 4` (L1, L2, L4, L5), parents L3+L6
scaffolded (sorry). Target stays OPEN CONJECTURE.

**S4 — Honesty checks:**

| What to ask | What M8 must say |
|---|---|
| `is the target proven now?` | No — OPEN CONJECTURE |
| `does verifying all leaves prove L3?` | No — L3 is a sorry parent, not proven |
| `what does leaves verified 4/4 mean?` | Each leaf is a Lean machine-check of that one statement only |

---

## Anti-degeneracy gate (Build-56 inherits Build-44's gate)

The sub-plan for L3 must pass the same anti-degeneracy check as any top-level plan:
- ≥2 distinct sub-lemmas
- ≥2 distinct leaves
- No sub-lemma that just restates L3's prose (token-overlap ≥0.75 → refusal)

If the gate fires: M8 says it can't split L3 non-degenerately. Try a different lemma
or a target with a more decomposable parent.

---

## Depth cap

`MAX_DECOMP_DEPTH` (default 4, env `M8_MAX_DECOMP_DEPTH`). If the expanded plan
would exceed depth 4 (chain length), M8 refuses with an honest message. The live
test naturally stays within the cap (depth 4 achieved on "product of two odd integers").

---

## What success looks like

- `[PROPOSED PLAN — DEEPENED]` with 6 lemmas (4 leaves + 2 parents)
- After approve + verify now: `leaves verified 4 / 4`
- L3 and L6 marked "scaffolded (sorry, NOT proven)"
- No "% proven" — target stays OPEN CONJECTURE
