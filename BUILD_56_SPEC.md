# Build-56 — Multi-Level DAG (recursive sub-decomposition)

**Date:** 2026-06-17 · **Session-44** · depth phase (the `NEXT` node on the canonical diagram)
**Files:** `lib/decomp-proposer.js` (+ pure merge core) · **Test:** `tests/multilevel-dag-verify.ps1`
**No migration, no new Vercel endpoint** (reuses `m8_decomp_proposals`).

## Why (the next depth rung)

The Option-A proposer (Build-43) drafts a **one-level** lemma-DAG: a target broken into leaves
(Lean-checked) + parents (held as honest `sorry`). Build-44 biased leaves toward formalizable base
facts; Build-55 gave a failing leaf a bounded redraft loop. The remaining depth gap: when a lemma is
**still too hard** to prove or formalize as a single leaf, the proof tree dead-ends there — a `sorry`
parent or a `lean_rejected`/`lean_unformalizable` leaf with nowhere to go.

Build-56 closes that: **expand a chosen lemma into its OWN sub-decomposition.** The lemma becomes a
sub-target, the proposer drafts a sub-DAG for it (reusing the exact same anti-degeneracy gate), and
the sub-DAG is **grafted** into the parent plan so its easy sub-leaves become real, machine-checkable
leaves. The tree gets deeper; more of it bottoms out in verified leaves. This is pure DEPTH — no new
problem domain, no new narration surface, the honesty contract is untouched.

## The flow

1. `expand decomposition #N lemma L3` (also: `go deeper on L3 of #N`, `decompose lemma L3`).
2. Load staged proposal `#N` (`m8_decomp_proposals`), find lemma `L3`, take its prose as the **sub-target**.
3. `proposeDecompositionPlan(subTarget)` — the SAME Gemini proposer + `checkNonDegenerate` gate
   (≥2 sub-lemmas, ≥2 distinct sub-leaves, no sub-lemma restating `L3`). A degenerate/empty sub-plan
   returns the honest rejection — **nothing is grafted**.
4. `mergeSubDAG(parentDag, L3, subDag)` (PURE) — see below — produces the merged DAG + canonical text.
5. Re-`parseDAG` the merged text to re-validate (no cycle, no dangling) and **re-stage** `#N` with the
   deeper `dag_text`/`dag`. Render the expanded `[PROPOSED PLAN]` (now multi-level).
6. `approve decomposition #N` is **unchanged** — `scaffoldProof` runs on the merged text; the new
   sub-leaves get drafted + Lean-checked (with the Build-55 feedback loop), `L3` becomes a parent.

## `mergeSubDAG(parentDag, targetIdx, subDag)` — PURE, mirror-tested

- `offset = max(parentDag lemma idx)`. Remap every sub-lemma: `idx += offset`, each dep `+= offset`
  (sub indices can never collide with parent indices → no accidental merge).
- `subRoots` = remapped sub-lemmas that **no other sub-lemma depends on** (the sub-DAG's conclusions).
- The expanded lemma `L<targetIdx>`: `deps = unique(deps ∪ subRoots)` → it now rests on the sub-DAG;
  `is_leaf` recomputed `false`. (Union, never drop existing structure; sub-lemmas only depend on
  new-indexed nodes, so the union **cannot** create a cycle.)
- Merged lemmas = parent lemmas (with the expanded one updated) + remapped sub-lemmas.
- Returns `{ ok, dag, dagText, errors }`; `ok:false` (with reason) on a missing target lemma or if the
  re-parse of the merged text fails its structural checks → **nothing is staged**.

## Honesty / safety invariants (unchanged)

- **`/check` is still the sole truth judge.** Grafting only adds *more leaves to check* — it proves
  nothing by itself. A deeper tree with every leaf verified is **still an OPEN CONJECTURE**; there is
  no "% proven", by design (the `m8_lemma_scaffold` status can only reach `leaves_done`, never `proven`).
- **Anti-degeneracy applies to the sub-plan too** — `L3` cannot be expanded into a single lemma that
  just restates `L3`, and the sub-leaves must be distinct. A degenerate sub-plan grafts nothing.
- **Fail-safe & staged-only:** a missing proposal, an unparseable lemma id, a failed sub-draft, or a
  merged-DAG validation failure all return an honest message and leave `#N` **exactly as it was**.
- **Scope:** chat lane only; the autonomous nightly loop does not auto-expand (it still only re-checks
  human-architected scaffolds — Build-19 §0.3 conservatism preserved).
- **Depth guard:** `MAX_DECOMP_DEPTH` (default 2) caps recursion so a plan can't be expanded without
  bound; an expand on an already-max-depth lemma is refused with an honest message.

## Verification

- Offline PS-mirror `tests/multilevel-dag-verify.ps1`: `mergeSubDAG` remap/offset, sub-root detection,
  union-without-cycle, expanded-lemma is_leaf flip, missing-target reject, depth-cap reject, and the
  `expand` detection regex (positives + must-not-match negatives).
- No-regression: `decomp-proposer-verify.ps1` + `lemma-dag-verify.ps1` stay green (1-level path untouched).
- Live — VERIFIED 2026-06-17: propose → `expand L3 of #6` → approve → verify now →
  6-lemma multi-level DAG (L1–L6), 4/4 sub-leaves Lean-verified, L3+L6 honest sorry
  parents; depth 4 chain confirmed; target stayed OPEN CONJECTURE throughout.
