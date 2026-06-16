# M8 — COMPLETE INVENTORY (the anti-loss checklist for the new diagram)

**Why this file exists:** when we rebuild the M8 diagram as a "mind/brain", NOTHING from M8 should get
lost in the move (the old diagram was missing the "unforbidden-knowledge" axis until Muhammad caught it —
this list makes that impossible). The new diagram must represent EVERY item below, or consciously decide
to omit it. **Authority for live/pending status = `lib/buildState.js` `live[]` (newest-first) +
`HONESTY_TRACK_PLAN.md` + `NORTH_STAR.md`.** Cross-check against those; this file is the map, those are
the ground truth. Written Session-38 (2026-06-16). Status legend: ✅ live · 🟡 built/pending-live · 🔜 backlog.

---

## 0. WHAT M8 IS (the frame)
A dual-purpose system with TWO North Stars (locked, `NORTH_STAR.md`):
- **Track A — Personal AI OS** (operator assistant for Muhammad's logistics / Bolt-fleet business).
- **Track B — Unsolved-Problem Engine** (makes honest progress on hard/open math + "unforbidden-knowledge").
Maturity ladder **L1 → L6** (NORTH_STAR). Doctrine: **code computes truth, the LLM only narrates.**

## 1. TRACK A — Personal AI OS (operator assistant) — pillars
- ✅ **Fleet spine** (`lib/fleet.js`): decodes the dashboard's compressed Supabase blob; mission-control,
  rollups, driver series, tier-watch, cash-collection, morning brief, **earnings charts** (Build-31).
- ✅ **Stateful fleet alerting**: cash-gap (Build-20), tier-slip/tier-watch (Build-21), churn-risk (Build-22).
- ✅ **Verified P&L / finance model** (effective-dated overrides, auto-salary), **deck generator**,
  **KSA legal playbook**, **EOSB calculator**, **multi-company registry** (breadth track, all live).
- ✅ **Chat I/O**: text/CSV attachments (Build-33), **image/vision** (Build-34) + silent-vision-miss guard
  (Build-37), copy-to-clipboard (Build-32), **voice** push-to-talk, command center.
- ✅ **Memory** (Track-A + Track-B shared): conversation memory + provenance (Build-30), research graph.

## 2. TRACK B — Unsolved-Problem Engine — the maturity ladder (all shipped)
- ✅ **M1** structural probe census (`lib/collatz-probes.js`).
- ✅ **M2** literature seed pack + novelty gate (`lib/seed-pack.js`, 19 web-verified seeds).
- ✅ **M3 / M3-lite / M3-full** conjecture generator + deterministic falsifier (`lib/conjecture-gen.js`).
- ✅ **M3.1** survivor review queue (`lib/review-queue.js`).
- ✅ **M4-manual** human-architected lemma-DAG + **Lean** machine-check of leaves (`lib/lemma-dag.js`,
  `lib/lean.js`; §0.4 gate passed live).
- ✅ **L5** autonomous nightly loop (`lib/loop.js`; promotion gate = 3 clean nights; best-of-N Build-36).

## 3. EPISTEMIC AXIS / HONESTY BACKBONE (Builds 38–42) — incl. "unforbidden knowledge" ⚠ DON'T LOSE
- ✅ **Build-38** universal node provenance (evidence_kind · confidence · verification_state on every node).
- ✅ **Build-39** read-path trust tiers (VERIFIED/EMPIRICAL/HEURISTIC/UNVERIFIED/REFUTED).
- ✅ **Build-41** neutral `speculative` bucket + schema edge-ban + Odysseus generator-purity probe.
- ✅ **Build-42** **kernel/leap decomposition** + co-retrieval invariant (split a fringe idea into its
  established KERNEL vs speculative LEAP, human-gated, recalled together).
- ⚠ **"UNFORBIDDEN KNOWLEDGE" axis** — the framing for vortex math / number patterns / geometria / fringe
  ideas: classified honestly, kernel made to DO WORK, never laundered. **This is the item the old diagram
  lost — it MUST appear in the new one (ideally as the gauge "how far toward working on these honestly").**

## 4. PROBLEM-SOLVING ENGINE ROADMAP (Build-43) — ✅ D→B→A→C COMPLETE + LIVE
- ✅ **D** fringe idea → testable claim (`lib/kernel-conjecture.js`).
- ✅ **B** test the user's literal claim first (counterexample) + nearest-true.
- ✅ **A** "M8 plans the attack" — anti-degeneracy-gated lemma-DAG proposer (`lib/decomp-proposer.js`).
- ✅ **C** 2nd problem domain = reverse-and-add / Lychrel "196" (`lib/lychrel-probes.js`) — proves it
  generalizes.
- 📌 **LOCKED: depth over breadth** — STOP adding domains; future engine work = DEPTH (smarter), not wider.

## 5. ADVERSARIAL / QA
- ✅ **Odysseus battery** (`tests/odysseus/`): the permanent red-team probe set (honesty/confabulation).
- ✅ **Odysseus AI** = the EXPERIMENTAL WING (sandbox/research; never the deterministic brain).

## 6. HONESTY INVARIANTS (load-bearing law — show as the spine)
- `lean_verified` is the ONLY path to `proven`; a counterexample the ONLY path to `refuted`;
  ingestion/extraction reach NEITHER. Survivors = "tested to N, still open", never proven.
- Narration ≤ evidence. Code computes the verdict; the LLM narrates. Grounding or honest hedge, never confab.

## 7. INFRASTRUCTURE (hard-to-rederive)
- ✅ LIVE app `m8-alpha.vercel.app`; GitHub `Muhammedelhofy/M8-`; Vercel auto-deploys from `main`.
- ✅ Supabase `ltqpoupferwituusxwal` (all `m8_*` tables + the fleet tables).
- ✅ Lean checker = Cloud Run `m8-lean-check` (cold start ~9.5 min; warm before use).
- ✅ `/api/health` reports `deploy.sha` (deploy-confirm tool). `CRON_SECRET` set (Vercel + Windows User).
- ✅ Nightly **L5 attest** Windows task (05:00 AST). Migrations = manual paste into Supabase SQL editor.

## 8. PENDING / BACKLOG (so "pending" is visible on the diagram)
- 🔜 **Engine DEPTH** (the agreed next direction): smarter conjectures, deeper decompositions, discharge
  more Lean leaves (raise M4 beyond degenerate DAGs).
- 🔜 #11 open-conjecture literature seed reads `empirical` (classification refinement).
- 🔜 Round-5 honesty follow-ups: per-attempt best-of-N telemetry · selector-stress probes ·
  `scaffold_not_proof` turn-1 absent · verify `GRAPH_EVIDENCE_CAP` · uncertainty-calibration probes ·
  source-trust over-read probe.
- 🔜 L5 promotion gate: switch the nightly task to S4U (runs logged-off) — needs an elevated shell.
- 🟡 **This diagram redesign** (mind/brain + Tasks/Projects/Evolution) — IN FLIGHT (see `MIND_DIAGRAM_BRIEF.md`).

## 9. PERSONA / OPERATING RULES (context, not a diagram node)
Address Muhammad as **"Boss"** (non-engineer → click-by-click steps). **"SAVE IT"** = update memory + show
architecture + show scorecard + give next-session kickoff + Odysseus status. Free Gemini/Tavily stack;
premium off by default; live runs cost quota + need his OK.

---

### Checklist for the new diagram (tick each)
Track A pillars · Track B ladder (M1–L5) · Epistemic axis (38–42) · **unforbidden-knowledge gauge** ·
Engine roadmap D→B→A→C (done) · depth-over-breadth (next) · Odysseus (battery + AI wing) · honesty spine ·
infra (Vercel/Supabase/Lean/health) · memory-that-evolves · pending/backlog · Tasks/Projects/Evolution.
**If any of these is not represented, it was lost — go back.**
