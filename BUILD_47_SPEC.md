# Build-47 Spec — Smarter Conjecture Generation (Depth-2)

**Status:** SPEC (build tonight, offline-verify now, **live-verify deferred to after the 05:00 AST
nightly attestation** so we don't contaminate its Gemini free-tier quota).
**Domain:** the digital-root / vortex / figurate-number engine (`lib/kernel-conjecture.js`) — exactly
Muhammad's stated interest area (vortex doubling, digital roots, sacred-geometry / figurate numbers).
**Honesty spine:** UNCHANGED. The deterministic checker stays the SOLE judge of truth; this build only
widens what gets *proposed*, then polices it harder.

---

## Why here (not the M3 Collatz generator)
`conjecture-gen.js` (M3-lite, Collatz) is a *mechanical* slot-enumerator policed by a Wilson/Newcombe
**mining-vs-matched-baseline** gate. Letting an LLM propose candidates there would muddy that gate's
"mining beats blind parameters" comparison — a silent integrity risk. `kernel-conjecture.js` is the
engine *built* for "LLM proposes → code judges", has no such statistical gate to break, and is the
domain Muhammad actually wants the engine smart in. So the depth lever lands here.

## The gap today
`kernelToConjecture(kernel)` asks Gemini for **exactly one** claim. One guess = one shot. If the model's
single guess is trivially-true ("the digital root is one of {1..9}") or just weak, the kernel test reports
a low-information "observed through N" and stops. Two failure modes:
1. **Too few guesses** — a richer, more informative true pattern is never surfaced because we only asked once.
2. **No triviality floor** — unlike the M3 engine (micro-prover + vacuity floor), the digital-root engine
   has NO guard against a *vacuously* true claim. "More guesses" without this would just mean "more
   trivially-true junk reported as a result" — that would weaken honesty, not strengthen it.

## What ships (two halves — they must ship together)

### Half 1 — multi-candidate proposal (richer guesses)
New `proposeKernelCandidates(kernel, K=6)`: one Gemini pass returns a JSON **array** of up to K distinct
candidate claims in the SAME closed vocabulary. Each is `validateClaim`'d independently (off-schema →
dropped — the anti-smuggling gate is unchanged and now runs per-candidate), then deduped by canonical key.
Fail-safe → `[]`. New `MULTI_PROPOSE_SYSTEM` (PROPOSE_SYSTEM + "output an array of up to K *distinct*
non-trivial claims; vary the template and generator; do NOT pad with trivially-true claims").

### Half 2 — deterministic triviality floor (so richer ≠ more vacuous)
New pure `classifyHeld(claim, result)` → `"tight" | "trivial"`, mirroring M3's `isVacuous` philosophy but
for digital-root claims. A held claim is **trivial** (no information) when:
- `dr_set`: the claimed set **strictly contains** the set of roots actually observed over [1..N] (it held
  only because it was loose). Tight iff `claim.set` == observed-root-set. A set covering all 9 roots is
  always trivial.
- `dr_periodic` / `mod_cycle`: the claimed period is **non-minimal** — a proper multiple of the observed
  minimal period (it held only because any multiple of the true period also holds). Tight iff claimed
  period == observed minimal period.
- `dr_constant`: a single fixed value is inherently tight — never trivial when it holds.
Pure, sync, no LLM. Uses the existing `observedDrPeriod` / `observedModPeriod` / digital-root scan helpers.

### Putting them together — `bestKernelConjecture(kernel)`
Replaces the single `kernelToConjecture(dec.kernel)` at its call sites inside `runKernelTest`:
1. `proposeKernelCandidates(kernel, K)` → up to K validated, deduped claims.
2. `evaluateClaim` each (deterministic, exhaustive).
3. Partition: **HELD-TIGHT** · **HELD-TRIVIAL** (held but vacuous) · **FALSIFIED** (counterexample) ·
   (off-schema already dropped at validation).
4. Pick the headline = the **tightest HELD-TIGHT** claim (most-informative: smallest set / smallest
   minimal period / a constant). If none are tight, fall back to a HELD-TRIVIAL (explicitly flagged
   "holds but carries no information") so we still report honestly; if nothing held, report the cleanest
   FALSIFIED (counterexample is a real result). Return `{ best, held, trivial, falsified, all }`.
5. Narrate via an extended `renderKernelConjecture` companion: headline claim + "observed through N"
   (capped empirical, never proven), then a short ledger line: "tried K candidate patterns: H held
   (T of them trivial/vacuous), F falsified". Trivial holds are NEVER celebrated as findings.

`runKernelTest` wiring: in the **false-literal** branch and the **D salvage** branch, swap
`kernelToConjecture` → `bestKernelConjecture`. The literal-claim-first (Option B) path is UNCHANGED —
that path is about fidelity to the user's *stated* claim, not generation. `kernelToConjecture` stays
exported (back-compat + single-claim callers/tests).

## Honesty invariants (re-checked, all preserved)
- Deterministic checker remains the only truth judge; LLM only widens proposals (still inside
  `validateClaim`'s closed vocabulary).
- The new triviality floor only **demotes/labels** a held claim — it can never promote one.
- Strongest verdict stays "observed by exhaustive computation through N" = `empirical` AT MOST, never
  `proven`; the speculative leap is untouched and stays speculative.
- A run that surfaces only trivial holds must SAY the holds are vacuous, not present them as a finding —
  same doctrine as the M3 vacuity floor and the "say so, don't dress it up" rule.

## Tests (offline tonight, zero Gemini cost)
`tests/multi-candidate-verify.ps1` — PS mirror (PURE ASCII, inline hot loops per the PS gotchas):
- `classifyHeld` truth table: dr_set {3,6,9} over a gen whose observed roots are exactly {3,6,9} → tight;
  dr_set {1..9} → trivial; dr_set {3,6,9,1} when observed is {3,6,9} → trivial (strict superset);
  dr_periodic period 6 when minimal is 6 → tight; period 12 when minimal is 6 → trivial; dr_constant → tight.
- array parse: `parseClaims` extracts a JSON array, drops off-schema members, dedupes.
- ranking: tightest held wins headline; all-trivial falls back with the flag; all-falsified picks a
  counterexample; empty → honest null.
- regression: `kernel-conjecture-verify.ps1` (33/33) stays green (single-claim path untouched).

## Out of scope (explicitly)
- No new orchestrator route / detector (the existing "test the kernel of …" turn just gets smarter).
- No DB writes, no migration, no Lean — Lean-free by design so this does NOT compete with the 05:00
  nightly's warm-checker recheck of the Build-44 leaf.
- No change to the M3 Collatz gate.

## Ship sequence
code → `multi-candidate-verify.ps1` green + `kernel-conjecture-verify.ps1` 33/33 no-regression →
push to `github.com/Muhammedelhofy/M8-` → confirm deploy via `/api/health` `deploy.sha` →
**HOLD live test until after 05:00 nightly** (Muhammad's OK + Gemini quota). Bump `buildState.js`
(`live[]` newest-first + `commitFamily` tail) on ship.
