# M8 Team Brief — Epistemic Classification Axis ("Unforbidden Knowledge")

*2026-06-13 · round topic proposed by Muhammad · for GPT / Grok / Gemini / Manus.
Please answer the OPEN QUESTIONS at the end. We are NOT asking you to validate or
refute any specific fringe theory — only to pressure-test the classification
FRAMEWORK and its honesty guarantees.*

## Context (read first)

M8 is an **honesty-first** research assistant. North Star: help Muhammad resolve
**unsolved math/logic problems** (prize-class), under an iron rule — **never claim
an unverified proof; a fabricated result is the worst possible failure.** The
research graph (Supabase: typed nodes/edges + embeddings) already labels every
fact by **provenance** (`source`: code | extraction | external-literature) and
**status** (lean_verified theorem | machine-generated tested_to_N | neutral
evidence). Recall packets always carry these labels so M8 cannot launder a
conjecture into a proven fact. The latest rung, M3.1 (a survivor review queue with
triage), just shipped.

## The proposal

Add a NEW, **orthogonal** axis to graph nodes: the **epistemic standing of an
idea** — so M8 can engage speculative / fringe ideas (Vortex Math, Sacred
Geometry, Gematria, Tesla 3-6-9, Cymatics, Electric Universe, Geometric Unity,
Wolfram Physics, Simulation Theory, prime-number mysticism, ...) **without
confusing them with established knowledge.** This extends M8's existing honesty
discipline from "where did this come from" to "how well-supported is this idea."

Muhammad's starting taxonomy:
`established · conjecture · empirical · speculative_framework · refuted`

## Claude's refinement (the position to critique)

1. **Don't collapse rigor.** `speculative_framework` lumps **Wolfram Physics**
   (falsifiable in principle, serious researchers, real math) with **Vortex Math**
   (mod-9 arithmetic dressed as cosmology, no mechanism, unfalsifiable). Proposed
   6-bucket split:
   `established | conjecture | empirical | speculative_framework (serious,
   falsifiable, unaccepted) | fringe_pattern (pattern with no mechanism,
   unfalsifiable, not researched by the field) | refuted`
2. **The real power is DECOMPOSITION, not the label.** Split each idea into its
   **true kernel** vs its **speculative leap**, and label each. Example — Vortex
   Math: kernel = "the 1-2-4-8-7-5 digit cycle is real, well-understood mod-9
   arithmetic (established)"; leap = "it is the energy-geometry of reality (fringe,
   no accepted theory)." M8 then neither dismisses nor swallows the idea.
3. **Hard honesty invariant.** A `speculative_framework`/`fringe_pattern` node may
   NEVER appear in a recall packet without its classification + a one-line
   reality-check — the same mechanism as today's MACHINE-GENERATED / LITERATURE
   labels. This is adversarially testable ("did M8 ever present Vortex Math as
   established / as physics?").

## Test cases (how the axis should classify them)

| Idea | Classification |
|---|---|
| Pythagorean theorem | established |
| Collatz | conjecture |
| Barina 2^71 verification | empirical |
| Wolfram Physics / Geometric Unity | speculative_framework |
| Vortex Math / Tesla 3-6-9 / Gematria / prime-mysticism | fringe_pattern |
| Perpetual motion | refuted |

## OPEN QUESTIONS (please answer these)

1. **Axis shape.** One categorical axis, or TWO orthogonal axes (epistemic status
   × rigor/community-acceptance)? Is the 6-bucket split sound, or is there a
   cleaner cut? Where do philosophy-not-science cases (Simulation Theory) and
   "real physics, overreaching claims" cases (Cymatics, Electric Universe) land?
2. **Decomposition primitive.** Is "true kernel vs speculative leap" the right
   unit? How should it live in the graph — two linked nodes (kernel —spawns→ leap),
   or one node with a structured `kernel`/`leap` field? How is the kernel's own
   classification kept honest (the kernel is often genuinely `established`)?
3. **Anti-laundering.** What is the STRONGEST guard against M8 lending credibility
   to a fringe idea simply by giving it a tidy slot next to real math — beyond the
   mandatory label + reality-check?
4. **Sequencing vs the math North Star.** M4-manual (human-architected Lean
   lemma-DAGs; M8 formalizes the leaves) is the other candidate next rung. Is this
   epistemic axis honesty-infrastructure worth doing FIRST, in parallel, or after?
   Is it a distraction from the prize-problem mission, or a prerequisite for it?
5. **Naming.** How to name the fringe bucket so it is honest without being either
   pejorative ("pseudoscience") or credulous?
6. **Scope discipline.** Amateurs generate thousands of fake "proofs" / "prime
   codes" yearly. How does this axis keep M8 a skeptical explorer rather than a
   generator of pseudo-discoveries?

## Constraints (non-negotiable)

- **Honesty-first.** The axis must REDUCE laundering, not enable it.
- **Graph-native + deterministic-first.** A node property composing with existing
  `source`/`status`; the LLM narrates labels, it never invents standing.
- **No numeric confidence scores.** Build-16 cut per-survivor "surprise" scores as
  the single highest truth-laundering surface — categorical labels only.

## Reply format

Per question: your position + the strongest objection to Claude's refinement +
(if relevant) what you'd change. Terse and concrete beats long. Muhammad will
relay your answers back for synthesis into a build spec.
