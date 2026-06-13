# Build-15 (S8) — Gate v2 · Micro-Prover · M2 Seed Pack + Novelty Gate v1 · Alerting SPEC

*2026-06-13 · Fable-5 sprint S8 · scope locked by `M8_Team_Round3_Synthesis_2026_06_13.md` ·
this spec opens, per ground rule 4, with the adversarial critique of the locked scope —
written BEFORE any code.*

---

## 0. Adversarial design review — what's wrong with the plan as locked

**A1 — "cohort n=120 per side" is arithmetically impossible as specified.**
Mined candidates are deterministic given (template, structural slots): the constant
comes from the train census, so each (template, slots) pair yields exactly ONE
statement. Unique mined capacity at Build-14 domains ≈ 80 across all 8 templates
(A_nu_total_max has FOUR possible mined statements; B_nu_geo four; A_peak_power three).
`generateCohort` would spin its dedup guard and return a short, template-skewed cohort.
Nobody in the round checked this. **Resolution:** (a) expand slot domains (more moduli,
ν₂ thresholds, exponents — a genuine generator enrichment, not a knob); (b) make
allocation exhaustion-safe (a template that can't yield a new unique statement stops
being asked); (c) **the baseline must be generated to MATCH the mined cohort's
template composition** — otherwise Wilson compares survival across *different template
mixes*, a silent bias worse than the small-n problem the gate v2 was adopted to fix.
(c) is the load-bearing fix and it was in nobody's reply.

**A2 — the micro-prover will kill whole templates, and that's correct but must be
narrated.** ν₂(3n+1) is a function of n mod 2^(k+1) — *every* B_nu_geo claim is a
provable residue identity, exactly the class Gemini's zero-variance/covering-set test
targets. Likewise B_sigma_freq at small t (the σ≤t indicator is decided by parity
prefixes ≈ n mod 2^t). Survival rates will drop on BOTH cohorts and the gate will fail
more often, honestly. Expected and fine — but a run whose packet doesn't say "the
micro-prover retired N candidates as provable identities" would look broken. The
packet reports the trivial bucket explicitly. Re-baseline after (locked scope item 2).

**A3 — covering-set over-kill risk.** An empirical "constant within every mod-2^J
bucket" verdict on a small slice can be a sampling accident. Bias the test toward
UNDER-killing: flag trivial only when every bucket present has ≥3 members and the
slice is large (cap 4096 members); σ∞/peak-based quantities are dynamics-dependent and
will never trigger it. J_MAX=8 (k≤7 ν₂ indicators are caught; σ≤t indicators for t>8
escape — they are caught instead by the **novelty gate's** Terras seed, which is the
honest layering: micro-prover kills the *provable*, novelty gate labels the *known*).

**A4 — novelty gate v1 can over-claim what the literature contains.** Template-level
matching marks every B_sigma_freq survivor "covered by Terras 1976". Right per
Gemini's own argument (the statistical baselines ARE known math) — but the literature
does NOT contain our specific constant at our finite bound. Narration is locked to:
*"matches a known result form (X) — the general form is known mathematics; the
specific finite-bound figure is machine-derived"* — never "this is already proven".

**A5 — external seeds break "a theorem node = Lean-verified, full stop".**
`GRAPH_GROUND` currently tells the model a theorem node means exactly one thing.
Seeding Terras/Tao as `theorem` nodes makes that false. Alternatives considered:
seed literature theorems as `evidence` (lies about result_type; worse), or a new node
kind (schema churn, recall code forks). **Resolution:** theorem nodes now have exactly
TWO honest origins, distinguished by `source`: `code`+`lean_verified` (machine-checked
here) vs `external`+`literature` (cited, curation-verified). GRAPH_GROUND + recall
labels updated in the same commit that makes it possible — no window where the
directive lies.

**A6 — the seeding endpoint is new attack surface.** Mitigations: same CRON_SECRET
posture as `/api/cron-summarize`; POST seeds ONLY from the bundled, git-reviewed JSON
(no request-body seeds — the endpoint cannot be used to inject arbitrary nodes);
GET is read-only status; idempotent upserts on (kind, norm_label).

**A7 — the migration cannot be self-applied.** PostgREST does no DDL and this machine
holds no DB credentials (by design). `migrations/m2_external_source.sql` is a tiny
idempotent ALTER; it must be pasted into the Supabase SQL editor before seeding. The
endpoint detects the missing migration (CHECK violation on insert) and reports it
plainly instead of half-seeding: seeding is all-or-nothing per seed with a clear
`migration_required` flag in the response.

**A8 — armed probe 2 "full form" assumes co-occurrence that cosine recall doesn't
promise.** A survivor and a Terras seed only collide in one packet if one query is
semantically close to both. The probe asks about "stopping time densities / parity"
(the deliberate overlap of seed 1/14 and Type-B survivors) and keeps the
conversation-planted checks as fallback, so a recall miss degrades the probe, not
the gate.

**A9 — determinism continuity breaks.** Same seed, different output vs Build-14
(cohort size, domains, micro-prover). Runs are stamped `gen v2` in the packet and
`m3_gen_version: 2` in note metadata so old and new runs are never compared silently.

**A10 — scope discipline.** Q5 is a SPEC (July build). The temptation is to "just
add the table migration while we're here" — rejected; zero alerting code ships in S8.

## 1. What ships (locked order)

1. **Gate v2** (`lib/conjecture-gen.js`): cohort 120/side (capacity-aware, baseline
   composition-matched), gate = Wilson/Newcombe 95% lower bound of
   (p_mined − p_baseline) > 0; raw ratio demoted to a tracked metric; per-template
   diagnostics retained; seeds stay user-controllable.
2. **Micro-prover pre-falsifier** (same lib): zero-variance + covering-set residue
   decidability (J≤8, under-kill bias), BOTH cohorts, pre-falsification; trivial
   bucket reported; hand σ-exclusions stay but stop growing.
3. **M2 seed pack v1**: `migrations/m2_external_source.sql` · `data/seed-packs/
   collatz-v1.json` (18 atomic seeds, adopted two-axis schema, every load-bearing
   figure verified against sources this session — see §3) · `lib/seed-pack.js`
   (deterministic novelty comparator + schema validation) · `api/seed-pack.js`
   (idempotent seeding endpoint) · recall LITERATURE labels + GRAPH_GROUND update ·
   M3 packet/notes carry "matches known result form" + a semantic (embedding)
   adjacency pass over survivors.
4. **Odysseus-2 arming**: probe 2 full graph-vs-graph form + novelty narration probe
   (armed corpus); NORTH_STAR's M2 gate = `tests/m2-novelty-verify.ps1`, 10/10
   planted known/unknown candidates against the deterministic comparator.
5. **`ALERTING_SPEC.md`** — stateful alerting, cash-gap first (spec only).
6. *Stretch:* ONE cross-feature conditional template (A/B realizations:
   ν₂≥k → peak/n ≤ c · peak/n≥t → ν₂=1 frequency ≥ p) + edge-count summarization
   in the recall packet.

## 2. Gate v2 statistics (the exact rule)

Wilson interval per cohort (z=1.96): for k survivors of n,
center = (p̂ + z²/2n)/(1+z²/n), half = z·√(p̂(1−p̂)/n + z²/4n²)/(1+z²/n).
Newcombe difference lower bound: L = (p₁−p₂) − √((p₁−l₁)² + (u₂−p₂)²).
**Gate passes iff ≥1 mined survivor AND L > 0.** Denominators are full cohort sizes;
trivial (micro-prover) and vacuous candidates count in the denominator and never in
the numerator — identical rule both cohorts (the vacuity-floor precedent).
High seed variance now fails honestly (L dips below 0) instead of flickering at 2.0×.

## 3. Seed pack curation record (KG-integrity acceptance step)

Verified online this session (2026-06-13): Terras 1976 (Acta Arith. 30, 241–252;
density-1 finite stopping time; parity/CLT method) · Tao 2019 (arXiv:1909.03562;
almost-bounded values, LOGARITHMIC density — scope recorded on the seed) · Korec 1994
(θ > ln3/ln4 ≈ 0.7924, natural density) · Krasikov–Lagarias 2003 (≥ x^0.84 reach 1) ·
Barina verification 2^71 (project + "Improved verification limit" paper; published
J. Supercomputing 2021 baseline 2^68) · Eliahou 1993 (nontrivial cycle length
≥ 17,087,915) · Hercher 2022 (arXiv:2201.00406; no m-cycles, m ≤ 91, superseding
Simons–de Weger). Cross-checked against the Lagarias surveys: Steiner 1977 (no
1-cycles), Everett 1977 (independent density proof), parity-vector equidistribution,
ν₂ geometric law (elementary 2-adic argument). Each seed's JSON carries
`verification` (method + date). Dropped at curation: the ~6.952·log₂n average
total-stopping-time constant (could not pin the normalization to a source this
session — a seed we can't verify is a seed we don't ship).

## 4. Novelty gate v1 (what it is, what it is not)

Deterministic first pass (in-process, hermetic-safe): survivor template + structural
slots vs each seed's `matches_templates` patterns (`"B_nu_geo"` covers the family;
`"B_sigma_freq:t=1"` pins a slot). Hit → packet + note labeled "matches known result
form (<seed>)", `metadata.known_match`. Embedding second pass (live sessions only,
fail-safe, budget-capped): survivor statements vs external nodes via cosine; hits ≥
0.82 reported as "semantically close to <literature label>" — adjacency, never an
identity claim. NOT a literature search; NOT a truth upgrade; M3-full's
zero-false-positive gate still owns final novelty claims.

## 5. Files

`lib/conjecture-gen.js` (v2) · `lib/seed-pack.js` + `data/seed-packs/collatz-v1.json`
+ `api/seed-pack.js` + `migrations/m2_external_source.sql` · `lib/memory-graph.js`
(external source, LITERATURE labels, GRAPH_GROUND, edge summarization, semantic pass)
· `lib/orchestrator.js` (novelty hook) · `vercel.json` · `ALERTING_SPEC.md` ·
tests: `m3-conjecture-verify.ps1` (v2 mirrors), `m2-novelty-verify.ps1` (10/10 gate),
`battery-m3-armed.json` (probe 2 full + novelty), `BUILD15_LIVE_TEST.md`.

## 6. Self-critique close-out (to fill at ship time)

- [ ] Gate v2 live behavior recorded (PASS/FAIL + lower bound, ≥2 seeds)
- [ ] Micro-prover live: B_nu_geo retired? trivial bucket narrated?
- [ ] Seeds live with `external` provenance + LITERATURE recall labels
- [ ] 10/10 novelty probes green offline
- [ ] Armed battery green (or catches triaged + fixed)
