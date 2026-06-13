# Team Round 2 — Synthesis & Adopted Changes
*2026-06-12 · inputs: M8 (self-review), GPT, Grok, Gemini (no Manus this round) ·
synthesized by Fable 5, approved by Muhammad · responds to M8_Team_Brief_S5_2026_06_12.md REV 2*

## Verdicts on the five attack questions

### Q1 — Layer order: **roadmap loses, 3–1. ADOPTED: M1 → M3-lite → M2 → M3-full**
M8, GPT, Gemini: the falsifier doesn't need literature to kill bad conjectures; M2's real
function is gating "worthy of human attention," not "worthy of generation." Blocking the
generator on manual curation parks the hardest unknown (can M8 generate non-trivial
falsifiable structure at all?) behind data entry. Grok dissented (novelty first) —
resolved by GPT's **M3-lite / M3-full split**: M3-lite runs early against M1 features;
survivors are NEVER promoted past "machine-generated, tested-to-N" until the M2 novelty
gate exists and M3-full re-screens them.

### Q2 — M3 schema: **unanimous hit. ADOPTED: Type B trend/statistical conjecture**
All four independently named the same exclusion (density/asymptotic/trend claims).
Merged shape — **Type B**: a frequency or trend claim over a bounded sample, evaluated
deterministically (exhaustive count or SEEDED Monte Carlo in the sandbox), with optional
computable threshold function f(k); narrated ONLY as "observed through N" — never "true."
Type A (computable predicate + explicit bound) unchanged.

### Q3 — Gates: **M3 and M4 gates both hardened**
- M3-lite gate (was: survival rate — gameable by trivial survivors): survival rate must
  beat a **random-conjecture baseline ≥2×** + non-triviality floor (≥2 distinct M1
  features or non-trivial predicate). Surprise/compression scores (GPT) tracked as
  metrics, not hard gates.
- M3-full gate adds (Grok): **zero known-result false positives on held-out literature
  seeds**.
- M4 gate (was: ≥3 verified leaves — passable with 1+1=2 via simp): ≥1 leaf requiring
  **≥2 distinct Mathlib imports + proof by induction**, evaluated against an adversarial
  invalid-shortcut probe (Gemini).

### Q4 — Months-of-waste: **M4 demoted to M4-MANUAL, behind a discovery-pressure test**
Consensus: auto-decomposition of novel targets into lemma DAGs is AlphaProof-class
compute cosplay on a $10/month stack; it produces sorry-riddled noise and bureaucracy
around garbage. Adopted: **human architects the DAG in plain English; M8 formalizes the
leaves and orchestrates /check.** Entry condition (GPT): M3 must first produce
**50 candidates → 5 survivors → 1 that a human mathematician finds genuinely
interesting.** M8's **M3.1 (conjecture clustering + prioritization)** inserted as the
cheap layer before any scaffolding.

### Q5 — Track A July build: **proactive alerting, STATEFUL**
Convergence (M8 + GPT + half of Grok). GPT's framing makes it strategic: alerting is the
first production Observe → Detect → Evidence → Escalate loop — the architectural template
for L5. Gemini's amendment adopted as a REQUIREMENT: alerts must be stateful —
alert/intervention state lives in the memory graph (driver-entity nodes), deltas tracked,
no amnesiac re-alerts. Concrete v1 conditions from M8's self-review (acceptance-rate
drop, utilization floor, cash-gap threshold) are the seed spec.

## Two unsolicited risks — both adopted
1. **Graph self-contamination** (GPT): after M3, retrieval must weight provenance hard or
   M8 will cite its own surviving conjectures as external knowledge — research-grade
   hallucination. → New Odysseus family: "distinguish literature truth from own surviving
   conjectures under adversarial retrieval pressure." MANDATORY before M3-full and L5.
2. **Context dilution / RAG poisoning** (Gemini): M1–M3 node volume will flood recall and
   push the honesty contract out of the model's attention. → Hard deterministic cap on
   evidence/external nodes per turn + code-level truncation, specified in M1's build.

## Discarded / corrected
- Grok round-2 staleness: research_notes migration ("run the SQL today") ran 2026-06-10;
  Phase-0 framing superseded by Builds 8–12. Grok's OpenRouter runtime-Fable mention
  remains REJECTED (settled).
- Round-1 leftovers already adopted: Odysseus faithfulness family (assumption-dropping /
  theorem-substitution), SSE second vote, Ops Memory pressure (now folded into stateful
  alerting).

## Bug found during the round
M8's own review reply ended with a discovery-lane coda (`▶ Next probe: verify sse up to
40 and log it`) on a non-research conversational turn — the next-probe suggestion leaked
outside a discovery run, and "sse" was parsed as a research thread. Routing artifact;
triage next session (likely suggestNextProbe staging fires on history echo).

## Revised middle-layer ladder (canonical from this round)
```
M1  Structural probe pack (Collatz features → graph; hard recall cap)
M3-lite  Conjecture generator v1 (Type A + Type B; falsifier; ≥2× random baseline)
M2  Literature seed packs + novelty gate (gates "worthy of human attention")
M3-full  Novelty-aware generation (0 false positives on held-out seeds; surprise tracked)
M3.1  Clustering + prioritization of survivors (human-review queue)
M4-manual  Human-architected lemma DAGs; M8 formalizes leaves (entry: 50→5→1 test)
L5  Budgeted cron over M1→M3 (entry: 3 unattended runs, 0 battery regressions)
Odysseus-2 (faithfulness + self-contamination families) gates M3-full and L5.
```

## Fable window allocation (remaining ~10 days)
- **S6 / Build-13:** M1 structural probe pack + Odysseus-2 probe-family design
  (faithfulness + self-contamination — adversarial design is Fable-shaped).
- **S7 / Build-14:** M3-lite (Type A+B schema, deterministic falsifier, random-baseline
  generator, gates, caps/dedup) + run Odysseus-2 against it.
- **S8 (if window remains):** M2 Collatz seed pack authored by Fable (math-literacy
  bottleneck) + stateful-alerting SPEC for July.
- **SSE streaming: displaced to post-window** — by the plan's own logic it is the one
  remaining item survivable with other models after June 22.
- July (any model): stateful proactive alerting build · lean badges UI · fleet
  name-parse fix · discovery-coda leak fix.
