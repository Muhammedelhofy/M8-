# M8 Command Center — Spec v1 (LOCKED)

**Status:** LOCKED for build. Synthesized by Claude from the v0 draft + red-team critiques by
GPT, Gemini, Grok, and Manus. **Decision ID:** 2026-0617-CC.
**Supersedes:** `COMMAND_CENTER_SPEC_v0.md` (kept for history). **Date:** 2026-06-17.

> The Council ran: Claude proposed v0 → GPT/Gemini/Grok/Manus attacked → this is the synthesis.
> Every contested choice below carries the critique that forced it. This whole exchange is itself the
> first entry in the decision-log the spec proposes (Decision ID `2026-0617-CC`).

---

## 0. What it is (unchanged from v0)
M8's single deterministic source of truth for **projects, tasks, dependencies, and decisions**, plus a
**code-computed priority recommendation** M8 *explains* and Muhammad *approves*. Executive **function**
without executive **authority**. Doctrine: **code computes truth, the model narrates.** Vision 1 (human
decides, AI illuminates).

Four strict layers — unchanged and endorsed by all reviewers:
`Reality → Command Ledger (state) → Priority Engine (code) → M8 Analysis (narration) → Muhammad (authority)`.

---

## 1. Decisions locked from the red-team (the 20% that was lethal)

### D1 — `StrategicValue`, not "Compounding-Value" (all 4 reviewers)
The "3-year capability gain" term is a **human judgment**, not a code fact. Renamed **`StrategicValue`**.
It is a **human-set enum** `{low=1, med=3, high=5}` written by Muhammad, stored with `origin:"human_judgment"`.
The Analysis Layer must narrate it AS a judgment: *"Muhammad rated this StrategicValue=high because…"* —
never as a computed fact. This keeps the "code computes" layer honest.

### D2 — Single source of truth = the Ledger (Manus F1, Grok adoption)
There is **one** source of truth: the Supabase **Command Ledger**. The in-repo roadmap markdown becomes a
**generated, read-only export** (`COMMAND_CENTER.md`, regenerated from the ledger), never hand-edited as a
competing source. `HONESTY_TRACK_PLAN.md` / `NEXT_SESSION_BRIEF.md` stay as *narrative history*, not task
state. This kills the "two systems, no sync → 30% accurate by week 2" death spiral.

### D3 — Degraded mode is REQUIRED in v1 (Gemini, Grok)
Supabase is a single point of failure, so:
- On every ledger write, M8 also writes a **`command_center_snapshot.json` committed to git**.
- If a Supabase read fails, the engine/chat path **loads the snapshot** and narrates
  *"Ledger unreachable — using git snapshot from \<date/SHA\>; priorities may be stale; writes blocked."*
- The HTML view caches the last snapshot in `localStorage` and shows a loud **`[OFFLINE — STALE DATA]`** badge.
- Writes are blocked while degraded (no silent divergence).

### D4 — Dependency-Blockage is VALUE-weighted, not a raw count (GPT #1, the biggest fix)
Raw transitive count rewards bureaucracy ("5 doc cleanups" outranking "build Memory Architecture"). Replace:
```
DependencyBlockage(task) = Σ over the task's transitive-downstream closure of (Impact + StrategicValue)
```
Deterministic from the DAG, still fully auditable (the Analysis Layer can list *which* downstream tasks and
their values). Not full open-ended recursion (complexity) — one value-sum over the closure.

### D5 — Priority Bands, not 1..N ranks (GPT #3)
The engine assigns each task a **band** from its score, not a meaningless ordinal:
`Critical · Important · Active · Queued · Parking Lot`. Humans see `Critical (4) · Important (12) · …` and
the top few per band. Scales to hundreds of tasks without "is #43 really above #44?" noise.

### D6 — Adoption is a v1 requirement, not a nice-to-have (Grok, Manus F-adoption)
- **Proactive inline logging:** during normal work, when a task/decision is implied, M8 **offers to log it**
  ("I've drafted a task: 'Fix L6 gate — unblocks N downstream'. Add to the Command Center? Y/N"). Human-gated,
  default propose+confirm on build completions and gate events.
- **Silent-staleness alarm:** if the ledger hasn't been touched in **> 5 days**, every priority query and the
  health strip surface `⚠ ledger stale (N days)`.

### D7 — Score stays linear; CONSTRAINTS are surfaced, not solved (Manus F2, Option B)
v1 does NOT build a constraint solver. The engine:
1. **Filters out blocked tasks** (any unmet dep) → they never rank; shown in a separate "blocked — can't start"
   list with `blocked_by`.
2. Computes the linear score on the rest.
3. Surfaces per-task **constraint metadata** the Analysis Layer narrates: `blocked_by`, `gate_status`
   (which hard gate, e.g. L6, blocks it), `conflicts_with` (free-text, human-noted). Mutual-exclusivity and
   resource-contention are **narrated for Muhammad to resolve**, not auto-serialized. Hard gates are modeled
   as a **high-urgency blocking task**, not `urgency=∞` (keeps it deterministic).

### D8 — Guards against the "bureaucracy engine" (GPT #4, #5)
- **Max dependency depth = 8.** A write that would exceed it is rejected: *"split this project."*
- **States stay at 6** (`planned·active·blocked·waiting·review·done`). `blocked`/`waiting` carry a free-text
  **reason**. No new states without a logged decision. Resist `deferred/on-hold/needs-info/...`.

### D9 — Decision-log elevated to first-class (GPT #6, Manus 4.2)
`m8_decisions` is a first-class system, not a side table. **Substantive rationale is required** — M8 refuses
to log a weight/priority change with "feels right" and asks for the actual reason. The Analysis Layer narrates
the *full history* for any "why are the weights X?" question (append-only; "undo" = a new decision).

### D10 — Interface: render the committed snapshot (Gemini RLS-catastrophe, Manus security, 12-fn cap)
v1's HTML view (`m8_command_center.html`, double-click like `m8_tracker.html`) renders the **committed
`command_center_snapshot.json`** — **zero Vercel functions, zero anon-key exposure, offline by default, no
polling death-loop.** Live Supabase-from-browser (anon+RLS) and a server read-route are **deferred** to the
full dashboard. M8 regenerates the snapshot whenever it writes the ledger, so the view is current after any
M8 session.

### D11 — Health: minimal strip now, full dashboard later (tie: Gemini "keep here" vs Grok/Manus "separate")
v1 includes a **minimal health strip** in the Command Center: L6 gate `consecutive_clean/3`, last nightly +
Odysseus pass/fail, deploy SHA, ledger-staleness flag. **Crucially it is labeled with its data source**
(`m8_loop_runs`/`m8_odysseus_runs`/`/api/health`) — decoupled from the ledger, so one being stale never
implies the other. The **full observability dashboard** (latency histograms, tool success %, memory-graph
health, Manus's 8 metrics) is a **separate followup surface** (`observability.html`) — not v1 bloat. This
gives Gemini the single-pane operator view while honoring Grok/Manus's "one thing well / don't couple."

### D12 — Approval Tiers = documented FUTURE, not v1 (GPT #7)
GPT's sharpest long-horizon point: when M8 succeeds, **human approval becomes the bottleneck** (100
proposals/week). Future evolution (still Vision 1): `Tier 1 inform-only · Tier 2 recommend · Tier 3 explicit
approval`. **Not built in v1** (v1 is all-explicit-approval), but recorded so we design toward it.

---

## 2. Locked schema (Supabase, `m8_*`)
- `m8_cc_projects` — id, title, track (`A_ops|B_research|infra`), state, reason (nullable), created_at, updated_at, notes.
- `m8_cc_tasks` — id, project_id, title, state, reason (nullable), deps (int[]), **impact** (1-5),
  **urgency** (1-5), **risk** (1-5), **strategic_value** (enum 1/3/5, origin human_judgment), **effort** (1-5),
  origin (`human|m8_proposed`), gate_status (nullable text), conflicts_with (int[] nullable), created_at, updated_at.
- `m8_cc_decisions` — id, decided_on, title, proposal, critiques (jsonb `{gpt,grok,gemini,manus,claude}`),
  resolution, **rationale (NOT NULL, length-checked)**, related_task_id.
- DAG: `deps` form a DAG; **cycle guard + max-depth-8 guard** enforced in code on write.
- Naming uses `m8_cc_*` to avoid colliding with existing `m8_*` research/loop tables in the shared project.

## 3. Priority Engine (`lib/command-center.js`, deterministic, FIXED weights)
```
score = wI*Impact + wU*Urgency + wB*DependencyBlockage + wC*StrategicValue - wR*Risk - wE*Effort
```
**v1 starting weights** (Manus 5.1, logged as the first `m8_cc_decisions` row; tuned after real data):
`wI=0.2, wU=0.3, wB=0.4, wC=0.1, wR=0.3, wE=0.2`. `DependencyBlockage` per D4 (value-weighted closure,
normalized into the same 1-5-ish range before weighting). Output = bands (D5) + per-task breakdown +
constraint metadata (D7). Pure, sync, fail-safe.

## 4. Honesty invariants (unchanged, all reviewers endorsed)
1. Scores are code-computed from explicit ledger fields, fixed weights; the LLM narrates, never re-ranks.
2. M8 never autonomously changes a state or priority — human-gated (one fact-exception: a shipped build's
   commit SHA → its task auto-`done`, tightly defined as SHA-match + task-id).
3. Dependency-Blockage from the real DAG (now value-weighted), not a guess.
4. Decision log append-only, substantive-rationale-required, auditable.
5. The Analysis Layer cannot assert a status (done/shipped/gate-passed) the ledger/live-facts don't support.
6. `StrategicValue` is always narrated AS a human judgment, never a computed fact.

## 5. v1 build scope (LOCKED — resist additions)
1. 3 tables (`m8_cc_projects/tasks/decisions`) + cycle & depth guards.
2. `lib/command-center.js`: value-weighted-blockage scorer + bands + blocked-filter + constraint metadata +
   snapshot writer + degraded-mode snapshot reader.
3. ONE chat hard-route ("what's the priority / what should we work on?") → narrated bands packet, routed
   through the existing orchestrator (**no new Vercel endpoint**).
4. Proactive inline-logging offer (D6) + silent-staleness alarm.
5. Minimal health strip (D11) sourced & labeled from loop/odysseus/health.
6. `m8_command_center.html` rendering the committed snapshot (D10).
7. Seed the ledger from the real agreed roadmap (gate-fix done, Command Center building, depth, Track-A,
   hygiene) + log this Council as decision `2026-0617-CC`.
**Deferred to followups:** full observability dashboard, live Supabase-from-browser/anon-key path, approval
tiers, mutual-exclusivity/resource auto-solving, value-weighting refinements, Realtime/WebSocket updates.

## 6. Tests (offline-first, per M8 practice)
- `command-center-verify.ps1`: scorer math (incl. the GPT "5 cleanups vs 1 memory build" case must rank the
  memory build higher), value-weighted blockage, band thresholds, cycle guard (**adversarial A→B→C→A must be
  rejected**, Manus 3.3), max-depth-8 guard, blocked-filter, degraded-mode snapshot read, rationale-required.
- Live: one chat turn proving the narrated bands packet + the proactive-logging offer + no autonomous re-rank.

## 7. Build sequence (Manus decomposition ask)
Migration (tables+guards) → `lib/command-center.js` (engine+snapshot+degraded) → offline tests → chat
hard-route + proactive-logging + health strip → seed ledger + log decision → snapshot + thin HTML view →
offline verify → live verify. Critical path = engine + snapshot (everything else renders them).

---
*Locked by Claude, 2026-06-17. Crew critiques resolved above; v0 retained as `COMMAND_CENTER_SPEC_v0.md`.*
