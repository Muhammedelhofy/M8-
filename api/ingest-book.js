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
  loadCheckpoints,
  saveCheckpoint,
  chaptersToProcess,
  ingestProgress,
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

// Vercel Pro max function duration is 60 s; each chapter takes ~5-10 s (Gemini
// extraction). Stop processing new chapters if we are within TIMEOUT_GUARD_MS of
// the limit so we can still send a partial-success response rather than a hard
// timeout. Already-committed chapters are safe in the DB.
const TIMEOUT_GUARD_MS = 8000;    // stop starting new chapters 8 s before deadline
const VERCEL_MAX_MS    = parseInt(process.env.VERCEL_MAX_DURATION_MS, 10) || 55000;

// Bound the number of chapters attempted per invocation so a large book returns
// a "continue" signal (resume:true, next_chapter:N) instead of timing out. The
// caller re-POSTs the same body; already-done chapters are skipped via the
// checkpoint table. Default 6; env M8_INGEST_MAX_CHAPTERS clamps [1..50].
const MAX_CHAPTERS_PER_INVOCATION =
  Math.min(50, Math.max(1, parseInt(process.env.M8_INGEST_MAX_CHAPTERS, 10) || 6));

// Find an already-created chapter source row by exact title so a chapter that
// died mid-extraction (source row written, nodes not committed, never
// checkpointed) reuses its row on re-run instead of inserting a duplicate.
// populateGraph dedups nodes by (kind, norm_label), so re-running extraction on
// the reused row tops up missing nodes without duplicating any.
async function findOrCreateChapterSource(db, { chapterTitle, text, cls, notes }) {
  const { data: existing } = await db
    .from("m8_knowledge_sources")
    .select("id")
    .eq("title", chapterTitle)
    .order("id", { ascending: true })
    .limit(1);
  if (existing && existing.length) return { source_id: existing[0].id, reused: true };
  const { source_id } = await ingestDocument({
    title: chapterTitle, text, source_class: cls, notes: notes || null,
  });
  return { source_id, reused: false };
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

  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const chapters = splitIntoChapters(text);
  const totalChapters = chapters.length;

  // ── Resume state ───────────────────────────────────────────────────────────
  // Preferred: the checkpoint table (a chapter is 'done' only once its nodes are
  // committed). Fallback when the migration is not applied yet: the legacy
  // title-based dedup (a chapter source row exists). The checkpoint path is the
  // only one that correctly resumes a chapter that died mid-extraction.
  let checkpoints = null;          // Map<chapter_index, row> | null when unavailable
  let checkpointing = false;
  try {
    checkpoints = await loadCheckpoints(title);          // null => table missing
    checkpointing = checkpoints !== null;
  } catch (e) {
    console.error("[ingest-book] loadCheckpoints (non-fatal):", e.message);
  }

  let legacyDoneTitles = new Set();
  if (!checkpointing) {
    try {
      const { data: existing } = await db
        .from("m8_knowledge_sources")
        .select("title")
        .like("title", `${title} — %`);
      legacyDoneTitles = new Set((existing || []).map((r) => r.title));
    } catch { /* non-fatal — proceed without dedup */ }
  }

  // Indices already finished (skip them entirely on this and future runs).
  const doneIndices = [];
  for (let i = 0; i < chapters.length; i++) {
    const chapterTitle = `${title} — ${chapters[i].title}`;
    if (checkpointing) {
      const cp = checkpoints.get(i);
      if (cp && cp.status === "done") doneIndices.push(i);
    } else if (legacyDoneTitles.has(chapterTitle)) {
      doneIndices.push(i);
    }
  }

  // Bound the work this invocation so we return a continue signal, not a timeout.
  const todo = chaptersToProcess(totalChapters, doneIndices, MAX_CHAPTERS_PER_INVOCATION);

  const results = [];
  let totalAdded   = 0;
  let totalPending = 0;
  let processedThisRun = 0;
  let timedOut = false;
  const startedAt = Date.now();
  const newlyDone = new Set(doneIndices);

  for (const i of todo) {
    // Timeout guard: stop before Vercel kills the function mid-write. Anything
    // not yet checkpointed 'done' is safely retried on the next invocation.
    if (Date.now() - startedAt > VERCEL_MAX_MS - TIMEOUT_GUARD_MS) {
      timedOut = true;
      break;
    }

    const ch = chapters[i];
    const chapterTitle = `${title} — ${ch.title}`;

    // Mark this chapter pending (best-effort) so progress is visible even if we
    // die before it completes.
    if (checkpointing) {
      try {
        await saveCheckpoint({
          book_title: title, chapter_index: i, chapter_title: ch.title,
          status: "pending", total_chapters: totalChapters,
        });
      } catch (e) { console.error("[ingest-book] checkpoint pending (non-fatal):", e.message); }
    }

    let source_id;
    try {
      ({ source_id } = await findOrCreateChapterSource(db, {
        chapterTitle, text: ch.text, cls, notes,
      }));
    } catch (e) {
      results.push({ chapter: ch.title, error: e.message });
      continue;
    }

    // Write chapter provenance into the metadata column
    try {
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

    let added = 0, pendingCount = 0, extractionOk = false;
    try {
      const candidates = await extractConcepts(source_id);
      if (candidates.length) {
        const highConf = candidates.filter(c => c.extraction_confidence === "high");
        if (highConf.length) {
          const r = await populateGraph(highConf);   // idempotent: dedups by (kind, norm_label)
          added = r.added;
        }
        await savePendingNodes(source_id, candidates);
        pendingCount = candidates.filter(c => c.extraction_confidence !== "high").length;
      }
      extractionOk = true;
    } catch (e) {
      console.error(`[ingest-book] chapter ${i} extraction error (non-fatal):`, e.message);
    }

    // Checkpoint 'done' ONLY after nodes are committed — this is the resume
    // contract. A chapter that threw mid-extraction stays 'pending' and is
    // retried next invocation (node dedup makes the retry a safe top-up).
    if (checkpointing && extractionOk) {
      try {
        await saveCheckpoint({
          book_title: title, chapter_index: i, chapter_title: ch.title,
          source_id, status: "done", nodes_added: added, nodes_pending: pendingCount,
          total_chapters: totalChapters,
        });
        newlyDone.add(i);
      } catch (e) { console.error("[ingest-book] checkpoint done (non-fatal):", e.message); }
    } else if (!checkpointing && extractionOk) {
      newlyDone.add(i);   // legacy path: source row now exists -> treated as done
    }

    totalAdded   += added;
    totalPending += pendingCount;
    processedThisRun++;

    results.push({
      chapter:       ch.title,
      chapter_index: i,
      source_id,
      words:         ch.text.split(/\s+/).length,
      nodes_added:   added,
      nodes_pending: pendingCount,
    });
  }

  const progress = ingestProgress(totalChapters, newlyDone.size);
  // More chapters remain if we hit the per-invocation cap or the timeout guard.
  const remaining = progress.chapters_remaining;
  const done = remaining === 0;
  const nextChapter = done ? null : todo.find(i => !newlyDone.has(i)) ??
    chaptersToProcess(totalChapters, [...newlyDone], 1)[0] ?? null;

  return res.status(200).json({
    book_title:       title,
    author:           author || null,
    year:             year   || null,
    source_class:     cls,
    total_chapters:   totalChapters,
    total_words:      wordCount,
    total_added:      totalAdded,
    total_pending:    totalPending,
    // Resume contract — the caller re-POSTs the same body until done:true.
    done,
    resume:           !done,
    next_chapter:     nextChapter,
    chapters_done:    progress.chapters_done,
    chapters_remaining: remaining,
    processed_this_run: processedThisRun,
    timed_out:        timedOut,
    checkpointing,
    source_ids:       results.filter(r => r.source_id).map(r => r.source_id),
    chapters:         results,
  });
};
