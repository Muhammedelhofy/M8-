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
    orders:    entry.totalOrders || _sum(drivers, (d) => d.orders),
    gross:     entry.totalGross  || _sum(drivers, (d) => d.grossEarnings),
    net:       entry.totalNet    || _sum(drivers, (d) => d.netEarnings),
    cash:      _sum(drivers, (d) => d.cashEarnings),
    inApp:     _sum(drivers, (d) => d.grossInApp),
    hours:     _sum(drivers, (d) => d.hoursOnline),
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
 * Mission-control summary: latest day vs the trailing up-to-7-day average.
 * Pure aggregation — the % deltas and flags are computed here so the LLM never
 * does arithmetic. Returns null if there is no data.
 */
function missionControl(entries) {
  if (!entries || entries.length === 0) return null;
  const latest   = entries[entries.length - 1];
  const trailing = entries.slice(Math.max(0, entries.length - 8), entries.length - 1); // up to 7 prior days
  const day      = dayMetrics(latest);
  const trailAvgNet = trailing.length ? _avg(trailing.map(dayMetrics), (d) => d.net) : null;
  const netVsTrailPct = trailAvgNet ? Math.round(((day.net - trailAvgNet) / trailAvgNet) * 100) : null;
  const cashPct = day.gross ? Math.round((day.cash / day.gross) * 100) : null;
  const ranked  = rankDrivers(latest, "netEarnings", 3);
  const flags   = attentionFlags(latest);

  return {
    period: day.period,
    daysOnRecord: entries.length,
    fleet: {
      net: _r0(day.net), gross: _r0(day.gross), orders: _r0(day.orders),
      activeDrivers: day.active, totalDrivers: day.drivers, hours: _r1(day.hours),
      cashPct, inAppPct: cashPct == null ? null : 100 - cashPct,
      avgAccept: _r0(day.avgAccept), avgFinish: _r0(day.avgFinish),
      avgUtil: _r0(day.avgUtil), avgRating: _r1(day.avgRating),
    },
    trend: { netVsTrailPct, trailingDays: trailing.length },
    top: ranked.top,
    attention: {
      lowAcceptCount: flags.lowAccept.length, lowAccept: flags.lowAccept.slice(0, 5),
      lowUtilCount: flags.lowUtil.length, lowUtil: flags.lowUtil.slice(0, 5),
    },
  };
}

// ── Intent detection (cheap regex; runs before any fetch) ─────────────────────
const FLEET_PATTERNS = [
  /\bfleet\b/, /\bdrivers?\b/, /\bcaptains?\b/, /\bcouriers?\b/, /\briders?\b/, /\bbikes?\b/,
  /\b(top|best|worst|bottom|lowest|highest)\s+(earner|driver|performer|captain|courier|rider)/,
  /\b(utilis|utiliz)ation\b/, /\bacceptance rate\b/, /\bfinish rate\b/,
  /\b(net|gross)\s+earnings\b/, /\bpayout\b/,
  /\b(morning|fleet|daily)\s+brief\b/, /\bmission control\b/,
  /كباتن|كابتن|سائق|سائقين|الأسطول|الاسطول|توصيل/,
];
function isFleetQuery(message) {
  const m = (message || "").toLowerCase();
  return FLEET_PATTERNS.some((p) => p.test(m));
}

// ── Packet builder: the <200-token block injected into the LLM prompt ─────────
function fmtMoney(v) { return (v == null ? "?" : v.toLocaleString("en-US")); }

function renderPacket(mc) {
  const f = mc.fleet, t = mc.trend, a = mc.attention;
  const trendStr = t.netVsTrailPct == null ? "no prior days to compare"
    : `${t.netVsTrailPct >= 0 ? "+" : ""}${t.netVsTrailPct}% vs trailing ${t.trailingDays}-day avg`;
  const topStr = mc.top.map((d) => `${d.name} (${fmtMoney(d.value)} SAR, ${d.accept}% acc)`).join("; ") || "n/a";
  const cashStr = f.cashPct == null ? "n/a" : `cash ${f.cashPct}% / in-app ${f.inAppPct}%`;
  const attnBits = [];
  if (a.lowAcceptCount) attnBits.push(`${a.lowAcceptCount} below ${LOW_ACCEPT}% acceptance (${a.lowAccept.map((d) => `${d.name} ${d.accept}%`).join(", ")})`);
  if (a.lowUtilCount)   attnBits.push(`${a.lowUtilCount} below ${LOW_UTIL}% utilisation (${a.lowUtil.map((d) => `${d.name} ${d.util}%`).join(", ")})`);
  const attnStr = attnBits.length ? attnBits.join(" | ") : "none over threshold";

  return [
    `FLEET DATA — computed deterministically from the live dashboard for ${mc.period} (${mc.daysOnRecord} days on record).`,
    `These figures are GROUND TRUTH. Do NOT recompute, re-sum, or invent any number — quote and EXPLAIN only. If asked for something not below, say it isn't in today's snapshot.`,
    `Net earnings: ${fmtMoney(f.net)} SAR (${trendStr}). Gross: ${fmtMoney(f.gross)} SAR. Orders: ${fmtMoney(f.orders)}.`,
    `Drivers active: ${f.activeDrivers}/${f.totalDrivers}. Online hours: ${f.hours}. Split: ${cashStr}.`,
    `Avg acceptance ${f.avgAccept}% · finish ${f.avgFinish}% · utilisation ${f.avgUtil}% · rating ${f.avgRating}.`,
    `Top performers (by net): ${topStr}.`,
    `Needs attention: ${attnStr}.`,
  ].join("\n");
}

/**
 * Orchestrator entry point. Cheap regex gate first; only fetches when the
 * message is actually a fleet question. Returns { text, data } — text is the
 * prompt block (empty string when not applicable or on any failure), data is
 * the structured mission-control object for UI/voice rendering.
 */
async function buildFleetContext(message) {
  if (!isFleetQuery(message)) return { text: "", data: null };
  const record = await fetchFleetRecord();
  if (!record) return { text: "", data: null, error: "fetch_failed" };
  const entries = decodeHistory(record);
  if (entries.length === 0) return { text: "", data: null, error: "no_data" };
  const mc = missionControl(entries);
  if (!mc) return { text: "", data: null, error: "no_data" };
  return { text: renderPacket(mc), data: mc, period: mc.period };
}

module.exports = {
  buildFleetContext,
  isFleetQuery,
  fetchFleetRecord,
  decodeHistory,
  missionControl,
  // exported for tests / future reuse:
  unpackEntry, unpackDriver, periodSortKey, dayMetrics, rankDrivers, attentionFlags, renderPacket,
};
