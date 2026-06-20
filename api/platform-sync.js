/**
 * M8 Track-A — POST /api/platform-sync  (Build-93, extended Build-97)
 *
 * Parse/preview layer for multi-platform driver earnings. Muhammad (or an
 * automation) POSTs one platform's raw CSV -- or, since Build-97, several at once
 * -- and this endpoint normalizes each through lib/platform-ingest, then folds
 * them into ONE profile per driver (Bolt + Uber merged) via lib/platform-merge.
 * It returns row counts + a small preview so he can eyeball that the columns
 * mapped correctly BEFORE any data is trusted or persisted.
 *
 * No Supabase writes yet — this is deliberately a read-only parse/preview step
 * while the per-platform column mappings are still being verified (see the notes
 * in lib/platform-schemas.js). A rowCount of 0 means the headers did not map.
 *
 * Body (single, Build-93): { platform: "bolt"|"uber"|..., csvText: "..." }
 * Body (batch,  Build-97): { csvs: [ { platform, csvText }, ... ] }  (both may be combined)
 * Auth: x-m8-token header must equal process.env.M8_CRON_SECRET (else 401).
 */
const { parseCSV } = require("../lib/platform-ingest");
const { mergeDriverProfiles, formatCombinedProfile } = require("../lib/platform-merge");

module.exports = async function handler(req, res) {
  // Auth FIRST — fails closed (a missing secret or wrong token never parses).
  const token = req.headers["x-m8-token"] || "";
  if (!process.env.M8_CRON_SECRET || token !== process.env.M8_CRON_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};

    // Accept EITHER a single { platform, csvText } (Build-93 shape) OR a batch
    // { csvs: [{ platform, csvText }, ...] } so Bolt + Uber can be uploaded
    // together and merged. Both are normalized into `inputs`.
    const inputs = [];
    if (Array.isArray(body.csvs)) {
      for (const c of body.csvs) {
        if (!c || typeof c !== "object") continue;
        inputs.push({
          platform: String(c.platform || "").toLowerCase().trim(),
          csvText: typeof c.csvText === "string" ? c.csvText : "",
        });
      }
    }
    if (typeof body.platform === "string" || typeof body.csvText === "string") {
      inputs.push({
        platform: String(body.platform || "").toLowerCase().trim(),
        csvText: typeof body.csvText === "string" ? body.csvText : "",
      });
    }

    // Parse each upload -> normalized rows (parseCSV never throws; [] on bad input).
    const perPlatform = [];
    const platformsForMerge = [];
    const allRows = [];
    for (const inp of inputs) {
      const rows = parseCSV(inp.csvText, inp.platform);
      perPlatform.push({ platform: inp.platform, rowCount: rows.length, preview: rows.slice(0, 3) });
      platformsForMerge.push({ platform: inp.platform, rows });
      for (const r of rows) allRows.push(r);
    }

    // Cross-platform merge: one profile per driver (slug-matched), Bolt+Uber folded.
    const mergedMap = mergeDriverProfiles(platformsForMerge);
    const combinedFleet = [];
    const mergedProfiles = {};
    for (const [slug, prof] of mergedMap) {
      const withSummary = Object.assign({ slug }, prof, { summary: formatCombinedProfile(prof) });
      combinedFleet.push(withSummary);
      mergedProfiles[slug] = withSummary;
    }
    // Highest combined earner first -- the useful default ordering for a fleet view.
    combinedFleet.sort((a, b) =>
      (b.totalNet - a.totalNet) || String(a.canonicalName).localeCompare(String(b.canonicalName)));

    return res.status(200).json({
      // Build-93 back-compat fields (single-platform callers keep working):
      platform: inputs.length === 1 ? inputs[0].platform : "",
      rowCount: allRows.length,
      normalized: allRows.slice(0, 3),
      // Build-97 additions:
      perPlatform,
      combinedFleet,
      mergedProfiles,
      errors: [],
    });
  } catch (e) {
    console.error("[M8 platform-sync] error (non-fatal):", e.message);
    return res.status(500).json({
      platform: null, rowCount: 0, normalized: [],
      perPlatform: [], combinedFleet: [], mergedProfiles: {},
      errors: [e.message],
    });
  }
};
