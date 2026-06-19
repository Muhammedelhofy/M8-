/**
 * api/ingest-book.js — Full-book knowledge ingestion (HTTP wrapper)
 *
 * POST /api/ingest-book
 * Body: {
 *   title        string   — book title
 *   author       string   — author name
 *   year         number   — publication year (optional)
 *   text         string   — full book text (plain text, not PDF binary)
 *   source_class string   — 'established' | 'speculative'
 *   notes        string?  — optional curator notes
 *   max_chapters number?  — chapters to process this invocation (resume bound)
 * }
 *
 * Returns the ingestBookText() result:
 *   { book_title, author, year, source_class, total_chapters, total_words,
 *     total_added, total_pending, done, resume, next_chapter, chapters_done,
 *     chapters_remaining, processed_this_run, timed_out, checkpointing,
 *     source_ids[], chapters[] }
 *
 * Build-77 made ingestion resumable/idempotent/timeout-safe; Build-78 moved the
 * engine into lib/knowledge-intake.js (ingestBookText) so the chat orchestrator
 * drives the SAME path. This file is now a thin validate-and-delegate wrapper.
 * The caller re-POSTs the same body until done:true to ingest a large book.
 */

"use strict";

const { ingestBookText, normalizeSourceClass } = require("../lib/knowledge-intake");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { title, author, year, text, source_class, notes, max_chapters } = req.body || {};

  if (!title || !text) {
    return res.status(400).json({ error: "title and text are required" });
  }

  const cls = normalizeSourceClass(source_class);
  if (!cls) {
    return res.status(400).json({
      error: "source_class must be 'established' or 'speculative'",
    });
  }

  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 100) {
    return res.status(400).json({ error: "text too short — paste the full book text" });
  }

  try {
    const result = await ingestBookText({
      title, author: author || null, year: year || null,
      text, cls, notes: notes || null,
      maxChapters: parseInt(max_chapters, 10) || undefined,
    });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[ingest-book]", e.message);
    return res.status(500).json({ error: e.message });
  }
};
