/**
 * api/ingest-extract-existing.js -- Build-101: re-extract sources that were stored
 * but never had their concepts written to the graph.
 *
 * POST /api/ingest-extract-existing
 * Body: { source_id?, approve?: 'high'|'all' }
 *   source_id omitted -- process ALL unextracted sources (the repair path)
 *   source_id given    -- re-run extraction for that one source (populateGraph
 *                         dedups, so re-running an already-populated source only
 *                         tops up missing nodes)
 *   approve='all' (default) -- write every extracted node
 *   approve='high'          -- write the high tier only; save medium/low as pending
 *
 * "Unextracted" = a row in m8_knowledge_sources with NO node in m8_graph_nodes
 * carrying a matching source_doc_id. (The graph node column is source_doc_id, not
 * source_id -- confirmed against the live schema before this was written.)
 *
 * Returns: { processed, total_added, per_source: [{ source_id, extracted, added, skipped, pending }] }
 *
 * WHY THIS EXISTS (Build-101 audit): some sources were ingested (Step 1) but their
 * extraction (Step 2) was skipped, leaving 0 nodes. This endpoint finds them and
 * runs the missing step. Pair it with /api/ingest-full so the gap cannot recur.
 *
 * Execution budget: each source is 2000-word chunks, ~30s each; fits 180s.
 */

"use strict";

const {
  extractConcepts,
  populateGraph,
  savePendingNodes,
} = require("../lib/knowledge-intake");
const { createClient } = require("@supabase/supabase-js");

function getDb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const VALID_APPROVE = new Set(["high", "all"]);

// True when the error means m8_graph_nodes has no source_doc_id column (so the
// "unextracted" join is impossible and we must report it rather than crash).
function isMissingSourceDocId(error) {
  if (!error) return false;
  if (error.code === "42703") return true; // undefined_column
  const m = String(error.message || "").toLowerCase();
  return m.includes("source_doc_id") &&
    (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const body = req.body || {};
  // Default 'all' for the repair path -- re-extracting an existing source should
  // write everything it finds unless the caller asks to gate at high.
  let approve = String(body.approve || "all").toLowerCase();
  if (!VALID_APPROVE.has(approve)) approve = "all";

  try {
    const db = getDb();

    // Build the target list: an explicit source_id, else every unextracted source.
    let targetIds;
    if (body.source_id !== undefined && body.source_id !== null) {
      targetIds = [body.source_id];
    } else {
      const { data: sources, error: sErr } = await db
        .from("m8_knowledge_sources")
        .select("id");
      if (sErr) throw new Error(`sources query failed: ${sErr.message}`);

      const { data: nodeRows, error: nErr } = await db
        .from("m8_graph_nodes")
        .select("source_doc_id")
        .not("source_doc_id", "is", null);
      if (nErr) {
        if (isMissingSourceDocId(nErr)) {
          return res.status(500).json({
            error: "m8_graph_nodes has no source_doc_id column -- cannot determine unextracted sources.",
          });
        }
        throw new Error(`graph nodes query failed: ${nErr.message}`);
      }

      const extracted = new Set((nodeRows || []).map((r) => r.source_doc_id));
      targetIds = (sources || []).map((s) => s.id).filter((id) => !extracted.has(id));
    }

    const per_source = [];
    let total_added = 0;

    for (const sid of targetIds) {
      try {
        const candidates = await extractConcepts(sid);
        if (!candidates.length) {
          per_source.push({ source_id: sid, extracted: 0, added: 0, skipped: 0, pending: 0 });
          continue;
        }

        // populateGraph takes ONLY candidates; filter by tier here (caller-side,
        // mirroring api/knowledge-extract.js -- the lib is reused, not changed).
        const toWrite = approve === "high"
          ? candidates.filter((c) => c.extraction_confidence === "high")
          : candidates;

        const { added, skipped } = await populateGraph(toWrite);

        let pending = 0;
        if (approve === "high") {
          try { await savePendingNodes(sid, candidates); } catch (e) { /* non-fatal */ }
          pending = candidates.filter((c) => c.extraction_confidence !== "high").length;
        }

        total_added += added;
        per_source.push({ source_id: sid, extracted: candidates.length, added, skipped, pending });
      } catch (e) {
        // One bad source must not abort the batch.
        per_source.push({ source_id: sid, error: e.message });
      }
    }

    return res.status(200).json({
      processed: per_source.length,
      total_added,
      per_source,
    });
  } catch (e) {
    console.error("[ingest-extract-existing]", e.message);
    return res.status(500).json({ error: e.message });
  }
};

// Vercel Pro: re-extraction can take ~90s. Set AFTER the handler assignment so the
// reassignment does not wipe it. vercel.json carries the authoritative entry.
module.exports.config = { maxDuration: 180 };
