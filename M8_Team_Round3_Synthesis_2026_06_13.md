# Team Round 3 — Synthesis & Adopted Changes
*2026-06-13 · inputs: M8 (self-review), GPT (Q1-only), Manus, Grok, Gemini ·
synthesized by Fable 5, for Muhammad's approval · responds to `M8_Team_Brief_S7_2026_06_13.md` ·
verdicts by argument quality, not vote count*

## Input quality (one line each)
- **Manus** + **Gemini**: full, falsifiable, concrete — the substance of this round.
- **Grok**: substantive on all five (much better than round 2), but carries stale items
  (re-proposed the long-live research_notes migration, treated Build-9/12 Lean work as
  pending, re-raised runtime-Fable for formalization = settled REJECTED).
- **GPT**: Q1 schema only — dense and useful, silent on Q2–Q5.
- **M8**: voted on all five but gave none of the falsifiable specifics the brief demanded.
- Q3 staleness in two replies: Manus's and Gemini's "new" templates (extremal growth /
  peak-ratio bound) are `A_total_log` / `A_peak_power`, shipped in Build-14 — they read
  the brief, not the code.

---

## Q1 — M2 seed pack: **strong 4-way convergence. ADOPTED**

**Schema** (external nodes; union of GPT/Manus/Grok/Gemini, deduped):
- `canonical_statement` — **in M3's own canonical grammar** where expressible (the
  statementFor() vocabulary), plus a faithful prose `statement`. Decisive argument
  (Gemini): a novelty gate on prose embeddings alone **fails open** under paraphrase
  drift ("most numbers shrink" vs "logarithmic density of finite stopping time is 1"
  embed differently) — comparison must be symbolic/structured first, cosine second.
- `result_type` enum (theorem / conjecture / computational_result / counterexample /
  survey_claim) **and** `scope` enum (finite / asymptotic / density / structural) —
  GPT's two-axis split; stops the gate matching a finite bound against a density claim.
- `proof_strength` (proved / conditional / empirical), `tested_bound` (e.g. 2^71),
  `negative_result` flag (unanimous — a pack without impossibility/cycle-constraint
  results can't kill conjectures that contradict them).
- Provenance: `source_citation`, `author`, `year`, `url`; `keywords`;
  `related_features` → M1 family names (Grok — keeps seeds connected to the graph).
- ⚠ **Migration required**: `m8_graph_nodes.source` has a CHECK constraint
  (`'code','extraction'`) — M2 needs `'external'` added. Tiny idempotent ALTER.

**Curation** (consensus list, Grok's scope ruling adopted: **15–20 atomic results this
window**, not 50): Terras 1976 (stopping-time distribution + parity densities) ·
Lagarias surveys '85/'03 (landscape + negatives) · Tao 2019 almost-all (density scope) ·
Barina 2^71 (computational frontier) · Eliahou/Simons cycle constraints (negative
results) · Krasikov–Lagarias density bounds. Gemini's reasoning locks the priority:
**M3's Type B templates will keep re-deriving exactly these statistical baselines — if
Terras/Tao aren't seeded, the novelty gate calls known math a discovery.**

**Silent-failure controls**: atomic results as nodes (surveys allowed only as low-weight
`survey_claim`) · consistent granularity · **Manus's KG Integrity acceptance step
ADOPTED: every seed verified against its cited source at curation time** (the periodic
automated integrity probe + Lean contradiction checks = July/M3-full era).

## Q2 — Gate: **conflict resolved AGAINST the multi-seed votes. ADOPTED: Wilson-difference gate**

Positions: multi-seed k=5 (Grok, M8) vs single larger cohort with confidence intervals
(Manus n=120–150 Wilson; Gemini Wilson on the **difference**, ratio demoted to metric).

**Ruling — Manus/Gemini win on argument quality:** the gate's job is an honest
statistical claim; multi-seed median-of-ratios adds complexity without fixing the
underlying small-sample problem, and candidates/falsification are cheap array scans, so
the bigger cohort costs ~nothing inside the 60s budget (Gemini's serverless caution
noted — n stays ~120, not 1,000).
- **New decision rule**: cohort **n=120 per side**; gate passes iff the **95% lower
  bound of (p_mined − p_baseline) > 0** (Wilson/Newcombe). High seed variance now fails
  the gate *honestly* (lower bound dips below zero) instead of flickering around 2.0×.
- Raw ratio **demoted to a tracked metric** in the packet; per-seed ratios stay as
  diagnostics; seeds remain user-controllable for reproducibility.
- [REJECT] multi-seed as the gate (Manus's complexity argument) · [REJECT] gate
  removal (unanimous — it guards spam).

## Q3 — Templates: **ADOPTED one cross-feature conditional template for v1.1**

Convergent blind spot (M8 "if F then G", Grok's concrete shape, Manus's cross-feature
correlation): **no template relates two M1 features conditionally.** v1.1 adds ONE:
conditional cross-feature claims of the shape *"for all n ≤ N with ν₂(3n+1) ≥ k:
peak(n)/n ≤ c"* (Type A) / *"among n ≤ N with peak/n ≥ t, the frequency of ν₂ = 1 is
≥ p"* (Type B) — same mined/baseline machinery, same vacuity floor, falsifier is the
existing feature-table scan with a condition.
- [REJECT] asymptotic/unbounded-limit shapes (Manus + Gemini, unanimous reasoning:
  not falsifiable by bounded computation — already excluded by construction, stays so).
- [REJECT] recurrence/self-similarity shapes for v1.1 (Grok: falsifier cost explodes).
- Discarded as stale: Manus's extremal-growth and Gemini's peak-ratio "new" templates
  (= shipped `A_total_log` / `A_peak_power`).

## Q4 — Triviality: **unanimous. ADOPTED: micro-prover pre-falsifier, whack-a-mole retired**

Merged design (vanilla JS in conjecture-gen — no sympy/Python, Manus's tooling
suggestion doesn't fit the stack):
1. **Zero-variance identity check** (Gemini — the sharpest version): evaluate the
   candidate's claimed quantity over its constrained domain on a small slice; if the
   feature is CONSTANT (zero variance independent of sequence dynamics), it's a
   structural identity, not a sequence property → dropped pre-falsifier. This
   *generalizes* the hand-coded σ-class exclusions (σ=3 on n≡1 mod 4 dies here
   automatically) and ends the arms race.
2. **Covering-set residue decidability** (Grok/Manus/M8 convergence): if the claim is
   decided by evaluating one residue computation over a covering set, flag trivial.
   ×2-invariance check folded in where applicable.
- Applied to BOTH cohorts pre-falsification (same honesty rule as the vacuity floor).
- Hand exclusions stay as belt-and-suspenders but stop growing.

## Q5 — Stateful alerting (SPEC in S8, build [JULY]): **merged design**

- **State machine** (union): `raised → acknowledged → in_progress → resolved →
  re_raised`, plus `snoozed/suppressed` (suppression_until). Resolution is
  **data-verified** (Gemini) and requires **2 consecutive clear checks** (Grok).
  State lives in a `fleet_alerts` Supabase table + driver-entity graph nodes
  (round-2 statefulness requirement intact).
- **Hysteresis**: asymmetric raise/resolve thresholds (Gemini's anti-flapping: raise
  <60%, resolve >65% × 2 days) + per-condition cooldowns + worsening-delta re-raise
  (Manus). Exact constants per-condition in the spec.
- **Fatigue**: fleet-level aggregation with drill-down (Manus) · hard cap on pushed
  unacked alerts per brief (Gemini: 2) · tiered escalation badge→brief→push ·
  priority order cash > tier/utilization > acceptance.
- **First condition — CONFLICT, ruled: CASH-GAP first** (Grok). Reasons: highest
  stakes (money at risk), the deterministic spine already computes it (cash-collection
  tracking is LIVE), and resolution semantics are the cleanest state-machine test
  (gap paid → data-verified resolve). Tier-slip trajectory (Gemini — genuinely good,
  predictive) is condition #2; acceptance-rate (M8/Manus) folds into churn signals.
  Muhammad can overrule in the spec review.

## Unsolicited risks — both adopted
1. **KG Integrity Probe** (Manus): adopted as the M2 curation acceptance step now
   (verify each seed vs its cited source before insert) + a periodic spot-check probe
   in July. Lean-based contradiction checking deferred to M3-full era.
2. **Graph edge explosion / token starvation** (Gemini): partially live already —
   `renderGraphPacket` caps edge lines at 12 and skips thread-anchor edges (not in the
   brief, so Gemini couldn't know). Residual risk is real as M2/M3 multiply edges:
   **adopted** — when a node's edge set exceeds the cap, summarize as counts
   ("supports: 1 shown, +11 more") instead of silently truncating. Small render change,
   S8-cheap or post-window.

## Discarded / corrected (round hygiene)
- Grok: research_notes migration (live since 2026-06-10) · Build-9/12 Lean framed as
  pending (shipped, corpus 37/37, bench 0.65) · Fable-for-formalization (settled
  REJECTED — Fable is dev-time only).
- M8 self-review slides 1–4: echo of the brief's own STATE SYNC (zero new content).
- Manus + Gemini Q3 template proposals: already shipped (see Q3).
- Manus's duplicate re-paste: identical text, logged once.

## Locked S8 scope (execution order)
1. **Gate v2** — cohort 120 + Wilson-difference rule, ratio→metric (conjecture-gen.js).
2. **Micro-prover pre-falsifier** — zero-variance + covering-set checks, both cohorts;
   re-baseline gate stats after (survival rates will shift).
3. **M2 seed pack v1** — `source='external'` migration, adopted schema, **15–20
   verified Collatz seeds** (curation acceptance step), novelty gate v1
   (canonical-form comparison first, embedding similarity second), survivors checked
   against seeds → "matches known result X" narration.
4. **Odysseus-2**: arm probe 2 full form (real external node vs near-dup survivor) +
   the NORTH_STAR 10/10 planted known/unknown novelty probes.
5. **Stateful alerting SPEC** (doc, July build) — merged state machine above.
6. *Stretch*: cross-feature conditional template v1.1 + edge-count summarization.
