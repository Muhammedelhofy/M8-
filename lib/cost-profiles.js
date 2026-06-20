/**
 * lib/cost-profiles.js — Build-87: Driver Cost Profiles
 *
 * The morning brief and finance context currently show GROSS earnings and apply
 * a fixed fleet-wide 4.33-week approximation for salary. That works for a quick
 * overview but misses real profitability: each driver has individual rental cost,
 * salary, fuel estimate, and other costs that aren't in the Bolt earnings data.
 *
 * This module reads per-driver cost profiles from driver_cost_profiles and
 * computes REAL net P&L: gross_earnings - rental - salary - fuel - other.
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
 * Compute REAL net P&L for a driver given gross earnings and a cost profile.
 * All figures in SAR/month. Pass grossMonthly (or 0 if unknown).
 *
 * Returns:
 *   { gross, totalCosts, netPnl, breakdown }
 *   breakdown = { rental, salary, fuel, other }
 *
 * @param {number} grossMonthly  — gross earnings from Bolt (SAR, monthly)
 * @param {object} profile       — from getCostProfile() or getAllCostProfiles()
 */
function computeRealPnl(grossMonthly, profile) {
  const gross    = Number(grossMonthly  || 0);
  const rental   = Number(profile?.rental_amount  || 0);
  const salary   = Number(profile?.salary_amount  || 0);
  const fuel     = Number(profile?.fuel_estimate  || 0);
  const other    = Number(profile?.other_costs    || 0);
  const total    = rental + salary + fuel + other;
  return {
    gross,
    totalCosts: total,
    netPnl: gross - total,
    breakdown: { rental, salary, fuel, other },
  };
}

/**
 * Build a compact P&L text block for a driver, suitable for injection into
 * systemInstruction or a finance context packet.
 *
 * @param {string} driverName
 * @param {number} grossMonthly
 * @param {object} profile        — from getCostProfile() (may be null)
 * @returns {string}
 */
function renderDriverPnl(driverName, grossMonthly, profile) {
  if (!profile) {
    return `${driverName}: no cost profile on file — only gross earnings available (${Number(grossMonthly || 0).toFixed(0)} SAR).`;
  }
  const r = computeRealPnl(grossMonthly, profile);
  const sign = r.netPnl >= 0 ? "+" : "";
  const lines = [
    `${driverName} — Real P&L:`,
    `  Gross (Bolt):   ${r.gross.toFixed(0)} SAR`,
    `  Rental:        −${r.breakdown.rental.toFixed(0)} SAR`,
    `  Salary:        −${r.breakdown.salary.toFixed(0)} SAR`,
    `  Fuel (est.):   −${r.breakdown.fuel.toFixed(0)} SAR`,
    `  Other:         −${r.breakdown.other.toFixed(0)} SAR`,
    `  ────────────────────────`,
    `  Net P&L:       ${sign}${r.netPnl.toFixed(0)} SAR`,
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
