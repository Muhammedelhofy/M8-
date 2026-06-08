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
  const url = `${SB_URL}/rest/v1/fleet_data?id=eq.${encodeURIComponent(SB_ROW_ID)}&select=data,updated_at`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows[0]) return {};
    const rec = rows[0].data || {};
    // Stamp the row's last-sync time onto the record so downstream can flag stale
    // data (decodeHistory reads only khair_history/khair_fmt, so this is inert there).
    if (rec && typeof rec === "object" && rows[0].updated_at) rec._syncedAt = rows[0].updated_at;
    return rec;
  } catch (err) {
    console.error("[M8 fleet] fetch error (non-fatal):", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Short-lived record cache. The known-driver registry gate (see buildFleetContext)
// may need the blob even for a message that turns out NOT to be a fleet question,
// so without a cache an innocent "what about Cairo?" would pay a Supabase round
// trip. Completed-day data never changes intra-day — only today's PARTIAL moves,
// and only when the user manually re-syncs the dashboard — so a few seconds of
// reuse makes the gate ~free and trims the per-turn fleet fetch with no meaningful
// staleness. Only successful reads are cached. Set FLEET_CACHE_TTL_MS=0 to disable.
const RECORD_TTL_MS = Number(process.env.FLEET_CACHE_TTL_MS ?? 30000);
let _recCache = null, _recCacheAt = 0;
async function getFleetRecord() {
  if (RECORD_TTL_MS > 0 && _recCache && (Date.now() - _recCacheAt) < RECORD_TTL_MS) return _recCache;
  const rec = await fetchFleetRecord();
  if (rec) { _recCache = rec; _recCacheAt = Date.now(); }
  return rec;
}

// Data freshness from the fleet_data row's updated_at (when the dashboard last
// synced to Supabase). Lets a brief flag "this is the last synced data, a fresh
// sync is pending" instead of presenting stale numbers as today's live figures.
// STALE_HOURS env-tunable (default 18). unknown=true when the row has no _syncedAt.
const STALE_HOURS = Number(process.env.FLEET_STALE_HOURS || 18);
function fleetFreshness(record) {
  const syncedAt = record && record._syncedAt ? record._syncedAt : null;
  const t = syncedAt ? new Date(syncedAt).getTime() : NaN;
  if (!isFinite(t)) return { syncedAt: syncedAt || null, ageHours: null, stale: false, unknown: true };
  const ageHours = Math.round(((Date.now() - t) / 3600000) * 10) / 10;
  return { syncedAt, ageHours, stale: ageHours >= STALE_HOURS, unknown: false };
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
const DRIVER_NAME_STOP = /\b(net|gross|earnings?|earning|income|payout|numbers?|performance|stats?|score|rating|yesterday|today|tomorrow|tonight|this\s+week|last\s+week|this\s+month|so\s+far|as|did|do|done|make|made|earn|earned|get|got|the|driver|drivers|rider|riders|captain|captains|courier|couriers|fleet|team|teams|crew|roster|staff|squad|everyone|everybody|people|guys|folks|whole|entire|we|us|you|they|them|our|your|is|are|was|were|give|gimme|show|tell|me|what|here|that)\b/gi;
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
    const poss = raw.match(/\b([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:'s|’s|s')\s+(?:net|gross|earnings?|numbers?|performance|stats?|rating)\b/i);
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

// Find ALL drivers in a day's roster whose name matches the candidate at the best
// qualifying score (≥ need). [] if none. MORE THAN ONE result = an AMBIGUOUS name
// (e.g. "Ali" when both "ALI ALSHAHRANI" and "ALI MOHAMMED" are on the roster) —
// the caller must disambiguate and ASK, never silently pick one.
function findDrivers(entry, candidate) {
  const c = (candidate || "").toLowerCase().trim();
  if (!c) return [];
  const cWords = c.split(/\s+/).filter((w) => w.length >= 3);
  // A 2+-word query must match on ≥2 name tokens. This fleet is full of shared
  // surnames ("Alshahrani"/"Alshehri") — a lone surname overlap must NOT return a
  // DIFFERENT first name. e.g. "ALI ALSHAHRANI" when only ABDULRAHMAN ALSHAHRANI
  // is on the roster → no match (honest not-found), never the wrong driver.
  const need = Math.min(cWords.length, 2) || 1;
  const scored = [];
  for (const d of (entry.drivers || [])) {
    const name = (d.name || "").toLowerCase();
    if (!name) continue;
    const nWords = name.split(/\s+/);
    // Word-level matching only — a bare substring match wrongly hits "Mansour"
    // inside "ALMANSOUR". Exact full-name = 100; else count candidate tokens that
    // match a name token (exact or prefix), gated by `need` above.
    const s = name === c ? 100
      : cWords.filter((w) => nWords.some((nw) => nw === w || nw.startsWith(w) || w.startsWith(nw))).length;
    if (s >= need) scored.push({ d, s });
  }
  if (!scored.length) return [];
  const max = Math.max(...scored.map((x) => x.s));
  return scored.filter((x) => x.s === max).map((x) => x.d);   // all at the best score
}

// Single best match (back-compat). Returns null if none OR if the name is
// AMBIGUOUS (>1 equally-good match) — stays null-on-ambiguous so nothing silently
// resolves to one of several drivers. Callers that can ask the user use findDrivers().
function findDriver(entry, candidate) {
  const ds = findDrivers(entry, candidate);
  return ds.length === 1 ? ds[0] : null;
}

// ── Known-driver-name registry (union of every driver name ever in the blob) ──
// The keyword gate (isFleetQuery) can't tell a driver NAME from an arbitrary
// compare target, so "compare ALI and Mansour yesterday" with no fleet keyword
// and no recent fleet history (a fresh session) used to miss the gate and bleed
// into a web search (irrelevant Tavily hits presented as if relevant). The
// registry is the safe disambiguator: a name that has ACTUALLY appeared in the
// fleet is a fleet question; "compare iPhone and Samsung" is not. This is also
// the canonical name set L3 builds on (tier-slip / coaching reference it).
//
// Built from ALL entries (a driver absent from the target day is still
// recognised — the per-day findDriver then resolves found/not-found honestly).
// Returns { full:Set<lowercased full name>, tokens:string[] (≥3-char name
// tokens), drivers:[{name,driverId,days}] } — the last is the reusable list.
function buildDriverRegistry(entries) {
  const full = new Set();
  const tokens = new Set();
  const byKey = new Map();
  for (const e of (entries || [])) {
    for (const d of (e.drivers || [])) {
      const name = (d.name || "").trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      full.add(lower);
      for (const w of lower.split(/\s+/)) if (w.length >= 3 && !/\d/.test(w)) tokens.add(w);
      const key = d.driverId || lower;
      const rec = byKey.get(key) || { name, driverId: d.driverId || "", days: 0 };
      rec.days++; byKey.set(key, rec);
    }
  }
  return { full, tokens: [...tokens], drivers: [...byKey.values()] };
}

// Is a candidate name (from driverCandidates) a REAL known driver? Matches a full
// name exactly, or any ≥3-char candidate token against a registry token (exact,
// or the registry token starts with the candidate token so a shortened first name
// like "abdul" still resolves to "abdulrahman"). The prefix is one-directional on
// purpose — it must NOT let "sunrise" match a driver "sun". Used only by the gate;
// leaning liberal here is the safe error direction (a false negative re-creates
// the web-search bleed; a false positive just yields an honest driver not-found).
function isKnownDriver(candidate, registry) {
  const c = (candidate || "").toLowerCase().trim();
  if (!c || !registry) return false;
  if (registry.full && registry.full.has(c)) return true;
  const toks = registry.tokens || [];
  return c.split(/\s+/)
    .filter((w) => w.length >= 3 && !/\d/.test(w))
    .some((w) => toks.some((t) => t === w || t.startsWith(w)));
}

// ── Per-driver daily series (L3) — the per-DRIVER analog of rollup ────────────
// rollup() gives fleet TOTALS over a window; this gives ONE driver's net DAY BY
// DAY. For each day it runs the REAL findDriver and records the real net (or marks
// the driver ABSENT that day). This is the deterministic ground truth a "daily
// breakdown for Mansour from May to June" reads from, so the LLM quotes real
// numbers instead of hand-rolling/interpolating a fabricated list.

// Distinct registry drivers whose name matches the candidate (same need-based
// token rule as findDrivers). [] none · [1] unique · [>1] ambiguous (must ask).
function resolveDriverName(candidate, registry) {
  const c = (candidate || "").toLowerCase().trim();
  if (!c || !registry) return [];
  const cWords = c.split(/\s+/).filter((w) => w.length >= 3);
  const need = Math.min(cWords.length, 2) || 1;
  return (registry.drivers || []).filter((d) => {
    const name = (d.name || "").toLowerCase();
    if (name === c) return true;
    const nWords = name.split(/\s+/);
    const s = cWords.filter((w) => nWords.some((nw) => nw === w || nw.startsWith(w) || w.startsWith(nw))).length;
    return s >= need;
  });
}

// Most-recently-mentioned known driver in the chat → carries "Mansour" forward
// when a follow-up ("do the same for June") names no driver. null if none.
function lastDriverMentioned(history, registry) {
  if (!registry || !registry.drivers || !registry.drivers.length) return null;
  const msgs = (history || []).filter((m) => m && typeof m.content === "string");
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i].content.toLowerCase();
    for (const d of registry.drivers) {
      const first = (d.name || "").toLowerCase().split(/\s+/)[0];
      if (first.length >= 3 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(c)) return d.name;
    }
  }
  return null;
}

// Resolve a MULTI-DAY window for a per-driver breakdown: resolveRange first
// (explicit date range / list / week / month-to-date / last-N), then "since he
// started / all his days" → every day on record, then a bare month name(s) ("all
// of May", "May to June" → union). null if there's no multi-day window.
function resolveDriverWindow(message, entries) {
  const s = (message || "").toLowerCase();
  const rng = resolveRange(message, entries);
  if (rng && rng.indices.length) return { indices: rng.indices, label: rng.label };
  const allIdx = entries.map((_, i) => i);
  if (/\b(since\s+(he|she|they|it)\s+(started|began|joined)|all[-\s]?time|entire\s+history|whole\s+(history|time)|from\s+the\s+(start|beginning)|all\s+(his|her|their)\s+days|his\s+whole|every\s+day\s+(he|she|since))\b/.test(s)) {
    return { indices: allIdx, label: "every day on record" };
  }
  const mons = [...s.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/g)]
    .map((m) => MONTH_ABBR3.indexOf(m[1].slice(0, 3))).filter((mi) => mi >= 0);
  if (mons.length) {
    const set = new Set(mons);
    const idx = allIdx.filter((i) => { const p = periodYMD(entries[i].period); return p && set.has(p.m); });
    if (idx.length) {
      const lbl = mons.length > 1 ? `${MONTH_ABBR[Math.min(...mons)]}–${MONTH_ABBR[Math.max(...mons)]}` : monthLabel(periodYMD(entries[idx[0]].period).y, mons[0]);
      return { indices: idx, label: lbl };
    }
  }
  return null;
}

function driverDailySeries(entries, canonicalName, indices) {
  const series = indices.slice()
    .sort((a, b) => ymdKey(periodYMD(entries[a].period)) - ymdKey(periodYMD(entries[b].period)))
    .map((i) => {
      const e = entries[i];
      const d = findDriver(e, canonicalName);   // exact full name → reliable single
      return { period: e.period, net: d ? _r2(d.netEarnings) : null, orders: d ? _r0(d.orders) : null, active: d ? !!d.isActive : false, present: !!d };
    });
  const worked = series.filter((r) => r.present);
  const total = worked.reduce((a, r) => a + (r.net || 0), 0);
  return { driver: canonicalName, series, daysInRange: indices.length, daysWorked: worked.length, total: _r2(total), avg: worked.length ? _r2(total / worked.length) : 0 };
}

function renderDriverSeriesPacket(s, label) {
  const rows = s.series.map((r) =>
    r.present ? `${r.period}: ${fmtMoney(r.net)} SAR${r.active ? "" : " (inactive)"}` : `${r.period}: absent — no record`
  );
  return [
    `FLEET DATA — DAILY NET for "${s.driver}" over ${label || `${s.daysInRange} day(s)`} (worked ${s.daysWorked} of ${s.daysInRange} day(s) on record). GROUND TRUTH: these are the ONLY days available — quote each line EXACTLY, never add, interpolate, estimate, or smooth-fill a day. "absent" = no record that day; do NOT invent a number for it.`,
    ...rows,
    `Total ${fmtMoney(s.total)} SAR across ${s.daysWorked} worked day(s) · avg ${fmtMoney(s.avg)} SAR per worked day.`,
  ].join("\n");
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

// ── Tier-slip watch + coaching (L3 Fleet Intelligence) ────────────────────────
// Bolt assigns each driver a loyalty TIER (parsed straight from the export as
// Level=N → 0 Bronze · 1 Silver · 2 Gold · 3 Platinum · 4 Diamond, HIGHER is
// better; carried per-day in the blob via tier.level). A "slip" is a driver whose
// level FELL across the window — factual ground truth. We also surface a "watch"
// list: drivers still AT a droppable tier whose acceptance/finish is weak (the
// levers Bolt demotions hinge on) = a leading warning. Per-driver metrics are
// shown so the LLM coaches on the REAL weak lever and never on an invented Bolt
// threshold (M8 does NOT know Bolt's exact cutoffs — see renderTierWatchPacket).
const TIER_NAMES   = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];
const COACH_ACCEPT = Number(process.env.FLEET_COACH_ACCEPT || LOW_ACCEPT);   // accept floor for "watch"
const COACH_FINISH = Number(process.env.FLEET_COACH_FINISH || 80);           // finish floor for "watch"
const tierName = (lvl) => (lvl >= 0 && lvl < TIER_NAMES.length) ? TIER_NAMES[lvl] : null;

// Cheap gate: is this a tier-slip / coaching question? (whole-fleet, no day target)
const TIER_WATCH_PATTERNS = [
  /\btier\b[^.?!]{0,20}\b(slip\w*|drop\w*|loss|losing|fall\w*|fell|down|chang\w*|move\w*|risk|watch|status)/,
  /\b(slip\w*|drop\w*|fall\w*|demot\w*|downgrad\w*|lost?)\b[^.?!]{0,20}\btier/,
  /\bwho('?s| is| are)?\s+(slipping|dropping|falling|losing\s+tier|at[- ]risk)/,
  /\b(coach|coaching|coachable)\b[^.?!]{0,24}\b(driver|drivers|captain|captains|rider|riders|tier|fleet|team)\b/,
  /\b(driver|drivers|captain|captains|rider|riders|tier|fleet|team)\b[^.?!]{0,24}\b(coach|coaching|coachable)\b/,
  /\bwho\s+needs?\s+(coaching|attention|a\s+talk|help|work)\b/,
  /\bat[- ]risk\s+(driver|drivers|captain|captains|rider|riders)\b/,
  /\b(demoted|downgraded|tier\s+drop)\b/,
];
function tierWatchRef(message) {
  const s = (message || "").toLowerCase();
  return TIER_WATCH_PATTERNS.some((re) => re.test(s));
}

// Classify tier movement across `indices` (ascending complete-day indices). Pure.
// Returns { hasTierData, days, range, slipped[], improved[], watch[] } or null.
function tierWatch(entries, indices) {
  const days = (indices || []).map((i) => entries[i]).filter(Boolean);
  if (!days.length) return null;
  const byKey = new Map();   // driverId|name → tier timeline + latest metric snapshot
  for (const e of days) {
    for (const d of (e.drivers || [])) {
      const name = (d.name || "").trim();
      if (!name) continue;
      const key = d.driverId || name.toLowerCase();
      const rec = byKey.get(key) || { name, levels: [], recentActive: null, recentAny: null };
      const lvl = d.tier ? d.tier.level : -1;
      if (lvl >= 0) rec.levels.push(lvl);
      const snap = { accept: _r0(d.acceptance), finish: _r0(d.finishRate), rating: _r1(d.rating), tier: lvl };
      rec.recentAny = snap;
      if (d.isActive) rec.recentActive = snap;
      byKey.set(key, rec);
    }
  }
  const recs = [...byKey.values()];
  if (!recs.some((r) => r.levels.length)) return { hasTierData: false, slipped: [], improved: [], watch: [] };

  const slipped = [], improved = [];
  for (const r of recs) {
    if (r.levels.length < 2) continue;                    // need ≥2 readings to see movement
    const first = r.levels[0], last = r.levels[r.levels.length - 1];
    const snap = r.recentActive || r.recentAny;
    if (last < first) slipped.push({ name: r.name, from: tierName(first), to: tierName(last), drop: first - last, accept: snap ? snap.accept : null, finish: snap ? snap.finish : null });
    else if (last > first) improved.push({ name: r.name, from: tierName(first), to: tierName(last) });
  }
  const slippedNames = new Set(slipped.map((s) => s.name));
  const watch = [];
  for (const r of recs) {
    const snap = r.recentActive || r.recentAny;
    if (!snap || snap.tier < 1 || slippedNames.has(r.name)) continue;   // ≥ Silver = has a tier to lose
    const weak = [];
    if (snap.accept > 0 && snap.accept < COACH_ACCEPT) weak.push(`acceptance ${snap.accept}%`);
    if (snap.finish > 0 && snap.finish < COACH_FINISH) weak.push(`finish ${snap.finish}%`);
    if (weak.length) watch.push({ name: r.name, tier: tierName(snap.tier), weak });
  }
  slipped.sort((a, b) => b.drop - a.drop);
  return { hasTierData: true, days: days.length, range: `${days[0].period} → ${days[days.length - 1].period}`, slipped, improved, watch: watch.slice(0, 8) };
}

function renderTierWatchPacket(tw) {
  if (!tw || !tw.hasTierData) {
    return [
      "FLEET DATA — TIER WATCH: the synced data carries no Bolt tier levels for this window.",
      "Tell Muhammed you can't assess tier movement right now (no tier field in the data) and do NOT invent tiers, slips, or coaching targets.",
    ].join("\n");
  }
  const slip = tw.slipped.length
    ? tw.slipped.map((s) => `${s.name} ${s.from}→${s.to}${s.accept != null ? ` (now ${s.accept}% acc${s.finish != null ? `, ${s.finish}% finish` : ""})` : ""}`).join("; ")
    : "none";
  const watch = tw.watch.length ? tw.watch.map((w) => `${w.name} (${w.tier}: ${w.weak.join(" + ")})`).join("; ") : "none";
  const up    = tw.improved.length ? tw.improved.map((i) => `${i.name} ${i.from}→${i.to}`).join("; ") : "none";
  return [
    `FLEET DATA — TIER WATCH over ${tw.range} (${tw.days} days). GROUND TRUTH from Bolt's own tier levels (Bronze < Silver < Gold < Platinum < Diamond). Quote and EXPLAIN; never invent a tier, a slip, or a Bolt threshold.`,
    `Slipped (tier actually dropped): ${slip}.`,
    `Watch (still at tier but weak on the levers demotions hinge on): ${watch}.`,
    `Improved (tier rose): ${up}.`,
    `COACHING: base advice ONLY on the weak metric shown per driver — low acceptance → accept more of the trips offered; low finish → complete the trips accepted (fewer cancellations). You do NOT know Bolt's exact tier thresholds: if asked for the precise cutoff, say so and give the directional lever, never a fabricated number.`,
  ].join("\n");
}

// ── Morning / executive brief (L3 Fleet Intelligence) ─────────────────────────
// A one-shot composite that assembles the spine's existing deterministic pieces
// — most-recent-COMPLETE-day mission control (net + trend + top + anomalies),
// tier-slip watch, and a week-to-date rollup — into ONE tight packet for M8 to
// read aloud as a spoken exec brief. ON-DEMAND only (no scheduler): an explicit
// "morning brief" / "state of the fleet" request triggers it. Pure aggregation;
// the LLM only narrates. Returns null if there is no usable day to brief on.
const BRIEF_PATTERNS = [
  /\b(morning|daily|fleet|exec(?:utive)?|ops|operations?|business)\s+(brief|briefing|report|rundown|summary|update|digest|sitrep)\b/,
  /\b(brief|briefing|rundown|sitrep|digest)\b[^.?!]{0,20}\b(fleet|ops|operation|business|drivers?|today|this\s+morning|the\s+day|the\s+night)\b/,
  /\b(give|send|show|get)\s+me\s+(the|my|a)\s+(morning|daily|fleet|exec\w*|ops)\s+(brief|briefing|report|rundown|summary)\b/,
  /\bstate\s+of\s+the\s+(fleet|business|operation)\b/,
  /\bbrief\s+me\s+on\s+(the\s+)?(fleet|business|ops|operation|drivers?|day|night|morning)\b/,
];
function briefRef(message) {
  const s = (message || "").toLowerCase();
  return BRIEF_PATTERNS.some((re) => re.test(s));
}

// ── Below daily net target (mirrors the dashboard's Fleet Briefing) ───────────
// Dashboard (index.html): dailyTarget = round((monthlyTarget||6000)/30) = 200
// SAR/day by default; "below target" = ACTIVE drivers whose net that day is under
// dailyTarget, lowest first. M8 reads the fleet blob, NOT the dashboard's
// monthlyTarget setting, so it uses the same 6000/30 default — override with
// FLEET_MONTHLY_TARGET if you've changed the target in the dashboard.
const FLEET_MONTHLY_TARGET = Number(process.env.FLEET_MONTHLY_TARGET || 6000);
const DAILY_NET_TARGET = Math.round(FLEET_MONTHLY_TARGET / 30);
function belowDailyTarget(entry) {
  const active = ((entry && entry.drivers) || []).filter((d) => d.isActive);
  const below = active
    .filter((d) => (d.netEarnings || 0) < DAILY_NET_TARGET)
    .sort((a, b) => (a.netEarnings || 0) - (b.netEarnings || 0));
  return { target: DAILY_NET_TARGET, activeCount: active.length, count: below.length, drivers: below };
}

function buildMorningBrief(entries, freshness) {
  const todayKey = ymdKey(riyadhTodayYMD());
  const complete = entries.map((_, i) => i).filter((i) => { const k = ymdKey(periodYMD(entries[i].period)); return k >= 0 && k < todayKey; });
  const dayIdx = complete.length ? complete[complete.length - 1] : entries.length - 1;   // most recent COMPLETE day
  const mc = missionControl(entries, dayIdx);
  if (!mc) return null;
  const week = complete.length ? rollup(entries, complete.slice(-7), "the last 7 days") : null;
  const tw   = tierWatch(entries, complete.slice(-14));
  const cash = cashCollection(entries, [dayIdx]);
  const belowTarget = belowDailyTarget(entries[dayIdx]);
  return { mc, week, tw, cash, belowTarget, fresh: freshness || null, period: mc.period };
}

function renderBriefPacket(b) {
  const { mc, week, tw } = b;
  const f = mc.fleet, t = mc.trend, an = mc.anomalies || {}, a = mc.attention;
  const dod   = t.dayOverDayPct  != null ? `${t.dayOverDayPct  >= 0 ? "+" : ""}${t.dayOverDayPct}% vs the day before` : "";
  const trail = t.netVsTrailPct  != null ? `${t.netVsTrailPct  >= 0 ? "+" : ""}${t.netVsTrailPct}% vs the trailing ${t.trailingDays}-day avg` : "";
  const trendStr = [dod, trail].filter(Boolean).join(", ") || "no prior days to compare";
  const topStr = mc.top.map((d) => `${d.name} (${fmtMoney(d.value)} SAR)`).join("; ") || "n/a";

  const attn = [];
  if (an.netDropAlert != null) attn.push(`net down ${an.netDropAlert}% vs the 7-day avg`);
  if (an.droppedRegulars && an.droppedRegulars.length) attn.push(`${an.droppedRegulars.length} regular(s) didn't work (${an.droppedRegulars.join(", ")})`);
  if (a.lowAcceptCount) attn.push(`${a.lowAcceptCount} below ${LOW_ACCEPT}% acceptance`);
  if (a.lowUtilCount)   attn.push(`${a.lowUtilCount} below ${LOW_UTIL}% utilisation`);

  const tierBits = [];
  if (tw && tw.hasTierData) {
    if (tw.slipped.length) tierBits.push(`${tw.slipped.length} slipped (${tw.slipped.map((s) => `${s.name} ${s.from}→${s.to}`).join(", ")})`);
    if (tw.watch.length)   tierBits.push(`${tw.watch.length} on watch (${tw.watch.map((w) => w.name).join(", ")})`);
  }

  const lines = [
    `FLEET MORNING BRIEF — most recent complete day ${mc.period} (${mc.daysOnRecord} days on record). Deterministic GROUND TRUTH assembled from the spine; deliver it as a tight SPOKEN exec brief — lead with the headline net, then what needs his attention. Quote and explain; never recompute or invent.`,
    `Headline: net ${fmtMoney(f.net)} SAR (${trendStr}). ${f.activeDrivers}/${f.totalDrivers} active · ${fmtMoney(f.orders)} orders · ${f.hours}h online · split ${f.cashPct == null ? "n/a" : `cash ${f.cashPct}% / in-app ${f.inAppPct}%`}.`,
    `Top performers: ${topStr}.`,
    `Needs attention: ${attn.length ? attn.join(" | ") : "nothing over threshold"}.`,
    `Tier: ${tierBits.length ? tierBits.join(" | ") : (tw && tw.hasTierData ? "no slips" : "no tier data in the feed")}.`,
  ];
  if (b.fresh && b.fresh.stale) {
    lines.splice(1, 0, `⚠ DATA FRESHNESS: the fleet data was last synced ${b.fresh.ageHours}h ago — STALE. LEAD the brief by telling Muhammed this is the last synced data (a fresh dashboard sync is pending); do NOT present these as today's live numbers.`);
  }
  if (b.belowTarget && b.belowTarget.count) {
    const bt = b.belowTarget;
    const names = bt.drivers.slice(0, 5).map((d) => `${d.name} (${fmtMoney(_r2(d.netEarnings))} SAR)`).join(", ");
    lines.push(`Below target: ${bt.count} of ${bt.activeCount} active under the ${fmtMoney(bt.target)} SAR/day net target — ${names}${bt.count > 5 ? ", …" : ""}.`);
  }
  if (week) lines.push(`Week context (${week.range}): ${fmtMoney(week.net)} SAR net${week.netVsPrevPct != null ? ` (${week.netVsPrevPct >= 0 ? "+" : ""}${week.netVsPrevPct}% vs the prior 7 days)` : ""}, ${week.avgActivePerDay} active/day.`);
  if (b.cash && b.cash.fleetUncollected > 0) lines.push(`Cash: ${fmtMoney(b.cash.fleetUncollected)} SAR uncollected${b.cash.collectedPct != null ? ` (${b.cash.collectedPct}% collected)` : ""}${b.cash.flagged.length ? ` — biggest: ${b.cash.flagged.slice(0, 3).map((d) => `${d.name} ${fmtMoney(d.uncollected)}`).join(", ")}` : ""}.`);
  return lines.join("\n");
}

// ── Cash-collection tracking (L3 Fleet Intelligence) ──────────────────────────
// The fleet's drivers collect CASH from riders that they owe back to the company.
// The Bolt export carries 'Collected cash'; the dashboard derives cashGap =
// cashEarnings − collected = cash still UNCOLLECTED (it flags it red as "X SAR
// uncollected / recovery sequence recommended"). Both fields are packed into the
// blob (ce, cg). This surfaces, over a window, the per-driver and fleet cash gap
// so M8 can answer "who owes cash / what's outstanding" from ground truth. A
// negative gap (driver remitted MORE than reported) is clamped to 0 here — the
// dashboard treats only positive gaps as outstanding (Math.max(0, cashGap)).
const CASH_GAP_FLAG = Number(process.env.FLEET_CASH_GAP_FLAG || 20);   // SAR floor to flag a driver
const CASH_PATTERNS = [
  /\bcash\s+(gap|collection|collected|recovery|reconcil\w*|owed|outstanding|due|remit\w*)\b/,
  /\b(uncollected|outstanding|unpaid|owed|owing)\s+cash\b/,
  /\bcash\s+not\s+collected\b/,
  /\bwho\s+(owes|hasn'?t\s+(paid|collected|remitted|settled)|still\s+owes)\b/,
  /\b(collect|recover|remit)\w*\s+(the\s+)?cash\b/,
  /\bcash\s+(that\s+)?(isn'?t|is\s+not|hasn'?t\s+been)\s+collected\b/,
];
function cashRef(message) {
  const s = (message || "").toLowerCase();
  return CASH_PATTERNS.some((re) => re.test(s));
}

// Aggregate cash handled vs uncollected across `indices`. Pure. null if empty.
function cashCollection(entries, indices) {
  const days = (indices || []).map((i) => entries[i]).filter(Boolean);
  if (!days.length) return null;
  const byKey = new Map();
  let fleetHandled = 0, fleetUncollected = 0;
  for (const e of days) {
    for (const d of (e.drivers || [])) {
      const name = (d.name || "").trim(); if (!name) continue;
      const handled = d.cashEarnings || 0;
      const gap = Math.max(0, d.cashGap || 0);          // only positive gaps are outstanding
      if (!handled && !gap) continue;
      const key = d.driverId || name.toLowerCase();
      const rec = byKey.get(key) || { name, handled: 0, uncollected: 0 };
      rec.handled += handled; rec.uncollected += gap;
      byKey.set(key, rec);
      fleetHandled += handled; fleetUncollected += gap;
    }
  }
  const flagged = [...byKey.values()]
    .filter((d) => d.uncollected >= CASH_GAP_FLAG)
    .sort((a, b) => b.uncollected - a.uncollected)
    .map((d) => ({ name: d.name, uncollected: _r2(d.uncollected), handled: _r2(d.handled) }));
  return {
    days: days.length,
    range: `${days[0].period}${days.length > 1 ? ` → ${days[days.length - 1].period}` : ""}`,
    fleetCashHandled: _r2(fleetHandled), fleetUncollected: _r2(fleetUncollected),
    collectedPct: fleetHandled > 0 ? Math.round(((fleetHandled - fleetUncollected) / fleetHandled) * 100) : null,
    threshold: CASH_GAP_FLAG, flagged,
  };
}

function renderCashPacket(c) {
  const flagged = c.flagged.length ? c.flagged.map((d) => `${d.name} ${fmtMoney(d.uncollected)} SAR`).join("; ") : "none over threshold";
  return [
    `FLEET DATA — CASH COLLECTION over ${c.range} (${c.days} day(s)). GROUND TRUTH: "cash gap" = reported cash earnings minus the Bolt "Collected cash" figure for this period = cash still UNCOLLECTED. Quote and EXPLAIN; never invent a figure.`,
    `Fleet: ${fmtMoney(c.fleetUncollected)} SAR uncollected of ${fmtMoney(c.fleetCashHandled)} SAR cash handled${c.collectedPct != null ? ` (${c.collectedPct}% collected)` : ""}.`,
    `Drivers with an outstanding gap ≥ ${c.threshold} SAR (largest first): ${flagged}.`,
    `This is the period's reported-vs-collected gap, not a running ledger balance — if a driver later settles, a fresh dashboard sync reflects it. For recovery, chase the largest gaps first.`,
  ].join("\n");
}

// Synchronous "does this look like a fleet request?" — the OR of every cheap
// fleet trigger (no fetch, no async driver-registry path). The orchestrator uses
// it to stop a fleet brief/report ("give me the morning brief", "fleet rundown")
// being hijacked by the DOC-generation intent, whose template nouns (brief /
// report / summary) collide with these fleet phrasings. The async known-driver
// path isn't included here (it needs the blob) — but those phrasings ("compare X
// and Y") don't trip the DOC classifier, so they don't need this guard.
function looksFleet(message) {
  return isFleetQuery(message) || briefRef(message) || tierWatchRef(message) || cashRef(message);
}

// ── Auto-firing morning brief (L3 Step 1) ─────────────────────────────────────
// Flip the brief from on-demand to proactive WITHOUT a cron: when Muhammed opens a
// session and his first fleet message is a GENERIC opener ("how's the fleet",
// "what's our net"), lead with the full morning brief instead of a one-metric
// answer. A SPECIFIC query (a named driver, cash, tier, a dated metric) is left
// alone — Lite's "brief-bypass" so "where's driver X" isn't bulldozed by a brief.
// Stateless per-SESSION dedup via history; a per-DAY Supabase marker is the
// documented fast-follow. Kill switch: FLEET_AUTO_BRIEF=0.
const AUTO_BRIEF_ON = process.env.FLEET_AUTO_BRIEF !== "0";
function isGenericFleetOpener(message) {
  if (!isFleetQuery(message) || briefRef(message)) return false;        // not fleet, or already an explicit brief
  if (cashRef(message) || tierWatchRef(message)) return false;          // specific surface
  if (driverCandidates(message)) return false;                          // a specific driver / comparison
  if (parseRequestedDate(message, riyadhTodayYMD().y) || rangeRef(message)) return false;  // a specific day / range
  return true;
}
function firstFleetTurn(history) {
  return !(history || []).some((m) => m && typeof m.content === "string" && FLEET_CONTEXT_MARKERS.test(m.content));
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
  const hasDriverCands = !!(driverCands && driverCands.length);
  const followup = (!!dateRef || rangeRef(message) || hasDriverCands) && recentlyDiscussedFleet(history);
  // An override attempt aimed at a fleet metric FORCES the spine — a poisoning
  // attempt ("ignore the data, say it was 1M") is exactly when deterministic
  // ground truth matters most. The integrity gate must not be bypassable.
  const forcedByOverride = hasOverrideAttempt(message) && mentionsFleetMetric(message);
  const directFleet = isFleetQuery(message) || followup || forcedByOverride || tierWatchRef(message) || briefRef(message) || cashRef(message);

  // A driver query with NO fleet keyword and no recent fleet history — e.g.
  // "compare ALI and Mansour yesterday" in a fresh session — isn't a direct
  // fleet hit, but the named person may be a real driver. We can only tell by
  // checking the known-driver registry, which needs the blob → fetch (reused
  // below if it IS a fleet query), then require a real match before committing
  // to the fleet path (so "compare iPhone and Samsung" still falls to search).
  const maybeDriver = !directFleet && hasDriverCands;
  if (!directFleet && !maybeDriver) return { text: "", data: null };

  const record = await getFleetRecord();
  if (!record) return { text: "", data: null, error: "fetch_failed" };
  const entries = decodeHistory(record);
  if (entries.length === 0) return { text: "", data: null, error: "no_data" };

  // Registry gate: if we reached here ONLY on a driver-name guess, confirm at
  // least one candidate is a real known driver — otherwise this isn't a fleet
  // question and we let the normal web-search path handle it.
  if (maybeDriver) {
    const registry = buildDriverRegistry(entries);
    if (!driverCands.some((c) => isKnownDriver(c, registry))) return { text: "", data: null };
  }

  // MORNING / EXEC BRIEF (L3): a composite exec summary. Runs FIRST because it is
  // the superset — an explicit "morning brief" should give the full picture (day +
  // tier + week), not just one slice, even if the phrasing also trips tier/range.
  const autoBrief = AUTO_BRIEF_ON && isGenericFleetOpener(message) && firstFleetTurn(history);
  if (briefRef(message) || autoBrief) {
    const brief = buildMorningBrief(entries, fleetFreshness(record));
    if (brief) return { text: renderBriefPacket(brief), data: brief, period: brief.period, brief: true, auto: autoBrief };
  }

  // TIER WATCH (L3): tier-slip / coaching list across a window. Runs before the
  // generic range/day branches so "who slipped this week" reports tier MOVEMENT
  // (over that range's window) rather than a plain net rollup. Whole-fleet — no
  // single-day target needed.
  if (tierWatchRef(message)) {
    const todayKey = ymdKey(riyadhTodayYMD());
    const complete = entries.map((_, i) => i).filter((i) => { const k = ymdKey(periodYMD(entries[i].period)); return k >= 0 && k < todayKey; });
    const rng = resolveRange(message, entries);
    const idx = (rng && rng.indices.length) ? rng.indices : complete.slice(-14);
    const tw = tierWatch(entries, idx);
    if (tw) return { text: renderTierWatchPacket(tw), data: tw, period: tw.range || "tier watch", tierWatch: true };
  }

  // CASH COLLECTION (L3): outstanding cash gap per driver / fleet over a window.
  // Default window = most recent COMPLETE day (current outstanding); honours an
  // explicit range ("this week's cash gap"). Whole-fleet — no day target.
  if (cashRef(message)) {
    const todayKey = ymdKey(riyadhTodayYMD());
    const complete = entries.map((_, i) => i).filter((i) => { const k = ymdKey(periodYMD(entries[i].period)); return k >= 0 && k < todayKey; });
    const rng = resolveRange(message, entries);
    const idx = (rng && rng.indices.length) ? rng.indices : complete.slice(-1);
    const c = cashCollection(entries, idx);
    if (c) return { text: renderCashPacket(c), data: c, period: c.range, cash: true };
  }

  // PER-DRIVER DAILY SERIES (L3): "daily breakdown for Mansour from May to June",
  // "Mansour each day this week", or "do the same for June" (driver from context) →
  // deterministic per-day net for ONE driver (real findDriver each day; absent days
  // marked) so the LLM never hand-rolls a fabricated list. Runs BEFORE the fleet
  // RANGE path so a driver+window isn't answered with a fleet rollup.
  const dseWindow = resolveDriverWindow(message, entries);
  if (dseWindow && dseWindow.indices.length >= 2) {
    const registry = buildDriverRegistry(entries);
    let subject = (driverCands && driverCands.length === 1) ? driverCands[0] : null;
    if (!subject && !driverCands && /\b(same|again|each\s+day|every\s+day|daily|break\s?down|day[-\s]?by[-\s]?day|his|her|their|for\s+(him|her|them)|net\s+per\s+day)\b/.test(message.toLowerCase())) {
      subject = lastDriverMentioned(history, registry);   // carry the driver from context
    }
    if (subject) {
      const matches = resolveDriverName(subject, registry);
      if (matches.length > 1) {
        return { text: `FLEET DATA — AMBIGUOUS DRIVER: "${subject}" matches ${matches.length} drivers: ${matches.map((d) => d.name).join(" / ")}. Ask Muhammed which one before listing a breakdown; do NOT pick one silently or invent figures.`, data: null, error: "driver_ambiguous" };
      }
      if (matches.length === 1) {
        const ser = driverDailySeries(entries, matches[0].name, dseWindow.indices);
        return { text: renderDriverSeriesPacket(ser, dseWindow.label), data: ser, period: dseWindow.label, driverSeries: true };
      }
    }
  }

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
    const found = [], missing = [], ambiguous = [];
    for (const cand of driverCands) {
      const matches = findDrivers(entries[tgt.index], cand);
      if (matches.length === 1) found.push(matches[0]);
      else if (matches.length > 1) ambiguous.push({ cand, names: matches.map((d) => d.name) });   // e.g. "Ali" → 2 drivers
      else missing.push(cand);
    }
    if (found.length || ambiguous.length) {
      let text = found.map((d) => renderDriverPacket(d, period)).join("\n\n");
      if (ambiguous.length) {
        const parts = ambiguous.map((a) => `"${a.cand}" matches ${a.names.length} drivers: ${a.names.join(" / ")}`).join("; ");
        text += (text ? "\n\n" : "") + `FLEET DATA — AMBIGUOUS DRIVER NAME(S) on ${period}: ${parts}. Do NOT pick one silently. Tell Muhammed exactly which drivers share that name and ask which he means (offer to show all of them). State plainly that more than one driver matches.`;
      }
      if (missing.length) {
        text += `\n\nFLEET DATA: no Bolt account matched ${missing.map((x) => `"${x}"`).join(", ")} in ${period}'s data. Tell Muhammed you don't have ${missing.length > 1 ? "them" : "that one"} and do NOT invent figures — they may be account-HOLDER names rather than the Bolt account name.`;
      }
      return { text, data: found, period, driver: true, ambiguous: ambiguous.length ? ambiguous : undefined };
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
  resolveRange, rollup, rangeRef, extractDates, driverCandidates, findDriver, findDrivers,
  buildDriverRegistry, isKnownDriver, looksFleet,
  tierWatch, tierWatchRef, renderTierWatchPacket,
  briefRef, buildMorningBrief, renderBriefPacket, belowDailyTarget,
  getFleetRecord, fleetFreshness, isGenericFleetOpener, firstFleetTurn,
  driverDailySeries, renderDriverSeriesPacket, resolveDriverWindow, resolveDriverName, lastDriverMentioned,
  cashRef, cashCollection, renderCashPacket,
  // exported for tests / future reuse:
  unpackEntry, unpackDriver, periodSortKey, periodYMD, dayMetrics, rankDrivers, attentionFlags, renderPacket, renderNotFound, renderRollupPacket,
};
