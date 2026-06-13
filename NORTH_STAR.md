# M8 — North Star (CANONICAL · FIXED)

> Single source of truth for M8's vision. **Do not redraw or re-derive it per session.**
> If the vision genuinely changes, edit this file and the diagram deliberately — never silently regenerate.
> **Canonical diagram:** [`m8_full_architecture_2026.html`](./m8_full_architecture_2026.html)
> (A Desktop copy is kept in sync; the repo copy is authoritative.)
>
> **Session-close ritual (standing):** when a session is finalized, update *this file*
> and *the diagram* with what shipped — flip status cells, bump maturity %, move the
> active-build marker. Update the cells, not the structure or the North Star wording.
> This is what keeps the vision from diverting. Stay on it; don't get distracted.

---

## The North Star (apex — never changes)

**M8: Personal Intelligence + Unsolved-Problem Engine.**

Two missions, one compounding system:

- **Track A — Personal AI OS.** Run Muhammad's world: fleet, finance, ops, projects.
- **Track B — Unsolved-Problem Engine.** Build toward cracking unsolved problems —
  acquiring whatever capability that takes: number theory, algebra, geometry,
  combinatorics, formal verification, research synthesis.

Every session compounds: operational context, domain knowledge, conjectures, even
failed attempts. The destination is a system so integrated that running the business
or probing an open problem without it becomes unthinkable — and that gets measurably
smarter each session.

*The claim we never make: that we're already there.*

M8 is a deterministic harness around a frontier model's spark — it enforces the
structure, honesty, and persistence the raw model won't maintain on its own.

---

## Track A — Personal AI OS *(the proving ground)*
Real utility, on real data, today. Keeps M8 honest in consequences, not just prose.
- Fleet intelligence · Finance / P&L · EOSB · multi-company registry
- Operator-assistant breadth · web search · code execution · ops memory

## Track B — Unsolved-Problem Engine *(the ascent)*
The autonomous-exploration ladder, each rung strictly more capable than the last:
1. **Discovery loop** — verify a KNOWN property to a STATED bound + log evidence ✅
2. **OEIS probing** — discover an UNKNOWN formula/recurrence from raw terms ✅ (Build-8)
3. **Lean verification** — formalize a conjecture and machine-check it ✅ (Builds 9–12:
   corpus 37/37 · bench 0.3→0.65 · lean_stated live · mathlib pinned)
4. **Autonomous exploration loop** — full Observe → Hypothesize → Test → Record (L5)
   ← **next ascent, via the middle layers below (S5, 2026-06-12)**

**Domain mastery (build what it takes):** teach M8 the math it needs as problems demand —
number theory (active), algebra, geometry, combinatorics, and Lean 4 + Mathlib formal verification.

### The middle layers (S5 roadmap, REV 2 after team round 2026-06-12 — rungs between 3 and 4)
Rung 4 is a scheduler over capabilities that must exist first. Autonomy multiplies
quality; it cannot create it. Each layer ships as a thin slice behind a measurable gate.
*Order revised by team round 2 (3–1): the generator runs before literature — the
falsifier doesn't need Terras 1976 to kill a bad conjecture; M2 gates "worthy of human
attention," not "worthy of generation."*

- **M1 — Structural probe pack** ✅ **SHIPPED Build-13 (S6, 2026-06-12) — GATE PASSED**
  (Collatz-first): `lib/collatz-probes.js`, deterministic in-process census of all 7
  feature families (stopping times, parity vectors on the Terras map, 2-adic valuations,
  max excursions, residue-class census, record-setters) → NEUTRAL evidence nodes (zero
  supports edges — a census is not evidence *for* the conjecture) — *not* bound-pushing,
  which is theater (Collatz is known to ~2^71). HARD per-turn recall cap live
  (GRAPH_EVIDENCE_CAP=4, context-dilution guard). Gate passed live: parity / records /
  2-adic queryable from chat.
- **M3-lite — Conjecture generator v1** ✅ **SHIPPED Build-14 (S7, 2026-06-12)**:
  `lib/conjecture-gen.js` — **Type A**: computable predicate + explicit bound; **Type B**:
  trend/statistical claim over a bounded sample (exhaustive deterministic count at v1
  bounds; seeded Monte Carlo reserved for beyond-exhaustive bounds), narrated only as
  "observed through N", never "true". Candidates are MINED from the M1 features over a
  TRAIN census (test/10) and falsified deterministically over the full TEST range — v1
  deliberately narrowed the proposal step to seeded template-mining in code (LLM
  proposal joins at M3-full, where the novelty gate can police it). Survivors =
  machine-generated `conjecture` nodes (status tested_to_N, own thread collatz-m3,
  MACHINE-GENERATED recall labels); kills are packet-reported with counterexamples,
  not persisted (spam guard, a v1 narrowing of "failures = failed_attempt data").
  Hard cap (5/run) + canonical-statement graph-dedup. Survivors are NEVER promoted
  past tested-to-N before M3-full. Gate live: survival **≥2× a random-conjecture
  baseline** + non-triviality floor (≥2 distinct M1 features by construction + a
  vacuity floor — slack claims don't count as survivors, both cohorts) ·
  Odysseus-2 M3-armed probes armed (`battery-m3-armed.json`).
- **M2 — Literature seed packs** ✅ **SHIPPED Build-15 (S8, 2026-06-13) — GATE PASSED
  10/10** (curated, never crawled): 19 hand-curated, source-verified Collatz results
  as `external`-provenance graph nodes (`data/seed-packs/collatz-v1.json`: Terras
  1976, Everett, Lagarias surveys, Tao 2019, Korec, Krasikov–Lagarias x^0.84,
  Barina 2^71, Eliahou/Hercher/Steiner/Garner cycle constraints, elementary residue
  identities, OEIS refs — every load-bearing figure verified at curation time, the
  KG-integrity acceptance step). **Novelty gate v1**: deterministic canonical-form/
  template comparator (10/10 planted known/unknown probes, `tests/m2-novelty-verify.ps1`)
  + embedding adjacency second pass; survivors narrate "matches known result form".
  Recall labels literature LITERATURE; theorem nodes = lean_verified OR cited external,
  nothing else. *Build-15 also re-tooled the generator: gate v2 (Wilson-difference,
  cohort 120, ratio demoted to metric) + micro-prover pre-falsifier (zero-variance +
  covering-set — provable identities retire automatically; B_nu_geo gone wholesale) +
  cross-feature conditional template v1.1.* Live after one manual migration paste
  (`migrations/m2_external_source.sql`) + POST /api/seed-pack. Non-goal held: no
  PDF-parsing pipelines.
- **M3-full — Novelty-aware generation**: M3-lite + the M2 novelty gate; surprise /
  compression scores tracked as metrics. Gate: **zero known-result false positives on
  held-out literature seeds**. Requires the Odysseus-2 self-contamination family green
  (M8 must distinguish literature truth from its own surviving conjectures under
  adversarial retrieval pressure).
- **M3.1 — Clustering + prioritization**: cluster survivors, rank by interestingness,
  feed a human-review queue. The cheap layer before any proof scaffolding.
- **M4-manual — Lemma-DAG scaffolding, HUMAN-architected**: Muhammad provides the DAG in
  plain English; M8 formalizes the leaves and orchestrates /check. NO autonomous proof
  search (AlphaProof-class compute cosplay on this stack — de-scoped). Entry condition:
  M3 has produced 50 candidates → 5 survivors → ≥1 a human finds genuinely interesting.
  Gate: ≥1 verified leaf requiring ≥2 distinct Mathlib imports + induction, against an
  adversarial invalid-shortcut probe.

**Odysseus-2** (gates M3-full and L5): faithfulness family (assumption-dropping /
theorem-substitution on the Lean lane) + self-contamination family (own-conjecture vs
literature provenance under adversarial retrieval). *Designed + 11 probes shipped
Build-13; first self-contamination run caught 2 real upgrade-pressure caves → research
upgrade-pressure guard now deterministic in both paths. M3-armed probes specified for S7.*

**Then** L5 = a budgeted cron over M1→M3 (+M4-manual where applicable), gated on 3
consecutive unattended runs with zero battery regressions. *Explicitly de-scoped:
Navier-Stokes / Millennium-tier targets — PDE numerics do not fit this stack; number
theory and combinatorics adjacency only. Autonomous proof-tree search — same verdict.*

---

## The Spine *(load-bearing foundation under both tracks)*

The honesty layer is the beam that holds the whole structure. If it ever cracks —
if M8 treats *verified-to-N* as *proof* — the North Star collapses.

- **Deterministic routing** — hard-routes (regex-first) before LLM tool-decision; verified compute
- **Honesty contract** — narration ≤ evidence · EXEC_MARKER required · no upgrade under user pressure
  · **Odysseus battery** (Build-11, +Odysseus-2 Build-13): 49-probe adversarial immune system, run on every build
- **Research Notebook + Memory Graph** (Build-10) — persistent substrate; nodes/edges +
  pgvector recall; failed attempts are data, not noise
- **Model backbone** — Gemini for orchestration; Fable 5 (`claude-fable-5`) reserved for the hardest reasoning (Lean formalization)
- **Executors** — Vercel (serverless) · Supabase (state) · Cloud Run `m8-lean-check` (Lean 4 + Mathlib)

---

## Maturity ladder (position gauge — update the percentages, never the structure)

| Level | State |
|-------|-------|
| L1 Chatbot | ✅ complete |
| L2 Grounded assistant | ✅ complete |
| L3 Proactive ops | 🟢 ~85% |
| L4 Verified tools | 🟢 ~80% ← current |
| L5 Autonomous loop | ⚪ ~50% (M1 + M3-lite + M2/novelty shipped) |
| L6 Compound | ⚪ the destination |

---

*Canonical as of Session-16 / S8 Build-15 (2026-06-13). Edit deliberately; do not regenerate from scratch.*
