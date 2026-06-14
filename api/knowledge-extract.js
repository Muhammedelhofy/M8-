/**
 * api/knowledge-extract.js — Build-27 Stages 2–3: extract concepts + populate graph
 *
 * POST /api/knowledge-extract
 * Body: { source_id, approve?: 'high' | 'all' | 'none' }
 *   approve='high'  (default) — immediately writes high-confidence nodes; saves medium/low as pending
 *   approve='all'             — writes all nodes without a clarification gate
 *   approve='none'            — returns the clarification summary only, writes nothing
 *
 * Returns: { summary, added, skipped, pending_count, source_id }
 *
 * Execution budget: 2000-word chunks, ≤8 chunks, ≤30s per chunk → fits 180s maxDuration.
 */

"use strict";

const {
  extractConcepts,
  populateGraph,
  buildClarificationSummary,
  savePendingNodes,
} = require("../lib/knowledge-intake");
const { createClient } = require("@supabase/supabase-js");

function getDb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { source_id, approve = "high" } = req.body || {};
  if (!source_id) {
    return res.status(400).json({ error: "source_id is required" });
  }

  try {
    // Fetch title for the summary message
    const { data: src } = await getDb()
      .from("m8_knowledge_sources")
      .select("title")
      .eq("id", source_id)
      .single();
    const title = src?.title ?? `source ${source_id}`;

    // Stage 2: extract
    const candidates = await extractConcepts(source_id);

    if (!candidates.length) {
      return res.status(200).json({
        summary: `No extractable nodes found in "${title}". The text may be too short or non-mathematical.`,
        added: 0, skipped: 0, pending_count: 0, source_id,
      });
    }

    const summary = buildClarificationSummary(candidates, title);

    if (approve === "none") {
      // Return summary only — nothing written to graph
      return res.status(200).json({ summary, added: 0, skipped: 0, pending_count: candidates.length, source_id });
    }

    // Stage 3: populate graph for approved tier
    const toWrite = approve === "all"
      ? candidates
      : candidates.filter(c => c.extraction_confidence === "high");

    const { added, skipped } = await populateGraph(toWrite);

    // Stage 5: save medium/low as pending for later approval
    if (approve === "high") {
      await savePendingNodes(source_id, candidates);
    }

    const pending_count = approve === "high"
      ? candidates.filter(c => c.extraction_confidence !== "high").length
      : 0;

    return res.status(200).json({ summary, added, skipped, pending_count, source_id });
  } catch (e) {
    console.error("[knowledge-extract]", e.message);
    return res.status(500).json({ error: e.message });
  }
};
