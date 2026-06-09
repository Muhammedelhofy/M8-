# M8 — SESSION HANDOFF (2026-06-10) · START HERE

*For the next Claude (fresh account, no memory of the prior chat). Read this, then `M8/STATUS.md` (the living source of truth — it wins over chat + memory). This file = the snapshot + the decided next build + how to work safely here.*

---

## 0. THE 60-SECOND ORIENTATION
- **What M8 is:** Muhammad's personal AI agent. Live at **m8-alpha.vercel.app**. Repo **github.com/Muhammedelhofy/M8-** (separate git repo, NOT the parent Bolt repo). Backend = serverless `/api/chat` on Vercel Hobby; brain = `lib/orchestrator.js`.
- **North Star (corrected 2026-06-10, do NOT re-drift):** make M8 genuinely able to help **resolve UNSOLVED prize-class math/logic problems** ($1M Millennium tier = the *bar we build toward, never the claim*). **The fleet is NOT the mission — it's a live TEST BENCH** for M8's logic/accuracy. Never frame "autonomous logistics" as the goal.
- **Strategic frame (locked this session):** two piles, not one ladder. The **buildable harness** (compute · verify · memory · orchestration) is engineering M8 can be world-class at. The **discovery spark** (conjecture · reframing · extrapolation) is the real bottleneck nobody — incl. the $1B labs — has cracked. **M8 = a deterministic harness around a frontier model's spark.** We build the harness; the model supplies the spark.
- **Rung:** L1✅ L2✅ · L3 ~85% (fleet layer FROZEN at rider-risk) · **L4 ~55% (ACTIVE lane: Verified Tool Orchestration)** · L5 ~5%.

## 1. WHAT SHIPPED THIS SESSION (all live-verified; origin/main = `ff66db4` + the docs commit after this)
- North-Star correction deployed (`3561948`) + the stale Supabase `north_star_goal` memory fact superseded; live-verified "what is our North Star?" returns the corrected mission.
- **L4 Build-4 Tool Decision Layer** (`1a126dc`): `decideAction` (lib/router.js) gained a `compute` action → the orchestrator LLM picks `answer|search|compute|clarify` in the slice the deterministic gates haven't claimed. Fleet/state/open-problem stay HARD-ROUTES above the LLM (integrity moat). Contract lifted to the search tool via `verifiedOutputContract(tool)`.
- **Build-5 L4 eval probes** (`a1874f4`): new `tool_decision` eval category + probes in `tests/eval/probes.js` + `run-eval-live.ps1`. Live 5/5.
- **tool_decision trace column** wired (`088992b`): migration applied by the user, `logTrace` + `/api/traces` write/read it.
- **Build-6 compute/search gate** (`149fc42`, team-unanimous): `!computeMode` suppresses the web-search slot when self-contained math fires → compute owns the number, no laundered citations. Live before/after proven via the trace (`search_fired` true→false on "9 to the power of 11?").
- Team round done (`M8/TEAM_UPDATE_NORTHSTAR_2026-06-10.md`, `M8/TEAM_DECISION_SHIPPED_2026-06-10.md`).

## 2. ★ THE DECIDED NEXT BUILD — Research Notebook (persistent research memory)
**Decided 2026-06-10 (team + Claude). This is the next thing to build.** Highest-leverage, most-tractable, and the substrate L5 needs.
- **What:** extend the existing Supabase memory spine (`lib/memory.js`, table `m8_conversations` with `memory_key`/`is_current` supersession) into a STRUCTURED research ledger — one record per line of inquiry: `conjecture · evidence · counterexample · dead-end · status · next-step`.
- **Why:** without it every session restarts from zero; it's what turns clever single turns into actual research, and it's the one thing the big labs can't give Muhammad (no memory of HIS exploration). Deterministic + honest (a ledger of verified facts/dead-ends, not a hallucination surface).
- **Then (don't build before the notebook):** Phase 3 = a MINIMAL Lean verification probe (formalize KNOWN theorems first, M8 proposes → checker accepts/rejects); Phase 4 = computational-discovery loops (Collatz/Goldbach/OEIS to huge N, feeding the notebook); Phase 5 = long-horizon exploration. **Do NOT jump to a conjecture-engine / autonomous loop** — those sit on top of the discovery spark nobody has; building them now is a cathedral on a missing floor.

## 3. OPERATOR ASSISTANT (breadth — Muhammad's standing requirement, same spine, NOT a North-Star drift)
Muhammad relies on M8 as his honest day-to-day **work partner**, and this is the SAME deterministic-honesty + verified-compute + memory muscle pointed at his work — keep it in mind on every build:
- Honest professional assistant: **presentations/decks + documents** (docgen exists → extend), real-life scenario reasoning, decisions — grounded, "fact: vs my read", narration ≤ evidence.
- **Financial models + tracking** on the VERIFIED-compute lane (executed numbers, not estimates) — on-mission, exercises the exact muscle the North Star needs.
- **Legal / regulatory awareness** (KSA labour / commercial / 3PL): inform + lay out the picture, but HOLD the escalation rule (binding contracts / liability / filing → a qualified professional). Never fake legal certainty.
- **Multi-company adaptability:** today Bolt 3PL; tomorrow **Thrivve.sa / Noon / others**. Keep the data/test-bench layer ADAPTABLE (don't hard-lock to Bolt's blob shape) so M8 travels with him.

## 4. HOW TO WORK SAFELY HERE (hard-won rules — violate these and you break things)
- **NO local node** on this machine. Verify logic via **PowerShell .NET-regex ports** (`tests/*.ps1`, e.g. `tests/tool-decision-verify.ps1`) + live calls. A syntax error only shows up as a **Vercel build failure** → confirm deploys via the Vercel MCP (`list_deployments`, look for your commit `state: READY`) before trusting a live test.
- **Deterministic-first / honesty never bends** — code/tools find truth; the LLM narrates a verified packet. A fabricated answer is the worst failure at every rung. Don't let an answer drift back to "fleet is the mission."
- **Vercel Hobby 12-fn cap (at 6)** — tool loops stay IN-PROCESS inside `/api/chat`; no new endpoints.
- **Supabase migrations:** the USER runs them (project `ltqpoupferwituusxwal`). Never add a column to the `logTrace` insert before its migration is applied (a missing column makes the whole insert fail silently and kills ALL tracing). Idempotent SQL lives in `M8/migrations/`.
- **Eval:** don't run the full battery back-to-back (free-provider fallback degrades the reasoning axis). Use `run-eval-live.ps1 -Only <category>` for slices. Keep `probes.js` (canonical) and `run-eval-live.ps1` (PS port) in sync.
- **Fleet is FROZEN** at rider-risk — it's a test bench; don't propose new fleet features as "next."
- **Team rounds** = a standalone MD brief file in the repo (Muhammad's standing preference), never a copy-paste chat summary.

## 5. KICKOFF PROMPT FOR THE NEXT SESSION
> "Continue M8 — build the **Research Notebook** (persistent research memory), the decided next build. Read `M8/STATUS.md` + `M8/SESSION_HANDOFF_2026-06-10.md` first. Spec then build: extend the Supabase memory spine into a structured research ledger (conjecture/evidence/counterexample/dead-end/status/next-step, supersession-aware). Keep it deterministic + honest; wire it into the orchestrator like the fleet/state packets (code owns the ledger, the LLM narrates). Port-verify (no local node), live-verify, commit to M8 main. Guardrails: deterministic-first, honesty never bends, 12-fn cap (in-process), fleet frozen, keep the Operator-Assistant breadth (presentations/finance/legal-aware/multi-company) in mind."

---
*Repo: github.com/Muhammedelhofy/M8- · Live: m8-alpha.vercel.app · Vercel project `m8` (team Hofy's) · Supabase `ltqpoupferwituusxwal`. STATUS.md is the living page — update it every session.*
