/**
 * M8 Track-A — lib/platform-schemas.js  (Build-93)
 *
 * Muhammad's drivers earn on FIVE platforms (Bolt, Uber, HungerStation, Keeta,
 * Noon), each exporting a different CSV with different headers — some Arabic.
 * This module is the single place that maps each platform's raw column names
 * onto ONE normalized row shape, so the rest of M8 (brief, P&L, ingest) reads a
 * uniform record regardless of source.
 *
 * Normalized row shape:
 *   { driverName, platform, date, grossEarnings, trips, hoursOnline, currency }
 *
 * COLUMN CONFIDENCE: only Bolt's headers are confirmed (we already ingest Bolt).
 * Every column we have NOT seen a real export for is marked
 * `// TODO: verify with Muhammad` — those mappings are best-guess aliases and
 * MUST be confirmed against a real file before the numbers are trusted. Each
 * field carries several alias candidates; normalizeRow takes the first header
 * present, so adding the real header to the list (once known) is a one-line fix.
 */

// Bolt's "Earnings per driver" export tags units onto the header with a pipe
// (e.g. "Total earnings|SAR"); we match on the part before the pipe so the
// unit suffix never breaks the lookup.
function normHeader(h) {
  return String(h == null ? "" : h).toLowerCase().split("|")[0].trim().replace(/\s+/g, " ");
}

const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
// HungerStation/Keeta exports may carry Arabic-Indic digits; fold them to ASCII
// before stripping currency text / thousands separators.
function toNumber(v) {
  if (v == null) return 0;
  let s = String(v).replace(/[٠-٩]/g, (d) => AR_DIGITS[d] || d);
  s = s.replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === ".") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const PLATFORM_SCHEMAS = {
  bolt: {
    displayName: "Bolt",
    unitLabel: "trips",
    currency: "SAR",
    columns: {
      driverName:    ["Driver name", "Driver"],
      grossEarnings: ["Total earnings", "Gross earnings"],
      trips:         ["Trips"],
      hoursOnline:   ["Online hours"],
      date:          ["Date", "Day"], // TODO: verify with Muhammad — per-driver Bolt export date column header
    },
  },
  uber: {
    displayName: "Uber",
    unitLabel: "trips",
    currency: "SAR",
    columns: {
      driverName:    ["Partner Name", "driver_name", "Driver", "Name"], // TODO: verify with Muhammad
      grossEarnings: ["Gross Fares", "gross_fare", "Total Earnings", "Total Fares"], // TODO: verify with Muhammad
      trips:         ["Trips", "Completed Trips", "trips"], // TODO: verify with Muhammad
      hoursOnline:   ["Online Hours", "Hours Online", "Time Online"], // TODO: verify with Muhammad
      date:          ["Date", "Day"], // TODO: verify with Muhammad
    },
  },
  hungerstation: {
    displayName: "HungerStation",
    unitLabel: "orders",
    currency: "SAR",
    columns: {
      // TODO: verify with Muhammad — HungerStation likely exports Arabic headers; ASCII aliases are guesses.
      driverName:    ["اسم السائق", "Driver Name", "driver_name", "Captain"], // TODO: verify with Muhammad
      grossEarnings: ["إجمالي الأرباح", "Total Earnings", "Gross", "Earnings"], // TODO: verify with Muhammad
      trips:         ["عدد الطلبات", "Orders", "Order Count", "Deliveries"], // TODO: verify with Muhammad
      hoursOnline:   ["ساعات العمل", "Online Hours", "Hours"], // TODO: verify with Muhammad
      date:          ["التاريخ", "Date"], // TODO: verify with Muhammad
    },
  },
  keeta: {
    displayName: "Keeta",
    unitLabel: "orders",
    currency: "SAR",
    columns: {
      // TODO: verify with Muhammad — Keeta is assumed similar to HungerStation (Arabic delivery export); unconfirmed.
      driverName:    ["اسم السائق", "Driver Name", "Rider Name", "Captain"], // TODO: verify with Muhammad
      grossEarnings: ["إجمالي الأرباح", "Total Earnings", "Gross", "Earnings"], // TODO: verify with Muhammad
      trips:         ["عدد الطلبات", "Orders", "Order Count"], // TODO: verify with Muhammad
      hoursOnline:   ["ساعات العمل", "Online Hours", "Hours"], // TODO: verify with Muhammad
      date:          ["التاريخ", "Date"], // TODO: verify with Muhammad
    },
  },
  noon: {
    displayName: "Noon",
    unitLabel: "orders",
    currency: "SAR",
    // TODO: verify with Muhammad — Noon (Food/Minutes) driver export format is entirely
    // unknown. This is a STUB: with no confirmed headers, normalizeRow returns a
    // zero-valued row (driverName empty) until a real Noon export is supplied.
    columns: {
      driverName:    [], // TODO: verify with Muhammad — Noon driver-name column unknown
      grossEarnings: [], // TODO: verify with Muhammad — Noon earnings column unknown
      trips:         [], // TODO: verify with Muhammad — Noon order-count column unknown
      hoursOnline:   [], // TODO: verify with Muhammad — Noon hours column unknown
      date:          [], // TODO: verify with Muhammad — Noon date column unknown
    },
  },
};

function platformLabel(platform) {
  const s = PLATFORM_SCHEMAS[platform];
  if (s && s.displayName) return s.displayName;
  const p = String(platform || "").trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : "Unknown";
}

function buildHeaderLookup(rawRow) {
  const out = {};
  for (const k of Object.keys(rawRow)) out[normHeader(k)] = rawRow[k];
  return out;
}

/**
 * Map one raw CSV row object onto the normalized shape.
 * @param {object} rawRow - { [rawHeader]: value }
 * @param {string} platform - a PLATFORM_SCHEMAS key
 * @returns {object|null} normalized row, or null if platform/rawRow invalid.
 */
function normalizeRow(rawRow, platform) {
  const schema = PLATFORM_SCHEMAS[platform];
  if (!schema || !rawRow || typeof rawRow !== "object") return null;
  const lookup = buildHeaderLookup(rawRow);
  const pick = (cands) => {
    for (const c of (cands || [])) {
      const key = normHeader(c);
      if (Object.prototype.hasOwnProperty.call(lookup, key)) return lookup[key];
    }
    return "";
  };
  const cols = schema.columns;
  return {
    driverName:    String(pick(cols.driverName) || "").trim(),
    platform,
    date:          String(pick(cols.date) || "").trim(),
    grossEarnings: toNumber(pick(cols.grossEarnings)),
    trips:         Math.round(toNumber(pick(cols.trips))),
    hoursOnline:   toNumber(pick(cols.hoursOnline)),
    currency:      schema.currency || "SAR",
  };
}

module.exports = {
  PLATFORM_SCHEMAS,
  normalizeRow,
  platformLabel,
  // exported for reuse / tests:
  normHeader,
  toNumber,
};
