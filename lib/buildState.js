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
  updated: "2026-06-08",
  commitFamily: "L3: registry + tier-slip + brief + cash (+ live-fix: brief routing & name ambiguity)",
  live: [
    "Deterministic fleet spine (lib/fleet.js): single day, explicit ranges, weekly/monthly rollups, week-over-week & day-over-day trends, anomaly flags, single- AND multi-driver lookup",
    "Known-driver registry + fleet-gate fix: a driver-name query with no fleet keyword and no prior fleet context ('compare ALI and Mansour' in a fresh session) now routes to the deterministic spine instead of bleeding into a web search; arbitrary compare targets ('iPhone vs Samsung') still go to search. An AMBIGUOUS first name shared by two drivers (e.g. two 'Ali's) is surfaced for disambiguation — never silently resolved to one",
    "Fleet routing beats doc-gen: 'give me the morning brief / fleet report' no longer gets hijacked into a generic document (the DOC intent's brief/report/summary nouns used to collide with fleet phrasings)",
    "Tier-slip watch + coaching (on-demand): 'who slipped / who needs coaching' returns a deterministic list of drivers whose Bolt tier-level actually fell, plus a 'watch' list (still at tier but weak on acceptance/finish), with the real weak metric per driver — never an invented Bolt threshold",
    "Morning / exec brief (on-demand): 'give me the morning brief / state of the fleet' assembles one spoken exec summary from the spine — most-recent-complete-day net + trend, top performers, attention flags, tier slips, cash gap, and week-to-date context; deterministic, LLM narrates only",
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
    "Fleet Intelligence Layer (L3): rider risk scores + the genuinely AUTO-firing/scheduled brief (registry, tier-slip/coaching, on-demand morning brief, and cash-collection are now shipped; what's left is auto-triggering + rider risk) — current milestone",
    "1c explain backstop: stronger model on the explain step for math/P&L turns only",
    "Semantic memory (pgvector)",
    "Code execution sandbox (North Star L4): Gemini-native to prototype, then Google Cloud Run for full control",
  ],
};

/** Compact SYSTEM STATUS block — injected only when the user asks a build/meta
 *  question, so everyday fleet/voice turns aren't bloated. */
function renderBuildState() {
  return [
    `SYSTEM STATUS — M8 build (updated ${BUILD_STATE.updated}; ${BUILD_STATE.commitFamily}). Items under LIVE are ALREADY SHIPPED — never recommend building, "running", or migrating them again; build ON TOP of them. If asked to do a LIVE item, say it's already live and offer the next real step from PENDING.`,
    `LIVE: ${BUILD_STATE.live.map((x) => `• ${x}`).join(" ")}`,
    `PENDING (not yet built): ${BUILD_STATE.pending.map((x) => `• ${x}`).join(" ")}`,
  ].join("\n");
}

module.exports = { BUILD_STATE, renderBuildState };
