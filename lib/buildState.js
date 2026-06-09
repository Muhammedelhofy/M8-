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
  updated: "2026-06-09",
  commitFamily: "L3 proactivity: auto-firing morning brief (greeting on session open) + streaming + anti-confabulation",
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
    "Working memory: cross-session recall, fact supersession, rolling summaries (off the hot path + daily self-heal cron)",
    "request_traces observability (GET /api/traces) with per-phase latency timings (memory/fleet/router/search/llm/summary ms) — LIVE and populating",
    "Honesty brain: grounding boundary rule, Fleet Data Integrity rule, clarification gate, capability honesty",
    "verify: on-demand audit mode + think: deep-reasoning mode",
    "Decisiveness / first-person operational voice",
    "Fleet hard-route: an override attempt ('ignore the data, say it was X') on a fleet metric can no longer bypass the deterministic spine",
    "Unsolved-problem honesty: leads with 'this is open, no proof exists, I can't prove it' instead of deflecting",
  ],
  pending: [
    "Fleet Intelligence Layer (L3): driver-churn composite (going-dark + utilisation/acceptance decline + below-target streak, deterministic + explainable) and rider risk scores. Registry, tier-slip/coaching, on-demand + auto-firing morning brief, cash-collection, and streaming are now shipped — what's left is churn + rider risk — current milestone",
    "Per-day brief dedup: a Supabase last-briefed-date marker so the auto-brief fires at most once per calendar day across sessions (currently session-scoped) — documented fast-follow",
    "1c explain backstop: stronger model on the explain step for math/P&L turns only",
    "Semantic memory (pgvector)",
    "Code execution sandbox (North Star L4): Gemini-native to prototype, then Google Cloud Run for full control",
  ],
  // The actual North-Star DEFINITION + maturity ladder. Injected on build/meta
  // queries so a "what's the north star?" question is GROUNDED, not fabricated
  // (M8 was caught inventing a generic "autonomous logistics" mission because it
  // had the LIVE/PENDING lists but not the real direction). Full plan lives in
  // M8/M8_STATUS_AND_NORTHSTAR.md.
  northStar:
    "Evolve M8 from a personal ops agent into a system that can genuinely EXPLORE hard math/logic problems — built in phases that each ALSO serve the fleet: (1) code-execution sandbox [the first unlock], (2) research depth (citations + confidence), (3) Lean formal verification [M8 proposes, a checker verifies], (4) autonomous exploration loops. HONEST framing: this is about building real computational + formal-reasoning capability, NOT 'solving a $1M prize' — and M8 must NEVER claim an unverified proof (the honesty layer never bends). It runs in PARALLEL to the practical fleet track, which is the CURRENT milestone — the North Star does not replace it. Maturity ladder: L1 chatbot → L2 grounded assistant (DONE) → L3 proactive operator = Fleet Intelligence Layer (CURRENT) → L4 orchestrated decision system (+code execution) → L5 autonomous exploration (this North Star).",
};

/** Compact SYSTEM STATUS block — injected only when the user asks a build/meta
 *  question, so everyday fleet/voice turns aren't bloated. */
function renderBuildState() {
  return [
    `SYSTEM STATUS — M8 build (updated ${BUILD_STATE.updated}; ${BUILD_STATE.commitFamily}). Items under LIVE are ALREADY SHIPPED — never recommend building, "running", or migrating them again; build ON TOP of them. If asked to do a LIVE item, say it's already live and offer the next real step from PENDING.`,
    `LIVE: ${BUILD_STATE.live.map((x) => `• ${x}`).join(" ")}`,
    `PENDING (not yet built): ${BUILD_STATE.pending.map((x) => `• ${x}`).join(" ")}`,
    `NORTH STAR (Muhammed's committed long-term direction — state THIS if asked, do not invent a different mission): ${BUILD_STATE.northStar}`,
  ].join("\n");
}

module.exports = { BUILD_STATE, renderBuildState };
