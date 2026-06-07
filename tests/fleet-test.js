/**
 * M8 Fleet Spine Test — tests/fleet-test.js
 *
 * Run: node tests/fleet-test.js
 *
 * Exercises the deterministic spine end-to-end on a SYNTHETIC c1-packed record
 * (no network, no env vars): c1 decode → sort → dayMetrics → rankDrivers →
 * missionControl trend math → renderPacket → isFleetQuery. The packed input
 * below mirrors the dashboard's packDriver/packEntry key map so the decoder is
 * tested against the real wire format, not its own output.
 */

const {
  decodeHistory, missionControl, renderPacket, isFleetQuery, periodSortKey,
  resolveTarget, parseRequestedDate,
} = require("../lib/fleet");

// ── helpers: mirror index.html packDriver (omit zeros/empties) ────────────────
function packDriver(d) {
  const o = {};
  const putS = (k, v) => { if (v) o[k] = v; };
  const putN = (k, v) => { const r = Math.round((v || 0) * 100) / 100; if (r) o[k] = r; };
  putS("n", d.name); putS("i", d.driverId);
  putN("o", d.orders); putN("h", d.hoursOnline); putN("ne", d.netEarnings); putN("ge", d.grossEarnings);
  putN("ac", d.acceptance); putN("ra", d.rating); putN("ut", d.utilization); putN("fr", d.finishRate);
  putN("ce", d.cashEarnings); putN("gia", d.grossInApp);
  if (d.isActive) o.a = 1;
  return o;
}
function packEntry(period, drivers) {
  const active = drivers.filter((d) => d.isActive);
  return {
    p: period,
    u: new Date().toISOString(),
    to: drivers.reduce((a, d) => a + (d.orders || 0), 0),
    tg: drivers.reduce((a, d) => a + (d.grossEarnings || 0), 0),
    tn: drivers.reduce((a, d) => a + (d.netEarnings || 0), 0),
    aa: active.length ? active.reduce((a, d) => a + (d.acceptance || 0), 0) / active.length : 0,
    dc: drivers.length, ac: active.length,
    d: drivers.map(packDriver),
  };
}

// ── synthetic fleet: 7 prior days (net 400) + 1 latest day (net 500) ──────────
const inactive = { name: "Carol", driverId: "C3", isActive: false };

const priorDay = (period) => packEntry(period, [
  { name: "Ahmed", driverId: "A1", isActive: true, orders: 26, hoursOnline: 8, netEarnings: 240, grossEarnings: 330, acceptance: 95, rating: 4.8, utilization: 80, finishRate: 96, cashEarnings: 120, grossInApp: 210 },
  { name: "Basma", driverId: "B2", isActive: true, orders: 18, hoursOnline: 7, netEarnings: 160, grossEarnings: 230, acceptance: 88, rating: 4.5, utilization: 70, finishRate: 90, cashEarnings: 90,  grossInApp: 140 },
  inactive,
]);

const latestDay = packEntry("27 May 2026", [
  { name: "Ahmed", driverId: "A1", isActive: true, orders: 30, hoursOnline: 8, netEarnings: 300, grossEarnings: 400, acceptance: 95, rating: 4.8, utilization: 80, finishRate: 96, cashEarnings: 150, grossInApp: 250 },
  { name: "Basma", driverId: "B2", isActive: true, orders: 22, hoursOnline: 7, netEarnings: 200, grossEarnings: 280, acceptance: 65, rating: 4.5, utilization: 55, finishRate: 90, cashEarnings: 100, grossInApp: 180 },
  inactive,
]);

// Insert OUT of chronological order to prove decodeHistory sorts.
const priorPeriods = ["26 May 2026", "20 May 2026", "24 May 2026", "21 May 2026", "25 May 2026", "23 May 2026", "22 May 2026"];
const record = {
  khair_fmt: "c1",
  khair_history: [latestDay, ...priorPeriods.map(priorDay)],
};

// ── runner ────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅  ${name}`); }
  else { failed++; fails.push({ name, detail }); console.log(`  ❌  ${name}${detail ? `  (${detail})` : ""}`); }
}
function eq(name, got, want) { check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }

console.log("\nM8 Fleet Spine Test");
console.log("=".repeat(72));

// 1) decode + sort
const entries = decodeHistory(record);
eq("decode: 8 days", entries.length, 8);
eq("sort: first day is 20 May", entries[0].period, "20 May 2026");
eq("sort: last day is 27 May", entries[7].period, "27 May 2026");
check("sort: strictly ascending", entries.every((e, i) => i === 0 || periodSortKey(e.period) >= periodSortKey(entries[i - 1].period)));
eq("decode: driver key map (ne→netEarnings)", entries[7].drivers[0].netEarnings, 300);
eq("decode: inactive driver flagged", entries[7].drivers[2].isActive, false);

// 1b) date resolution (all synthetic days are < today, so no-date → latest = 27 May)
eq("resolveTarget: no date → most recent completed day (27 May)", resolveTarget("how did the fleet do", entries).index, 7);
eq("resolveTarget: explicit '20 may' → that day", resolveTarget("net on 20 may", entries).index, 0);
eq("resolveTarget: unknown date → not found", resolveTarget("net on 1 jan 2020", entries).found, false);
eq("parseRequestedDate: 'june 6' → m5 d6", (() => { const r = parseRequestedDate("net june 6", 2026); return `${r.m}-${r.d}`; })(), "5-6");
eq("parseRequestedDate: '6th of june' → m5 d6", (() => { const r = parseRequestedDate("the 6th of june", 2026); return `${r.m}-${r.d}`; })(), "5-6");
eq("parseRequestedDate: 'yesterday' → rel", (parseRequestedDate("how did we do yesterday", 2026) || {}).rel, "yesterday");

// 2) mission control (target = the synthetic latest day, 27 May, index 7)
const mc = missionControl(entries, resolveTarget("how did the fleet do", entries).index);
eq("mc: period = target day", mc.period, "27 May 2026");
eq("mc: net = 500", mc.fleet.net, 500);
eq("mc: gross = 680", mc.fleet.gross, 680);
eq("mc: orders = 52", mc.fleet.orders, 52);
eq("mc: active drivers = 2/3", `${mc.fleet.activeDrivers}/${mc.fleet.totalDrivers}`, "2/3");
eq("mc: cash split 37%", mc.fleet.cashPct, 37);          // 250/680
eq("mc: in-app split 63%", mc.fleet.inAppPct, 63);
eq("mc: avg acceptance 80%", mc.fleet.avgAccept, 80);    // (95+65)/2
eq("mc: avg utilisation 68%", mc.fleet.avgUtil, 68);     // (80+55)/2
eq("mc: trend +25% vs trailing", mc.trend.netVsTrailPct, 25);  // 500 vs 400
eq("mc: trailing window = 7 days", mc.trend.trailingDays, 7);

// 3) ranking + attention
eq("rank: top earner Ahmed", mc.top[0].name, "Ahmed");
eq("rank: top value 300", mc.top[0].value, 300);
eq("rank: 2nd Basma 200", mc.top[1].value, 200);
eq("attention: 1 below acceptance floor", mc.attention.lowAcceptCount, 1);
eq("attention: low-accept is Basma", mc.attention.lowAccept[0].name, "Basma");
eq("attention: 1 below utilisation floor", mc.attention.lowUtilCount, 1);

// 4) packet text
const packet = renderPacket(mc);
check("packet: contains net 500", packet.includes("500 SAR"));
check("packet: contains +25% trend", packet.includes("+25%"));
check("packet: contains GROUND TRUTH guard", packet.includes("GROUND TRUTH"));
check("packet: names top performer", packet.includes("Ahmed"));
check("packet: under ~200 tokens (~900 chars)", packet.length < 900, `${packet.length} chars`);

// 5) legacy (unpacked) format still decodes
const legacy = decodeHistory({ khair_history: [
  { period: "02 Jun 2026", drivers: [{ name: "Z", isActive: true, netEarnings: 10 }], totalNet: 10 },
  { period: "01 Jun 2026", drivers: [{ name: "Y", isActive: true, netEarnings: 5 }], totalNet: 5 },
] });
eq("legacy: decodes + sorts", legacy.map((e) => e.period).join(","), "01 Jun 2026,02 Jun 2026");

// 6) intent gate
check("intent: 'how did my fleet do' → true", isFleetQuery("how did my fleet do yesterday"));
check("intent: 'top earner this week' → true", isFleetQuery("who was the top earner this week"));
check("intent: Arabic 'الأسطول' → true", isFleetQuery("كيف كان أداء الأسطول"));
check("intent: 'weather in riyadh' → false", !isFleetQuery("weather in riyadh tomorrow"));
check("intent: empty → false", !isFleetQuery(""));

console.log("=".repeat(72));
console.log(`\nResults: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  console.log("\nFailed:");
  fails.forEach((f) => console.log(`  ${f.name} — ${f.detail || ""}`));
  process.exit(1);
}
console.log("All fleet spine tests passed.\n");

// Show the actual packet the LLM would receive (visual sanity check).
console.log("── Sample metric packet (injected into prompt) ──\n");
console.log(renderPacket(mc));
console.log();
