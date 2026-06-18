/**
 * api/convert.js — Universal document format converter
 *
 * POST /api/convert
 * Body: {
 *   url          string   — public URL of the file to convert
 *   format       string?  — force format: 'pdf' | 'image' | 'epub' | 'html' | 'text'
 *   title        string?  — document title (used when save=true)
 *   author       string?  — author (stored in metadata when save=true)
 *   year         number?  — publication year
 *   save         boolean? — store extracted text in m8_knowledge_sources
 *   source_class string?  — 'established' | 'speculative' (required when save=true)
 *   ingest       boolean? — also run knowledge extraction after save
 * }
 *
 * Returns: {
 *   format, word_count, pages, batches,
 *   text,
 *   source_id?   (if save=true)
 *   ingest?      (if ingest=true)
 * }
 */

"use strict";

const { convertUrl, detectFormat }        = require("../lib/converter");
const { ingestDocument, extractConcepts,
        populateGraph, savePendingNodes,
        normalizeSourceClass }             = require("../lib/knowledge-intake");
const { createClient }                    = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { url, format, title, author, year, save, source_class, ingest } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  // Validate save params up-front
  let cls = null;
  if (save || ingest) {
    cls = normalizeSourceClass(source_class);
    if (!cls) {
      return res.status(400).json({
        error: "source_class ('established' or 'speculative') is required when save or ingest is true",
      });
    }
  }

  // ── Convert ──────────────────────────────────────────────────────────────
  let converted;
  try {
    converted = await convertUrl(url, format || undefined);
  } catch (e) {
    return res.status(422).json({ error: `Conversion failed: ${e.message}` });
  }

  const { text, word_count, pages, batches, format: detectedFormat } = converted;

  if (word_count < 30) {
    return res.status(422).json({
      error: `Extracted text too short (${word_count} words). File may be encrypted, empty, or unsupported.`,
      format: detectedFormat,
      word_count,
    });
  }

  // ── Save to knowledge sources ─────────────────────────────────────────────
  let source_id = null;
  if ((save || ingest) && cls) {
    try {
      const docTitle = title || url.split("/").pop().replace(/\.[^.]+$/, "") || "Converted document";
      ({ source_id } = await ingestDocument({
        title:        docTitle,
        text,
        source_class: cls,
        notes:        JSON.stringify({ author: author || null, year: year || null, source_url: url, format: detectedFormat }),
      }));

      // Write metadata
      const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await db.from("m8_knowledge_sources").update({
        metadata: {
          title:     title || null,
          author:    author || null,
          year:      year   || null,
          source_url: url,
          format:    detectedFormat,
          pages,
        },
      }).eq("id", source_id);
    } catch (e) {
      console.error("[convert] save error:", e.message);
    }
  }

  // ── Ingest into knowledge graph ───────────────────────────────────────────
  let ingestResult = null;
  if (ingest && cls) {
    try {
      const docTitle = title || url.split("/").pop().replace(/\.[^.]+$/, "") || "Converted document";
      const CHUNK_W  = 12000;
      const words    = text.trim().split(/\s+/);
      let totalAdded = 0, totalPending = 0;
      const sourceIds = [];

      for (let i = 0; i < words.length; i += CHUNK_W) {
        const chunk     = words.slice(i, i + CHUNK_W).join(" ");
        const partNum   = Math.floor(i / CHUNK_W) + 1;
        const partTitle = words.length > CHUNK_W ? `${docTitle} — Part ${partNum}` : docTitle;
        try {
          const { source_id: sid } = await ingestDocument({ title: partTitle, text: chunk, source_class: cls });
          sourceIds.push(sid);
          const candidates = await extractConcepts(sid);
          if (candidates.length) {
            const high = candidates.filter(c => c.extraction_confidence === "high");
            if (high.length) { const r = await populateGraph(high); totalAdded += r.added; }
            await savePendingNodes(sid, candidates);
            totalPending += candidates.filter(c => c.extraction_confidence !== "high").length;
          }
        } catch (e) {
          console.error(`[convert] ingest part ${partNum}:`, e.message);
        }
      }
      ingestResult = { source_ids: sourceIds, total_added: totalAdded, total_pending: totalPending };
    } catch (e) {
      console.error("[convert] ingest pipeline error:", e.message);
    }
  }

  return res.status(200).json({
    format:    detectedFormat,
    word_count,
    pages,
    batches,
    source_id: source_id || null,
    ingest:    ingestResult,
    text,
  });
};
