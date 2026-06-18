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

const { getFleetRecord, decodeHistory } = require("../lib/fleet");

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

  // Inconsistency detection
  const byName = new Map();
  for (const i of monthIndices) {
    for (const d of (entries[i].drivers || [])) {
      if (!d.isActive || !d.name) continue;
      const nm = d.name.trim();
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm).push(d.netEarnings || 0);
    }
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

  const generatedAt = new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });

  return {
    monthLabel, daysElapsed, daysRemaining, daysInMonth,
    totalNet, avgPerDriver, top3Pct, top3Net,
    rankings, darkDrivers: darkDrivers.slice(0, 5),
    inconsistent: inconsistent.slice(0, 3),
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

  return wb.xlsx.writeBuffer();
}

// ── PPTX generator ───────────────────────────────────────────────────────────
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
      const buf = await generatePPTX(data);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="fleet-report-${month}.pptx"`);
      return res.status(200).send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }
  } catch (err) {
    console.error("[M8 fleet-export] error:", err.message);
    return res.status(500).json({ error: "Export failed", detail: err.message });
  }
};
