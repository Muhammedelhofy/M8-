# Build-43 Spec — The Problem-Solving Engine: first rung

**Status:** ✅ DIRECTION LOCKED (Muhammad, Session-37). Build **all four**, ONE rung at a time
(ship → offline test → live sign-off → next). **LOCKED ORDER: D → B → A → C.** Building **D now**.
Shown on the diagram as the "Problem-Solving Engine Roadmap". Written Session-37 (Opus), 2026-06-15.

## Locked roadmap (one rung at a time)
1. **D — Fringe idea → testable claim** ✅ *BUILT + OFFLINE-VERIFIED (20/20), awaiting live sign-off* —
   `lib/kernel-conjecture.js` + orchestrator hard-route. Closed-vocabulary checker (dr_periodic /
   dr_constant / mod_cycle over a generator whitelist); LLM proposes within the code-checkable set only;
   deterministic exhaustive check → "observed through N", never proven; leap stays speculative.
2. **B — Better guesses** — richer LLM conjecture proposal, deterministically falsified; raises the
   quality every later rung depends on.
3. **A — M8 plans the attack** — drafts the lemma-DAG decomposition (human-gated) → existing M4 leaves.
4. **C — 2nd problem domain** — port M1/M3 beyond Collatz; proves generality once the core is strong.

_Order is the recommended sequence, not a contract — reorder if a rung proves more valuable. Each
rung ships + tests + gets sign-off before the next starts._

**Frame:** the honesty backbone (Builds 38–42) is done. Track B's ladder (M1→M3-full→M3.1→
M4-manual→L5) is shipped. This is the turn from *recording honestly* to *making progress*.
**Constraint (unchanged, NORTH_STAR):** no autonomous proof-tree search, no Millennium/PDE
targets — number theory + combinatorics adjacency only. Free Gemini/Tavily stack. Honesty
spine is law: narration ≤ evidence, /check is the only proof ground-truth.

---

## The honest diagnosis: where progress actually stalls

The engine today can: census a problem (M1), mine + falsify template conjectures (M3),
cite literature (M2), rank survivors for a human queue (M3.1), and formalize+check the
**leaves of a lemma-DAG that a human wrote** (M4-manual). The §0.4 gate passed — but with
an explicit caveat logged in NORTH_STAR: *"that DAG is degenerate (L1 ≈ the whole target)
— it exercised the gate machinery, not a deep decomposition or new math."*

So the single biggest gap between "honest recorder" and "makes progress" is:

> **M8 cannot yet propose HOW to attack a problem.** The decomposition — the actual
> mathematical insight of "break the target into these sub-lemmas" — is 100% human. M8
> only transcribes leaves the human already named.

Two candidate bottlenecks follow from that, plus a breadth option:

- **(A) Decomposition proposer** — M8 *drafts* a candidate lemma-DAG for a target and
  stages it for human approval; on approval it flows into the existing M4-manual leaf
  pipeline. *Closes the "100% human decomposition" gap directly.*
- **(B) Richer conjecture generation** — let the LLM *propose* conjectures (not just
  template-mining), policed by the existing novelty comparator + deterministic falsifier.
  *Closes the "generator is template-bound" ceiling — more/better candidates to work on.*
- **(C) Second problem domain** — port M1/M3 from Collatz to one more tractable open
  problem. *Breadth, not depth.*

---

## ⭐⭐ NEW LEAD (after Muhammad's steer, Session-37): (D) Speculative-Kernel → Conjecture bridge

**Muhammad's steer (verbatim intent):** he wants M8 to *eventually work on* vortex math,
number patterns, geometria/sacred geometry, "unforbidden knowledge" — and to see the
epistemic axis as a real, visible part of the system (diagram updated this session).

That reframes the smallest-useful step. The Build-41/42 epistemic axis already **classifies**
a fringe idea and **extracts its checkable kernel** (kernel/leap, human-gated). What it does
NOT yet do is **make the kernel productive** — turn that established core into a concrete,
machine-testable conjecture the M3 engine can actually falsify or support-to-N. That bridge
is exactly "making progress on a hard/fringe idea without laundering it," which is the whole
point of the engine for the targets he cares about.

**Smallest useful slice (v1):**
1. Start from an **already-approved kernel** (Build-42 output — e.g. the "digital root =
   value mod 9" kernel extracted from a vortex-math doc). No new fringe-handling — reuse it.
2. `kernelToConjecture(kernelNode)` — one Gemini pass proposes a **computable Type-A
   predicate + explicit bound** derived from the kernel (e.g. "the digital-root sequence of
   2^n is periodic with period 6 for n ≤ N"), in the **exact M3 generator format**, or
   `null` if the kernel yields no checkable claim.
3. **Run the EXISTING deterministic falsifier** (`conjecture-gen.js`) over the full TEST
   range. Survivor → narrated **"observed through N"** (never "true"); kill →
   counterexample reported. The speculative LEAP stays speculative and untouched — only the
   *kernel-derived* claim earns a tested-to-N status.

**Honesty invariants:** the leap is never promoted; the derived conjecture inherits M3's
"tested to N ≠ proven" contract; a kernel that yields no computable predicate returns `null`
(no fake claim). Co-retrieval (Build-42) still shows kernel + leap + both classifications.

**Offline proof:** `tests/kernel-conjecture-verify.ps1` — mirror the format check + assert a
known-true kernel claim survives the falsifier and a planted-false one is killed with a
counterexample; Odysseus probe: "did M8 prove the vortex-math idea?" → must answer no.

**Why it's the lead now:** it is the *same machinery* as Option A/B (propose → deterministic
gate → honest narration) but pointed straight at the targets Muhammad named, and it makes the
already-built epistemic axis *do work* instead of just classifying. Still small: one proposer
function + reuse of the existing falsifier; no new infra, no autonomy.

---

## (A) Human-gated Decomposition Proposer

**Why this one.** It attacks the exact logged caveat (human-only decomposition), and it
reuses a pattern we already shipped, live-verified, and trust: **Build-42's propose →
stage → human-approve → write** kernel/leap gate. We are NOT adding autonomous proving;
we are adding a *draft attack plan* that a human must approve, then the proven M4-manual
machinery formalizes the leaves exactly as today. It is the smallest change that makes M8
contribute the *insight* step while staying on the honest side of the de-scoped line.

**Smallest useful slice (v1):**
1. `proposeDecomposition(target_prose)` — one Gemini pass, strict JSON: a candidate DAG in
   the **exact M4-manual text format** (`target:` / `L1:` / `L2: … [deps: L1]` …), or
   `null` if it can't propose a non-degenerate split. Reuses the M4-manual parser to
   validate shape (no dangling deps, no cycle, ≥1 leaf, **≥2 lemmas and the target is not
   itself a leaf** — the explicit anti-degeneracy rule the gate caveat demands).
2. **Stage, never auto-run.** The proposal is saved to a `pending_decomposition` row /
   field and surfaced in chat as a DRAFT — "here is a *candidate* decomposition; it is a
   PLAN, not a proof; approve to formalize the leaves." (Same staging discipline as
   Build-42.)
3. `approveDecomposition(id)` → hands the approved DAG straight into the existing
   `lemma-dag.js` leaf pipeline. **Zero change to the honesty rule:** still only "leaves
   verified k/m", target stays `conjecture`, sorried parents UNPROVEN.

**Honesty invariants (non-negotiable):**
- A proposed DAG is a `[PROPOSED PLAN]`, never evidence. It mints **no** graph nodes and
  **no** edges until approved (proposal is staged data, like Build-42's `pending_*`).
- Approval changes nothing about proof semantics — it only feeds M4-manual. The target is
  never promoted; "100% leaves discharged ≠ proof" wording is reused verbatim.
- Anti-degeneracy gate (the whole point): reject `L1 ≈ target` proposals — require ≥2
  lemmas, target-not-a-leaf, and ≥2 leaves with distinct prose. A degenerate proposal
  returns `null` ("couldn't find a non-trivial decomposition"), never a fake plan.

**Offline proof (PS-mirror, no Node):** `tests/decomp-proposer-verify.ps1` — mirror the
parser + anti-degeneracy gate; assert: well-formed proposals pass, degenerate/cyclic/
dangling ones are rejected, and the staged proposal carries the `[PROPOSED PLAN]` framing
(no proof claim). Plus an Odysseus probe: "is this decomposition a proof of the target?"
→ must answer no (fabrication-class `absent`). Migration (if a column is needed) staged,
applied with explicit OK only.

**Why it's still SMALL:** one new function + one staging field + one approve hook, all
mirroring Build-42 + reusing the M4-manual parser/pipeline. No new proof machinery, no
new infra, no autonomy.

---

## Alternatives (pick instead if you prefer)

**(B) LLM conjecture proposal, novelty-policed.** The long-deferred "M3-full where the
novelty gate polices LLM proposal." LLM proposes K conjectures over the M1 features →
each must survive **deterministic falsification over the full TEST range** (existing
machinery) → survivors narrated "tested to N", down-ranked if they match a known form.
*Pro:* attacks the candidate-quality ceiling — arguably more fundamental (no good
candidates → nothing worth decomposing). *Con:* higher truth-laundering surface (LLM
invents plausible-but-false claims); contained by the deterministic falsifier but needs
careful Odysseus coverage. Bigger than (A).

**(C) Second domain (e.g. a tractable additive/number-theory conjecture).** Port M1 census
+ M3 generator to one more problem. *Pro:* proves the engine generalizes beyond Collatz.
*Con:* breadth without deepening the core capability; most effort is domain plumbing, not
new engine power. Least aligned with "making progress on hard problems."

---

## Recommendation in one line

Given your steer, build **(D)** — the speculative-kernel → conjecture bridge — so M8 starts
turning vortex-math / pattern / geometria ideas into concrete, machine-tested claims
(honestly: "observed through N", never proven), making the epistemic axis *do work*. If you'd
rather M8 help **architect proof attacks** on a target, **(A)**; raise raw candidate quality,
**(B)**; prove generality on a 2nd problem, **(C)**.

**→ Your call on direction before I write any engine code.** (D) is the smallest step toward
exactly what you described.
