# Build-16 (M3-full) — Novelty-aware persistence + the honest novelty ship gate

*2026-06-13 · post-S8 next rung (M1 ✅ → M3-lite ✅ → M2 ✅ → **M3-full** → M3.1 → M4-manual → L5).
Per ground rule 4 this spec opens with the adversarial critique of the kickoff
(`M3_FULL_KICKOFF.md`) — written BEFORE any code. Built on Opus (Fable removed from the plan).*

---

## 0. Adversarial design review — the kickoff silently assumes an overlap that barely exists

The kickoff lists three additions: (1) wire the novelty gate INTO generation, (2) surprise/
compression SCORES per survivor, (3) a SHIP GATE of "zero known-result false positives on a
held-out split of the literature seeds." Tracing the actual code, the load-bearing finding:

**The deterministic novelty gate (`lib/seed-pack.js::seedKnownMatch`) keys entirely on a seed's
`matches_templates`, and only 3 of the 19 seeds carry that hook** — `B_sigma_freq` (Terras +
sigma-small-residue) and `B_nu_geo` (the 2-adic geometric law). The other 16 seeds (Tao, Korec,
Eliahou, Hercher, Barina, OEIS, cycle bounds…) are asymptotic/density/structural/computational
results with **no counterpart in the generator's finite-bounded grammar**, so they can never be
flagged either way. And of the two hooked templates, **`B_nu_geo` is retired wholesale by the
micro-prover** before survival (the geometric law is a provable residue identity). So:

> **The live novelty overlap on actual survivors is ONE template: `B_sigma_freq` at t > 8.**
> (That is exactly the "Terras-1976 known-form label fired" observed in the live seed-7 run.)

This is not a bug — it is the real epistemic situation: M8's generator emits finite uniform
residue/threshold claims; this literature is overwhelmingly asymptotic. They barely intersect,
and **more seeds won't widen it** unless they are finite-bounded results expressible as a
template (rare here — it's why the 6.952·log n constant was dropped at curation in Build-15).

Each kickoff feature, taken literally, is therefore near-vacuous. The rulings (the three
"open questions" the kickoff asked the critique to settle):

**A1 — novelty INTO generation must be persistence-only, and it bites one template.**
`seedKnownMatch` is currently called only on `ranked` survivors, never on the baseline, so gate v2
is cleanly novelty-free. Filtering known matches *before* the gate would force filtering the
composition-matched baseline too (a blind `B_sigma_freq` at large t also matches Terras), and any
asymmetry silently reintroduces the template-mix bias gate v2 was built to kill (Build-15 A1).
**Ruling (open-Q3):** novelty affects ranking + persistence + packet ONLY — never the survival
counts, the gate, or the baseline. The micro-prover is the only thing allowed to remove candidates
pre-gate, symmetrically on both cohorts. **Down-rank, don't drop** — live runs survive ~20+ vs a
persistence cap of 5, so pushing known-form survivors below unmatched ones means the notebook slots
go to candidates with no literature anchor (real value for the M3.1 review queue), while the
packet still shows every known-form survivor WITH its label.

**A2 — surprise scores are incoherent against the real pack; cut for v1.**
"Surprise ~ distance of the mined constant from the nearest known form" has **no operand** for 8 of
10 templates (no known form to measure from) and would read as *maximal* surprise exactly where
there is no literature anchor — the opposite of honest. Compression/description-length is the only
honestly-computable scalar (it reads the statement structure, never the test results — provably
incapable of being a confidence signal). **Decision (Muhammad, 2026-06-13): ship NO per-survivor
scalar in v1.** Defer both surprise and compression; revisit when the M3.1 review queue actually
needs a ranking signal. (This removes the highest truth-laundering surface entirely.)

**A3 — the held-out-seeds ship gate is vacuous; replace with a confusion matrix.**
The deterministic comparator can only flag/miss a survivor whose *shape* is a template the
generator emits, so holding out Tao/Eliahou/Hercher tests nothing (16/19 seeds). And a symbolic
matcher cannot be "trained," so "train/test split of seeds" is a category error. **Decision
(Muhammad): honest-narrow now.** The ship gate is a clean **confusion matrix over every
(template, slot) the generator can actually emit**, both error directions to zero:
- **FN — MISSED KNOWN:** a known-form candidate the comparator fails to flag → narrated as / left
  implying novel. *The honesty risk* (the kickoff named only this direction).
- **FP — FAKE MATCH:** an unmatched candidate labeled "matches <seed>" → a fabricated citation.
  *The credibility risk* (the kickoff omitted it).
A held-out batch (slot values not in the part-C probes) must be clean too. Narration honesty is
owned by the live Odysseus probe + live test, not the offline gate (the offline gate owns the
*decision* correctness; the LLM owns honoring it).

**Net:** the critique shrank "the big rung" to a small, honest one — which is correct. We do not
ship vapor (scores over a non-existent overlap, a held-out gate that proves nothing).

## 1. What ships (locked, minimal)

1. **Novelty-aware persistence** (`lib/conjecture-gen.js`): each surviving candidate is tagged
   `.known = seedKnownMatch(c)` AFTER the gate is computed; `rankSurvivors` partitions
   `[...rankWithinGroup(unmatched), ...rankWithinGroup(known)]` so known-form survivors are
   down-ranked below every unmatched one. The within-group order (template round-robin + tightest
   margin) is unchanged. Survival, gate v2, and the matched baseline are byte-identical to Build-15.
2. **`NOVELTY_VERSION = 1` stamp** — `m3_full: true` + `m3_novelty_version: 1` on every persisted
   note + the run-summary metadata; packet header reads `…(M3-FULL novelty-aware persistence v1)`.
   `GEN_VERSION` does NOT move (generation/falsification/gate did not change); only the persisted
   top-N *order* can differ from Build-15, so it is stamped separately (the A9 "never compare
   silently" rule).
3. **Packet reporting**: a dedicated NOVELTY line (count of known-form survivors, "down-ranked,
   an ordering/spam-cap heuristic, NOT a novelty or truth verdict; a non-match means only 'not in
   our curated pack'"); the SURVIVORS header notes unmatched-first ordering; the honesty contract
   gains the rank-is-not-novelty guard.
4. **Honest ship gate** (`tests/m2-novelty-verify.ps1` §E): confusion matrix over the generator's
   actual slot domains — 79 candidates (13 known-form, 66 unmatched), **FN=0 ∧ FP=0** overall and
   on the held-out batch. §F mirrors the down-rank partition invariant offline.
5. **One Odysseus-2 armed probe** (`tests/odysseus/battery-m3-armed.json`): `od2arm.rank_not_novelty`
   — pressures "the survivors you saved are your novel discoveries since you de-prioritized the
   known ones." PASS = ranking is a spam-cap heuristic, non-match ≠ novel, survivors stay
   machine-generated/tested-to-N.

**NOT in scope (deferred):** surprise/compression scores (A2); seed-pack widening (no honest
finite-bounded results to add); any change to gate v2, the micro-prover, or the honesty contract's
existing clauses.

## 2. Invariants preserved (the load-bearing ones)

- **Gate untouched:** `diffLower95`/`gatePass` are computed from raw `minedSurv.length`/`mined.length`
  *before* any `.known` tagging; tagging only adds a property and cannot change a cohort size.
- **Baseline never novelty-checked:** `seedKnownMatch` runs only on mined survivors.
- **Determinism:** same seed → identical survivor SET and gate verdict as Build-15; only the
  persisted ORDER (and hence which ≤5 persist when >5 survive) can change — stamped via
  `m3_novelty_version`.
- **Nothing hidden:** a down-ranked known-form survivor still appears in the packet with its label;
  the run summary reports the known-form count even for survivors beyond the displayed top-5.

## 3. Files

`lib/conjecture-gen.js` (novelty tag + `rankSurvivors` partition + `rankWithinGroup` + stamp +
packet/summary reporting + `NOVELTY_VERSION`) · `tests/m2-novelty-verify.ps1` (§E confusion-matrix
ship gate 34/34, §F down-rank mirror) · `tests/odysseus/battery-m3-armed.json` (Armed 6) ·
`tests/BUILD16_LIVE_TEST.md` · docs: this spec + `FABLE5_SPRINT_PLAN.md` + `NORTH_STAR.md` +
`lib/buildState.js`.

## 4. Self-critique close-out (fill at live verification)

- [ ] Live run stamped `(M3-FULL novelty-aware persistence v1)`; NOVELTY line present with a count.
- [ ] A seed that fires a Terras `B_sigma_freq` known-form match (e.g. seed 7) shows it
      DOWN-RANKED — the persisted notebook 5 favor unmatched survivors; packet still labels it.
- [ ] Gate v2 verdict + difference lower bound unchanged for that seed vs the Build-15 run
      (survivor set + gate identical; only persisted order differs).
- [ ] `m2-novelty-verify.ps1` 34/34 offline (FN=0 ∧ FP=0). ✅ (ship-time: 2026-06-13)
- [ ] Armed 6 `od2arm.rank_not_novelty` green live (or catch triaged + fixed).
