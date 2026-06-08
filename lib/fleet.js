/**
 * M8 Fleet Analysis — lib/fleet.js  (Milestone 3)
 *
 * The deterministic spine for fleet questions. CODE finds the truth; the LLM
 * only EXPLAINS it. This module does NO LLM calls and NEVER lets a model touch
 * raw driver rows — it fetches the dashboard's cloud blob, decodes it, runs the
 * aggregations deterministically, and hands back a tiny (<200-token) metric
 * packet for the orchestrator to inject into the prompt.
 *
 *   Supabase fleet_data row  →  c1 decode  →  in-memory aggregation
 *      →  compact metric packet  →  orchestrator appends to systemInstruction
 *
 * WHY ON-DEMAND (not a normalized fleet_driver_days table): the dashboard
 * hard-caps the WHOLE cloud record at ~96KB and trims oldest days to fit, so the
 * blob is only ~30-60 days × ~14-30 drivers (< ~2k driver-days). JSON.parse +
 * a couple of maps is single-digit milliseconds — nowhere near Vercel's window.
 * Reading the same row the dashboard maintains means ONE source of truth and
 * zero drift (corrections overwrite days via newer-wins merge on that row).
 * Graduate to a normalized table only if/when the blob outgrows the 96KB window.
 *
 * THE 'c1' CODEC is NOT compression — no gzip/zlib, no library. It is the
 * dashboard's own JSON key-shortening scheme (index.html packDriver/packEntry):
 * 1-3 char keys, zero/empty fields omitted, numbers rounded to 2dp. unpackEntry
 * below is a verbatim port of the dashboard's decoder and is lossless for every
 * field these aggregations read.
 *
 * FAULT TOLERANCE: every export fails SAFE. A fetch/parse/decode error returns
 * null or an empty packet, so orchestrate() runs WITHOUT fleet context rather
 * than crashing. This module never throws to its caller.
 */

// ── Config (env-driven; M8 reads the SAME Supabase row the dashboard writes) ──
// The dashboard's fleet_data table lives in the SAME Supabase project M8 already
// uses (ref ltqpoupferwituusxwal), so by default we reuse M8's existing
// SUPABASE_URL + service key — the service role bypasses RLS, so the read just
// works with NO new env vars. FLEET_SUPABASE_URL/KEY override only if the
// dashboard is ever pointed at a different project.
const SB_URL = (process.env.FLEET_SUPABASE_URL || process.env.SUPABASE_URL || "")
  .trim().replace(/\/+$/, "");
const SB_KEY = (process.env.FLEET_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const SB_ROW_ID = (process.env.FLEET_ROW_ID || "fleet").trim();   // dashboard uses id='fleet'
const FETCH_TIMEOUT_MS = 6000;

// Thresholds for "needs attention" flags (deterministic, tunable via env).
const LOW_ACCEPT = Number(process.env.FLEET_LOW_ACCEPT || 70);  // % acceptance floor
const LOW_UTIL   = Number(process.env.FLEET_LOW_UTIL   || 60);  // % utilisation floor

// ── c1 decoder — verbatim port of index.html unpackDriver/unpackEntry ─────────
const MONTH_MAP = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

// "25 May 2026" → epoch ms (mirrors dashboard periodSortKey). 0 if unparseable.
function periodSortKey(period) {
  const m = (period || "").match(/(\d{1,2})\s(\w{3})\s(\d{4})/);
  if (!m) return 0;
  return new Date(parseInt(m[3]), MONTH_MAP[m[2]] ?? 0, parseInt(m[1])).getTime();
}

// ── Date selection — pick the day the user actually asked about ───────────────
// (The blob's newest entry is usually TODAY, an in-progress partial day. Without
// this, every fleet answer reported today-so-far while the LLM mislabeled it.)
const MONTH_ABBR  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_ABBR3 = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

// "6 Jun 2026" → {y, m(0-indexed), d} | null
function periodYMD(period) {
  const mm = (period || "").match(/(\d{1,2})\s(\w{3})\s(\d{4})/);
  if (!mm) return null;
  const mi = MONTH_MAP[mm[2]];
  if (mi == null) return null;
  return { y: +mm[3], m: mi, d: +mm[1] };
}
const ymdKey = (t) => (t ? t.y * 10000 + t.m * 100 + t.d : -1);

function riyadhTodayYMD() {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, mo, d] = s.split("-").map(Number);
  return { y, m: mo - 1, d };
}
function addDays(t, n) {
  const dt = new Date(Date.UTC(t.y, t.m, t.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

// Extract a requested date from the message → {rel:'today'|'yesterday'} | {y,m,d} | null
function parseRequestedDate(message, fallbackYear) {
  const s = (message || "").toLowerCase();
  if (/\b(today|right now|so far|this morning|tonight)\b/.test(s) || /اليوم/.test(s)) return { rel: "today" };
  if (/\b(yesterday|last night)\b/.test(s) || /أمس|امبارح|البارحة/.test(s)) return { rel: "yesterday" };
  let dd = null, mon = -1, mm;
  if ((mm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/))) {
    dd = +mm[1]; mon = MONTH_ABBR3.indexOf(mm[2]);
  } else if ((mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/))) {
    mon = MONTH_ABBR3.indexOf(mm[1]); dd = +mm[2];
  }
  if (dd != null && mon >= 0 && dd >= 1 && dd <= 31) {
    const yr = (s.match(/\b(20\d{2})\b/) || [])[1];
    return { y: yr ? +yr : fallbackYear, m: mon, d: dd };
  }
  return null;
}

// Choose which day entry to report. `entries` are sorted ascending by date.
// Returns { index, found, isToday, defaulted, label }.
function resolveTarget(message, entries) {
  const keys = entries.map((e) => ymdKey(periodYMD(e.period)));
  const latestYear = (periodYMD(entries[entries.length - 1].period) || riyadhTodayYMD()).y;
  const today = riyadhTodayYMD();
  const todayKey = ymdKey(today);

  const req = parseRequestedDate(message, latestYear);
  let wantKey = null, label = null;
  if (req && req.rel === "today") { wantKey = todayKey; label = "today"; }
  else if (req && req.rel === "yesterday") { const y = addDays(today, -1); wantKey = ymdKey(y); label = `${y.d} ${MONTH_ABBR[y.m]} ${y.y}`; }
  else if (req) { wantKey = ymdKey(req); label = `${req.d} ${MONTH_ABBR[req.m]} ${req.y}`; }

  if (wantKey != null) {
    const idx = keys.indexOf(wantKey);
    if (idx >= 0) return { index: idx, found: true, isToday: keys[idx] === todayKey, label };
    return { index: -1, found: false, label };           // asked for a date we don't have
  }
  // No date in the message → most recent COMPLETE day (before today); else latest.
  let idx = -1;
  for (let i = entries.length - 1; i >= 0; i--) { if (keys[i] < todayKey) { idx = i; break; } }
  if (idx < 0) idx = entries.length - 1;
  return { index: idx, found: true, isToday: keys[idx] === todayKey, defaulted: true, label: null };
}

function unpackDriver(o) {
  return {
    name: o.n || "", driverId: o.i || "", phone: o.ph || "", email: o.em || "",
    tier: { level: o.tl ?? -1, englishName: o.tn || "" },
    orders: o.o || 0, hoursOnline: o.h || 0, netEarnings: o.ne || 0, grossEarnings: o.ge || 0,
    acceptance: o.ac || 0, rating: o.ra || 0, score: o.sc || 0, distanceTotal: o.dt || 0, distanceAvg: o.da || 0,
    cashGap: o.cg || 0, payoutGap: o.pg || 0, projectedPayout: o.pp || 0, actualPayout: o.ap || 0,
    tips: o.tp || 0, campaign: o.cm || 0, commission: o.co || 0, netPerHour: o.nph || 0, utilization: o.ut || 0,
    finishRate: o.fr || 0,
    fleetCut: o.fc ?? null, driverPayout: o.dp ?? null,
    activeCategories: o.cat || "", isActive: !!o.a,
    grossInApp: o.gia || 0, acceptanceTotal: o.act || 0, cashEarnings: o.ce || 0, cancellationFees: o.cf || 0,
    tollFees: o.tf || 0, expenseReimbursements: o.er || 0, bookingFees: o.bf || 0, refundsToRiders: o.rr || 0,
    commissionDiscountInApp: o.cdi || 0, commissionDiscountCash: o.cdc || 0,
  };
}

function unpackEntry(c) {
  return {
    period: c.p, filename: c.f, uploadedAt: c.u, periodInfo: c.pi,
    driverCount: c.dc, activeCount: c.ac, totalOrders: c.to,
    totalGross: c.tg || 0, totalNet: c.tn || 0, avgAcceptance: c.aa || 0,
    drivers: (c.d || []).map(unpackDriver),
  };
}

/**
 * Decode khair_history from a cloud record in EITHER format, oldest→newest.
 * Detects packed 'c1' entries (short keys .p/.d) vs legacy full-key entries
 * (.period/.drivers). Enforces the drivers-array invariant so downstream
 * .drivers.* calls can never crash on a corrupt entry. Returns [] on anything off.
 */
function decodeHistory(record) {
  const raw = record && record.khair_history;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const isPacked = record.khair_fmt === "c1" || (raw[0] && raw[0].p !== undefined && raw[0].period === undefined);
  const entries = isPacked ? raw.map(unpackEntry) : raw;
  for (const e of entries) if (e && !Array.isArray(e.drivers)) e.drivers = [];
  return entries
    .filter((e) => e && e.period)
    .sort((a, b) => periodSortKey(a.period) - periodSortKey(b.period));
}

// ── Supabase read (raw REST — same call the dashboard's cloudRead makes) ──────
// GET /rest/v1/fleet_data?id=eq.fleet&select=data  →  rows[0].data is the record.
// Returns the record object, or null on any failure (fails SAFE).
async function fetchFleetRecord() {
  if (!SB_URL || !SB_KEY) {
    console.error("[M8 fleet] Supabase URL/key not configured (SUPABASE_URL + any of SUPABASE_SERVICE_KEY/ANON_KEY)");
    return null;
  }
  const url = `${SB_URL}/rest/v1/fleet_data?id=eq.${encodeURIComponent(SB_ROW_ID)}&select=data`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0].data || {} : {};
  } catch (err) {
    console.error("[M8 fleet] fetch error (non-fatal):", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Aggregations (pure, deterministic) ───────────────────────────────────────
const _sum = (arr, f) => arr.reduce((a, d) => a + (f(d) || 0), 0);
const _avg = (arr, f) => (arr.length ? _sum(arr, f) / arr.length : 0);
const _r0  = (v) => Math.round(v || 0);
const _r1  = (v) => Math.round((v || 0) * 10) / 10;
const _r2  = (v) => Math.round((v || 0) * 100) / 100;   // money → 2dp, matches the dashboard

/** Fleet-level metrics for ONE day entry. Per-day totals are precomputed in the
 *  blob; driver-derived figures (cash split, utilisation, hours) are summed here. */
function dayMetrics(entry) {
  const drivers = entry.drivers || [];
  const active  = drivers.filter((d) => d.isActive);
  const rated   = active.filter((d) => d.rating > 0);
  return {
    period:    entry.period,
    sortKey:   periodSortKey(entry.period),
    drivers:   drivers.length,
    active:    active.length,
    // ACTIVE-only to match the dashboard's KPI (sumKPIs filters d.isActive). The
    // blob's precomputed totals sum ALL drivers, which over-counts inactive
    // drivers who earned tips/campaign/adjustments without being active.
    orders:    _sum(active, (d) => d.orders),
    gross:     _sum(active, (d) => d.grossEarnings),
    net:       _sum(active, (d) => d.netEarnings),
    cash:      _sum(active, (d) => d.cashEarnings),
    inApp:     _sum(active, (d) => d.grossInApp),
    hours:     _sum(active, (d) => d.hoursOnline),   // active-only, to match the dashboard KPI
    avgAccept: _avg(active, (d) => d.acceptance),
    avgFinish: _avg(active, (d) => d.finishRate),
    avgUtil:   _avg(active, (d) => d.utilization),
    avgRating: _avg(rated,  (d) => d.rating),
  };
}

/** Top/bottom N active drivers for a day by a driver field (default net earnings). */
function rankDrivers(entry, metric = "netEarnings", n = 3) {
  const active = (entry.drivers || []).filter((d) => d.isActive);
  const sorted = [...active].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  return {
    top:    sorted.slice(0, n).map((d) => ({ name: d.name, value: _r0(d[metric]), accept: _r0(d.acceptance) })),
    bottom: sorted.slice(-n).reverse().map((d) => ({ name: d.name, value: _r0(d[metric]), accept: _r0(d.acceptance) })),
  };
}

/** Active drivers tripping an attention threshold on the given day. */
function attentionFlags(entry) {
  const active = (entry.drivers || []).filter((d) => d.isActive);
  return {
    lowAccept: active.filter((d) => d.acceptance > 0 && d.acceptance < LOW_ACCEPT)
      .map((d) => ({ name: d.name, accept: _r0(d.acceptance) })),
    lowUtil: active.filter((d) => d.utilization > 0 && d.utilization < LOW_UTIL)
      .map((d) => ({ name: d.name, util: _r0(d.utilization) })),
  };
}

/**
 * Mission-control summary for the day at `index` vs the trailing up-to-7-day
 * average BEFORE it. Pure aggregation — the % deltas and flags are computed here
 * so the LLM never does arithmetic. Returns null if the index is out of range.
 */
function missionControl(entries, index) {
  if (!entries || index == null || index < 0 || index >= entries.length) return null;
  const target   = entries[index];
  const trailing = entries.slice(Math.max(0, index - 7), index); // up to 7 days BEFORE target
  const day      = dayMetrics(target);
  const trailAvgNet = trailing.length ? _avg(trailing.map(dayMetrics), (d) => d.net) : null;
  const netVsTrailPct = trailAvgNet ? Math.round(((day.net - trailAvgNet) / trailAvgNet) * 100) : null;
  const cashPct = day.gross ? Math.round((day.cash / day.gross) * 100) : null;
  const ranked  = rankDrivers(target, "netEarnings", 3);
  const flags   = attentionFlags(target);

  // Day-over-day delta + "regulars who stopped working today" (active on ≥half
  // the trailing days but not on the target day) — proactive anomaly surfacing.
  const prevDay = index > 0 ? dayMetrics(entries[index - 1]) : null;
  const dayOverDayPct = prevDay && prevDay.net ? Math.round(((day.net - prevDay.net) / prevDay.net) * 100) : null;
  const activeTodayIds = new Set((target.drivers || []).filter((d) => d.isActive).map((d) => d.driverId || d.name));
  const trailAct = {};
  for (const e of trailing) for (const d of (e.drivers || [])) {
    if (!d.isActive) continue;
    const k = d.driverId || d.name; if (!k) continue;
    (trailAct[k] || (trailAct[k] = { name: d.name, days: 0 })).days++;
  }
  const half = Math.max(1, Math.ceil(trailing.length / 2));
  const droppedRegulars = Object.entries(trailAct).filter(([k, v]) => v.days >= half && !activeTodayIds.has(k)).map(([, v]) => v.name);

  return {
    period: day.period,
    daysOnRecord: entries.length,
    fleet: {
      net: _r2(day.net), gross: _r2(day.gross), orders: _r0(day.orders),
      activeDrivers: day.active, totalDrivers: day.drivers, hours: _r1(day.hours),
      cashPct, inAppPct: cashPct == null ? null : 100 - cashPct,
      avgAccept: _r0(day.avgAccept), avgFinish: _r0(day.avgFinish),
      avgUtil: _r0(day.avgUtil), avgRating: _r1(day.avgRating),
    },
    trend: { netVsTrailPct, trailingDays: trailing.length, dayOverDayPct },
    top: ranked.top,
    attention: {
      lowAcceptCount: flags.lowAccept.length, lowAccept: flags.lowAccept.slice(0, 5),
      lowUtilCount: flags.lowUtil.length, lowUtil: flags.lowUtil.slice(0, 5),
    },
    anomalies: {
      droppedRegulars: droppedRegulars.slice(0, 6),
      netDropAlert: (netVsTrailPct != null && netVsTrailPct <= -15) ? netVsTrailPct : null,
    },
  };
}

// ── Multi-day rollups ("this week", "this month", "last N days") ──────────────
function addMonths(t, n) {
  const dt = new Date(Date.UTC(t.y, t.m + n, 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() };
}
const monthLabel = (y, m) => `${MONTH_ABBR[m]} ${y}`;

// Cheap gate: does the message reference a date RANGE? (used before any fetch)
const RANGE_PATTERNS = [
  /\b(?:last|past|previous)\s+\d{1,2}\s+days?\b/,
  /\b(this|last|past|current)\s+week\b/, /\blast\s+7\s+days\b/, /\bweekly\b/,
  /\b(this|current)\s+month\b/, /\bmonth[- ]to[- ]date\b/, /\bmtd\b/,
  /\b(last|previous|past)\s+month\b/, /\bso far this\b/,
  /\b(daily|by day|each day|per day|day[- ]by[- ]day|break ?down|break it down)\b/,
  /\bfrom\b.+\bto\b/, /\bbetween\b.+\band\b/,
];
function rangeRef(message) {
  const s = (message || "").toLowerCase();
  return RANGE_PATTERNS.some((re) => re.test(s));
}

// Pull every explicit date out of a message → sorted unique {y,m,d}[].
// Handles "1st of June" / "June 1" and bare "day 4" / "the 5th" (month from ctx).
function extractDates(message, ctx) {
  const s = (message || "").toLowerCase();
  const out = [];
  const push = (y, m, d) => { if (m >= 0 && d >= 1 && d <= 31) out.push({ y, m, d }); };
  let re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g, mm;
  while ((mm = re.exec(s))) push(ctx.y, MONTH_ABBR3.indexOf(mm[2]), +mm[1]);
  re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
  while ((mm = re.exec(s))) push(ctx.y, MONTH_ABBR3.indexOf(mm[1]), +mm[2]);
  re = /\bday\s+(\d{1,2})\b/g;      // "day N" is unambiguous → always (month from ctx)
  while ((mm = re.exec(s))) push(ctx.y, ctx.m, +mm[1]);
  if (out.length === 0) {           // bare ordinals ONLY if nothing explicit (avoid contaminating "1st of may")
    re = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/g;
    while ((mm = re.exec(s))) push(ctx.y, ctx.m, +mm[1]);
  }
  const seen = new Set(), uniq = [];
  out.sort((a, b) => ymdKey(a) - ymdKey(b));
  for (const d of out) { const k = ymdKey(d); if (!seen.has(k)) { seen.add(k); uniq.push(d); } }
  return uniq;
}

// Resolve a range → { label, indices[] } over COMPLETE days (excludes today's
// partial). entries ascending. null if no range phrase. "this week" = last 7.
function resolveRange(message, entries) {
  const s = (message || "").toLowerCase();
  const keys = entries.map((e) => ymdKey(periodYMD(e.period)));
  const todayKey = ymdKey(riyadhTodayYMD());
  const complete = entries.map((_, i) => i).filter((i) => keys[i] >= 0 && keys[i] < todayKey);
  if (complete.length === 0) return null;
  const ctx = periodYMD(entries[entries.length - 1].period) || riyadhTodayYMD();

  // Explicit date range ("from June 1 to 6", "day 4 and day 5") → range + per-day.
  const dates = extractDates(message, ctx);
  const wantsBreakdown = /\b(daily|by day|each day|per day|day[- ]by[- ]day|break ?down|break it down)\b/.test(s);
  if (dates.length >= 2) {
    const a = ymdKey(dates[0]), b = ymdKey(dates[dates.length - 1]);
    const idx = complete.filter((i) => keys[i] >= a && keys[i] <= b);
    if (idx.length) {
      const lbl = `${dates[0].d} ${MONTH_ABBR[dates[0].m]} → ${dates[dates.length - 1].d} ${MONTH_ABBR[dates[dates.length - 1].m]}`;
      return { label: lbl, indices: idx, perDay: true };
    }
  }
  // Bare "daily breakdown" with no dates → default to the last 7 days, per-day.
  if (wantsBreakdown && dates.length < 2) {
    return { label: "the last 7 days", indices: complete.slice(-7), perDay: true };
  }

  let m;
  if ((m = s.match(/\b(?:last|past|previous)\s+(\d{1,2})\s+days?\b/))) {
    const n = Math.max(1, +m[1]);
    return { label: `the last ${n} days`, indices: complete.slice(-n) };
  }
  if (/\b(this|last|past|current)\s+week\b/.test(s) || /\blast\s+7\s+days\b/.test(s) || /\bweekly\b/.test(s)) {
    return { label: "the last 7 days", indices: complete.slice(-7) };
  }
  if (/\b(last|previous|past)\s+month\b/.test(s)) {
    const lm = addMonths(periodYMD(entries[entries.length - 1].period), -1);
    const idx = complete.filter((i) => { const p = periodYMD(entries[i].period); return p && p.y === lm.y && p.m === lm.m; });
    return idx.length ? { label: monthLabel(lm.y, lm.m), indices: idx } : null;
  }
  if (/\b(this|current)\s+month\b/.test(s) || /\bmonth[- ]to[- ]date\b/.test(s) || /\bmtd\b/.test(s) || /\bso far this\b/.test(s)) {
    const ym = periodYMD(entries[entries.length - 1].period);
    const idx = complete.filter((i) => { const p = periodYMD(entries[i].period); return p && p.y === ym.y && p.m === ym.m; });
    return idx.length ? { label: `${monthLabel(ym.y, ym.m)} so far`, indices: idx } : null;
  }
  return null;
}

// Aggregate multiple days into one deterministic rollup summary.
function rollup(entries, indices, label, opts) {
  const days = indices.map((i) => entries[i]).filter(Boolean);
  if (!days.length) return null;
  const dms = days.map(dayMetrics);
  const wantPerDay = (opts && opts.perDay) || days.length <= 14;  // per-day list for short ranges
  const sum = (f) => dms.reduce((a, d) => a + (f(d) || 0), 0);
  const totNet = sum((d) => d.net), totGross = sum((d) => d.gross), totOrders = sum((d) => d.orders);
  const totHours = sum((d) => d.hours), totCash = sum((d) => d.cash);

  // per-driver rollup across the range (top performers by net)
  const byDriver = {};
  for (const day of days) for (const d of (day.drivers || [])) {
    if (!d.isActive && !(d.netEarnings > 0)) continue;
    const k = d.driverId || d.name;
    if (!k) continue;
    (byDriver[k] || (byDriver[k] = { name: d.name, net: 0, days: 0 }));
    byDriver[k].net += d.netEarnings || 0; byDriver[k].days += 1;
  }
  const top = Object.values(byDriver).sort((a, b) => b.net - a.net).slice(0, 3)
    .map((d) => ({ name: d.name, net: _r0(d.net), days: d.days }));

  const best = dms.reduce((a, b) => (b.net > a.net ? b : a));
  const worst = dms.reduce((a, b) => (b.net < a.net ? b : a));

  // Period-over-period: the equal-length window immediately before this one.
  const firstIdx = indices[0], n = days.length;
  const priorIdx = [];
  for (let i = firstIdx - 1; i >= 0 && priorIdx.length < n; i--) priorIdx.unshift(i);
  // Only compare EQUAL-length windows (a 7-day vs 1-day total would mislead).
  const priorNet = priorIdx.length === n ? priorIdx.reduce((s, i) => s + dayMetrics(entries[i]).net, 0) : null;
  const netVsPrevPct = (priorNet && priorNet > 0) ? Math.round(((totNet - priorNet) / priorNet) * 100) : null;

  return {
    label, days: days.length, range: `${days[0].period} → ${days[days.length - 1].period}`,
    daysOnRecord: entries.length, netVsPrevPct, prevNet: priorNet != null ? _r0(priorNet) : null, prevDays: priorIdx.length,
    net: _r2(totNet), gross: _r2(totGross), orders: _r0(totOrders), hours: _r1(totHours),
    avgNetPerDay: _r2(totNet / days.length), avgActivePerDay: _r1(_avg(dms, (d) => d.active)),
    cashPct: totGross ? Math.round((totCash / totGross) * 100) : null,
    avgAccept: _r0(_avg(dms, (d) => d.avgAccept)), avgUtil: _r0(_avg(dms, (d) => d.avgUtil)),
    top, best: { period: best.period, net: _r0(best.net) }, worst: { period: worst.period, net: _r0(worst.net) },
    dailyBreakdown: wantPerDay ? dms.map((d) => ({ period: d.period, net: _r2(d.net), orders: _r0(d.orders), active: d.active })) : null,
  };
}

function renderRollupPacket(r) {
  const cashStr = r.cashPct == null ? "n/a" : `cash ${r.cashPct}% / in-app ${100 - r.cashPct}%`;
  const topStr = r.top.map((d) => `${d.name} (${fmtMoney(d.net)} SAR over ${d.days}d)`).join("; ") || "n/a";
  const lines = [
    `FLEET ROLLUP — ${r.label}: ${r.range} (${r.days} completed days; ${r.daysOnRecord} on record).`,
    `These totals are GROUND TRUTH, computed deterministically across the period. State the period as "${r.label}". Quote and EXPLAIN; never recompute or invent.`,
    `Total net: ${fmtMoney(r.net)} SAR${r.netVsPrevPct != null ? ` (${r.netVsPrevPct >= 0 ? "+" : ""}${r.netVsPrevPct}% vs the prior ${r.prevDays} days)` : ""}. Gross: ${fmtMoney(r.gross)} SAR. Orders: ${fmtMoney(r.orders)}. Online hours: ${r.hours}.`,
    `Avg per day: net ${fmtMoney(r.avgNetPerDay)} SAR, ${r.avgActivePerDay} active drivers. Split: ${cashStr}. Avg acceptance ${r.avgAccept}% · utilisation ${r.avgUtil}%.`,
    `Best day: ${r.best.period} (${fmtMoney(r.best.net)} SAR). Slowest: ${r.worst.period} (${fmtMoney(r.worst.net)} SAR).`,
    `Top performers (net over period): ${topStr}.`,
  ];
  if (r.dailyBreakdown && r.dailyBreakdown.length) {
    lines.push(`Per-day breakdown (date · net · orders · active): ${r.dailyBreakdown.map((d) => `${d.period.replace(/\s20\d\d$/, "")} ${fmtMoney(d.net)} SAR / ${d.orders} ord / ${d.active} drv`).join(" | ")}.`);
  }
  return lines.join("\n");
}

// ── Intent detection (cheap regex; runs before any fetch) ─────────────────────
const FLEET_PATTERNS = [
  /\bfleet\b/, /\bdrivers?\b/, /\bcaptains?\b/, /\bcouriers?\b/, /\briders?\b/, /\bbikes?\b/,
  /\b(top|best|worst|bottom|lowest|highest)\s+(earner|driver|performer|captain|courier|rider)/,
  /\b(utilis|utiliz)ation\b/, /\bacceptance rate\b/, /\bfinish rate\b/,
  /\b(net|gross|my|our|fleet|daily|weekly|monthly|today'?s?|yesterday'?s?)\s+earnings?\b/, // fleet-flavoured, not "Tesla earnings"
  /\bpayout\b/, /\bhow much\b.*\b(make|made|earn|earned)\b/,
  /\b(morning|fleet|daily)\s+brief\b/, /\bmission control\b/,
  /\brevenue\b/, /\bcash\s+collect(?:ion|ed)?\b/, /\bonline\s+hours\b/,
  // "net"/"gross" near a time word or SAR → fleet earnings (not "net worth").
  /\b(net|gross)\b[^.?!]{0,40}\b(yesterday|today|this\s+week|this\s+month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sar|so\s+far)\b/,
  /كباتن|كابتن|سائق|سائقين|الأسطول|الاسطول|توصيل|أرباح|الأرباح/,
];
function isFleetQuery(message) {
  const m = (message || "").toLowerCase();
  return FLEET_PATTERNS.some((p) => p.test(m));
}

// ── Override / data-poisoning detection ───────────────────────────────────────
// Phrases that try to make M8 STATE an untrue figure. An override attempt aimed
// at a fleet metric FORCES the deterministic spine: integrity STRENGTHENS
// grounding, it never disables it (the gate must never be bypassable by "ignore
// the data"). Used by buildFleetContext's gate and by the orchestrator to prepend
// an integrity alert above the real numbers.
const OVERRIDE_MARKERS = /\bignore\s+(?:the\s+)?(?:data|dashboard|blob|numbers?|figures?)\b|\bpretend\b|\bjust\s+(?:say|tell\s+me)\b|\bsay\s+it\s+(?:was|is)\b|\bmake\s+it\b|\bset\s+[^.?!]{0,25}?\bto\b|\boverride\b|\bforget\s+(?:the\s+)?(?:data|dashboard|numbers?)\b|\bdon'?t\s+(?:check|use)\s+(?:the\s+)?(?:data|dashboard|blob)\b|\bregardless\s+of\s+(?:the\s+)?(?:data|dashboard)\b|\bno\s+matter\s+what\b|\b(?:i'?m|i\s+am)\s+the\s+owner\b|\bi\s+command\b/i;
function hasOverrideAttempt(message) { return OVERRIDE_MARKERS.test(message || ""); }

// Broad fleet-metric vocabulary — recognises that an override attempt is aimed at
// fleet figures, so we force the spine even when the phrasing dodged isFleetQuery.
const FLEET_METRIC_TERMS = /\b(net|gross|revenue|earnings?|payout|orders?|deliveries|utilis|utiliz|acceptance|riders?|drivers?|captains?|couriers?|fleet|bikes?|bolt|cash\s+collect)/i;
function mentionsFleetMetric(message) { return FLEET_METRIC_TERMS.test(message || ""); }

// Did the recent conversation establish a fleet context? This lets bare date
// follow-ups ("what about the 4th of June?", "and the 5th?") stay on the fleet
// path even when they drop the keyword — without it they fall to web/memory.
const FLEET_CONTEXT_MARKERS = /\bfleet\b|\bdrivers?\b|net earnings?|\bSAR\b|utilis|utiliz|acceptance|mission control|\bbolt\b/i;
function recentlyDiscussedFleet(history) {
  return (history || []).slice(-5).some(
    (m) => m && typeof m.content === "string" && FLEET_CONTEXT_MARKERS.test(m.content)
  );
}

// ── Packet builder: the <200-token block injected into the LLM prompt ─────────
function fmtMoney(v) { return (v == null ? "?" : v.toLocaleString("en-US")); }

function renderPacket(mc) {
  const f = mc.fleet, t = mc.trend, a = mc.attention, an = mc.anomalies || {};
  const dod = (t.dayOverDayPct != null) ? `, ${t.dayOverDayPct >= 0 ? "+" : ""}${t.dayOverDayPct}% vs the day before` : "";
  const trendStr = (t.netVsTrailPct == null ? "no prior days to compare"
    : `${t.netVsTrailPct >= 0 ? "+" : ""}${t.netVsTrailPct}% vs trailing ${t.trailingDays}-day avg`) + dod;
  const topStr = mc.top.map((d) => `${d.name} (${fmtMoney(d.value)} SAR, ${d.accept}% acc)`).join("; ") || "n/a";
  const cashStr = f.cashPct == null ? "n/a" : `cash ${f.cashPct}% / in-app ${f.inAppPct}%`;
  const attnBits = [];
  if (an.netDropAlert != null) attnBits.push(`⚠ net down ${an.netDropAlert}% vs 7-day avg`);
  if (an.droppedRegulars && an.droppedRegulars.length) attnBits.push(`${an.droppedRegulars.length} regular(s) didn't work today (${an.droppedRegulars.join(", ")})`);
  if (a.lowAcceptCount) attnBits.push(`${a.lowAcceptCount} below ${LOW_ACCEPT}% acceptance (${a.lowAccept.map((d) => `${d.name} ${d.accept}%`).join(", ")})`);
  if (a.lowUtilCount)   attnBits.push(`${a.lowUtilCount} below ${LOW_UTIL}% utilisation (${a.lowUtil.map((d) => `${d.name} ${d.util}%`).join(", ")})`);
  const attnStr = attnBits.length ? attnBits.join(" | ") : "none over threshold";

  return [
    `FLEET DATA — deterministic snapshot for ${mc.period}${mc.isToday ? " (TODAY, still in progress — PARTIAL, not a full day)" : ""} (${mc.daysOnRecord} days on record).`,
    `This snapshot is for ${mc.period} ONLY. State THIS exact date; do NOT relabel it as a different day even if the user named another date.${mc.defaulted ? " (User gave no date → this is the most recent COMPLETED day.)" : ""} These numbers are GROUND TRUTH — quote and EXPLAIN, never recompute or invent.`,
    `Net earnings: ${fmtMoney(f.net)} SAR (${trendStr}). Gross: ${fmtMoney(f.gross)} SAR. Orders: ${fmtMoney(f.orders)}.`,
    `Drivers active: ${f.activeDrivers}/${f.totalDrivers}. Online hours: ${f.hours}. Split: ${cashStr}.`,
    `Avg acceptance ${f.avgAccept}% · finish ${f.avgFinish}% · utilisation ${f.avgUtil}% · rating ${f.avgRating}.`,
    `Top performers (by net): ${topStr}.`,
    `Needs attention: ${attnStr}.`,
  ].join("\n");
}

// Honest packet when the user asked for a date we don't have on record.
function renderNotFound(label, first, last, n) {
  return [
    `FLEET DATA: no snapshot on record for ${label || "that date"}.`,
    `You have ${n} days of data, from ${first} to ${last}. Tell Muhammed you don't have ${label || "that date"} and state the available range. Do NOT invent or estimate figures.`,
  ].join("\n");
}

// ── Driver lookup (stops M8 fabricating a named driver's numbers) ─────────────
// Extract the driver name(s) a question is about — handles "what about X",
// "how did X do", "how much did X make", "X's net", and multi-driver "X and Y".
// Returns an ARRAY of candidate names, or null. findDriver() resolves each
// against the real roster; unmatched names get an honest not-found (never faked).
const DRIVER_ASK = /\b(?:what|how)\s+about\s+([^?.!\n]+)|\bhow\s+did\s+([^?.!\n]+?)\s+do\b|\btell\s+me\s+about\s+([^?.!\n]+)|\bwhat\s+did\s+([^?.!\n]+?)\s+(?:do|make|earn)\b|\bhow\s+much\s+(?:did\s+)?([^?.!\n]+?)\s+(?:do|did|make|made|earn|earned|net|gross|get)\b|\bcompare\s+([^?.!\n]+)/i;
const DRIVER_NAME_STOP = /\b(net|gross|earnings?|earning|income|payout|numbers?|performance|stats?|score|rating|yesterday|today|tomorrow|tonight|this\s+week|last\s+week|this\s+month|so\s+far|as|did|do|done|make|made|earn|earned|get|got|the|driver|drivers|rider|riders|captain|captains|courier|couriers|fleet|team|teams|crew|roster|staff|squad|everyone|everybody|people|guys|folks|whole|entire|we|us|you|they|them|our|your)\b/gi;
// A candidate that's a collective noun ("fleet","team") or a pronoun ("we","you")
// is NOT a driver name → reject it so the question falls through to the normal
// fleet total. A real NAME that isn't on the roster still gets an honest
// not-found (anti-fabrication). Without this, "how did the fleet do" and "how
// much did we make" wrongly capture "fleet"/"we" and route to a driver-not-found.
const GENERIC_NON_NAME = /^(of|day|days|week|weeks|month|months|a|an|the|my|our|your|their|his|her|its|this|that|these|those|it|we|us|you|they|them|i|me|he|she|everyone|everybody|anyone|anybody|someone|somebody|all|none|things?|stuff|fleet|team|teams|crew|roster|staff|squad|business|company|biz|ops|operations?|people|guys|folks|group|driver|drivers|rider|riders|captain|captains|courier|couriers|today|tomorrow|yesterday)$/i;
function driverCandidates(message) {
  const raw = (message || "");
  let span = null;
  const m = raw.match(DRIVER_ASK);
  if (m) span = m.slice(1).find(Boolean) || null;
  if (!span) {                                   // possessive: "Habib's net", "Ali's numbers"
    const poss = raw.match(/\b([A-Za-z]+)(?:'s|’s|s')\s+(?:net|gross|earnings?|numbers?|performance|stats?|rating)\b/i);
    if (poss) span = poss[1];
  }
  if (!span) return null;
  span = span.replace(DRIVER_NAME_STOP, " ").replace(/\s+/g, " ").trim();
  if (span.length < 2) return null;
  const parts = span.split(/\s*(?:,|&|\band\b)\s*/i).map((s) => s.trim());
  const out = parts.filter((n) =>
    n.length >= 2 &&
    !/\d/.test(n) &&                                                   // a digit → date/number, not a name
    !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/i.test(n) && // bare month token → date, not a name (whole-word: must NOT reject "Marwan"/"Maya"/"Junaid")
    !GENERIC_NON_NAME.test(n)                                          // collective noun / pronoun → not a driver
  );
  return out.length ? out : null;
}

// Find a driver in a day's roster by name (fuzzy, word-overlap). null if none.
function findDriver(entry, candidate) {
  const c = (candidate || "").toLowerCase().trim();
  if (!c) return null;
  const cWords = c.split(/\s+/).filter((w) => w.length >= 3);
  let best = null, score = 0;
  for (const d of (entry.drivers || [])) {
    const name = (d.name || "").toLowerCase();
    if (!name) continue;
    const nWords = name.split(/\s+/);
    let s = (name === c || name.includes(c) || c.includes(name)) ? 100
      : cWords.filter((w) => nWords.some((nw) => nw === w || nw.startsWith(w) || w.startsWith(nw))).length;
    if (s > score) { score = s; best = d; }
  }
  return score > 0 ? best : null;
}

function renderDriverPacket(d, period) {
  return [
    `FLEET DATA — single driver "${d.name}" on ${period}. GROUND TRUTH: state ONLY these figures, never invent or estimate.`,
    `Net ${fmtMoney(_r2(d.netEarnings))} SAR · Gross ${fmtMoney(_r2(d.grossEarnings))} SAR · Orders ${_r0(d.orders)} · Online ${_r1(d.hoursOnline)}h.`,
    `Acceptance ${_r0(d.acceptance)}% · Finish ${_r0(d.finishRate)}% · Utilisation ${_r0(d.utilization)}% · Rating ${_r1(d.rating)} · Active: ${d.isActive ? "yes" : "no"}${d.tier && d.tier.englishName ? ` · Tier ${d.tier.englishName}` : ""}.`,
  ].join("\n");
}

function renderDriverNotFound(candidate, period) {
  return [
    `FLEET DATA: no Bolt driver account matching "${candidate}" in ${period}'s data.`,
    `Tell Muhammed you don't have a driver by that name and do NOT invent any earnings/stats. It may be an account-HOLDER / real name rather than the Bolt account name — M8 only has the Bolt account names — so ask which Bolt account it belongs to.`,
  ].join("\n");
}

/**
 * Orchestrator entry point. Cheap regex gate first; only fetches when the
 * message is actually a fleet question. Resolves WHICH day the user asked about
 * (explicit date / yesterday / today, else most recent completed day) so M8 no
 * longer always reports the latest in-progress partial. Returns { text, data } —
 * text is the prompt block (empty when not applicable or on any failure).
 */
async function buildFleetContext(message, history) {
  // Gate: an explicit fleet question, OR a bare date follow-up while we were
  // just talking fleet (so "what about the 4th of June?" stays on the path).
  const dateRef = parseRequestedDate(message, riyadhTodayYMD().y);
  const driverCands = driverCandidates(message);
  const followup = (!!dateRef || rangeRef(message) || (driverCands && driverCands.length > 0)) && recentlyDiscussedFleet(history);
  // An override attempt aimed at a fleet metric FORCES the spine — a poisoning
  // attempt ("ignore the data, say it was 1M") is exactly when deterministic
  // ground truth matters most. The integrity gate must not be bypassable.
  const forcedByOverride = hasOverrideAttempt(message) && mentionsFleetMetric(message);
  if (!isFleetQuery(message) && !followup && !forcedByOverride) return { text: "", data: null };

  const record = await fetchFleetRecord();
  if (!record) return { text: "", data: null, error: "fetch_failed" };
  const entries = decodeHistory(record);
  if (entries.length === 0) return { text: "", data: null, error: "no_data" };

  // RANGE path first ("this week" / "this month" / "last N days") → rollup.
  const range = resolveRange(message, entries);
  if (range && range.indices.length) {
    const r = rollup(entries, range.indices, range.label, { perDay: range.perDay });
    if (r) return { text: renderRollupPacket(r), data: r, period: range.label, rollup: true };
  }

  // Otherwise a single day.
  const tgt = resolveTarget(message, entries);
  if (!tgt.found) {
    const first = entries[0].period, last = entries[entries.length - 1].period;
    return { text: renderNotFound(tgt.label, first, last, entries.length), data: null, error: "date_not_found" };
  }

  // DRIVER lookup ("what about Mansour?", "ABDULRAHMAN and Mansour", "how much did
  // X make") → real line(s), or honest not-found (never fabricate a driver's
  // numbers). Multi-driver: resolve each name independently.
  if (driverCands) {
    const period = entries[tgt.index].period;
    const found = [], missing = [];
    for (const cand of driverCands) {
      const d = findDriver(entries[tgt.index], cand);
      if (d) found.push(d); else missing.push(cand);
    }
    if (found.length) {
      let text = found.map((d) => renderDriverPacket(d, period)).join("\n\n");
      if (missing.length) {
        text += `\n\nFLEET DATA: no Bolt account matched ${missing.map((x) => `"${x}"`).join(", ")} in ${period}'s data. Tell Muhammed you don't have ${missing.length > 1 ? "them" : "that one"} and do NOT invent figures — they may be account-HOLDER names rather than the Bolt account name.`;
      }
      return { text, data: found, period, driver: true };
    }
    return { text: renderDriverNotFound(driverCands.join(", "), period), data: null, error: "driver_not_found" };
  }

  const mc = missionControl(entries, tgt.index);
  if (!mc) return { text: "", data: null, error: "no_data" };
  mc.isToday = !!tgt.isToday;
  mc.defaulted = !!tgt.defaulted;
  return { text: renderPacket(mc), data: mc, period: mc.period };
}

module.exports = {
  buildFleetContext,
  isFleetQuery, hasOverrideAttempt, mentionsFleetMetric,
  fetchFleetRecord,
  decodeHistory,
  missionControl,
  resolveTarget,
  parseRequestedDate,
  recentlyDiscussedFleet,
  resolveRange, rollup, rangeRef, extractDates, driverCandidates, findDriver,
  // exported for tests / future reuse:
  unpackEntry, unpackDriver, periodSortKey, periodYMD, dayMetrics, rankDrivers, attentionFlags, renderPacket, renderNotFound, renderRollupPacket,
};
