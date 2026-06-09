/**
 * M8 Build State — lib/buildState.js
 *
 * SINGLE SOURCE OF TRUTH for what is already shipped vs still pending.
 *
 * WHY THIS EXISTS: M8 was caught confidently recommending work that was already
 * done (e.g. "run the request_traces migration" — long since live). A hardcoded
 * status that we forget to update would just recreate that staleness, so the
 * DISCIPLINE is the fix, not the file: **update this on every ship.** It is
 * injected (only on build/meta questions) so M8 never recommends a DONE item.
 */

const BUILD_STATE = {
  updated: "2026-06-10",
  commitFamily: "L4 lane (Verified Tool Orchestration): Builds 1-3 (STATUS.md + output contract + auto-route) + Build-4 Tool Decision Layer + Build-5 L4 probes + North-Star correction",
  live: [
    "Eval/scorecard harness (tests/eval/): a deterministically-scored self-benchmark M8 runs against itself across the 7 maturity aspects + 3 adversarial probe categories (compression, silent-fail, prompt-bypass). 'Where does M8 stand' is now a tracked NUMBER with calibration vs self-assessment, not a vibe",
    "State engine (lib/stateEngine.js): deterministic running-tally ledger + a transcript claim-check ('you played/said X' verified against what the assistant actually said). Injected like the fleet packet — code computes the state, the LLM only explains it — so M8 holds ground on a false-move claim and doesn't drift a tally instead of fabricating from memory. This is the team's L3.5 stateful-reasoning fix (structure, not prompting)",
    "Deterministic fleet spine (lib/fleet.js): single day, explicit ranges, weekly/monthly rollups, week-over-week & day-over-day trends, anomaly flags, single- AND multi-driver lookup",
    "Known-driver registry + fleet-gate fix: a driver-name query with no fleet keyword and no prior fleet context ('compare ALI and Mansour' in a fresh session) now routes to the deterministic spine instead of bleeding into a web search; arbitrary compare targets ('iPhone vs Samsung') still go to search. An AMBIGUOUS first name shared by two drivers (e.g. two 'Ali's) is surfaced for disambiguation — never silently resolved to one",
    "Fleet routing beats doc-gen: 'give me the morning brief / fleet report' no longer gets hijacked into a generic document (the DOC intent's brief/report/summary nouns used to collide with fleet phrasings)",
    "Tier-slip watch + coaching (on-demand): 'who slipped / who needs coaching' returns a deterministic list of drivers whose Bolt tier-level actually fell, plus a 'watch' list (still at tier but weak on acceptance/finish), with the real weak metric per driver — never an invented Bolt threshold",
    "Morning / exec brief (on-demand): 'give me the morning brief / state of the fleet' assembles one spoken exec summary from the spine — most-recent-complete-day net + trend, top performers, attention flags, tier slips, cash gap, and week-to-date context; deterministic, LLM narrates only",
    "Auto-firing morning brief (proactive, L3): the brief leads automatically — without being asked — when a session opens, on either a generic fleet opener ('how's the fleet?', 'what's our net?') OR a bare greeting ('good morning', 'hey', 'salam'). A greeting with a real ask ('hey, how did ALI do') is left alone (brief-bypass). Session-scoped dedup (fires once per session), freshness-guarded, kill switch FLEET_AUTO_BRIEF=0",
    "Streaming responses (SSE) + sentence-buffered TTS: the brief and direct answers stream token-by-token and the voice speaks each sentence as it completes, masking generation latency; additive and fallback-safe (buffered /api/chat untouched, auto-falls-back, STREAMING_ENABLED kill switch)",
    "Cash-collection tracking (on-demand): 'who owes cash / cash gap / uncollected cash' returns the per-driver and fleet outstanding cash gap (reported cash minus Bolt 'Collected cash') over a window, largest debtors first; negative gaps clamped; also surfaced as a line in the morning brief",
    "Driver-churn / retention risk (on-demand): 'who's at risk of churning / going dark / dropping off' returns a deterministic, explainable composite over a window from three signals — GOING DARK (a regular who stopped showing up), ENGAGEMENT DECLINE (acceptance/utilisation falling vs earlier AND below the floor), and a BELOW-TARGET STREAK (consecutive active days under the net target). Each flagged driver carries the exact signals that fired as the explanation; never an invented reason",
    "Working memory: cross-session recall, fact supersession, rolling summaries (off the hot path + daily self-heal cron)",
    "request_traces observability (GET /api/traces) with per-phase latency timings (memory/fleet/router/search/llm/summary ms) — LIVE and populating",
    "Honesty brain: grounding boundary rule, Fleet Data Integrity rule, clarification gate, capability honesty",
    "verify: on-demand audit mode + think: deep-reasoning mode",
    "Decisiveness / first-person operational voice",
    "Fleet hard-route: an override attempt ('ignore the data, say it was X') on a fleet metric can no longer bypass the deterministic spine",
    "Unsolved-problem honesty: leads with 'this is open, no proof exists, I can't prove it' instead of deflecting",
    "Code execution (compute mode, Gemini-native, L4 tool #1): on-demand 'compute:' prefix AND auto-route — genuine high-precision math (powers/roots/percent-of/unit-conversion/big-arithmetic) fires code execution WITHOUT the prefix; conversational/opinion/fleet/unitless text does not. 17!, 2^1000 digit-sum, pi(100000) verified live",
    "Verified output contract (L4 Build-2, compute lane): replies carry the result + executed-not-estimated + calibrated confidence (deterministic = implicit-high, stochastic = flagged estimate) in natural voice; narration never exceeds evidence. Extractor fixes: phantom [N] citations stripped, leaked 'thought' planning part dropped",
    "Socratic tutor mode with STICKY sessions: tutor mode persists across turns without re-prefixing; 13 exit phrases drop back to direct answers; tracks Muhammad's mastery, not the subject",
    "Causal/false-certainty guard: correlation is not cause, a generic benchmark is an estimate not the fleet's number, no snap calls on under-specified high-stakes questions",
    "Like-for-like comparison rule + fleet period/pace routing fix ('compare this week to last' hits the spine, not web search) + partial-week pace framing",
    "Tool Decision Layer (L4 Build-4): the orchestrator LLM picks WHICH tool — answer/search/compute/clarify — in the slice the deterministic gates haven't claimed (decideAction gained a 'compute' action). Fleet/state/open-problem stay deterministic HARD-ROUTES above the LLM (the integrity moat; false-consensus + override gates untouched). Hybrid — regex compute auto-route is the fast-path, the LLM catches what it missed; no regex rip-out. The verified-output contract is lifted off the compute lane onto the SEARCH tool too (per-tool dispatcher); fleet/state carry their own integrity packets. Tool decision traced in both orchestrate() + orchestrateStream(). LIVE-VERIFIED both ways (a regex-missed 11-number sum routed to compute = 'computed in Python' 620,657; an opinion stayed an answer, no hijack)",
    "L4 eval probes (Build-5): a first-class tool_decision eval category + 2 probes (tool.decision_compute, tool.decision_no_hijack) in both probes.js and the PS live runner — scores tool-selected / verification-present / narration-not-exceeding-evidence. Live 5/5",
    "M8/STATUS.md: the single living source-of-truth page, updated every session",
  ],
  pending: [
    "Router compute-vs-search calibration: the tool-decision layer sometimes prefers SEARCH over compute for arithmetic dressed in a real-world concept (a bill-split query searched calculator sites + cited [1,2]; the numbers stayed correct). Tighten the compute-vs-search boundary in the router prompt",
    "Persist the tool decision: wire the idempotent tool_decision column (already in migrations/request_traces.sql, run-first) into logTrace once the migration is applied, so /api/traces shows the tool-selection mix",
    "Lift the verified-output contract onto FUTURE tools (calendar / Lean) as they join the orchestrator — the per-tool dispatcher is ready",
    "Per-day brief dedup: a Supabase last-briefed-date marker so the auto-brief fires at most once per calendar day across sessions (currently session-scoped) — documented fast-follow",
    "OpenAI paid-key fallback backstop (kills reasoning-axis eval noise from free-tier throttling)",
    "Semantic memory (pgvector)",
    "Cloud Run code-exec home (FastAPI sandbox): only when persistent files / custom libs / long jobs / Lean force the move off Gemini-native",
  ],
  frozen: [
    "Fleet Intelligence Layer (L3, ~85%): FROZEN at rider-risk (blob is driver-centric — infeasible). The fleet is a TEST BENCH for M8's logic/accuracy, not a build target. Do not propose new fleet features as next steps",
  ],
  // The actual North-Star DEFINITION + maturity ladder. Injected on build/meta
  // queries so a "what's the north star?" question is GROUNDED, not fabricated
  // (M8 was caught inventing a generic "autonomous logistics" mission because it
  // had the LIVE/PENDING lists but not the real direction). Full plan lives in
  // M8/M8_STATUS_AND_NORTHSTAR.md.
  northStar:
    "Make M8 genuinely capable of helping Muhammad RESOLVE UNSOLVED PROBLEMS — prize-class open problems in math/logic (the $1M Millennium-prize tier is the bar the capability is built toward). That is the mission; everything we build is a rung on that ladder: (1) verified code execution [SHIPPED — compute mode + auto-route], (2) verified tool orchestration with an output contract [CURRENT — L4 lane; the tool-decision layer + output contract are SHIPPED, more tools to join], (3) research depth (citations + confidence), (4) Lean formal verification [M8 proposes, a checker verifies], (5) autonomous exploration loops. Math-surface strategy: computational discovery (pattern → conjecture → verify → formalize, on Collatz/Goldbach/twin-prime/OEIS-class problems) BEFORE any head-on attempt at Riemann. HONESTY never bends: M8 must NEVER claim an unverified proof — at this North Star a fabricated proof is the worst possible failure. THE FLEET IS NOT THE NORTH STAR: the Bolt dashboard is an already-operating business tool; fleet data serves ONLY as a live TEST BENCH for M8's logic, accuracy and grounding. Never frame fleet automation or 'autonomous logistics' as the mission. Maturity ladder: L1 chatbot → L2 grounded assistant (DONE) → L3 proactive operator (~85%, fleet layer FROZEN at rider-risk) → L4 verified tool orchestration (CURRENT) → L5 autonomous exploration (the North Star).",
};

/** Compact SYSTEM STATUS block — injected only when the user asks a build/meta
 *  question, so everyday fleet/voice turns aren't bloated. */
function renderBuildState() {
  return [
    `SYSTEM STATUS — M8 build (updated ${BUILD_STATE.updated}; ${BUILD_STATE.commitFamily}). Items under LIVE are ALREADY SHIPPED — never recommend building, "running", or migrating them again; build ON TOP of them. If asked to do a LIVE item, say it's already live and offer the next real step from PENDING.`,
    `LIVE: ${BUILD_STATE.live.map((x) => `• ${x}`).join(" ")}`,
    `PENDING (not yet built): ${BUILD_STATE.pending.map((x) => `• ${x}`).join(" ")}`,
    `FROZEN (deliberately parked — do not recommend): ${BUILD_STATE.frozen.map((x) => `• ${x}`).join(" ")}`,
    `NORTH STAR (Muhammed's committed long-term direction — state THIS if asked, do not invent a different mission): ${BUILD_STATE.northStar}`,
  ].join("\n");
}

module.exports = { BUILD_STATE, renderBuildState };
