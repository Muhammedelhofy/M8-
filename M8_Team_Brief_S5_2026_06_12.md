# M8 Team Brief — S5 North-Star Roadmap Round
*2026-06-12 · for GPT / Grok / Gemini / Manus review · authored by Fable 5, approved by Muhammad*
*Standalone document — assumes no prior context beyond this file.*

---

## 1. What M8 is (one paragraph)

M8 is a personal AI system on a ~$10/month stack (Vercel Hobby + Supabase + Gemini Flash +
a Cloud Run Lean 4 checker) with two missions: **Track A**, running Muhammad's fleet/finance
operations in Riyadh (live, in daily use), and **Track B**, a long-horizon unsolved-problem
engine built on a strict honesty spine — deterministic hard-routes before any LLM call,
narration never exceeding machine-checked evidence, every claim logged to a persistent
research notebook + memory graph. Fable 5 (Claude) works as the *engineer* in free Claude
Code sessions until 2026-06-22; it is never the paid runtime.

## 2. What shipped in the Fable window (S1–S4, all in 36 hours)

| Build | What | Proof |
|---|---|---|
| **Build-10** — Research Memory Graph | nodes/edges + pgvector recall; notebook/Lean results auto-link; anti-confabulation packets | live tests A–F green; 1 real laundering bug found+fixed; battery 4.7/5 no regression |
| **Build-11** — Odysseus battery | 38-probe adversarial immune system, standalone runner, offline grader | first contact 33/38; **3 real bugs found+fixed live** (slot-fill hijack of hard-routes, graph detection gap, Lean meta-question dodge) |
| **Build-12** — Lean hardening | golden corpus (37/37 vs live checker), 11 few-shot exemplars, `lean_stated` live, MATHLIB_REV pinned `b580ec53f9e3` | formalization benchmark **0.3 → 0.65** on held-out claims; failure mode changed from "LLM fakes proofs in prose" to "honest rejections" |
| **S4 close-out** | `lean.verified_theorem` spot-checked live (`(a+b)^2` → `by ring`, verified); explicit-Lean-ask-outranks-discovery precedence fix | root cause found: `BOUND_RE` matched "greater than or equal **to 4**" as a discovery bound |

Current maturity: **L4 ~80%** (verified tools) · L5 (autonomous loop) ~20%.

## 3. The S5 question: what stands between here and the autonomous loop?

The naive next step — wire Observe→Hypothesize→Test→Record as a cron — fails the
adversarial critique:

1. **Autonomy is a multiplier, not a capability.** The Hypothesize rung doesn't exist;
   M8 has never generated a conjecture unprompted. A loop today automates spam.
2. **The graph only knows what we typed into it.** Zero external knowledge → novelty
   detection impossible. The first auto-conjecture will be known-since-1976 and M8 can't tell.
3. **Nothing at this budget does proof search.** The Lean lane's honest ceiling is faithful
   statements + textbook-lemma discharge.
4. **Bound-pushing is theater.** Collatz is verified to ~2^71 (Barina); our bounded runs
   validate pipeline, not mathematics.
5. **Millennium-tier language (Navier-Stokes) was fantasy at this scale.** Now de-scoped.

## 4. The middle layers (the S5 roadmap — critique these)

Each ships as a thin slice behind a measurable gate (the Build-12 "data not opinions" rule):

- **M1 — Structural probe pack** (Collatz-first, 1 build): discovery-lane extension
  producing structured features — stopping times, parity vectors, 2-adic valuations,
  max excursions, residue census, record-setters — into the graph as `evidence` nodes.
  *Gate: ≥3 feature families queryable from chat.*
- **M2 — Literature seed packs** (1 build): 20–50 hand-curated known results per problem
  as `external`-provenance graph nodes (Terras 1976, Tao 2019, Barina, cycle constraints).
  Unlocks the **novelty gate** ("is this already known?" = graph query).
  *Gate: 10/10 planted known/unknown probes. Non-goal: PDF pipelines.*
- **M3 — Conjecture generator v1** (1–2 builds): LLM proposes candidates in a constrained
  schema — computable predicate + explicit bound or not admitted; deterministic falsifier
  executes; survivors logged as machine-generated conjectures (tested-to-N, never "true");
  failures logged as `failed_attempt` data. Hard cap + graph-dedup = spam guard.
  *Gate: survival-rate metric + zero honesty violations under a new Odysseus probe family.*
- **M4 — Lemma-DAG proof scaffolding** (1–2 builds): decompose targets into `depends_on`
  lemma DAGs; discharge leaves with allowlisted tactics; sorried parents type-check as
  scaffold; graph tracks % discharged. Honest ceiling: a verified-lemma library, not
  open-problem proofs. *Gate: one scaffold with ≥3 machine-verified leaf lemmas.*
- **L5 ships last**: a budgeted cron over M1→M3(→M4), promotion-gated on 3 consecutive
  unattended runs with zero battery regressions and ≥1 surviving conjecture.

**The honest 12-month statement:** the realistic outcome is a compounding research
instrument — curated knowledge base, falsifiable-conjecture pipeline with survival
metrics, growing verified-lemma library. A novel result is a lottery ticket whose EV
rises with each layer; the infrastructure *is* the expected value.

## 5. What we want from this round

1. **Attack the layer order.** Is M2 (literature) really prerequisite to M3 (conjectures),
   or can a falsifier-gated generator run usefully against M1 features alone?
2. **Attack the M3 schema.** "Computable predicate + explicit bound" — what conjecture
   shapes does this wrongly exclude (asymptotic claims, density statements)? Is there a
   second admissible shape that stays deterministically falsifiable?
3. **Attack the gates.** Which of the five gates is softest? Propose a harder metric.
4. **Name anything here that still smells like months-of-waste** that the brutal-honesty
   pass missed.
5. **Track A**: with research layers consuming the window, what's the single
   highest-leverage Track A build for July? (Proactive alerting is the current candidate.)

*Constraints that are fixed: free Gemini stack as runtime default · Vercel Hobby 12-function
cap · honesty contract is non-negotiable · Track A never breaks · riba-free finance features.*

---
*Canonical docs: `NORTH_STAR.md` (vision, fixed) · `M8_Evolution_Plan_2026.md` (S5 revision) ·
`FABLE5_SPRINT_PLAN.md` (window log) · diagram `m8_full_architecture_2026.html`.*
