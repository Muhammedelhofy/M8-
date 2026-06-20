"use strict";

/**
 * lib/platform-merge.js -- Build-97: cross-platform driver profile merge.
 *
 * Build-93 gave us per-platform normalized rows (lib/platform-schemas.js):
 *   { driverName, platform, date, grossEarnings, trips, hoursOnline, currency }
 * This module folds rows from SEVERAL platforms (Bolt + Uber + ...) into ONE
 * profile per real-world driver, so a driver who runs both Bolt and Uber shows
 * up once with a combined total instead of twice.
 *
 * Identity matching is by canonical SLUG (lib/entity-slug.js toSlug), NOT by raw
 * name, so "Ahmad"=="Ahmed", "Mohammed"=="Muhammad", and an Arabic spelling all
 * land on the same profile. The Map is KEYED BY THAT SLUG; each profile also
 * carries a human-readable `canonicalName` (the first real name seen for the
 * slug) for display -- the two differ on purpose (key "mhmd" vs name "Mohammed").
 *
 * FIELD NOTE: Build-93 rows name the earnings field `grossEarnings` (the
 * platform-reported figure, before the fleet's own cost overlay). On the merged
 * profile we surface it as `netEarnings` -- the driver's take per platform -- to
 * match the cross-platform profile contract. We read `grossEarnings` and fall
 * back to `netEarnings`, so either row shape works defensively.
 *
 * Pure transformation: no IO, no DB, no LLM. Trivially testable offline.
 */
const { toSlug } = require("./entity-slug");
const { platformLabel } = require("./platform-schemas");

// Read a row's earnings regardless of which field name it carries.
function rowNet(r) {
  if (!r) return 0;
  const v = (r.netEarnings != null) ? r.netEarnings : r.grossEarnings;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

/**
 * Merge normalized rows from several platforms into one profile per driver.
 * @param {Array<{platform:string, rows:Array}>} platforms
 * @returns {Map<string, {canonicalName:string, platforms:Array, totalNet:number, primaryPlatform:string}>}
 *   keyed by canonical slug (toSlug of the driver name).
 */
function mergeDriverProfiles(platforms) {
  const result = new Map();
  if (!Array.isArray(platforms)) return result;

  // Pass 1: accumulate per-slug, per-platform totals.
  // acc: slug -> { name, byPlatform: Map<platform, {platform,netEarnings,trips,hoursOnline}> }
  const acc = new Map();
  for (const entry of platforms) {
    if (!entry || typeof entry !== "object") continue;
    const entryPlat = String(entry.platform || "").toLowerCase().trim();
    const rows = Array.isArray(entry.rows) ? entry.rows : [];
    for (const r of rows) {
      if (!r) continue;
      const name = String(r.driverName || "").trim();
      if (!name) continue;
      const slug = toSlug(name);
      if (!slug) continue;
      // Prefer the row's own platform; fall back to the entry's, so a flat mixed
      // array of rows still buckets to the right platform.
      const plat = (String(r.platform || "").toLowerCase().trim() || entryPlat) || "unknown";

      let a = acc.get(slug);
      if (!a) { a = { name, byPlatform: new Map() }; acc.set(slug, a); }

      const pf = a.byPlatform.get(plat) || { platform: plat, netEarnings: 0, trips: 0, hoursOnline: 0 };
      pf.netEarnings += rowNet(r);
      pf.trips += Math.round(Number(r.trips) || 0);
      pf.hoursOnline += (Number(r.hoursOnline) || 0);
      a.byPlatform.set(plat, pf);
    }
  }

  // Pass 2: finalize the public profile shape.
  for (const [slug, a] of acc) {
    const platformsArr = [];
    for (const pf of a.byPlatform.values()) {
      platformsArr.push({
        platform: pf.platform,
        netEarnings: Math.round(pf.netEarnings),
        trips: Math.round(pf.trips),
        hoursOnline: round2(pf.hoursOnline),
      });
    }
    // Sort by netEarnings desc (then platform name) so the output order and
    // primaryPlatform are deterministic regardless of upload order.
    platformsArr.sort((x, y) => (y.netEarnings - x.netEarnings) || x.platform.localeCompare(y.platform));
    const totalNet = platformsArr.reduce((s, p) => s + p.netEarnings, 0);
    const primaryPlatform = platformsArr.length ? platformsArr[0].platform : "";

    result.set(slug, {
      canonicalName: a.name,
      platforms: platformsArr,
      totalNet: Math.round(totalNet),
      primaryPlatform,
    });
  }
  return result;
}

/**
 * Human-readable one-liner for a combined profile, e.g.
 *   "Ahmad: Bolt 4200 + Uber 1100 = 5300 SAR total (3 trips Uber)"
 * The earnings sum lists every platform; the trailing parenthetical lists trip
 * counts only for platforms that actually reported trips (>0), so an earnings-
 * only platform is omitted there while still counting toward the total.
 * @param {object} profile a combinedProfile from mergeDriverProfiles
 * @param {string} [currency="SAR"]
 * @returns {string}
 */
function formatCombinedProfile(profile, currency) {
  if (!profile || typeof profile !== "object") return "";
  const cur = String(currency || "SAR");
  const name = (String(profile.canonicalName || "").trim()) || "(unknown)";
  const plats = Array.isArray(profile.platforms) ? profile.platforms : [];
  if (!plats.length) return name + ": no platform earnings";

  const earnStr = plats
    .map((p) => platformLabel(p.platform) + " " + Math.round(Number(p.netEarnings) || 0))
    .join(" + ");
  const total = Math.round(Number(profile.totalNet) || 0);
  const tripParts = plats
    .filter((p) => (Number(p.trips) || 0) > 0)
    .map((p) => Math.round(Number(p.trips)) + " trips " + platformLabel(p.platform));
  const tripStr = tripParts.length ? " (" + tripParts.join(", ") + ")" : "";

  return name + ": " + earnStr + " = " + total + " " + cur + " total" + tripStr;
}

module.exports = {
  mergeDriverProfiles,
  formatCombinedProfile,
  // exported for reuse / tests:
  rowNet,
};
