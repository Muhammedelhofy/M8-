/**
 * lib/pnl-engine.js — Build-91: canonical fleet P&L arithmetic.
 *
 * The correction this module enforces: a driver's net earnings are the DRIVER's
 * money. The company earns from exactly two sources — the rental it charges the
 * driver, and the Bolt performance bonus Bolt pays the company per driver (kept
 * 50% after the helper split). Driver net is only an INPUT (the bonus tier), never
 * company revenue.
 *
 * Pure arithmetic — no Supabase, no LLM, no imports beyond built-ins. The single
 * source of truth for the bonus schedule (lib/finance.js sources its config here).
 */
"use strict";

// Highest floor first so the first match wins — the bonus is a STEP (the tier
// reached pays its amount only, never cumulative across tiers).
const BONUS_TIERS = [
  { min: 6000, gross: 2500 },
  { min: 5000, gross: 2000 },
  { min: 4000, gross: 1500 },
];
const COMPANY_SHARE = 0.5; // Bolt bonus is split 50/50 with a helper; company keeps this.

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : Number(v) || 0;
}

function driverBonusTier(driverNetSAR) {
  const net = num(driverNetSAR);
  for (const tier of BONUS_TIERS) {
    if (net >= tier.min) {
      return { min: tier.min, gross: tier.gross, companyShare: tier.gross * COMPANY_SHARE };
    }
  }
  return null;
}

function companyRevenueFromDriver(driverNet, rentalAmount) {
  const rental = num(rentalAmount);
  const tier = driverBonusTier(driverNet);
  const bonus = tier ? tier.companyShare : 0;
  return { rental, bonus, total: rental + bonus };
}

function companyPnl(drivers) {
  const list = Array.isArray(drivers) ? drivers : [];
  const bonusTierSummary = { below4000: 0, t4000: 0, t5000: 0, t6000: 0, companyBonusTotal: 0 };
  let totalRevenue = 0;
  let totalCosts = 0;

  const perDriver = list.map((d) => {
    const revenue = companyRevenueFromDriver(d.driverNet, d.rentalAmount);
    const costs = {
      salary: num(d.salaryCost),
      fuel: num(d.fuelCost),
      other: num(d.otherCosts),
      total: num(d.salaryCost) + num(d.fuelCost) + num(d.otherCosts),
    };
    const tier = driverBonusTier(d.driverNet);
    if (!tier) bonusTierSummary.below4000++;
    else if (tier.min >= 6000) bonusTierSummary.t6000++;
    else if (tier.min >= 5000) bonusTierSummary.t5000++;
    else bonusTierSummary.t4000++;
    bonusTierSummary.companyBonusTotal += revenue.bonus;

    totalRevenue += revenue.total;
    totalCosts += costs.total;
    return {
      name: d.name || null,
      driverNet: num(d.driverNet),
      revenue,
      costs,
      netProfit: revenue.total - costs.total,
      tier,
    };
  });

  return {
    totalRevenue,
    totalCosts,
    netProfit: totalRevenue - totalCosts,
    perDriver,
    bonusTierSummary,
  };
}

module.exports = {
  BONUS_TIERS,
  COMPANY_SHARE,
  driverBonusTier,
  companyRevenueFromDriver,
  companyPnl,
};
