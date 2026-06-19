/**
 * api/pdf-to-text.js — Convert an image-based (scanned) PDF to plain text
 *
 * POST /api/pdf-to-text
 * Body: {
 *   pdf_url       string   — public URL of the PDF to download
 *   title         string?  — document title (used if save=true)
 *   author        string?  — author name   (used if save=true)
 *   year          number?  — publication year
 *   page_batch    number?  — pages per Gemini call (default 12; max 20)
 *   save          boolean? — if true, stores extracted text in m8_knowledge_sources
 *   source_class  string?  — 'established' | 'speculative' (required when save=true)
 *   ingest        boolean? — if true, also runs ingest-book pipeline after save
 * }
 *
 * Returns: {
 *   text, word_count, pages_detected,
 *   batches_processed, source_id? (if save=true)
 * }
 *
 * Strategy:
 *   Gemini 1.5 Flash reads PDFs natively as multimodal input — no third-party
 *   OCR library needed. The PDF is uploaded once via the Gemini Files API, then
 *   queried in page batches to stay within the 8 192-token output limit per call.
 *   Each batch asks Gemini to extract only its page range.
 *   Total: ~1 Gemini call per 12 pages → 247 pages ≈ 21 calls ≈ 120 s.
 */

"use strict";

const { GoogleGenAI } = require("@google/genai");
const { ingestDocument, normalizeSourceClass } = require("../lib/knowledge-intake");
const {
  ocrDocKey,
  loadOcrCheckpoints,
  saveOcrBatch,
  batchesToProcess,
  ocrProgress,
  assembleOcrText,
} = require("../lib/converter");

const DEFAULT_BATCH = 12;
const MAX_BATCH     = 20;
const MAX_OUTPUT_TOKENS = 8000;

// Build-78a: bound OCR work per invocation so a large scan returns a "continue"
// signal instead of timing out; the caller re-POSTs to resume. Already-OCR'd
// page-batches are skipped via the m8_ocr_checkpoints table.
const MAX_OCR_BATCHES_PER_INVOCATION =
  Math.min(50, Math.max(1, parseInt(process.env.M8_OCR_MAX_BATCHES, 10) || 10));
const OCR_TIMEOUT_GUARD_MS = 8000;
const OCR_VERCEL_MAX_MS    = parseInt(process.env.VERCEL_MAX_DURATION_MS, 10) || 290000;

// Safety settings matching M8's global config (from lib/llm.js)
const SAFETY = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
];

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey });
}

// Upload the PDF buffer to Gemini Files API once; return the file URI.
async function uploadPdf(ai, buffer, displayName) {
  const blob = new Blob([buffer], { type: "application/pdf" });
  const resp = await ai.files.upload({
    file: blob,
    config: { mimeType: "application/pdf", displayName: displayName || "document.pdf" },
  });
  // Wait briefly for the file to become ACTIVE
  let uri = resp.uri || resp.file?.uri;
  if (!uri) throw new Error("File upload returned no URI");
  return uri;
}

// Ask Gemini how many pages the PDF has (quick probe, low tokens).
async function detectPageCount(ai, fileUri) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  try {
    const result = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { fileData: { mimeType: "application/pdf", fileUri } },
          { text: "How many pages does this PDF document have? Reply with only the integer number, nothing else." },
        ],
      }],
      config: { maxOutputTokens: 10, temperature: 0, safetySettings: SAFETY },
    });
    const raw = result.text || "";
    const match = raw.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  } catch {
    return null;
  }
}

// Extract text from a specific page range in the uploaded PDF.
async function extractPageBatch(ai, fileUri, startPage, endPage) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const result = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { fileData: { mimeType: "application/pdf", fileUri } },
        {
          text:
            `Extract the complete text from pages ${startPage} to ${endPage} of this PDF.\n` +
            `Rules:\n` +
            `- Output ONLY the extracted text, nothing else\n` +
            `- Preserve chapter headings and paragraph breaks\n` +
            `- Do not summarize, skip, or paraphrase any content\n` +
            `- If a page is blank or image-only with no text, write "[page ${startPage}-${endPage}: no text]"`,
        },
      ],
    }],
    config: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      safetySettings: SAFETY,
    },
  });
  return (result.text || "").trim();
}

// Delete the uploaded file from Gemini Files API (cleanup after use).
async function deleteFile(ai, fileUri) {
  try {
    // Extract the file name from the URI: "https://.../files/{name}"
    const name = fileUri.split("/files/")[1];
    if (name) await ai.files.delete({ name: `files/${name}` });
  } catch { /* non-fatal */ }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const {
    pdf_url,
    title,
    author,
    year,
    page_batch,
    save,
    source_class,
    ingest,
  } = req.body || {};

  if (!pdf_url) {
    return res.status(400).json({ error: "pdf_url is required" });
  }

  // Validate save params
  let cls = null;
  if (save || ingest) {
    cls = normalizeSourceClass(source_class);
    if (!cls) {
      return res.status(400).json({
        error: "source_class ('established' or 'speculative') is required when save=true",
      });
    }
    if (!title) {
      return res.status(400).json({ error: "title is required when save=true" });
    }
  }

  const batchSize = Math.min(Math.max(parseInt(page_batch) || DEFAULT_BATCH, 1), MAX_BATCH);

  // ── Step 1: Download PDF ────────────────────────────────────────
  let pdfBuffer;
  try {
    const resp = await fetch(pdf_url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching PDF`);
    const arrayBuf = await resp.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuf);
  } catch (e) {
    return res.status(400).json({ error: `Could not download PDF: ${e.message}` });
  }

  if (pdfBuffer.length < 1000) {
    return res.status(400).json({ error: "Downloaded file is too small to be a valid PDF" });
  }

  const ai = getAI();
  let fileUri;

  // ── Step 2: Upload PDF to Gemini Files API ──────────────────────
  try {
    fileUri = await uploadPdf(ai, pdfBuffer, title || "document.pdf");
  } catch (e) {
    return res.status(500).json({ error: `Gemini file upload failed: ${e.message}` });
  }

  // ── Step 3: Detect page count ───────────────────────────────────
  const pageCount = await detectPageCount(ai, fileUri);
  const totalPages = pageCount || 300; // conservative fallback

  // ── Step 4: Extract text in batches (Build-78a: resumable + checkpointed) ──
  // A page-batch is persisted to m8_ocr_checkpoints the moment it is OCR'd, so a
  // timeout on a later batch can never lose it. On re-POST the done batches are
  // skipped and only the remaining pages are sent to Gemini. When the checkpoint
  // table is missing (migration not applied) we fall back to a single-shot OCR.
  const docKey = ocrDocKey(title || pdf_url, pdf_url);
  let ocrCps = null;
  try { ocrCps = await loadOcrCheckpoints(docKey); }
  catch (e) { console.error("[pdf-to-text] loadOcrCheckpoints (non-fatal):", e.message); }
  const checkpointing = ocrCps !== null;

  const doneStarts = [];
  const doneRows   = [];
  if (checkpointing) {
    for (const [start, row] of ocrCps) { doneStarts.push(start); doneRows.push(row); }
  }

  // Only bound the batch count when we can actually resume; without the table a
  // bound would truncate the book with no way to finish it.
  const effMaxBatches = checkpointing ? MAX_OCR_BATCHES_PER_INVOCATION : totalPages;
  const todo = batchesToProcess(totalPages, batchSize, doneStarts, effMaxBatches);

  const newRows = [];
  let batchesProcessed = 0;
  let failed = 0;
  let timedOut = false;
  const startedAt = Date.now();

  for (const start of todo) {
    if (Date.now() - startedAt > OCR_VERCEL_MAX_MS - OCR_TIMEOUT_GUARD_MS) { timedOut = true; break; }
    const end = Math.min(start + batchSize - 1, totalPages);
    try {
      const chunk = await extractPageBatch(ai, fileUri, start, end);
      const keep = (chunk && !chunk.includes("[page")) || (chunk && chunk.length > 30);
      if (keep) {
        newRows.push({ batch_start: start, batch_end: end, page_text: chunk });
        if (checkpointing) {
          try {
            await saveOcrBatch({
              doc_key: docKey, batch_start: start, batch_end: end,
              page_text: chunk, total_pages: totalPages, title: title || null,
            });
          } catch (e) { console.error("[pdf-to-text] saveOcrBatch (non-fatal):", e.message); }
        }
      }
      batchesProcessed++;
      failed = 0;
    } catch (e) {
      console.error(`[pdf-to-text] batch ${start}-${end} failed:`, e.message);
      failed++;
      // Stop if too many consecutive failures (PDF may have ended)
      if (failed >= 3) break;
    }
  }

  // Cleanup: delete uploaded file from Gemini (storage costs). The PDF is
  // re-uploaded fresh on the next invocation if we still need to resume.
  await deleteFile(ai, fileUri);

  const allRows   = doneRows.concat(newRows);
  const fullText  = assembleOcrText(allRows);
  const wordCount = fullText.trim().split(/\s+/).length;

  // Resume contract: complete only when every batch is done and we didn't bail.
  const doneCount   = checkpointing ? allRows.length : batchesProcessed;
  const progress    = ocrProgress(totalPages, batchSize, doneCount);
  const ocrComplete = !checkpointing || (progress.complete && !timedOut);

  if (!ocrComplete) {
    // More pages remain — return a continue signal; do NOT save/ingest yet.
    const newDone = new Set(doneStarts);
    for (const r of newRows) newDone.add(r.batch_start);
    const nextBatch = batchesToProcess(totalPages, batchSize, [...newDone], 1)[0] || null;
    return res.status(200).json({
      ok:                true,
      done:              false,
      resume:            true,
      word_count:        wordCount,
      pages_detected:    pageCount,
      total_pages:       totalPages,
      batches_done:      progress.batches_done,
      batches_total:     progress.batches_total,
      batches_remaining: progress.batches_remaining,
      next_batch:        nextBatch,
      timed_out:         timedOut,
      checkpointing,
      message:           "OCR partial — re-POST the same body to resume from where it stopped.",
    });
  }

  if (wordCount < 50) {
    return res.status(422).json({
      error: "Extracted text is too short — the PDF may be encrypted or in an unsupported format",
      pages_detected: pageCount,
      batches_processed: batchesProcessed,
    });
  }

  // ── Step 5 (optional): Save to m8_knowledge_sources ────────────
  let source_id = null;
  if ((save || ingest) && cls) {
    try {
      const bookTitle = title || "Untitled Document";
      ({ source_id } = await ingestDocument({
        title:        bookTitle,
        text:         fullText,
        source_class: cls,
        notes:        JSON.stringify({ author: author || null, year: year || null, extracted_by: "gemini-pdf-ocr" }),
      }));

      // Write book metadata into the metadata column
      const { createClient } = require("@supabase/supabase-js");
      const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await db.from("m8_knowledge_sources").update({
        metadata: {
          book_title:    bookTitle,
          author:        author || null,
          year:          year   || null,
          pdf_url,
          extracted_by:  "gemini-pdf-ocr",
          pages:         pageCount,
        },
      }).eq("id", source_id);
    } catch (e) {
      console.error("[pdf-to-text] save error (non-fatal):", e.message);
    }
  }

  // ── Step 6 (optional): Trigger full book ingestion ──────────────
  // If ingest=true, chain through the ingest-book pipeline inline.
  // This extends total time significantly — only use with Vercel maxDuration=300.
  let ingestResult = null;
  if (ingest && cls) {
    try {
      const {
        extractConcepts,
        populateGraph,
        savePendingNodes,
      } = require("../lib/knowledge-intake");

      // Split extracted text into chapters and process each
      const { default: ingestBookFn } = await Promise.resolve().then(() =>
        ({ default: null }) // ingest-book is an HTTP handler, not a lib — call inline logic
      );

      // Direct call: chunk the full text and run extraction
      const words = fullText.trim().split(/\s+/);
      const CHUNK = 12000;
      let totalAdded = 0, totalPending = 0;
      const chunkIds = [];

      for (let i = 0; source_id && i < words.length; i += CHUNK) {
        const chunkText = words.slice(i, i + CHUNK).join(" ");
        const chunkNum  = Math.floor(i / CHUNK) + 1;
        let chunkSourceId;
        try {
          ({ source_id: chunkSourceId } = await ingestDocument({
            title:        `${title} — Part ${chunkNum}`,
            text:         chunkText,
            source_class: cls,
          }));
          chunkIds.push(chunkSourceId);
          const candidates = await extractConcepts(chunkSourceId);
          if (candidates.length) {
            const high = candidates.filter(c => c.extraction_confidence === "high");
            if (high.length) {
              const r = await populateGraph(high);
              totalAdded += r.added;
            }
            await savePendingNodes(chunkSourceId, candidates);
            totalPending += candidates.filter(c => c.extraction_confidence !== "high").length;
          }
        } catch (e) {
          console.error(`[pdf-to-text] ingest chunk ${chunkNum} error:`, e.message);
        }
      }
      ingestResult = { source_ids: chunkIds, total_added: totalAdded, total_pending: totalPending };
    } catch (e) {
      console.error("[pdf-to-text] ingest pipeline error:", e.message);
    }
  }

  return res.status(200).json({
    ok:                true,
    done:              true,
    resume:            false,
    word_count:        wordCount,
    pages_detected:    pageCount,
    total_pages:       totalPages,
    batches_processed: batchesProcessed,
    batches_total:     progress.batches_total,
    checkpointing,
    source_id:         source_id || null,
    ingest:            ingestResult,
    text:              fullText,
  });
};
