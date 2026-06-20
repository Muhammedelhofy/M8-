/**
 * api/ingest-full.js -- Build-101: atomic ingest pipeline (Stage 1 + Stages 2-3 in ONE call)
 *
 * POST /api/ingest-full
 * Body: { title, text, source_url?, source_class, notes?, approve?: 'high'|'all'|'none' }
 *   approve='high' (default) -- write high-confidence nodes now; save medium/low as pending
 *   approve='all'            -- write all extracted nodes (no clarification gate)
 *   approve='none'           -- extract + return the summary only; write nothing to the graph
 *
 * Returns: { source_id, added, skipped, pending_count, word_count, preview, extracted, summary }
 *
 * WHY THIS EXISTS (Build-101 audit): the original 2-step pipeline
 * (POST /api/knowledge-ingest then POST /api/knowledge-extract) let Step 2 be
 * silently skipped -- a source row landed in m8_knowledge_sources with ZERO nodes
 * in m8_graph_nodes. A "successful ingest" that never populated the graph is the
 * bug this endpoint removes: ingest + extract + write happen in a single call, so
 * a 200 here always means the graph was actually populated (or 0 nodes reported).
 *
 * Execution budget: extraction runs 2000-word chunks, <=8 chunks, ~30s each, so a
 * full document fits inside the 180s maxDuration set below + in vercel.json.
 */

"use strict";

const {
  ingestDocument,
  extractConcepts,
  populateGraph,
  savePendingNodes,
  buildClarificationSummary,
  normalizeSourceClass,
} = require("../lib/knowledge-intake");

const VALID_APPROVE = new Set(["high", "all", "none"]);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const body = req.body || {};
  const { title, text, source_url, notes } = body;

  // approve coerced to a known value; anything unexpected falls back to 'high'.
  let approve = String(body.approve || "high").toLowerCase();
  if (!VALID_APPROVE.has(approve)) approve = "high";

  if (!title || !text) {
    return res.status(400).json({ error: "title and text are required" });
  }

  // source_class is set by the caller -- M8 never infers it ('fringe' folds to
  // 'speculative'; anything else is rejected).
  const cls = normalizeSourceClass(body.source_class);
  if (!cls) {
    return res.status(400).json({
      error: "source_class must be 'established' or 'speculative'",
    });
  }

  try {
    // Step 1 -- store the raw document.
    const { source_id, preview, word_count } = await ingestDocument({
      title, text, source_url, source_class: cls, notes,
    });

    // Step 2 -- extract candidate nodes from the just-stored document.
    const candidates = await extractConcepts(source_id);

    if (!candidates.length) {
      return res.status(200).json({
        source_id, added: 0, skipped: 0, pending_count: 0,
        word_count, preview, extracted: 0,
        summary: `No extractable nodes found in "${title}". The text may be too short or non-mathematical.`,
      });
    }

    const summary = buildClarificationSummary(candidates, title);

    // approve='none' -- return the clarification summary only; write nothing.
    if (approve === "none") {
      return res.status(200).json({
        source_id, added: 0, skipped: 0,
        pending_count: candidates.length,
        word_count, preview, extracted: candidates.length, summary,
      });
    }

    // Step 3 -- write the approved tier. populateGraph takes ONLY candidates; the
    // confidence filter lives in the caller (mirrors api/knowledge-extract.js so
    // the lib is reused, not refactored).
    const toWrite = approve === "all"
      ? candidates
      : candidates.filter((c) => c.extraction_confidence === "high");

    const { added, skipped } = await populateGraph(toWrite);

    // When only the high tier was written, stash medium/low for later approval.
    if (approve === "high") {
      try { await savePendingNodes(source_id, candidates); } catch (e) { /* non-fatal */ }
    }

    const pending_count = approve === "high"
      ? candidates.filter((c) => c.extraction_confidence !== "high").length
      : 0;

    return res.status(200).json({
      source_id, added, skipped, pending_count,
      word_count, preview, extracted: candidates.length, summary,
    });
  } catch (e) {
    console.error("[ingest-full]", e.message);
    return res.status(500).json({ error: e.message });
  }
};

// Vercel Pro: extraction can take ~90s. Set AFTER the handler assignment above so
// the reassignment does not wipe it. vercel.json carries the authoritative entry.
module.exports.config = { maxDuration: 180 };
