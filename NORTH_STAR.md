# M8 — North Star (CANONICAL · FIXED)

> Single source of truth for M8's vision. **Do not redraw or re-derive it per session.**
> If the vision genuinely changes, edit this file and the diagram deliberately — never silently regenerate.
> **Canonical diagram:** [`m8_mind_2026.html`](./m8_mind_2026.html) — the "M8 Mind" view (promoted Session-44, 2026-06-17).
> (The old dense `m8_full_architecture_2026.html` is archived under `archive/diagrams/` — superseded, not deleted.)
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
- **M3-full — Novelty-aware PERSISTENCE** ✅ **SHIPPED Build-16 (2026-06-13)**: the M2 novelty
  gate wired into PERSISTENCE — known-form survivors (deterministic `seedKnownMatch`) are
  down-ranked below unmatched ones so the capped notebook favors candidates with no pack match;
  gate v2 / matched baseline / survival counts are untouched (`.known` is tagged AFTER the gate).
  Per-survivor surprise/compression scores were **CUT** — the mandatory critique (`archive/BUILD_16_SPEC.md`
  §0/A2) found surprise's "distance from the nearest known form" has no operand for 8/10 templates
  and is the highest truth-laundering risk. Ship gate **REFRAMED** from "zero false positives on
  held-out literature seeds" (vacuous: 16/19 seeds aren't generator-expressible) to a **confusion
  matrix over every generator-expressible (template, slot): FN=0 (no known form narrated novel) ∧
  FP=0 (no fabricated citation), held-out batch clean** (`tests/m2-novelty-verify.ps1` §E, 34/34).
  Honest finding: the live known/generated overlap is ONE template (`B_sigma_freq` at t>8;
  `B_nu_geo` is micro-proved away before survival). Requires the Odysseus-2 self-contamination
  family green + Armed 6 `od2arm.rank_not_novelty` (ranking is a spam-cap heuristic, never a
  novelty/truth verdict). M3.1 is the better next "big" rung — the honest overlap is small.
- **M3.1 — Clustering + prioritization**: cluster survivors, rank by interestingness,
  feed a human-review queue. The cheap layer before any proof scaffolding.
- **M4-manual — Lemma-DAG scaffolding, HUMAN-architected**: Muhammad provides the DAG in
  plain English; M8 formalizes the leaves and orchestrates /check. NO autonomous proof
  search (AlphaProof-class compute cosplay on this stack — de-scoped). Entry condition:
  M3 has produced 50 candidates → 5 survivors → ≥1 a human finds genuinely interesting.
  Gate: ≥1 verified leaf requiring ≥2 distinct Mathlib imports + induction, against an
  adversarial invalid-shortcut probe.
  **✅ SHIPPED Build-18 (`7760947`, 2026-06-13) + §0.4 GATE PASSED LIVE (2026-06-14, Build-18.1)**:
  leaf discharge via Lean (`lib/lemma-dag.js`), "leaves verified k/m" + "NOT proven / open
  conjecture" framing held under live pressure (incl. direct "so it's basically proven now,
  right?"). **GATE GREEN** with a Finset Gauss-sum leaf (`2·Σ_{range(n+1)} i = n·(n+1)`):
  `lean_verified` + `induction` + 2 namespaces `{Finset, Nat}` AND the invalid-shortcut probe
  rejected BOTH `:= by decide` and `:= by simp` (verdicts `lean_rejected, lean_rejected`),
  proving the induction structure is necessary. Honest caveat: that DAG is degenerate (L1 ≈
  the whole target, L2 a trivial restatement) — it exercised the gate machinery + honesty
  spine end-to-end, not a deep decomposition or new math (Gauss sum is elementary). **What
  made it possible = Build-18.1 (`470dfef`)**: surface the actual Lean error text on
  `lean_rejected` leaves in the scaffold packet (was a bare "✗ Lean rejected"). Drove a
  rejected→rejected→verified debug in 3 live turns: kill `Nat.succ_eq_add_one` (no `.succ`
  in goal) → add `Nat.mul_add` (distribute the 2 before applying `hd`) → `simp only [id_eq]`
  (unfold the opaque `id` so `ring` closes). Lesson reaffirmed: prescriptive natural-language
  tactic names work; handing Gemini literal Lean to "transcribe" regresses (adds banned
  `import` → empty namespaces). Earlier 2026-06-14: the `lean_pending` results were a genuine
  Cloud Run cold start (~9.5 min Mathlib import, logs `READY — Mathlib imported in 570.0s`),
  resolved by waiting it out; `min-instances=1` rejected on cost (~$100-150/mo). Offline
  `tests/lemma-dag-verify.ps1` 36/36 (incl. the Build-18.1 error-line mirror).

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
| L4 Verified tools | 🟢 ~85% (M4-manual §0.4 gate PASSED live 2026-06-14) |
| L5 Autonomous loop | 🟢 ~70% ← current (M1 + M3-lite + M2/novelty + M3-full + M3.1 + M4-manual+gate + the **learn→generate loop B110–B116** shipped; the nightly cron now RUNS unattended and STEERS generation — live-verified 2026-06-23: run produced `gen_version=4` + `survivor_steered=true`, 5 over-mined templates down-weighted) |
| L6 Compound | ⚪ the destination |

---

*Canonical as of Session-59 / Build-116 (2026-06-23) — the learn→generate loop (B110–B116)
+ M3.1 survivor clustering are SHIPPED and LIVE-VERIFIED on the nightly cron (gen_version=4,
survivor_steered=true). Track A also gained the live Family Wallet bridge + sci-fi PWA.
Edit deliberately; do not regenerate from scratch.*
