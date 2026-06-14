/**
 * M8 L5 — Autonomous Exploration Loop  (Build-19, rung 10 — the LAST rung)
 *
 * A budgeted, two-phase DAILY cron that runs the existing lanes unattended:
 *   PHASE A (runObservePhase, /api/cron-explore 01:00):
 *     step 0  warmup ping  -> leanHealth() starts the ~9.5min Mathlib import
 *     step 1  M1 observe   -> (optional; M3 recomputes the feature table internally)
 *     step 2  M3 test      -> runConjectureGen({seed: SEED_BASE+dayIndex}) — PURE CODE, NO LLM
 *     step 3  M3.1 queue   -> upsertQueueItems (dedup => new_survivors)
 *     step 4  record       -> m8_loop_runs row
 *   PHASE B (runVerifyPhase, /api/cron-verify 01:15 — 15min later, warm window):
 *     step 0  /health gate -> cold => skip M4, run still counts
 *     step 1  re-check     -> recheckScaffold on a HUMAN-architected scaffold (re-submits
 *                            ALREADY-DRAFTED leaf code; NO re-draft, NO LLM) — the cold-start payoff
 *     step 2  update row + recompute the promotion gate
 *
 * THE HONESTY STORY (BUILD_19_SPEC §0.1, load-bearing): this module invokes NO LLM.
 * runConjectureGen / upsertQueueItems / recheckScaffold / buildDigest /
 * evaluatePromotionGate are all deterministic / code-owned. Autonomy adds ZERO new
 * narration surface — every human-facing word about a loop result is produced later,
 * on demand, through the existing already-Odysseus-guarded recall lanes. Narration
 * <= evidence is preserved by construction, not by a new prompt.
 *
 * PROMOTION GATE (deterministic, no judge): 3 consecutive run_status='ok' rows each
 * with m3_gate_pass AND survivors_persisted>=1 AND a fresh clean Odysseus attestation.
 * "Promoted" certifies the LOOP is STABLE — NEVER that any conjecture is proven/novel.
 *
 * Fails SAFE everywhere (mirrors review-queue.js / lemma-dag.js): any error logs and
 * degrades the run; nothing here throws into the cron handler. Kill: L5_LOOP_DISABLED=1.
 */
const { createClient } = require("@supabase/supabase-js");
const { runConjectureGen } = require("./conjecture-gen");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
const RUNS_TABLE = "m8_loop_runs";
const ODY_TABLE  = "m8_odysseus_runs";
const LOOP_VERSION = 1;

// ── tunables (FIXED in code; a couple are env-overridable for ops, not per-run) ──
const SEED_BASE          = parseInt(process.env.L5_SEED_BASE || "20260601", 10);
const DEFAULT_BOUND      = parseInt(process.env.L5_BOUND || "100000", 10);
const BACKOFF_K          = 5;     // consecutive zero-progress runs => pause generation
const CLEAN_RUN_TARGET   = 3;     // promotion: 3 consecutive clean unattended runs
const ATTEST_FRESH_HOURS = 24;    // an Odysseus attestation counts if within this of the run
const LEAN_LOOP_CHECK_CAP = parseInt(process.env.LEAN_LOOP_CHECK_CAP || "6", 10);

// ════════════════════════════════════════════════════════════════════
// PURE CORE — the PS-mirror-tested logic (no I/O, deterministic, sync)
// ════════════════════════════════════════════════════════════════════

/** Days since the UNIX epoch (UTC) for a 'YYYY-MM-DD' date string. */
function dayIndex(runDate) {
  const ms = Date.parse(String(runDate) + "T00:00:00Z");
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : 0;
}

/** Per-run seed = SEED_BASE + dayIndex. Recorded => the run is replayable, while
 *  each night explores a fresh slice (the §0.5 anti-spam rule). */
function nextSeed(runDate, base = SEED_BASE) {
  return (base + dayIndex(runDate)) >>> 0;
}

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }

/**
 * Deterministic regression diff vs a frozen baseline {probeId: pass-bool}.
 * A regression = a probe TRUE in baseline and FALSE now. A net-new probe failing
 * (absent from baseline) is FLAGGED but is NOT a regression. Pure.
 */
function diffRegressions(baseline, current) {
  const b = baseline || {}, c = current || {};
  const regressions = [];
  for (const id of Object.keys(b)) {
    if (b[id] === true && c[id] === false) regressions.push({ probeId: id, baseline: true, now: false });
  }
  const newFails = [];
  for (const id of Object.keys(c)) {
    if (!(id in b) && c[id] === false) newFails.push(id);
  }
  return { regressions, newFails };
}

/**
 * The PROMOTION GATE over rows ordered NEWEST-FIRST. Each row must carry
 * run_status, m3_gate_pass, survivors_persisted, odysseus_pass, odysseus_fresh.
 * Counts consecutive CLEAN runs from the newest; ANY non-clean row breaks the
 * streak. Pure, deterministic — this is the whole gate, no judge. (BUILD_19_SPEC §0.6)
 */
function evaluatePromotionGate(rows, opts = {}) {
  const target = opts.target || CLEAN_RUN_TARGET;
  let clean = 0;
  for (const r of rows || []) {
    const ok = r.run_status === "ok"
      && r.m3_gate_pass === true
      && (r.survivors_persisted || 0) >= 1
      && r.odysseus_pass === true
      && r.odysseus_fresh === true;
    if (ok) clean++; else break;
  }
  return { promoted: clean >= target, consecutiveClean: clean, target };
}

/** How many of the newest rows are failed/degraded in a row (silent-death alert). */
function countLeadingFailures(rows) {
  let n = 0;
  for (const r of rows || []) {
    if (r.run_status === "failed" || r.run_status === "degraded") n++; else break;
  }
  return n;
}

/** Backoff (§0.5): K consecutive runs with 0 new survivors AND 0 new census nodes. */
function shouldBackoff(recentRows, k = BACKOFF_K) {
  const rows = recentRows || [];
  if (rows.length < k) return false;
  return rows.slice(0, k).every((r) => (r.new_survivors || 0) === 0 && (r.m1_census_nodes || 0) === 0);
}

/**
 * The DETERMINISTIC digest — NO model writes this (§0.1). It carries the
 * conjecture-gen honesty boilerplate verbatim and the "promoted = loop stable,
 * NOT proven" line (§0.2). Only NEGATED upgrade framings appear ("NOT proven");
 * no affirmative upgrade phrasing, by construction. Pure.
 */
function buildDigest(row, gate) {
  const r = row || {};
  const g = gate || { consecutiveClean: 0, target: CLEAN_RUN_TARGET, promoted: false };
  const lines = [];
  lines.push(`M8 AUTONOMOUS LOOP — run ${r.run_date} (deterministic digest; no model wrote this).`);
  lines.push(`M3 generator (seed ${r.seed}): ${r.m3_mined || 0} mined, ${r.survivors_persisted || 0} survivor(s) persisted (${r.new_survivors || 0} new); gate-v2 ${r.m3_gate_pass ? "PASS" : "FAIL"}.`);
  lines.push(`These are MACHINE-GENERATED conjectures, tested to ${r.bound} only — NOT proven, NOT novel, NOT established. The gate measures GENERATION QUALITY, not truth.`);
  if (r.m4_attempted) {
    lines.push(`M4 re-check (warm Lean window): leaves verified ${r.m4_leaves_verified || 0} / ${r.m4_leaf_total || 0} on a human-architected scaffold. A verified leaf is one Lean machine-check, NOT a proof of the target; the target stays an OPEN CONJECTURE.`);
  } else {
    lines.push(`M4: ${r.lean_ready ? "no human-architected scaffold awaiting re-check" : "Lean checker cold — skipped (the run still counts)"}.`);
  }
  lines.push(`Loop status: ${g.consecutiveClean}/${g.target} consecutive clean run(s)${g.promoted ? " — PROMOTED" : ""}. Promotion means the autonomous loop is STABLE (ran clean, zero Odysseus regressions, produced survivors) — it does NOT mean any conjecture is proven or novel.`);
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════════
// PERSISTENCE — m8_loop_runs (upsert by run_date) + m8_odysseus_runs
// ════════════════════════════════════════════════════════════════════
async function upsertRun(row) {
  try {
    const sb = getClient();
    const ex = await sb.from(RUNS_TABLE).select("id").eq("run_date", row.run_date).maybeSingle();
    const payload = { ...row, updated_at: now() };
    if (ex.data && ex.data.id) {
      const u = await sb.from(RUNS_TABLE).update(payload).eq("id", ex.data.id);
      return u.error ? null : ex.data.id;
    }
    const ins = await sb.from(RUNS_TABLE).insert([payload]).select("id").single();
    return ins.data ? ins.data.id : null;
  } catch (e) { console.error("[M8] loop upsertRun error (non-fatal):", e.message); return null; }
}

async function patchRun(runDate, patch) {
  try { await getClient().from(RUNS_TABLE).update({ ...patch, updated_at: now() }).eq("run_date", runDate); }
  catch (e) { console.error("[M8] loop patchRun error (non-fatal):", e.message); }
}

async function fetchRecentRows(limit) {
  try {
    const { data } = await getClient().from(RUNS_TABLE)
      .select("*").order("run_date", { ascending: false }).limit(limit || 10);
    return data || [];
  } catch (e) { console.error("[M8] loop fetchRecentRows error (non-fatal):", e.message); return []; }
}

/** Newest Odysseus attestation within ATTEST_FRESH_HOURS of the run's date. */
async function fetchLatestAttestation(runDate) {
  try {
    const { data } = await getClient().from(ODY_TABLE)
      .select("*").order("run_at", { ascending: false }).limit(15);
    const runMs = Date.parse(String(runDate) + "T12:00:00Z");
    for (const a of data || []) {
      const aMs = Date.parse(a.run_at);
      if (Number.isFinite(aMs) && Math.abs(aMs - runMs) <= ATTEST_FRESH_HOURS * 3600 * 1000) return a;
    }
    return null;
  } catch (e) { console.error("[M8] loop fetchLatestAttestation error (non-fatal):", e.message); return null; }
}

/**
 * Recompute the promotion gate over the recent rows (enriched with their fresh
 * Odysseus attestation), stamp consecutive_clean + promoted on the current row,
 * and push the opt-in digest on promotion or a 3-deep failure streak. Fail-safe.
 */
async function recomputeGateAndMaybeAlert(runDate, log = () => {}) {
  try {
    const rows = await fetchRecentRows(10);
    const enriched = [];
    for (const r of rows) {
      const att = await fetchLatestAttestation(r.run_date);
      enriched.push({
        ...r,
        odysseus_pass: att ? !!att.pass : false,
        odysseus_fresh: !!att,
        odysseus_run_id: att ? att.id : null,
      });
    }
    const gate = evaluatePromotionGate(enriched);
    const latest = enriched[0];
    if (latest && latest.run_date === runDate) {
      await patchRun(runDate, {
        consecutive_clean: gate.consecutiveClean,
        promoted: gate.promoted,
        odysseus_run_id: latest.odysseus_run_id || null,
      });
    }
    const failStreak = countLeadingFailures(enriched);
    if (gate.promoted && latest) {
      await maybePush(buildDigest({ ...latest }, gate), "promotion", log);
    } else if (failStreak >= 3) {
      await maybePush(`M8 autonomous loop: ${failStreak} consecutive failed/degraded runs — needs attention (latest ${latest ? latest.run_date : "?"}).`, "failure", log);
    }
    return gate;
  } catch (e) { console.error("[M8] loop gate error (non-fatal):", e.message); return { promoted: false, consecutiveClean: 0, target: CLEAN_RUN_TARGET }; }
}

/** Opt-in push (BUILD_19_SPEC digest decision): only fires if a webhook is set;
 *  otherwise the run row + digest stand and are read on demand. Fail-safe. */
async function maybePush(text, kind, log = () => {}) {
  log("l5_alert", { kind });
  const url = process.env.L5_ALERT_WEBHOOK;
  if (!url) return { pushed: false, reason: "no webhook" };
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, text }) });
    return { pushed: true };
  } catch (e) { return { pushed: false, error: e.message }; }
}

/** Record an Odysseus attestation (from run-battery.ps1 via /api/loop-attest) and
 *  recompute the gate for the target run date. Fail-safe. */
async function recordAttestation({ run_date, pass, regressions, total, passed, failed, baseline_ref, metadata } = {}) {
  try {
    const sb = getClient();
    const ins = await sb.from(ODY_TABLE).insert([{
      run_at: now(),
      baseline_ref: baseline_ref || null,
      total: total || 0, passed: passed || 0, failed: failed || 0,
      regressions: Array.isArray(regressions) ? regressions : [],
      pass: !!pass,
      metadata: metadata || {},
    }]).select("id").single();
    const id = ins.data ? ins.data.id : null;
    if (run_date) await recomputeGateAndMaybeAlert(run_date);
    return { ok: true, id };
  } catch (e) { console.error("[M8] loop recordAttestation error (non-fatal):", e.message); return { ok: false, error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// PHASE A — OBSERVE (cheap, Lean-free legs; PURE-CODE generation)
// ════════════════════════════════════════════════════════════════════
async function runObservePhase({ runDate = todayUTC(), bound = DEFAULT_BOUND, log = () => {} } = {}) {
  if (process.env.L5_LOOP_DISABLED === "1") { log("l5_disabled", {}); return { skipped: "disabled" }; }

  // step 0 — warmup ping. We await briefly (short timeout); the import continues on
  // the Cloud Run side regardless, so phase B (15 min later) finds a warm checker.
  let warm = { ready: false, reason: null };
  try { const { leanHealth } = require("./leanClient"); warm = await leanHealth({ timeoutMs: 8000 }); }
  catch (e) { warm = { ready: false, reason: e.message }; }
  log("l5_warmup", { leanReady: !!warm.ready, reason: warm.reason || null });

  const seed = nextSeed(runDate);

  // backoff (§0.5) — pause generation if the recent slice is exhausted.
  let backoff = false;
  try { backoff = shouldBackoff(await fetchRecentRows(BACKOFF_K)); } catch (_) {}

  const row = {
    run_date: runDate, seed, bound,
    m1_census_nodes: 0, m3_mined: 0, m3_gate_pass: false,
    survivors_persisted: 0, new_survivors: 0,
    lean_ready: !!warm.ready, run_status: "ok", needs_attention: null,
    metadata: { loop_version: LOOP_VERSION, lean_warmup_pinged: true, warm_reason: warm.reason || null },
  };

  if (backoff) {
    row.run_status = "degraded";
    row.needs_attention = "slice_exhausted";
    log("l5_backoff", { k: BACKOFF_K });
    await upsertRun(row);
    await recomputeGateAndMaybeAlert(runDate, log);
    return { runDate, backoff: true, seed };
  }

  // step 2 — M3 generator: PURE CODE, NO LLM. Mines + falsifies + gates in-process.
  let m3 = null, runStatus = "ok";
  try {
    m3 = runConjectureGen({ testBound: bound, seed });
    row.m3_mined = m3.counts.mined;
    row.m3_gate_pass = !!m3.gate.pass;
    log("l5_m3", { mined: m3.counts.mined, survivors: m3.counts.minedSurvived, gatePass: m3.gate.pass, seed });
  } catch (e) { runStatus = "degraded"; row.metadata.m3_error = e.message; log("l5_m3_error", { error: e.message }); }

  // step 2b — persist survivors to the notebook (same notes the chat STORE writes).
  const sessionId = `loop-${runDate}`;
  if (m3 && Array.isArray(m3.notes) && m3.notes.length) {
    try {
      const { persistNote } = require("./notebook");
      await Promise.allSettled(m3.notes.map((n) => persistNote(sessionId, n)));
      row.survivors_persisted = m3.notes.filter((n) => n.kind === "conjecture").length;
      log("l5_persist", { notes: m3.notes.length, survivors: row.survivors_persisted });
    } catch (e) { runStatus = "degraded"; row.metadata.persist_error = e.message; log("l5_persist_error", { error: e.message }); }
  }

  // step 3 — M3.1 capture: dedup gives the NEW-survivor count (backoff signal).
  if (m3 && Array.isArray(m3.queueItems) && m3.queueItems.length) {
    try {
      const { upsertQueueItems } = require("./review-queue");
      const qr = await upsertQueueItems(m3.queueItems);
      row.new_survivors = qr.inserted || 0;
      log("l5_queue", { inserted: qr.inserted || 0, upserted: qr.upserted || 0, errors: qr.errors || 0 });
    } catch (e) { row.metadata.queue_error = e.message; log("l5_queue_error", { error: e.message }); }
  }

  row.run_status = runStatus;
  await upsertRun(row);
  await recomputeGateAndMaybeAlert(runDate, log);
  return {
    runDate, seed, bound,
    m3GatePass: row.m3_gate_pass, survivors: row.survivors_persisted, newSurvivors: row.new_survivors,
    runStatus, leanWarm: !!warm.ready,
  };
}

// ════════════════════════════════════════════════════════════════════
// PHASE B — VERIFY (warm window: re-check human-drafted leaf code; NO LLM)
// ════════════════════════════════════════════════════════════════════
async function runVerifyPhase({ runDate = todayUTC(), log = () => {} } = {}) {
  if (process.env.L5_LOOP_DISABLED === "1") { log("l5_disabled", {}); return { skipped: "disabled" }; }

  // step 0 — /health gate. Cold => skip M4; the run still counts (M4 is "where applicable").
  let health = { ready: false, reason: null };
  try { const { leanHealth } = require("./leanClient"); health = await leanHealth({ timeoutMs: 10000 }); }
  catch (e) { health = { ready: false, reason: e.message }; }

  const patch = { lean_ready: !!health.ready, m4_attempted: false };
  if (!health.ready) {
    log("l5_verify_cold", { reason: health.reason || "not ready" });
    await patchRun(runDate, patch);
    const gate = await recomputeGateAndMaybeAlert(runDate, log);
    return { runDate, lean_ready: false, m4_attempted: false, gate };
  }

  // step 1+2 — re-check a HUMAN-architected scaffold's already-drafted leaf code.
  // NO re-draft, NO LLM, NO new DAG. Strictly more conservative than dischargeLeaf.
  let m4 = null;
  try {
    const { fetchPendingScaffold, recheckScaffold } = require("./lemma-dag");
    const { row } = await fetchPendingScaffold();
    if (row) {
      m4 = await recheckScaffold(row, { log, checkCap: LEAN_LOOP_CHECK_CAP });
      patch.m4_attempted = true;
      patch.m4_target_id = row.id;
      patch.m4_leaves_verified = m4.leaves_verified;
      patch.m4_leaf_total = m4.leaf_count;
      log("l5_verify_m4", { rechecked: m4.rechecked, newlyVerified: m4.newlyVerified, checksUsed: m4.checksUsed });
    } else {
      log("l5_verify_no_target", {});
    }
  } catch (e) { log("l5_verify_m4_error", { error: e.message }); }

  await patchRun(runDate, patch);
  const gate = await recomputeGateAndMaybeAlert(runDate, log);
  return { runDate, lean_ready: true, m4, gate };
}

module.exports = {
  runObservePhase, runVerifyPhase, recordAttestation, recomputeGateAndMaybeAlert,
  // pure core (exported for the PS mirror + tests):
  dayIndex, nextSeed, diffRegressions, evaluatePromotionGate, countLeadingFailures,
  shouldBackoff, buildDigest, todayUTC,
  // tunables:
  SEED_BASE, DEFAULT_BOUND, BACKOFF_K, CLEAN_RUN_TARGET, ATTEST_FRESH_HOURS,
  LEAN_LOOP_CHECK_CAP, LOOP_VERSION,
};
