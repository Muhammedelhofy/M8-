/**
 * M8 Stateful Alerting — lib/alerting.js  (Build-20)
 *
 * Condition #1: CASH GAP (cash_collected_by_driver - cash_deposited per driver).
 * Pure deterministic code — NO LLM in raise/resolve decisions. The honesty spine
 * extends to ops alerts: conditions are code over the fleet packet, never a model guess.
 *
 * Evaluation piggybacks the fleet fetch (no new cron).
 * State machine: raised → acknowledged → in_progress → resolved → re_raised / snoozed.
 * All thresholds FIXED IN CODE per spec §2 (deterministic, not env-tunable).
 *
 * PURE CORE: computeTransition / buildAlertText / detectAlertAck are IO-free and
 * PS-mirror-testable. IO lives in evaluateAlerts / applyAcks.
 */

const { getFleetRecord, decodeHistory } = require("./fleet");

const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
                process.env.SUPABASE_ANON_KEY || "").trim();

// ── Thresholds (FIXED IN CODE per spec §2) ────────────────────────────────────
const RAISE_SAR      = 500;   // raise if gap > this for >= 2 consecutive entries
const RESOLVE_SAR    = 100;   // resolve if gap <= this for >= 2 consecutive evaluations
const SEV1_SAR       = 1500;  // severity 1 if gap exceeds this
const SEV1_AGE_DAYS  = 7;     // severity 1 if open longer than this
const WORSEN_DELTA   = 500;   // re-raise if gap grows >= SAR 500 above raise_value
const COOLDOWN_H     = 48;    // min hours between raises on same (condition, driver)
const RECUR_WIN_DAYS = 14;    // recur window: re_raised vs fresh raise
const BRIEF_CAP      = 2;     // max individual alert lines in brief; rest aggregated
const DEDUP_H        = 6;     // skip state transition if checked within this many hours
const OPEN_STATES    = new Set(["raised", "acknowledged", "in_progress", "re_raised", "snoozed"]);

// ── Pure core ─────────────────────────────────────────────────────────────────

/**
 * Compute the next state machine transition for ONE driver's cash gap.
 * Pure — no IO, PS-mirror-testable.
 *
 * @param {object|null} row  - existing fleet_alerts row, or null
 * @param {number} gapNow    - current cashGap (SAR)
 * @param {number|null} gapPrev - previous entry's cashGap, or null if no prior data
 * @param {number} nowMs     - Date.now()
 * @returns {{ action, isOpen, fields }}
 *   action: 'raise'|'re_raise'|'resolve'|'update_clear'|'update'|'skip'|'none'
 *   isOpen: whether the alert should surface in the brief after this transition
 *   fields: partial row to upsert (undefined when action='none'|'skip')
 */
function computeTransition(row, gapNow, gapPrev, nowMs) {
  const consecutiveRaise = gapNow > RAISE_SAR && gapPrev !== null && gapPrev > RAISE_SAR;
  const clearNow = gapNow <= RESOLVE_SAR;

  // ── No existing alert ──────────────────────────────────────────────────────
  if (!row) {
    if (consecutiveRaise) {
      return {
        action: "raise", isOpen: true,
        fields: {
          state: "raised", severity: gapNow > SEV1_SAR ? 1 : 2,
          metric_value: gapNow, raise_value: gapNow, threshold: RAISE_SAR,
          consecutive_clear: 0, times_raised: 1,
          first_raised_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
          acked_at: null, resolved_at: null, suppression_until: null,
          metadata: { history: [] },
        },
      };
    }
    return { action: "none", isOpen: false };
  }

  const state = row.state;
  const isOpen = OPEN_STATES.has(state);

  // ── Deduplicate: skip transition if evaluated too recently ────────────────
  if (row.last_checked_at) {
    const lastMs = new Date(row.last_checked_at).getTime();
    if ((nowMs - lastMs) < DEDUP_H * 3600000) {
      return { action: "skip", isOpen, fields: { metric_value: gapNow } };
    }
  }

  // ── Resolved: check for recurrence ────────────────────────────────────────
  if (state === "resolved") {
    if (!consecutiveRaise) return { action: "none", isOpen: false };
    const resolvedAtMs = row.resolved_at ? new Date(row.resolved_at).getTime() : 0;
    const daysSinceResolved = (nowMs - resolvedAtMs) / 86400000;
    if (daysSinceResolved <= RECUR_WIN_DAYS) {
      return {
        action: "re_raise", isOpen: true,
        fields: {
          state: "re_raised", metric_value: gapNow, raise_value: gapNow,
          severity: gapNow > SEV1_SAR ? 1 : 2,
          times_raised: (row.times_raised || 1) + 1,
          consecutive_clear: 0, resolved_at: null, acked_at: null,
          last_checked_at: new Date(nowMs).toISOString(),
        },
      };
    }
    // Recur window expired: treat as a fresh raise
    return {
      action: "raise", isOpen: true,
      fields: {
        state: "raised", severity: gapNow > SEV1_SAR ? 1 : 2,
        metric_value: gapNow, raise_value: gapNow, threshold: RAISE_SAR,
        consecutive_clear: 0, times_raised: (row.times_raised || 1) + 1,
        first_raised_at: new Date(nowMs).toISOString(),
        last_checked_at: new Date(nowMs).toISOString(),
        acked_at: null, resolved_at: null, suppression_until: null,
      },
    };
  }

  // ── Open state: worsening-delta check (bypasses cooldown per spec §2) ─────
  if (isOpen && row.raise_value != null) {
    const worsen = gapNow - (row.raise_value || 0);
    if (worsen >= WORSEN_DELTA) {
      return {
        action: "re_raise", isOpen: true,
        fields: {
          state: "re_raised", metric_value: gapNow, raise_value: gapNow,
          severity: 1,
          times_raised: (row.times_raised || 1) + 1,
          consecutive_clear: 0, suppression_until: null, acked_at: null,
          last_checked_at: new Date(nowMs).toISOString(),
        },
      };
    }
  }

  // ── Snoozed: check expiry and worsening (handled above) ──────────────────
  if (state === "snoozed") {
    if (row.suppression_until) {
      const untilMs = new Date(row.suppression_until).getTime();
      if (nowMs < untilMs) {
        return { action: "skip", isOpen: false, fields: { metric_value: gapNow, last_checked_at: new Date(nowMs).toISOString() } };
      }
      // Snooze expired — continue evaluation as 'raised'
    }
  }

  // ── Open state: resolution check ──────────────────────────────────────────
  if (isOpen && clearNow) {
    const newClearCount = (row.consecutive_clear || 0) + 1;
    if (newClearCount >= 2) {
      return {
        action: "resolve", isOpen: false,
        fields: {
          state: "resolved", consecutive_clear: newClearCount, metric_value: gapNow,
          resolved_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
        },
      };
    }
    return {
      action: "update_clear", isOpen: true,
      fields: { consecutive_clear: newClearCount, metric_value: gapNow, last_checked_at: new Date(nowMs).toISOString() },
    };
  }

  // ── Open state: gap still above resolve threshold — update metric ─────────
  if (isOpen) {
    const firstMs = row.first_raised_at ? new Date(row.first_raised_at).getTime() : nowMs;
    const ageDays = (nowMs - firstMs) / 86400000;
    const newSev = (gapNow > SEV1_SAR || ageDays > SEV1_AGE_DAYS) ? 1 : 2;
    return {
      action: "update", isOpen: true,
      fields: { consecutive_clear: 0, metric_value: gapNow, severity: newSev, last_checked_at: new Date(nowMs).toISOString() },
    };
  }

  return { action: "none", isOpen: false };
}

/**
 * Build the alert text block for injection into the system prompt.
 * Pure — no IO.
 *
 * @param {Array} openAlerts - alerts returned by evaluateAlerts (only isOpen ones)
 * @returns {string} ready to append to systemInstruction, empty string if none
 */
function buildAlertText(openAlerts) {
  if (!openAlerts || openAlerts.length === 0) return "";

  const sorted = [...openAlerts].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    return (b.metric_value || 0) - (a.metric_value || 0);
  });

  const totalGap = sorted.reduce((s, a) => s + (a.metric_value || 0), 0);

  let text;
  if (sorted.length > BRIEF_CAP) {
    const worst = sorted[0];
    const worstAge = ageDays(worst);
    text =
      `FLEET ALERT — CASH GAP: ${sorted.length} drivers collectively owe SAR ${Math.round(totalGap)} in uncollected cash. ` +
      `Worst: ${worst.driver_name} (SAR ${Math.round(worst.metric_value || 0)}, ` +
      `${Math.round(worstAge)} days open${worst.times_raised > 1 ? `, raised ${worst.times_raised}×` : ""}). ` +
      `Surface this proactively when discussing fleet performance.`;
  } else {
    const lines = sorted.map((a) => {
      const d = Math.round(ageDays(a));
      const recur = a.state === "re_raised" ? ", RECURRED" : "";
      const times = a.times_raised > 1 ? `, raised ${a.times_raised}×` : "";
      return `${a.driver_name}: SAR ${Math.round(a.metric_value || 0)} (${d} days${times}${recur})`;
    });
    const highPriority = sorted.some((a) => a.severity === 1);
    text =
      `FLEET ALERT — CASH GAP${highPriority ? " ⚠ HIGH PRIORITY" : ""}: ${lines.join(" | ")}. ` +
      `Surface this to Muhammad if the conversation touches fleet, cash, or deposits.`;
  }

  return `\n\n${text}`;
}

function ageDays(alert) {
  const first = alert.first_raised_at ? new Date(alert.first_raised_at).getTime() : Date.now();
  return (Date.now() - first) / 86400000;
}

/**
 * Detect acknowledgement signals in a chat message.
 * Returns driver_keys of alerts to ack.
 * Pure — no IO.
 */
const CASH_TOPIC = /\b(cash|deposit|gap|collect|owe|owes|paid|payment|balance)\b/i;
function detectAlertAck(message, openAlerts) {
  if (!openAlerts || openAlerts.length === 0) return [];
  const msg = (message || "").toLowerCase();
  // UI chip: "ack:<id>"
  const chipMatch = msg.match(/\back:(\d+)\b/);
  if (chipMatch) {
    const id = parseInt(chipMatch[1], 10);
    const a = openAlerts.find((x) => x.id === id);
    return a ? [a.driver_key] : [];
  }
  // Chat: names a driver AND a cash topic
  if (!CASH_TOPIC.test(message)) return [];
  return openAlerts
    .filter((a) => {
      const name = (a.driver_name || "").toLowerCase().split(/\s+/);
      return name.some((part) => part.length > 2 && msg.includes(part));
    })
    .map((a) => a.driver_key);
}

// ── Supabase IO ───────────────────────────────────────────────────────────────

async function sbFetch(path, opts = {}) {
  if (!SB_URL || !SB_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
        ...(opts.headers || {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fetchOpenAlerts() {
  const rows = await sbFetch(`fleet_alerts?condition=eq.cash_gap&state=not.eq.resolved&select=*`);
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.map((r) => [r.driver_key, r]));
}

async function upsertAlertRow(condition, driverKey, driverName, fields) {
  const body = { condition, driver_key: driverKey, driver_name: driverName, ...fields };
  const res = await sbFetch("fleet_alerts", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body),
  });
  return res;
}

async function patchAlert(condition, driverKey, fields) {
  return sbFetch(
    `fleet_alerts?condition=eq.${encodeURIComponent(condition)}&driver_key=eq.${encodeURIComponent(driverKey)}`,
    { method: "PATCH", body: JSON.stringify(fields) }
  );
}

// ── Main evaluation entry point ───────────────────────────────────────────────

/**
 * Evaluate cash-gap alerts for all drivers in the current fleet data.
 * Piggybacks the fleet record cache — free if called after buildFleetContext.
 * Skips eval sessions and fails SAFE (returns [] on any error).
 *
 * @param {string} sessionId - current chat session ID
 * @returns {Promise<Array>} open alerts (rows enriched with driver_name, metric_value)
 */
async function evaluateAlerts(sessionId) {
  if (sessionId && sessionId.startsWith("eval")) return [];
  if (!SB_URL || !SB_KEY) return [];
  try {
    const record = await getFleetRecord();
    if (!record) return [];
    const entries = decodeHistory(record);
    if (entries.length === 0) return [];

    const currEntry = entries[entries.length - 1];
    const prevEntry = entries.length >= 2 ? entries[entries.length - 2] : null;
    const nowMs = Date.now();

    const existingAlerts = await fetchOpenAlerts();
    const openAlerts = [];

    for (const driver of (currEntry.drivers || [])) {
      const gapNow = driver.cashGap || 0;
      if (gapNow === 0 && !existingAlerts.has(driver.driverId || driver.name)) continue;

      const driverKey = driver.driverId || driver.name;
      if (!driverKey) continue;
      const driverName = driver.name || driverKey;

      const prevDriver = prevEntry
        ? (prevEntry.drivers || []).find((d) => (d.driverId || d.name) === driverKey)
        : null;
      const gapPrev = prevDriver !== undefined && prevDriver !== null
        ? (prevDriver.cashGap || 0)
        : null;

      const row = existingAlerts.get(driverKey) || null;
      const t = computeTransition(row, gapNow, gapPrev, nowMs);

      if (t.action === "none") continue;

      if (t.action === "raise") {
        await upsertAlertRow("cash_gap", driverKey, driverName, t.fields);
      } else if (t.fields) {
        await patchAlert("cash_gap", driverKey, t.fields);
      }

      if (t.isOpen) {
        const updatedRow = row ? { ...row, ...t.fields, driver_name: driverName } : { condition: "cash_gap", driver_key: driverKey, driver_name: driverName, ...t.fields };
        openAlerts.push(updatedRow);
      }
    }

    return openAlerts;
  } catch (err) {
    console.error("[M8 alerting] eval error (non-fatal):", err.message);
    return [];
  }
}

/**
 * Detect and apply acks from a chat message.
 * Call AFTER evaluateAlerts so openAlerts is available.
 */
async function applyAcks(message, openAlerts) {
  const keys = detectAlertAck(message, openAlerts);
  if (keys.length === 0) return;
  const ackedAt = new Date().toISOString();
  for (const driverKey of keys) {
    await patchAlert("cash_gap", driverKey, { state: "acknowledged", acked_at: ackedAt }).catch(() => {});
  }
}

module.exports = {
  computeTransition,
  buildAlertText,
  detectAlertAck,
  evaluateAlerts,
  applyAcks,
};
