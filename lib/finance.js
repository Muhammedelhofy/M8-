/**
 * M8 Finance — lib/finance.js
 *
 * The VERIFIED fleet P&L. Operator-assistant breadth on the SAME deterministic
 * spine as fleet/state: code computes the truth from real config + data, the LLM
 * only narrates it. This is the verified-compute muscle the North Star needs,
 * pointed at Muhammad's actual business.
 *
 * WHERE THE COST DATA COMES FROM (the key feasibility fact): the dashboard already
 * SYNCS its finance config to Supabase inside the SAME `fleet_data` record M8
 * fetches for fleet numbers — `khair_courier_profiles` (each driver's base deal:
 * model S/F/R, salary or auto-salary formula, account/car rent, fleet cut, other)
 * and `khair_courier_overrides` (effective-dated monthly CHANGES). So M8 needs NO
 * new sync — it reads the config that's already there and MIRRORS the dashboard's
 * own P&L engine to the decimal (verbatim port of computeDriverPnL /
 * computeModelRollup / getEffectiveProfile / autoSalaryFor / sumDriverNetForMonth
 * from index.html). M8's P&L can never disagree with the dashboard's.
 *
 * HONESTY: revenue (driver net) is ground truth from the blob; costs are the
 * config Muhammad set in the dashboard. A driver with NO profile has NO cost
 * config — M8 reports their P&L as income-only and flags that costs aren't set,
 * NEVER inventing a salary/rent. Revenue=measured, costs=his-config, both real.
 *
 * Orchestrator entry point: buildFinanceContext(message, history) → { text, data }
 * (empty when not a finance turn or on any failure). Fails SAFE — never throws.
 */
const { getFleetRecord, decodeHistory } = require("./fleet");

const MONTH_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// ── verbatim ports from index.html (so M8 matches the dashboard to the decimal) ──
function driverKey(name) { return (name || "").trim().toLowerCase(); }
function sN(v) { return (typeof v === "number" && !isNaN(v)) ? v : 0; }

// Robust {month,year} for a history entry: periodInfo when present, else the LAST
// date in the period string (older cloud pulls without periodInfo).
function entryMonthYear(h) {
  if (h && h.periodInfo && h.periodInfo.end) return { month: h.periodInfo.end.month, year: h.periodInfo.end.year };
  const all = (h && h.period || "").match(/(\d{1,2})\s(\w{3})\s(\d{4})/g);
  if (all && all.length) {
    const last = all[all.length - 1].match(/(\d{1,2})\s(\w{3})\s(\d{4})/);
    return { month: MONTH_MAP[last[2]] ?? 0, year: parseInt(last[3], 10) };
  }
  return null;
}
function entryInMonth(h, month, year) {
  const my = entryMonthYear(h);
  return !!my && my.month === month && my.year === year;
}
// Canonical net for one driver in one month — de-duped by period, NaN-safe.
function sumDriverNetForMonth(entries, driverName, month, year, driverId) {
  const nk = driverKey(driverName);
  const seen = new Set(); let total = 0;
  for (const h of entries) {
    if (!entryInMonth(h, month, year) || seen.has(h.period)) continue;
    seen.add(h.period);
    const drivers = Array.isArray(h.drivers) ? h.drivers : [];
    const d = drivers.find((x) => (driverId && x.driverId === driverId) || driverKey(x.name) === nk);
    if (d) total += sN(d.netEarnings);
  }
  return total;
}

// The dashboard's defaultProfile() — a driver with no saved config.
function defaultProfile() {
  return {
    model: "F", modelCustom: null,
    accountRent: { dir: "NONE", amount: 0 }, carRent: { dir: "NONE", amount: 0 },
    salary: 0, fleetCut: { type: "NONE", value: 0 },
    autoSalary: false, salaryBase: 2000, salaryThreshold: 6000, salaryPerK: 500,
    other: { label: "", dir: "NONE", amount: 0 }, notes: "", startDate: null,
  };
}
// Auto-salary: base at threshold, ±perK per full 1,000 net above/below, clamp ≥0.
function autoSalaryFor(net, p) {
  const base = p.salaryBase != null ? p.salaryBase : 2000;
  const thr = p.salaryThreshold != null ? p.salaryThreshold : 6000;
  const perK = p.salaryPerK != null ? p.salaryPerK : 500;
  const steps = Math.floor(((net || 0) - thr) / 1000);
  return Math.max(0, base + steps * perK);
}
const OVERRIDABLE_FIELDS = ["model", "modelCustom", "accountRent", "carRent", "salary", "fleetCut",
  "other", "notes", "autoSalary", "salaryBase", "salaryThreshold", "salaryPerK"];
// Effective-dated: base profile + every override with month ≤ monthKey (oldest→
// newest), only-changed-fields, so the most recent change per field wins.
function getEffectiveProfile(name, monthKey, profiles, overrides) {
  const base = profiles[driverKey(name)] || defaultProfile();
  if (!monthKey) return { ...base, _hasProfile: !!profiles[driverKey(name)] };
  const nk = driverKey(name);
  const keys = Object.keys(overrides)
    .filter((k) => k.startsWith(nk + "::") && k.slice(nk.length + 2) <= monthKey)
    .sort((a, b) => (a.slice(nk.length + 2) < b.slice(nk.length + 2) ? -1 : 1));
  const eff = { ...base };
  for (const k of keys) {
    const ov = overrides[k];
    if (!ov) continue;
    OVERRIDABLE_FIELDS.forEach((f) => { if (ov[f] !== undefined) eff[f] = ov[f]; });
  }
  eff._hasProfile = !!profiles[driverKey(name)] || keys.length > 0;
  return eff;
}
// The canonical per-driver fleet P&L (verbatim port of computeDriverPnL).
function computeDriverPnL(name, monthKey, entries, profiles, overrides) {
  const p = getEffectiveProfile(name, monthKey, profiles, overrides);
  const [y, m] = monthKey.split("-").map(Number);
  const income = sumDriverNetForMonth(entries, name, m - 1, y);
  const sign = (dir, amt) => (dir === "IN" ? +amt : dir === "OUT" ? -amt : 0);
  const acctRent = sign(p.accountRent?.dir, p.accountRent?.amount || 0);
  const carRent = sign(p.carRent?.dir, p.carRent?.amount || 0);
  const salaryOut = p.autoSalary ? autoSalaryFor(income, p) : (p.salary || 0);
  const salary = -salaryOut;
  const fc = p.fleetCut || {};
  const fleetCut = fc.type === "FLAT" ? -(fc.value || 0)
    : fc.type === "PCT" ? -(income * (fc.value || 0) / 100)
      : 0;
  const other = sign(p.other?.dir, p.other?.amount || 0);
  const netPnL = income + acctRent + carRent + salary + fleetCut + other;
  return { name, model: p.model, modelCustom: p.modelCustom, income, acctRent, carRent, salary, fleetCut, other, netPnL, hasProfile: !!p._hasProfile };
}

// All drivers seen in a month (from history) ∪ all drivers with a saved profile.
function getDriversInMonth(entries, monthKey, profiles) {
  const [y, m] = monthKey.split("-").map(Number);
  const targetMonth = m - 1, targetYear = y;
  const map = new Map();
  for (const h of entries) {
    if (!entryInMonth(h, targetMonth, targetYear)) continue;
    (Array.isArray(h.drivers) ? h.drivers : []).forEach((d) => { if (d.name) map.set(driverKey(d.name), d.name.trim()); });
  }
  const names = [...map.values()];
  Object.keys(profiles).forEach((k) => { if (!names.some((d) => driverKey(d) === k)) names.push(k); });
  return names;
}

// Fleet-wide P&L for a month: per-driver, grouped by model, with totals + the
// biggest contributors and cost drains. The single deterministic finance packet.
function computeFleetPnL(monthKey, entries, profiles, overrides) {
  const names = getDriversInMonth(entries, monthKey, profiles);
  const pls = names.map((n) => computeDriverPnL(n, monthKey, entries, profiles, overrides))
    .filter((pl) => pl.income !== 0 || pl.netPnL !== 0 || pl.hasProfile);
  const groups = {};
  let income = 0, inflow = 0, costs = 0, netPnL = 0, noProfile = 0;
  for (const pl of pls) {
    const key = pl.model === "Custom" ? (pl.modelCustom || "Custom") : (pl.model || "F");
    if (!groups[key]) groups[key] = { model: key, count: 0, income: 0, inflow: 0, costs: 0, netPnL: 0 };
    const g = groups[key];
    g.count++;
    g.income += pl.income;
    const inFlow = Math.max(0, pl.acctRent) + Math.max(0, pl.carRent) + Math.max(0, pl.other);
    const outFlow = Math.abs(Math.min(0, pl.acctRent)) + Math.abs(Math.min(0, pl.carRent)) +
      Math.abs(pl.salary) + Math.abs(pl.fleetCut) + Math.abs(Math.min(0, pl.other));
    g.inflow += inFlow; g.costs += outFlow; g.netPnL += pl.netPnL;
    income += pl.income; inflow += inFlow; costs += outFlow; netPnL += pl.netPnL;
    if (!pl.hasProfile) noProfile++;
  }
  const byNet = [...pls].sort((a, b) => b.netPnL - a.netPnL);
  return {
    monthKey,
    totals: { income, inflow, costs, netPnL, drivers: pls.length, noProfile },
    byModel: Object.values(groups).sort((a, b) => b.netPnL - a.netPnL),
    topContributors: byNet.slice(0, 5),
    topDrains: byNet.filter((p) => p.netPnL < 0).slice(-5).reverse(),
    perDriver: pls,
  };
}

// ─────────────────────────────────────────────────────────────────
// BOLT BONUS ENGINE (Build P1)
// Tunable config — amounts and split live here, not scattered in formulae.
// ─────────────────────────────────────────────────────────────────
const BOLT_BONUS_CONFIG = {
  splitPctToCompany: 0.5, // company keeps 50% after helper split
  // Tiers ordered highest-floor first so bonusFor() matches on first hit (step, not cumulative).
  tiers: [
    { floor: 6000, gross: 2500 }, // T6
    { floor: 5000, gross: 2000 }, // T5
    { floor: 4000, gross: 1500 }, // T4
  ],
};

// Step bonus for a driver's monthly net. First matching tier (highest first) wins.
// Returns the COMPANY SHARE (after helper split) as companyBonus; gross for display.
// tierFloor is null when below the lowest tier.
function bonusFor(net, config) {
  const cfg = config || BOLT_BONUS_CONFIG;
  for (const t of cfg.tiers) {
    if ((net || 0) >= t.floor) {
      return {
        grossBonus: t.gross,
        companyBonus: Math.round(t.gross * cfg.splitPctToCompany),
        tierFloor: t.floor,
      };
    }
  }
  return { grossBonus: 0, companyBonus: 0, tierFloor: null };
}

// How far a driver is from the NEXT tier up (ascending scan).
// Returns { sarToNextTier, bonusUnlocked (company share at that tier), nextTierFloor }
// or null when already at the max tier.
function bonusGapFor(net, config) {
  const cfg = config || BOLT_BONUS_CONFIG;
  const netVal = net || 0;
  for (let i = cfg.tiers.length - 1; i >= 0; i--) {
    const t = cfg.tiers[i];
    if (netVal < t.floor) {
      return {
        sarToNextTier: t.floor - netVal,
        bonusUnlocked: Math.round(t.gross * cfg.splitPctToCompany),
        nextTierFloor: t.floor,
      };
    }
  }
  return null; // at or above the highest tier
}

// Fleet-wide Bolt bonus aggregate for a month. One row per active driver.
function computeFleetBonusPacket(monthKey, entries, profiles, overrides, config) {
  const cfg = config || BOLT_BONUS_CONFIG;
  const names = getDriversInMonth(entries, monthKey, profiles);
  const [y, m] = monthKey.split("-").map(Number);
  const driverBonuses = [];
  let totalGross = 0, totalCompany = 0;

  for (const name of names) {
    const net = sumDriverNetForMonth(entries, name, m - 1, y);
    if (net === 0 && !profiles[driverKey(name)]) continue;
    const bonus = bonusFor(net, cfg);
    const gap = bonusGapFor(net, cfg);
    totalGross += bonus.grossBonus;
    totalCompany += bonus.companyBonus;
    driverBonuses.push({ name, net, ...bonus, gap });
  }

  return {
    monthKey,
    totalGross,
    totalCompany,
    splitPct: cfg.splitPctToCompany,
    driverBonuses,
  };
}

// Text lines for the bonus section — appended to the fleet P&L packet.
function renderFleetBonusLines(bonusPacket) {
  if (!bonusPacket) return [];
  const { totalGross, totalCompany, splitPct, driverBonuses } = bonusPacket;
  const splitPctDisplay = Math.round(splitPct * 100);
  const partnerPct = 100 - splitPctDisplay;
  const lines = [];

  lines.push(
    `BOLT BONUS THIS MONTH — gross ${fmtSar(totalGross)} SAR total, company share ${fmtSar(totalCompany)} SAR` +
    ` (${splitPctDisplay}% kept after ${partnerPct}% helper split).` +
    ` Bolt pays this bonus to the company per driver reaching a net tier. Book the company share only.`
  );

  const earned = driverBonuses.filter((d) => d.tierFloor !== null);
  if (earned.length) {
    const tierLabel = (f) => f >= 6000 ? "T6 (6k+)" : f >= 5000 ? "T5 (5k)" : "T4 (4k)";
    lines.push(
      "Drivers at a bonus tier: " +
      earned.map((d) => `${d.name} (net ${fmtSar(d.net)} SAR, ${tierLabel(d.tierFloor)}, +${fmtSar(d.companyBonus)} SAR company)`).join("; ") + "."
    );
  } else {
    lines.push("No drivers have reached a bonus tier (4,000 SAR net minimum) yet this month.");
  }

  const nearTier = driverBonuses.filter((d) => d.gap && d.gap.sarToNextTier <= 500).sort((a, b) => a.gap.sarToNextTier - b.gap.sarToNextTier);
  if (nearTier.length) {
    lines.push(
      "Close to next tier (within 500 SAR): " +
      nearTier.map((d) => `${d.name} needs ${fmtSar(d.gap.sarToNextTier)} SAR more to unlock +${fmtSar(d.gap.bonusUnlocked)} SAR company bonus`).join("; ") + "."
    );
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────
// DETECTION — is this a finance/P&L turn? which month? which driver?
// ─────────────────────────────────────────────────────────────────
// Finance-specific so it doesn't swallow plain fleet-net questions (those stay on
// the fleet spine). Requires a PROFIT/COST/MARGIN/MODEL signal — "net earnings"
// alone is fleet, "real profit after costs / P&L / what do I actually keep" is finance.
const FINANCE_RE = new RegExp(
  [
    "\\bp\\s*&\\s*l\\b|\\bpnl\\b|\\bp\\s*and\\s*l\\b",
    "\\b(profit|profitab\\w*)\\b",
    "\\b(net\\s+)?margin\\b",
    "\\bbreak[\\s-]?even\\b",
    "\\bbottom\\s+line\\b",
    "\\bafter\\s+(?:all\\s+)?(?:costs?|expenses?|salaries|salary|rent|overhead)\\b",
    "\\b(real|actual|true)\\s+(?:net|profit|earnings?|income)\\b",
    "\\bwhat\\s+(?:do|did|am)\\s+i\\s+(?:actually\\s+)?(?:make|making|keep|keeping|earn|clear|take\\s+home)\\b",
    "\\b(how\\s+much\\s+)?(?:does|do|did|is)\\s+\\w[\\w\\s]{0,30}?\\s+cost(?:ing)?\\s+(?:me|the\\s+fleet|us)\\b",
    "\\bcost\\s+(?:me|the\\s+fleet|us|to\\s+run)\\b",
    "\\b(salary|salaries|payroll)\\s+(?:cost|bill|total|this\\s+month)\\b",
    "\\bwhich\\s+(?:model|drivers?|setup)\\s+(?:is|are|makes?)\\s+(?:the\\s+)?most\\s+profit\\w*\\b",
    "\\b(model|salaried|rent\\s+model|fleet\\s+cut)\\s+(?:rollup|breakdown|comparison|p&l|profit\\w*)\\b",
    "\\bunit\\s+economics\\b",
    "\\bthink\\s+with\\s+me\\b[^.?!]{0,40}\\b(finance|financ\\w*|money|profit|cost|margin|earn\\w*|number|situation|business)\\b",
    "\\b(financial\\s+situation|financial\\s+health|financial\\s+analysis|how\\s+(?:are|is)\\s+(?:we|the\\s+fleet|the\\s+business)\\s+(?:doing|performing)\\s+financially)\\b",
    "\\b(cost\\s+per\\s+order|margin\\s+per\\s+driver|deal\\s+(?:structure|quality|analysis|review))\\b",
  ].join("|"),
  "i"
);
// A bare cost word + a fleet/driver/month context still counts (so "my costs this
// month", "the salary bill" route to finance) — but generic "cost of X" doesn't.
function looksFinance(message) {
  return FINANCE_RE.test(message || "");
}

// Resolve the month the question is about → 'YYYY-MM' (default: most recent month
// that has data). "this month" = current; "last month" = previous; "June"/"June 2026".
function resolveMonthKey(message, entries) {
  const s = (message || "").toLowerCase();
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  const fmt = (y, m0) => `${y}-${String(m0 + 1).padStart(2, "0")}`;
  if (/\bthis\s+month\b/.test(s) || /\bso\s+far\s+this\s+month\b/.test(s) || /\bmtd\b/.test(s)) return fmt(now.getFullYear(), now.getMonth());
  if (/\blast\s+month\b|\bprevious\s+month\b|\bprior\s+month\b/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return fmt(d.getFullYear(), d.getMonth());
  }
  const mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (mm) {
    const m0 = MONTH_ABBR3.indexOf(mm[1]);
    const yr = (s.match(/\b(20\d{2})\b/) || [])[1];
    return fmt(yr ? +yr : (latestMonth(entries)?.y ?? now.getFullYear()), m0);
  }
  // Default: the most recent month that has data.
  const lm = latestMonth(entries);
  return lm ? fmt(lm.y, lm.m) : fmt(now.getFullYear(), now.getMonth());
}
function latestMonth(entries) {
  let best = null;
  for (const h of entries) {
    const my = entryMonthYear(h);
    if (!my) continue;
    if (!best || my.year > best.y || (my.year === best.y && my.month > best.m)) best = { y: my.year, m: my.month };
  }
  return best;
}

// Did the question name a specific driver? Reuse the fleet driver-extractor shape
// loosely — here we just look for "<Name> cost me / <Name>'s P&L / what does <Name>".
// A capitalized name token (1 or 2 words). NO apostrophe in the class (so "What's"
// isn't captured as a name) and the patterns are case-SENSITIVE on the name (so the
// /i flag can't let [A-Z] match a following lowercase word like "cost").
const FIN_NAME = "[A-Z][A-Za-z-]+(?:\\s+[A-Z][A-Za-z-]+)?";
function financeDriverTarget(message) {
  const s = message || "";
  // "(the|a) driver/courier/captain [named|called] X" — handles "the driver Zyltharc cost me".
  let m = s.match(new RegExp("\\b(?:driver|courier|captain|rider)\\s+(?:named\\s+|called\\s+)?(" + FIN_NAME + ")\\b"));
  if (m) return m[1].trim();
  // "does (the|a) [driver] X cost" / "what does X cost".
  m = s.match(new RegExp("\\bdoes?\\s+(?:the\\s+|a\\s+)?(?:driver\\s+|courier\\s+)?(" + FIN_NAME + ")\\s+cost\\b"));
  if (m) return m[1].trim();
  m = s.match(new RegExp("\\bwhat\\s+(?:does|do|is)\\s+(?:the\\s+|a\\s+)?(?:driver\\s+)?(" + FIN_NAME + ")\\b[^?]*\\bcost\\b"));
  if (m) return m[1].trim();
  // "X's P&L / profit / cost" — keyword case-insensitive ("P&L"), possessive outside the name.
  m = s.match(new RegExp("\\b(" + FIN_NAME + ")['’]s\\s+(?:p\\s*&\\s*l|pnl|profit|margin|cost)\\b", "i"));
  if (m) return m[1].trim();
  return null;
}

// ─────────────────────────────────────────────────────────────────
// PACKET — the deterministic block the LLM narrates (never invents)
// ─────────────────────────────────────────────────────────────────
function fmtSar(v) { return (v == null || isNaN(v)) ? "?" : Math.round(v).toLocaleString("en-US"); }
const MODEL_LABEL = { S: "Salaried", F: "Fleet-account", R: "Rent", Custom: "Custom" };
function modelName(k) { return MODEL_LABEL[k] || k; }
function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] || "?"} ${y}`;
}
const FIN_GROUND = "These are GROUND TRUTH — computed from Muhammad's real Bolt earnings (revenue) and the cost config he set in the dashboard (salaries/rent/fleet-cut/other), using the dashboard's own P&L formula, so they MATCH the dashboard to the decimal. Quote and EXPLAIN; never recompute or invent. Revenue is measured; costs are his configured deal. Do NOT invent a salary or rent for anyone.";

function renderFleetPnLPacket(r, bonusPacket) {
  const t = r.totals;
  const lines = [
    `FLEET P&L — ${monthLabel(r.monthKey)} (${t.drivers} drivers). ${FIN_GROUND}`,
    `Revenue (driver net earnings collected): ${fmtSar(t.income)} SAR. Other inflow (rent/cut in): ${fmtSar(t.inflow)} SAR. Total costs (salaries/rent/cut/other out): ${fmtSar(t.costs)} SAR.`,
    `NET P&L (what the fleet actually keeps): ${fmtSar(t.netPnL)} SAR.`,
  ];
  if (r.byModel.length) {
    lines.push("By model: " + r.byModel.map((g) => `${modelName(g.model)} ${g.count} driver${g.count === 1 ? "" : "s"} → net ${fmtSar(g.netPnL)} SAR`).join("; ") + ".");
  }
  if (r.topContributors.length) {
    lines.push("Top contributors: " + r.topContributors.filter((d) => d.netPnL > 0).slice(0, 3).map((d) => `${d.name} (${fmtSar(d.netPnL)} SAR)`).join("; ") + ".");
  }
  if (r.topDrains.length) {
    lines.push("Biggest drains (negative P&L): " + r.topDrains.slice(0, 3).map((d) => `${d.name} (${fmtSar(d.netPnL)} SAR)`).join("; ") + ".");
  }
  if (t.noProfile > 0) {
    lines.push(`NOTE: ${t.noProfile} driver${t.noProfile === 1 ? " has" : "s have"} NO cost config set in the dashboard, so ${t.noProfile === 1 ? "their" : "their"} P&L counts revenue only (no salary/rent applied). Tell Boss their costs aren't set rather than assuming a number.`);
  }

  // ── Phase A2: Financial analysis — margin %, deal quality, fleet health ──────
  const withProfile = (r.perDriver || []).filter((d) => d.hasProfile && d.income > 0);
  if (withProfile.length) {
    const withMargin = withProfile.map((d) => ({
      name: d.name,
      margin: Math.round((d.netPnL / d.income) * 100),
      netPnL: d.netPnL,
      income: d.income,
      model: d.model,
    })).sort((a, b) => b.margin - a.margin);

    const fleetMargin  = t.income > 0 ? Math.round((t.netPnL / t.income) * 100) : null;
    const bestDeal     = withMargin[0];
    const worstDeal    = withMargin[withMargin.length - 1];
    const negMargin    = withMargin.filter((d) => d.margin < 0);
    const breakeven    = withMargin.filter((d) => d.margin >= 0 && d.margin < 10);

    if (fleetMargin != null)
      lines.push(`FLEET MARGIN: ${fleetMargin}% (net P&L ÷ total revenue). This is what the fleet actually keeps for every SAR a driver earns.`);

    if (withMargin.length >= 2) {
      lines.push(`MARGIN BY DRIVER (profiled only, best → worst): ${withMargin.map((d) => `${d.name} ${d.margin}%`).join(", ")}.`);
      lines.push(`Best deal: ${bestDeal.name} (${bestDeal.margin}%, ${fmtSar(bestDeal.netPnL)} SAR net). Weakest: ${worstDeal.name} (${worstDeal.margin}%, ${fmtSar(worstDeal.netPnL)} SAR net).`);
    }
    if (negMargin.length)
      lines.push(`NEGATIVE MARGIN (costs exceed their earnings): ${negMargin.map((d) => `${d.name} (${d.margin}%)`).join(", ")} — these drivers are currently costing the fleet money.`);
    if (breakeven.length)
      lines.push(`NEAR BREAK-EVEN (0–10% margin): ${breakeven.map((d) => `${d.name} (${d.margin}%)`).join(", ")} — small moves in earnings or costs swing these positive or negative.`);

    lines.push(`FINANCIAL ANALYSIS INSTRUCTION: Analyze ONLY the figures in the FLEET P&L block above — do NOT invent categories (no COGS, no fuel, no marketing, no operating expenses — those are not in Muhammad's data model). His P&L is: driver net earnings (revenue) minus salary/fleet-cut/rent/other = fleet net P&L, and that is ALL. Lead with the fleet margin %, then call out the outliers: best margin driver vs weakest, any negative-margin drivers (costs exceed their revenue). Close with 1-2 concrete recommendations based ONLY on what you see: e.g. which deal model earns the best margin, whether a negative-margin driver's deal needs review. Think like a CFO working from THESE numbers — not a generic P&L template.`);
  }

  if (bonusPacket) {
    lines.push(...renderFleetBonusLines(bonusPacket));
  }

  return lines.join("\n");
}

function renderDriverPnLPacket(pl, monthKey) {
  const lines = [
    `DRIVER P&L — ${pl.name}, ${monthLabel(monthKey)} (model: ${modelName(pl.model)}). ${FIN_GROUND}`,
    `Revenue (their net earnings): ${fmtSar(pl.income)} SAR.`,
  ];
  const costBits = [];
  if (pl.salary) costBits.push(`salary ${fmtSar(-pl.salary)} SAR`);
  if (pl.fleetCut) costBits.push(`fleet cut ${fmtSar(-pl.fleetCut)} SAR`);
  if (pl.acctRent) costBits.push(`account rent ${pl.acctRent >= 0 ? "+" : ""}${fmtSar(pl.acctRent)} SAR`);
  if (pl.carRent) costBits.push(`car rent ${pl.carRent >= 0 ? "+" : ""}${fmtSar(pl.carRent)} SAR`);
  if (pl.other) costBits.push(`other ${pl.other >= 0 ? "+" : ""}${fmtSar(pl.other)} SAR`);
  lines.push("Adjustments: " + (costBits.length ? costBits.join(", ") : "none configured") + ".");
  lines.push(`NET P&L for ${pl.name} (what the fleet keeps from them): ${fmtSar(pl.netPnL)} SAR.`);
  if (!pl.hasProfile) {
    lines.push(`NOTE: ${pl.name} has NO cost config in the dashboard — this is revenue only, no salary/rent applied. Say so plainly; do NOT invent their deal.`);
  }
  return lines.join("\n");
}

function renderNoData(monthKey) {
  return `FLEET P&L: no driver data on record for ${monthLabel(monthKey)}. Tell Boss there's nothing to compute a P&L from for that month and ask which month he means (or to sync the dashboard). Do NOT invent figures.`;
}

function renderDriverNotFound(name, monthKey) {
  return `DRIVER P&L: no driver named "${name}" is on record for ${monthLabel(monthKey)} (no earnings and no cost profile). Tell Boss plainly you don't have that driver and do NOT invent their revenue, salary, or P&L — the name may be spelled differently or be an account-holder name. Offer to show the fleet P&L or check another name.`;
}

// ─────────────────────────────────────────────────────────────────
// ORCHESTRATOR ENTRY POINT
// ─────────────────────────────────────────────────────────────────
async function buildFinanceContext(message, history) {
  if (!looksFinance(message)) return { text: "", data: null };
  try {
    const record = await getFleetRecord();
    if (!record) return { text: "", data: null };
    const entries = decodeHistory(record);
    if (!entries.length) return { text: renderNoData(resolveMonthKey(message, [])), data: null, error: "no_history" };

    const profiles = (record.khair_courier_profiles && typeof record.khair_courier_profiles === "object") ? record.khair_courier_profiles : {};
    const overrides = (record.khair_courier_overrides && typeof record.khair_courier_overrides === "object") ? record.khair_courier_overrides : {};
    const monthKey = resolveMonthKey(message, entries);

    // A specific driver's P&L?
    const driverName = financeDriverTarget(message);
    if (driverName) {
      const pl = computeDriverPnL(driverName, monthKey, entries, profiles, overrides);
      // Only treat as a driver hit if they actually appear (income) or have a profile.
      if (pl.income !== 0 || pl.hasProfile) {
        return { text: renderDriverPnLPacket(pl, monthKey), data: { driver: pl, monthKey }, mode: "driver" };
      }
      // Named a specific person we don't have → honest not-found (never invent
      // their cost, never silently answer a different question with the fleet P&L).
      return { text: renderDriverNotFound(driverName, monthKey), data: null, mode: "driver_not_found" };
    }

    const r = computeFleetPnL(monthKey, entries, profiles, overrides);
    if (!r.totals.drivers) return { text: renderNoData(monthKey), data: null, error: "no_drivers" };
    const bonusPacket = computeFleetBonusPacket(monthKey, entries, profiles, overrides);
    return { text: renderFleetPnLPacket(r, bonusPacket), data: { ...r, bonus: bonusPacket }, mode: "fleet" };
  } catch (err) {
    console.error("[M8] finance error (non-fatal):", err.message);
    return { text: "", data: null };
  }
}

module.exports = {
  buildFinanceContext,
  looksFinance,
  // exported for tests / reuse:
  driverKey, sN, entryMonthYear, entryInMonth, sumDriverNetForMonth,
  defaultProfile, autoSalaryFor, getEffectiveProfile, computeDriverPnL, computeFleetPnL,
  resolveMonthKey, latestMonth, financeDriverTarget,
  renderFleetPnLPacket, renderDriverPnLPacket, monthLabel, modelName,
  MONTH_MAP,
  // Build P1 — bonus engine:
  BOLT_BONUS_CONFIG, bonusFor, bonusGapFor, computeFleetBonusPacket, renderFleetBonusLines,
};
