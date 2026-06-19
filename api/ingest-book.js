/**
 * api/ingest-book.js — Full-book knowledge ingestion
 *
 * POST /api/ingest-book
 * Body: {
 *   title        string   — book title
 *   author       string   — author name
 *   year         number   — publication year (optional)
 *   text         string   — full book text (plain text, not PDF binary)
 *   source_class string   — 'established' | 'speculative'
 *   notes        string?  — optional curator notes
 * }
 *
 * Returns: {
 *   book_title, author, total_chapters, source_ids[],
 *   total_added, total_pending, chapters[]
 * }
 *
 * Design:
 *   A full book (~80K words) exceeds the 16K-word limit of a single ingest call.
 *   This endpoint splits the text into chapters (or 12K-word batches if no
 *   chapter headers are detected), then runs each chapter through the existing
 *   Stage 1–3 pipeline: ingestDocument → extractConcepts → populateGraph.
 *   High-confidence nodes write immediately; medium/low go to pending_nodes.
 *   Each chapter produces one m8_knowledge_sources row with chapter provenance
 *   stored in the metadata column.
 */

"use strict";

const {
  ingestDocument,
  extractConcepts,
  populateGraph,
  savePendingNodes,
  normalizeSourceClass,
} = require("../lib/knowledge-intake");

// Words per batch when no chapter headers are found.
// Stays comfortably under MAX_CHUNKS * CHUNK_WORDS = 16 000.
const BATCH_WORDS = 12000;

// Chapter header patterns: "Chapter 1", "CHAPTER I", "1.", "Part Two", etc.
const CHAPTER_RE = /^(?:chapter|part|section|book)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+)\b|^(?:الجزء|الباب|الفصل|القسم|الكتاب|المقدمة|الخاتمة|ذكر|بيان|فصل|باب)\s*(?:\d+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[٠-٩]+)?/im;

/**
 * Split text on chapter header lines. Returns array of { title, text } objects.
 * Falls back to fixed word-count batches if fewer than 2 headers are found.
 */
function splitIntoChapters(fullText) {
  const lines = fullText.split(/\r?\n/);
  const cuts = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length > 2 && line.length < 120 && CHAPTER_RE.test(line)) {
      cuts.push({ lineIndex: i, heading: line });
    }
  }

  if (cuts.length < 2) {
    // No recognizable chapters — split by word count
    const words = fullText.trim().split(/\s+/);
    const batches = [];
    for (let i = 0; i < words.length; i += BATCH_WORDS) {
      const chunk = words.slice(i, i + BATCH_WORDS).join(" ");
      batches.push({
        title: `Batch ${batches.length + 1}`,
        text: chunk,
      });
    }
    return batches;
  }

  // Build chapter texts from cut points
  const chapters = [];
  for (let c = 0; c < cuts.length; c++) {
    const start = cuts[c].lineIndex;
    const end   = c + 1 < cuts.length ? cuts[c + 1].lineIndex : lines.length;
    const text  = lines.slice(start, end).join("\n").trim();
    if (text.split(/\s+/).length >= 50) {
      chapters.push({ title: cuts[c].heading, text });
    }
  }

  // If a preamble exists before the first chapter heading, add it too
  if (cuts[0].lineIndex > 10) {
    const preamble = lines.slice(0, cuts[0].lineIndex).join("\n").trim();
    if (preamble.split(/\s+/).length >= 50) {
      chapters.unshift({ title: "Preface / Introduction", text: preamble });
    }
  }

  return chapters.length ? chapters : [{ title: "Full Text", text: fullText }];
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { title, author, year, text, source_class, notes } = req.body || {};

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

  const chapters = splitIntoChapters(text);
  const totalChapters = chapters.length;

  const results = [];
  let totalAdded   = 0;
  let totalPending = 0;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const chapterTitle = `${title} — ${ch.title}`;

    let source_id;
    try {
      ({ source_id } = await ingestDocument({
        title:        chapterTitle,
        text:         ch.text,
        source_class: cls,
        notes:        notes || null,
        // metadata is stored via a direct update below since ingestDocument
        // doesn't accept the metadata column yet
      }));
    } catch (e) {
      results.push({ chapter: ch.title, error: e.message });
      continue;
    }

    // Write chapter provenance into the metadata column
    try {
      const { createClient } = require("@supabase/supabase-js");
      const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await db.from("m8_knowledge_sources").update({
        metadata: {
          book_title:     title,
          author:         author || null,
          year:           year   || null,
          chapter_index:  i,
          chapter_title:  ch.title,
          total_chapters: totalChapters,
        },
      }).eq("id", source_id);
    } catch { /* non-fatal — source row already saved */ }

    let added = 0, pendingCount = 0;
    try {
      const candidates = await extractConcepts(source_id);
      if (candidates.length) {
        const highConf = candidates.filter(c => c.extraction_confidence === "high");
        if (highConf.length) {
          const r = await populateGraph(highConf);
          added = r.added;
        }
        await savePendingNodes(source_id, candidates);
        pendingCount = candidates.filter(c => c.extraction_confidence !== "high").length;
      }
    } catch (e) {
      console.error(`[ingest-book] chapter ${i} extraction error (non-fatal):`, e.message);
    }

    totalAdded   += added;
    totalPending += pendingCount;

    results.push({
      chapter:     ch.title,
      source_id,
      words:       ch.text.split(/\s+/).length,
      nodes_added: added,
      nodes_pending: pendingCount,
    });
  }

  return res.status(200).json({
    book_title:       title,
    author:           author || null,
    year:             year   || null,
    source_class:     cls,
    total_chapters:   totalChapters,
    total_words:      wordCount,
    total_added:      totalAdded,
    total_pending:    totalPending,
    source_ids:       results.filter(r => r.source_id).map(r => r.source_id),
    chapters:         results,
  });
};
