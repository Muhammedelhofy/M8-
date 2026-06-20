/**
 * GET (or POST) /api/memory-consolidate — Build-85e: Memory Consolidation trigger.
 *
 * Runs one consolidation pass over the fact store:
 *   • consolidate()        — soft-merge near-duplicate facts (Jaccard >= 0.6) into
 *                            a canonical row via merged_into (reversible, no delete).
 *   • flagContradictions() — dispatch up to 50 fire-and-forget gemini-2.5-flash
 *                            checks that flag the lower-confidence row of any
 *                            contradicting fact pair.
 * Returns { consolidated, kept, contradictions, ran_at }.
 *
 * Deliberately SEPARATE from the read-only Build-80 /api/memory-health (which only
 * REPORTS what M8 knows): this endpoint WRITES, so it lives on its own path where a
 * routine health probe can never trigger a merge.
 */
const { createClient } = require("@supabase/supabase-js");
const { consolidate, flagContradictions } = require("../lib/memory-consolidator");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: "Supabase not configured" });
  }

  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const merged = await consolidate(db);
    const contra = await flagContradictions(db);
    return res.status(200).json({
      consolidated:   merged.consolidated,
      kept:           merged.kept,
      contradictions: contra.pairs,
      ran_at:         new Date().toISOString(),
    });
  } catch (err) {
    console.error("[memory-consolidate] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
