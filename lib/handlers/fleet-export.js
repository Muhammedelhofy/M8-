/**
 * GET /api/fleet-export?format=xlsx|pptx
 *
 * Generates a downloadable fleet report from the same deterministic spine
 * that powers M8's fleet answers. No LLM involved — pure data + formatting.
 *
 * Formats:
 *   xlsx  — Excel workbook: Driver Rankings sheet + Fleet Summary + Insight Flags
 *   pptx  — PowerPoint deck: Title → KPI Summary → Rankings → Attention → Actions
 */
"use strict";

const { getFleetRecord, decodeHistory } = require("../fleet");

// Lazy-require the heavy packages so cold starts aren't penalised when
// the export endpoint isn't called. Both are pure JS, no native binaries.
function getExcelJS() { return require("exceljs"); }
function getPptxGenJS() { return require("pptxgenjs"); }

// ── helpers ─────────────────────────────────────────────────────────────────
const MONTH_ABBR  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const _r2 = (v) => Math.round((v || 0) * 100) / 100;
const _r0 = (v) => Math.round(v || 0);
const fmtSAR = (v) => _r0(v).toLocaleString("en-US");

function riyadhTodayYMD() {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, mo, d] = s.split("-").map(Number);
  return { y, m: mo - 1, d };
}
function periodYMD(period) {
  const mm = (period || "").match(/(\d{1,2})\s(\w{3})\s(\d{4})/);
  if (!mm) return null;
  const MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const mi = MAP[mm[2]]; if (mi == null) return null;
  return { y: +mm[3], m: mi, d: +mm[1] };
}
function ymdKey(t) { return t ? t.y * 10000 + t.m * 100 + t.d : -1; }

// ── compute the report data (mirrors fleet insight engine) ──────────────────
function buildReportData(entries) {
  const today = riyadhTodayYMD();
  const todayKey = ymdKey(today);

  const monthIndices = entries.map((_, i) => i).filter((i) => {
    const p = periodYMD(entries[i].period);
    if (!p || p.y !== today.y || p.m !== today.m) return false;
    if (ymdKey(p) >= todayKey) return false;
    return true;
  });
  if (!monthIndices.length) return null;

  const daysInMonth   = new Date(Date.UTC(today.y, today.m + 1, 0)).getUTCDate();
  const daysElapsed   = today.d - 1;
  const daysRemaining = daysInMonth - daysElapsed;
  const monthLabel    = `${MONTH_ABBR[today.m]} ${today.y}`;

  // Per-driver MTD aggregation
  const byKey = new Map();
  for (const i of monthIndices) {
    for (const d of (entries[i].drivers || [])) {
      if (!d.isActive && !(d.netEarnings > 0)) continue;
      const name = (d.name || "").trim(); if (!name) continue;
      const key  = d.driverId || name.toLowerCase();
      const rec  = byKey.get(key) || { name, net: 0, daysWorked: 0 };
      rec.net += d.netEarnings || 0;
      if (d.isActive) rec.daysWorked++;
      byKey.set(key, rec);
    }
  }

  const TARGET = 5000;
  const rankings = [...byKey.values()].map((d) => {
    const calAvg   = daysElapsed > 0 ? d.net / daysElapsed : 0;
    const projected = _r0(d.net + calAvg * daysRemaining);
    const status   = projected >= TARGET * 1.1 ? "EXCEEDING"
                   : projected >= TARGET        ? "ON TRACK"
                   : projected >= TARGET * 0.8  ? "CLOSE"
                   : "OFF PACE";
    return { name: d.name, net: _r2(d.net), daysWorked: d.daysWorked, projected, calAvgPerDay: _r2(calAvg), status };
  }).sort((a, b) => b.net - a.net);

  const totalNet    = _r2(rankings.reduce((s, d) => s + d.net, 0));
  const top3Net     = _r2(rankings.slice(0, 3).reduce((s, d) => s + d.net, 0));
  const top3Pct     = totalNet > 0 ? Math.round(top3Net / totalNet * 100) : 0;
  const avgPerDriver = rankings.length ? _r2(totalNet / rankings.length) : 0;

  // Dark driver detection (worked ≥3 days earlier, absent last 5)
  const completeDays = monthIndices
    .map((i) => ({ i, key: ymdKey(periodYMD(entries[i].period)) }))
    .filter((x) => x.key > 0 && x.key < todayKey);
  const darkDrivers = [];
  if (completeDays.length > 7) {
    const recentIdx  = completeDays.slice(-5).map((x) => x.i);
    const earlierIdx = completeDays.slice(0, -5).map((x) => x.i);
    const activeLast = new Set();
    for (const i of recentIdx) {
      for (const d of (entries[i]?.drivers || [])) { if (d.isActive && d.name) activeLast.add(d.name.trim()); }
    }
    const activeEarlier = new Map();
    for (const i of earlierIdx) {
      for (const d of (entries[i]?.drivers || [])) {
        if (d.isActive && d.name) { const nm = d.name.trim(); activeEarlier.set(nm, (activeEarlier.get(nm) || 0) + 1); }
      }
    }
    for (const [name, count] of activeEarlier.entries()) {
      if (!activeLast.has(name) && count >= 3) {
        const rec = rankings.find((d) => d.name === name);
        darkDrivers.push({ name, daysEarlier: count, net: rec ? rec.net : 0 });
      }
    }
  }

  // Inconsistency detection + daily-per-driver nets for the grid sheet
  const byName = new Map(); // name → [net per day in chronological order]
  const dailyGrid = [];     // [{dayLabel, dayNum, netByDriver: Map<name,net>}] sorted

  // Sort monthIndices by date so the grid columns are chronological
  const sortedDayIdx = [...monthIndices].sort((a, b) => {
    return ymdKey(periodYMD(entries[a].period)) - ymdKey(periodYMD(entries[b].period));
  });

  for (const i of sortedDayIdx) {
    const p = periodYMD(entries[i].period);
    const dayLabel = p ? `${p.d} ${MONTH_ABBR[p.m]}` : "?";
    const dayNum   = p ? p.d : 0;
    const netByDriver = new Map();
    for (const d of (entries[i].drivers || [])) {
      if (!d.isActive || !d.name) continue;
      const nm = d.name.trim();
      netByDriver.set(nm, _r2(d.netEarnings || 0));
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm).push(d.netEarnings || 0);
    }
    dailyGrid.push({ dayLabel, dayNum, netByDriver });
  }

  const inconsistent = [];
  for (const [name, dailyNets] of byName.entries()) {
    if (dailyNets.length < 3) continue;
    const avg = dailyNets.reduce((s, v) => s + v, 0) / dailyNets.length;
    if (avg < 100) continue;
    const cv  = avg > 0 ? Math.sqrt(dailyNets.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / dailyNets.length) / avg : 0;
    const low = dailyNets.filter((v) => v < 150).length;
    if (cv >= 0.55 && low >= 2) inconsistent.push({ name, avgNet: _r2(avg), lowDays: low, cv: _r2(cv) });
  }
  inconsistent.sort((a, b) => b.cv - a.cv);

  // Trend: last-7-day avg vs first-7-day avg per driver (needs ≥10 days of data)
  const trendByName = new Map();
  if (dailyGrid.length >= 10) {
    const first7 = dailyGrid.slice(0, 7);
    const last7  = dailyGrid.slice(-7);
    for (const [nm] of byName.entries()) {
      const earlyNets = first7.map((d) => d.netByDriver.get(nm) || 0);
      const lateNets  = last7.map((d)  => d.netByDriver.get(nm) || 0);
      const earlyAvg  = earlyNets.reduce((s, v) => s + v, 0) / earlyNets.length;
      const lateAvg   = lateNets.reduce((s, v)  => s + v, 0) / lateNets.length;
      const delta     = earlyAvg > 0 ? Math.round((lateAvg - earlyAvg) / earlyAvg * 100) : 0;
      trendByName.set(nm, { earlyAvg: _r2(earlyAvg), lateAvg: _r2(lateAvg), delta });
    }
  }

  const generatedAt = new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });

  return {
    monthLabel, daysElapsed, daysRemaining, daysInMonth,
    totalNet, avgPerDriver, top3Pct, top3Net,
    rankings, darkDrivers: darkDrivers.slice(0, 5),
    inconsistent: inconsistent.slice(0, 3),
    dailyGrid, trendByName,
    generatedAt, target: TARGET,
  };
}

// ── XLSX generator ───────────────────────────────────────────────────────────
async function generateXLSX(data) {
  const ExcelJS = getExcelJS();
  const wb      = new ExcelJS.Workbook();
  wb.creator     = "M8 Fleet Intelligence";
  wb.created     = new Date();

  // ── Sheet 1: Driver Rankings ──────────────────────────────────────────────
  const ws = wb.addWorksheet("Driver Rankings");

  const STATUS_FILL = {
    EXCEEDING: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A6B3A" } },
    "ON TRACK": { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A4A6B" } },
    CLOSE:      { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B5C1A" } },
    "OFF PACE": { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B1A1A" } },
  };
  const WHITE     = { argb: "FFFFFFFF" };
  const HDR_FILL  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2D40" } };
  const HDR_FONT  = { bold: true, color: WHITE, size: 11 };
  const THIN_BDR  = { style: "thin", color: { argb: "FF334155" } };
  const CELL_BDR  = { top: THIN_BDR, left: THIN_BDR, bottom: THIN_BDR, right: THIN_BDR };
  const NUM_FMT   = "#,##0.00";
  const NUM_FMT0  = "#,##0";

  // Title row
  ws.mergeCells("A1:G1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `Fleet Performance — ${data.monthLabel} MTD (${data.daysElapsed} days elapsed, ${data.daysRemaining} remaining)`;
  titleCell.font  = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  titleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1B2A" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  // Sub-title row
  ws.mergeCells("A2:G2");
  const subCell = ws.getCell("A2");
  subCell.value = `Generated by M8 Fleet Intelligence · ${data.generatedAt} (Riyadh time)`;
  subCell.font  = { italic: true, size: 9, color: { argb: "FF94A3B8" } };
  subCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1B2A" } };
  subCell.alignment = { horizontal: "center" };
  ws.getRow(2).height = 18;

  ws.addRow([]); // spacer

  // Header
  const headers = ["#", "Driver", "MTD Net (SAR)", "Days Worked", `Projected (SAR)`, "Pace Status", "Flag"];
  const hdrRow  = ws.addRow(headers);
  hdrRow.height = 22;
  hdrRow.eachCell((cell) => {
    cell.fill   = HDR_FILL;
    cell.font   = HDR_FONT;
    cell.border = CELL_BDR;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  ws.columns = [
    { key: "rank",      width: 5  },
    { key: "name",      width: 26 },
    { key: "net",       width: 16 },
    { key: "days",      width: 13 },
    { key: "projected", width: 16 },
    { key: "status",    width: 13 },
    { key: "flag",      width: 18 },
  ];

  // Data rows
  data.rankings.forEach((d, i) => {
    const isDark   = data.darkDrivers.some((dk) => dk.name === d.name);
    const isIncon  = data.inconsistent.some((ic) => ic.name === d.name);
    const flag     = [isDark ? "⚠ DARK" : "", isIncon ? "⚠ INCONSISTENT" : ""].filter(Boolean).join(" + ") || "";
    const row = ws.addRow([i + 1, d.name, d.net, d.daysWorked, d.projected, d.status, flag]);
    row.height = 18;

    const statusFill = STATUS_FILL[d.status] || STATUS_FILL["OFF PACE"];
    row.eachCell((cell, colN) => {
      cell.border = CELL_BDR;
      cell.alignment = { horizontal: colN === 2 ? "left" : "center", vertical: "middle" };
      if (colN === 3 || colN === 5) cell.numFmt = NUM_FMT;
      if (colN === 6) { cell.fill = statusFill; cell.font = { bold: true, color: WHITE, size: 10 }; }
      if (colN === 7 && flag) { cell.font = { bold: true, color: { argb: "FFFBBF24" } }; }
    });
  });

  // Summary row
  ws.addRow([]);
  const sumRow = ws.addRow(["", "FLEET TOTAL", data.totalNet, "", "", "", `Top 3 = ${data.top3Pct}% of net`]);
  sumRow.height = 22;
  sumRow.eachCell((cell, colN) => {
    cell.fill   = HDR_FILL;
    cell.font   = { bold: true, color: WHITE, size: 11 };
    cell.border = CELL_BDR;
    cell.alignment = { horizontal: colN === 2 ? "left" : "center", vertical: "middle" };
    if (colN === 3) cell.numFmt = NUM_FMT;
  });

  // ── Sheet 2: Insight Flags ────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Insight Flags");
  ws2.getColumn(1).width = 28;
  ws2.getColumn(2).width = 50;

  const addSection = (title, rows) => {
    const th = ws2.addRow([title, ""]);
    th.height = 20;
    th.eachCell((c) => { c.fill = HDR_FILL; c.font = HDR_FONT; c.border = CELL_BDR; });
    for (const r of rows) {
      const dr = ws2.addRow(r);
      dr.height = 17;
      dr.eachCell((c) => { c.border = CELL_BDR; c.alignment = { wrapText: true }; });
    }
    ws2.addRow([]);
  };

  if (data.darkDrivers.length) {
    addSection("DARK DRIVERS — active earlier, absent last 5 days", [
      ["Driver", "Details"],
      ...data.darkDrivers.map((d) => [d.name, `Worked ${d.daysEarlier} days earlier · ${fmtSAR(d.net)} SAR MTD · not seen in last 5 days`]),
    ]);
  }
  if (data.inconsistent.length) {
    addSection("INCONSISTENT EARNERS — high day-to-day variance", [
      ["Driver", "Details"],
      ...data.inconsistent.map((d) => [d.name, `Avg ${fmtSAR(d.avgNet)} SAR/day · ${d.lowDays} days under 150 SAR · CV ${d.cv}`]),
    ]);
  }
  if (data.rankings.filter((d) => d.status === "CLOSE").length) {
    addSection("CLOSE BUT OFF PACE — within reach of 5,000 SAR target", [
      ["Driver", "Details"],
      ...data.rankings.filter((d) => d.status === "CLOSE").map((d) => [d.name, `${fmtSAR(d.net)} SAR MTD · projected ${fmtSAR(d.projected)} SAR · gap ${fmtSAR(data.target - d.net)} SAR`]),
    ]);
  }

  // ── Sheet 3: Fleet Summary ─────────────────────────────────────────────────
  const ws3 = wb.addWorksheet("Fleet Summary");
  ws3.getColumn(1).width = 32;
  ws3.getColumn(2).width = 22;

  const addKpi = (label, value, note) => {
    const r = ws3.addRow([label, value, note || ""]);
    r.height = 20;
    r.getCell(1).font   = { color: { argb: "FF94A3B8" }, size: 11 };
    r.getCell(2).font   = { bold: true, color: WHITE, size: 13 };
    r.getCell(3).font   = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
    r.getCell(2).numFmt = "#,##0.00";
    r.eachCell((c) => { c.border = CELL_BDR; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1B2A" } }; });
  };
  const addKpiInt = (label, value, note) => {
    const r = ws3.addRow([label, value, note || ""]);
    r.height = 20;
    r.getCell(1).font   = { color: { argb: "FF94A3B8" }, size: 11 };
    r.getCell(2).font   = { bold: true, color: WHITE, size: 13 };
    r.getCell(3).font   = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
    r.eachCell((c) => { c.border = CELL_BDR; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1B2A" } }; });
  };

  // Title
  ws3.mergeCells("A1:C1");
  const s3Title = ws3.getCell("A1");
  s3Title.value = `Fleet Summary — ${data.monthLabel} (as of ${data.generatedAt})`;
  s3Title.font  = { bold: true, size: 14, color: WHITE };
  s3Title.fill  = HDR_FILL;
  s3Title.alignment = { horizontal: "center" };
  ws3.getRow(1).height = 26;
  ws3.addRow([]);

  addKpi("Total Fleet Net (SAR)", data.totalNet, `${data.rankings.length} active drivers`);
  addKpi("Average per Driver (SAR)", data.avgPerDriver, "MTD net ÷ active drivers");
  addKpi("Top 3 Drivers — combined (SAR)", data.top3Net, `${data.top3Pct}% of total fleet net`);
  ws3.addRow([]);
  addKpiInt("Days Elapsed", data.daysElapsed, `of ${data.daysInMonth} in ${data.monthLabel}`);
  addKpiInt("Days Remaining", data.daysRemaining, "calendar days left this month");
  ws3.addRow([]);
  addKpiInt("Drivers Exceeding Target (≥ 5,500 SAR proj.)", data.rankings.filter((d) => d.status === "EXCEEDING").length);
  addKpiInt("Drivers On Pace (≥ 5,000 SAR proj.)",          data.rankings.filter((d) => d.status === "ON TRACK").length);
  addKpiInt("Drivers Close (≥ 4,000 SAR proj.)",            data.rankings.filter((d) => d.status === "CLOSE").length);
  addKpiInt("Drivers Off Pace (< 4,000 SAR proj.)",         data.rankings.filter((d) => d.status === "OFF PACE").length);
  ws3.addRow([]);
  addKpiInt("Dark Drivers (gone ≥ 5 days)",           data.darkDrivers.length);
  addKpiInt("Inconsistent Earners (high variance)",   data.inconsistent.length);
  ws3.getColumn(3).width = 34;

  // ── Sheet 4: Daily Breakdown ───────────────────────────────────────────────
  if (data.dailyGrid.length) {
    const ws4 = wb.addWorksheet("Daily Breakdown");
    const days = data.dailyGrid;
    // Drivers sorted by MTD rank
    const driverOrder = data.rankings.map((d) => d.name);

    // Header row: Driver | Day 1 | Day 2 | ... | MTD Total
    const hdrValues = ["Driver", ...days.map((d) => d.dayLabel), "MTD Total"];
    const hRow = ws4.addRow(hdrValues);
    hRow.height = 22;
    hRow.eachCell((c) => {
      c.fill = HDR_FILL; c.font = HDR_FONT; c.border = CELL_BDR;
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
    hRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };

    // Column widths
    ws4.getColumn(1).width = 26;
    for (let ci = 2; ci <= days.length + 2; ci++) ws4.getColumn(ci).width = 9;

    // High/Low cell color thresholds
    const HIGH_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A4A2A" } }; // dark green
    const LOW_FILL  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A1A1A" } }; // dark red
    const MID_FILL  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1B2A" } }; // base bg
    const OFF_FILL  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } }; // absent

    for (const driverName of driverOrder) {
      const rowVals = [driverName];
      let mtdTotal = 0;
      for (const day of days) {
        const v = day.netByDriver.get(driverName);
        rowVals.push(v != null ? v : "");
        if (v != null) mtdTotal += v;
      }
      rowVals.push(_r2(mtdTotal));

      const dr = ws4.addRow(rowVals);
      dr.height = 18;
      dr.getCell(1).font      = { color: WHITE, size: 11 };
      dr.getCell(1).border    = CELL_BDR;
      dr.getCell(1).alignment = { horizontal: "left" };
      // Last cell = MTD total
      const totCell = dr.getCell(days.length + 2);
      totCell.font   = { bold: true, color: WHITE, size: 11 };
      totCell.numFmt = "#,##0.00";
      totCell.fill   = HDR_FILL;
      totCell.border = CELL_BDR;
      totCell.alignment = { horizontal: "center" };

      for (let ci = 2; ci <= days.length + 1; ci++) {
        const cell = dr.getCell(ci);
        const v    = rowVals[ci - 1];
        cell.border    = CELL_BDR;
        cell.alignment = { horizontal: "center" };
        if (v === "" || v == null) {
          cell.fill = OFF_FILL;
        } else {
          cell.numFmt = "#,##0.00";
          cell.font   = { color: WHITE, size: 10 };
          cell.fill   = v >= 300 ? HIGH_FILL : v < 150 ? LOW_FILL : MID_FILL;
        }
      }
    }

    // Totals row
    const totVals = ["DAILY TOTAL"];
    for (const day of days) {
      let s = 0;
      day.netByDriver.forEach((v) => { s += v; });
      totVals.push(_r2(s));
    }
    totVals.push(_r2(data.totalNet));
    const totRow = ws4.addRow(totVals);
    totRow.height = 20;
    totRow.eachCell((c, ci) => {
      c.fill   = HDR_FILL;
      c.font   = { bold: true, color: WHITE, size: 10 };
      c.border = CELL_BDR;
      c.alignment = { horizontal: ci === 1 ? "left" : "center" };
      if (ci > 1) c.numFmt = "#,##0.00";
    });
  }

  // ── Sheet 5: Projections ───────────────────────────────────────────────────
  const ws5 = wb.addWorksheet("Projections");
  const TREND_GREEN = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A4A2A" } };
  const TREND_RED   = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A1A1A" } };
  const TREND_FLAT  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2D40" } };

  const p5Hdr = ws5.addRow(["#", "Driver", "MTD Net", "Daily Avg", "Required Daily*", "Projected EOM", "Target Gap", "Status", "7d Trend", "Trend %"]);
  p5Hdr.height = 22;
  p5Hdr.eachCell((c) => { c.fill = HDR_FILL; c.font = HDR_FONT; c.border = CELL_BDR; c.alignment = { horizontal: "center", vertical: "middle" }; });
  p5Hdr.getCell(2).alignment = { horizontal: "left", vertical: "middle" };

  ws5.getColumn(1).width  = 5;
  ws5.getColumn(2).width  = 26;
  ws5.getColumn(3).width  = 14;
  ws5.getColumn(4).width  = 12;
  ws5.getColumn(5).width  = 16;
  ws5.getColumn(6).width  = 14;
  ws5.getColumn(7).width  = 12;
  ws5.getColumn(8).width  = 12;
  ws5.getColumn(9).width  = 12;
  ws5.getColumn(10).width = 10;

  data.rankings.forEach((d, i) => {
    const gap      = data.target - d.net;
    const required = gap > 0 && data.daysRemaining > 0 ? _r2(gap / data.daysRemaining) : 0;
    const trend    = data.trendByName.get(d.name);
    const trendDir = trend ? (trend.delta >= 5 ? "▲ RISING" : trend.delta <= -5 ? "▼ FALLING" : "→ FLAT") : "—";
    const trendPct = trend ? `${trend.delta > 0 ? "+" : ""}${trend.delta}%` : "—";
    const trendFill = trend ? (trend.delta >= 5 ? TREND_GREEN : trend.delta <= -5 ? TREND_RED : TREND_FLAT) : TREND_FLAT;
    const sc = STATUS_FILL[d.status] || STATUS_FILL["OFF PACE"];

    const pr = ws5.addRow([
      i + 1, d.name, d.net, d.calAvgPerDay,
      required > 0 ? required : "—",
      d.projected, gap > 0 ? gap : 0,
      d.status, trendDir, trendPct,
    ]);
    pr.height = 18;
    pr.eachCell((c, ci) => {
      c.border = CELL_BDR;
      c.alignment = { horizontal: ci === 2 ? "left" : "center", vertical: "middle" };
      if ([3,4,5,6,7].includes(ci) && typeof c.value === "number") c.numFmt = "#,##0.00";
    });
    pr.getCell(2).font  = { color: WHITE };
    pr.getCell(8).fill  = sc;
    pr.getCell(8).font  = { bold: true, color: WHITE, size: 10 };
    pr.getCell(9).fill  = trendFill;
    pr.getCell(9).font  = { bold: true, color: WHITE, size: 10 };
    pr.getCell(10).fill = trendFill;
    pr.getCell(10).font = { color: WHITE, size: 10 };
  });

  // Footnote
  ws5.addRow([]);
  const fnRow = ws5.addRow(["* Required Daily = SAR needed per remaining day to hit 5,000 SAR target"]);
  fnRow.getCell(1).font = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
  ws5.mergeCells(`A${fnRow.number}:J${fnRow.number}`);

  return wb.xlsx.writeBuffer();
}

// ── Shared PPTX colour palette + helpers ────────────────────────────────────
const PPTX_C = {
  bg: "0D1B2A", panel: "1E2D40", accent: "4F8EF7",
  green: "22C55E", yellow: "FBBF24", red: "EF4444",
  text: "E5E7EB", muted: "94A3B8", white: "FFFFFF",
};

function pptxSlideOpts()       { return { bkgd: PPTX_C.bg }; }
function pptxDivider(slide, x, y, color) {
  slide.addShape("rect", { x, y, w: "100%", h: 0.04, fill: { color: color || PPTX_C.accent } });
}
function pptxTitle(slide, title, sub) {
  slide.addText(title, { x: 0.5, y: 0.3, w: 12, fontSize: 26, bold: true, color: PPTX_C.white });
  pptxDivider(slide, 0.5, 0.75);
  if (sub) slide.addText(sub, { x: 0.5, y: 0.9, w: 12, fontSize: 12, color: PPTX_C.muted, italic: true });
}
function statusColor(s) {
  return s === "EXCEEDING" ? PPTX_C.green : s === "ON TRACK" ? PPTX_C.accent : s === "CLOSE" ? PPTX_C.yellow : PPTX_C.red;
}

// ── PPTX: Board deck (5 slides — executive summary) ─────────────────────────
async function generateBoardPPTX(data) {
  const PptxGenJS = getPptxGenJS();
  const pptx      = new PptxGenJS();
  pptx.layout  = "LAYOUT_WIDE";
  pptx.author  = "M8 Fleet Intelligence";
  pptx.subject = `Fleet Performance — ${data.monthLabel}`;

  const C   = PPTX_C;
  const sOp = pptxSlideOpts();

  // Slide 1: Title
  const s1 = pptx.addSlide(sOp);
  s1.addShape("rect", { x: 0, y: 2.0, w: "100%", h: 0.06, fill: { color: C.accent } });
  s1.addText("Fleet Performance Report", { x: 0.8, y: 0.7, w: 11, fontSize: 40, bold: true, color: C.white });
  s1.addText(`${data.monthLabel} — MTD`, { x: 0.8, y: 1.65, w: 11, fontSize: 22, color: C.accent, bold: true });
  s1.addText([
    { text: `${data.daysElapsed} days elapsed  ·  `, options: { color: C.muted } },
    { text: `${data.daysRemaining} days remaining`, options: { color: C.yellow } },
  ], { x: 0.8, y: 2.3, w: 11, fontSize: 16 });
  s1.addText(`Generated by M8 Fleet Intelligence · ${data.generatedAt}`, { x: 0.8, y: 6.8, w: 11, fontSize: 10, color: C.muted, italic: true });

  // Slide 2: KPI Summary
  const s2 = pptx.addSlide(sOp);
  pptxTitle(s2, "KPI Summary");
  const kpis = [
    { label: "Total Fleet Net", value: `${fmtSAR(data.totalNet)} SAR`, color: C.green },
    { label: "Active Drivers",  value: `${data.rankings.length}`, color: C.accent },
    { label: "Avg per Driver",  value: `${fmtSAR(data.avgPerDriver)} SAR`, color: C.yellow },
    { label: "Days Remaining",  value: `${data.daysRemaining}`, color: C.muted },
  ];
  kpis.forEach((k, i) => {
    const x = 0.5 + i * 3.1;
    s2.addShape("rect", { x, y: 1.1, w: 2.9, h: 2.2, fill: { color: C.panel }, line: { color: C.accent, width: 1 } });
    s2.addText(k.value, { x, y: 1.4, w: 2.9, fontSize: 28, bold: true, color: k.color, align: "center" });
    s2.addText(k.label, { x, y: 2.3, w: 2.9, fontSize: 12, color: C.muted, align: "center" });
  });
  const exceed = data.rankings.filter((d) => d.status === "EXCEEDING").length;
  const onTrk  = data.rankings.filter((d) => d.status === "ON TRACK").length;
  const close  = data.rankings.filter((d) => d.status === "CLOSE").length;
  const off    = data.rankings.filter((d) => d.status === "OFF PACE").length;
  [
    { label: `Exceeding target (≥${fmtSAR(data.target * 1.1)} SAR)`, count: exceed, color: C.green },
    { label: `On pace for ${fmtSAR(data.target)} SAR target`, count: onTrk, color: C.accent },
    { label: "Close but off pace", count: close, color: C.yellow },
    { label: "Off pace", count: off, color: C.red },
  ].forEach((p, i) => {
    s2.addText(`● ${p.count} drivers — ${p.label}`, { x: 0.7, y: 3.6 + i * 0.45, w: 12, fontSize: 13, color: p.color });
  });

  // Slide 3: Driver Rankings
  const s3 = pptx.addSlide(sOp);
  pptxTitle(s3, "Driver Rankings — MTD Net Earnings");
  const show = data.rankings.slice(0, 18);
  s3.addTable([
    [
      { text: "#", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Driver", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "MTD Net (SAR)", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Days", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Projected", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Status", options: { bold: true, color: C.white, fill: C.panel } },
    ],
    ...show.map((d, i) => [
      { text: String(i + 1), options: { color: C.muted } },
      { text: d.name, options: { color: C.white } },
      { text: fmtSAR(d.net), options: { color: C.green, bold: true } },
      { text: String(d.daysWorked), options: { color: C.muted } },
      { text: fmtSAR(d.projected), options: { color: C.white } },
      { text: d.status, options: { color: statusColor(d.status), bold: true } },
    ]),
  ], { x: 0.5, y: 1.0, w: 12, colW: [0.5, 2.8, 1.8, 0.9, 1.8, 1.5], border: { color: C.panel, pt: 1 }, fill: C.bg, fontSize: 11, rowH: 0.28 });

  // Slide 4: Needs Attention
  const s4 = pptx.addSlide(sOp);
  pptxTitle(s4, "Needs Attention");
  let yPos = 1.1;
  const addAttn = (title, items, color) => {
    if (!items.length) return;
    s4.addText(title, { x: 0.5, y: yPos, w: 12, fontSize: 14, bold: true, color }); yPos += 0.4;
    for (const item of items) { s4.addText(`· ${item}`, { x: 0.8, y: yPos, w: 11.5, fontSize: 12, color: C.text }); yPos += 0.35; }
    yPos += 0.15;
  };
  addAttn("⚠ Dark — Active Earlier, Gone Last 5 Days", data.darkDrivers.map((d) => `${d.name} — ${d.daysEarlier} days, ${fmtSAR(d.net)} SAR MTD`), C.yellow);
  addAttn("📉 Close But Off Pace — Within Reach", data.rankings.filter((d) => d.status === "CLOSE").map((d) => `${d.name} — projected ${fmtSAR(d.projected)} SAR (gap: ${fmtSAR(data.target - d.net)} SAR)`), C.yellow);
  addAttn("⚡ Inconsistent — High Day-to-Day Variance", data.inconsistent.map((d) => `${d.name} — avg ${fmtSAR(d.avgNet)} SAR/day, ${d.lowDays} low days`), C.accent);
  if (yPos < 2) s4.addText("No attention flags for this period.", { x: 0.5, y: 1.1, w: 12, fontSize: 14, color: C.muted });

  // Slide 5: Recommended Actions
  const s5 = pptx.addSlide(sOp);
  pptxTitle(s5, "Recommended Actions");
  const actions = [];
  for (const d of data.darkDrivers.slice(0, 3)) actions.push({ priority: "HIGH", text: `Call ${d.name} — worked ${d.daysEarlier} days but gone 5+ days. ${fmtSAR(d.net)} SAR at risk.` });
  for (const d of data.rankings.filter((r) => r.status === "CLOSE").slice(0, 3)) {
    const gap = data.target - d.net;
    const perDay = data.daysRemaining > 0 ? Math.round(gap / data.daysRemaining) : null;
    actions.push({ priority: "MED", text: `Push ${d.name} — needs ${fmtSAR(gap)} SAR more (${data.daysRemaining} days${perDay ? `, ${fmtSAR(perDay)} SAR/day` : ""}) to hit target.` });
  }
  if (data.top3Pct >= 50) actions.push({ priority: "MED", text: `Concentration risk: top 3 = ${data.top3Pct}% of fleet net. Identify success factors and replicate.` });
  const PC = { HIGH: C.red, MED: C.yellow };
  actions.forEach((a, i) => {
    const yA = 1.1 + i * 0.9;
    s5.addShape("rect", { x: 0.5, y: yA, w: 1.1, h: 0.6, fill: { color: PC[a.priority] || C.muted } });
    s5.addText(a.priority, { x: 0.5, y: yA + 0.1, w: 1.1, fontSize: 13, bold: true, color: C.white, align: "center" });
    s5.addText(a.text, { x: 1.8, y: yA, w: 10.7, h: 0.65, fontSize: 12, color: C.text, valign: "middle" });
  });
  if (!actions.length) s5.addText("No immediate actions flagged — fleet is within normal parameters.", { x: 0.5, y: 1.5, w: 12, fontSize: 15, color: C.muted });

  return pptx.write({ outputType: "nodebuffer" });
}

// ── PPTX: Analysis deck (7 slides — deep data dive) ─────────────────────────
async function generateAnalysisPPTX(data) {
  const PptxGenJS = getPptxGenJS();
  const pptx      = new PptxGenJS();
  pptx.layout  = "LAYOUT_WIDE";
  pptx.author  = "M8 Fleet Intelligence";
  pptx.subject = `Fleet Analysis — ${data.monthLabel}`;

  const C = PPTX_C;
  const sOp = pptxSlideOpts();

  // Slide 1: Title
  const s1 = pptx.addSlide(sOp);
  s1.addShape("rect", { x: 0, y: 2.0, w: "100%", h: 0.06, fill: { color: C.accent } });
  s1.addText("Fleet Performance Analysis", { x: 0.8, y: 0.7, w: 11, fontSize: 38, bold: true, color: C.white });
  s1.addText(`${data.monthLabel} — Data Deep Dive`, { x: 0.8, y: 1.65, w: 11, fontSize: 20, color: C.accent, bold: true });
  s1.addText(`${data.daysElapsed} days tracked · ${data.rankings.length} active drivers · Generated ${data.generatedAt}`, { x: 0.8, y: 2.3, w: 11, fontSize: 13, color: C.muted });

  // Slide 2: Fleet Health Scorecard
  const s2 = pptx.addSlide(sOp);
  pptxTitle(s2, "Fleet Health Scorecard");
  const metrics = [
    { label: "Total Fleet Net", value: `${fmtSAR(data.totalNet)} SAR`, sub: `${data.daysElapsed} days elapsed`, color: C.green },
    { label: "Fleet Average",   value: `${fmtSAR(data.avgPerDriver)} SAR`, sub: "per active driver", color: C.accent },
    { label: "Top-3 Share",     value: `${data.top3Pct}%`, sub: `of total (${fmtSAR(data.top3Net)} SAR)`, color: data.top3Pct >= 50 ? C.yellow : C.green },
    { label: "Days Remaining",  value: `${data.daysRemaining}`, sub: `of ${data.daysInMonth} in ${data.monthLabel}`, color: C.muted },
  ];
  metrics.forEach((k, i) => {
    const x = 0.4 + i * 3.15;
    s2.addShape("rect", { x, y: 1.1, w: 2.9, h: 2.4, fill: { color: C.panel }, line: { color: C.accent, width: 1 } });
    s2.addText(k.value, { x, y: 1.35, w: 2.9, fontSize: 30, bold: true, color: k.color, align: "center" });
    s2.addText(k.label, { x, y: 2.2, w: 2.9, fontSize: 12, color: C.white, align: "center", bold: true });
    s2.addText(k.sub, { x, y: 2.6, w: 2.9, fontSize: 10, color: C.muted, align: "center" });
  });
  // Pace summary strip
  s2.addText("Pace Distribution:", { x: 0.5, y: 3.75, w: 12, fontSize: 14, bold: true, color: C.white });
  const paceItems2 = [
    { label: "Exceeding", count: data.rankings.filter((d) => d.status === "EXCEEDING").length, color: C.green },
    { label: "On Track",  count: data.rankings.filter((d) => d.status === "ON TRACK").length,  color: C.accent },
    { label: "Close",     count: data.rankings.filter((d) => d.status === "CLOSE").length,      color: C.yellow },
    { label: "Off Pace",  count: data.rankings.filter((d) => d.status === "OFF PACE").length,   color: C.red },
  ];
  paceItems2.forEach((p, i) => {
    const x2 = 0.5 + i * 3.15;
    s2.addShape("rect", { x: x2, y: 4.15, w: 2.9, h: 1.0, fill: { color: C.panel } });
    s2.addText(String(p.count), { x: x2, y: 4.25, w: 2.9, fontSize: 26, bold: true, color: p.color, align: "center" });
    s2.addText(p.label, { x: x2, y: 4.75, w: 2.9, fontSize: 11, color: C.muted, align: "center" });
  });

  // Slide 3: Full Driver Rankings
  const s3 = pptx.addSlide(sOp);
  pptxTitle(s3, "Driver Rankings — Complete MTD Table", `All ${data.rankings.length} active drivers by net earnings`);
  const showAll = data.rankings.slice(0, 20);
  s3.addTable([
    [
      { text: "#",      options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Driver", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "MTD Net", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Days",   options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Daily Avg", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Projected", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Status", options: { bold: true, color: C.white, fill: C.panel } },
    ],
    ...showAll.map((d, i) => [
      { text: String(i + 1), options: { color: C.muted } },
      { text: d.name, options: { color: C.white } },
      { text: fmtSAR(d.net), options: { color: C.green, bold: true } },
      { text: String(d.daysWorked), options: { color: C.muted } },
      { text: fmtSAR(d.calAvgPerDay), options: { color: C.text } },
      { text: fmtSAR(d.projected), options: { color: C.white } },
      { text: d.status, options: { color: statusColor(d.status), bold: true } },
    ]),
  ], { x: 0.5, y: 1.2, w: 12.3, colW: [0.45, 2.6, 1.7, 0.75, 1.5, 1.7, 1.6], border: { color: C.panel, pt: 1 }, fill: C.bg, fontSize: 10, rowH: 0.26 });

  // Slide 4: Pace Analysis
  const s4 = pptx.addSlide(sOp);
  pptxTitle(s4, "Pace Analysis — Who Hits 5,000 SAR?");
  const onAndAbove = data.rankings.filter((d) => d.status === "ON TRACK" || d.status === "EXCEEDING");
  const closeDrivers = data.rankings.filter((d) => d.status === "CLOSE");
  const offDrivers   = data.rankings.filter((d) => d.status === "OFF PACE");
  let y4 = 1.2;
  const addPaceGroup = (title, drivers, color) => {
    if (!drivers.length) return;
    s4.addShape("rect", { x: 0.5, y: y4, w: 12.3, h: 0.35, fill: { color: C.panel } });
    s4.addText(`${title} (${drivers.length} drivers)`, { x: 0.6, y: y4 + 0.06, w: 12, fontSize: 13, bold: true, color });
    y4 += 0.35;
    for (const d of drivers.slice(0, 6)) {
      const gap = data.target - d.net;
      const perDay = data.daysRemaining > 0 ? Math.round(Math.max(0, gap) / data.daysRemaining) : 0;
      const detail = d.status === "EXCEEDING"
        ? `proj. ${fmtSAR(d.projected)} SAR — ahead by ${fmtSAR(d.projected - data.target)} SAR`
        : `needs ${fmtSAR(Math.max(0, gap))} SAR more — ${fmtSAR(perDay)} SAR/day for ${data.daysRemaining} days`;
      s4.addText(`• ${d.name} — ${fmtSAR(d.net)} SAR MTD  |  ${detail}`, { x: 0.8, y: y4, w: 12, fontSize: 11, color: C.text });
      y4 += 0.32;
    }
    if (drivers.length > 6) { s4.addText(`  … and ${drivers.length - 6} more`, { x: 0.8, y: y4, w: 12, fontSize: 10, color: C.muted }); y4 += 0.28; }
    y4 += 0.1;
  };
  addPaceGroup("✅ On Track / Exceeding", onAndAbove, C.green);
  addPaceGroup("⚠ Close — Within Reach", closeDrivers, C.yellow);
  addPaceGroup("❌ Off Pace", offDrivers.slice(0, 4), C.red);

  // Slide 5: Trend Analysis
  const s5 = pptx.addSlide(sOp);
  pptxTitle(s5, "Trend Analysis — First Half vs Second Half");
  if (data.trendByName.size) {
    const trendRows = [];
    for (const d of data.rankings.slice(0, 15)) {
      const t = data.trendByName.get(d.name);
      if (!t) continue;
      const dir    = t.delta >= 5 ? "▲ RISING" : t.delta <= -5 ? "▼ FALLING" : "→ FLAT";
      const dColor = t.delta >= 5 ? C.green : t.delta <= -5 ? C.red : C.muted;
      trendRows.push([
        { text: d.name, options: { color: C.white } },
        { text: fmtSAR(d.net), options: { color: C.green } },
        { text: fmtSAR(t.earlyAvg), options: { color: C.text } },
        { text: fmtSAR(t.lateAvg), options: { color: C.text } },
        { text: `${t.delta > 0 ? "+" : ""}${t.delta}%`, options: { color: dColor, bold: true } },
        { text: dir, options: { color: dColor, bold: true } },
      ]);
    }
    if (trendRows.length) {
      s5.addTable([
        [
          { text: "Driver",      options: { bold: true, color: C.white, fill: C.panel } },
          { text: "MTD Net",     options: { bold: true, color: C.white, fill: C.panel } },
          { text: "Early Avg",   options: { bold: true, color: C.white, fill: C.panel } },
          { text: "Late Avg",    options: { bold: true, color: C.white, fill: C.panel } },
          { text: "Change",      options: { bold: true, color: C.white, fill: C.panel } },
          { text: "Trend",       options: { bold: true, color: C.white, fill: C.panel } },
        ],
        ...trendRows,
      ], { x: 0.5, y: 1.2, w: 12.3, colW: [2.8, 1.7, 1.7, 1.7, 1.5, 1.8], border: { color: C.panel, pt: 1 }, fill: C.bg, fontSize: 11, rowH: 0.29 });
    }
    s5.addText("Early avg = first 7 days · Late avg = last 7 days · Requires ≥10 days of data", { x: 0.5, y: 6.6, w: 12, fontSize: 9, color: C.muted, italic: true });
  } else {
    s5.addText("Trend data not yet available — requires at least 10 days of data in this period.", { x: 0.5, y: 2.5, w: 12, fontSize: 14, color: C.muted });
  }

  // Slide 6: Anomalies
  const s6 = pptx.addSlide(sOp);
  pptxTitle(s6, "Anomaly Detection — Flags & Concerns");
  let y6 = 1.2;
  const addAnomalyBlock = (title, items, color) => {
    if (!items.length) return;
    s6.addText(title, { x: 0.5, y: y6, w: 12, fontSize: 14, bold: true, color }); y6 += 0.4;
    for (const item of items) { s6.addText(`· ${item}`, { x: 0.8, y: y6, w: 11.5, fontSize: 12, color: C.text }); y6 += 0.35; }
    y6 += 0.15;
  };
  addAnomalyBlock("🌑 Dark Drivers — Went Quiet", data.darkDrivers.map((d) => `${d.name}: ${d.daysEarlier} days active, absent last 5 · ${fmtSAR(d.net)} SAR MTD`), C.yellow);
  addAnomalyBlock("⚡ Inconsistent Earners — High Variance", data.inconsistent.map((d) => `${d.name}: avg ${fmtSAR(d.avgNet)} SAR/day, ${d.lowDays} days below 150 SAR · CV=${d.cv}`), C.accent);
  if (data.top3Pct >= 50) {
    addAnomalyBlock("⚠ Concentration Risk", [`Top 3 drivers account for ${data.top3Pct}% of fleet net (${fmtSAR(data.top3Net)} SAR). Fleet resilience depends heavily on a small group.`], C.red);
  }
  if (y6 < 2) s6.addText("No anomalies detected in this period.", { x: 0.5, y: 1.5, w: 12, fontSize: 14, color: C.muted });

  // Slide 7: Key Findings
  const s7 = pptx.addSlide(sOp);
  pptxTitle(s7, "Key Findings & Conclusions");
  const findings = [];
  const paceRate = Math.round((data.rankings.filter((d) => d.status === "ON TRACK" || d.status === "EXCEEDING").length / Math.max(1, data.rankings.length)) * 100);
  findings.push({ color: paceRate >= 60 ? C.green : C.yellow, text: `${paceRate}% of active drivers are on pace or exceeding the 5,000 SAR monthly target.` });
  if (data.darkDrivers.length) findings.push({ color: C.yellow, text: `${data.darkDrivers.length} driver(s) went dark after earlier activity — immediate outreach recommended.` });
  if (data.inconsistent.length) findings.push({ color: C.accent, text: `${data.inconsistent.length} driver(s) show high day-to-day variance — investigate scheduling or motivation.` });
  if (data.top3Pct >= 50) findings.push({ color: C.red, text: `Top-3 concentration at ${data.top3Pct}% — fleet output is fragile. Diversify high performance.` });
  const dailyFleetAvg = data.daysElapsed > 0 ? Math.round(data.totalNet / data.daysElapsed) : 0;
  findings.push({ color: C.text, text: `Fleet-wide daily average: ${fmtSAR(dailyFleetAvg)} SAR/day · ${data.daysRemaining} days remain to close the month.` });
  findings.forEach((f, i) => {
    s7.addShape("rect", { x: 0.5, y: 1.1 + i * 0.95, w: 0.12, h: 0.55, fill: { color: f.color } });
    s7.addText(f.text, { x: 0.75, y: 1.1 + i * 0.95, w: 12, h: 0.6, fontSize: 13, color: C.text, valign: "middle" });
  });
  s7.addText(`Generated by M8 Fleet Intelligence · ${data.generatedAt}`, { x: 0.5, y: 6.8, w: 12, fontSize: 9, color: C.muted, italic: true });

  return pptx.write({ outputType: "nodebuffer" });
}

// ── PPTX: Operational deck (6 slides — action-first, ops manager) ────────────
async function generateOperationalPPTX(data) {
  const PptxGenJS = getPptxGenJS();
  const pptx      = new PptxGenJS();
  pptx.layout  = "LAYOUT_WIDE";
  pptx.author  = "M8 Fleet Intelligence";
  pptx.subject = `Fleet Ops Brief — ${data.monthLabel}`;

  const C = PPTX_C;
  const sOp = pptxSlideOpts();

  // Slide 1: Title
  const s1 = pptx.addSlide(sOp);
  s1.addShape("rect", { x: 0, y: 2.0, w: "100%", h: 0.06, fill: { color: C.green } });
  s1.addText("Fleet Daily Ops Brief", { x: 0.8, y: 0.7, w: 11, fontSize: 40, bold: true, color: C.white });
  s1.addText(`${data.monthLabel} — Action Summary`, { x: 0.8, y: 1.65, w: 11, fontSize: 22, color: C.green, bold: true });
  s1.addText(`${data.daysElapsed} of ${data.daysInMonth} days  ·  ${data.rankings.length} active drivers  ·  ${data.daysRemaining} days to close`, { x: 0.8, y: 2.3, w: 11, fontSize: 14, color: C.muted });
  s1.addText(`Generated by M8 Fleet Intelligence · ${data.generatedAt}`, { x: 0.8, y: 6.8, w: 11, fontSize: 10, color: C.muted, italic: true });

  // Slide 2: Priority Actions — who to call today
  const s2 = pptx.addSlide(sOp);
  pptxTitle(s2, "Priority Actions — Today's Call List", "Highest-impact contacts");
  const actions = [];
  for (const d of data.darkDrivers.slice(0, 4)) {
    actions.push({ priority: "HIGH", color: C.red, text: `Call ${d.name} · gone ${d.daysEarlier > 0 ? "5+" : ""} days · ${fmtSAR(d.net)} SAR MTD — re-engage immediately` });
  }
  for (const d of data.rankings.filter((r) => r.status === "CLOSE").slice(0, 4)) {
    const gap = data.target - d.net;
    const perDay = data.daysRemaining > 0 ? Math.round(gap / data.daysRemaining) : 0;
    actions.push({ priority: "PUSH", color: C.yellow, text: `Push ${d.name} · gap ${fmtSAR(gap)} SAR · needs ${fmtSAR(perDay)} SAR/day · ${data.daysRemaining} days left` });
  }
  if (!actions.length) {
    s2.addText("No priority call actions flagged — fleet is running within normal parameters.", { x: 0.5, y: 2.5, w: 12, fontSize: 14, color: C.muted });
  } else {
    actions.forEach((a, i) => {
      const yA = 1.2 + i * 0.85;
      s2.addShape("rect", { x: 0.5, y: yA, w: 1.3, h: 0.6, fill: { color: a.color } });
      s2.addText(a.priority, { x: 0.5, y: yA + 0.12, w: 1.3, fontSize: 13, bold: true, color: C.white, align: "center" });
      s2.addText(a.text, { x: 2.0, y: yA, w: 11, h: 0.65, fontSize: 12, color: C.text, valign: "middle" });
    });
  }

  // Slide 3: Chase List — close to target
  const s3 = pptx.addSlide(sOp);
  pptxTitle(s3, "Chase List — Close to 5,000 SAR Target", "Within reach with a push");
  const chaseDrivers = data.rankings.filter((d) => d.status === "CLOSE" || d.status === "ON TRACK" || d.status === "EXCEEDING");
  if (chaseDrivers.length) {
    s3.addTable([
      [
        { text: "Driver",       options: { bold: true, color: C.white, fill: C.panel } },
        { text: "MTD Net",      options: { bold: true, color: C.white, fill: C.panel } },
        { text: "Gap to 5K",    options: { bold: true, color: C.white, fill: C.panel } },
        { text: "Days Rem",     options: { bold: true, color: C.white, fill: C.panel } },
        { text: "Need/Day",     options: { bold: true, color: C.white, fill: C.panel } },
        { text: "Projected",    options: { bold: true, color: C.white, fill: C.panel } },
        { text: "Status",       options: { bold: true, color: C.white, fill: C.panel } },
      ],
      ...chaseDrivers.slice(0, 15).map((d) => {
        const gap = Math.max(0, data.target - d.net);
        const perDay = gap > 0 && data.daysRemaining > 0 ? Math.round(gap / data.daysRemaining) : 0;
        return [
          { text: d.name, options: { color: C.white } },
          { text: fmtSAR(d.net), options: { color: C.green, bold: true } },
          { text: gap > 0 ? fmtSAR(gap) : "—", options: { color: gap > 0 ? C.yellow : C.green } },
          { text: String(data.daysRemaining), options: { color: C.muted } },
          { text: perDay > 0 ? fmtSAR(perDay) : "—", options: { color: perDay > 0 ? C.yellow : C.green } },
          { text: fmtSAR(d.projected), options: { color: C.white } },
          { text: d.status, options: { color: statusColor(d.status), bold: true } },
        ];
      }),
    ], { x: 0.5, y: 1.2, w: 12.3, colW: [2.5, 1.6, 1.5, 1.2, 1.5, 1.7, 1.5], border: { color: C.panel, pt: 1 }, fill: C.bg, fontSize: 11, rowH: 0.29 });
  } else {
    s3.addText("No drivers in the 'close to target' range this period.", { x: 0.5, y: 2.5, w: 12, fontSize: 14, color: C.muted });
  }

  // Slide 4: Missing & Inconsistent Drivers
  const s4 = pptx.addSlide(sOp);
  pptxTitle(s4, "Flags — Missing & Inconsistent Drivers");
  let y4 = 1.2;
  if (data.darkDrivers.length) {
    s4.addText(`🌑 Missing Drivers (${data.darkDrivers.length}) — Active Earlier, Absent Last 5 Days`, { x: 0.5, y: y4, w: 12.3, fontSize: 14, bold: true, color: C.yellow });
    y4 += 0.4;
    for (const d of data.darkDrivers) {
      s4.addText(`· ${d.name} — worked ${d.daysEarlier} day(s), ${fmtSAR(d.net)} SAR MTD · Status: CALL`, { x: 0.8, y: y4, w: 12, fontSize: 12, color: C.text });
      y4 += 0.35;
    }
    y4 += 0.15;
  }
  if (data.inconsistent.length) {
    s4.addText(`⚡ Inconsistent Earners (${data.inconsistent.length}) — High Day-to-Day Variance`, { x: 0.5, y: y4, w: 12.3, fontSize: 14, bold: true, color: C.accent });
    y4 += 0.4;
    for (const d of data.inconsistent) {
      s4.addText(`· ${d.name} — avg ${fmtSAR(d.avgNet)} SAR/day, ${d.lowDays} low days · Coach on consistency`, { x: 0.8, y: y4, w: 12, fontSize: 12, color: C.text });
      y4 += 0.35;
    }
  }
  if (!data.darkDrivers.length && !data.inconsistent.length) {
    s4.addText("No missing or inconsistent drivers flagged in this period.", { x: 0.5, y: 2.5, w: 12, fontSize: 14, color: C.muted });
  }

  // Slide 5: Driver Status Overview (compact table)
  const s5 = pptx.addSlide(sOp);
  pptxTitle(s5, "Driver Status Overview", "All active drivers · sorted by MTD net");
  s5.addTable([
    [
      { text: "#", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Driver", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "MTD Net", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Days", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Projected", options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Status", options: { bold: true, color: C.white, fill: C.panel } },
    ],
    ...data.rankings.slice(0, 20).map((d, i) => [
      { text: String(i + 1), options: { color: C.muted } },
      { text: d.name, options: { color: C.white } },
      { text: fmtSAR(d.net), options: { color: C.green } },
      { text: String(d.daysWorked), options: { color: C.muted } },
      { text: fmtSAR(d.projected), options: { color: C.text } },
      { text: d.status, options: { color: statusColor(d.status), bold: true } },
    ]),
  ], { x: 0.5, y: 1.2, w: 12.3, colW: [0.45, 3.0, 1.7, 0.85, 1.8, 1.6], border: { color: C.panel, pt: 1 }, fill: C.bg, fontSize: 10, rowH: 0.26 });

  // Slide 6: Tomorrow's Focus
  const s6 = pptx.addSlide(sOp);
  pptxTitle(s6, "Tomorrow's Focus", `${data.daysRemaining} days remaining in ${data.monthLabel}`);
  const focus = [];
  const offPaceCount = data.rankings.filter((d) => d.status === "OFF PACE").length;
  const closeCount   = data.rankings.filter((d) => d.status === "CLOSE").length;
  if (data.darkDrivers.length) focus.push({ icon: "📞", text: `Follow up on ${data.darkDrivers.length} dark driver(s): ${data.darkDrivers.map((d) => d.name).join(", ")}` });
  if (closeCount) focus.push({ icon: "🎯", text: `Coach ${closeCount} close-to-target driver(s) — small daily push can close the gap in ${data.daysRemaining} days` });
  if (offPaceCount) focus.push({ icon: "⚠", text: `Monitor ${offPaceCount} off-pace driver(s) — assess if gap is closable or plan recovery for next month` });
  if (data.inconsistent.length) focus.push({ icon: "📋", text: `Check schedules for ${data.inconsistent.length} inconsistent earner(s) — confirm they have regular shift coverage` });
  const fleetDailyAvg = data.daysElapsed > 0 ? Math.round(data.totalNet / data.daysElapsed) : 0;
  focus.push({ icon: "📈", text: `Fleet running at ${fmtSAR(fleetDailyAvg)} SAR/day average — needed pace: ${fmtSAR(Math.round((data.target * data.rankings.length - data.totalNet) / Math.max(1, data.daysRemaining)))} SAR/day total` });
  focus.forEach((f, i) => {
    s6.addText(f.icon, { x: 0.5, y: 1.2 + i * 0.9, w: 0.6, fontSize: 22, align: "center" });
    s6.addText(f.text, { x: 1.2, y: 1.2 + i * 0.9, w: 11.5, h: 0.7, fontSize: 13, color: C.text, valign: "middle" });
  });

  return pptx.write({ outputType: "nodebuffer" });
}

// ── PPTX generator (legacy alias → Board deck) ───────────────────────────────
async function generatePPTX(data) {
  const PptxGenJS = getPptxGenJS();
  const pptx      = new PptxGenJS();

  pptx.layout  = "LAYOUT_WIDE";
  pptx.author  = "M8 Fleet Intelligence";
  pptx.subject = `Fleet Performance — ${data.monthLabel}`;

  const C = {
    bg:      "0D1B2A",
    panel:   "1E2D40",
    accent:  "4F8EF7",
    green:   "22C55E",
    yellow:  "FBBF24",
    red:     "EF4444",
    text:    "E5E7EB",
    muted:   "94A3B8",
    white:   "FFFFFF",
  };
  const slideOpts = { bkgd: C.bg };

  // ── Slide 1: Title ─────────────────────────────────────────────────────────
  const s1 = pptx.addSlide(slideOpts);
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 2.0, w: "100%", h: 0.06, fill: { color: C.accent } });
  s1.addText("Fleet Performance Report", { x: 0.8, y: 0.7, w: 11, fontSize: 40, bold: true, color: C.white });
  s1.addText(`${data.monthLabel} — MTD`, {
    x: 0.8, y: 1.65, w: 11, fontSize: 22, color: C.accent, bold: true,
  });
  s1.addText([
    { text: `${data.daysElapsed} days elapsed  ·  `, options: { color: C.muted } },
    { text: `${data.daysRemaining} days remaining`, options: { color: C.yellow } },
  ], { x: 0.8, y: 2.3, w: 11, fontSize: 16 });
  s1.addText(`Generated by M8 Fleet Intelligence · ${data.generatedAt}`, {
    x: 0.8, y: 6.8, w: 11, fontSize: 10, color: C.muted, italic: true,
  });

  // ── Slide 2: KPI Summary ───────────────────────────────────────────────────
  const s2 = pptx.addSlide(slideOpts);
  s2.addText("KPI Summary", { x: 0.5, y: 0.3, w: 12, fontSize: 26, bold: true, color: C.white });
  s2.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.75, w: 12, h: 0.04, fill: { color: C.accent } });

  const kpis = [
    { label: "Total Fleet Net", value: `${fmtSAR(data.totalNet)} SAR`, color: C.green },
    { label: "Active Drivers",  value: `${data.rankings.length}`,       color: C.accent },
    { label: "Avg per Driver",  value: `${fmtSAR(data.avgPerDriver)} SAR`, color: C.yellow },
    { label: "Days Remaining",  value: `${data.daysRemaining}`,          color: C.muted },
  ];
  kpis.forEach((k, i) => {
    const x = 0.5 + i * 3.1;
    s2.addShape(pptx.ShapeType.rect, { x, y: 1.1, w: 2.9, h: 2.2, fill: { color: C.panel }, line: { color: C.accent, width: 1 } });
    s2.addText(k.value, { x, y: 1.4, w: 2.9, fontSize: 28, bold: true, color: k.color, align: "center" });
    s2.addText(k.label, { x, y: 2.3, w: 2.9, fontSize: 12, color: C.muted, align: "center" });
  });

  // pace summary bar
  const exceed = data.rankings.filter((d) => d.status === "EXCEEDING").length;
  const onTrk  = data.rankings.filter((d) => d.status === "ON TRACK").length;
  const close  = data.rankings.filter((d) => d.status === "CLOSE").length;
  const off    = data.rankings.filter((d) => d.status === "OFF PACE").length;
  const paceItems = [
    { label: `Exceeding target (≥${fmtSAR(data.target * 1.1)} SAR)`, count: exceed, color: C.green },
    { label: `On pace for ${fmtSAR(data.target)} SAR target`,         count: onTrk,  color: C.accent },
    { label: "Close but off pace",                                      count: close,  color: C.yellow },
    { label: "Off pace",                                                count: off,    color: C.red },
  ];
  s2.addText("Pace to 5,000 SAR Target:", { x: 0.5, y: 3.6, w: 12, fontSize: 16, bold: true, color: C.white });
  paceItems.forEach((p, i) => {
    s2.addText(`● ${p.count} drivers — ${p.label}`, { x: 0.7, y: 4.0 + i * 0.45, w: 12, fontSize: 13, color: p.color });
  });

  // ── Slide 3: Driver Rankings ───────────────────────────────────────────────
  const s3 = pptx.addSlide(slideOpts);
  s3.addText("Driver Rankings — MTD Net Earnings", { x: 0.5, y: 0.3, w: 12, fontSize: 26, bold: true, color: C.white });
  s3.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.75, w: 12, h: 0.04, fill: { color: C.accent } });

  const show = data.rankings.slice(0, 18);
  const tblRows = [
    [
      { text: "#",            options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Driver",       options: { bold: true, color: C.white, fill: C.panel } },
      { text: "MTD Net (SAR)",options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Days",         options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Projected",    options: { bold: true, color: C.white, fill: C.panel } },
      { text: "Status",       options: { bold: true, color: C.white, fill: C.panel } },
    ],
    ...show.map((d, i) => {
      const sc = d.status === "EXCEEDING" ? C.green : d.status === "ON TRACK" ? C.accent : d.status === "CLOSE" ? C.yellow : C.red;
      return [
        { text: String(i + 1),            options: { color: C.muted } },
        { text: d.name,                   options: { color: C.white } },
        { text: fmtSAR(d.net),            options: { color: C.green, bold: true } },
        { text: String(d.daysWorked),     options: { color: C.muted } },
        { text: fmtSAR(d.projected),      options: { color: C.white } },
        { text: d.status,                 options: { color: sc, bold: true } },
      ];
    }),
  ];
  s3.addTable(tblRows, {
    x: 0.5, y: 1.0, w: 12,
    colW: [0.5, 2.8, 1.8, 0.9, 1.8, 1.5],
    border: { color: C.panel, pt: 1 },
    fill: C.bg,
    fontSize: 11,
    rowH: 0.28,
  });

  // ── Slide 4: Needs Attention ───────────────────────────────────────────────
  const s4 = pptx.addSlide(slideOpts);
  s4.addText("Needs Attention", { x: 0.5, y: 0.3, w: 12, fontSize: 26, bold: true, color: C.white });
  s4.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.75, w: 12, h: 0.04, fill: { color: C.red } });

  let yPos = 1.1;
  const addAttentionSection = (title, items, color) => {
    if (!items.length) return;
    s4.addText(title, { x: 0.5, y: yPos, w: 12, fontSize: 14, bold: true, color }); yPos += 0.4;
    for (const item of items) {
      s4.addText(`· ${item}`, { x: 0.8, y: yPos, w: 11.5, fontSize: 12, color: C.text }); yPos += 0.35;
    }
    yPos += 0.15;
  };

  addAttentionSection(
    "⚠ DARK — Active Earlier, Gone Last 5 Days",
    data.darkDrivers.map((d) => `${d.name} — ${d.daysEarlier} days worked, ${fmtSAR(d.net)} SAR MTD`),
    C.yellow,
  );
  addAttentionSection(
    "📉 CLOSE BUT OFF PACE — Within Reach of 5,000 SAR",
    data.rankings.filter((d) => d.status === "CLOSE").map((d) => `${d.name} — projected ${fmtSAR(d.projected)} SAR (gap: ${fmtSAR(data.target - d.net)} SAR)`),
    C.yellow,
  );
  addAttentionSection(
    "⚡ INCONSISTENT — High Day-to-Day Variance",
    data.inconsistent.map((d) => `${d.name} — avg ${fmtSAR(d.avgNet)} SAR/day, ${d.lowDays} low days`),
    C.accent,
  );
  if (yPos < 2) s4.addText("No attention flags for this period.", { x: 0.5, y: 1.1, w: 12, fontSize: 14, color: C.muted });

  // ── Slide 5: Recommended Actions ─────────────────────────────────────────
  const s5 = pptx.addSlide(slideOpts);
  s5.addText("Recommended Actions", { x: 0.5, y: 0.3, w: 12, fontSize: 26, bold: true, color: C.white });
  s5.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.75, w: 12, h: 0.04, fill: { color: C.green } });

  const actions = [];
  for (const d of data.darkDrivers.slice(0, 3)) {
    actions.push({ priority: "HIGH", text: `Call ${d.name} — worked ${d.daysEarlier} days but gone for 5+ days. ${fmtSAR(d.net)} SAR at risk of being their last MTD figure.` });
  }
  for (const d of data.rankings.filter((r) => r.status === "CLOSE").slice(0, 3)) {
    const gap    = data.target - d.net;
    const perDay = data.daysRemaining > 0 ? Math.round(gap / data.daysRemaining) : null;
    actions.push({ priority: "MED", text: `Push ${d.name} — needs ${fmtSAR(gap)} SAR more over ${data.daysRemaining} days${perDay ? ` (${fmtSAR(perDay)} SAR/day)` : ""} to hit target.` });
  }
  if (data.top3Pct >= 50) {
    actions.push({ priority: "MED", text: `Concentration risk: top 3 drivers = ${data.top3Pct}% of fleet net. Consider what makes them succeed and replicate it.` });
  }

  const PRIORITY_COLOR = { HIGH: C.red, MED: C.yellow };
  actions.forEach((a, i) => {
    const yA = 1.1 + i * 0.9;
    s5.addShape(pptx.ShapeType.rect, { x: 0.5, y: yA, w: 1.1, h: 0.6, fill: { color: PRIORITY_COLOR[a.priority] || C.muted } });
    s5.addText(a.priority, { x: 0.5, y: yA + 0.1, w: 1.1, fontSize: 13, bold: true, color: C.white, align: "center" });
    s5.addText(a.text, { x: 1.8, y: yA, w: 10.7, h: 0.65, fontSize: 12, color: C.text, valign: "middle" });
  });
  if (!actions.length) {
    s5.addText("No immediate actions flagged — fleet is performing within normal parameters.", { x: 0.5, y: 1.5, w: 12, fontSize: 15, color: C.muted });
  }

  return pptx.write({ outputType: "nodebuffer" });
}

// ── HTTP handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const format = (req.query.format || "xlsx").toLowerCase();
  if (!["xlsx", "pptx"].includes(format)) {
    return res.status(400).json({ error: "format must be xlsx or pptx" });
  }

  try {
    const record = await getFleetRecord();
    if (!record) return res.status(503).json({ error: "Fleet data unavailable" });
    const entries = decodeHistory(record);
    if (!entries.length) return res.status(503).json({ error: "No fleet history" });

    const data = buildReportData(entries);
    if (!data) return res.status(503).json({ error: "No data for current month" });

    const month = data.monthLabel.replace(" ", "-");

    if (format === "xlsx") {
      const buf = await generateXLSX(data);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="fleet-report-${month}.xlsx"`);
      return res.status(200).send(Buffer.from(buf));
    }

    if (format === "pptx") {
      const deckType = (req.query.type || "board").toLowerCase();
      const generators = { analysis: generateAnalysisPPTX, board: generateBoardPPTX, operational: generateOperationalPPTX };
      const generator  = generators[deckType] || generateBoardPPTX;
      const buf = await generator(data);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="fleet-deck-${deckType}-${month}.pptx"`);
      return res.status(200).send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }
  } catch (err) {
    console.error("[M8 fleet-export] error:", err.message);
    return res.status(500).json({ error: "Export failed", detail: err.message });
  }
};
