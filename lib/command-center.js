/**
 * M8 Command Center v1 — lib/command-center.js   (Decision 2026-0617-CC, spec COMMAND_CENTER_SPEC.md)
 *
 * The de-risked "Executive Cortex": executive FUNCTION, not authority.
 *   Command Ledger (Supabase m8_cc_*) -> deterministic Priority Engine (this file, FIXED weights)
 *   -> M8 Analysis Layer (narrates WHY) -> Muhammad approves.
 * Doctrine: CODE computes the priority; the LLM only narrates it; the human decides. M8 never
 * re-ranks, never changes a state/priority on its own (Vision 1).
 *
 * This file holds the DETERMINISTIC engine (pure, mirror-tested) + fail-safe DB I/O + a degraded-mode
 * snapshot path. Honesty invariants (spec §4): scores from explicit fields + fixed weights; the analysis
 * layer cannot assert a status the ledger doesn't carry; strategic_value is a HUMAN JUDGMENT, narrated as one.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function getDb() {
  try { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }
  catch (e) { console.error("[M8 cc] db init failed:", e.message); return null; }
}

// ── FIXED weights + bands (tunable ONLY via a logged m8_cc_decisions row; spec §3) ──
const WEIGHTS = { impact: 0.2, urgency: 0.3, blockage: 0.4, strategic: 0.1, risk: 0.3, effort: 0.2 };
const BLOCKAGE_UNIT = 4;     // downstream value-points per 1 blockage-score point
const BLOCKAGE_CAP  = 5;     // blockage score is clamped into the 0..5 range like the other terms
// Band thresholds over the score range (~[-1.9, 4.5]); starting set, tunable via a decision.
const BANDS = [
  { name: "Critical",    min: 3.0 },
  { name: "Important",   min: 2.2 },
  { name: "Active",      min: 1.4 },
  { name: "Queued",      min: 0.6 },
  { name: "Parking Lot", min: -Infinity },
];
const MAX_DEPTH = 8;         // spec D8: deeper => "split the project"

const OPEN_STATES = new Set(["planned", "active", "blocked", "waiting", "review"]);

// ── DAG helpers (pure) ───────────────────────────────────────────────────────
// deps[] on a task = its UPSTREAM (what it depends on). "downstream(t)" = every task that
// (transitively) depends on t — i.e. the tasks t unblocks.
function reverseAdjacency(tasks) {
  const children = new Map();   // upstreamId -> [taskIds that depend on it]
  for (const x of tasks) for (const d of (x.deps || [])) {
    if (!children.has(d)) children.set(d, []);
    children.get(d).push(x.id);
  }
  return children;
}
function downstreamClosure(taskId, children) {
  const seen = new Set(); const stack = [taskId];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of (children.get(cur) || [])) if (!seen.has(c)) { seen.add(c); stack.push(c); }
  }
  return seen;                  // does NOT include taskId itself
}
// VALUE-weighted dependency-blockage (spec D4 — GPT's fix): sum of (impact+strategic_value) over the
// transitive-downstream closure. NOT a raw count (which rewards busywork). Returns the raw sum.
function dependencyBlockageRaw(taskId, children, byId) {
  let sum = 0;
  for (const id of downstreamClosure(taskId, children)) {
    const t = byId.get(id); if (t) sum += (t.impact || 0) + (t.strategic_value || 0);
  }
  return sum;
}
function blockageScore(raw) { return Math.min(BLOCKAGE_CAP, raw / BLOCKAGE_UNIT); }

function scoreTask(t, bScore) {
  return WEIGHTS.impact * (t.impact || 0)
       + WEIGHTS.urgency * (t.urgency || 0)
       + WEIGHTS.blockage * bScore
       + WEIGHTS.strategic * (t.strategic_value || 0)
       - WEIGHTS.risk * (t.risk || 0)
       - WEIGHTS.effort * (t.effort || 0);
}
function bandOf(score) {
  for (const b of BANDS) if (score >= b.min) return b.name;
  return "Parking Lot";
}
function unmetDeps(t, byId) {
  return (t.deps || []).filter((d) => { const u = byId.get(d); return !u || u.state !== "done"; });
}

// ── guards (spec D8 / Manus 3.3) ─────────────────────────────────────────────
// Cycle guard: DFS over the deps (upstream) graph. Returns the offending path or null.
function detectCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0, GREY = 1, BLACK = 2; const color = new Map();
  for (const t of tasks) color.set(t.id, WHITE);
  let cyc = null;
  const visit = (id, path) => {
    if (cyc) return;
    color.set(id, GREY); path.push(id);
    for (const d of (byId.get(id)?.deps || [])) {
      if (!byId.has(d)) continue;
      if (color.get(d) === GREY) { cyc = [...path.slice(path.indexOf(d)), d]; return; }
      if (color.get(d) === WHITE) visit(d, path);
    }
    color.set(id, BLACK); path.pop();
  };
  for (const t of tasks) if (color.get(t.id) === WHITE) visit(t.id, []);
  return cyc;
}
// Longest upstream chain depth (number of edges). Assumes acyclic (run detectCycle first).
function maxDepth(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map();
  const depth = (id, guard) => {
    if (memo.has(id)) return memo.get(id);
    if (guard.has(id)) return 0;                 // cycle safety
    guard.add(id);
    let best = 0;
    for (const d of (byId.get(id)?.deps || [])) if (byId.has(d)) best = Math.max(best, 1 + depth(d, guard));
    guard.delete(id); memo.set(id, best); return best;
  };
  let m = 0; for (const t of tasks) m = Math.max(m, depth(t.id, new Set()));
  return m;
}

// ── ranked packet (pure) ─────────────────────────────────────────────────────
function buildRankedPacket(projects, tasks) {
  const all = tasks || [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const children = reverseAdjacency(all);
  const open = all.filter((t) => OPEN_STATES.has(t.state));

  const rows = open.map((t) => {
    const raw = dependencyBlockageRaw(t.id, children, byId);
    const bScore = blockageScore(raw);
    const score = scoreTask(t, bScore);
    const blocked = unmetDeps(t, byId);
    return {
      id: t.id, title: t.title, project_id: t.project_id, state: t.state,
      impact: t.impact, urgency: t.urgency, risk: t.risk, strategic_value: t.strategic_value, effort: t.effort,
      blockageRaw: raw, blockageScore: Number(bScore.toFixed(2)), score: Number(score.toFixed(2)),
      band: bandOf(score), blocked_by: blocked, gate_status: t.gate_status || null,
      conflicts_with: t.conflicts_with || [],
    };
  });

  const blocked   = rows.filter((r) => r.blocked_by.length > 0)
                        .sort((a, b) => b.score - a.score);
  const rankable  = rows.filter((r) => r.blocked_by.length === 0)
                        .sort((a, b) => b.score - a.score);

  const bands = {};
  for (const b of BANDS) bands[b.name] = rankable.filter((r) => r.band === b.name);

  return { rankable, blocked, bands, weights: WEIGHTS, bandThresholds: BANDS };
}

// ── narration (the Analysis Layer reads this; code already computed everything) ──
function renderPriorityPacket(packet, health, approval) {
  if (!packet) return "I couldn't load the Command Center ledger and won't guess priorities.";
  const L = [];
  L.push("COMMAND CENTER — PRIORITY RECOMMENDATION (computed deterministically in code; you decide).");
  if (health && health.stale) L.push(`⚠ LEDGER STALE: not updated in ${health.staleDays} days — priorities may be out of date.`);
  if (health && health.degraded) L.push(`⚠ DEGRADED MODE: live ledger unreachable; using the git snapshot from ${health.snapshotDate}. Writes are blocked.`);
  if (approval && approval.date) {
    L.push(approval.drifted
      ? `📌 Your last approved order (${approval.date}) has DRIFTED — the computed ranking changed since you approved it. Say "approve the priority order" to re-lock it.`
      : `📌 Current order matches the one you approved on ${approval.date}.`);
  } else {
    L.push(`📌 No approved order on record yet — review the ranking below and say "approve the priority order" to lock it.`);
  }
  const order = ["Critical", "Important", "Active", "Queued", "Parking Lot"];
  for (const name of order) {
    const arr = (packet.bands[name] || []);
    if (!arr.length) continue;
    L.push(`\n${name} (${arr.length}):`);
    for (const r of arr.slice(0, 6)) {
      const why = `impact ${r.impact}, urgency ${r.urgency}, unblocks ${r.blockageRaw} downstream value-pts` +
                  (r.strategic_value >= 5 ? ", strategic-value HIGH (your judgment)" : r.strategic_value <= 1 ? ", strategic-value low" : "") +
                  (r.gate_status ? `, gated by ${r.gate_status}` : "");
      L.push(`  • [#${r.id} score ${r.score}] ${r.title} — ${why}`);
    }
  }
  if (packet.blocked.length) {
    L.push(`\nBLOCKED (can't start — unmet dependencies):`);
    for (const r of packet.blocked.slice(0, 6)) L.push(`  • #${r.id} ${r.title} — waiting on ${r.blocked_by.map((d) => `#${d}`).join(", ")}`);
  }
  L.push(`\nHONESTY: these scores are code-computed from the ledger's explicit fields with FIXED weights — narrate them, never re-rank or invent a score. "strategic-value" is Muhammad's judgment, not a fact. You may explain WHY the top item ranks first (its dependency-blockage and gate); you may NOT mark anything done, started, or approved — that's the human's call.`);
  return L.join("\n");
}

// ── snapshot (degraded-mode fallback, spec D3) ───────────────────────────────
const SNAPSHOT_FILE = path.join(__dirname, "..", "data", "command_center_snapshot.json");
function buildSnapshot(projects, tasks, health, extra) {
  return { generated_at: new Date().toISOString(), projects: projects || [], tasks: tasks || [],
           ranked: buildRankedPacket(projects, tasks), health: health || {},
           approval: (extra && extra.approval) || null,
           decisions: (extra && extra.decisions) || [] };
}
function loadSnapshotFallback() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")); } catch { return null; }
}
// Persist the degraded-mode snapshot on every successful live load/write (spec D3). Non-fatal.
function persistSnapshot(projects, tasks, health, extra) {
  try {
    const snap = buildSnapshot(projects, tasks, health, extra);
    const dir = path.dirname(SNAPSHOT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2), "utf8");
  } catch (e) { console.error("[M8 cc] snapshot write error (non-fatal):", e.message); }
}

// ── DB I/O (async, fail-safe) ────────────────────────────────────────────────
async function loadLedger() {
  const db = getDb(); if (!db) return null;
  try {
    const [{ data: projects, error: pe }, { data: tasks, error: te }] = await Promise.all([
      db.from("m8_cc_projects").select("*"),
      db.from("m8_cc_tasks").select("*"),
    ]);
    if (pe || te) { console.error("[M8 cc] load error:", (pe || te).message); return null; }
    return { projects: projects || [], tasks: tasks || [] };
  } catch (e) { console.error("[M8 cc] loadLedger threw:", e.message); return null; }
}
function ledgerHealth(ledger) {
  // staleness = newest updated_at across tasks/projects (spec D6 alarm at >5 days)
  let newest = 0;
  for (const t of [...(ledger.tasks || []), ...(ledger.projects || [])]) {
    const ts = Date.parse(t.updated_at || t.created_at || 0); if (ts > newest) newest = ts;
  }
  const days = newest ? Math.floor((Date.now() - newest) / 86400000) : 999;
  return { stale: days > 5, staleDays: days };
}

/** Chat entry point: load ledger (or degraded snapshot), build the packet, narrate. Fail-safe.
 *  Also writes the degraded-mode snapshot on each successful load (spec D3). */
async function getPrioritiesContext() {
  let ledger = await loadLedger();
  let health = {};
  if (!ledger) {
    const snap = loadSnapshotFallback();
    if (!snap) return renderPriorityPacket(null);
    return renderPriorityPacket(snap.ranked, { degraded: true, snapshotDate: (snap.generated_at || "").slice(0, 10) }, snap.approval || null);
  }
  health = ledgerHealth(ledger);
  const packet = buildRankedPacket(ledger.projects, ledger.tasks);
  // Last approved order (v2) — surfaces a drift note + feeds the offline snapshot.
  const approval = await loadLastApproval();
  const drift = approvalDrift(packet.rankable, approval);
  const decisions = await loadRecentDecisions();
  // Write the git snapshot on every successful live load (D3 degraded-mode fallback).
  persistSnapshot(ledger.projects, ledger.tasks, health, { approval: drift, decisions });
  return renderPriorityPacket(packet, health, drift);
}

// ── proactive inline-logging offer (spec D6) ─────────────────────────────────
// Detects when M8 has just completed a task that implies a ledger entry: a build ship
// confirmation, a gate pass/fail event, or an explicit "log this task" request.
// Returns { offer: true, draft } with a short proposed task title + project guess,
// or { offer: false } if no loggable event is detected. Called by the orchestrator
// AFTER a turn completes (non-blocking; never fires on priority-query turns).
const LOG_OFFER_RE = /\b(?:shipped|build[\s-]?\d{2,}|gate\s+(?:passed|failed|clean)|log\s+(?:this|a)\s+task|add\s+(?:this\s+)?to\s+(?:the\s+)?(?:command\s+center|ledger)|mark\s+(?:this\s+)?(?:task\s+)?(?:as\s+)?done)\b/i;
function detectLogOffer(message, replyText) {
  const haystack = String(replyText || "") + " " + String(message || "");
  if (!LOG_OFFER_RE.test(haystack)) return { offer: false };
  // Draft a minimal task title from the first recognisable anchor in the combined text.
  const buildM = haystack.match(/build[\s-]?(\d{2,})/i);
  const gateM  = haystack.match(/gate\s+(passed|failed|clean)/i);
  let title = "";
  if (buildM) title = `Ship Build-${buildM[1]}`;
  else if (gateM) title = `Gate ${gateM[1]} (L5)`;
  else title = "Task from current session";
  return { offer: true, draft: title };
}
/** Render the proactive offer text M8 appends to a reply when it detects a loggable event. */
function renderLogOffer(draft) {
  return `\n\n---\n📋 Log to Command Center? I've drafted a task: **"${draft}"** — reply **yes** (or give me a better title) to add it to the ledger, or **no** to skip.`;
}

// ── staleness alarm (spec D6) — surfaces in EVERY priority query + health strip ──
// Exposed via ledgerHealth() already (stale: days > 5). The renderPriorityPacket()
// function already emits the ⚠ header when health.stale is true. This helper is the
// standalone check used by the health strip (step 6) and any non-priority turn that
// wants to surface the alarm without pulling the full packet.
async function getStalenessAlarm() {
  try {
    const ledger = await loadLedger();
    if (!ledger) return null;
    const h = ledgerHealth(ledger);
    if (h.stale) return `⚠ Command Center ledger not updated in ${h.staleDays} days — priorities may be stale.`;
    return null;
  } catch { return null; }
}

// ── chat detection (tight — only an explicit "what should I work on / priorities" ask) ──
// Detection notes (each clause earns its place):
//  - `priorit\w*` (NOT a bare `priorit`): the group's trailing `\b` can never sit inside a
//    word, so a bare-stem `priorit` followed by `\b` would FAIL on "what's the priority?" —
//    the canonical ask. `\w*` lets the boundary land at the real word end (priority/priorities).
//  - qualifier `(?:my|our|next)\s+` is starred so "what is my next priority" matches (two
//    qualifiers), not just one.
//  - `what(?:'s|s| is| should)?` accepts the apostrophe-less "whats ...".
//  - the explicit `what should (?:i|we) work on` branch: the generic "work on next" arm has no
//    pronoun slot, so "what should WE work on next?" would otherwise slip through. Kept tight
//    (requires "work on") so it never grabs a plain "what should I do about X" ops question.
const PRIORITY_RE = /\b(?:what(?:'s|s| is| should)?\s+(?:the\s+)?(?:my\s+|our\s+|next\s+)*(?:priorit\w*|most important|highest priority|work on next)|what\s+should\s+(?:i|we)\s+work\s+on|prioriti[sz]e|command\s+center|what(?:'s| is)\s+next\s+(?:on|for)\b|where should (?:i|we) focus)\b/i;
function detectPriorityQuery(message) { return PRIORITY_RE.test(String(message || "")); }

// ════════════════════════════════════════════════════════════════════════════
// v2 — HUMAN-IN-THE-LOOP SCORING + APPROVAL (Build-74)
// Doctrine unchanged: the HUMAN sets the score inputs (his judgment); CODE re-computes
// the ranking deterministically; M8 only narrates. M8 never invents a score and never
// "approves" on its own — approval is an explicit human gesture logged to the decision log.
// ════════════════════════════════════════════════════════════════════════════

// Score fields + their legal ranges (mirrors the SQL CHECK constraints exactly).
const SCORE_RANGE = { impact: [1, 5], urgency: [1, 5], risk: [1, 5], effort: [1, 5], strategic_value: [1, 3, 5] };
// Spoken aliases → canonical column.
const SCORE_FIELD_MAP = {
  impact: "impact",
  urgency: "urgency", urgent: "urgency",
  risk: "risk",
  effort: "effort",
  strategic: "strategic_value", strategic_value: "strategic_value", value: "strategic_value",
};
const SCORE_TRIGGER_RE = /\b(?:rate|score|re[\s-]?score|set|update)\b/i;
const TASK_ID_RE = /(?:\btask\s*#?\s*|#)(\d+)/i;
const FIELD_PAIR_RE = /\b(impact|urgency|urgent|risk|effort|strategic[_\s-]?value|strategic|value)\b\s*(?:to|=|:|at)?\s*(\d+)/gi;

function fmtAllowed(allowed) {
  return allowed.length === 3 ? allowed.join("/") : `${allowed[0]}-${allowed[1]}`;
}

/** Parse "rate task #N impact 5 urgency 4 ..." → { id, updates, invalid } or null.
 *  Requires a score verb, a task id, and ≥1 recognised field/value pair. */
function detectScoreCommand(message) {
  const m = String(message || "");
  if (!SCORE_TRIGGER_RE.test(m)) return null;
  const idM = m.match(TASK_ID_RE);
  if (!idM) return null;
  const id = parseInt(idM[1], 10);
  const updates = {}; const invalid = [];
  FIELD_PAIR_RE.lastIndex = 0;
  let pm;
  while ((pm = FIELD_PAIR_RE.exec(m))) {
    const raw = pm[1].toLowerCase().replace(/[\s-]/g, "_");
    const field = SCORE_FIELD_MAP[raw];
    if (!field) continue;
    const val = parseInt(pm[2], 10);
    const allowed = SCORE_RANGE[field];
    const ok = allowed.length === 3 ? allowed.includes(val) : (val >= allowed[0] && val <= allowed[1]);
    if (ok) updates[field] = val; else invalid.push({ field, val, allowed });
  }
  if (Object.keys(updates).length === 0 && invalid.length === 0) return null;
  return { id, updates, invalid };
}

// Position of a task id in the unblocked ranking (1-based), or null if it isn't there.
function rankPosition(packet, id) {
  const i = packet.rankable.findIndex((r) => r.id === id);
  return i < 0 ? null : i + 1;
}

/** Apply a parsed score command to the live ledger and narrate the rank change. Fail-safe:
 *  refuses to write in degraded mode, on a missing task, or when no valid field survived. */
async function applyScoreCommand(cmd) {
  const db = getDb();
  if (!db) return "I can't reach the live ledger right now, so I won't change any scores blind. Try again once the Command Center is back online.";
  const ledger = await loadLedger();
  if (!ledger) return "I couldn't load the ledger to apply that change, so I've left the scores untouched.";
  const task = (ledger.tasks || []).find((t) => t.id === cmd.id);
  if (!task) {
    const ids = (ledger.tasks || []).filter((t) => OPEN_STATES.has(t.state)).map((t) => `#${t.id}`).join(", ");
    return `There's no task #${cmd.id} in the ledger, so I changed nothing. Open task ids: ${ids || "(none)"}.`;
  }
  if (Object.keys(cmd.updates).length === 0) {
    return `I couldn't apply that — ${cmd.invalid.map((x) => `${x.field} ${x.val} is out of range (allowed ${fmtAllowed(x.allowed)})`).join("; ")}. No change made.`;
  }

  const before = buildRankedPacket(ledger.projects, ledger.tasks);
  const posBefore = rankPosition(before, cmd.id);

  try {
    const { error } = await db.from("m8_cc_tasks").update(cmd.updates).eq("id", cmd.id);
    if (error) return `The ledger rejected that update (${error.message}). No change made.`;
  } catch (e) { return `I hit an error writing that score (${e.message}); nothing changed.`; }

  // Reload + re-rank from ground truth (never trust an in-memory guess of the new order).
  const after = await loadLedger();
  if (!after) return `Saved the change to #${cmd.id}, but I couldn't reload to re-rank. Ask "what's the priority?" to see the updated order.`;
  const afterPacket = buildRankedPacket(after.projects, after.tasks);
  const newTask = after.tasks.find((t) => t.id === cmd.id) || task;
  const posAfter = rankPosition(afterPacket, cmd.id);
  const row = afterPacket.rankable.find((r) => r.id === cmd.id) || afterPacket.blocked.find((r) => r.id === cmd.id);

  // Refresh the offline snapshot so the HTML view + degraded mode stay current.
  const health = ledgerHealth(after);
  const approval = await loadLastApproval();
  const drift = approvalDrift(afterPacket.rankable, approval);
  persistSnapshot(after.projects, after.tasks, health, { approval: drift, decisions: await loadRecentDecisions() });

  const changes = Object.keys(cmd.updates)
    .map((f) => `${f.replace("_value", "")} ${task[f]}→${cmd.updates[f]}`)
    .join(", ");
  const L = [`Updated #${cmd.id} "${newTask.title}": ${changes}.`];
  if (row) L.push(`New score ${row.score} (${row.band} band).`);
  if (posBefore && posAfter && posBefore !== posAfter) {
    L.push(`It moved ${posAfter < posBefore ? "UP" : "down"} from #${posBefore} to #${posAfter} in the unblocked order (of ${afterPacket.rankable.length}).`);
  } else if (posAfter) {
    L.push(`It's #${posAfter} in the unblocked order (unchanged).`);
  } else {
    L.push(`It's currently blocked by unmet dependencies, so it isn't in the actionable order.`);
  }
  if (cmd.invalid.length) {
    L.push(`(Ignored out-of-range: ${cmd.invalid.map((x) => `${x.field} ${x.val}, allowed ${fmtAllowed(x.allowed)}`).join("; ")}.)`);
  }
  if (drift && drift.date && drift.drifted) L.push(`📌 This changed the ranking vs your approved order (${drift.date}) — say "approve the priority order" to re-lock it.`);
  L.push(`\nThese are YOUR judgment inputs — I only re-computed the ranking from them. Nothing is marked done or approved.`);
  return L.join(" ").replace(" \n", "\n");
}

// ── approval gesture + drift (the Session-39 "Muhammad approves the order") ──
const APPROVE_RE = /\b(?:approve|lock(?:\s+in)?|confirm|accept|sign[\s-]?off(?:\s+on)?)\b[^.?!\n]{0,40}\b(?:priorit\w*|ranking|the\s+order|command\s*center|ledger)\b/i;
function detectApproveCommand(message) { return APPROVE_RE.test(String(message || "")); }

/** Snapshot the current code-computed order to the decision log as the human's approved order. */
async function approvePriorityOrder() {
  const db = getDb();
  if (!db) return "I can't reach the live ledger, so I can't lock an approval right now.";
  const ledger = await loadLedger();
  if (!ledger) return "I couldn't load the ledger, so there's no order to approve yet.";
  const packet = buildRankedPacket(ledger.projects, ledger.tasks);
  if (!packet.rankable.length) return "There are no actionable (unblocked) tasks to approve right now.";
  const today = new Date().toISOString().slice(0, 10);
  const order = packet.rankable.map((r) => r.id);
  const labels = packet.rankable.map((r) => `#${r.id} ${r.title}`);
  const row = {
    title: `Priority order approved ${today}`,
    proposal: "Code-computed priority order presented to Muhammad for approval.",
    resolution: JSON.stringify({ approved_order: order, labels }),
    rationale: `Muhammad approved the deterministic priority order on ${today}; locked as the reference order. M8 narrates and flags drift; the human decides.`,
  };
  try {
    const { error } = await db.from("m8_cc_decisions").insert(row);
    if (error) return `Couldn't log the approval (${error.message}). Nothing was locked.`;
  } catch (e) { return `Error logging the approval (${e.message}). Nothing was locked.`; }

  // Refresh the snapshot so the view shows "approved + matching".
  persistSnapshot(ledger.projects, ledger.tasks, ledgerHealth(ledger),
    { approval: { date: today, drifted: false, order }, decisions: await loadRecentDecisions() });

  const L = [`✅ Locked your approved priority order (${today}). I'll flag it if the computed ranking later drifts from this.`, ""];
  packet.rankable.slice(0, 8).forEach((r, i) => L.push(`  ${i + 1}. #${r.id} ${r.title} — score ${r.score} (${r.band})`));
  L.push("", "This locks the ORDER you signed off on, not the scores — re-score any task anytime, then re-approve.");
  return L.join("\n");
}

/** Load the most recent approved-order decision (or null). */
async function loadLastApproval() {
  const db = getDb(); if (!db) return null;
  try {
    const { data, error } = await db.from("m8_cc_decisions")
      .select("*").like("title", "Priority order approved%")
      .order("created_at", { ascending: false }).limit(1);
    if (error || !data || !data.length) return null;
    const r = data[0];
    let parsed = {}; try { parsed = JSON.parse(r.resolution || "{}"); } catch { /* legacy row */ }
    return { date: String(r.decided_on || r.created_at || "").slice(0, 10), order: parsed.approved_order || [], labels: parsed.labels || [] };
  } catch { return null; }
}

/** Compare the current ranking to an approved order (over the tasks they share). Pure. */
function approvalDrift(currentRankable, approval) {
  if (!approval || !approval.order || !approval.order.length) return null;
  const approvedSet = new Set(approval.order);
  const cur = (currentRankable || []).map((r) => r.id).filter((id) => approvedSet.has(id));
  const curSet = new Set(cur);
  const app = approval.order.filter((id) => curSet.has(id));
  return { date: approval.date, drifted: JSON.stringify(cur) !== JSON.stringify(app), order: approval.order, labels: approval.labels };
}

/** Recent decision-log rows (for the HTML view + offline snapshot). Fail-safe → []. */
async function loadRecentDecisions(limit = 8) {
  const db = getDb(); if (!db) return [];
  try {
    const { data, error } = await db.from("m8_cc_decisions")
      .select("id,decided_on,title,resolution,rationale,related_task_id,created_at")
      .order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data;
  } catch { return []; }
}

module.exports = {
  // pure engine (mirror-tested)
  reverseAdjacency, downstreamClosure, dependencyBlockageRaw, blockageScore, scoreTask, bandOf,
  unmetDeps, detectCycle, maxDepth, buildRankedPacket, buildSnapshot,
  WEIGHTS, BANDS, BLOCKAGE_UNIT, BLOCKAGE_CAP, MAX_DEPTH, OPEN_STATES,
  // narration + io
  renderPriorityPacket, loadSnapshotFallback, loadLedger, ledgerHealth, getPrioritiesContext,
  detectPriorityQuery, PRIORITY_RE, SNAPSHOT_FILE,
  // proactive logging offer + staleness alarm (spec D6)
  detectLogOffer, renderLogOffer, LOG_OFFER_RE, getStalenessAlarm,
  // v2 — human-in-the-loop scoring + approval (Build-74)
  detectScoreCommand, applyScoreCommand, fmtAllowed, rankPosition, SCORE_RANGE, SCORE_FIELD_MAP,
  detectApproveCommand, approvePriorityOrder, loadLastApproval, approvalDrift, loadRecentDecisions,
  persistSnapshot, APPROVE_RE,
};
