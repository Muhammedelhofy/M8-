# M8 Command Center — Spec v0 (DRAFT FOR RED-TEAM)

**Status:** DRAFT — written by Claude to be ATTACKED by GPT / Grok / Gemini / Manus before anything is built.
Do **not** treat this as locked. The point of v0 is to expose hidden assumptions and failure modes.
**Author:** Claude (lead eng) · **Date:** 2026-06-17 · **Decision ID:** 2026-0617-CC

---

## 0. One-paragraph summary
The Command Center is M8's single deterministic source of truth for **projects, tasks, dependencies,
and decisions**, plus a **code-computed priority recommendation** that M8 *explains* and Muhammad
*approves*. It is the de-risked form of the "Executive Cortex": **executive *function* (prioritize,
coordinate, surface) without executive *authority* (M8 never starts, stops, or reorders work on its
own).** It directly embodies the M8 doctrine — **code computes truth, the model narrates** — and keeps
M8 firmly in "Vision 1": human decides, AI illuminates.

## 1. Why now (the bottleneck it removes)
M8's project state is scattered across `HONESTY_TRACK_PLAN.md`, `NEXT_SESSION_BRIEF.md`, `buildState.js`,
and chat memory. There is no single place that answers **"what matters most right now, and why?"** As the
system compounds (48 builds, nightly loops, two tracks), that absence becomes the real tax — not missing
capability. Every team member (M8-self, GPT, Grok, Manus, Gemini) independently flagged some version of
"prioritization / project graph / decision memory" as the missing layer.

## 2. Architecture (4 layers — strict separation)
```
Reality (builds shipped, gate status, fleet alerts, research runs)
   |
1. COMMAND LEDGER          (deterministic state in Supabase — the source of truth)
   |
2. PRIORITY ENGINE         (deterministic scoring in lib/ — fixed weights, no LLM)
   |
3. M8 ANALYSIS LAYER       (the LLM NARRATES the ranking; never invents or re-ranks a score)
   |
4. MUHAMMAD                (approves / reorders — the only authority)
```
**Hard rule:** layers 1–2 are pure code; layer 3 is the only LLM touch and it is narration-only; layer 4
is the only place priorities/states actually change. M8 may *propose*, never *enact*.

## 3. Layer 1 — Command Ledger (Supabase tables)
- `m8_projects` — id, title, track (A_ops | B_research | infra), state, created_at, updated_at, notes.
- `m8_tasks` — id, project_id, title, state, deps (int[] of task ids), **impact, urgency, risk,
  compounding, effort** (each a small fixed integer scale, set by Muhammad), origin (human | m8_proposed),
  created_at, updated_at.
- `m8_decisions` — id, decided_on, title, proposal, critiques (jsonb: `{gpt, grok, gemini, manus, claude}`),
  resolution, rationale, related_task_id. **Append-only decision log** (GPT's "decision history" asset).
- **States** (both projects & tasks): `planned · active · blocked · waiting · review · done`.
- Dependencies form a **DAG**; a write that introduces a cycle is rejected in code.

## 4. Layer 2 — Priority Engine (deterministic, `lib/command-center.js`)
For each **open** task compute a transparent score from FIXED, documented weights (not LLM-tunable —
same discipline as the M3 gate margins; changed only via a logged `m8_decisions` row):

```
score = wI*Impact + wU*Urgency + wB*DependencyBlockage + wC*CompoundingValue - wR*Risk - wE*Effort
```
- **Dependency-Blockage** = the count of tasks in the DAG's **transitive downstream closure** of this task
  (how many future tasks it unblocks). This is the sharp dimension GPT + Claude converged on — a task that
  unblocks 14 others outranks an isolated one. Computed deterministically from `deps`.
- **Compounding-Value** (GPT's add) = 3-year capability gain, biasing slightly toward future capability so
  the system gets *smarter*, not just busier.
- **Blocked tasks** (any unmet dep) are surfaced in a separate "blocked — can't start yet" list, never
  ranked #1 regardless of score.
- **System tasks** (e.g. "L6 promotion gate") can be injected with high urgency from live facts (gate
  status, fleet alerts) so the engine sees them.
- Output: a ranked list, each row carrying its **per-dimension breakdown** (so the recommendation is fully
  auditable — no black-box number).

## 5. Layer 3 — M8 Analysis Layer (narration only)
A chat hard-route: *"what should I work on?" / "what's the priority?"* → M8 returns the code-ranked packet,
narrated: *"Ranked #1: the L6 gate fix — unblocks 14 downstream tasks, blocks L6 promotion, compounding-high,
low risk."* M8 quotes the code-computed scores and the dependency facts; it **never invents a score, never
re-orders, never claims a task is done that the ledger doesn't mark done.** Same contract as fleet/Lean/charts.

## 6. Layer 4 — Human approval
M8 *proposes* (tasks enter as `m8_proposed` and need Muhammad's approval to become `active`, mirroring the
Build-42 decomposition propose→approve gate). State transitions are **human-gated**, with ONE deterministic
exception: a fact-driven transition (a build's commit ships → its task auto-moves to `done`) is allowed
because it's a *fact*, not a judgment.

## 7. v1 scope (smallest genuinely-useful — do NOT boil the ocean)
- 3 tables (§3) + cycle guard.
- `lib/command-center.js`: deterministic scorer + transitive dependency-blockage + ranked packet builder.
- ONE chat hard-route ("what's the priority?") narrated — routed through the existing orchestrator, **no new
  Vercel endpoint** (Hobby caps at 12 serverless functions; logic lives in `lib/`).
- **Minimal health panel** folded in (absorbs Grok's observability ask v1): gate `consecutive_clean/3`,
  last nightly + Odysseus score, deploy SHA — read from the tables we already have.
- Seed the ledger from the **real current roadmap** (gate-fix done, Command Center next, depth, Track-A,
  hygiene) so it's useful on day one.
- A read-only self-contained `m8_command_center.html` view (double-click, like `m8_tracker.html`) — optional
  in v1, can immediately follow.
**Deferred:** full observability dashboard, notifications, auto-state-transitions beyond the ship→done fact,
multi-level project rollups.

## 8. Honesty invariants (load-bearing — must survive review)
1. Scores are **code-computed** from explicit ledger fields with **fixed** weights; the LLM narrates, never
   computes or re-ranks.
2. M8 **never autonomously** changes a state or a priority — human-gated (Vision 1).
3. Dependency-Blockage comes from the **real DAG**, not the model's guess.
4. The decision log is **append-only and auditable** — every weight change or reprioritization is a logged
   decision with its rationale.
5. The Analysis Layer cannot mark a task done, claim a build shipped, or assert a gate passed unless the
   **ledger/live facts** say so (no confabulated status — same bar as the fleet/loop honesty contract).

## 9. ATTACK SURFACE — red-team prompts (please attack, don't agree)
**For GPT (systems / 100× / long-horizon):**
- Does the 6-term score stay *legible* at 500 tasks? Is Dependency-Blockage (transitive count) the right
  shape, or should it be value-weighted by what it unblocks? What breaks when the DAG gets deep?
- Is "Compounding-Value" measurable enough to be a code field, or does it smuggle judgment back in?

**For Grok (resilience / single-point-of-failure / anti-stale):**
- If Supabase is down, does M8 fall back to the in-repo roadmap, or go blind? Define the degraded mode.
- What stops the ledger becoming the dead tracker nobody updates? (Adoption: must M8 offer to log
  tasks/decisions *inline* during normal work?) Where's the silent-staleness alarm?
- Should the health panel live here or be a separate observability surface — which is more resilient?

**For Gemini (serverless / cloud survival / cost):**
- Reading Supabase live from a static HTML view — anon key + RLS, or a server route? Cost/latency at the
  Vercel free tier? Does the "no new endpoint" constraint hold, or do we spend one of the 12 functions?
- Any quota/timeout risk if the Analysis Layer packet gets large?

**For Manus (prior-art / decomposition / implementation realist):**
- **Are we reinventing a wheel?** Established models do dependency-aware prioritization already — e.g. SAFe's
  **WSJF** (Weighted-Shortest-Job-First = Cost-of-Delay ÷ Job-Size), RICE (Reach·Impact·Confidence÷Effort),
  ICE. Our 6-term score is close to WSJF. Should we adopt a proven, named model (and its known pitfalls)
  instead of hand-rolling weights? What do those models get wrong that we'd inherit?
- **Decompose v1 (§7) into an ordered, testable build sequence** with the critical path called out, and flag
  exactly what's *underspecified to actually code* (the integer scales for impact/urgency/etc., the
  cycle-check algorithm, the seed-data shape, the chat-route detector).
- What is the **smallest slice that delivers real value in a single session** — and what's the riskiest step?

**For everyone:**
- Is v1 scope (§7) the smallest *genuinely useful* cut, or is something load-bearing missing / something
  bloat? Is the human-gated-with-one-fact-exception model (§6) right?

## 10. Open decisions to LOCK after review
- [ ] Final weight set + scales for the 6 score terms (and the rule for changing them).
- [ ] Dependency-Blockage = raw transitive count vs value-weighted.
- [ ] Storage/interface: Supabase tables + HTML view (proposed) vs in-repo MD mirror vs both.
- [ ] v1 includes the HTML view or ships engine-first.
- [ ] Adoption mechanism: does M8 proactively offer to log tasks/decisions during normal work?

_Once GPT/Grok/Gemini have attacked this, Claude synthesizes → `COMMAND_CENTER_SPEC.md` (locked) → build._
