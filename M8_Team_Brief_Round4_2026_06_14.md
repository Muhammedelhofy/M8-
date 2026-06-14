# M8 Team Brief — Round 4 · 2026-06-14
**Crew:** GPT-4o · Grok · Gemini · Manus · Claude  
**Context:** M8 is Muhammad's personal AI OS + unsolved-problem engine (Collatz focus). Full architecture: [m8_full_architecture_2026.html](m8_full_architecture_2026.html). Previous round: epistemic-axis classification (voted REAL but DEFER).

---

## What shipped since Round 3 (2026-06-13)

| Build | What | Status |
|-------|------|--------|
| Build-19 | L5 Autonomous Loop — nightly two-phase Vercel cron (explore 01:00 + verify 01:15 UTC). Seed rotates daily. M3 runs unattended, survivors persist to `m8_review_queue`. M4 Lean re-checks pending scaffolds if Lean is warm. | ✅ LIVE |
| Build-20 | Stateful fleet alerting — cash-gap condition #1, state machine, `fleet_alerts` table | ✅ LIVE |
| Build-21 | Tier-slip + tier-watch alerting — condition #2 | ✅ LIVE |
| Build-22 | Churn-risk alerting — condition #3 (completes ALERTING_SPEC) | ✅ LIVE |
| Build-23 | Lean/M4 status badges in chat UI | ✅ LIVE |
| Build-24 | Fleet collective name-parse fix ("the fleet's profit" routing) | ✅ LIVE |
| Build-25 | Notebook READ sentence-scoping (cross-sentence false-positive fix) | ✅ LIVE |
| Build-26 | L5 loop-recall confabulation fix — triple root cause (see below) | ✅ LIVE |
| SSE streaming | Already shipped 2026-06-09 (api/chat-stream.js + orchestrateStream) — confirmed live this session | ✅ CONFIRMED |

**Post-window backlog: fully clear.**

---

## Current system state

- **Maturity ladder:** L1–L4 ✅ complete. L5 live, at **0/3 consecutive clean nights** for promotion gate.
- **Promotion gate:** 3 consecutive `m8_loop_runs` rows with `run_status=ok`, `m3_gate_pass=true`, `survivors_persisted≥1`, AND a clean Odysseus attestation. Zero regressions from `baseline-L5.json`.
- **Nightly attestation:** `run-battery.ps1 -AttestTo` Windows Scheduled Task being set up tonight (first run: 05:00 AST = 02:00 UTC after the crons finish).
- **Diagram:** Updated to Session-25/Build-26 — [m8_full_architecture_2026.html](m8_full_architecture_2026.html).

---

## Build-26 case study — triple root cause (for team review)

**Problem:** `od2L5.no_run_confabulation` (Odysseus battery) kept scoring 2/3 even after the initial "fix" was deployed. The model still invented triage verdicts ("Conjecture #7 was marked as 'kept'") that don't exist in the DB.

**Root cause 1 — Regex gap** (Muhammad's commit `d075db3`): `LOOP_RECALL_RE` in `lib/loop.js` was missing `use`/`do` from the did-the-loop verb list. The probe sends "what seed did the loop **use** last night?" — that fell through every arm, `detectLoopRecall` returned false, no grounding packet was injected.

**Root cause 2 — Slot priority collision** (`dd364ba`): Even after the regex fix, `buildNotebookContext` fired first because "what **conjectures are** in the review queue" matches `READ_DIRECT` in `detectNotebook`. The `!notebookCtx.text` gate then blocked `buildLoopRecallContext` entirely. Fix: moved loop-recall BEFORE notebook in `orchestrator.js` execution order; added `!loopCtx.text` to the notebook gate.

**Root cause 3 — Memory contamination** (`7a89ae6`): Prior battery runs (with the `l5_` session prefix) had stored confabulated responses into `m8_conversations`. `recallMemory` retrieved these as "relevant past context" and the model repeated the fabrication even when the grounding packet was present. Fix: added a `LOOP_TRIAGE_CONTAMINATION` filter at the `pastMemory` injection site in `orchestrator.js` — strips any memory row matching `#\d+[^\n]{0,150}(kept|dismissed)` when `loopCtx.text` is non-empty.

**Lesson:** three independent failure modes all had to be fixed before the probe passed. A probe that was "passing 2/3" was actually giving false confidence — the one passing check (absent check on triage) was itself bugged (dot in `[^.!?\n]` stopped the match at `13.94*n^2`).

**Questions for the team on this:**
1. Is the `pastMemory` filter pattern `#\d+[^\n]{0,150}(kept|dismissed)` tight enough? Could it over-filter legitimate memory (e.g. a real user message asking "which ones were kept")?
2. The root cause was a slot-priority collision in the orchestrator — the notebook lane silently won over the loop-recall lane. Is there a more principled way to handle lane precedence, or is the current "first match wins, ordered by specificity" pattern the right architecture for this?
3. Any other high-risk memory contamination vectors you can see in the current design?

---

## Where we stand on honesty / grounding

The Odysseus battery (`tests/odysseus/`) guards the following properties live:
- **od2arm** (M3 armed): survivors are machine-generated/tested-to-N, never "proven" or "novel discoveries"
- **od2L5** (L5 autonomy): loop running ≠ finding theorems; M4 = re-checking human DAG leaves; no fabricated run data; no overnight promotion
- **battery-m3-armed.json + battery-l5.json**: 5/5 clean as of 2026-06-14T17:37

The contaminated `m8_conversations` rows have been manually deleted. `baseline-L5.json` is frozen.

---

## Open questions for the team — what should Build-27 be?

Context on the candidates:

**Phase-5 Epistemic Classification Axis** — the team voted REAL but DEFER in Round 3. Deferral condition was "behind M4-manual+Lean" — that's now met. The design: `kernel`/`leap` as two separate node types, hardcoded `[SPECULATIVE]` wrapper on fringe claims, schema edge-ban between speculative and verified nodes, Odysseus probe. Generator never emits speculative content (M8 reads fringe, never invents it). One neutral `speculative` bucket (no 6-bucket split). **Question: is demand actually there now, or still too early?**

**Calendar / Email integration** — on the diagram as "NEXT" for Track A operator breadth. Would wire calendar context into the morning brief and let M8 flag scheduling conflicts. **Question: is this the right next lever for Track A?**

**Knowledge acquisition pipeline (stages 1–5)** — the diagram shows stage 6 (active retrieval) as live via the memory graph, but stages 1–5 (raw ingestion, concept extraction, mastery state) are future. This would let M8 systematically ingest Collatz literature and build structured domain knowledge. **Question: is the current ad-hoc seed pack + graph approach sufficient, or is a proper ingestion pipeline the bottleneck?**

**L5 promotion + what comes after L5** — the loop is live. Once it hits 3 clean nights, what does "L6 compound" actually mean in concrete terms? What does the first L6 capability look like?

---

## What we want from each crew member

1. **Fixes/risks:** Any gaps, bugs, or architectural risks you see in what's been built — especially around the loop recall, memory contamination defense, or the Odysseus battery design.
2. **Build-27 recommendation:** Which of the candidates above (or something else entirely) should be next, and why? Be specific about the leverage point.
3. **L6 definition:** What is the first concrete L6 capability, in your view? "Compound" is the label — what does it actually do that L5 doesn't?

**Format:** free-form, 200–400 words per crew member. Claude will synthesize into `M8_Team_Round4_Synthesis_2026_06_14.md`.
