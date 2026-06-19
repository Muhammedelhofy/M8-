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

// ── Config ───────────────────────────────────────────────────────────────────
const TARGET_SAR    = Number(process.env.M8_DRIVER_TARGET || 5000);
const WORKING_DAYS  = Number(process.env.M8_WORKING_DAYS   || 26);

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

/**
 * Build the 3-section morning brief object from fleet data.
 * @param {object|Array} fleetData - a fleet_data record (with khair_history) OR
 *                                   an already-decoded entries array.
 * @param {object} [opts] - { workingDays, target, todayYMD } overrides (tests).
 * @returns {object} the brief object (see fields below).
 */
function generateMorningBrief(fleetData, opts = {}) {
  const workingDays = Number(opts.workingDays || WORKING_DAYS);
  const target = Number(opts.target || TARGET_SAR);
  const today = opts.todayYMD || riyadhTodayYMD();
  const entries = toEntries(fleetData);

  const empty = {
    date: ymdToISO(today), month: `${MONTH_ABBR[today.m]} ${today.y}`,
    target, workingDays, generatedAt: new Date().toISOString(),
    onTrack: [], below: [], droppedYesterday: [],
    counts: { onTrack: 0, below: 0, dropped: 0, drivers: 0 },
    note: "No fleet data available for this month yet.",
  };
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

  const onTrack = [], below = [], droppedYesterday = [];
  for (const [k, c] of cur) {
    if (c.onTrack) {
      onTrack.push({ name: c.name, daysOnline: c.daysOnline, net: c.net, projected: c.projected, gap: _r0(target - c.net) });
    } else {
      below.push({ name: c.name, daysOnline: c.daysOnline, net: c.net, projected: c.projected, behind: _r0(target - c.projected) });
    }
    // DROPPED YESTERDAY: was on pace two days ago, no longer on pace now.
    const p = prev.get(k);
    if (p && p.onTrack && !c.onTrack) {
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

  const curYMD = (() => {
    const found = entries.map((e) => periodYMD(e.period)).find((p) => p && ymdKey(p) === curKey);
    return found || today;
  })();

  return {
    date: ymdToISO(today),
    asOfDate: ymdToISO(curYMD),                 // the latest complete day the brief reflects
    month: `${MONTH_ABBR[today.m]} ${today.y}`,
    target, workingDays,
    generatedAt: new Date().toISOString(),
    onTrack, below, droppedYesterday,
    counts: { onTrack: onTrack.length, below: below.length, dropped: droppedYesterday.length, drivers: cur.size },
  };
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
      lines.push(`  - ${d.name}: ${d.daysOnline}d online | ${fmtMoney(d.net)} SAR net | projected ${fmtMoney(d.projected)} SAR | ${fmtMoney(d.gap)} SAR to ${fmtMoney(brief.target)}.`);
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

  lines.push("");
  lines.push("These figures are DETERMINISTIC ground truth from the synced fleet data. Quote and explain; never invent a driver or alter a number. Projections assume each driver holds their current per-active-day average across the remaining working days — label them ESTIMATES.");
  return lines.join("\n");
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
  formatBriefText,
  detectMorningBriefQuery,
  getTodayBrief,
  saveBrief,
  computeLiveBrief,
  // exported for tests / reuse:
  aggregateMTD, project, toEntries, TARGET_SAR, WORKING_DAYS,
};
