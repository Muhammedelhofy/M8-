# Build-55 — M4 → Proposer Feedback Loop (bounded iterative leaf repair)

**Date:** 2026-06-17 · **Session-44** · depth phase
**File:** `lib/lemma-dag.js` · **Test:** `tests/feedback-loop-verify.ps1`
**No migration, no new Vercel endpoint.**

## Why (the recommended depth move)

The Session-43 handoff (`NEXT_SESSION_BRIEF.md` #3) named the next depth step:
**"feedback loop (Lean error → redraft leaf)"** — recommended *first*, ahead of multi-level DAGs.

`dischargeLeaf` (Build-18) already did the loop's *first turn*: draft a leaf → `/check` →
on a `lean_rejected`, redraft **once** with the error text (`buildLeafDirective(prose, priorError)`),
re-check, keep whichever verdict. But it stopped after a single repair. A leaf that needs two
corrective passes (e.g. fix a tactic error, then a namespace) could never converge interactively.

Build-55 generalizes that single repair into a **bounded iterative loop**: redraft from the
**latest** Lean error up to `MAX_LEAF_REPAIRS` times. This is pure depth — it makes the *same*
proof attempt converge more often, adds **no** new domain and **no** new narration surface.

## What changed

`lib/lemma-dag.js`:
- New constant `MAX_LEAF_REPAIRS = clamp(env M4_MAX_LEAF_REPAIRS, 0, 4)`, **default 2**.
  `=1` reproduces the legacy single-repair behavior byte-for-byte; `=0` disables repair.
- New pure helper `shouldRetryLeaf(kind, repairsUsed)` → retry **iff** `kind === "lean_rejected"`
  **and** `repairsUsed < MAX_LEAF_REPAIRS`. Exported for the PS mirror.
- `dischargeLeaf`'s repair `if` became a `while (shouldRetryLeaf(...))` loop feeding
  `result.errorText` back each pass. Returns `{ ..., repairs }`; logs `m4_leaf { leanKind, repairs }`.

## Honesty / safety invariants (unchanged)

- **`/check` is still the sole truth judge.** A redraft only re-submits to Lean; the loop never
  upgrades a verdict itself. `lean_verified` still requires a real machine-check.
- **Only `lean_rejected` is retried.** `lean_verified` is done; `lean_stated` (an honest `sorry`)
  is **not** retried — pressuring it would invite a bogus proof, which the `LEAF_SYSTEM` contract
  forbids; `lean_pending`/`lean_error` are a cold/slow checker a redraft can't beat.
- **Fail-safe stops** that keep the last real verdict (never burn the whole budget):
  draft throws · redraft is `UNFORMALIZABLE`/banned-token · the re-check returns not-ok (cold/slow).
- **The target stays an OPEN CONJECTURE.** Leaf counts and the `% never proven` rule are untouched.
- **Scope = the chat/discharge lane only.** The autonomous nightly `recheckScaffold` (L5) still does
  **NO** LLM redraft — its conservatism (§0.3: the scaffold row's existence is the human-architecture
  act) is deliberately preserved. The feedback loop lives where LLM drafting already lives.

## Latency note

Each repair = 1 LLM draft + 1 `/check`. Legacy worst case was 2 checks/leaf; default (2) is up to
3 checks/leaf, short-circuiting on the first `lean_verified`. Tunable/killable via
`M4_MAX_LEAF_REPAIRS` if a warm-checker interactive approve ever approaches the function time budget.

## Verification

- Offline PS-mirror `tests/feedback-loop-verify.ps1`: `shouldRetryLeaf` truth table + the loop's
  stop conditions (converge-to-verified, exhaust-budget, cold-miss-stop, worse-rewrite-stop,
  never-retry-stated/pending/error, MAX=1 legacy parity, MAX=0 disabled).
- No-regression: existing `tests/lemma-dag-verify.ps1` still green (pure parse/counts untouched).
- Live (needs OK + Gemini quota): propose a 2-leaf decomposition → warm the checker → approve;
  a leaf that fails the first repair should now converge on the second.
