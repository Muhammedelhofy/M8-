/**
 * M8 Track-A — POST /api/platform-sync  (Build-93)
 *
 * Parse/preview layer for multi-platform driver earnings. Muhammad (or an
 * automation) POSTs one platform's raw CSV; this endpoint normalizes it through
 * lib/platform-ingest and returns a row count + a 3-row preview so he can eyeball
 * that the columns mapped correctly BEFORE any data is trusted or persisted.
 *
 * No Supabase writes yet — this is deliberately a read-only parse/preview step
 * while the per-platform column mappings are still being verified (see the
 * `// TODO: verify with Muhammad` markers in lib/platform-schemas.js).
 *
 * Body: { platform: "uber"|"hungerstation"|"keeta"|"noon"|"bolt", csvText: "..." }
 * Auth: x-m8-token header must equal process.env.M8_CRON_SECRET (else 401).
 */
const { parseCSV } = require("../lib/platform-ingest");

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

    const platform = String(body.platform || "").toLowerCase().trim();
    const csvText = typeof body.csvText === "string" ? body.csvText : "";

    const normalized = parseCSV(csvText, platform); // never throws → [] on bad input

    return res.status(200).json({
      platform,
      rowCount: normalized.length,
      normalized: normalized.slice(0, 3),
      errors: [],
    });
  } catch (e) {
    console.error("[M8 platform-sync] error (non-fatal):", e.message);
    return res.status(500).json({ platform: null, rowCount: 0, normalized: [], errors: [e.message] });
  }
};
