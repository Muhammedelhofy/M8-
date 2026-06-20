/**
 * M8 Track-A — lib/morning-brief.js  (Build-68)
 *
 * The deterministic Morning Fleet Brief. Muhammad runs a Bolt delivery fleet in
 * Riyadh; each driver's monthly target is 5000 SAR net. Every morning he needs to
 * know, at a glance, who is ON TRACK to clear 5000 by month-end, who is BELOW
 * target, and — most urgently — who DROPPED below the 5000 pace specifically
 * yesterday (on track two days ago, behind now).
 *
 * CODE computes the truth; the LLM only narrates it. This module does NO LLM
 * calls. It reuses the SAME Supabase fleet_data row + c1 decoder the rest of the
 * fleet spine reads (via lib/fleet.js), so there is ONE source of truth and zero
 * drift. Every export fails SAFE.
 *
 * PROJECTION FORMULA (exact, per spec):
 *   days_elapsed  = calendar days this month on which the driver had >= 1 trip
 *   daily_avg     = current_net / days_elapsed
 *   projected_net = daily_avg * working_days_in_month   (default 26, env M8_WORKING_DAYS)
 *   on_track      = projected_net >= 5000               (env M8_DRIVER_TARGET)
 */

const {
  getFleetRecord, decodeHistory, periodYMD, riyadhTodayYMD, ymdKey,
} = require("./fleet");
const { getEffectiveProfile } = require("./finance");

// ── Config ───────────────────────────────────────────────────────────────────
const TARGET_SAR    = Number(process.env.M8_DRIVER_TARGET || 5000);
const WORKING_DAYS  = Number(process.env.M8_WORKING_DAYS   || 26);
// Min active days before a driver gets a month-end projection. Below this, one
// big or tiny day swings the projection wildly (a single 250-SAR day would
// falsely project "on track"; a single 6-SAR day projects ~150). Such drivers
// go to a "too early to call" list instead of a misleading on-track/below verdict.
const MIN_PROJECT_DAYS = Number(process.env.M8_MIN_PROJECT_DAYS || 3);

const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
                process.env.SUPABASE_ANON_KEY || "").trim();

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const _r0 = (v) => Math.round(v || 0);
const fmtMoney = (v) => (v == null ? "?" : Math.round(v).toLocaleString("en-US"));
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const ymdToISO = (t) => `${t.y}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;

// Normalize whatever the caller hands us into decoded day-entries (ascending).
function toEntries(fleetData) {
  if (Array.isArray(fleetData)) return fleetData;
  if (fleetData && fleetData.khair_history) return decodeHistory(fleetData);
  return [];
}

// A driver "had a trip" on a day if Bolt marked them active or they ran orders /
// earned net. Defensive across blob shapes (orders may be absent for some rows).
function hadTrip(d) {
  return (d.orders || 0) >= 1 || d.isActive || (d.netEarnings || 0) !== 0;
}

// ── Per-driver month-to-date aggregation, counting only days <= cutoffKey ──────
// Returns Map(key -> { name, net, daysOnline }). daysOnline = count of distinct
// month days (<= cutoff) on which the driver had >= 1 trip = the projection's
// days_elapsed (driver-specific, NOT a fleet-wide calendar count).
function aggregateMTD(entries, year, month, cutoffKey) {
  const byKey = new Map();
  for (const e of entries) {
    const p = periodYMD(e.period);
    if (!p || p.y !== year || p.m !== month) continue;
    if (ymdKey(p) > cutoffKey) continue;
    for (const d of (e.drivers || [])) {
      const name = (d.name || "").trim();
      if (!name || !hadTrip(d)) continue;
      const key = d.driverId || name.toLowerCase();
      const rec = byKey.get(key) || { name, net: 0, daysOnline: 0 };
      rec.net += d.netEarnings || 0;
      rec.daysOnline += 1;
      byKey.set(key, rec);
    }
  }
  return byKey;
}

// Apply the projection formula to one aggregated driver record.
function project(rec, workingDays) {
  const daysElapsed = rec.daysOnline;
  const dailyAvg = daysElapsed > 0 ? rec.net / daysElapsed : 0;
  const projected = dailyAvg * workingDays;
  return {
    name: rec.name,
    daysOnline: daysElapsed,
    net: _r0(rec.net),
    dailyAvg: _r0(dailyAvg),
    projected: _r0(projected),
    onTrack: projected >= TARGET_SAR,
  };
}

// Weekly car rental fee for one driver: monthly profile amount / 4.33 weeks.
// Approximation for management reporting only — not for payroll or legal accounting.
// Returns null when no profile or no carRent configured (never guesses).
function weeklyCarRentFor(name, monthKey, profiles, overrides) {
  if (!profiles || !Object.keys(profiles).length) return null;
  const p = getEffectiveProfile(name, monthKey, profiles, overrides || {});
  const cr = p.carRent;
  if (!cr || !cr.dir || cr.dir === "NONE" || !(cr.amount > 0)) return null;
  return _r0(Number(cr.amount) / 4.33); // Build-85f: explicit Number() guards against NaN
}

/**
 * Weekly P&L snapshot: last 7 completed days vs the 7 before that.
 * Returns the pnl object added to the brief, or null when < 1 completed day.
 * @param {Array} entries - decoded history entries
 * @param {object} profiles - khair_courier_profiles map (may be empty)
 * @param {object} overrides - khair_courier_overrides map (may be empty)
 * @param {object} today - {y, m, d} Riyadh today
 * @param {object} [opts] - { target, workingDays } overrides (tests)
 */
function buildPnlSection(entries, profiles, overrides, today, opts) {
  const target      = Number((opts || {}).target      || TARGET_SAR);
  const workingDays = Number((opts || {}).workingDays || WORKING_DAYS);
  const todayKey    = ymdKey(today);

  const allKeys = [...new Set(
    entries.map((e) => periodYMD(e.period))
      .filter((p) => p && ymdKey(p) < todayKey)
      .map(ymdKey),
  )].sort((a, b) => a - b);

  if (!allKeys.length) return null;

  const n             = allKeys.length;
  const thisWeekKeys  = new Set(allKeys.slice(Math.max(0, n - 7)));
  const lastWeekKeys  = new Set(allKeys.slice(Math.max(0, n - 14), Math.max(0, n - 7)));

  function aggWeek(keySet) {
    const map = new Map();
    if (!keySet.size) return map;
    for (const e of entries) {
      const p = periodYMD(e.period);
      if (!p || !keySet.has(ymdKey(p))) continue;
      for (const d of (e.drivers || [])) {
        const name = (d.name || "").trim();
        if (!name || !hadTrip(d)) continue;
        const key = d.driverId || name.toLowerCase();
        const rec = map.get(key) || { name, gross: 0 };
        rec.gross += Number(d.netEarnings || 0); // Build-85f: explicit Number() prevents NaN propagation
        map.set(key, rec);
      }
    }
    return map;
  }

  const thisW  = aggWeek(thisWeekKeys);
  const lastW  = aggWeek(lastWeekKeys);

  // MTD net (for tier checks and "needs attention" pace)
  const latestKey = allKeys[n - 1];
  const mtdAgg    = aggregateMTD(entries, today.y, today.m, latestKey);
  const monthKey  = `${today.y}-${String(today.m + 1).padStart(2, "0")}`;

  const perDriver = [];
  for (const [key, rec] of thisW) {
    const gross        = _r0(rec.gross);
    const weeklyCarRent = weeklyCarRentFor(rec.name, monthKey, profiles, overrides);
    const weeklyNet    = weeklyCarRent != null ? _r0(gross - weeklyCarRent) : null;
    const mtdRec       = mtdAgg.get(key);
    const mtdNet       = _r0(mtdRec ? mtdRec.net : 0);
    perDriver.push({ name: rec.name, gross, weeklyCarRent, weeklyNet, mtdNet });
  }
  perDriver.sort((a, b) => b.gross - a.gross);

  let fleetThisWeek = 0, fleetLastWeek = 0;
  for (const r of thisW.values()) fleetThisWeek += r.gross;
  for (const r of lastW.values()) fleetLastWeek += r.gross;
  fleetThisWeek = _r0(fleetThisWeek);
  fleetLastWeek = _r0(fleetLastWeek);
  const deltaPercent = fleetLastWeek > 0
    ? Math.round(((fleetThisWeek - fleetLastWeek) / fleetLastWeek) * 100)
    : null;

  // Bolt bonus tier hits based on MTD net (bonuses are monthly)
  const tierHits = { t6: [], t5: [], t4: [] };
  for (const d of perDriver) {
    if      (d.mtdNet >= 6000) tierHits.t6.push(d.name);
    else if (d.mtdNet >= 5000) tierHits.t5.push(d.name);
    else if (d.mtdNet >= 4000) tierHits.t4.push(d.name);
  }

  // Needs attention: weekly pace projects below monthly target
  const factor = workingDays / 5;
  const needsAttention = perDriver
    .map((d) => ({
      name: d.name,
      weeklyGross: d.gross,
      projectedMonthly: _r0(d.gross * factor),
      shortfall: _r0(target - d.gross * factor),
    }))
    .filter((d) => d.projectedMonthly < target);

  return {
    perDriver, fleetThisWeek, fleetLastWeek, deltaPercent,
    tierHits, needsAttention,
    weekDays: thisWeekKeys.size, prevWeekDays: lastWeekKeys.size,
  };
}

// ── P&L section renderers ─────────────────────────────────────────────────────

function formatPnlText(pnl, target) {
  if (!pnl) return "";
  const tgt = target || TARGET_SAR;
  const lines = ["", "WEEKLY P&L SNAPSHOT:"];

  const deltaStr = pnl.deltaPercent != null
    ? ` | Δ ${pnl.deltaPercent >= 0 ? "+" : ""}${pnl.deltaPercent}%`
    : "";
  const prevStr = pnl.prevWeekDays > 0
    ? ` | Last week: ${fmtMoney(pnl.fleetLastWeek)} SAR${deltaStr}`
    : "";
  lines.push(`  Fleet gross this week (${pnl.weekDays}d): ${fmtMoney(pnl.fleetThisWeek)} SAR${prevStr}`);

  if (pnl.perDriver.length) {
    lines.push("  Per driver:");
    for (const d of pnl.perDriver) {
      const rentPart = d.weeklyCarRent != null
        ? ` − ${fmtMoney(d.weeklyCarRent)} SAR car rent = ${fmtMoney(d.weeklyNet)} SAR net`
        : "";
      lines.push(`    - ${d.name}: ${fmtMoney(d.gross)} SAR gross${rentPart}`);
    }
  }

  const allHits = [
    ...pnl.tierHits.t6.map((n) => `${n} T6 (6k+)`),
    ...pnl.tierHits.t5.map((n) => `${n} T5 (5k)`),
    ...pnl.tierHits.t4.map((n) => `${n} T4 (4k)`),
  ];
  lines.push("  Bolt bonus tiers (MTD net): " + (allHits.length ? allHits.join(" · ") : "none reached yet"));

  if (pnl.needsAttention.length) {
    lines.push(`  NEEDS ATTENTION — weekly pace below ${fmtMoney(tgt)} SAR/month target:`);
    for (const d of pnl.needsAttention) {
      lines.push(`    - ${d.name}: ${fmtMoney(d.weeklyGross)} SAR/week → projects ${fmtMoney(d.projectedMonthly)} SAR/month (${fmtMoney(d.shortfall)} SAR short)`);
    }
  }

  return lines.join("\n");
}

function formatPnlHTML(pnl, brief) {
  if (!pnl) return "";
  const T   = fmtMoney;
  const tgt = (brief && brief.target) || TARGET_SAR;

  const deltaStr = pnl.deltaPercent != null
    ? ` &nbsp;<span style="color:${pnl.deltaPercent >= 0 ? "#15803d" : "#b91c1c"}">${pnl.deltaPercent >= 0 ? "▲" : "▼"}${Math.abs(pnl.deltaPercent)}%</span>`
    : "";
  const prevStr = pnl.prevWeekDays > 0
    ? ` &nbsp;·&nbsp; Last week: ${T(pnl.fleetLastWeek)} SAR${deltaStr}`
    : "";

  let html = `<h3 style="margin:18px 0 6px;font:600 15px/1.3 system-ui,Arial;color:#374151">Weekly P&amp;L Snapshot (${pnl.weekDays}d)</h3>`;
  html += `<div style="margin:4px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font:13px/1.4 system-ui,Arial;color:#111">`;
  html += `<b>Fleet gross this week:</b> ${T(pnl.fleetThisWeek)} SAR${prevStr}</div>`;

  html += pnl.perDriver.map((d) => {
    const rentPart = d.weeklyCarRent != null
      ? ` &minus; ${T(d.weeklyCarRent)} SAR rent &rarr; <b>${T(d.weeklyNet)} SAR net</b>`
      : "";
    return `<div style="margin:2px 0;padding:6px 10px;border:1px solid #f0f0f0;border-radius:6px;font:12px/1.4 system-ui,Arial;color:#333">` +
      `<b>${esc(d.name)}</b>: ${T(d.gross)} SAR gross${rentPart}</div>`;
  }).join("");

  const hitSpans = [
    ...pnl.tierHits.t6.map((n) => `<span style="color:#15803d;font-weight:600">${esc(n)} T6</span>`),
    ...pnl.tierHits.t5.map((n) => `<span style="color:#15803d">${esc(n)} T5</span>`),
    ...pnl.tierHits.t4.map((n) => `<span style="color:#b45309">${esc(n)} T4</span>`),
  ];
  html += `<div style="margin:8px 0 4px;font:12px system-ui,Arial;color:#555">`;
  html += `<b>Bolt bonus tiers (MTD):</b> `;
  html += hitSpans.length ? hitSpans.join(" &nbsp;·&nbsp; ") : `<span style="color:#888">none reached yet</span>`;
  html += `</div>`;

  if (pnl.needsAttention.length) {
    html += `<div style="margin:8px 0;padding:8px 10px;background:#fef9f0;border:1px solid #fde68a;border-radius:8px;font:12px/1.5 system-ui,Arial;color:#78350f">`;
    html += `<b>Needs attention</b> — weekly pace below ${T(tgt)} SAR/month:<ul style="margin:4px 0;padding-left:16px">`;
    for (const d of pnl.needsAttention) {
      html += `<li>${esc(d.name)}: ${T(d.weeklyGross)} SAR/wk → projects ${T(d.projectedMonthly)} SAR (${T(d.shortfall)} SAR short)</li>`;
    }
    html += `</ul></div>`;
  }

  return html;
}

// ── Multi-platform section (Build-93) ─────────────────────────────────────────
// Cross-platform earnings (Uber/HungerStation/Keeta/Noon) appended to the brief
// ONLY when a platformData merge is supplied. Strictly guarded so platformData
// absent = no lines added = byte-identical brief (zero regression).
function formatPlatformText(platformData) {
  if (!platformData || !platformData.summary) return "";
  const s = platformData.summary;
  const plats = s.platforms || {};
  const keys = Object.keys(plats).sort((a, b) => (plats[b].gross || 0) - (plats[a].gross || 0));
  if (!keys.length) return "";
  const lines = ["", "── Multi-Platform (last sync) ──"];
  for (const k of keys) {
    const p = plats[k];
    const drv = `${p.drivers} driver${p.drivers === 1 ? "" : "s"}`;
    lines.push(`• ${p.label}: ${drv}, ${fmtMoney(p.trips)} ${p.unitLabel}, ${fmtMoney(p.gross)} SAR gross`);
  }
  lines.push(`Total cross-platform gross: ${fmtMoney(s.totalGross)} SAR`);
  return lines.join("\n");
}

function formatPlatformHTML(platformData) {
  if (!platformData || !platformData.summary) return "";
  const s = platformData.summary;
  const plats = s.platforms || {};
  const keys = Object.keys(plats).sort((a, b) => (plats[b].gross || 0) - (plats[a].gross || 0));
  if (!keys.length) return "";
  let html = `<h3 style="margin:18px 0 6px;font:600 15px/1.3 system-ui,Arial;color:#374151">Multi-Platform (last sync)</h3>`;
  html += keys.map((k) => {
    const p = plats[k];
    const drv = `${p.drivers} driver${p.drivers === 1 ? "" : "s"}`;
    return `<div style="margin:2px 0;padding:6px 10px;border:1px solid #f0f0f0;border-radius:6px;font:12px/1.4 system-ui,Arial;color:#333">` +
      `<b>${esc(p.label)}</b>: ${drv}, ${fmtMoney(p.trips)} ${esc(p.unitLabel)}, ${fmtMoney(p.gross)} SAR gross</div>`;
  }).join("");
  html += `<div style="margin:6px 0 4px;font:12px system-ui,Arial;color:#111"><b>Total cross-platform gross:</b> ${fmtMoney(s.totalGross)} SAR</div>`;
  return html;
}

/**
 * Build the 3-section morning brief object from fleet data.
 * @param {object|Array} fleetData - a fleet_data record (with khair_history) OR
 *                                   an already-decoded entries array.
 * @param {object} [opts] - { workingDays, target, todayYMD, platformData } overrides (tests).
 *   opts.platformData (default null) is a mergePlatformData() result; when present
 *   it is attached to the brief and rendered as a Multi-Platform section. When
 *   null the brief is byte-identical to the Bolt-only brief (zero regression).
 * @returns {object} the brief object (see fields below).
 */
function generateMorningBrief(fleetData, opts = {}) {
  const workingDays = Number(opts.workingDays || WORKING_DAYS);
  const target = Number(opts.target || TARGET_SAR);
  const today = opts.todayYMD || riyadhTodayYMD();
  const platformData = opts.platformData || null;
  const entries = toEntries(fleetData);

  // Finance profiles/overrides — available when fleetData is a full fleet record.
  const profiles  = (fleetData && !Array.isArray(fleetData) && fleetData.khair_courier_profiles)  || {};
  const overrides = (fleetData && !Array.isArray(fleetData) && fleetData.khair_courier_overrides) || {};

  const empty = {
    date: ymdToISO(today), month: `${MONTH_ABBR[today.m]} ${today.y}`,
    target, workingDays, generatedAt: new Date().toISOString(),
    onTrack: [], below: [], droppedYesterday: [], tooEarly: [],
    counts: { onTrack: 0, below: 0, dropped: 0, tooEarly: 0, drivers: 0 },
    pnl: null,
    note: "No fleet data available for this month yet.",
  };
  if (platformData) empty.platformData = platformData;
  if (!entries.length) return empty;

  const todayKey = ymdKey(today);
  // Distinct completed-day keys in THIS month (exclude today's partial day).
  const monthKeys = [...new Set(entries
    .map((e) => periodYMD(e.period))
    .filter((p) => p && p.y === today.y && p.m === today.m && ymdKey(p) < todayKey)
    .map(ymdKey))].sort((a, b) => a - b);
  if (!monthKeys.length) return empty;

  const curKey  = monthKeys[monthKeys.length - 1];          // latest complete day (= yesterday)
  const prevKey = monthKeys.length >= 2 ? monthKeys[monthKeys.length - 2] : null; // day before

  const curAgg = aggregateMTD(entries, today.y, today.m, curKey);
  const cur = new Map();
  for (const [k, rec] of curAgg) cur.set(k, project(rec, workingDays));

  let prev = new Map();
  if (prevKey != null) {
    const prevAgg = aggregateMTD(entries, today.y, today.m, prevKey);
    for (const [k, rec] of prevAgg) prev.set(k, project(rec, workingDays));
  }

  // Calendar days left in the month (incl. today) — the recovery runway.
  const dim = daysInMonth(today.y, today.m);
  const daysLeftCalendar = Math.max(0, dim - today.d + 1);

  const onTrack = [], below = [], droppedYesterday = [], tooEarly = [];
  for (const [k, c] of cur) {
    // Not enough active days yet → no trustworthy projection. Surface separately.
    if (c.daysOnline < MIN_PROJECT_DAYS) {
      tooEarly.push({ name: c.name, daysOnline: c.daysOnline, net: c.net });
      continue;
    }
    if (c.onTrack) {
      // A driver already PAST 5,000 MTD has no "gap" — show how far OVER instead
      // (a negative "gap to 5,000" reads wrong for someone who already hit it).
      const hit = c.net >= target;
      onTrack.push({
        name: c.name, daysOnline: c.daysOnline, net: c.net, projected: c.projected,
        hit, gap: hit ? 0 : _r0(target - c.net), overBy: hit ? _r0(c.net - target) : 0,
      });
    } else {
      below.push({ name: c.name, daysOnline: c.daysOnline, net: c.net, projected: c.projected, behind: _r0(target - c.projected) });
    }
    // DROPPED YESTERDAY: was on pace two days ago, no longer on pace now. Only
    // when BOTH snapshots have enough days (else the "was on pace" is noise too).
    const p = prev.get(k);
    if (p && p.daysOnline >= MIN_PROJECT_DAYS && p.onTrack && !c.onTrack) {
      droppedYesterday.push({
        name: c.name,
        paceWas: p.projected,      // projected net as of two days ago
        paceNow: c.projected,      // projected net now
        net: c.net,
        daysLeft: daysLeftCalendar,
      });
    }
  }

  onTrack.sort((a, b) => b.projected - a.projected);   // strongest first
  below.sort((a, b) => a.projected - b.projected);     // furthest behind first
  droppedYesterday.sort((a, b) => (b.paceWas - b.paceNow) - (a.paceWas - a.paceNow)); // biggest fall first
  tooEarly.sort((a, b) => b.net - a.net);              // most-earning first

  const curYMD = (() => {
    const found = entries.map((e) => periodYMD(e.period)).find((p) => p && ymdKey(p) === curKey);
    return found || today;
  })();

  const pnl = buildPnlSection(entries, profiles, overrides, today, { workingDays, target });

  const brief = {
    date: ymdToISO(today),
    asOfDate: ymdToISO(curYMD),                 // the latest complete day the brief reflects
    month: `${MONTH_ABBR[today.m]} ${today.y}`,
    target, workingDays,
    generatedAt: new Date().toISOString(),
    minProjectDays: MIN_PROJECT_DAYS,
    onTrack, below, droppedYesterday, tooEarly,
    counts: { onTrack: onTrack.length, below: below.length, dropped: droppedYesterday.length, tooEarly: tooEarly.length, drivers: cur.size },
    pnl,
  };
  if (platformData) brief.platformData = platformData;
  return brief;
}

/**
 * Human-readable text rendering of a brief (for M8 chat + summary_text storage).
 */
function formatBriefText(brief) {
  if (!brief) return "No morning brief available.";
  const lines = [];
  lines.push(`MORNING FLEET BRIEF — ${brief.month} (target ${fmtMoney(brief.target)} SAR net / driver, projected over ${brief.workingDays} working days).`);
  if (brief.asOfDate) lines.push(`Reflects data through ${brief.asOfDate}. ${brief.counts.drivers} drivers tracked.`);
  if (brief.note) { lines.push(brief.note); return lines.join("\n"); }

  if (brief.pnl) lines.push(formatPnlText(brief.pnl, brief.target));

  // Section 3 first if anything dropped — it is the most urgent group.
  if (brief.droppedYesterday.length) {
    lines.push("");
    lines.push(`*** DROPPED YESTERDAY (${brief.droppedYesterday.length}) — most urgent: on track two days ago, behind now ***`);
    for (const d of brief.droppedYesterday) {
      lines.push(`  - ${d.name}: pace fell from ${fmtMoney(d.paceWas)} -> ${fmtMoney(d.paceNow)} SAR projected (${fmtMoney(d.net)} SAR so far). ${d.daysLeft} calendar days left to recover.`);
    }
  }

  lines.push("");
  lines.push(`ON TRACK (${brief.onTrack.length}) — projected >= ${fmtMoney(brief.target)} SAR by month-end:`);
  if (brief.onTrack.length) {
    for (const d of brief.onTrack) {
      const tail = d.hit
        ? `target hit (+${fmtMoney(d.overBy)} SAR over)`
        : `${fmtMoney(d.gap)} SAR to ${fmtMoney(brief.target)}`;
      lines.push(`  - ${d.name}: ${d.daysOnline}d online | ${fmtMoney(d.net)} SAR net | projected ${fmtMoney(d.projected)} SAR | ${tail}.`);
    }
  } else {
    lines.push("  (none)");
  }

  lines.push("");
  lines.push(`BELOW TARGET (${brief.below.length}) — projected < ${fmtMoney(brief.target)} SAR:`);
  if (brief.below.length) {
    for (const d of brief.below) {
      lines.push(`  - ${d.name}: ${fmtMoney(d.net)} SAR net | projected ${fmtMoney(d.projected)} SAR | ${fmtMoney(d.behind)} SAR behind pace.`);
    }
  } else {
    lines.push("  (none)");
  }

  if (brief.tooEarly && brief.tooEarly.length) {
    lines.push("");
    lines.push(`TOO EARLY TO CALL (${brief.tooEarly.length}) — fewer than ${brief.minProjectDays || 3} active days, no reliable projection yet:`);
    for (const d of brief.tooEarly) {
      lines.push(`  - ${d.name}: ${d.daysOnline}d online | ${fmtMoney(d.net)} SAR so far.`);
    }
  }

  if (brief.platformData) {
    const pt = formatPlatformText(brief.platformData);
    if (pt) lines.push(pt);
  }

  lines.push("");
  lines.push("These figures are DETERMINISTIC ground truth from the synced fleet data. Quote and explain; never invent a driver or alter a number. Projections assume each driver holds their current per-active-day average across the remaining working days — label them ESTIMATES. Drivers with too few active days are listed separately, not projected.");
  return lines.join("\n");
}

// Minimal HTML escape for driver names / values placed into the email body.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * HTML rendering of a brief for the morning email (Build-70). Inline styles only
 * (email clients strip <style>). `unsubUrl` (optional) renders an unsubscribe link
 * in the footer. Same ground-truth figures as formatBriefText — never invents.
 */
function formatBriefHTML(brief, unsubUrl) {
  if (!brief) return "<p>No morning brief available.</p>";
  const T = (v) => fmtMoney(v);
  const sec = (title, color, rowsHtml) =>
    `<h3 style="margin:18px 0 6px;font:600 15px/1.3 system-ui,Arial;color:${color}">${esc(title)}</h3>${rowsHtml}`;
  const card = (inner) =>
    `<div style="margin:4px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font:13px/1.4 system-ui,Arial;color:#111">${inner}</div>`;
  const none = `<div style="font:13px system-ui,Arial;color:#888;padding:4px 0">(none)</div>`;

  const head = `<div style="font:700 18px system-ui,Arial;color:#111">Morning Fleet Brief — ${esc(brief.month)}</div>` +
    `<div style="font:13px system-ui,Arial;color:#555;margin-top:2px">Target ${T(brief.target)} SAR net / driver over ${brief.workingDays} working days.` +
    (brief.asOfDate ? ` Reflects data through ${esc(brief.asOfDate)}. ${brief.counts.drivers} drivers.` : "") + `</div>`;

  if (brief.note) {
    return `${head}<p style="font:13px system-ui,Arial;color:#555;margin-top:12px">${esc(brief.note)}</p>`;
  }

  let body = "";
  if (brief.pnl) body += formatPnlHTML(brief.pnl, brief);
  if (brief.droppedYesterday.length) {
    body += sec(`⚠ DROPPED YESTERDAY (${brief.droppedYesterday.length}) — most urgent`, "#b91c1c",
      brief.droppedYesterday.map((d) =>
        card(`<b>${esc(d.name)}</b> — pace fell <b>${T(d.paceWas)} → ${T(d.paceNow)} SAR</b> projected (${T(d.net)} SAR so far). ${d.daysLeft} days left to recover.`)
      ).join(""));
  }
  body += sec(`ON TRACK (${brief.onTrack.length})`, "#15803d",
    brief.onTrack.length ? brief.onTrack.map((d) => {
      const gapStr = d.hit ? `<b>target hit</b> (+${T(d.overBy)} over)` : `${T(d.gap)} to ${T(brief.target)}`;
      return card(`<b>${esc(d.name)}</b> — ${d.daysOnline}d online · ${T(d.net)} SAR net · projected <b>${T(d.projected)} SAR</b> · ${gapStr}`);
    }).join("") : none);
  body += sec(`BELOW TARGET (${brief.below.length})`, "#b45309",
    brief.below.length ? brief.below.map((d) =>
      card(`<b>${esc(d.name)}</b> — ${T(d.net)} SAR net · projected <b>${T(d.projected)} SAR</b> · ${T(d.behind)} behind pace`)
    ).join("") : none);
  if (brief.tooEarly && brief.tooEarly.length) {
    body += sec(`TOO EARLY TO CALL (${brief.tooEarly.length}) — under ${brief.minProjectDays || 3} active days`, "#6b7280",
      brief.tooEarly.map((d) =>
        card(`<b>${esc(d.name)}</b> — ${d.daysOnline}d online · ${T(d.net)} SAR so far`)
      ).join(""));
  }

  if (brief.platformData) body += formatPlatformHTML(brief.platformData);

  const foot = `<p style="font:11px system-ui,Arial;color:#999;margin-top:18px;border-top:1px solid #eee;padding-top:10px">` +
    `Deterministic ground truth from synced fleet data. Projections are estimates (current per-active-day average held to month-end).` +
    (unsubUrl ? `<br><a href="${esc(unsubUrl)}" style="color:#999">Stop these morning emails</a>` : "") + `</p>`;

  return `<div style="max-width:640px;margin:0 auto;padding:8px">${head}${body}${foot}</div>`;
}

// ── Query detection — does the message ask for the morning brief? ──────────────
const BRIEF_QUERY_PATTERNS = [
  /\bmorning\s+brief\b/i,
  /\bdaily\s+brief\b/i,
  /\bbrief\s+me\b/i,
  /\bfleet\s+status\s+(?:today|this\s+morning|now)\b/i,
  /\bhow\s+(?:are|'?re|r)\s+(?:my\s+|the\s+)?drivers?\s+doing\b/i,
  /\bwho\s+is\s+behind\b/i,
  /\bwho'?s\s+behind\b/i,
  /\bwho\s+(?:has\s+)?dropped\b/i,
  /\bwho\s+fell\s+(?:behind|off)\b/i,
  /\b(?:today'?s|the)\s+fleet\s+brief\b/i,
];
function detectMorningBriefQuery(message) {
  const s = (message || "");
  return BRIEF_QUERY_PATTERNS.some((re) => re.test(s));
}

// ── Supabase IO (fails SAFE — null on any error) ──────────────────────────────
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

// Upsert one brief row (one per date). Used by the cron / api endpoint.
async function saveBrief(brief) {
  if (!brief) return null;
  const body = { date: brief.date, brief_json: brief, summary_text: formatBriefText(brief) };
  return sbFetch("m8_morning_briefs?on_conflict=date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body),
  });
}

// Fetch today's stored brief (Riyadh date). Returns the brief_json object or null.
async function getTodayBrief() {
  const today = riyadhTodayYMD();
  const iso = ymdToISO(today);
  const rows = await sbFetch(`m8_morning_briefs?date=eq.${iso}&select=brief_json,summary_text&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) return null;
  return rows[0].brief_json || null;
}

// Compute a fresh brief straight from the live fleet record (no DB read).
// Used as a fallback when no stored brief exists yet for today.
async function computeLiveBrief() {
  try {
    const record = await getFleetRecord();
    if (!record) return null;
    const entries = decodeHistory(record);
    return generateMorningBrief(entries);
  } catch (err) {
    console.error("[M8 morning-brief] live compute error (non-fatal):", err.message);
    return null;
  }
}

module.exports = {
  generateMorningBrief,
  buildBrief: generateMorningBrief, // Build-93: spec alias — same function, clearer name for callers
  formatBriefText,
  formatBriefHTML,
  detectMorningBriefQuery,
  getTodayBrief,
  saveBrief,
  computeLiveBrief,
  // exported for tests / reuse:
  aggregateMTD, project, toEntries, TARGET_SAR, WORKING_DAYS,
  buildPnlSection, formatPnlText, formatPnlHTML,
  formatPlatformText, formatPlatformHTML,
};
