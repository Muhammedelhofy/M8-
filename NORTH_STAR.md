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

### The middle layers (S5 roadmap, 2026-06-12 — the rungs between 3 and 4)
Rung 4 is a scheduler over capabilities that must exist first. Autonomy multiplies
quality; it cannot create it. Each layer ships as a thin slice behind a measurable gate:

- **M1 — Structural probe pack** (Collatz-first): discovery-lane extension producing
  STRUCTURED FEATURES (stopping times, parity vectors, 2-adic valuations, max excursions,
  residue-class census, record-setters) into the graph — *not* bound-pushing, which is
  theater (Collatz is known to ~2^71). Gate: ≥3 feature families queryable from chat.
- **M2 — Literature seed packs** (curated, never crawled): 20–50 hand-curated known
  results per problem as `external`-provenance graph nodes (Terras 1976, Tao 2019,
  Barina bound, cycle constraints…). Enables the novelty gate: "is this already known?"
  answered from the graph before any conjecture is called interesting.
  Gate: 10/10 on planted known/unknown probes. Non-goal: PDF-parsing pipelines.
- **M3 — Conjecture generator v1** (the Hypothesize rung): LLM proposes candidates in a
  constrained schema (computable predicate + explicit bound), a deterministic falsifier
  executes them, survivors land as machine-generated `conjecture` nodes (tested-to-N,
  never "true"), failures land as `failed_attempt` data. Hard cap + graph-dedup = spam guard.
  Gate: surviving non-known conjectures per batch · zero honesty violations under an
  Odysseus probe extension.
- **M4 — Lemma-DAG proof scaffolding**: between `lean_stated` and `lean_verified` —
  decompose a target into a `depends_on` lemma DAG, discharge leaves with allowlisted
  tactics, track % discharged in the graph. Honest ceiling: textbook lemmas, not open
  problems. Gate: one scaffold with ≥3 machine-verified leaf lemmas.

**Then** L5 = a budgeted cron over M1→M3 (+M4 where applicable), gated on 3 consecutive
unattended runs with zero battery regressions. *Explicitly de-scoped: Navier-Stokes /
Millennium-tier targets — PDE numerics do not fit this stack; number theory and
combinatorics adjacency only.*

---

## The Spine *(load-bearing foundation under both tracks)*

The honesty layer is the beam that holds the whole structure. If it ever cracks —
if M8 treats *verified-to-N* as *proof* — the North Star collapses.

- **Deterministic routing** — hard-routes (regex-first) before LLM tool-decision; verified compute
- **Honesty contract** — narration ≤ evidence · EXEC_MARKER required · no upgrade under user pressure
  · **Odysseus battery** (Build-11): 38-probe adversarial immune system, run on every build
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
| L5 Autonomous loop | ⚪ ~20% |
| L6 Compound | ⚪ the destination |

---

*Canonical as of Session-13 / S5 (2026-06-12). Edit deliberately; do not regenerate from scratch.*
