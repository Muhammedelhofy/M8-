# M8 Team Round 4 — Synthesis
**Date:** 2026-06-14  
**Crew:** M8 · GPT-4o · Grok · Gemini · Manus  
**Brief:** [M8_Team_Brief_Round4_2026_06_14.md](M8_Team_Brief_Round4_2026_06_14.md)

---

## Question 1 — Build-26 fixes / risks

### Immediate actionable fix (do this now, not a full build)

**Gemini caught a real bug in the current filter.** The `LOOP_TRIAGE_CONTAMINATION` regex in `orchestrator.js` is applied to all `pastMemory` rows. If a user message says "which conjectures were kept last week?" that user turn will be stripped. That is wrong — user input should never be filtered.

**Fix:** Scope the filter to `role: 'model'` and `role: 'summary'` rows only. User turns are untouched.

This is a one-line change to the filter predicate in `orchestrator.js` and should be done before the next battery run.

### Long-term consensus: provenance-based memory isolation

All five crew members independently landed on the same architectural verdict: **the contamination filter is a hotfix, and content-based filtering ages poorly.** The permanent solution is provenance metadata on every memory row.

| Crew | Proposed implementation |
|------|------------------------|
| GPT-4o | Tag every row: `user` / `tool` / `notebook` / `eval_probe` / `synthetic`. Loop recall ignores `eval_probe` + `synthetic` by construction. |
| Grok | `probe_artifact` boolean flag. Source hierarchy enforced globally: `DB state > Notebook facts > Conversation memory > Model inference`. |
| Gemini | `memory_type` + `source_type` + `trust_level` columns. Filter by `WHERE trust_level >= notebook` at recall time. |
| Manus | `type: 'system_confabulation'` metadata tag on storage — precise exclusion without inspecting content. |
| M8 | Agrees hotfix is safe for now; identifies phantom-training-data and temporal-fabrication as additional contamination vectors not yet covered by Odysseus. |

**Convergence:** Add a `source_type` (or `trust_level`) column to `m8_conversations`. Values: `user` / `assistant` / `eval_probe` / `summary`. At the `pastMemory` recall site, filter out `eval_probe` rows when `loopCtx.text` is non-empty — no regex, no content inspection. This is a future build item (not Build-27, but a planned architectural upgrade).

### Lane precedence

**GPT-4o + Grok:** "First match wins" is reaching its structural limit. Recommend a declarative priority registry where each lane declares its authority rank, rather than relying on implicit ordering.

**Gemini:** Agrees on structural hierarchy but argues strongly against an LLM-based router — too expensive on a serverless free tier. The fix must be deterministic.

**Synthesis:** Keep deterministic lane detection. Replace implicit ordering with an explicit `LANE_PRIORITY` array (constant in `orchestrator.js`) that declares authority rank. Each detector checks the array and yields to a higher-priority lane if it already has a result. This is a one-time refactor, not a new dependency.

### New Odysseus probe type (Manus)

Manus flagged that current battery probes test "can you recall?" The hardest probes test **"can you refuse correctly?"** — ambiguous facts where the right answer is "no, that did not happen."

Example probe: ask "which conjecture was promoted last night?" on a night where zero promotions occurred. The correct answer is `No promotion occurred` — not an improvised answer. This probe class should be added to `battery-l5.json` before L5 promotion is declared stable.

---

## Question 2 — Build-27 recommendation

### Vote tally

| Crew | Vote |
|------|------|
| M8 | Knowledge Acquisition Pipeline |
| GPT-4o | Knowledge Acquisition Pipeline |
| Grok | Knowledge Acquisition Pipeline |
| Gemini | Knowledge Acquisition Pipeline |
| Manus | Epistemic Classification Axis (dissent) |

**4/5 — Knowledge Acquisition Pipeline wins.**

### Why the pipeline

The shared reasoning across all four votes: **the bottleneck is no longer generation, it is structured learning.** The L5 loop is generating conjectures nightly. Without a structured ingestion layer, M3 is comparing survivors against a handful of manually curated seeds. The novelty gate is only as good as what it can compare against.

**GPT-4o:** "Collatz understanding grows slowly. Navier-Stokes impossible. Future theorem graphs remain sparse — without ingestion."

**Gemini:** "The current seed-pack model does not scale to Collatz literature, Navier-Stokes literature, or theorem dependency maps. The ingestion layer becomes the fuel source."

**Grok:** "Start with PDF/paper ingestion → SPO triple extraction → Supabase graph nodes. Tie into notebook threads. Keep it reversible and cheap."

### Manus dissent — worth recording

Manus recommended the Epistemic Classification Axis first, arguing it is a **prerequisite for honest ingestion**: "If M8 processes external documents that contain speculative or unverified claims, and these are not rigorously classified and isolated at ingestion, they could be laundered into the memory graph."

This is a real constraint, not a wrong answer. **The synthesis response:** the ingestion pipeline spec for Build-27 must include classification from the start — every ingested node gets a `source_class` tag (`established` / `speculative` / `fringe`) at extraction time. The full Epistemic Axis UI/behaviour layer (kernel/leap nodes, schema edge-ban) can follow as Build-28, but the classification field ships with the pipeline. Manus's concern is addressed by design, not deferred.

### What Build-27 is not

- **Calendar/Email** (Grok's original compressed-response vote): Track A value is real, but OAuth token management on a stateless serverless stack is non-trivial, and the North Star is Track B. Defer until after L5 promotes.
- **L5 Promotion First** (Manus, secondary note): The nightly Scheduled Task is now running. L5 promotion is tracking automatically — it does not need a build, it needs 3 nights. Build-27 can proceed in parallel.

---

## Question 3 — L6 "Compound" definition

### Convergence

All five crew members independently arrived at the same dividing line:

> **L5 runs experiments. L6 accumulates understanding.**

| Crew | Definition |
|------|-----------|
| M8 | Autonomous multi-stage DAG decomposition: M8 breaks open problems into sub-problems, runs L5 loop targeted at each sub-problem, feedback updates the decomposition |
| GPT-4o | Persistent world model updated across nights: Night 1 reads Tao → Night 100 generates conjecture using information collected across months |
| Grok | Cross-session synthesis: cross-domain bridging hypotheses (Collatz orbit invariant → Navier-Stokes monotone quantity analog) as first-class graph nodes + Lean check |
| Gemini | Closed-loop cross-pollination: verified Lean 4 lemma → M8 extracts new structural features → feeds back into M1 census for next night's run |
| Manus | Research agendas, not experiments: `observation cluster → research direction → planned experiment sequence → verification plan` |

### Synthesized L6 definition

**L6 is live when M8 autonomously updates what the loop looks for, based on what the loop found.**

L5: the loop parameters are static (seed rotation, fixed bound, fixed template set). Muhammad decides the agenda.

L6: a verified Lean lemma or a cluster of survivors with shared structure causes M8 to propose a new search direction — a new template, a new bound range, a new census predicate — which Muhammad reviews and optionally promotes. M8 generates the agenda; Muhammad gates it.

The first concrete L6 capability (Gemini's framing is the most buildable): **Lean lemma → M1 census extension.** When a leaf in `m8_lemma_scaffold` reaches `lean_verified`, M8 identifies the structural predicate that the lemma established and proposes adding it to the M1 observation schema. Muhammad reviews the proposal in chat. If approved, the next night's loop runs with an expanded census.

This requires no new infrastructure beyond Build-27's knowledge graph — the verified lemma node feeds back into the loop config via a human-gated "promote predicate" step.

---

## Decisions and action items

| # | What | When | Owner |
|---|------|------|-------|
| 1 | Scope `LOOP_TRIAGE_CONTAMINATION` filter to `role: 'model'`/`'summary'` rows only | Immediate (one-line fix) | Claude builds, Muhammad approves |
| 2 | Add "refuse correctly" probe to `battery-l5.json` (zero-promotion ambiguous fact) | Before L5 promotion declaration | Claude builds |
| 3 | Write `M8/BUILD_27_SPEC.md` — Knowledge Acquisition Pipeline stages 1–5, with `source_class` field at ingestion to address Manus dissent | Next session | Claude writes spec first, Muhammad reviews |
| 4 | Plan provenance tagging (`source_type` column on `m8_conversations`) to replace content regex filter | After Build-27, standalone architectural upgrade | Future build |
| 5 | L5 promotion gate | Automatic — 3 consecutive clean nights via Scheduled Task | No action needed |

---

## One-line verdict

**Build-27 = Knowledge Acquisition Pipeline.** The loop is generating; the bottleneck is now structured learning. L6 begins when verified Lean lemmas feed back into the loop's own search parameters — the pipeline is the prerequisite.
