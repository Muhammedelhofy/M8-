/**
 * M8 Stateful Alerting — lib/alerting.js  (Build-20 + Build-21 + Build-22)
 *
 * Condition #1: CASH GAP (cash_collected_by_driver - cash_deposited per driver).
 * Condition #2: TIER SLIP (ground truth — Bolt's own tier.level dropped) +
 *               TIER WATCH (acceptance/finish below the existing coaching floor
 *               for 2+ consecutive days — a leading risk signal, never a
 *               predicted "drops in N days" date: M8 does not know Bolt's real
 *               tier-promotion thresholds, see fleet.js renderTierWatchPacket).
 * Condition #3: CHURN RISK — reuses fleet.js driverChurn() deterministic composite
 *               (going-dark / declining acceptance-utilisation / below-target
 *               streak over the last 14 complete days). Severity 3/info; the
 *               reasons[] the composite computed are stored verbatim so the
 *               brief quotes them, never invents a cause.
 *
 * Pure deterministic code — NO LLM in raise/resolve decisions. The honesty spine
 * extends to ops alerts: conditions are code over the fleet packet, never a model guess.
 *
 * Evaluation piggybacks the fleet fetch (no new cron).
 * State machine: raised → acknowledged → in_progress → resolved → re_raised / snoozed.
 * All thresholds FIXED IN CODE per spec §2 (deterministic, not env-tunable).
 *
 * PURE CORE: computeTransition / computeTierSlipTransition / computeTierWatchTransition /
 * computeChurnTransition / buildAlertText / detectAlertAck are IO-free and
 * PS-mirror-testable. IO lives in evaluateAlerts / applyAcks.
 */

const { getFleetRecord, decodeHistory, tierName, COACH_ACCEPT, COACH_FINISH,
        driverChurn, CHURN_FLAG_SCORE, ymdKey, periodYMD, riyadhTodayYMD } = require("./fleet");

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

// ── Tier-slip / tier-watch thresholds (FIXED IN CODE per spec §2 + design note) ───
const TIER_WINDOW_DAYS  = 7;   // compare current tier.level vs this many days ago
const TIER_WORSEN_LEVEL = 1;   // re-raise if tier drops >= 1 more full level below last check
const WATCH_WORSEN_PTS  = 10;  // tier_watch re-raise if acceptance drops >= 10pts further

// ── Churn-risk thresholds (FIXED IN CODE per spec §2) ──────────────────────────
const CHURN_WINDOW_DAYS  = 14;  // driverChurn() window — last N complete days
const CHURN_WORSEN_DELTA = 1;   // re-raise if composite risk score rises by >= this

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
 * Compute the next state machine transition for ONE driver's tier-slip alert.
 * GROUND TRUTH ONLY: raises when Bolt's own tier.level has actually fallen vs
 * `baselineLevel` (the level recorded TIER_WINDOW_DAYS ago). No predicted
 * "drops in N days" — see file header. Pure — no IO, PS-mirror-testable.
 *
 * @param {object|null} row     - existing fleet_alerts row (condition='tier_slip'), or null
 * @param {number} levelNow     - current tier.level (0=Bronze..4=Diamond, -1=unknown)
 * @param {number} baselineLevel - tier.level TIER_WINDOW_DAYS ago, or -1 if unavailable
 * @param {number} nowMs        - Date.now()
 * @returns {{ action, isOpen, fields }}
 */
function computeTierSlipTransition(row, levelNow, baselineLevel, nowMs) {
  const hasLevels = levelNow >= 0 && baselineLevel >= 0;
  const dropped = hasLevels && levelNow < baselineLevel;
  const sevFor = (raiseLevel, curLevel) => ((raiseLevel - curLevel) >= 2 ? 1 : 2);

  // ── No existing alert ──────────────────────────────────────────────────────
  if (!row) {
    if (dropped) {
      return {
        action: "raise", isOpen: true,
        fields: {
          state: "raised", severity: sevFor(baselineLevel, levelNow),
          metric_value: levelNow, raise_value: baselineLevel, threshold: baselineLevel,
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
      return { action: "skip", isOpen, fields: { metric_value: levelNow } };
    }
  }

  // ── Resolved: check for recurrence (dropped below the recovered level again) ─
  if (state === "resolved") {
    if (!hasLevels || levelNow >= row.raise_value) return { action: "none", isOpen: false };
    const newRaiseValue = Math.max(row.raise_value, baselineLevel);
    const resolvedAtMs = row.resolved_at ? new Date(row.resolved_at).getTime() : 0;
    const daysSinceResolved = (nowMs - resolvedAtMs) / 86400000;
    if (daysSinceResolved <= RECUR_WIN_DAYS) {
      return {
        action: "re_raise", isOpen: true,
        fields: {
          state: "re_raised", metric_value: levelNow, raise_value: newRaiseValue,
          severity: sevFor(newRaiseValue, levelNow),
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
        state: "raised", severity: sevFor(newRaiseValue, levelNow),
        metric_value: levelNow, raise_value: newRaiseValue, threshold: newRaiseValue,
        consecutive_clear: 0, times_raised: (row.times_raised || 1) + 1,
        first_raised_at: new Date(nowMs).toISOString(),
        last_checked_at: new Date(nowMs).toISOString(),
        acked_at: null, resolved_at: null, suppression_until: null,
      },
    };
  }

  // ── Open: worsening — dropped >= 1 more full level below the last reading ──
  if (isOpen && hasLevels && levelNow <= (row.metric_value ?? row.raise_value) - TIER_WORSEN_LEVEL) {
    return {
      action: "re_raise", isOpen: true,
      fields: {
        state: "re_raised", metric_value: levelNow,
        raise_value: Math.max(row.raise_value, baselineLevel),
        severity: 1,
        times_raised: (row.times_raised || 1) + 1,
        consecutive_clear: 0, suppression_until: null, acked_at: null,
        last_checked_at: new Date(nowMs).toISOString(),
      },
    };
  }

  // ── Snoozed: check expiry ──────────────────────────────────────────────────
  if (state === "snoozed" && row.suppression_until) {
    const untilMs = new Date(row.suppression_until).getTime();
    if (nowMs < untilMs) {
      return { action: "skip", isOpen: false, fields: { metric_value: levelNow, last_checked_at: new Date(nowMs).toISOString() } };
    }
  }

  // ── Open: recovery check (tier returned to >= the level it dropped from) ──
  if (isOpen && hasLevels && levelNow >= row.raise_value) {
    const newClearCount = (row.consecutive_clear || 0) + 1;
    if (newClearCount >= 2) {
      return {
        action: "resolve", isOpen: false,
        fields: {
          state: "resolved", consecutive_clear: newClearCount, metric_value: levelNow,
          resolved_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
        },
      };
    }
    return {
      action: "update_clear", isOpen: true,
      fields: { consecutive_clear: newClearCount, metric_value: levelNow, last_checked_at: new Date(nowMs).toISOString() },
    };
  }

  // ── Open: still below the level it dropped from — update metric ───────────
  if (isOpen) {
    return {
      action: "update", isOpen: true,
      fields: { consecutive_clear: 0, metric_value: hasLevels ? levelNow : row.metric_value, last_checked_at: new Date(nowMs).toISOString() },
    };
  }

  return { action: "none", isOpen: false };
}

/**
 * Compute the next state machine transition for ONE driver's tier-watch alert.
 * Leading-indicator signal: acceptance/finish below the existing coaching floor
 * (COACH_ACCEPT/COACH_FINISH — proxy "weak lever" constants, NOT Bolt's real tier
 * cutoffs) for >= 2 consecutive days while the driver holds Silver+ (has a tier
 * to lose). Framed as "weak on lever for N days", never a predicted drop date.
 * Pure — no IO, PS-mirror-testable.
 *
 * @param {object|null} row   - existing fleet_alerts row (condition='tier_watch'), or null
 * @param {boolean} weakNow   - true if accept/finish below the coaching floor today
 * @param {boolean|null} weakPrev - same for the prior synced day, or null if unavailable
 * @param {{accept:number, finish:number, tier:number}} snapshot - current metrics
 * @param {number} nowMs      - Date.now()
 * @returns {{ action, isOpen, fields }}
 */
function computeTierWatchTransition(row, weakNow, weakPrev, snapshot, nowMs) {
  const consecutiveWeak = weakNow && weakPrev === true;

  // ── No existing alert ──────────────────────────────────────────────────────
  if (!row) {
    if (consecutiveWeak) {
      return {
        action: "raise", isOpen: true,
        fields: {
          state: "raised", severity: 3,
          metric_value: snapshot.accept, raise_value: snapshot.accept, threshold: COACH_ACCEPT,
          consecutive_clear: 0, times_raised: 1,
          first_raised_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
          acked_at: null, resolved_at: null, suppression_until: null,
          metadata: { history: [], finish: snapshot.finish, tier: snapshot.tier },
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
      return { action: "skip", isOpen, fields: { metric_value: snapshot.accept } };
    }
  }

  // ── Resolved: check for recurrence ────────────────────────────────────────
  if (state === "resolved") {
    if (!consecutiveWeak) return { action: "none", isOpen: false };
    const resolvedAtMs = row.resolved_at ? new Date(row.resolved_at).getTime() : 0;
    const daysSinceResolved = (nowMs - resolvedAtMs) / 86400000;
    if (daysSinceResolved <= RECUR_WIN_DAYS) {
      return {
        action: "re_raise", isOpen: true,
        fields: {
          state: "re_raised", metric_value: snapshot.accept, raise_value: snapshot.accept,
          severity: 3, times_raised: (row.times_raised || 1) + 1,
          consecutive_clear: 0, resolved_at: null, acked_at: null,
          last_checked_at: new Date(nowMs).toISOString(),
          metadata: { history: [], finish: snapshot.finish, tier: snapshot.tier },
        },
      };
    }
    return {
      action: "raise", isOpen: true,
      fields: {
        state: "raised", severity: 3,
        metric_value: snapshot.accept, raise_value: snapshot.accept, threshold: COACH_ACCEPT,
        consecutive_clear: 0, times_raised: (row.times_raised || 1) + 1,
        first_raised_at: new Date(nowMs).toISOString(),
        last_checked_at: new Date(nowMs).toISOString(),
        acked_at: null, resolved_at: null, suppression_until: null,
        metadata: { history: [], finish: snapshot.finish, tier: snapshot.tier },
      },
    };
  }

  // ── Open: worsening — acceptance dropped >= WATCH_WORSEN_PTS further ───────
  if (isOpen && weakNow && (row.raise_value - snapshot.accept) >= WATCH_WORSEN_PTS) {
    return {
      action: "re_raise", isOpen: true,
      fields: {
        state: "re_raised", metric_value: snapshot.accept, raise_value: snapshot.accept,
        severity: 3, times_raised: (row.times_raised || 1) + 1,
        consecutive_clear: 0, suppression_until: null, acked_at: null,
        last_checked_at: new Date(nowMs).toISOString(),
        metadata: { history: [], finish: snapshot.finish, tier: snapshot.tier },
      },
    };
  }

  // ── Snoozed: check expiry (worsening already handled above — un-snoozes) ──
  if (state === "snoozed" && row.suppression_until) {
    const untilMs = new Date(row.suppression_until).getTime();
    if (nowMs < untilMs) {
      return { action: "skip", isOpen: false, fields: { metric_value: snapshot.accept, last_checked_at: new Date(nowMs).toISOString() } };
    }
  }

  // ── Open: resolution check (no longer weak) ────────────────────────────────
  if (isOpen && !weakNow) {
    const newClearCount = (row.consecutive_clear || 0) + 1;
    if (newClearCount >= 2) {
      return {
        action: "resolve", isOpen: false,
        fields: {
          state: "resolved", consecutive_clear: newClearCount, metric_value: snapshot.accept,
          resolved_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
        },
      };
    }
    return {
      action: "update_clear", isOpen: true,
      fields: { consecutive_clear: newClearCount, metric_value: snapshot.accept, last_checked_at: new Date(nowMs).toISOString() },
    };
  }

  // ── Open: still weak — update metric ───────────────────────────────────────
  if (isOpen) {
    return {
      action: "update", isOpen: true,
      fields: {
        consecutive_clear: 0, metric_value: snapshot.accept, last_checked_at: new Date(nowMs).toISOString(),
        metadata: { history: [], finish: snapshot.finish, tier: snapshot.tier },
      },
    };
  }

  return { action: "none", isOpen: false };
}

/**
 * Compute the next state machine transition for ONE driver's churn-risk alert.
 * Wraps fleet.js driverChurn()'s deterministic composite (going-dark / declining
 * acceptance-utilisation / below-target streak). `flagged` is the matching entry
 * from driverChurn(...).flagged (or null if this driver isn't currently flagged),
 * carrying { score, reasons[], activeDays, lastActive } computed by the composite —
 * this function never invents a reason, only state-machines the score. Severity is
 * 1 if score >= 3 (multiple compounding signals), else 2 (meets the flag floor).
 * Pure — no IO, PS-mirror-testable.
 *
 * @param {object|null} row     - existing fleet_alerts row (condition='churn_risk'), or null
 * @param {object|null} flagged - { score, reasons, activeDays, lastActive } or null
 * @param {number} nowMs        - Date.now()
 * @returns {{ action, isOpen, fields }}
 */
function computeChurnTransition(row, flagged, nowMs) {
  const isFlagged = !!flagged;
  const scoreNow = flagged ? flagged.score : 0;
  const sevFor = (score) => (score >= 3 ? 1 : 2);
  const meta = (f) => ({ history: [], reasons: f.reasons, lastActive: f.lastActive });

  // ── No existing alert ──────────────────────────────────────────────────────
  if (!row) {
    if (isFlagged) {
      return {
        action: "raise", isOpen: true,
        fields: {
          state: "raised", severity: sevFor(scoreNow),
          metric_value: scoreNow, raise_value: scoreNow, threshold: CHURN_FLAG_SCORE,
          consecutive_clear: 0, times_raised: 1,
          first_raised_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
          acked_at: null, resolved_at: null, suppression_until: null,
          metadata: meta(flagged),
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
      return { action: "skip", isOpen, fields: { metric_value: scoreNow } };
    }
  }

  // ── Resolved: check for recurrence ────────────────────────────────────────
  if (state === "resolved") {
    if (!isFlagged) return { action: "none", isOpen: false };
    const resolvedAtMs = row.resolved_at ? new Date(row.resolved_at).getTime() : 0;
    const daysSinceResolved = (nowMs - resolvedAtMs) / 86400000;
    if (daysSinceResolved <= RECUR_WIN_DAYS) {
      return {
        action: "re_raise", isOpen: true,
        fields: {
          state: "re_raised", metric_value: scoreNow, raise_value: scoreNow,
          severity: sevFor(scoreNow), times_raised: (row.times_raised || 1) + 1,
          consecutive_clear: 0, resolved_at: null, acked_at: null,
          last_checked_at: new Date(nowMs).toISOString(),
          metadata: meta(flagged),
        },
      };
    }
    return {
      action: "raise", isOpen: true,
      fields: {
        state: "raised", severity: sevFor(scoreNow),
        metric_value: scoreNow, raise_value: scoreNow, threshold: CHURN_FLAG_SCORE,
        consecutive_clear: 0, times_raised: (row.times_raised || 1) + 1,
        first_raised_at: new Date(nowMs).toISOString(),
        last_checked_at: new Date(nowMs).toISOString(),
        acked_at: null, resolved_at: null, suppression_until: null,
        metadata: meta(flagged),
      },
    };
  }

  // ── Open: worsening — composite score rose >= CHURN_WORSEN_DELTA above raise_value ──
  if (isOpen && isFlagged && (scoreNow - (row.raise_value || 0)) >= CHURN_WORSEN_DELTA) {
    return {
      action: "re_raise", isOpen: true,
      fields: {
        state: "re_raised", metric_value: scoreNow, raise_value: scoreNow,
        severity: sevFor(scoreNow), times_raised: (row.times_raised || 1) + 1,
        consecutive_clear: 0, suppression_until: null, acked_at: null,
        last_checked_at: new Date(nowMs).toISOString(),
        metadata: meta(flagged),
      },
    };
  }

  // ── Snoozed: check expiry (worsening already handled above — un-snoozes) ──
  if (state === "snoozed" && row.suppression_until) {
    const untilMs = new Date(row.suppression_until).getTime();
    if (nowMs < untilMs) {
      return { action: "skip", isOpen: false, fields: { metric_value: scoreNow, last_checked_at: new Date(nowMs).toISOString() } };
    }
  }

  // ── Open: resolution check (no longer flagged) ─────────────────────────────
  if (isOpen && !isFlagged) {
    const newClearCount = (row.consecutive_clear || 0) + 1;
    if (newClearCount >= 2) {
      return {
        action: "resolve", isOpen: false,
        fields: {
          state: "resolved", consecutive_clear: newClearCount, metric_value: 0,
          resolved_at: new Date(nowMs).toISOString(),
          last_checked_at: new Date(nowMs).toISOString(),
        },
      };
    }
    return {
      action: "update_clear", isOpen: true,
      fields: { consecutive_clear: newClearCount, metric_value: 0, last_checked_at: new Date(nowMs).toISOString() },
    };
  }

  // ── Open: still flagged — update metric/reasons ────────────────────────────
  if (isOpen) {
    return {
      action: "update", isOpen: true,
      fields: {
        consecutive_clear: 0, metric_value: scoreNow, severity: sevFor(scoreNow),
        last_checked_at: new Date(nowMs).toISOString(),
        metadata: meta(flagged),
      },
    };
  }

  return { action: "none", isOpen: false };
}

/**
 * Build the alert text block for injection into the system prompt.
 * Groups openAlerts by condition and produces one block per condition,
 * in spec §3 priority order: cash_gap > tier_slip > tier_watch > churn_risk.
 * Pure — no IO.
 *
 * @param {Array} openAlerts - alerts returned by evaluateAlerts (only isOpen ones)
 * @returns {string} ready to append to systemInstruction, empty string if none
 */
function buildAlertText(openAlerts) {
  if (!openAlerts || openAlerts.length === 0) return "";

  const byCondition = { cash_gap: [], tier_slip: [], tier_watch: [], churn_risk: [] };
  for (const a of openAlerts) {
    const cond = a.condition || "cash_gap";
    (byCondition[cond] || (byCondition[cond] = [])).push(a);
  }

  const blocks = [];
  if (byCondition.cash_gap.length) blocks.push(buildCashGapText(byCondition.cash_gap));
  if (byCondition.tier_slip.length) blocks.push(buildTierSlipText(byCondition.tier_slip));
  if (byCondition.tier_watch.length) blocks.push(buildTierWatchText(byCondition.tier_watch));
  if (byCondition.churn_risk.length) blocks.push(buildChurnText(byCondition.churn_risk));

  return blocks.length ? `\n\n${blocks.join("\n\n")}` : "";
}

function buildCashGapText(alerts) {
  const sorted = [...alerts].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    return (b.metric_value || 0) - (a.metric_value || 0);
  });

  const totalGap = sorted.reduce((s, a) => s + (a.metric_value || 0), 0);

  if (sorted.length > BRIEF_CAP) {
    const worst = sorted[0];
    const worstAge = ageDays(worst);
    return (
      `FLEET ALERT — CASH GAP: ${sorted.length} drivers collectively owe SAR ${Math.round(totalGap)} in uncollected cash. ` +
      `Worst: ${worst.driver_name} (SAR ${Math.round(worst.metric_value || 0)}, ` +
      `${Math.round(worstAge)} days open${worst.times_raised > 1 ? `, raised ${worst.times_raised}×` : ""}). ` +
      `Surface this proactively when discussing fleet performance.`
    );
  }
  const lines = sorted.map((a) => {
    const d = Math.round(ageDays(a));
    const recur = a.state === "re_raised" ? ", RECURRED" : "";
    const times = a.times_raised > 1 ? `, raised ${a.times_raised}×` : "";
    return `${a.driver_name}: SAR ${Math.round(a.metric_value || 0)} (${d} days${times}${recur})`;
  });
  const highPriority = sorted.some((a) => a.severity === 1);
  return (
    `FLEET ALERT — CASH GAP${highPriority ? " ⚠ HIGH PRIORITY" : ""}: ${lines.join(" | ")}. ` +
    `Surface this to Muhammad if the conversation touches fleet, cash, or deposits.`
  );
}

function buildTierSlipText(alerts) {
  const sorted = [...alerts].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    return ((b.raise_value || 0) - (b.metric_value || 0)) - ((a.raise_value || 0) - (a.metric_value || 0));
  });

  if (sorted.length > BRIEF_CAP) {
    const worst = sorted[0];
    return (
      `FLEET ALERT — TIER SLIP: ${sorted.length} drivers have dropped tier (GROUND TRUTH from Bolt's tier field). ` +
      `Worst: ${worst.driver_name} (${tierName(worst.raise_value)}→${tierName(worst.metric_value)}` +
      `${worst.times_raised > 1 ? `, recurred ${worst.times_raised}×` : ""}). ` +
      `Surface this proactively when discussing fleet performance or driver tiers.`
    );
  }
  const lines = sorted.map((a) => {
    const recur = a.state === "re_raised" ? ", RECURRED" : "";
    const times = a.times_raised > 1 ? `, dropped ${a.times_raised}×` : "";
    return `${a.driver_name}: ${tierName(a.raise_value)}→${tierName(a.metric_value)}${times}${recur}`;
  });
  const highPriority = sorted.some((a) => a.severity === 1);
  return (
    `FLEET ALERT — TIER SLIP${highPriority ? " ⚠ HIGH PRIORITY" : ""}: ${lines.join(" | ")}. ` +
    `GROUND TRUTH from Bolt's own tier field — these drivers' tier level actually fell. ` +
    `Surface if discussing fleet performance, tiers, or these drivers.`
  );
}

function buildTierWatchText(alerts) {
  const sorted = [...alerts].sort((a, b) => (a.metric_value || 0) - (b.metric_value || 0));
  const lines = sorted.map((a) => {
    const finish = a.metadata && a.metadata.finish;
    const weak = [];
    if (a.metric_value > 0 && a.metric_value < COACH_ACCEPT) weak.push(`acceptance ${Math.round(a.metric_value)}%`);
    if (finish != null && finish > 0 && finish < COACH_FINISH) weak.push(`finish ${Math.round(finish)}%`);
    const recur = a.state === "re_raised" ? ", RECURRED" : "";
    return `${a.driver_name}: ${weak.length ? weak.join(" + ") : "weak lever"}${recur}`;
  });
  return (
    `FLEET WATCH — TIER RISK: ${lines.join(" | ")}. ` +
    `These drivers are below the coaching floor on the levers tier demotions hinge on — ` +
    `a leading risk signal, NOT a predicted drop date (M8 does not know Bolt's exact tier cutoffs). ` +
    `Mention if coaching or tier risk comes up.`
  );
}

function buildChurnText(alerts) {
  const sorted = [...alerts].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    return (b.metric_value || 0) - (a.metric_value || 0);
  });

  if (sorted.length > BRIEF_CAP) {
    const worst = sorted[0];
    const reasons = (worst.metadata && worst.metadata.reasons) || [];
    return (
      `FLEET WATCH — CHURN RISK: ${sorted.length} drivers show early-warning signs of disengagement. ` +
      `Worst: ${worst.driver_name}${reasons.length ? ` (${reasons[0]})` : ""}` +
      `${worst.times_raised > 1 ? `, recurred ${worst.times_raised}×` : ""}. ` +
      `Surface this proactively when discussing fleet retention or driver performance.`
    );
  }
  const lines = sorted.map((a) => {
    const reasons = (a.metadata && a.metadata.reasons) || [];
    const recur = a.state === "re_raised" ? ", RECURRED" : "";
    return `${a.driver_name}: ${reasons.length ? reasons.join("; ") : "at risk"}${recur}`;
  });
  return (
    `FLEET WATCH — CHURN RISK: ${lines.join(" | ")}. ` +
    `DETERMINISTIC composite (going-dark / declining acceptance-utilisation / below-target streak over the last ${CHURN_WINDOW_DAYS} complete days) — ` +
    `quote and explain the reasons shown, never invent a driver or a cause. ` +
    `These are early-warning patterns, NOT a stated intent to quit. Mention if discussing fleet retention, driver performance, or these drivers.`
  );
}

function ageDays(alert) {
  const first = alert.first_raised_at ? new Date(alert.first_raised_at).getTime() : Date.now();
  return (Date.now() - first) / 86400000;
}

/**
 * Detect acknowledgement signals in a chat message.
 * Returns [{ driver_key, condition }] for alerts to ack.
 * Pure — no IO.
 */
const TOPIC_PATTERNS = {
  cash_gap: /\b(cash|deposit|gap|collect|owe|owes|paid|payment|balance)\b/i,
  tier_slip: /\b(tier|level|bronze|silver|gold|platinum|diamond|slip|slipp\w*|dropped|demot\w*|downgrad\w*)\b/i,
  tier_watch: /\b(tier|level|accept\w*|finish\w*|coach\w*|risk|watch)\b/i,
  churn_risk: /\b(churn\w*|attrition|retention|risk|watch|going\s*dark|dropping\s*off|disengag\w*|inactiv\w*|leav\w*|quit\w*)\b/i,
};
function detectAlertAck(message, openAlerts) {
  if (!openAlerts || openAlerts.length === 0) return [];
  const msg = (message || "").toLowerCase();
  // UI chip: "ack:<id>"
  const chipMatch = msg.match(/\back:(\d+)\b/);
  if (chipMatch) {
    const id = parseInt(chipMatch[1], 10);
    const a = openAlerts.find((x) => x.id === id);
    return a ? [{ driver_key: a.driver_key, condition: a.condition || "cash_gap" }] : [];
  }
  // Chat: names a driver AND a topic matching that alert's condition
  const out = [];
  for (const a of openAlerts) {
    const pattern = TOPIC_PATTERNS[a.condition] || TOPIC_PATTERNS.cash_gap;
    if (!pattern.test(message)) continue;
    const name = (a.driver_name || "").toLowerCase().split(/\s+/);
    if (name.some((part) => part.length > 2 && msg.includes(part))) {
      out.push({ driver_key: a.driver_key, condition: a.condition || "cash_gap" });
    }
  }
  return out;
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
  const rows = await sbFetch(`fleet_alerts?condition=in.(cash_gap,tier_slip,tier_watch,churn_risk)&state=not.eq.resolved&select=*`);
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.map((r) => [`${r.condition}:${r.driver_key}`, r]));
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

// Apply a computeTransition result for ANY condition: writes the row (if needed)
// and appends to openAlerts (if the resulting state is open). Shared by all 3 conditions.
async function applyAndCollect(condition, driverKey, driverName, row, t, openAlerts) {
  if (t.action === "none") return;

  if (t.action === "raise") {
    await upsertAlertRow(condition, driverKey, driverName, t.fields);
  } else if (t.fields) {
    await patchAlert(condition, driverKey, t.fields);
  }

  if (t.isOpen) {
    const updatedRow = row
      ? { ...row, ...t.fields, driver_name: driverName, condition }
      : { condition, driver_key: driverKey, driver_name: driverName, ...t.fields };
    openAlerts.push(updatedRow);
  }
}

// ── Main evaluation entry point ───────────────────────────────────────────────

/**
 * Evaluate cash-gap, tier-slip, tier-watch, and churn-risk alerts for all drivers
 * in the current fleet data. Piggybacks the fleet record cache — free if called
 * after buildFleetContext. Skips eval sessions and fails SAFE (returns [] on any error).
 *
 * @param {string} sessionId - current chat session ID
 * @returns {Promise<Array>} open alerts (rows enriched with driver_name, condition)
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
    const baselineEntry = entries.length > TIER_WINDOW_DAYS ? entries[entries.length - 1 - TIER_WINDOW_DAYS] : null;
    const nowMs = Date.now();

    // Churn-risk composite: same "last N complete days" window as the chat-facing
    // churnRef path (excludes an in-progress today so the streak/trend isn't noisy).
    const todayKey = ymdKey(riyadhTodayYMD());
    const completeIdx = entries.map((_, i) => i)
      .filter((i) => { const k = ymdKey(periodYMD(entries[i].period)); return k >= 0 && k < todayKey; });
    const churnResult = driverChurn(entries, completeIdx.slice(-CHURN_WINDOW_DAYS));
    const flaggedByKey = new Map((churnResult ? churnResult.flagged : []).map((f) => [f.key, f]));

    const existingAlerts = await fetchOpenAlerts();
    const openAlerts = [];

    for (const driver of (currEntry.drivers || [])) {
      const driverKey = driver.driverId || driver.name;
      if (!driverKey) continue;
      const driverName = driver.name || driverKey;

      const prevDriver = prevEntry
        ? (prevEntry.drivers || []).find((d) => (d.driverId || d.name) === driverKey)
        : null;

      // ── Condition: cash_gap ──────────────────────────────────────────────
      const gapNow = driver.cashGap || 0;
      const rowCash = existingAlerts.get(`cash_gap:${driverKey}`) || null;
      if (gapNow !== 0 || rowCash) {
        const gapPrev = prevDriver !== undefined && prevDriver !== null ? (prevDriver.cashGap || 0) : null;
        const t = computeTransition(rowCash, gapNow, gapPrev, nowMs);
        await applyAndCollect("cash_gap", driverKey, driverName, rowCash, t, openAlerts);
      }

      // ── Condition: tier_slip (ground truth — tier.level fell vs N days ago) ─
      const levelNow = driver.tier ? driver.tier.level : -1;
      const rowSlip = existingAlerts.get(`tier_slip:${driverKey}`) || null;
      if (levelNow >= 0 || rowSlip) {
        let baselineLevel = -1;
        if (baselineEntry) {
          const bd = (baselineEntry.drivers || []).find((d) => (d.driverId || d.name) === driverKey);
          baselineLevel = bd && bd.tier ? bd.tier.level : -1;
        }
        const t = computeTierSlipTransition(rowSlip, levelNow, baselineLevel, nowMs);
        await applyAndCollect("tier_slip", driverKey, driverName, rowSlip, t, openAlerts);
      }

      // ── Condition: tier_watch (acceptance/finish below coaching floor) ────
      const accept = driver.acceptance || 0;
      const finish = driver.finishRate || 0;
      const weakNow = levelNow >= 1 && driver.isActive &&
        ((accept > 0 && accept < COACH_ACCEPT) || (finish > 0 && finish < COACH_FINISH));
      const rowWatch = existingAlerts.get(`tier_watch:${driverKey}`) || null;
      if (weakNow || rowWatch) {
        let weakPrev = null;
        if (prevDriver) {
          const pLevel = prevDriver.tier ? prevDriver.tier.level : -1;
          const pAccept = prevDriver.acceptance || 0;
          const pFinish = prevDriver.finishRate || 0;
          weakPrev = pLevel >= 1 && prevDriver.isActive &&
            ((pAccept > 0 && pAccept < COACH_ACCEPT) || (pFinish > 0 && pFinish < COACH_FINISH));
        }
        const t = computeTierWatchTransition(rowWatch, weakNow, weakPrev, { accept, finish, tier: levelNow }, nowMs);
        await applyAndCollect("tier_watch", driverKey, driverName, rowWatch, t, openAlerts);
      }

      // ── Condition: churn_risk (driverChurn composite over the last 14 complete days) ─
      const flagged = flaggedByKey.get(driverKey) || null;
      const rowChurn = existingAlerts.get(`churn_risk:${driverKey}`) || null;
      if (flagged || rowChurn) {
        const t = computeChurnTransition(rowChurn, flagged, nowMs);
        await applyAndCollect("churn_risk", driverKey, driverName, rowChurn, t, openAlerts);
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
  const targets = detectAlertAck(message, openAlerts);
  if (targets.length === 0) return;
  const ackedAt = new Date().toISOString();
  for (const { driver_key, condition } of targets) {
    await patchAlert(condition, driver_key, { state: "acknowledged", acked_at: ackedAt }).catch(() => {});
  }
}

module.exports = {
  computeTransition,
  computeTierSlipTransition,
  computeTierWatchTransition,
  computeChurnTransition,
  buildAlertText,
  detectAlertAck,
  evaluateAlerts,
  applyAcks,
};
