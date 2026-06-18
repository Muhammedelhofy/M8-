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
async function convertBuffer(buffer, mimeType, name) {
  // Dynamically import the internal converters from lib/converter.js
  // by reconstructing the same logic — avoids re-exporting private functions
  const fmt = detectFormat(name || "", mimeType || "");

  // Inline minimal dispatcher (mirrors lib/converter.js convertUrl logic)
  const { GoogleGenAI } = require("@google/genai");

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
  const SAFETY = [
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  ];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const ai    = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  if (fmt === "image") {
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
  }

  // PDF — upload to Gemini Files API, paginate
  const PAGE_BATCH = 12;
  const blob    = new Blob([buffer], { type: "application/pdf" });
  const upload  = await ai.files.upload({ file: blob, config: { mimeType: "application/pdf", displayName: name || "upload.pdf" } });
  const fileUri = upload.uri || upload.file?.uri;
  if (!fileUri) throw new Error("Gemini file upload returned no URI");

  // Probe page count
  let totalPages = 200;
  try {
    const probe = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [
        { fileData: { mimeType: "application/pdf", fileUri } },
        { text: "How many pages does this PDF have? Reply with only the integer." },
      ]}],
      config: { maxOutputTokens: 10, temperature: 0, safetySettings: SAFETY },
    });
    const m = (probe.text || "").match(/\d+/);
    if (m) totalPages = parseInt(m[0], 10);
  } catch { /* use fallback */ }

  const parts = [];
  let failures = 0;
  for (let start = 1; start <= totalPages; start += PAGE_BATCH) {
    const end = Math.min(start + PAGE_BATCH - 1, totalPages);
    try {
      const result = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [
          { fileData: { mimeType: "application/pdf", fileUri } },
          { text: `Extract ALL text from pages ${start} to ${end}. Output only the extracted text, preserving headings and paragraphs.` },
        ]}],
        config: { maxOutputTokens: 8000, temperature: 0, safetySettings: SAFETY },
      });
      const chunk = (result.text || "").trim();
      if (chunk.length > 20) parts.push(chunk);
      failures = 0;
    } catch (e) {
      failures++;
      if (failures >= 3) break;
    }
  }

  // Cleanup uploaded file
  try {
    const fname = fileUri.split("/files/")[1];
    if (fname) await ai.files.delete({ name: `files/${fname}` });
  } catch { /* non-fatal */ }

  return { text: parts.join("\n\n"), pages: totalPages, format: "pdf" };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { data, storagePath, name, mimeType } = req.body || {};

  let buffer;

  if (storagePath) {
    // File was uploaded directly to Supabase Storage — download it here
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    );
    const { data: blob, error } = await sb.storage.from("temp-uploads").download(storagePath);
    if (error) return res.status(500).json({ error: `Storage download failed: ${error.message}` });
    const arrayBuf = await blob.arrayBuffer();
    buffer = Buffer.from(arrayBuf);
    // Delete temp file — non-fatal if it fails
    sb.storage.from("temp-uploads").remove([storagePath]).catch(() => {});
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
    const result = await convertBuffer(buffer, mimeType, name);
    const word_count = result.text.trim().split(/\s+/).length;
    return res.status(200).json({
      text:       result.text,
      word_count,
      pages:      result.pages,
      format:     result.format,
    });
  } catch (e) {
    console.error("[upload-file]", e.message);
    return res.status(500).json({ error: e.message });
  }
};
