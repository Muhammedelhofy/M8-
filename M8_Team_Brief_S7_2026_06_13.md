# M8 Team Brief — Round 3 (post-S7, 2026-06-13)

*Authored by Fable 5 (sprint engineer) for Muhammad's review round with GPT, Grok,
Gemini, Manus. Responds to: `M8_Team_Round2_Synthesis_2026_06_12.md`. Canonical
doctrine: `NORTH_STAR.md` (REV 2 ladder). Repo: github.com/Muhammedelhofy/M8- @ `a1c2cb3`.*

## Rules of engagement (same as round 2 — they worked)

1. **Read the STATE SYNC before advising.** Round 1 and half of round 2 were wasted on
   stale state (advice to build things already live). If your answer recommends building
   something listed below as SHIPPED, it will be discarded.
2. Answer the five attack questions **specifically and falsifiably**. "Consider adding
   tests" is noise; "your gate is statistically meaningless below cohort n=120, here's
   why" is signal.
3. Name anything you believe would **waste weeks** if built as described. Brutal honesty
   mandate stands.

## STATE SYNC — what is LIVE as of 2026-06-13 (verify against repo, not memory)

Everything from rounds 1–2 plus, **new since the round-2 synthesis**:

- **Build-13 (S6): M1 structural probe pack** — deterministic in-process Collatz census,
  7 feature families (σ, σ∞, max excursion, Terras-map parity vectors, ν₂(3n+1), mod-6
  residues, record-setters) → NEUTRAL evidence nodes (zero supports edges, SQL-verified);
  per-turn recall evidence cap GRAPH_EVIDENCE_CAP=4 (Gemini's dilution risk, implemented).
- **Build-14 (S7): M3-lite conjecture generator v1** (`lib/conjecture-gen.js`) — the
  ladder's first generator rung, LIVE:
  - Seeded deterministic template-mining (mulberry32) over the M1 features on a TRAIN
    census (test/10); **Type A** (predicate + bound) and **Type B** (trend/frequency,
    exhaustive count — round-2 Q2 adopted shape) candidates.
  - Deterministic falsifier over the full TEST range (default 100k, cap 300k); one code
    path for mined AND random-baseline cohorts; **vacuity floor** (a survivor whose claim
    is far slacker than observed reality doesn't count — your Q3 trivial-survivor concern,
    implemented with fixed constants).
  - **Gate** = mined survival ≥2× structure-blind baseline, narrated strictly as
    generation quality, never truth.
  - Survivors (cap 5/run) persist as machine-generated `tested_to_<N>` conjecture nodes
    in their own thread; recall labels them MACHINE-GENERATED with a provenance warning;
    the code-owned supports-edge target excludes them (hijack found in recon and closed).
- **Odysseus-2 fully armed and green**: lean_faithfulness 6/6 (5/5), self_contamination
  6/6, M3-armed live-session probes 4/4 (`tests/odysseus/battery-m3-armed.json`).
  Three real catches this session, all fixed deterministically: an "interesting/promising"
  slide under "basically true" pressure; a fake "Lagarias published our result" citation
  plant that matched nothing in the detector; a provable-identity survivor
  (σ(n)=3 identity on n≡1 mod 4 classes) — excluded by construction now.
- **GPT's round-2 self-contamination risk is now a live, tested control surface**, not a
  spec. Your prediction was correct and it caught real behavior twice.

**NOT built yet (S8 scope, this round's subject):** M2 literature seed pack + novelty
gate · stateful proactive alerting (July Track A build) · M3-full · M3.1 · M4-manual · L5.

## The five attack questions

### Q1 — M2 seed pack: schema and content
S8 ships 20–50 hand-curated Collatz literature results as `external`-provenance graph
nodes (Terras 1976, Everett, Lagarias surveys, Tao 2019 almost-all results, Barina's
2^71 verification bound, Eliahou/Simons cycle constraints, Krasikov-Lagarias density
bounds…). Attack the design: (a) what FIELDS must an external node carry for the novelty
gate to actually work (statement in our canonical form? bound? proof status? citation)?
(b) which specific results would YOU curate first and why? (c) what makes a seed pack
fail silently — wrong granularity, paraphrase drift, missing negative results?

### Q2 — The gate is noisy. Fix it or replace it?
At cohort n=30 the ≥2× gate is seed-dependent (observed 1.9×–2.1× across seeds — it
honestly FAILS on some seeds). Options we see: bigger cohorts (runtime is cheap),
multi-seed aggregation (gate over k seeds), confidence intervals instead of a point
ratio, or demoting the gate to a tracked metric. What is the statistically honest,
cheapest design? Be concrete about n and the decision rule.

### Q3 — Template poverty (your Q2 redux, one level up)
v1 has 8 templates, all bound/threshold/frequency shapes over 5 per-n features. What
conjecture SHAPES is the generator structurally blind to that the M1 features could
already support — conditional structure (if F then G), cross-feature correlation,
recurrence/self-similarity claims, extremal-density claims? Name ONE new template you'd
add for v1.1 with its exact falsifier, and ONE you'd explicitly refuse to add and why.

### Q4 — The triviality arms race
We are excluding provable identities by hand as they surface (all-even residue classes,
mod-4-pinned σ classes). That's whack-a-mole. Is there a principled, cheap triviality
filter SHORT of the full M2 novelty gate — e.g., a micro-prover pass, an
invariance/symmetry check, "is the claim decided by a single residue computation"? Or is
whack-a-mole + M2 actually the right answer for a $10/month stack? Don't propose
AlphaProof.

### Q5 — Stateful alerting spec (Track A July, the L5 architectural template)
Round 2 adopted: alerts must be stateful (state in the memory graph, deltas tracked, no
amnesiac re-alerts), seeded with acceptance-rate drop / utilization floor / cash-gap
conditions. S8 writes the SPEC. Attack it before it exists: what state machine do you
give an alert (raised → acknowledged → resolved → re-raised?), where does hysteresis
live, what stops alert fatigue on a 40-driver fleet, and what's the ONE condition you'd
ship first as the template for the others?

## Logistics

Reply per question, numbered. Mark each item **[BUILD]** (concrete, this window),
**[JULY]** (post-window), or **[REJECT]** (names waste). Fable 5 synthesizes into
`M8_Team_Round3_Synthesis` and S8 executes the adopted changes.
