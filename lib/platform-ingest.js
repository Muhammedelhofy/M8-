/**
 * M8 Track-A — lib/platform-ingest.js  (Build-93)
 *
 * The parse + merge layer for multi-platform driver earnings. Takes a raw CSV
 * export from any one platform and turns it into normalized rows (via
 * lib/platform-schemas.js), then merges rows from several platforms into one
 * per-driver view so a driver who runs Bolt AND HungerStation shows up once with
 * a combined total.
 *
 * Every export fails SAFE: parseCSV NEVER throws — on an unknown platform or a
 * malformed CSV it console.warns and returns []. This module does NO IO and NO
 * LLM calls; it is pure transformation so it is trivially testable offline.
 */
const { PLATFORM_SCHEMAS, normalizeRow, platformLabel } = require("./platform-schemas");

function pickDelimiter(headerLine) {
  const candidates = [",", ";", "\t"];
  let best = ",", bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

// Quote-aware single-line split. Handles "a,b" quoted fields and "" escapes.
// Never throws on ordinary text.
function splitDelimited(line, delim) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCSVText(text) {
  const clean = String(text).replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n").filter((l) => l.length > 0);
  if (!lines.length) return [];
  const delim = pickDelimiter(lines[0]);
  return lines.map((l) => splitDelimited(l, delim));
}

/**
 * Parse a platform CSV into normalized rows. Returns [] (with a console.warn)
 * on unknown platform or malformed/empty CSV. NEVER throws.
 * @param {string} csvText
 * @param {string} platform - a PLATFORM_SCHEMAS key
 * @returns {Array<object>} normalized rows (those with a non-empty driverName)
 */
function parseCSV(csvText, platform) {
  try {
    if (!PLATFORM_SCHEMAS[platform]) {
      console.warn(`[platform-ingest] unknown platform: ${platform}`);
      return [];
    }
    if (typeof csvText !== "string" || !csvText.trim()) {
      console.warn(`[platform-ingest] empty/invalid CSV for platform: ${platform}`);
      return [];
    }
    const rows = parseCSVText(csvText);
    if (rows.length < 2) {
      console.warn(`[platform-ingest] no data rows for platform: ${platform}`);
      return [];
    }
    const headers = rows[0];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells.length || cells.every((c) => c === "")) continue;
      const rawRow = {};
      for (let j = 0; j < headers.length; j++) rawRow[headers[j]] = cells[j] != null ? cells[j] : "";
      const norm = normalizeRow(rawRow, platform);
      if (norm && norm.driverName) out.push(norm);
    }
    return out;
  } catch (err) {
    console.warn(`[platform-ingest] parse error for platform ${platform}: ${err && err.message}`);
    return [];
  }
}

/**
 * Merge normalized rows from multiple platforms into one per-driver view.
 * Accepts an array of row-arrays (one per platform) OR a flat array of rows.
 * Groups by driverName (case-insensitive).
 * @param {Array} rowArrays
 * @returns {{ byDriver: object, summary: object }}
 *   byDriver[name] = { name, platforms:[...], totalGross, totalTrips, byPlatform }
 *   summary = { platforms:{[p]:{label,unitLabel,drivers,trips,gross}},
 *               platformCount, driverCount, totalGross, totalTrips }
 */
function mergePlatformData(rowArrays) {
  const flat = [];
  for (const item of (Array.isArray(rowArrays) ? rowArrays : [])) {
    if (Array.isArray(item)) { for (const r of item) if (r) flat.push(r); }
    else if (item && typeof item === "object") flat.push(item);
  }

  const byDriver = {};
  const platAgg = {};
  for (const r of flat) {
    const name = String(r.driverName || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const plat = String(r.platform || "").toLowerCase();
    const gross = Number(r.grossEarnings) || 0;
    const trips = Number(r.trips) || 0;

    const d = byDriver[key] || { name, platforms: [], totalGross: 0, totalTrips: 0, byPlatform: {} };
    if (plat && !d.platforms.includes(plat)) d.platforms.push(plat);
    d.totalGross += gross;
    d.totalTrips += trips;
    const bp = d.byPlatform[plat] || { gross: 0, trips: 0 };
    bp.gross += gross; bp.trips += trips;
    d.byPlatform[plat] = bp;
    byDriver[key] = d;

    if (plat) {
      const pa = platAgg[plat] || { drivers: new Set(), trips: 0, gross: 0 };
      pa.drivers.add(key); pa.trips += trips; pa.gross += gross;
      platAgg[plat] = pa;
    }
  }

  let totalGross = 0, totalTrips = 0;
  for (const k of Object.keys(byDriver)) {
    byDriver[k].totalGross = Math.round(byDriver[k].totalGross);
    byDriver[k].totalTrips = Math.round(byDriver[k].totalTrips);
    totalGross += byDriver[k].totalGross;
    totalTrips += byDriver[k].totalTrips;
  }

  const platforms = {};
  for (const p of Object.keys(platAgg)) {
    platforms[p] = {
      platform: p,
      label: platformLabel(p),
      unitLabel: (PLATFORM_SCHEMAS[p] && PLATFORM_SCHEMAS[p].unitLabel) || "trips",
      drivers: platAgg[p].drivers.size,
      trips: Math.round(platAgg[p].trips),
      gross: Math.round(platAgg[p].gross),
    };
  }

  const summary = {
    platforms,
    platformCount: Object.keys(platforms).length,
    driverCount: Object.keys(byDriver).length,
    totalGross: Math.round(totalGross),
    totalTrips: Math.round(totalTrips),
  };
  return { byDriver, summary };
}

module.exports = {
  parseCSV,
  mergePlatformData,
  // exported for reuse / tests:
  parseCSVText,
  splitDelimited,
};
