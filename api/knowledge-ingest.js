/**
 * api/knowledge-ingest.js — Build-27 Stage 1: store raw document
 *
 * POST /api/knowledge-ingest
 * Body: { title, text, source_url?, source_class, notes? }
 * Returns: { source_id, preview, word_count }
 *
 * Fast (<5s). Does NOT run extraction — that is /api/knowledge-extract.
 * source_class MUST be supplied by the caller (Muhammad sets it; M8 never infers it).
 */

"use strict";

const { ingestDocument, normalizeSourceClass } = require("../lib/knowledge-intake");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { title, text, source_url, source_class, notes } = req.body || {};

  if (!title || !text) {
    return res.status(400).json({ error: "title and text are required" });
  }
  // Build-41 (D1): ONE neutral bucket. 'fringe' is accepted as a deprecated alias
  // and folded to 'speculative'; anything else is rejected.
  const cls = normalizeSourceClass(source_class);
  if (!cls) {
    return res.status(400).json({
      error: "source_class must be 'established' or 'speculative'",
    });
  }

  try {
    const result = await ingestDocument({ title, text, source_url, source_class: cls, notes });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[knowledge-ingest]", e.message);
    return res.status(500).json({ error: e.message });
  }
};
