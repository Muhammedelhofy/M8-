/**
 * lib/converter.js — Universal format converter for M8
 *
 * Converts any supported document format to plain text, then optionally
 * ingests the result into M8's knowledge graph.
 *
 * Supported input formats:
 *   PDF (scanned or text-based)  — Gemini Files API, paginated extraction
 *   Image (JPG/PNG/GIF/WebP)     — Gemini vision inline
 *   EPUB                         — ZIP + HTML parsing (no external deps)
 *   HTML / URL                   — fetch + strip tags
 *   Plain text (.txt, .md)       — pass-through
 *
 * Provider strategy:
 *   1. Gemini (primary)  — native PDF + image support, BLOCK_ONLY_HIGH safety
 *   2. OpenRouter Pixtral (fallback for images if Gemini refuses content)
 */

"use strict";

const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_BATCH    = 12;   // pages per Gemini extraction call
const MAX_OUTPUT    = 8000; // tokens per extraction call

// ─── Build-78a: Resumable OCR checkpoints (PDF -> text) ───────────────────────
// A scanned PDF is OCR'd one page-batch at a time; Vercel kills the function at
// the wall-clock limit, so a large book never finishes OCR in one invocation and
// the batches done so far were lost. These helpers persist each batch's text so a
// re-run SKIPS already-OCR'd pages and resumes the rest. All callers degrade safe
// when the migration is not applied yet (the table-missing case returns null).

const OCR_CHECKPOINT_TABLE = "m8_ocr_checkpoints";

function ocrDb() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Stable key for a source PDF: title + path (query stripped so a re-presigned
// URL with new query params still resolves to the same OCR progress).
function ocrDocKey(title, pdfUrl) {
  const base = String(title || "") + "|" + String(pdfUrl || "").split("?")[0];
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 32);
}

function isMissingOcrTable(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;               // undefined_table
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find the table") ||
         msg.includes("schema cache");
}

/**
 * PURE: which batch start-pages to OCR this invocation. Batches are 1-indexed and
 * step by batchSize; skips already-done starts; bounds the batch to maxPerInvocation
 * so a single invocation returns a continue signal instead of timing out.
 * Mirrored by tests/B78-ocr-resume-verify.ps1.
 */
function batchesToProcess(totalPages, batchSize, doneStarts, maxPerInvocation) {
  const step = Math.max(1, batchSize || 1);
  const cap  = Math.max(1, maxPerInvocation || 1);
  const done = new Set((doneStarts || []).map(Number));
  const todo = [];
  for (let s = 1; s <= totalPages && todo.length < cap; s += step) {
    if (!done.has(s)) todo.push(s);
  }
  return todo;
}

/**
 * PURE: OCR progress in batch units given how many batches are done.
 * Mirrored by tests/B78-ocr-resume-verify.ps1.
 */
function ocrProgress(totalPages, batchSize, doneCount) {
  const step  = Math.max(1, batchSize || 1);
  const total = Math.max(0, Math.ceil((totalPages || 0) / step));
  const done  = Math.min(Math.max(0, doneCount || 0), total);
  return {
    batches_total:     total,
    batches_done:      done,
    batches_remaining: Math.max(0, total - done),
    complete:          total > 0 && done >= total,
  };
}

/**
 * PURE: stitch the full text from checkpoint rows in page order. Accepts rows
 * shaped { batch_start, page_text }. Mirrored by tests/B78-ocr-resume-verify.ps1.
 */
function assembleOcrText(rows) {
  return (rows || [])
    .slice()
    .sort((a, b) => (a.batch_start || 0) - (b.batch_start || 0))
    .map((r) => r.page_text || "")
    .filter((t) => t && t.trim().length)
    .join("\n\n");
}

// Load OCR checkpoints for a doc as a Map<batch_start, row>. Returns null (not an
// empty Map) when the table is missing, so callers can fall back to a fresh OCR.
async function loadOcrCheckpoints(docKey) {
  const { data, error } = await ocrDb()
    .from(OCR_CHECKPOINT_TABLE)
    .select("batch_start, batch_end, page_text, total_pages")
    .eq("doc_key", docKey);
  if (error) {
    if (isMissingOcrTable(error)) return null;
    throw new Error(`loadOcrCheckpoints failed: ${error.message}`);
  }
  const map = new Map();
  for (const row of data || []) map.set(row.batch_start, row);
  return map;
}

// Upsert one OCR batch. Returns false (never throws) when the table is missing.
async function saveOcrBatch(row) {
  const { error } = await ocrDb()
    .from(OCR_CHECKPOINT_TABLE)
    .upsert({
      doc_key:     row.doc_key,
      batch_start: row.batch_start,
      batch_end:   row.batch_end || null,
      page_text:   row.page_text || "",
      status:      "done",
      total_pages: row.total_pages || null,
      title:       row.title || null,
      updated_at:  new Date().toISOString(),
    }, { onConflict: "doc_key,batch_start" });
  if (error) {
    if (isMissingOcrTable(error)) return false;
    throw new Error(`saveOcrBatch failed: ${error.message}`);
  }
  return true;
}

const SAFETY = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
];

const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const PDF_TYPES   = new Set(["pdf"]);
const EPUB_TYPES  = new Set(["epub"]);
const TEXT_TYPES  = new Set(["txt", "md", "markdown", "rst", "csv"]);

// ─── Format detection ─────────────────────────────────────────────────────────

function detectFormat(url, contentType) {
  // Try extension first
  const ext = (url || "").split("?")[0].split(".").pop().toLowerCase();
  if (PDF_TYPES.has(ext))   return "pdf";
  if (IMAGE_TYPES.has(ext)) return "image";
  if (EPUB_TYPES.has(ext))  return "epub";
  if (TEXT_TYPES.has(ext))  return "text";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "docx" || ext === "doc") return "docx";

  // Fall back to content-type header
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("pdf"))        return "pdf";
  if (ct.includes("epub"))       return "epub";
  if (ct.includes("image/"))     return "image";
  if (ct.includes("html"))       return "html";
  if (ct.includes("text/plain")) return "text";

  return "unknown";
}

// ─── Gemini helpers ───────────────────────────────────────────────────────────

function getGeminiKeys() {
  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
  if (!keys.length) throw new Error("No Gemini API key configured");
  return keys;
}

function isQuotaError(e) {
  const msg = (e?.message || "").toLowerCase();
  return e?.status === 429 || msg.includes("429") || msg.includes("quota") ||
         msg.includes("resource_exhausted") || msg.includes("prepayment");
}

function getGemini() {
  const keys = getGeminiKeys();
  return new GoogleGenAI({ apiKey: keys[0] });
}

async function geminiGenerate(ai, parts, maxOutputTokens = MAX_OUTPUT) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const result = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { maxOutputTokens, temperature: 0, safetySettings: SAFETY },
  });
  return (result.text || "").trim();
}

// Upload a buffer to Gemini Files API; return URI.
async function uploadToGemini(ai, buffer, mimeType, displayName) {
  const blob = new Blob([buffer], { type: mimeType });
  const resp = await ai.files.upload({
    file: blob,
    config: { mimeType, displayName: displayName || "file" },
  });
  const uri = resp.uri || resp.file?.uri;
  if (!uri) throw new Error("Gemini file upload returned no URI");
  return uri;
}

async function deleteGeminiFile(ai, fileUri) {
  try {
    const name = fileUri.split("/files/")[1];
    if (name) await ai.files.delete({ name: `files/${name}` });
  } catch { /* non-fatal */ }
}

// ─── PDF converter ─────────────────────────────────────────────────────────

// opts (all optional; when omitted, behaviour is identical to pre-Build-78a):
//   docKey     — enable resumable OCR: skip already-OCR'd batches, persist each
//                batch's text as it completes (survives a timeout).
//   maxBatches — bound NEW batches this invocation; on hitting it, complete:false.
//   totalPagesHint — skip the page-count probe (the caller already knows it).
async function convertPdf(buffer, displayName, opts = {}) {
  const { docKey = null, maxBatches = null, totalPagesHint = null } = opts || {};

  // Resume state: load already-OCR'd batches (null => table missing => fresh OCR).
  let cps = null;
  if (docKey) {
    try { cps = await loadOcrCheckpoints(docKey); }
    catch (e) { console.error("[converter] loadOcrCheckpoints (non-fatal):", e.message); }
  }
  const doneStarts = new Set();
  const doneRows = [];
  if (cps) {
    for (const [start, row] of cps) { doneStarts.add(start); doneRows.push(row); }
  }

  let lastErr;
  for (const apiKey of getGeminiKeys()) {
    try {
      const ai      = new GoogleGenAI({ apiKey });
      const fileUri = await uploadToGemini(ai, buffer, "application/pdf", displayName);

      let totalPages = totalPagesHint || 200;
      if (!totalPagesHint) {
        try {
          const probe = await geminiGenerate(ai,
            [
              { fileData: { mimeType: "application/pdf", fileUri } },
              { text: "How many pages does this PDF have? Reply with only the integer." },
            ],
            10
          );
          const m = probe.match(/\d+/);
          if (m) totalPages = parseInt(m[0], 10);
        } catch { /* use fallback */ }
      }

      const newRows = [];
      let batches = 0, failures = 0, cappedOut = false;

      for (let start = 1; start <= totalPages; start += PAGE_BATCH) {
        const end = Math.min(start + PAGE_BATCH - 1, totalPages);
        if (doneStarts.has(start)) continue;            // already OCR'd — skip
        if (maxBatches && batches >= maxBatches) { cappedOut = true; break; }
        try {
          const chunk = await geminiGenerate(ai, [
            { fileData: { mimeType: "application/pdf", fileUri } },
            {
              text:
                `Extract ALL text from pages ${start} to ${end} of this PDF.\n` +
                `Output only the extracted text. Preserve chapter headings and paragraphs.\n` +
                `Do not summarize or skip any content.`,
            },
          ]);
          if (chunk && chunk.length > 20) {
            newRows.push({ batch_start: start, batch_end: end, page_text: chunk });
            // Persist immediately so a timeout on the NEXT batch can't lose this one.
            if (docKey) {
              try { await saveOcrBatch({ doc_key: docKey, batch_start: start, batch_end: end, page_text: chunk, total_pages: totalPages, title: displayName }); }
              catch (e) { console.error("[converter] saveOcrBatch (non-fatal):", e.message); }
            }
          }
          batches++;
          failures = 0;
        } catch (e) {
          console.error(`[converter] PDF batch ${start}-${end} failed:`, e.message);
          failures++;
          if (failures >= 3) break;
        }
      }

      await deleteGeminiFile(ai, fileUri);
      const allRows = doneRows.concat(newRows);
      const text = docKey ? assembleOcrText(allRows) : newRows.map((r) => r.page_text).join("\n\n");
      return { text, batches, pages: totalPages, complete: !cappedOut, resumed: doneRows.length > 0 };
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── Image converter ──────────────────────────────────────────────────────────

async function convertImage(buffer, mimeType) {
  const base64 = buffer.toString("base64");

  // Try each Gemini key before falling back to OpenRouter/Pixtral
  let geminiErr;
  for (const apiKey of getGeminiKeys()) {
    try {
      const ai   = new GoogleGenAI({ apiKey });
      const text = await geminiGenerate(ai, [
        { inlineData: { mimeType, data: base64 } },
        {
          text:
            "Extract all readable text from this image exactly as written.\n" +
            "Preserve layout as much as possible. Output only the extracted text.",
        },
      ]);
      return { text, batches: 1, pages: 1 };
    } catch (e) {
      if (!isQuotaError(e)) { geminiErr = e; break; }
      geminiErr = e;
    }
  }

  // Gemini exhausted — try OpenRouter/Pixtral fallback
  if (process.env.OPENROUTER_API_KEY) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mistralai/pixtral-12b",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: "text", text: "Extract all text from this image. Output only the extracted text." },
          ],
        }],
        temperature: 0,
      }),
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return { text, batches: 1, pages: 1 };
  }
  throw geminiErr;
}

// ─── EPUB converter ───────────────────────────────────────────────────────────
// EPUB is a ZIP archive containing HTML files. Parsed without external deps
// using Node.js Buffer + manual ZIP chunk walking.

async function convertEpub(buffer) {
  // Minimal ZIP reader — finds all stored/deflated entries
  const entries = parseZip(buffer);

  // Find the OPF manifest to get reading order
  let spine = [];
  const opfEntry = entries.find(e =>
    e.name.endsWith(".opf") ||
    e.name.includes("content.opf") ||
    e.name.includes("package.opf")
  );

  if (opfEntry) {
    const opfText = inflateEntry(opfEntry, buffer).toString("utf8");
    // Extract itemref order from <spine>
    const idRefs = [...opfText.matchAll(/<itemref[^>]+idref="([^"]+)"/gi)].map(m => m[1]);
    // Map ids to hrefs from manifest
    const itemMap = {};
    for (const m of opfText.matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"/gi)) {
      itemMap[m[1]] = m[2];
    }
    spine = idRefs.map(id => itemMap[id]).filter(Boolean);
  }

  // Collect HTML/XHTML entries in spine order, then remainder
  const htmlEntries = entries.filter(e =>
    e.name.endsWith(".html") || e.name.endsWith(".xhtml") || e.name.endsWith(".htm")
  );

  const ordered = spine.length
    ? [
        ...spine.map(href => htmlEntries.find(e => e.name.endsWith(href))).filter(Boolean),
        ...htmlEntries.filter(e => !spine.some(href => e.name.endsWith(href))),
      ]
    : htmlEntries;

  const textParts = ordered.map(entry => {
    const html = inflateEntry(entry, buffer).toString("utf8");
    return stripHtml(html);
  }).filter(t => t.trim().length > 20);

  return { text: textParts.join("\n\n"), batches: textParts.length, pages: textParts.length };
}

// ─── Minimal ZIP parser (no external deps) ───────────────────────────────────
// Reads the End of Central Directory record → Central Directory → local entries.

function parseZip(buf) {
  // Find End of Central Directory signature (0x06054b50)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      eocdOffset = i; break;
    }
  }
  if (eocdOffset < 0) throw new Error("Not a valid ZIP/EPUB file");

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const entries = [];
  let pos = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const compression   = buf.readUInt16LE(pos + 10);
    const compSize      = buf.readUInt32LE(pos + 20);
    const uncompSize    = buf.readUInt32LE(pos + 24);
    const nameLen       = buf.readUInt16LE(pos + 28);
    const extraLen      = buf.readUInt16LE(pos + 30);
    const commentLen    = buf.readUInt16LE(pos + 32);
    const localOffset   = buf.readUInt32LE(pos + 42);
    const name          = buf.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
    entries.push({ name, compression, compSize, uncompSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(entry, buf) {
  const localNameLen  = buf.readUInt16LE(entry.localOffset + 26);
  const localExtraLen = buf.readUInt16LE(entry.localOffset + 28);
  const dataStart     = entry.localOffset + 30 + localNameLen + localExtraLen;
  const data          = buf.slice(dataStart, dataStart + entry.compSize);

  if (entry.compression === 0) return data; // stored
  if (entry.compression === 8) {
    // deflate
    const zlib = require("zlib");
    return zlib.inflateRawSync(data);
  }
  throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
}

// ─── HTML / URL converter ─────────────────────────────────────────────────────

async function convertHtml(buffer) {
  const html = buffer.toString("utf8");
  return { text: stripHtml(html), batches: 1, pages: 1 };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Text pass-through ────────────────────────────────────────────────────────

async function convertText(buffer) {
  return { text: buffer.toString("utf8"), batches: 1, pages: 1 };
}

// Word (.docx) — mammoth extracts text; strips all formatting, keeps structure.
async function convertDocx(buffer) {
  const mammoth = require("mammoth");
  const result  = await mammoth.extractRawText({ buffer });
  const text    = (result.value || "").trim();
  if (!text) throw new Error("mammoth extracted no text from this .docx file");
  // Estimate pages: ~300 words per page
  const wordCount = text.split(/\s+/).length;
  const pages     = Math.max(1, Math.round(wordCount / 300));
  return { text, batches: 1, pages };
}

// ─── Main convert function ────────────────────────────────────────────────────

/**
 * Convert a document at `url` to plain text.
 *
 * @param {string} url        — public URL to fetch the document from
 * @param {string} [format]   — override auto-detected format
 * @returns {{ text, format, word_count, pages, batches }}
 */
async function convertUrl(url, format, opts = {}) {
  // Fetch document
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const contentType = resp.headers.get("content-type") || "";
  const arrayBuf = await resp.arrayBuffer();
  const buffer   = Buffer.from(arrayBuf);

  const fmt = format || detectFormat(url, contentType);

  let result;
  switch (fmt) {
    case "pdf":
      // opts may carry { docKey, maxBatches, totalPagesHint } for resumable OCR.
      result = await convertPdf(buffer, url.split("/").pop(), opts.pdf || {});
      break;
    case "docx":
      result = await convertDocx(buffer);
      break;
    case "image": {
      // Derive MIME type from extension or content-type
      const ext  = url.split("?")[0].split(".").pop().toLowerCase();
      const mime = contentType.includes("image/") ? contentType.split(";")[0].trim()
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png"  ? "image/png"
        : ext === "gif"  ? "image/gif"
        : ext === "webp" ? "image/webp"
        : "image/jpeg";
      result = await convertImage(buffer, mime);
      break;
    }
    case "epub":
      result = await convertEpub(buffer);
      break;
    case "html":
      result = await convertHtml(buffer);
      break;
    case "text":
      result = await convertText(buffer);
      break;
    default:
      // Unknown format — try Gemini as a generic extractor
      result = await convertPdf(buffer, url.split("/").pop());
  }

  return {
    format:     fmt,
    text:       result.text,
    word_count: result.text.trim().split(/\s+/).length,
    pages:      result.pages,
    batches:    result.batches,
    complete:   result.complete !== false,   // non-PDF formats are always complete
    resumed:    !!result.resumed,
  };
}

// ─── Chat detection ───────────────────────────────────────────────────────────

// Matches: "convert this PDF", "M8 read this image", "extract text from [url]",
// "ingest this epub", "turn this into text", "convert [url]"
const CONVERT_RE = /\b(?:convert|extract\s+text|read\s+(?:this|the)\s+(?:pdf|image|file|document|epub)|turn\s+(?:this|the)\s+(?:pdf|file|document)\s+into\s+text|ingest\s+(?:this\s+)?(?:pdf|image|epub|file|document)|ocr\s+(?:this|the))\b/i;
const URL_RE     = /https?:\/\/\S+/;

function detectConvertRequest(message) {
  return CONVERT_RE.test(message || "") && URL_RE.test(message || "");
}

function parseConvertMessage(message) {
  const urlMatch = URL_RE.exec(message || "");
  const url      = urlMatch ? urlMatch[0].replace(/[.,;)>]+$/, "") : null;

  const classMatch = /\b(established|speculative)\b/i.exec(message);
  const source_class = classMatch ? classMatch[1].toLowerCase() : null;

  // Ingest intent: "convert and ingest", "add to M8", "store in M8"
  const ingest = /\b(ingest|add\s+to\s+m8|store\s+in\s+m8|save\s+to\s+m8|and\s+ingest)\b/i.test(message);

  // Format override
  const fmtMatch = /\b(pdf|image|epub|html|txt)\b/i.exec(message);
  const format   = fmtMatch ? fmtMatch[1].toLowerCase() : null;

  // Title: anything in quotes
  const titleMatch = /["']([^"']{3,100})["']/.exec(message);
  const title      = titleMatch ? titleMatch[1] : null;

  return { url, source_class, ingest, format, title };
}

/**
 * Full pipeline: detect → download → convert → optionally ingest.
 * Returns a chat-ready context packet for the orchestrator.
 */
async function buildConvertContext(message) {
  if (!detectConvertRequest(message)) return { text: "", data: null };

  const { url, source_class, ingest, format, title } = parseConvertMessage(message);

  if (!url) {
    return {
      text: "FORMAT CONVERT — no URL found in message. Please include a direct link to the file.",
      data: null,
    };
  }

  let converted;
  try {
    converted = await convertUrl(url, format || undefined);
  } catch (e) {
    return {
      text: `FORMAT CONVERT — failed to convert file: ${e.message}`,
      data: null,
    };
  }

  const { text, word_count, pages, format: detectedFormat } = converted;

  if (word_count < 30) {
    return {
      text: `FORMAT CONVERT — extracted text is too short (${word_count} words). The file may be encrypted, empty, or in an unsupported format.`,
      data: null,
    };
  }

  // Optionally ingest into knowledge graph
  let ingestResult = null;
  if (ingest) {
    const cls = source_class || "speculative"; // default speculative for unknown docs
    try {
      const { ingestDocument, extractConcepts, populateGraph, savePendingNodes } = require("./knowledge-intake");
      const docTitle = title || url.split("/").pop().replace(/\.[^.]+$/, "") || "Converted document";

      // Large docs: chunk into 12K-word batches
      const CHUNK_W = 12000;
      const words = text.trim().split(/\s+/);
      let totalAdded = 0, totalPending = 0;
      const sourceIds = [];

      for (let i = 0; i < words.length; i += CHUNK_W) {
        const chunk    = words.slice(i, i + CHUNK_W).join(" ");
        const partNum  = Math.floor(i / CHUNK_W) + 1;
        const partTitle = words.length > CHUNK_W ? `${docTitle} — Part ${partNum}` : docTitle;
        try {
          const { source_id } = await ingestDocument({ title: partTitle, text: chunk, source_class: cls });
          sourceIds.push(source_id);
          const candidates = await extractConcepts(source_id);
          if (candidates.length) {
            const high = candidates.filter(c => c.extraction_confidence === "high");
            if (high.length) { const r = await populateGraph(high); totalAdded += r.added; }
            await savePendingNodes(source_id, candidates);
            totalPending += candidates.filter(c => c.extraction_confidence !== "high").length;
          }
        } catch (e) {
          console.error(`[converter] ingest part ${partNum} error:`, e.message);
        }
      }
      ingestResult = { source_ids: sourceIds, total_added: totalAdded, total_pending: totalPending };
    } catch (e) {
      console.error("[converter] ingest error (non-fatal):", e.message);
    }
  }

  const summary = [
    `FORMAT CONVERT RESULT — your response MUST start with this line:`,
    `"Converted ${detectedFormat.toUpperCase()} (${pages} pages, ${word_count.toLocaleString()} words)${ingestResult ? ` — ingested: ${ingestResult.total_added} nodes written, ${ingestResult.total_pending} pending` : ''}"`,
    ``,
    `Format detected: ${detectedFormat}`,
    `Words extracted: ${word_count.toLocaleString()}`,
    `Pages/sections: ${pages}`,
    ingestResult
      ? `Knowledge graph: ${ingestResult.total_added} nodes written, ${ingestResult.total_pending} pending review`
      : `Text extracted successfully. To add to M8's knowledge: re-send with "ingest" in your message.`,
    ``,
    `EXTRACTED TEXT PREVIEW (first 400 chars):`,
    text.slice(0, 400).trim(),
    `[... ${word_count.toLocaleString()} words total]`,
  ].join("\n");

  return {
    text: summary,
    data: { format: detectedFormat, word_count, pages, url, ingest: ingestResult },
  };
}

module.exports = {
  convertUrl,
  detectConvertRequest,
  parseConvertMessage,
  buildConvertContext,
  detectFormat,
  // Build-78a: resumable OCR checkpoints
  ocrDocKey, loadOcrCheckpoints, saveOcrBatch,
  batchesToProcess, ocrProgress, assembleOcrText, isMissingOcrTable,
};
