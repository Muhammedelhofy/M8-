/**
 * M8 Track-A — lib/fleet-analysis.js  (Build-72b)
 *
 * The "WHAT CHANGED & WHY" layer: when Muhammad asks why net moved, M8 doesn't
 * just restate the number — it DECOMPOSES the change and names the factors that
 * moved alongside it. Honest framing: this is attribution FROM THE DATA (the
 * levers that moved with net), NOT a proven cause. Code computes the math; the
 * LLM narrates it without over-claiming causation.
 *
 * The decomposition is exact and intuitive:
 *     net = (active drivers) × (orders per driver) × (net per order)
 * so a change in fleet net is split into PARTICIPATION (how many worked),
 * VOLUME (how many orders each ran), and VALUE (how much each order earned).
 * Plus per-driver SWINGS (who individually drove the move vs their own average).
 *
 * Lives in its own module (imports read-only helpers from lib/fleet.js) so it
 * never collides with the fleet spine. Every export fails SAFE.
 */
const {
  getFleetRecord, decodeHistory, dayMetrics, resolveTarget,
  periodYMD, ymdKey, riyadhTodayYMD, recentlyDiscussedFleet,
} = require("./fleet");

const fmtMoney = (v) => (v == null ? "?" : Math.round(v).toLocaleString("en-US"));
const _r0 = (v) => Math.round(v || 0);
function pct(t, b) { return (b && b !== 0) ? Math.round(((t - b) / b) * 100) : null; }
const safe = (n, d) => (d ? n / d : 0);

// ── Per-driver swing vs their own trailing average ────────────────────────────
function driverSwings(entries, idx) {
  const today = entries[idx];
  const trailing = entries.slice(Math.max(0, idx - 7), idx);
  const trailNet = new Map();
  for (const e of trailing) for (const d of (e.drivers || [])) {
    if (!d.isActive) continue;
    const k = d.driverId || (d.name || "").toLowerCase();
    if (!k) continue;
    const r = trailNet.get(k) || { sum: 0, count: 0 };
    r.sum += d.netEarnings || 0; r.count++; trailNet.set(k, r);
  }
  const sw = [];
  for (const d of (today.drivers || [])) {
    if (!d.isActive) continue;
    const k = d.driverId || (d.name || "").toLowerCase();
    if (!k) continue;
    const r = trailNet.get(k);
    const avg = r && r.count ? r.sum / r.count : 0;
    sw.push({ name: d.name, today: _r0(d.netEarnings || 0), avg: _r0(avg), swing: _r0((d.netEarnings || 0) - avg) });
  }
  sw.sort((a, b) => b.swing - a.swing);
  return {
    up: sw.slice(0, 3).filter((x) => x.swing > 0),
    down: sw.slice(-3).reverse().filter((x) => x.swing < 0),
  };
}

// ── The decomposition ─────────────────────────────────────────────────────────
function explainChange(entries, idx) {
  if (!entries || idx == null || idx < 0 || idx >= entries.length) return null;
  const day = dayMetrics(entries[idx]);
  const trailing = entries.slice(Math.max(0, idx - 7), idx).map(dayMetrics);
  if (!trailing.length) return { period: day.period, day, baseline: null };

  const avg = (f) => trailing.reduce((a, d) => a + (f(d) || 0), 0) / trailing.length;
  const base = {
    net: avg((d) => d.net), orders: avg((d) => d.orders), active: avg((d) => d.active),
    hours: avg((d) => d.hours), accept: avg((d) => d.avgAccept),
    cash: avg((d) => d.cash), gross: avg((d) => d.gross),
  };

  const t = { active: day.active, opd: safe(day.orders, day.active), npo: safe(day.net, day.orders) };
  const b = { active: base.active, opd: safe(base.orders, base.active), npo: safe(base.net, base.orders) };
  const comp = [
    { key: "participation", label: "drivers active",    pct: pct(t.active, b.active), now: _r0(day.active), was: _r0(base.active) },
    { key: "volume",        label: "orders per driver", pct: pct(t.opd, b.opd),       now: Math.round(t.opd * 10) / 10, was: Math.round(b.opd * 10) / 10 },
    { key: "value",         label: "net per order",     pct: pct(t.npo, b.npo),       now: Math.round(t.npo * 10) / 10, was: Math.round(b.npo * 10) / 10 },
  ];
  const ranked = comp.filter((c) => c.pct != null).sort((a, b2) => Math.abs(b2.pct) - Math.abs(a.pct));

  const context = {
    netPct: pct(day.net, base.net),
    acceptPts: _r0((day.avgAccept || 0) - (base.accept || 0)),
    hoursPct: pct(day.hours, base.hours),
    cashNow: day.gross ? Math.round((day.cash / day.gross) * 100) : null,
    cashWas: base.gross ? Math.round((base.cash / base.gross) * 100) : null,
  };

  return {
    period: day.period, trailingDays: trailing.length,
    net: _r0(day.net), baseNet: _r0(base.net), netPct: context.netPct,
    comp: ranked, context, swings: driverSwings(entries, idx),
  };
}

// ── Narration packet (LLM explains; honesty caveat baked in) ──────────────────
function renderChangePacket(ex) {
  if (!ex) return "";
  if (!ex.comp) {
    return `FLEET CHANGE ANALYSIS — only ${ex.period} is on record, so there's no prior window to compare. Say plainly you can't explain a change yet (need more days of data).`;
  }
  const dir = ex.netPct == null ? "flat" : (ex.netPct >= 0 ? `up ${ex.netPct}%` : `down ${Math.abs(ex.netPct)}%`);
  const top = ex.comp[0];
  const factorLine = ex.comp.map((c) => {
    const arrow = c.pct >= 0 ? "+" : "";
    return `${c.label} ${arrow}${c.pct}% (${c.was} → ${c.now})`;
  }).join("; ");
  const upStr = ex.swings.up.length ? ex.swings.up.map((d) => `${d.name} +${fmtMoney(d.swing)}`).join(", ") : "none notable";
  const downStr = ex.swings.down.length ? ex.swings.down.map((d) => `${d.name} ${fmtMoney(d.swing)}`).join(", ") : "none notable";
  const cashShift = (ex.context.cashNow != null && ex.context.cashWas != null)
    ? `Cash share ${ex.context.cashWas}% → ${ex.context.cashNow}%.` : "";

  return [
    `FLEET CHANGE ANALYSIS — ${ex.period}: net ${fmtMoney(ex.net)} SAR, ${dir} vs the trailing ${ex.trailingDays}-day average (${fmtMoney(ex.baseNet)} SAR). DETERMINISTIC decomposition — quote it, don't recompute.`,
    `Net = (drivers active) × (orders per driver) × (net per order). The factors that moved WITH net: ${factorLine}.`,
    `The biggest mover was ${top.label} (${top.pct >= 0 ? "+" : ""}${top.pct}%) — lead your explanation with that. Acceptance ${ex.context.acceptPts >= 0 ? "+" : ""}${ex.context.acceptPts}pts, online hours ${ex.context.hoursPct >= 0 ? "+" : ""}${ex.context.hoursPct}%. ${cashShift}`,
    `Biggest per-driver swings vs their own average — up: ${upStr}; down: ${downStr}.`,
    `HOW TO ANSWER: explain WHY net moved by leading with the dominant factor, then the supporting ones, then name the drivers who swung most. CRITICAL HONESTY: these are the levers that moved ALONGSIDE net (attribution from the data), NOT a proven cause — say "the main thing that moved was…", never claim certainty about why a human behaved a certain way. 3-5 sentences.`,
  ].join("\n");
}

// ── Detection ─────────────────────────────────────────────────────────────────
const CHANGE_CUE = /\bwhy\b|\bwhat\s+(changed|happened|drove|caused|made)\b|\bexplain\b|\b(reason|cause)s?\b|\bwhat'?s\s+(driving|behind)\b|\bhow\s+come\b|ليش|ليه|وش\s*صار|وش\s*السبب|ايش\s*صار|سبب|وش\s*اللي\s*صار/i;
const PERF_CUE = /\bnet\b|\bgross\b|\bearnings?\b|\brevenue\b|\bnumbers?\b|\borders?\b|\bdown\b|\bup\b|\bdrop(?:ped)?\b|\bfell\b|\brose\b|\bhigher\b|\blower\b|\bless\b|\bmore\b|\bslow\b|\bbad\b|\bgood\b|\btoday\b|\byesterday\b|أرباح|الأرباح|نزل|طلع|اليوم|أمس/i;

// Strict: a "why/what changed" cue AND a performance/fleet cue in the same message.
function detectChangeQueryStrict(message) {
  const s = message || "";
  return CHANGE_CUE.test(s) && PERF_CUE.test(s);
}
// Loose: a bare "why?" / "what changed?" right after a fleet conversation.
function detectChangeQuery(message, history) {
  if (detectChangeQueryStrict(message)) return true;
  return CHANGE_CUE.test(message || "") && recentlyDiscussedFleet(history);
}

async function buildFleetChangeContext(message, history) {
  try {
    if (!detectChangeQuery(message, history)) return { text: "" };
    const record = await getFleetRecord();
    if (!record) return { text: "" };
    const entries = decodeHistory(record);
    if (!entries.length) return { text: "" };
    const tgt = resolveTarget(message, entries);
    if (!tgt || tgt.index < 0) return { text: "" };
    const ex = explainChange(entries, tgt.index);
    if (!ex) return { text: "" };
    return { text: renderChangePacket(ex), data: ex };
  } catch (err) {
    console.error("[M8 fleet-analysis] error (non-fatal):", err.message);
    return { text: "" };
  }
}

module.exports = {
  detectChangeQuery, detectChangeQueryStrict,
  explainChange, renderChangePacket, driverSwings,
  buildFleetChangeContext,
};
