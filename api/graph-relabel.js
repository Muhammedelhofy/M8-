/**
 * M8 Graph Relabel endpoint — /api/graph-relabel  (Build-15 smartTruncate follow-up)
 *
 * ONE-TIME, idempotent backfill: historical graph nodes were labelled with the
 * pre-fix dumb truncation `content.trim().slice(0,160)`, which could cut a figure
 * mid-number ("2 <= n <= 10,000" -> "...10") and made recall narrate a WRONG
 * bound. smartTruncate now governs new labels (lib/memory-graph.js ingestNote);
 * this re-derives the OLD labels from the intact `content` field. Display-only:
 * content / status / metadata / embedding / edges are untouched, so retrieval is
 * unaffected (see relabelNodes docstring for the full scope guard).
 *
 *   GET                  -> DRY RUN report (no writes): what would change + samples.
 *   POST  (no apply flag) -> DRY RUN report (no writes) — same as GET, safe default.
 *   POST  ?apply=1        -> APPLY: rewrite label + norm_label only where the dumb-
 *                            truncation signature holds (label is a content prefix).
 *
 * SECURITY: same CRON_SECRET bearer rule as /api/seed-pack & /api/cron-summarize.
 * The request body is ignored entirely — nothing here is caller-controlled, so
 * this endpoint cannot be used to inject or rename arbitrary nodes.
 */
const { relabelNodes } = require("../lib/memory-graph");

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }
  try {
    const q = (req.query && (req.query.apply)) || "";
    const apply = req.method === "POST" && (q === "1" || q === "true");
    const report = await relabelNodes({ dryRun: !apply });
    return res.status(200).json({
      ok: true,
      mode: apply ? "apply" : "dry-run",
      ...(apply ? {} : { hint: "Idempotent and read-only. POST with ?apply=1 (and the CRON_SECRET bearer) to write the changes." }),
      ...report,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
