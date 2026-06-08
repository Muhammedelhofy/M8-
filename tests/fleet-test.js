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
  resolveTarget, parseRequestedDate, recentlyDiscussedFleet,
  resolveRange, rollup, rangeRef, extractDates, dayMetrics, driverCandidates, findDriver, findDrivers,
  buildDriverRegistry, isKnownDriver, looksFleet,
  tierWatch, tierWatchRef,
  briefRef, buildMorningBrief, renderBriefPacket, belowDailyTarget, fleetFreshness,
  isGenericFleetOpener, firstFleetTurn,
  driverDailySeries, renderDriverSeriesPacket, resolveDriverWindow, resolveDriverName,
  cashRef, cashCollection, renderCashPacket,
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

// 1c) multi-day rollups (8 synthetic complete days; latest=27 May net 500, others net 400)
check("rangeRef: 'this week' → true", rangeRef("how did the fleet do this week"));
check("rangeRef: 'on the 6th' → false", !rangeRef("net on the 6th of june"));
const wk = resolveRange("how did we do this week", entries);
eq("resolveRange: 'this week' → 7 days", wk.indices.length, 7);
const wkRoll = rollup(entries, wk.indices, wk.label);
eq("rollup: net = 6×400 + 500 = 2900", wkRoll.net, 2900);    // days 21-27 May
eq("rollup: 7 days", wkRoll.days, 7);
eq("rollup: best day = 27 May (500)", `${wkRoll.best.period}:${wkRoll.best.net}`, "27 May 2026:500");
eq("rollup: top performer is Ahmed", wkRoll.top[0].name, "Ahmed");
const r3 = rollup(entries, resolveRange("last 3 days", entries).indices, "the last 3 days");
eq("rollup: 'last 3 days' net = 1300 (400+400+500)", r3.net, 1300);
eq("rollup: period-over-period +8% (1300 vs prior 1200)", r3.netVsPrevPct, 8);
eq("rollup: 'this week' prior-window too short → null", wkRoll.netVsPrevPct, null);

// 1d) explicit date ranges + daily breakdown
eq("extractDates: 'from 21 may to 24 may' → 2 dates", extractDates("net from 21 may to 24 may", { y: 2026, m: 4 }).length, 2);
eq("extractDates: 'day 4 and day 5' (bare) → 2 dates", extractDates("breakdown day 4 and day 5", { y: 2026, m: 4 }).length, 2);
const rng = resolveRange("net from 21 may to 24 may", entries);
eq("resolveRange: explicit range → 4 days (21-24 May)", rng.indices.length, 4);
check("resolveRange: explicit range → perDay", rng.perDay === true);
const rngRoll = rollup(entries, rng.indices, rng.label, { perDay: rng.perDay });
eq("rollup: explicit range net = 4×400 = 1600", rngRoll.net, 1600);
eq("rollup: dailyBreakdown has 4 entries", rngRoll.dailyBreakdown.length, 4);
check("rangeRef: 'daily breakdown' → true (sticks as follow-up)", rangeRef("can you get me a daily breakdown"));
const bd = resolveRange("give me a daily breakdown", entries);
check("resolveRange: 'daily breakdown' (no dates) → last 7, perDay", bd.indices.length === 7 && bd.perDay === true);

// 1e) active-only totals — an inactive driver who earned (tip/campaign) must NOT count
const mixedEntry = { period: "1 Jun 2026", drivers: [
  { name: "A", isActive: true,  netEarnings: 100, orders: 5, grossEarnings: 140 },
  { name: "B", isActive: false, netEarnings: 50,  orders: 0, grossEarnings: 60 },  // earned but inactive
]};
eq("dayMetrics: net active-only (100 not 150)", dayMetrics(mixedEntry).net, 100);
eq("dayMetrics: gross active-only (140 not 200)", dayMetrics(mixedEntry).gross, 140);

// 1f) driver lookup: anti-fabrication + multi-driver + must NOT hijack generic Qs
const dc = (msg) => JSON.stringify(driverCandidates(msg));
eq("driverCandidates: 'what about Ahmed' → [Ahmed]", dc("what about Ahmed"), JSON.stringify(["Ahmed"]));
eq("driverCandidates: 'how much did Ahmed make' → [Ahmed]", dc("how much did Ahmed make"), JSON.stringify(["Ahmed"]));
eq("driverCandidates: possessive \"Ahmed's net\" → [Ahmed]", dc("what is Ahmed's net"), JSON.stringify(["Ahmed"]));
eq("driverCandidates: possessive FULL name \"Mansour Alshehri's net\" → [Mansour Alshehri]", dc("give me Mansour Alshehri's net"), JSON.stringify(["Mansour Alshehri"]));
eq("driverCandidates: multi 'compare Ahmed and Basma' → [Ahmed,Basma]", dc("compare Ahmed and Basma"), JSON.stringify(["Ahmed", "Basma"]));
eq("driverCandidates: collective 'how did the fleet do' → null", dc("how did the fleet do"), JSON.stringify(null));
eq("driverCandidates: pronoun 'how much did we make' → null", dc("how much did we make"), JSON.stringify(null));
eq("driverCandidates: 'how did the team do today' → null", dc("how did the team do today"), JSON.stringify(null));
eq("findDriver: 'Ahmed' on 27 May → net 300", findDriver(entries[7], "Ahmed").netEarnings, 300);
eq("findDriver: 'Basma' → net 200", findDriver(entries[7], "Basma").netEarnings, 200);
check("findDriver: unknown name → null (no fabrication)", findDriver(entries[7], "Habib") === null);
// findDriver PRECISION — shared surname / substring must NOT return the wrong driver
const surnameEntry = { period: "1 Jun 2026", drivers: [
  { name: "ABDULRAHMAN ALSHAHRANI", isActive: true, netEarnings: 316.73 },
  { name: "FAISAL ALMANSOUR",       isActive: true, netEarnings: 180 },
] };
check("findDriver: 'ALI ALSHAHRANI' (absent) → null, not the other ALSHAHRANI", findDriver(surnameEntry, "ALI ALSHAHRANI") === null);
check("findDriver: 'Mansour' → null, not 'ALMANSOUR' substring", findDriver(surnameEntry, "Mansour") === null);
eq("findDriver: 'ABDULRAHMAN ALSHAHRANI' → exact match", findDriver(surnameEntry, "ABDULRAHMAN ALSHAHRANI").netEarnings, 316.73);
eq("findDriver: 'ABDULRAHMAN' (one distinctive name) → match", findDriver(surnameEntry, "ABDULRAHMAN").netEarnings, 316.73);
// AMBIGUOUS NAME (live bug: two "Ali" → must NOT silently pick one)
const twoAli = { period: "7 Jun 2026", drivers: [
  { name: "ALI ALSHAHRANI",   isActive: true, netEarnings: 425.92 },
  { name: "ALI MOHAMMED",     isActive: true, netEarnings: 300 },
  { name: "MANSOUR ALSHEHRI", isActive: true, netEarnings: 262.23 },
] };
eq("findDrivers: 'Ali' → 2 matches (ambiguous)", findDrivers(twoAli, "Ali").length, 2);
eq("findDrivers: 'Mansour' → 1 match", findDrivers(twoAli, "Mansour").length, 1);
eq("findDrivers: 'ALI ALSHAHRANI' (full) → 1 match", findDrivers(twoAli, "ALI ALSHAHRANI").length, 1);
eq("findDrivers: 'ALI MOHAMMED' (full) → 1 match", findDrivers(twoAli, "ALI MOHAMMED").length, 1);
eq("findDrivers: unknown 'Khalid' → 0", findDrivers(twoAli, "Khalid").length, 0);
check("findDriver: 'Ali' (ambiguous) → null, no silent pick", findDriver(twoAli, "Ali") === null);
eq("findDriver: 'Mansour' (unique) → still resolves", findDriver(twoAli, "Mansour").netEarnings, 262.23);
eq("findDriver: 'ALI ALSHAHRANI' (full) → the right Ali", findDriver(twoAli, "ALI ALSHAHRANI").netEarnings, 425.92);
// looksFleet: requests that must beat doc-gen and never web-search
check("looksFleet: 'give me the morning brief' → true", looksFleet("give me the morning brief"));
check("looksFleet: 'who slipped a tier' → true", looksFleet("who slipped a tier this week"));
check("looksFleet: 'who owes cash' → true", looksFleet("who owes cash"));
check("looksFleet: 'how did the fleet do' → true", looksFleet("how did the fleet do"));
check("looksFleet: 'write me a business plan' → false (real doc)", !looksFleet("write me a business plan"));
check("looksFleet: 'summarize this article' → false", !looksFleet("summarize this article"));

// 1g) KNOWN-DRIVER REGISTRY + GATE (Crack #2 fix) — a driver query with no fleet
//     keyword and no recent fleet history (fresh session) must route to fleet,
//     while an arbitrary compare target must NOT bleed into a web search.
const reg = buildDriverRegistry(entries);
check("registry: knows Ahmed (token)", reg.tokens.includes("ahmed"));
check("registry: knows Basma (token)", reg.tokens.includes("basma"));
check("registry: includes inactive Carol (union of ALL names ever seen)", reg.tokens.includes("carol"));
eq("registry: drivers list deduped by id → 3 (Ahmed/Basma/Carol)", reg.drivers.length, 3);
check("isKnownDriver: 'Ahmed' → true", isKnownDriver("Ahmed", reg));
check("isKnownDriver: 'ahmed' (case-folded) → true", isKnownDriver("ahmed", reg));
check("isKnownDriver: 'Carol' (inactive but on record) → true", isKnownDriver("Carol", reg));
check("isKnownDriver: 'Ahm' (prefix of Ahmed) → true", isKnownDriver("Ahm", reg));
check("isKnownDriver: 'iPhone' → false", !isKnownDriver("iPhone", reg));
check("isKnownDriver: 'Samsung' → false", !isKnownDriver("Samsung", reg));
check("isKnownDriver: 'Carolyn' (longer ≠ prefix of 'carol') → false", !isKnownDriver("Carolyn", reg));
check("isKnownDriver: empty → false", !isKnownDriver("", reg));
// End-to-end gate decision = driverCandidates() ∩ registry. Mirrors the
// `maybeDriver` branch in buildFleetContext (which needs network, so isn't unit-
// tested directly): does this message resolve to a REAL driver → fleet path?
const gate = (msg) => { const c = driverCandidates(msg); return !!(c && c.some((x) => isKnownDriver(x, reg))); };
check("gate: 'compare Ahmed and Basma yesterday' (no kw, fresh) → fleet", gate("compare Ahmed and Basma yesterday"));
check("gate: 'how much did Basma make' → fleet", gate("how much did Basma make"));
check("gate: 'what about Ahmed?' → fleet", gate("what about Ahmed?"));
check("gate: 'compare iPhone and Samsung' → NOT fleet (→ web search)", !gate("compare iPhone and Samsung"));
check("gate: 'compare my job offers this week' → NOT fleet", !gate("compare my job offers this week"));
check("gate: 'what about the weather' → NOT fleet", !gate("what about the weather"));

// 1h) TIER WATCH (L3) — slip / improve / watch over a window, from Bolt tier.level
const tierDays = decodeHistory({ khair_history: [
  { period: "01 Jun 2026", drivers: [
    { name: "Slipper", driverId: "S1", isActive: true, netEarnings: 100, tier: { level: 2, englishName: "Gold" },   acceptance: 90, finishRate: 95, rating: 4.8 },
    { name: "Climber", driverId: "C1", isActive: true, netEarnings: 100, tier: { level: 1, englishName: "Silver" }, acceptance: 88, finishRate: 92, rating: 4.7 },
    { name: "Risky",   driverId: "R1", isActive: true, netEarnings: 100, tier: { level: 2, englishName: "Gold" },   acceptance: 55, finishRate: 70, rating: 4.2 },
    { name: "Steady",  driverId: "T1", isActive: true, netEarnings: 100, tier: { level: 1, englishName: "Silver" }, acceptance: 92, finishRate: 95, rating: 4.9 },
  ] },
  { period: "05 Jun 2026", drivers: [
    { name: "Slipper", driverId: "S1", isActive: true, netEarnings: 100, tier: { level: 1, englishName: "Silver" }, acceptance: 60, finishRate: 78, rating: 4.3 },
    { name: "Climber", driverId: "C1", isActive: true, netEarnings: 100, tier: { level: 2, englishName: "Gold" },   acceptance: 91, finishRate: 96, rating: 4.8 },
    { name: "Risky",   driverId: "R1", isActive: true, netEarnings: 100, tier: { level: 2, englishName: "Gold" },   acceptance: 52, finishRate: 68, rating: 4.1 },
    { name: "Steady",  driverId: "T1", isActive: true, netEarnings: 100, tier: { level: 1, englishName: "Silver" }, acceptance: 93, finishRate: 96, rating: 4.9 },
  ] },
] });
const tw = tierWatch(tierDays, [0, 1]);
check("tierWatch: has tier data", tw.hasTierData === true);
eq("tierWatch: 1 slipped", tw.slipped.length, 1);
eq("tierWatch: slip = Slipper Gold→Silver", `${tw.slipped[0].name} ${tw.slipped[0].from}→${tw.slipped[0].to}`, "Slipper Gold→Silver");
eq("tierWatch: slip carries recent metrics (60% acc)", tw.slipped[0].accept, 60);
eq("tierWatch: 1 improved", tw.improved.length, 1);
eq("tierWatch: improve = Climber Silver→Gold", `${tw.improved[0].name} ${tw.improved[0].from}→${tw.improved[0].to}`, "Climber Silver→Gold");
check("tierWatch: Risky on watch (Gold, 52% acc / 68% finish)", tw.watch.some((w) => w.name === "Risky"));
check("tierWatch: Steady NOT on watch (strong metrics)", !tw.watch.some((w) => w.name === "Steady"));
check("tierWatch: Slipper not double-counted on watch", !tw.watch.some((w) => w.name === "Slipper"));
eq("tierWatch: no tier field → hasTierData false", tierWatch(decodeHistory({ khair_history: [
  { period: "01 Jun 2026", drivers: [{ name: "X", isActive: true, netEarnings: 5 }] }] }), [0]).hasTierData, false);
check("tierWatchRef: 'who is slipping a tier' → true", tierWatchRef("who is slipping a tier this week"));
check("tierWatchRef: 'show me tier slips' → true", tierWatchRef("show me tier slips"));
check("tierWatchRef: 'who needs coaching' → true", tierWatchRef("who needs coaching"));
check("tierWatchRef: 'which drivers to coach' → true", tierWatchRef("which drivers should I coach"));
check("tierWatchRef: 'coaching plan for my youtube' → false", !tierWatchRef("make a coaching plan for my youtube channel"));
check("tierWatchRef: 'weather in riyadh' → false", !tierWatchRef("weather in riyadh"));

// 1i) MORNING / EXEC BRIEF (L3) — composite of most-recent-complete-day + week + tier
check("briefRef: 'give me the morning brief' → true", briefRef("give me the morning brief"));
check("briefRef: 'state of the fleet' → true", briefRef("what's the state of the fleet"));
check("briefRef: 'fleet rundown' → true", briefRef("fleet rundown please"));
check("briefRef: 'how did Ahmed do' → false (plain query, not a brief)", !briefRef("how did Ahmed do"));
check("briefRef: 'brief me on the meeting' → false (not fleet)", !briefRef("brief me on the meeting"));
const brief = buildMorningBrief(entries);
eq("brief: targets most recent complete day (27 May)", brief.period, "27 May 2026");
eq("brief: headline day net = 500", brief.mc.fleet.net, 500);
eq("brief: week context = last-7 net 2900", brief.week.net, 2900);
eq("brief: synthetic feed has no tier data", brief.tw.hasTierData, false);
const bp = renderBriefPacket(brief);
check("brief packet: headline 'net 500 SAR'", bp.includes("net 500 SAR"));
check("brief packet: names top performer Ahmed", bp.includes("Ahmed"));
check("brief packet: has week-context line", bp.includes("Week context"));
check("brief packet: flags missing tier data honestly", bp.includes("no tier data"));
check("brief packet: carries GROUND TRUTH guard", bp.includes("GROUND TRUTH"));
check("brief packet: no cash line when no gap in feed", !bp.includes("Cash:"));

// 1i.2) BELOW DAILY TARGET (L3) — mirrors dashboard dailyTarget = round(6000/30) = 200
eq("brief: carries belowTarget block (target 200)", brief.belowTarget.target, 200);
eq("brief: 27-May has 0 below target (Basma=200 not <200, Ahmed=300)", brief.belowTarget.count, 0);
check("brief packet: no below-target line when none under target", !bp.includes("Below target"));
const btEntry = { period: "1 Jun 2026", drivers: [
  { name: "AboveT",  isActive: true,  netEarnings: 250 },
  { name: "Mid",     isActive: true,  netEarnings: 150 },
  { name: "Lowest",  isActive: true,  netEarnings: 80  },
  { name: "OffDuty", isActive: false, netEarnings: 0   },   // inactive → excluded
] };
const bt = belowDailyTarget(btEntry);
eq("belowTarget: daily target 200 (6000/30 default)", bt.target, 200);
eq("belowTarget: 2 active under target", bt.count, 2);
eq("belowTarget: active count 3 (inactive excluded)", bt.activeCount, 3);
eq("belowTarget: lowest-first ordering", bt.drivers[0].name, "Lowest");
const bpBelow = renderBriefPacket(Object.assign({}, brief, { belowTarget: bt }));
check("brief packet: below-target line lists laggards lowest-first",
  bpBelow.includes("Below target") && bpBelow.indexOf("Lowest") < bpBelow.indexOf("Mid"));

// 1i.3) DATA FRESHNESS (L3 Step 0) — stale-sync guard on the brief
const hoursAgoISO = (h) => new Date(Date.now() - h * 3600000).toISOString();
eq("freshness: no _syncedAt → unknown", fleetFreshness({}).unknown, true);
eq("freshness: synced 2h ago → not stale", fleetFreshness({ _syncedAt: hoursAgoISO(2) }).stale, false);
eq("freshness: synced 20h ago → stale (default 18h)", fleetFreshness({ _syncedAt: hoursAgoISO(20) }).stale, true);
const bpStale = renderBriefPacket(Object.assign({}, brief, { fresh: fleetFreshness({ _syncedAt: hoursAgoISO(20) }) }));
check("brief packet: stale data leads with a FRESHNESS warning (before Headline)",
  bpStale.includes("DATA FRESHNESS") && bpStale.indexOf("DATA FRESHNESS") < bpStale.indexOf("Headline"));
check("brief packet: fresh/unknown data → no freshness warning", !bp.includes("DATA FRESHNESS"));

// 1i.4) AUTO-FIRING BRIEF (L3 Step 1) — generic opener auto-fires; specific query bypasses
check("autoBrief: 'what is our net earnings' → generic opener (auto-fires)", isGenericFleetOpener("what is our net earnings"));
check("autoBrief: explicit 'morning brief' → not a generic opener", !isGenericFleetOpener("give me the morning brief"));
check("autoBrief: 'how much did Ahmed make' → bypass (specific driver)", !isGenericFleetOpener("how much did Ahmed make"));
check("autoBrief: 'who owes cash' → bypass (cash surface)", !isGenericFleetOpener("who owes cash"));
check("autoBrief: 'net on 20 may' → bypass (specific date)", !isGenericFleetOpener("net on 20 may"));
check("autoBrief: empty history → first fleet turn of session", firstFleetTurn([]));
check("autoBrief: prior fleet turn in history → not first", !firstFleetTurn([{ role: "assistant", content: "Net earnings were 2,993 SAR for the fleet." }]));

// 1k) PER-DRIVER DAILY SERIES (L3) — deterministic; never invents or interpolates
const allIdxK = entries.map((_, i) => i);
const aSer = driverDailySeries(entries, "Ahmed", allIdxK);
eq("driverSeries: 8 days in range", aSer.daysInRange, 8);
eq("driverSeries: Ahmed worked all 8 days", aSer.daysWorked, 8);
eq("driverSeries: 27 May net = 300", aSer.series.find((r) => r.period === "27 May 2026").net, 300);
eq("driverSeries: prior day (20 May) net = 240", aSer.series.find((r) => r.period === "20 May 2026").net, 240);
eq("driverSeries: total = 7×240 + 300 = 1980", aSer.total, 1980);
const ghostSer = driverDailySeries(entries, "Habib", allIdxK);
eq("driverSeries: unknown driver → 0 worked days", ghostSer.daysWorked, 0);
check("driverSeries packet: marks absent days, never invents a number", renderDriverSeriesPacket(ghostSer, "every day").includes("absent"));
check("driverWindow: 'from 21 may to 24 may' → 4 days", (resolveDriverWindow("daily breakdown from 21 may to 24 may", entries) || { indices: [] }).indices.length === 4);
check("driverWindow: 'since he started' → all 8 days", (resolveDriverWindow("net since he started", entries) || { indices: [] }).indices.length === 8);
check("driverWindow: 'all of may' → all 8 synthetic May days", (resolveDriverWindow("all of may", entries) || { indices: [] }).indices.length === 8);
eq("driverWindow: 'yesterday' (single day) → null", resolveDriverWindow("what about him yesterday", entries), null);
eq("resolveDriverName: 'Ahmed' → 1 unique match", resolveDriverName("Ahmed", buildDriverRegistry(entries)).length, 1);

// 1j) CASH COLLECTION (L3) — per-driver / fleet outstanding cash gap over a window
const cashDays = decodeHistory({ khair_history: [
  { period: "05 Jun 2026", drivers: [
    { name: "Owes",  driverId: "O1", isActive: true, cashEarnings: 300, cashGap: 120 },   // outstanding
    { name: "Clean", driverId: "L1", isActive: true, cashEarnings: 200, cashGap: 0 },     // fully collected
    { name: "Small", driverId: "M1", isActive: true, cashEarnings: 100, cashGap: 10 },    // below 20 floor
    { name: "Over",  driverId: "V1", isActive: true, cashEarnings: 50,  cashGap: -30 },   // remitted more → clamp 0
  ] },
] });
const cc = cashCollection(cashDays, [0]);
eq("cash: fleet uncollected = 130 (120+10, -30 clamped to 0)", cc.fleetUncollected, 130);
eq("cash: fleet cash handled = 650", cc.fleetCashHandled, 650);
eq("cash: collected pct = 80", cc.collectedPct, 80);
eq("cash: 1 driver flagged ≥20 SAR", cc.flagged.length, 1);
eq("cash: flagged = Owes 120 (largest first)", `${cc.flagged[0].name} ${cc.flagged[0].uncollected}`, "Owes 120");
check("cash: Small (10 < 20) not flagged", !cc.flagged.some((d) => d.name === "Small"));
check("cash: Over (negative gap clamped) not flagged", !cc.flagged.some((d) => d.name === "Over"));
const cp = renderCashPacket(cc);
check("cash packet: fleet '130 SAR uncollected'", cp.includes("130 SAR uncollected"));
check("cash packet: names the debtor Owes", cp.includes("Owes"));
check("cash packet: GROUND TRUTH guard", cp.includes("GROUND TRUTH"));
check("cashRef: 'who owes cash' → true", cashRef("who owes cash"));
check("cashRef: 'cash gap this week' → true", cashRef("show me the cash gap this week"));
check("cashRef: 'uncollected cash' → true", cashRef("how much uncollected cash"));
check("cashRef: \"who hasn't paid\" → true", cashRef("who hasn't paid"));
check("cashRef: 'cash flow forecast' → false (not collection)", !cashRef("build me a cash flow forecast"));
check("cashRef: 'net earnings today' → false", !cashRef("net earnings today"));

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
eq("mc: day-over-day +25% (500 vs 400)", mc.trend.dayOverDayPct, 25);
eq("mc: no dropped regulars (Ahmed/Basma worked)", mc.anomalies.droppedRegulars.length, 0);
eq("mc: no net-drop alert (positive trend)", mc.anomalies.netDropAlert, null);

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
check("intent: 'net earning' (singular) → true", isFleetQuery("what is the net earning on the 5th of june"));
check("intent: Arabic 'الأسطول' → true", isFleetQuery("كيف كان أداء الأسطول"));
check("intent: 'weather in riyadh' → false", !isFleetQuery("weather in riyadh tomorrow"));
check("intent: 'Tesla earnings' → false (not fleet-flavoured)", !isFleetQuery("what were tesla earnings last quarter"));
check("intent: empty → false", !isFleetQuery(""));

// follow-up stickiness: bare date + recent fleet history
const fleetHist = [{ role: "user", content: "net earnings June 6" }, { role: "assistant", content: "Net earnings were 2,993 SAR for the fleet." }];
check("followup: bare date follows fleet history", !isFleetQuery("what about the 4th of june?") && !!parseRequestedDate("what about the 4th of june?", 2026) && recentlyDiscussedFleet(fleetHist));
check("followup: no fleet history → not sticky", !recentlyDiscussedFleet([{ role: "user", content: "what's the weather" }]));

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
