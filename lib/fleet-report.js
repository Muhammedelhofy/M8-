/**
 * M8 Output Upgrade Phase A — lib/fleet-report.js  (Build-95)
 *
 * The Fleet Intelligence Report: a single deterministic block that turns the raw
 * fleet earnings blob + the per-driver cost profiles into the COMPANY's projected
 * month-end P&L, plus a short list of recommended actions ("call X — 4 days
 * offline", "encourage Y — on pace for the 5000 tier"). CODE computes the truth;
 * the LLM only narrates it. No LLM calls, no Supabase IO inside the pure builders.
 *
 * THE MONEY MODEL (Build-91 canonical — see lib/pnl-engine.js, the single source
 * of truth this module imports rather than re-hardcoding):
 *   - A driver's NET earnings are the DRIVER's money. They are NOT company revenue.
 *   - The company earns exactly two things per driver:
 *       1. RENTAL income — the monthly car rental it charges the driver.
 *       2. Its 50% share of the Bolt performance bonus, by tier of the driver's
 *          monthly net: net>=6000 -> 1250, >=5000 -> 1000, >=4000 -> 750, else 0.
 *   - The driver's net is therefore only the bonus-tier INPUT.
 *   - Company P&L per driver = rental_income + bonus_share - (salary+fuel+other).
 *
 * PROJECTION (per the Build-95 spec, distinct from morning-brief.js):
 *   Mid-month, the realized tier isn't settled yet, so the report projects each
 *   driver's full-month net at their current CALENDAR pace and tiers the bonus on
 *   that projection (so the P&L is meaningful before month-end):
 *       projectedNet = (driverNet / daysElapsed) * 30
 *   where daysElapsed = calendar days into the month (day-of-month of the latest
 *   COMPLETE day). This differs from morning-brief.js, which projects on a
 *   driver's ACTIVE days x working-days — that brief answers "will this driver hit
 *   their 5000 target"; this report answers "what does the fleet earn the company".
 *   Both are honest views; this one is labelled an ESTIMATE everywhere it surfaces.
 *
 * Every export fails SAFE: bad/empty input yields an empty report or "" text, so
 * the orchestrator degrades to its plain fleet packet rather than crashing.
 */
"use strict";

// Canonical bonus/tier arithmetic — single source of truth. Guarded so a missing
// engine degrades to a safe inline fallback instead of breaking this module.
let _pnl = null;
try { _pnl = require("./pnl-engine"); } catch (_) { _pnl = null; }

function companyRevenueFromDriver(driverNet, rentalAmount) {
  if (_pnl && typeof _pnl.companyRevenueFromDriver === "function") {
    try { return _pnl.companyRevenueFromDriver(driverNet, rentalAmount); } catch (_) { /* fall through */ }
  }
  const net = Number(driverNet || 0);
  const rental = Number(rentalAmount || 0);
  const bonus = net >= 6000 ? 1250 : net >= 5000 ? 1000 : net >= 4000 ? 750 : 0;
  return { rental, bonus, total: rental + bonus };
}

function driverBonusTier(driverNet) {
  if (_pnl && typeof _pnl.driverBonusTier === "function") {
    try { return _pnl.driverBonusTier(driverNet); } catch (_) { /* fall through */ }
  }
  const net = Number(driverNet || 0);
  if (net >= 6000) return { min: 6000, gross: 2500, companyShare: 1250 };
  if (net >= 5000) return { min: 5000, gross: 2000, companyShare: 1000 };
  if (net >= 4000) return { min: 4000, gross: 1500, companyShare: 750 };
  return null;
}

// Read-only helpers from the fleet spine (for the decoded-entries input path).
// We only READ these pure helpers; this module never mutates lib/fleet.js.
let _fleet = null;
try { _fleet = require("./fleet"); } catch (_) { _fleet = null; }

// ── Config (env-tunable; same target the morning brief uses) ──────────────────
const TARGET_SAR        = Number(process.env.M8_DRIVER_TARGET   || 5000);
const PROJECT_DAYS      = Number(process.env.M8_PROJECT_DAYS    || 30);   // spec: * 30
const MIN_PROJECT_DAYS  = Number(process.env.M8_MIN_PROJECT_DAYS || 3);   // below this, no pace verdict
const OFFLINE_THRESHOLD = Number(process.env.M8_OFFLINE_DAYS    || 3);    // days since last active -> "call"
const BONUS_FLOOR       = 4000;  // below this projected net the company earns no Bolt bonus

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const _r0 = (v) => Math.round(Number(v) || 0);
const fmtMoney = (v) => (v == null ? "?" : Math.round(Number(v) || 0).toLocaleString("en-US"));
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

// A driver "had a trip" on a day if Bolt marked them active or they ran orders /
// earned net. Defensive across blob shapes (orders may be absent for some rows).
function hadTrip(d) {
  return (d.orders || 0) >= 1 || d.isActive || (d.netEarnings || 0) !== 0;
}

/**
 * Aggregate the decoded fleet history into one canonical month snapshot.
 * Counts only COMPLETE days in the current month (excludes today's partial), so
 * the projection denominator is a settled calendar count. Falls back to all
 * in-month days only if no complete day exists yet.
 *
 * @param {Array} entries  - decoded day-entries (ascending), as decodeHistory() returns
 * @param {object} [opts]  - { today: {y,m,d} } override for tests
 * @returns {{ drivers: Array, daysElapsed: number, daysInMonth: number, monthLabel: string }}
 *   drivers: [{ name, driverNet, daysActive, lastActiveDay }]
 */
function aggregateFleetMonth(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const periodYMD = _fleet && _fleet.periodYMD;
  const ymdKey = _fleet && _fleet.ymdKey;
  const today = opts.today || (_fleet && _fleet.riyadhTodayYMD ? _fleet.riyadhTodayYMD() : null);
  if (!periodYMD || !ymdKey || !today) {
    return { drivers: [], daysElapsed: 0, daysInMonth: 30, monthLabel: "" };
  }
  const year = today.y, month = today.m;
  const todayKey = ymdKey(today);
  const monthLabel = `${MONTH_ABBR[month]} ${year}`;
  const dim = daysInMonth(year, month);

  const inMonth = (p) => p && p.y === year && p.m === month;
  // Prefer COMPLETE days (before today); fall back to all in-month days if none.
  let dayKeys = [...new Set(list.map((e) => periodYMD(e.period)).filter((p) => inMonth(p) && ymdKey(p) < todayKey).map(ymdKey))];
  if (!dayKeys.length) {
    dayKeys = [...new Set(list.map((e) => periodYMD(e.period)).filter(inMonth).map(ymdKey))];
  }
  dayKeys.sort((a, b) => a - b);
  if (!dayKeys.length) return { drivers: [], daysElapsed: 0, daysInMonth: dim, monthLabel };

  const keySet = new Set(dayKeys);
  const latestKey = dayKeys[dayKeys.length - 1];
  const daysElapsed = latestKey % 100;  // ymdKey = y*10000 + m*100 + d  ->  %100 = day-of-month

  const byKey = new Map();
  for (const e of list) {
    const p = periodYMD(e.period);
    if (!p || !keySet.has(ymdKey(p))) continue;
    for (const d of (e.drivers || [])) {
      const name = (d.name || "").trim();
      if (!name || !hadTrip(d)) continue;
      const key = d.driverId || name.toLowerCase();
      const rec = byKey.get(key) || { name, driverNet: 0, daysActive: 0, lastActiveDay: 0 };
      rec.driverNet += Number(d.netEarnings || 0);
      rec.daysActive += 1;
      if (p.d > rec.lastActiveDay) rec.lastActiveDay = p.d;
      byKey.set(key, rec);
    }
  }
  return { drivers: [...byKey.values()], daysElapsed, daysInMonth: dim, monthLabel };
}

// Normalize whatever the caller hands us into the canonical month snapshot.
function toSnapshot(fleetData, opts) {
  if (Array.isArray(fleetData)) return aggregateFleetMonth(fleetData, opts);
  if (fleetData && Array.isArray(fleetData.drivers)) {
    return {
      drivers: fleetData.drivers,
      daysElapsed: Number(fleetData.daysElapsed || 0),
      daysInMonth: Number(fleetData.daysInMonth || 30),
      monthLabel: fleetData.monthLabel || "",
    };
  }
  if (fleetData && Array.isArray(fleetData.khair_history) && _fleet && _fleet.decodeHistory) {
    return aggregateFleetMonth(_fleet.decodeHistory(fleetData), opts);
  }
  return { drivers: [], daysElapsed: 0, daysInMonth: 30, monthLabel: "" };
}

// Short tier label from a projected-tier floor (0 = no bonus tier).
function tierLabel(floor) {
  if (floor >= 6000) return "T6";
  if (floor >= 5000) return "T5";
  if (floor >= 4000) return "T4";
  return "none";
}

/**
 * The deterministic recommended-actions engine. One action per driver, most
 * urgent first: an offline streak beats a P&L/pace verdict, which beats an
 * encouragement. Pace/P&L verdicts are suppressed until a driver has enough
 * active days (MIN_PROJECT_DAYS) so a single big/tiny day can't mislead.
 */
function buildRecommendations(perDriver, o) {
  const recs = [];
  for (const d of perDriver) {
    // 1. OFFLINE STREAK — hasn't worked in N days. Most urgent; call to check in.
    if (d.offlineStreak >= o.offlineThreshold) {
      recs.push({ driver: d.name, kind: "offline", priority: 1,
        reason: `${d.offlineStreak} days offline (last active day ${d.lastActiveDay} of the month) — call to check in` });
      continue;
    }
    if (d.daysActive < o.minProjectDays) continue;  // too little signal for a pace/P&L verdict
    // 2. COMPANY P&L NEGATIVE — costs exceed rental + bonus at this pace.
    if (d.hasProfile && d.netProfit < 0) {
      recs.push({ driver: d.name, kind: "unprofitable", priority: 2,
        reason: `company P&L ${d.netProfit >= 0 ? "+" : ""}${d.netProfit} SAR at this pace — costs exceed rental + bonus; review the rental or costs` });
      continue;
    }
    // 3. BELOW THE BONUS FLOOR — projected under 4000, so no Bolt bonus at all.
    if (d.projectedNet < o.bonusFloor) {
      recs.push({ driver: d.name, kind: "below_floor", priority: 3,
        reason: `projected ${d.projectedNet} SAR — below the ${o.bonusFloor} bonus floor; no Bolt bonus at this pace` });
      continue;
    }
    // 4. ON PACE FOR THE 5000 TIER but not banked yet — encourage to lock the bonus.
    if (d.onTrackFor5000 && d.driverNet < o.target) {
      const nearSix = d.projectedNet >= 5500;
      recs.push({ driver: d.name, kind: "encourage", priority: 4,
        reason: nearSix
          ? `projected ${d.projectedNet} SAR — close to the 6000 tier (1250 SAR bonus); a push locks it in`
          : `on pace for the 5000 tier (projected ${d.projectedNet} SAR, 1000 SAR company bonus) — encourage` });
      continue;
    }
  }
  recs.sort((a, b) => a.priority - b.priority);
  return recs;
}

/**
 * Build the structured Fleet Intelligence Report.
 *
 * @param {Array|object} fleetData    - decoded entries array, a fleet_data record,
 *                                       or a canonical { drivers, daysElapsed, daysInMonth, monthLabel }.
 *                                       drivers: [{ name, driverNet, daysActive, lastActiveDay }]
 * @param {Array} costProfiles        - getAllCostProfiles() rows
 *                                       [{ driver_name, rental_amount, salary_amount, fuel_estimate, other_costs, notes }]
 * @param {object} [opts]             - { target, projectDays, minProjectDays, offlineThreshold, today }
 * @returns {{ ok, drivers, summary, recommendedActions }}
 */
function buildFleetReport(fleetData, costProfiles, opts = {}) {
  const o = {
    target:           Number(opts.target           || TARGET_SAR),
    projectDays:      Number(opts.projectDays       || PROJECT_DAYS),
    minProjectDays:   Number(opts.minProjectDays    || MIN_PROJECT_DAYS),
    offlineThreshold: Number(opts.offlineThreshold  || OFFLINE_THRESHOLD),
    bonusFloor:       BONUS_FLOOR,
  };
  const snap = toSnapshot(fleetData, opts);
  const drivers = Array.isArray(snap.drivers) ? snap.drivers : [];
  const daysElapsed = Math.max(0, _r0(snap.daysElapsed));
  const monthLabel = snap.monthLabel || "";
  const dim = Number(snap.daysInMonth || 30);

  // Cost-profile lookup, fuzzy by lowercased/trimmed driver name.
  const profMap = new Map();
  for (const p of (Array.isArray(costProfiles) ? costProfiles : [])) {
    const key = String(p && p.driver_name || "").toLowerCase().trim();
    if (key) profMap.set(key, p);
  }

  // Projection denominator: calendar days elapsed, capped at the month length so a
  // full/over-run month never inflates the projection above the realized net.
  const projDen = daysElapsed > 0 ? Math.min(daysElapsed, o.projectDays) : 0;

  const perDriver = drivers.map((d) => {
    const name = d.name;
    const driverNetRaw = Number(d.driverNet || 0);
    const daysActive = _r0(d.daysActive);
    const lastActiveDay = _r0(d.lastActiveDay);
    const offlineStreak = (daysElapsed > 0 && lastActiveDay > 0) ? Math.max(0, daysElapsed - lastActiveDay) : 0;

    // Project to month-end at the current calendar pace, then derive everything
    // from the rounded projection so summary counts and per-driver flags agree.
    const projectedNet = projDen > 0 ? _r0((driverNetRaw / projDen) * o.projectDays) : _r0(driverNetRaw);
    const onTrackFor5000 = projectedNet >= o.target;

    const prof = profMap.get(String(name || "").toLowerCase().trim()) || null;
    const hasProfile = !!prof;
    const rentalAmount = hasProfile ? Number(prof.rental_amount || 0) : 0;
    const salary = hasProfile ? Number(prof.salary_amount || 0) : 0;
    const fuel   = hasProfile ? Number(prof.fuel_estimate || 0) : 0;
    const other  = hasProfile ? Number(prof.other_costs || 0) : 0;
    const totalCosts = salary + fuel + other;

    // Company revenue: rental + 50% bonus share of the PROJECTED tier (pnl-engine).
    const rev = companyRevenueFromDriver(projectedNet, rentalAmount);
    const rentalRevenue = rev.rental;
    const bonusShare = rev.bonus;
    const totalRevenue = rev.total;
    const netProfit = totalRevenue - totalCosts;
    const tierFloor = (driverBonusTier(projectedNet) || {}).min || 0;

    return {
      name,
      driverNet: _r0(driverNetRaw),
      daysActive, lastActiveDay, daysElapsed, offlineStreak,
      projectedNet, onTrackFor5000,
      hasProfile,
      rentalRevenue: _r0(rentalRevenue),
      bonusShare: _r0(bonusShare),
      totalRevenue: _r0(totalRevenue),
      salary: _r0(salary), fuel: _r0(fuel), other: _r0(other),
      totalCosts: _r0(totalCosts),
      netProfit: _r0(netProfit),
      tier: tierFloor, tierLabel: tierLabel(tierFloor),
    };
  });

  // Display order: highest company net profit first (profiled drivers carry real P&L).
  perDriver.sort((a, b) => b.netProfit - a.netProfit);

  // P&L totals over PROFILED drivers only — a driver with no cost profile has an
  // UNKNOWN cost structure, and inventing zero costs would overstate net profit
  // (Build-91 honesty rule). Performance counts (above/below tier) span all drivers.
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const profiled = perDriver.filter((d) => d.hasProfile);
  const summary = {
    drivers: perDriver.length,
    driversWithProfile: profiled.length,
    driversMissingProfile: perDriver.length - profiled.length,
    missingProfileNames: perDriver.filter((d) => !d.hasProfile).map((d) => d.name),
    totalRentalIncome: _r0(sum(profiled, (d) => d.rentalRevenue)),
    projectedBonusIncome: _r0(sum(profiled, (d) => d.bonusShare)),
    totalRevenue: _r0(sum(profiled, (d) => d.totalRevenue)),
    totalCosts: _r0(sum(profiled, (d) => d.totalCosts)),
    netProfit: _r0(sum(profiled, (d) => d.netProfit)),
    driversAbove5000: perDriver.filter((d) => d.onTrackFor5000).length,
    driversBelow4000: perDriver.filter((d) => d.projectedNet < o.bonusFloor).length,
    daysElapsed, daysInMonth: dim, monthLabel,
    target: o.target, projectDays: o.projectDays,
  };

  const recommendedActions = buildRecommendations(perDriver, o);

  return { ok: perDriver.length > 0, drivers: perDriver, summary, recommendedActions };
}

/**
 * Render a report object into a human-readable text block for M8 to narrate.
 * Returns "" for an empty report so the orchestrator can skip folding it in.
 */
function formatFleetReport(report) {
  if (!report || !Array.isArray(report.drivers) || !report.drivers.length) return "";
  const s = report.summary;
  const M = fmtMoney;
  const sign = (v) => (v >= 0 ? "+" : "");
  const lines = [];

  lines.push(
    `FLEET INTELLIGENCE REPORT — ${s.monthLabel} (day ${s.daysElapsed} of ${s.daysInMonth}). ` +
    `COMPANY P&L view: the company earns RENTAL income + its 50% share of each driver's Bolt tier bonus; ` +
    `a driver's net is the DRIVER's money and only the bonus-tier INPUT.`
  );
  lines.push(
    `These are DETERMINISTIC ground truth — quote and explain; never invent a driver, a cost, or a number. ` +
    `Tier/bonus/P&L figures are PROJECTED to month-end at each driver's current pace — label them ESTIMATES.`
  );

  lines.push("");
  lines.push(`COMPANY P&L (drivers with a cost profile: ${s.driversWithProfile}/${s.drivers}):`);
  lines.push(`  Rental income ${M(s.totalRentalIncome)} SAR + projected Bolt bonus ${M(s.projectedBonusIncome)} SAR = revenue ${M(s.totalRevenue)} SAR`);
  lines.push(`  Costs (salary + fuel + other) ${M(s.totalCosts)} SAR  ->  projected company net profit ${sign(s.netProfit)}${M(s.netProfit)} SAR`);
  lines.push(`  Drivers projected to reach the 5000 tier: ${s.driversAbove5000} | projected below 4000 (no bonus): ${s.driversBelow4000}`);
  if (s.driversMissingProfile > 0) {
    lines.push(`  ${s.driversMissingProfile} driver(s) have NO cost profile (${s.missingProfileNames.join(", ")}) — excluded from P&L totals; costs unknown, do not invent them.`);
  }

  lines.push("");
  lines.push("PER DRIVER (projected month-end, sorted by company net profit):");
  for (const d of report.drivers) {
    const tail = d.offlineStreak >= 1 ? ` (${d.offlineStreak}d since last active)` : "";
    if (d.hasProfile) {
      lines.push(
        `  - ${d.name}: net ${M(d.driverNet)} SAR (${d.daysActive}d active) -> projects ${M(d.projectedNet)} SAR [${d.tierLabel}]. ` +
        `Company: rental ${M(d.rentalRevenue)} + bonus ${M(d.bonusShare)} - costs ${M(d.totalCosts)} = ${sign(d.netProfit)}${M(d.netProfit)} SAR.${tail}`
      );
    } else {
      lines.push(
        `  - ${d.name}: net ${M(d.driverNet)} SAR (${d.daysActive}d active) -> projects ${M(d.projectedNet)} SAR [${d.tierLabel}]. ` +
        `No cost profile on file — company P&L unknown.${tail}`
      );
    }
  }

  lines.push("");
  if (report.recommendedActions.length) {
    lines.push("RECOMMENDED ACTIONS (most urgent first):");
    for (const r of report.recommendedActions) lines.push(`  - ${r.driver}: ${r.reason}`);
  } else {
    lines.push("RECOMMENDED ACTIONS: none — every tracked driver is active and on pace.");
  }

  lines.push("");
  lines.push(
    "HOW TO ANSWER: lead with the projected company net profit and the most urgent recommended actions, " +
    "then note who is on track for a bonus tier and who needs attention. Projections assume each driver " +
    "holds their current pace to month-end — say so. Use ONLY the figures in THIS block."
  );
  return lines.join("\n");
}

// ── Query detection (cheap regex; gate before any fetch) ──────────────────────
// Fires on fleet-report-shaped asks: "how is my fleet / drivers doing", "who is my
// top/bottom performer / who's behind / needs attention", "fleet report / health /
// status". Morning-brief & change-analysis take precedence in the orchestrator.
// B-161: also catch "(write me a) report on fleet performance", "fleet performance
// report", "performance of the drivers" -- the rich P&L report should fire whether the
// report/summary noun comes BEFORE or AFTER fleet/drivers (the old regex only matched
// "fleet ... report", so "report on fleet performance" fell through to a generic reply).
const FLEET_REPORT_RE = /how.*(fleet|drivers?)|who.*(top|bottom|perform|behind|ahead|attention)|fleet.*(report|health|status|performance|overview|summary|recap|breakdown)|\b(report|overview|summary|recap|breakdown|performance)\b.*\b(fleet|drivers?|captains?|couriers?|riders?)\b/i;
function detectFleetReportQuery(message) {
  return FLEET_REPORT_RE.test(String(message || ""));
}

module.exports = {
  buildFleetReport,
  formatFleetReport,
  aggregateFleetMonth,
  buildRecommendations,
  detectFleetReportQuery,
  tierLabel,
  TARGET_SAR, PROJECT_DAYS, MIN_PROJECT_DAYS, OFFLINE_THRESHOLD, BONUS_FLOOR,
};
