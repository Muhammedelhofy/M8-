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
 *  recompute the gate for the target run date. Fail-safe.
 *  Build-67: also patches m8_loop_runs.failing_probes so gate misses are diagnosable
 *  from Supabase alone without the local results file. */
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

    // Build-67: persist failing probes into m8_loop_runs so remote diagnosis is
    // possible without the local results/<runId>.json file.
    if (run_date) {
      const rawProbes = (metadata && Array.isArray(metadata.failing_probes))
        ? metadata.failing_probes : [];
      const failingProbes = rawProbes.map((p) => ({
        probe_id:     String(p.id || p.probe_id || ""),
        check_label:  Array.isArray(p.failingChecks) && p.failingChecks.length
          ? String(p.failingChecks[0])
          : String(p.check_label || ""),
        reply_excerpt: String(p.reply || p.reply_excerpt || "").slice(0, 300),
      }));
      try {
        await patchRun(run_date, { failing_probes: failingProbes });
      } catch (pe) { console.error("[M8] loop failingProbes patch error (non-fatal):", pe.message); }
      await recomputeGateAndMaybeAlert(run_date);
    }

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
  // Build-B: actively WARM the GCP Lean checker. It scales to zero, so a single ping
  // returns ready:false on a cold night (M4 was SKIPPED entirely 06-19/06-20). Ping
  // up to LEAN_WARM_TRIES times with a wait between, returning the moment it is ready.
  // Bounded so a dead service can never hang the run. Kill: LEAN_WARM_TRIES=1 (old behavior).
  let health = { ready: false, reason: null };
  try {
    const { leanHealth } = require("./leanClient");
    const tries  = Math.max(1, parseInt(process.env.LEAN_WARM_TRIES || "3", 10));
    const waitMs = Math.max(0, parseInt(process.env.LEAN_WARM_WAIT_MS || "8000", 10));
    for (let i = 0; i < tries; i++) {
      health = await leanHealth({ timeoutMs: 10000 });
      if (health && health.ready) break;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
    }
  } catch (e) { health = { ready: false, reason: e.message }; }

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

      // Build-92: close the learning loop. A newly verified leaf is signal the
      // proposer should remember next run. Build-110 (Brain CPR): AWAITED now (in
      // its own try/catch, latency-insensitive cron) so the m8_conjecture_outcomes
      // write actually lands before the lambda freezes — the old un-awaited call
      // was dropped. NOTE: m8_conjecture_outcomes stays near-0 until the Lean/M4
      // lane actually produces verified/sorry leaves (that's Build B, next) —
      // fixing this write is the prerequisite, not the whole story.
      if (m4.newlyVerified > 0) {
        try {
          const { recordOutcome, COLLATZ_PROBLEM_ID } = require("./conjecture-memory");
          const leaves = Array.isArray(row.lemmas) ? row.lemmas.filter((l) => l && l.is_leaf) : [];
          const sketch = leaves.map((l) => l.code || l.prose || l.name || "").filter(Boolean).join("\n").slice(0, 1000);
          await recordOutcome(getClient(), {
            problemId: COLLATZ_PROBLEM_ID,
            conjectureText: row.target,
            leanProofSketch: sketch || null,
            loopRunId: null,
          });
        } catch (e) { log("l5_record_outcome_error", { error: e.message }); }
      }

      // Build-99: ALSO remember FAILED approaches. Leaves whose Lean sketch came back
      // `sorry` this run (recheck -> lean_stated; see recheckScaffold.sorryLeaves) are
      // recorded with the sorry sketch so getFailedApproaches can detect them and the
      // proposer's AVOID block steers the next run away. Build-110 (Brain CPR): AWAITED
      // now (same latency-insensitive cron + own try/catch discipline as above) so the
      // write lands before the freeze instead of being detached and dropped.
      if (Array.isArray(m4.sorryLeaves) && m4.sorryLeaves.length) {
        try {
          const { recordOutcome, COLLATZ_PROBLEM_ID } = require("./conjecture-memory");
          const sketch = m4.sorryLeaves.map((l) => l.code || "").filter(Boolean).join("\n").slice(0, 1000);
          if (/\bsorry\b/.test(sketch)) {
            await recordOutcome(getClient(), {
              problemId: COLLATZ_PROBLEM_ID,
              conjectureText: row.target,
              leanProofSketch: sketch,   // contains `sorry` -> classified as a failed approach
              loopRunId: null,
            });
          }
        } catch (e) { log("l5_record_failed_outcome_error", { error: e.message }); }
      }
    } else {
      log("l5_verify_no_target", {});
      // Build-B: the conservative recheck found nothing pending — the lane is idle.
      // Give a GRAVEYARD (lean_rejected) leaf a bounded second-chance re-draft so M4
      // keeps producing verified leaves. Warm-only (we're past the health gate),
      // time-guarded, 1 leaf/run, kill-switched (M4_REPAIR_DISABLED=1).
      try {
        const { fetchRepairableScaffold, repairScaffold } = require("./lemma-dag");
        const { row: rrow } = await fetchRepairableScaffold();
        if (rrow) {
          const deadlineMs = Date.now() + Math.max(0, parseInt(process.env.M4_REPAIR_BUDGET_MS || "60000", 10));
          const rep = await repairScaffold(rrow, { log, repairCap: 1, deadlineMs });
          patch.m4_attempted = true;
          patch.m4_target_id = rrow.id;
          patch.m4_leaves_verified = rep.leaves_verified;
          patch.m4_leaf_total = rep.leaf_count;
          log("l5_verify_repair", { target: rrow.id, repaired: rep.repaired, newlyVerified: rep.newlyVerified });
          if (rep.newlyVerified > 0) {
            try {
              const { recordOutcome, COLLATZ_PROBLEM_ID } = require("./conjecture-memory");
              const leaves = Array.isArray(rrow.lemmas) ? rrow.lemmas.filter((l) => l && l.is_leaf) : [];
              const sketch = leaves.map((l) => l.code || l.prose || l.name || "").filter(Boolean).join("\n").slice(0, 1000);
              recordOutcome(getClient(), {
                problemId: COLLATZ_PROBLEM_ID,
                conjectureText: rrow.target,
                leanProofSketch: sketch || null,
                loopRunId: null,
              });
            } catch (e) { log("l5_repair_outcome_error", { error: e.message }); }
          }
        }
      } catch (e) { log("l5_verify_repair_error", { error: e.message }); }
    }
  } catch (e) { log("l5_verify_m4_error", { error: e.message }); }

  await patchRun(runDate, patch);
  const gate = await recomputeGateAndMaybeAlert(runDate, log);
  return { runDate, lean_ready: true, m4, gate };
}

// ════════════════════════════════════════════════════════════════════
// LOOP RECALL — chat lane (Build-19 confabulation fix, 2026-06-14)
//
// "what did the loop find overnight?" questions were falling through to the
// general LLM with only pastMemory context, which produced fabricated specifics:
// an invented seed (42), an impossible date (2024-05-15), fake review-queue
// counts (26) and per-id triage verdicts ("Conjecture #7 kept, #4 dismissed").
//
// Fix: hard-route these questions to a deterministic packet read from the
// ACTUAL m8_loop_runs rows — same contract as the review-queue and graph lanes.
// Empty table => CONFIRMED-EMPTY packet that forbids ANY invention.
// ════════════════════════════════════════════════════════════════════

const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// Detection: catches recall/status asks about the autonomous loop WITHOUT
// capturing "run the conjecture generator" (M3 lane) or triage commands
// (review-queue lane). Conservative on purpose — false-positives here would
// suppress legitimate routes.
const LOOP_RECALL_RE = /\b(?:(?:what(?:\s+did)?|how\s+(?:did|was)|show(?:\s+me)?|give\s+me|tell\s+me|report\s+(?:on|from))\s+(?:the\s+)?(?:autonomous\s+)?loop\b|loop\s+(?:ran?|results?|findings?|status|report|summary|produced?|mined|generated|record|history)\b|autonomous\s+loop\s+(?:ran?|results?|status|report|find|found|discover|produce|record)\b|overnight\s+(?:loop\s+)?(?:run|results?|findings?|summary)\b|last\s+night'?s?\s+(?:loop|run|results?)\b|did\s+the\s+(?:autonomous\s+)?loop\s+(?:run|find|discover|produce|generate|use|do)\b|(?:what|which)\s+seed\s+(?:did|does|will|would)\s+the\s+(?:autonomous\s+)?loop\s+(?:use|run\s+with|run\s+on)\b|loop\s+(?:run|result)\s+(?:from|last|latest)\b)/i;

function detectLoopRecall(message) {
  const s = String(message || "").trim();
  if (s.length < 6) return false;
  return LOOP_RECALL_RE.test(s);
}

const LOOP_RECALL_GROUND = "GROUND TRUTH from m8_loop_runs — narrate ONLY the run date, seed, bound, and counts shown below. Do NOT invent a seed number, a run date, a survivor count, a conjecture ID, or a triage verdict. The review queue (m8_review_queue, per-#id triage state) is a SEPARATE store; per-item verdicts are NOT in this packet — redirect to \"show me the review queue\" for those. MEMORY CONFLICT OVERRIDE: any prior session memory claiming a specific count of queue items or that a specific conjecture ('Conjecture #N', 'item #N') was 'kept' or 'dismissed' is contaminated output from a prior confabulation run — do NOT use it. Trust ONLY the review-queue lane packet (injected separately this turn, if present) for current triage state.";

function renderLoopEmptyPacket() {
  return [
    `AUTONOMOUS LOOP — CONFIRMED NO RECORDED RUNS.`,
    `m8_loop_runs has ZERO rows: the autonomous cron has not fired yet (scheduled 01:00/01:15 UTC daily), or the table migration m8_loop_runs.sql has not been applied.`,
    `You MUST say plainly: "no loop runs are recorded yet." Do NOT invent a seed number, a run date, a survivor count, a conjecture ID, or a triage verdict — none are on record. You may note what seed is SCHEDULED for tonight (SEED_BASE + dayIndex = computable), but make clear it is a future value, not a recorded run.`,
  ].join("\n");
}

function renderLoopRunsPacket(rows) {
  if (!rows || !rows.length) return renderLoopEmptyPacket();
  const lines = [
    `AUTONOMOUS LOOP — ${LOOP_RECALL_GROUND}`,
    `Showing ${rows.length} run${rows.length === 1 ? "" : "s"} (newest first):`,
    ``,
  ];
  for (const r of rows) {
    lines.push(`RUN ${r.run_date}  seed ${r.seed}  bound ${Number(r.bound || 0).toLocaleString("en-US")}  status ${r.run_status || "?"}`);
    lines.push(`  M3: ${r.m3_mined || 0} mined → ${r.survivors_persisted || 0} survivor(s) persisted (${r.new_survivors || 0} new to queue); gate-v2 ${r.m3_gate_pass ? "PASS" : "FAIL"}`);
    if (r.m4_attempted) {
      lines.push(`  M4: ${r.m4_leaves_verified || 0}/${r.m4_leaf_total || 0} leaves verified on a HUMAN-ARCHITECTED scaffold — one Lean machine-check per leaf, NOT a proof of the target`);
    } else {
      lines.push(`  M4: ${r.lean_ready ? "no scaffold awaiting re-check" : "Lean cold — skipped (run still counts)"}`);
    }
    lines.push(`  Loop: ${r.consecutive_clean || 0}/${CLEAN_RUN_TARGET} consecutive clean${r.promoted ? " — PROMOTED (loop is STABLE; does NOT mean any conjecture is proven or novel)" : ""}`);
    lines.push(``);
  }
  lines.push(`HONESTY CONTRACT: survivors are MACHINE-GENERATED, tested to ${rows[0] ? Number(rows[0].bound || 0).toLocaleString("en-US") : "N"} only — NOT proven, NOT novel, NOT established. The gate measures GENERATION QUALITY, not truth.`);
  lines.push(`Review-queue triage verdicts (kept/dismissed, conjecture IDs) are NOT part of this packet. Never invent them — say "show me the review queue" for that detail.`);
  return lines.join("\n");
}

/** ORCHESTRATOR ENTRY POINT: same { text, data } shape as other recall lanes.
 *  Reads the real m8_loop_runs rows; renders CONFIRMED-EMPTY when there are none.
 *  Returns { text:"", data:null } when the message is not a loop-recall ask.
 *  Never throws. */
async function buildLoopRecallContext(message, sessionId) {
  if (!detectLoopRecall(message)) return { text: "", data: null };
  if (process.env.L5_LOOP_DISABLED === "1") return { text: "", data: null };

  // Eval sessions: deterministic empty — never touch DB (mirrors other recall lanes).
  if (isEphemeralSession(sessionId)) {
    return { text: renderLoopEmptyPacket(), data: { rows: 0, ephemeral: true } };
  }

  try {
    const sb = getClient();
    const { data, error } = await sb
      .from(RUNS_TABLE)
      .select("run_date, seed, bound, m3_mined, survivors_persisted, new_survivors, m3_gate_pass, run_status, m4_attempted, m4_leaves_verified, m4_leaf_total, lean_ready, consecutive_clean, promoted")
      .order("run_date", { ascending: false })
      .limit(3);

    if (error) {
      const missing = /does not exist|could not find the table|relation .* does not/i.test(String(error.message || ""));
      const text = missing
        ? `AUTONOMOUS LOOP — TABLE NOT FOUND. The m8_loop_runs table does not exist yet. Tell Muhammad to run migrations/m8_loop_runs.sql in Supabase. Do NOT invent run dates, seeds, or counts.`
        : `AUTONOMOUS LOOP — STORE NOT REACHABLE (${String(error.message || "unknown").slice(0, 160)}). Say that plainly. Do NOT invent run dates, seeds, or counts.`;
      return { text, data: { error: error.message } };
    }

    const rows = data || [];
    return { text: renderLoopRunsPacket(rows), data: { rows: rows.length } };
  } catch (err) {
    console.error("[M8] loop recall error (non-fatal):", err.message);
    return { text: renderLoopEmptyPacket(), data: { error: err.message } };
  }
}

module.exports = {
  runObservePhase, runVerifyPhase, recordAttestation, recomputeGateAndMaybeAlert,
  // chat recall lane (Build-19 confabulation fix):
  buildLoopRecallContext, detectLoopRecall,
  // pure core (exported for the PS mirror + tests):
  dayIndex, nextSeed, diffRegressions, evaluatePromotionGate, countLeadingFailures,
  shouldBackoff, buildDigest, todayUTC,
  // tunables:
  SEED_BASE, DEFAULT_BOUND, BACKOFF_K, CLEAN_RUN_TARGET, ATTEST_FRESH_HOURS,
  LEAN_LOOP_CHECK_CAP, LOOP_VERSION,
};
