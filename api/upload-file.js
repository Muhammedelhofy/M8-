/**
 * api/upload-file.js — Accept a base64-encoded document and convert it to text
 *
 * Called by the M8 frontend when a user attaches a PDF or EPUB file.
 * The file is sent as base64 (never stored to disk — processed in memory).
 *
 * POST /api/upload-file
 * Body: { data: string (base64), name: string, mimeType: string }
 * Returns: { text, word_count, pages, format }
 *
 * Body size limit: 20 MB (covers an ~14 MB binary file base64-encoded).
 */

"use strict";

const { convertUrl, detectFormat } = require("../lib/converter");

// Expose config for Vercel body parser size override
module.exports.config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};

// Re-use converter internals for buffer-based conversion (no URL fetch needed)
async function convertBuffer(buffer, mimeType, name, confirmed = false) {
  // Dynamically import the internal converters from lib/converter.js
  // by reconstructing the same logic — avoids re-exporting private functions
  const fmt = detectFormat(name || "", mimeType || "");

  // Inline minimal dispatcher (mirrors lib/converter.js convertUrl logic)
  const { GoogleGenAI } = require("@google/genai");

  if (fmt === "docx") {
    const mammoth = require("mammoth");
    const result  = await mammoth.extractRawText({ buffer });
    const text    = (result.value || "").trim();
    if (!text) throw new Error("mammoth extracted no text from this .docx file");
    const words = text.split(/\s+/).length;
    return { text, pages: Math.max(1, Math.round(words / 300)), format: "docx" };
  }

  if (fmt === "epub") {
    // Use the EPUB parser directly
    const zlib = require("zlib");

    function parseZip(buf) {
      let eocdOffset = -1;
      for (let i = buf.length - 22; i >= 0; i--) {
        if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
          eocdOffset = i; break;
        }
      }
      if (eocdOffset < 0) throw new Error("Not a valid ZIP/EPUB file");
      const cdOffset  = buf.readUInt32LE(eocdOffset + 16);
      const cdEntries = buf.readUInt16LE(eocdOffset + 8);
      const entries = [];
      let pos = cdOffset;
      for (let i = 0; i < cdEntries; i++) {
        if (buf.readUInt32LE(pos) !== 0x02014b50) break;
        const compression = buf.readUInt16LE(pos + 10);
        const compSize    = buf.readUInt32LE(pos + 20);
        const uncompSize  = buf.readUInt32LE(pos + 24);
        const nameLen     = buf.readUInt16LE(pos + 28);
        const extraLen    = buf.readUInt16LE(pos + 30);
        const commentLen  = buf.readUInt16LE(pos + 32);
        const localOffset = buf.readUInt32LE(pos + 42);
        const entryName   = buf.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
        entries.push({ name: entryName, compression, compSize, uncompSize, localOffset });
        pos += 46 + nameLen + extraLen + commentLen;
      }
      return entries;
    }

    function inflateEntry(entry, buf) {
      const localNameLen  = buf.readUInt16LE(entry.localOffset + 26);
      const localExtraLen = buf.readUInt16LE(entry.localOffset + 28);
      const dataStart     = entry.localOffset + 30 + localNameLen + localExtraLen;
      const data          = buf.slice(dataStart, dataStart + entry.compSize);
      if (entry.compression === 0) return data;
      if (entry.compression === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported ZIP compression: ${entry.compression}`);
    }

    function stripHtml(html) {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/\s{2,}/g, " ").trim();
    }

    const entries    = parseZip(buffer);
    const htmlEntries = entries.filter(e => /\.(html?|xhtml)$/i.test(e.name));
    const parts      = htmlEntries.map(e => stripHtml(inflateEntry(e, buffer).toString("utf8"))).filter(t => t.length > 20);
    const text       = parts.join("\n\n");
    return { text, pages: parts.length, format: "epub" };
  }

  // PDF and images: use Gemini
  // BLOCK_NONE: historical/academic documents (polar mythology, occultism, etc.)
  // must not be filtered — we are doing OCR/extraction, not generation.
  const SAFETY = [
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  ];

  const geminiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
  ].filter(Boolean);
  if (!geminiKeys.length) throw new Error("No Gemini API key configured");
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  // Returns true if the error is a quota/rate-limit that warrants trying the next key.
  function isQuotaError(e) {
    const msg = (e?.message || "").toLowerCase();
    return e?.status === 429 || msg.includes("429") || msg.includes("quota") ||
           msg.includes("resource_exhausted") || msg.includes("prepayment");
  }

  if (fmt === "image") {
    let lastErr;
    for (const apiKey of geminiKeys) {
      try {
        const ai     = new GoogleGenAI({ apiKey });
        const base64 = buffer.toString("base64");
        const result = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: "Extract all readable text from this image exactly as written. Output only the extracted text." },
          ]}],
          config: { maxOutputTokens: 8000, temperature: 0, safetySettings: SAFETY },
        });
        return { text: result.text || "", pages: 1, format: "image" };
      } catch (e) {
        if (!isQuotaError(e)) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  }

  // PDF — upload to Gemini Files API then extract in parallel batches.
  // PAGE_BATCH = 8: 8 pages ≈ 2,500–3,500 words ≈ 3,500–5,000 tokens,
  // well within the 8,192 output-token limit.
  const PAGE_BATCH = 8;

  // ── COST GUARD ────────────────────────────────────────────────────────────
  // Each Gemini batch call sends the full PDF as context — costs scale with
  // pages. Warn (confirmation gate) at 200 PDF pages (~$0.40 max per upload).
  // If the caller sends { confirmed: true } in the request body, proceed anyway.
  const MAX_PDF_PAGES  = 200;
  const estimatedPages = Math.max(Math.ceil(buffer.length / (80 * 1024)), 10);
  // estimatedCostUSD: (pages / PAGE_BATCH) batches * 8192 output tokens * $0.30/M
  const estimatedCostUSD = Number(((estimatedPages / 8) * 8192 * 0.30 / 1_000_000).toFixed(4));
  if (estimatedPages > MAX_PDF_PAGES && !confirmed) {
    // Throw a sentinel that the handler catches and converts to requiresConfirmation
    const err = new Error("REQUIRES_CONFIRMATION");
    err.requiresConfirmation = true;
    err.estimatedPages = estimatedPages;
    err.estimatedCostUSD = estimatedCostUSD;
    throw err;
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Free Gemini tier is rate-limited (RPM + TPM). Firing many full-PDF OCR calls
  // at once instantly trips 429. Keep concurrency low and back off on 429.
  // Override with M8_OCR_CONCURRENCY if a paid key lifts the quota.
  const CONCURRENCY     = Math.min(10, Math.max(1, parseInt(process.env.M8_OCR_CONCURRENCY, 10) || 3));
  const EMPTY_ROUND_CAP = 2;
  const PAGE_SAFETY_CAP = Math.min(estimatedPages * 2, MAX_PDF_PAGES * 2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const AI_NOTE_RE = /^\[(?:document continues|note:|remaining chapters|this is page|truncated|the pdf|pages \d)/i;

  function removeTokenLoops(text) {
    if (!text || text.length < 300) return text;
    const lines = text.split("\n");
    const out = [];
    let prevLine = "";
    let streak = 0;
    for (const line of lines) {
      const norm = line.trim();
      if (norm.length > 20) {
        if (norm === prevLine) { streak++; if (streak >= 4) break; }
        else { streak = 0; prevLine = norm; }
      }
      out.push(line);
    }
    return out.join("\n");
  }

  // Try each Gemini key in turn. The file upload and all batch extractions
  // must use the SAME key (Files API URIs are scoped to the uploading project).
  let lastPdfErr;
  for (const apiKey of geminiKeys) {
    try {
      const ai      = new GoogleGenAI({ apiKey });
      const blob    = new Blob([buffer], { type: "application/pdf" });
      const upload  = await ai.files.upload({ file: blob, config: { mimeType: "application/pdf", displayName: name || "upload.pdf" } });
      const fileUri = upload.uri || upload.file?.uri;
      const fileName = upload.name || upload.file?.name ||
        (fileUri && fileUri.includes("/files/") ? `files/${fileUri.split("/files/")[1]}` : null);
      if (!fileUri) throw new Error("Gemini file upload returned no URI");

      // Wait for the uploaded PDF to reach ACTIVE state. Querying it while it is
      // still PROCESSING makes EVERY page-batch fail (silently) and yields 0 text
      // -- the "Conversion failed" with no logged error. Poll up to ~20s.
      if (fileName) {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          let st;
          try { const meta = await ai.files.get({ name: fileName }); st = (meta && (meta.state || (meta.file && meta.file.state))); }
          catch (e) { break; }   // get not supported / transient — proceed and let batches report
          if (st === "ACTIVE") break;
          if (st === "FAILED") throw new Error("Gemini failed to process the uploaded PDF (state FAILED)");
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Surface per-batch failures instead of swallowing them, so an all-empty
      // OCR yields a real diagnostic (count + first error) rather than 0 text.
      let batchErrors = 0, firstBatchErr = "";
      const BATCH_TRIES = 4;   // retry 429s with backoff before giving up on a batch
      async function extractBatch(start, end) {
        for (let attempt = 1; attempt <= BATCH_TRIES; attempt++) {
          try {
            const r = await ai.models.generateContent({
              model,
              contents: [{ role: "user", parts: [
                { fileData: { mimeType: "application/pdf", fileUri } },
                {
                  text:
                    `Extract the raw text from pages ${start} to ${end} of this PDF document.\n` +
                    `Rules (follow exactly):\n` +
                    `- Output ONLY the verbatim text as it appears on those pages.\n` +
                    `- Preserve chapter headings and paragraph breaks.\n` +
                    `- Do NOT add any notes, comments, summaries, or explanations.\n` +
                    `- Do NOT write things like "[Document continues]", "[End of extraction]", "[Note: ...]", or any brackets.\n` +
                    `- If a page has no readable text, output nothing for that page and move on.\n` +
                    `- Stop when you have extracted pages ${end}. Do not go beyond page ${end}.`,
                },
              ]}],
              config: { maxOutputTokens: 8192, temperature: 0, safetySettings: SAFETY },
            });
            const raw = (r.text || "").trim();
            if (AI_NOTE_RE.test(raw)) return { start, text: "" };
            return { start, text: removeTokenLoops(raw) };
          } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            const is429 = (e && e.status === 429) || /\b429\b|quota|rate.?limit|resource_exhausted/i.test(msg);
            if (is429 && attempt < BATCH_TRIES) { await sleep(attempt * 6000); continue; }  // 6s,12s,18s
            batchErrors++;
            if (!firstBatchErr) firstBatchErr = msg;
            console.error(`[upload-file] OCR batch ${start}-${end} failed (attempt ${attempt}):`, msg);
            return { start, text: "" };
          }
        }
        return { start, text: "" };
      }

      const batchResults = [];
      let nextStart   = 1;
      let emptyRounds = 0;

      while (emptyRounds < EMPTY_ROUND_CAP && nextStart <= PAGE_SAFETY_CAP) {
        const chunk = [];
        for (let i = 0; i < CONCURRENCY && nextStart <= PAGE_SAFETY_CAP; i++) {
          chunk.push({ start: nextStart, end: nextStart + PAGE_BATCH - 1 });
          nextStart += PAGE_BATCH;
        }
        const results = await Promise.all(chunk.map(({ start, end }) => extractBatch(start, end)));
        batchResults.push(...results);
        const allEmpty = results.every(r => (r.text || "").length < 30);
        emptyRounds = allEmpty ? emptyRounds + 1 : 0;
      }

      const totalPages = batchResults
        .filter(r => (r.text || "").length >= 30)
        .reduce((max, r) => Math.max(max, r.start + PAGE_BATCH - 1), 1);

      const parts = batchResults
        .sort((a, b) => a.start - b.start)
        .map(r => r.text)
        .filter(t => t.length > 10);

      try {
        const fname = fileUri.split("/files/")[1];
        if (fname) await ai.files.delete({ name: `files/${fname}` });
      } catch { /* non-fatal */ }

      // 0 text extracted: report WHY (batch error count + first error) instead of
      // returning empty text that the UI shows as a bare "Conversion failed".
      if (!parts.length) {
        const detail = batchErrors > 0
          ? `${batchErrors} OCR batch error(s)${firstBatchErr ? `; first: ${firstBatchErr.slice(0, 200)}` : ""}`
          : "the model returned no text for any page (the scan may be unreadable or blocked)";
        throw new Error(`OCR produced no text from this PDF — ${detail}`);
      }

      return { text: parts.join("\n\n"), pages: totalPages, format: "pdf" };
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      lastPdfErr = e;
    }
  }
  throw lastPdfErr;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { data, storagePath, name, mimeType, confirmed } = req.body || {};

  let buffer;

  let sbForCleanup = null;
  if (storagePath) {
    // File was uploaded directly to Supabase Storage — download it here
    const { createClient } = require("@supabase/supabase-js");
    sbForCleanup = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    );
    const { data: blob, error } = await sbForCleanup.storage.from("temp-uploads").download(storagePath);
    if (error) return res.status(500).json({ error: `Storage download failed: ${error.message}` });
    const arrayBuf = await blob.arrayBuffer();
    buffer = Buffer.from(arrayBuf);
  } else if (data) {
    // Legacy small-file path: base64-encoded body (≤ 4.5 MB Vercel limit)
    try {
      buffer = Buffer.from(data, "base64");
    } catch (e) {
      return res.status(400).json({ error: "Invalid base64 data" });
    }
  } else {
    return res.status(400).json({ error: "Either storagePath or data (base64) is required" });
  }

  if (buffer.length < 100) {
    return res.status(400).json({ error: "File too small to be valid" });
  }

  try {
    const result = await convertBuffer(buffer, mimeType, name, !!confirmed);
    const word_count = result.text.trim().split(/\s+/).length;
    if (sbForCleanup && storagePath) {
      sbForCleanup.storage.from("temp-uploads").remove([storagePath]).catch(() => {});
    }
    return res.status(200).json({
      text:       result.text,
      word_count,
      pages:      result.pages,
      format:     result.format,
    });
  } catch (e) {
    // Confirmation gate: PDF too large — return special response so the frontend
    // can show the user an estimated cost and ask them to confirm.
    // Do NOT clean up here — the file is needed for the confirmed re-POST.
    if (e.requiresConfirmation) {
      return res.status(200).json({
        requiresConfirmation: true,
        estimatedPages:       e.estimatedPages,
        estimatedCostUSD:     e.estimatedCostUSD,
      });
    }
    if (sbForCleanup && storagePath) {
      sbForCleanup.storage.from("temp-uploads").remove([storagePath]).catch(() => {});
    }
    console.error("[upload-file]", e.message);
    return res.status(500).json({ error: e.message });
  }
};
