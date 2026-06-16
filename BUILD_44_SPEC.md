# Build-44 Spec — Depth-1: Formalizable-Leaf Decompositions ("real M4 leaves")

**Status:** SPEC → ship the offline change, then a LIVE demo (needs Muhammad's OK + Gemini quota + a warm
Lean checker). Written Session-38 (Opus), 2026-06-16. This is the FIRST depth step after the
breadth roadmap (D→B→A→C) completed — per the depth-over-breadth doctrine we now make the engine SMARTER,
not wider.

## The gap this closes (the honest, logged caveat)
- NORTH_STAR logged that the only Lean-verified decomposition (§0.4) was **degenerate** (L1 ≈ target).
- The Option-A live test (Build-43) showed the opposite failure: a NON-degenerate Collatz decomposition
  whose **leaves came back `lean_unformalizable`** — the M4 leaf-formalizer honestly declined to fake-prove
  deep Collatz base lemmas, so `leaves verified 0/2`.
- So the engine can draft a real plan OR verify a leaf, but it has not yet drafted a plan whose leaves M4
  **actually verifies**. Closing that is the smallest real DEPTH win: M8 contributing a decomposition that
  advances toward a machine-checked result.

## The change (smallest useful slice)
**Bias the Option-A proposer toward Lean-FORMALIZABLE leaves.** A good decomposition for verification has
**small, elementary, self-contained LEAVES** (provable from the standard library — induction, finite sums,
basic arithmetic/number theory) and pushes the hard, problem-specific reasoning into the **PARENT** lemmas.

- Code: extend `PROPOSE_SYSTEM` in `lib/decomp-proposer.js` with a rule: leaves (no-dep lemmas) must be as
  elementary and Mathlib-checkable as possible; hard content goes in parents. **No change** to the
  anti-degeneracy gate, the staging/approve flow, or the honesty contract (still "leaves verified k/m";
  target stays an OPEN CONJECTURE; sorried parents UNPROVEN; Lean = the only path to `proven`).
- Everything else (parse, gate, stage, approve → M4) is unchanged — this is a proposer-quality tweak, the
  same "structure not prompting" caution applies (the prompt biases the draft; the M4 Lean lane still
  computes the ground truth, so a non-formalizable leaf still just reports `lean_unformalizable`, never a
  fake proof).

## Offline proof
`tests/decomp-proposer-verify.ps1` (37/37) still green — the change is to the LLM prompt only; parse +
anti-degeneracy gate + detection + [PROPOSED PLAN] honesty are unchanged. (The PS mirror does not exercise
the prompt; the real proof is the live demo.)

## Live demo (needs OK + warm Lean + quota) — the actual win
1. Warm the Lean checker (`/health` ping; cold start ≈ 9.5 min).
2. Pick a target with genuinely formalizable base lemmas — a modest TRUE theorem so leaves can verify, e.g.
   "the sum of the first n positive odd numbers equals n²" (base case + an inductive-step leaf, both
   Mathlib-provable) — or another elementary number-theory identity.
3. `propose a decomposition for: <target>` → expect a non-degenerate plan with **elementary leaves**.
4. `approve decomposition #N` → expect M4 to report **≥1 leaf `lean_verified`** (`leaves verified k/m`,
   k ≥ 1), parents sorried, honesty framing intact.
5. Honesty check ("is the target proven now?") → must say no (a verified leaf ≠ a proof of the target;
   for a true-theorem target with all leaves discharged, M8 still reports "leaves k/m", never laundering
   the target via M4 — Lean-verifying the actual theorem statement is a separate, explicit act).

**Success = the first end-to-end A→approve→M4 run that yields a REAL (non-degenerate) verified leaf** —
M8 contributing the decomposition AND a machine-checked base step. If leaves still won't formalize, the
next depth iteration adds an M4→proposer feedback loop (surface the Lean error, redraft the leaf).
