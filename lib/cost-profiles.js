/**
 * lib/cost-profiles.js — Build-87: Driver Cost Profiles
 *
 * The morning brief and finance context currently show GROSS earnings and apply
 * a fixed fleet-wide 4.33-week approximation for salary. That works for a quick
 * overview but misses real profitability: each driver has individual rental cost,
 * salary, fuel estimate, and other costs that aren't in the Bolt earnings data.
 *
 * This module reads per-driver cost profiles from driver_cost_profiles and
 * computes the COMPANY's real P&L. Build-91 correction: a driver's net earnings
 * are the DRIVER's money, never company revenue. The company earns rental income
 * (the rental_amount it charges the driver) + its 50% share of the Bolt tier bonus;
 * its costs are salary + fuel + other. Driver net is only the bonus-tier input.
 * (Old wrong model booked driver gross as company money and rental as a cost.)
 *
 * Schema (applied via migrations/B87_driver_cost_profiles.sql):
 *   driver_cost_profiles:
 *     id uuid (pk)
 *     driver_name text (not null, unique)
 *     rental_amount numeric(10,2) default 0  — per MONTH (SAR)
 *     salary_amount numeric(10,2) default 0  — per MONTH (SAR)
 *     fuel_estimate numeric(10,2) default 0  — per MONTH (SAR, estimate)
 *     other_costs   numeric(10,2) default 0  — per MONTH (SAR)
 *     notes         text
 *     created_at    timestamptz default now()
 *     updated_at    timestamptz default now()
 *
 * All amounts are MONTHLY. The caller divides by 4.33 for weekly, by the days
 * in the current period for daily (same approximation as morning-brief.js).
 *
 * FAILS SAFE: every exported function catches all errors and returns a safe
 * fallback (null or []). Missing table = no crash, just no profiles.
 */

"use strict";

const { createClient } = require("@supabase/supabase-js");

// Canonical company-revenue arithmetic. Guarded so a missing engine degrades to a
// safe inline fallback rather than breaking this fails-safe module.
let pnlEngine = null;
try {
  pnlEngine = require("./pnl-engine");
} catch (_) {
  pnlEngine = null;
}

function companyRevenue(driverNet, rentalAmount) {
  if (pnlEngine) {
    try {
      return pnlEngine.companyRevenueFromDriver(driverNet, rentalAmount);
    } catch (_) { /* fall through to inline */ }
  }
  const net = Number(driverNet || 0);
  const rental = Number(rentalAmount || 0);
  const bonus = net >= 6000 ? 1250 : net >= 5000 ? 1000 : net >= 4000 ? 750 : 0;
  return { rental, bonus, total: rental + bonus };
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Fetch the cost profile for a single driver by name (case-insensitive).
 * Returns null if the driver has no profile or on any error.
 *
 * @param {string} driverName
 * @returns {Promise<{driver_name, rental_amount, salary_amount, fuel_estimate, other_costs, notes}|null>}
 */
async function getCostProfile(driverName) {
  if (!driverName) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from("driver_cost_profiles")
      .select("driver_name, rental_amount, salary_amount, fuel_estimate, other_costs, notes")
      .ilike("driver_name", driverName.trim())
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch (e) {
    console.error("[M8] getCostProfile error (non-fatal):", e && e.message);
    return null;
  }
}

/**
 * Fetch all cost profiles, ordered by driver_name.
 * Returns [] if table is empty or on any error.
 *
 * @returns {Promise<Array<{driver_name, rental_amount, salary_amount, fuel_estimate, other_costs, notes}>>}
 */
async function getAllCostProfiles() {
  const db = getDb();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from("driver_cost_profiles")
      .select("driver_name, rental_amount, salary_amount, fuel_estimate, other_costs, notes")
      .order("driver_name");

    if (error || !data) return [];
    return data;
  } catch (e) {
    console.error("[M8] getAllCostProfiles error (non-fatal):", e && e.message);
    return [];
  }
}

/**
 * Compute the COMPANY's real P&L for a driver. Pass the driver's monthly Bolt NET
 * (the tier input — it is the driver's money, not company revenue).
 *
 * Revenue = rental income (rental_amount) + company's 50% share of the Bolt tier
 * bonus. Costs = salary + fuel + other. netProfit = revenue.total − costs.total.
 *
 * profile === null → revenue is bonus-only (rental:0), costs all 0.
 *
 * Returns:
 *   { revenue: {rental, bonus, total}, costs: {salary, fuel, other, total}, netProfit }
 *
 * @param {number} driverNet  — driver's monthly Bolt net earnings (SAR)
 * @param {object} profile    — from getCostProfile()/getAllCostProfiles() (may be null)
 */
function computeRealPnl(driverNet, profile) {
  const rentalAmount = profile ? Number(profile.rental_amount || 0) : 0;
  const rev = companyRevenue(driverNet, rentalAmount);
  const salary = Number(profile?.salary_amount || 0);
  const fuel   = Number(profile?.fuel_estimate || 0);
  const other  = Number(profile?.other_costs   || 0);
  const costsTotal = salary + fuel + other;
  return {
    revenue: { rental: rev.rental, bonus: rev.bonus, total: rev.total },
    costs: { salary, fuel, other, total: costsTotal },
    netProfit: rev.total - costsTotal,
  };
}

/**
 * Build a compact company-P&L text block for a driver, suitable for injection into
 * systemInstruction or a finance context packet. Pass the driver's monthly Bolt NET.
 *
 * @param {string} driverName
 * @param {number} driverNet      — driver's monthly Bolt net (SAR) — the bonus-tier input
 * @param {object} profile        — from getCostProfile() (may be null)
 * @returns {string}
 */
function renderDriverPnl(driverName, driverNet, profile) {
  const r = computeRealPnl(driverNet, profile);
  const net = Number(driverNet || 0);
  const sign = r.netProfit >= 0 ? "+" : "";
  if (!profile) {
    return [
      `${driverName} — company P&L (no cost profile on file):`,
      `  Rental amounts not yet configured — showing Bolt bonus revenue only.`,
      `  Bolt bonus (company 50% share): +${r.revenue.bonus.toFixed(0)} SAR`,
      `  Net to company:                 ${sign}${r.netProfit.toFixed(0)} SAR`,
      `  (Driver's Bolt net of ${net.toFixed(0)} SAR is the DRIVER's money, not company revenue.)`,
    ].join("\n");
  }
  const lines = [
    `${driverName} — company P&L (company's money, not the driver's):`,
    `  Rental income:    +${r.revenue.rental.toFixed(0)} SAR`,
    `  Bolt bonus (50%): +${r.revenue.bonus.toFixed(0)} SAR`,
    `  ── revenue:        ${r.revenue.total.toFixed(0)} SAR`,
    `  Salary:           −${r.costs.salary.toFixed(0)} SAR`,
    `  Fuel (est.):      −${r.costs.fuel.toFixed(0)} SAR`,
    `  Other:            −${r.costs.other.toFixed(0)} SAR`,
    `  ────────────────────────`,
    `  Net to company:   ${sign}${r.netProfit.toFixed(0)} SAR`,
  ];
  if (profile.notes) lines.push(`  Note: ${profile.notes}`);
  return lines.join("\n");
}

module.exports = {
  getCostProfile,
  getAllCostProfiles,
  computeRealPnl,
  renderDriverPnl,
};
