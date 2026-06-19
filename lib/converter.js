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

const { GoogleGenAI } = require("@google/genai");

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_BATCH    = 12;   // pages per Gemini extraction call
const MAX_OUTPUT    = 8000; // tokens per extraction call

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

async function convertPdf(buffer, displayName) {
  let lastErr;
  for (const apiKey of getGeminiKeys()) {
    try {
      const ai      = new GoogleGenAI({ apiKey });
      const fileUri = await uploadToGemini(ai, buffer, "application/pdf", displayName);

      let totalPages = 200;
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

      const parts = [];
      let batches = 0, failures = 0;

      for (let start = 1; start <= totalPages; start += PAGE_BATCH) {
        const end = Math.min(start + PAGE_BATCH - 1, totalPages);
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
          if (chunk && chunk.length > 20) parts.push(chunk);
          batches++;
          failures = 0;
        } catch (e) {
          console.error(`[converter] PDF batch ${start}-${end} failed:`, e.message);
          failures++;
          if (failures >= 3) break;
        }
      }

      await deleteGeminiFile(ai, fileUri);
      return { text: parts.join("\n\n"), batches, pages: totalPages };
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
async function convertUrl(url, format) {
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
      result = await convertPdf(buffer, url.split("/").pop());
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
};
