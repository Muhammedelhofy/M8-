let voice, chat;
let currentLang = "ar";
let isProcessing = false;

const UI = {
  messages: null,
  textInput: null,
  micBtn: null,
  sendBtn: null,
  stopBtn: null,
  langToggle: null,
  statusText: null,
  orb: null,
  attachmentChips: null,
  attachBtn: null,
  fileInput: null,
  inputBar: null,
};

// ── Pasted file attachments (Build-33) ───────────────────────────────────
// Text-like files pasted into the textarea are read client-side and sent as
// {name, content} alongside the message; the orchestrator injects their text
// into THIS turn's LLM context only (never into memory/classification).

// Session-level cache: same file uploaded twice within a session costs zero.
// Key: "<filename>_<bytes>", value: {text, word_count, pages, format}
const _docConvertCache = new Map();

const ATTACHMENT_TEXT_RE = /^(text\/|application\/json)/;
const ATTACHMENT_EXT_RE = /\.(txt|csv|tsv|json|md|markdown|log|yaml|yml)$/i;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_CHARS = 20000;
// Build-34: image attachments. Vision-capable types only.
const ATTACHMENT_IMAGE_RE = /^image\/(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE_DIM = 1600;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Document attachments: PDF and EPUB — converted server-side via /api/upload-file
const ATTACHMENT_DOC_RE  = /^application\/(pdf|epub\+zip|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|msword)$/i;
const ATTACHMENT_DOC_EXT = /\.(pdf|epub|docx|doc)$/i;
const MAX_DOC_BYTES      = 20 * 1024 * 1024; // 20 MB ceiling
// pendingAttachments holds EITHER a text file {name, content, size}
// OR an image {name, kind:'image', mimeType, data(base64), thumb(dataURL), size}
// OR a document {name, kind:'document', mimeType, data(base64), size, converting, convertedText}.
let pendingAttachments = [];

function isTextAttachment(file) {
  return ATTACHMENT_TEXT_RE.test(file.type || "") || ATTACHMENT_EXT_RE.test(file.name || "");
}

function isImageAttachment(file) {
  return ATTACHMENT_IMAGE_RE.test(file.type || "");
}

function isDocumentAttachment(file) {
  return ATTACHMENT_DOC_RE.test(file.type || "") || ATTACHMENT_DOC_EXT.test(file.name || "");
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Downscale an image client-side so the payload stays small and fast WITHOUT
// destroying text legibility (receipts/documents/screenshots). Keeps PNG crisp
// for screenshots; uses JPEG for photos. Returns {mimeType, data(base64, no
// prefix), thumb(dataURL)}. On any failure, falls back to the original file.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

async function processImage(file) {
  const original = await readFileAsDataURL(file); // "data:<mime>;base64,<...>"
  let mimeType = file.type || "image/png";
  let dataUrl = original;
  try {
    const img = await loadImage(original);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = longEdge > MAX_IMAGE_DIM ? MAX_IMAGE_DIM / longEdge : 1;
    const needsReencode = scale < 1 || _dataUrlBytes(original) > MAX_IMAGE_BYTES;
    if (needsReencode) {
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      // PNG keeps screenshot text crisp; everything else → JPEG (smaller for photos).
      const outMime = /png/i.test(mimeType) ? "image/png" : "image/jpeg";
      let out = canvas.toDataURL(outMime, 0.9);
      // Still too big (large PNG)? re-encode as JPEG at a tighter size.
      if (_dataUrlBytes(out) > MAX_IMAGE_BYTES) {
        out = canvas.toDataURL("image/jpeg", 0.82);
      }
      dataUrl = out;
      mimeType = out.slice(5, out.indexOf(";"));
    }
  } catch (e) {
    console.warn("image downscale failed, sending original:", e);
  }
  const comma = dataUrl.indexOf(",");
  return { mimeType, data: dataUrl.slice(comma + 1), thumb: dataUrl };
}

// Approx byte size of a base64 data URL (without decoding).
function _dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor(b64.length * 0.75);
}

// Shared ingest for every entry point (paste, attach-button picker, drag-drop).
// Validates type + count, reads each file as text, and queues it as a chip.
async function ingestFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  for (const file of files) {
    const isText  = isTextAttachment(file);
    const isImage = isImageAttachment(file);
    const isDoc   = isDocumentAttachment(file);
    if (!isText && !isImage && !isDoc) {
      flashStatus(currentLang === "ar" ? "نوع الملف غير مدعوم" : "Unsupported file type");
      continue;
    }
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      flashStatus(currentLang === "ar" ? `حد أقصى ${MAX_ATTACHMENTS} ملفات` : `Max ${MAX_ATTACHMENTS} attached files`);
      break;
    }
    if (isDoc && file.size > MAX_DOC_BYTES) {
      flashStatus(currentLang === "ar" ? "الملف كبير جداً — الحد 20 ميغابايت" : "File too large — 20 MB limit");
      continue;
    }
    try {
      if (isImage) {
        const img = await processImage(file);
        pendingAttachments.push({ name: file.name || "image.png", kind: "image", mimeType: img.mimeType, data: img.data, thumb: img.thumb, size: file.size || 0 });
      } else if (isDoc) {
        const mimeType = file.type || (file.name.endsWith(".epub") ? "application/epub+zip" : "application/pdf");
        const att = { name: file.name || "document.pdf", kind: "document", mimeType, rawFile: file, size: file.size || 0, converting: true, convertedText: null };
        pendingAttachments.push(att);
        renderAttachmentChips();
        // Upload directly to Supabase Storage (bypasses Vercel 4.5 MB body limit),
        // then ask the backend to convert from storage path.
        convertDocumentAttachment(att);
        continue; // renderAttachmentChips already called above
      } else {
        const text = await readFileAsText(file);
        pendingAttachments.push({ name: file.name || "file.txt", content: text, size: file.size || text.length });
      }
      renderAttachmentChips();
    } catch (err) {
      console.error("attachment read error:", err);
    }
  }
}

// Upload a document directly to Supabase Storage (bypasses Vercel body limit),
// then ask the backend to convert from the storage path.
async function convertDocumentAttachment(att) {
  // ── Session cache: skip Gemini entirely if we've already converted this file ──
  const cacheKey = `${att.name}_${att.size}`;
  if (_docConvertCache.has(cacheKey)) {
    const cached = _docConvertCache.get(cacheKey);
    att.converting    = false;
    att.convertedText = cached.text;
    att.wordCount     = cached.word_count;
    att.pages         = cached.pages;
    renderAttachmentChips();
    return;
  }

  // Estimate pages from file size so the chip can show it before extraction starts.
  // Arabic scanned PDFs ≈ 80KB/page — same formula used server-side.
  att.estimatedPages = Math.max(Math.ceil(att.size / (80 * 1024)), 1);

  try {
    // Step 1: get a presigned upload URL from the backend
    att.uploadStage = "uploading";
    renderAttachmentChips();
    const presignResp = await fetch("/api/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: att.name, mimeType: att.mimeType }),
    });
    if (!presignResp.ok) {
      const e = await presignResp.json().catch(() => ({}));
      throw new Error(e.error || `Presign failed (${presignResp.status})`);
    }
    const { uploadUrl, path } = await presignResp.json();

    // Step 2: upload the raw file binary directly to Supabase (no Vercel in the way)
    const uploadResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": att.mimeType || "application/octet-stream" },
      body: att.rawFile,
    });
    if (!uploadResp.ok) throw new Error(`Storage upload failed (${uploadResp.status})`);

    // Step 3: ask the backend to extract text — slow for large PDFs (Gemini OCR).
    // A 8MB Arabic book takes 60–120s: Gemini upload + batch OCR extraction.
    att.uploadStage  = "extracting";
    att.extractStart = Date.now();
    renderAttachmentChips();

    // Tick the elapsed-time counter every 5s so Muhammad knows it's alive
    const tickTimer = setInterval(() => renderAttachmentChips(), 5000);

    // 4-minute client timeout — if the server hasn't replied, show a clear error
    const abortCtrl = new AbortController();
    const abortTimer = setTimeout(() => abortCtrl.abort(), 240000);

    let json;
    try {
      const convertResp = await fetch("/api/upload-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: path, name: att.name, mimeType: att.mimeType }),
        signal: abortCtrl.signal,
      });
      json = await convertResp.json();
    } finally {
      clearInterval(tickTimer);
      clearTimeout(abortTimer);
    }
    // Cost-guard confirmation gate: server says PDF is large and needs user approval
    if (json.requiresConfirmation) {
      att.converting    = false;
      att.uploadStage   = null;
      att.extractStart  = null;
      att.pendingConfirm = {
        storagePath:      path,
        estimatedPages:   json.estimatedPages,
        estimatedCostUSD: json.estimatedCostUSD,
      };
      renderAttachmentChips();
      return;
    }
    att.converting    = false;
    att.uploadStage   = null;
    att.extractStart  = null;
    att.convertedText = json.text || null;
    att.wordCount     = json.word_count || 0;
    att.pages         = json.pages || null;
    if (!json.text) {
      att.error = json.error || "Conversion failed";
    } else {
      // Cache on success so re-uploads in this session are free
      _docConvertCache.set(cacheKey, {
        text: json.text, word_count: json.word_count, pages: json.pages,
      });
    }
  } catch (e) {
    att.converting  = false;
    att.uploadStage = null;
    att.error       = e.message;
  }
  // Free the raw file reference — no longer needed
  att.rawFile = null;
  renderAttachmentChips();
}

// Re-send extract request with confirmed:true after user approves the cost.
async function confirmLargePdfExtraction(att) {
  const pc = att.pendingConfirm;
  if (!pc) return;
  att.pendingConfirm = null;
  att.converting    = true;
  att.uploadStage   = "extracting";
  att.extractStart  = Date.now();
  renderAttachmentChips();

  const tickTimer  = setInterval(() => renderAttachmentChips(), 5000);
  const abortCtrl  = new AbortController();
  const abortTimer = setTimeout(() => abortCtrl.abort(), 240000);
  const cacheKey   = `${att.name}_${att.size}`;
  try {
    let json;
    try {
      const convertResp = await fetch("/api/upload-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: pc.storagePath, name: att.name, mimeType: att.mimeType, confirmed: true }),
        signal: abortCtrl.signal,
      });
      json = await convertResp.json();
    } finally {
      clearInterval(tickTimer);
      clearTimeout(abortTimer);
    }
    att.converting    = false;
    att.uploadStage   = null;
    att.extractStart  = null;
    att.convertedText = json.text || null;
    att.wordCount     = json.word_count || 0;
    att.pages         = json.pages || null;
    if (!json.text) {
      att.error = json.error || "Conversion failed";
    } else {
      _docConvertCache.set(cacheKey, { text: json.text, word_count: json.word_count, pages: json.pages });
    }
  } catch (e) {
    att.converting  = false;
    att.uploadStage = null;
    att.error       = e.message;
  }
  renderAttachmentChips();
}

async function handlePaste(e) {
  const files = (e.clipboardData && e.clipboardData.files) || [];
  if (!files.length) return;
  // Only swallow the paste when there's actually a file on the clipboard, so
  // ordinary text paste keeps working.
  e.preventDefault();
  await ingestFiles(files);
}

// ── DOCX download for extracted documents (Build-N) ──────────────────────
// Loads docx.js from CDN (same lazy-load pattern as pptxgenjs in chat.js)
// then builds a formatted Word document from the extracted text.
function _ensureDocxLib() {
  if (window.docx) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("docx library failed to load"));
    document.head.appendChild(s);
  });
}

async function downloadAsDocx(att) {
  try {
    await _ensureDocxLib();
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

    const text = att.convertedText || "";
    const lines = text.split("\n");
    const paragraphs = [];

    const CHAPTER_RE = /^(chapter\s+\w+[\s:\-–]|chapter\s+[ivxlcdm]+\b)/i;
    const PART_RE    = /^(part\s+\w+[\s:\-–]|part\s+[ivxlcdm]+\b)/i;
    // Short all-caps line (like "BIBLIOGRAPHY", "POLAR WANDERING", "THE ARCTIC LEGEND")
    const ALLCAPS_RE = /^[A-Z][A-Z\s\-–:]{4,}$/;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        // Blank line → small spacer paragraph
        paragraphs.push(new Paragraph({ children: [] }));
        continue;
      }

      if (CHAPTER_RE.test(line)) {
        paragraphs.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(line)],
        }));
      } else if (PART_RE.test(line)) {
        paragraphs.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(line)],
        }));
      } else if (ALLCAPS_RE.test(line) && line.length < 80) {
        paragraphs.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(line)],
        }));
      } else {
        paragraphs.push(new Paragraph({
          children: [new TextRun(line)],
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
        },
        children: paragraphs,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const blob   = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement("a");
    a.href       = url;
    a.download   = att.name.replace(/\.[^.]+$/, "") + ".docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) {
    console.error("docx build error", e);
    alert("Could not build .docx — use the .txt download instead.");
  }
}

function renderAttachmentChips() {
  UI.attachmentChips.innerHTML = "";
  pendingAttachments.forEach((att, i) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    if (att.kind === "image" && att.thumb) {
      const thumb = document.createElement("img");
      thumb.className = "attachment-thumb";
      thumb.src = att.thumb;
      thumb.alt = att.name;
      chip.appendChild(thumb);
    }

    const name = document.createElement("span");
    name.className = "attachment-name";
    if (att.kind === "document") {
      if (att.pendingConfirm) {
        // Large PDF cost-guard: show estimate and ask for confirmation
        const pc = att.pendingConfirm;
        name.textContent = `⚠️ ${att.name} — ~${pc.estimatedPages} pages, est. $${pc.estimatedCostUSD} — proceed?`;
        chip.classList.add("converting");
        chip.appendChild(name);
        // Confirm button
        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "attachment-download";
        confirmBtn.textContent = "✓ Proceed";
        confirmBtn.title = `Extract this PDF (~${pc.estimatedPages} pages, est. cost $${pc.estimatedCostUSD})`;
        confirmBtn.addEventListener("click", (e) => { e.stopPropagation(); confirmLargePdfExtraction(att); });
        chip.appendChild(confirmBtn);
        // Cancel button
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "attachment-remove";
        cancelBtn.title = "Cancel — remove this file";
        cancelBtn.textContent = "✕ Cancel";
        cancelBtn.addEventListener("click", () => { pendingAttachments.splice(i, 1); renderAttachmentChips(); });
        chip.appendChild(cancelBtn);
        UI.attachmentChips.appendChild(chip);
        return; // skip the generic remove button below
      } else if (att.converting) {
        if (att.uploadStage === "uploading") {
          name.textContent = `📤 ${att.name} — uploading…`;
        } else if (att.uploadStage === "extracting") {
          const elapsed   = att.extractStart ? Math.floor((Date.now() - att.extractStart) / 1000) : 0;
          const estPages  = att.estimatedPages ? ` ~${att.estimatedPages}p` : "";
          const elapsedStr = elapsed > 0 ? ` · ${elapsed}s` : "";
          name.textContent = `🔍 ${att.name} — extracting${estPages}${elapsedStr}…`;
        } else {
          name.textContent = `⏳ ${att.name} — converting…`;
        }
        chip.classList.add("converting");
      } else if (att.error) {
        name.textContent = `❌ ${att.name} — ${att.error}`;
        chip.classList.add("error");
      } else {
        const metaParts = [];
        if (att.wordCount) metaParts.push(`${att.wordCount.toLocaleString()} words`);
        if (att.pages)     metaParts.push(`${att.pages} pages`);
        const meta = metaParts.length ? ` — ${metaParts.join(" · ")}` : "";
        name.textContent = `📄 ${att.name}${meta}`;
        chip.classList.add("ready");
      }
    } else {
      name.textContent = att.kind === "image" ? `🖼️ ${att.name}` : `📎 ${att.name}`;
    }
    chip.appendChild(name);

    // Download buttons: appear on successfully converted documents.
    if (att.kind === "document" && !att.converting && !att.error && att.convertedText) {
      // .txt download
      const dlTxt = document.createElement("button");
      dlTxt.type = "button";
      dlTxt.className = "attachment-download";
      dlTxt.title = "Download extracted text as .txt";
      dlTxt.textContent = "⬇ txt";
      dlTxt.addEventListener("click", (e) => {
        e.stopPropagation();
        const blob = new Blob([att.convertedText], { type: "text/plain;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = att.name.replace(/\.[^.]+$/, "") + ".txt";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      });
      chip.appendChild(dlTxt);

      // .docx download — formatted Word document with heading styles
      const dlDocx = document.createElement("button");
      dlDocx.type = "button";
      dlDocx.className = "attachment-download";
      dlDocx.title = "Download as formatted Word document (.docx)";
      dlDocx.textContent = "⬇ docx";
      dlDocx.addEventListener("click", (e) => {
        e.stopPropagation();
        dlDocx.textContent = "⏳";
        dlDocx.disabled = true;
        downloadAsDocx(att).finally(() => {
          dlDocx.textContent = "⬇ docx";
          dlDocx.disabled = false;
        });
      });
      chip.appendChild(dlDocx);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.title = "Remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      pendingAttachments.splice(i, 1);
      renderAttachmentChips();
    });
    chip.appendChild(remove);

    UI.attachmentChips.appendChild(chip);
  });
  UI.attachmentChips.classList.toggle("visible", pendingAttachments.length > 0);
  // Disable send button while any document is still converting
  const stillConverting = pendingAttachments.some(a => a.kind === "document" && (a.converting || a.pendingConfirm));
  UI.sendBtn.disabled = stillConverting;
  UI.sendBtn.title = stillConverting ? "Resolve the document status above before sending…" : "Send message";
}

// Briefly show a message in the status line, then restore the normal status.
let _flashTimer = null;
function flashStatus(text) {
  if (_flashTimer) clearTimeout(_flashTimer);
  UI.statusText.textContent = text;
  _flashTimer = setTimeout(() => setStatus("idle"), 2200);
}

// Documents can be much larger — match the orchestrator's MAX_DOC_ATTACHMENT_CHARS.
const MAX_DOC_ATTACHMENT_CHARS = 80000;

// Cap + format a pending attachment for the wire — server re-caps too, this
// just avoids shipping huge payloads from the browser.
function packAttachments() {
  return pendingAttachments.map((a) => {
    if (a.kind === "image") {
      return { name: a.name, kind: "image", mimeType: a.mimeType, data: a.data };
    }
    if (a.kind === "document") {
      // Send the converted text (not the binary). If still converting, send a placeholder.
      const text = a.convertedText || `[Document "${a.name}" — conversion pending or failed]`;
      const limit = MAX_DOC_ATTACHMENT_CHARS;
      return {
        name: a.name,
        kind: "document",
        content: text.length > limit ? text.slice(0, limit) + `\n[...truncated — ${a.wordCount?.toLocaleString() || "?"} words total. Use the ⬇ button on the attachment chip to download the full text.]` : text,
        wordCount: a.wordCount || 0,
        pages: a.pages || null,
      };
    }
    return {
      name: a.name,
      content: a.content.length > MAX_ATTACHMENT_CHARS ? a.content.slice(0, MAX_ATTACHMENT_CHARS) : a.content,
    };
  });
}

const LABELS = {
  ar: {
    idle: "جاهز",
    listening: "أستمع...",
    thinking: "أفكر...",
    speaking: "أتكلم...",
    placeholder: "اكتب رسالة أو اضغط على المايك...",
    welcome: "M8 في خدمتك.",
    error: "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.",
  },
  en: {
    idle: "Ready",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
    placeholder: "Type a message or press the mic...",
    welcome: "M8 at your service.",
    error: "Sorry, something went wrong. Please try again.",
  },
};

function init() {
  // Grab all UI elements
  UI.messages = document.getElementById("messages");
  UI.textInput = document.getElementById("text-input");
  UI.micBtn = document.getElementById("mic-btn");
  UI.sendBtn = document.getElementById("send-btn");
  UI.stopBtn = document.getElementById("stop-btn");
  UI.langToggle = document.getElementById("lang-toggle");
  UI.statusText = document.getElementById("status-text");
  UI.orb = document.getElementById("m8-orb");
  UI.attachmentChips = document.getElementById("attachment-chips");
  UI.attachBtn = document.getElementById("attach-btn");
  UI.fileInput = document.getElementById("file-input");
  UI.inputBar = document.querySelector(".input-bar");

  // Initialize managers
  chat = new ChatManager(UI.messages);
  voice = new VoiceManager();

  // Voice callbacks
  voice.onResult = (transcript) => {
    UI.textInput.value = transcript;
    sendMessage(transcript);
  };

  voice.onStatusChange = (status) => {
    setStatus(status);
  };

  // Event listeners
  UI.sendBtn.addEventListener("click", handleSend);
  UI.textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  UI.textInput.addEventListener("paste", handlePaste);

  // Attach button → open the native file picker; picker change → ingest.
  UI.attachBtn.addEventListener("click", () => UI.fileInput.click());
  UI.fileInput.addEventListener("change", async (e) => {
    await ingestFiles(e.target.files);
    UI.fileInput.value = ""; // reset so the same file can be picked again
  });

  // Drag-and-drop a file anywhere onto the input bar.
  ["dragenter", "dragover"].forEach((evt) =>
    UI.inputBar.addEventListener(evt, (e) => {
      e.preventDefault();
      UI.inputBar.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    UI.inputBar.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === "dragleave" && UI.inputBar.contains(e.relatedTarget)) return;
      UI.inputBar.classList.remove("drag-over");
    })
  );
  UI.inputBar.addEventListener("drop", async (e) => {
    const files = (e.dataTransfer && e.dataTransfer.files) || [];
    if (files.length) await ingestFiles(files);
  });

  UI.micBtn.addEventListener("click", toggleMic);
  UI.stopBtn.addEventListener("click", () => {
    voice.stopSpeaking();
    setStatus("idle");
  });
  UI.langToggle.addEventListener("click", toggleLanguage);

  // Auto-resize textarea
  UI.textInput.addEventListener("input", () => {
    UI.textInput.style.height = "auto";
    UI.textInput.style.height = Math.min(UI.textInput.scrollHeight, 120) + "px";
  });

  // Set default language and show welcome
  setLanguage("en");
  setTimeout(showWelcome, 600);
}

function showWelcome() {
  const msg = LABELS[currentLang].welcome;
  chat.addMessage("assistant", msg);
  voice.speak(msg);
}

function handleSend() {
  const text = UI.textInput.value.trim();
  if (pendingAttachments.some(a => a.kind === "document" && a.converting)) {
    flashStatus(currentLang === "ar" ? "انتظر… جارٍ تحويل الملف" : "Please wait — document is still converting…");
    return;
  }
  if (text || pendingAttachments.length) {
    // Capture and clear reply state before send
    const replyQuote = (typeof _replyState !== "undefined" && _replyState.active) ? _replyState.quote : "";
    if (replyQuote && typeof clearReply === "function") clearReply();
    sendMessage(text, replyQuote);
  }
}

// Flip to false to force the proven buffered path (no streaming) without a redeploy.
const STREAMING_ENABLED = true;

// Deck/presentation requests route to the dedicated /api/deck path (rich download
// buttons + client-side file build), bypassing the voice/streaming chat flow.
// Mirrors lib/deckgen.js looksDeck so the UI and backend agree on what's a deck.
const DECK_RE = /\b(decks?|slides?|slide\s*deck|presentations?|pitch(?:\s*deck)?|power\s?point|ppt|pptx|keynote)\b/i;

async function sendMessage(text, replyQuote) {
  const attachments = packAttachments();
  if ((!text && !attachments.length) || isProcessing) return;
  isProcessing = true;

  // Stop any ongoing speech
  voice.stopSpeaking();

  // Clear input and reset height
  UI.textInput.value = "";
  UI.textInput.style.height = "auto";

  // A file pasted with no typed question still needs message text for the LLM.
  if (!text) {
    text = currentLang === "ar" ? "من فضلك راجع الملف المرفق." : "Please take a look at the attached file.";
  }

  // When replying to a specific message, the displayed text is just what the
  // user typed, but the API message includes the quoted context so M8 knows
  // exactly which message is being referenced.
  const apiText = replyQuote
    ? `[Replying to this message — use it as context for my request below]\n\n"${replyQuote.slice(0, 800)}"\n\n---\n\n${text}`
    : text;

  // Display user message + attachment chips, then clear pending attachments.
  // Images carry a thumb dataURL so the sent message shows a preview too.
  chat.addMessage("user", text, attachments.map((a) => (
    a.kind === "image"
      ? { name: a.name, kind: "image", thumb: `data:${a.mimeType};base64,${a.data}` }
      : { name: a.name }
  )));
  pendingAttachments = [];
  renderAttachmentChips();

  // Show thinking state
  chat.showTyping();
  setStatus("thinking");

  // FIX: Send history WITHOUT the current message — backend appends it explicitly.
  const pastHistory = chat.getHistory().slice(0, -1);

  try {
    // Deck path — its own endpoint + download buttons. Skip when a reply is
    // active (the user is directing M8 to a specific context, not asking for a
    // generic deck) or when the text looks like a fleet/report export (those
    // route to /api/fleet-export via the orchestrator's export marker).
    const isFleetExport = /\b(fleet|report|driver|earnings|performance)\b/i.test(apiText);
    if (DECK_RE.test(text) && !replyQuote && !isFleetExport) {
      try { await deckMessage(apiText, pastHistory); return; }
      catch (deckErr) { console.warn("Deck path failed, falling back to chat:", deckErr); }
    }
    let streamed = false;
    if (STREAMING_ENABLED) {
      try { streamed = await streamMessage(apiText, pastHistory, attachments); }
      catch (streamErr) { console.warn("Stream failed, falling back to buffered:", streamErr); streamed = false; }
    }
    if (!streamed) await bufferedMessage(apiText, pastHistory, attachments);
  } catch (err) {
    console.error("Send error:", err);
    chat.hideTyping();
    chat.addMessage("assistant", LABELS[currentLang].error);
    setStatus("idle");
  } finally {
    isProcessing = false;
  }
}

// Streaming path (SSE). Returns true if it delivered a reply; false → caller
// falls back to the buffered path. Throwing also triggers the fallback.
async function streamMessage(text, pastHistory, attachments) {
  const res = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, sessionId: chat.sessionId, history: pastHistory, attachments }),
  });
  if (!res.ok || !res.body) return false;
  if (!(res.headers.get("content-type") || "").includes("text/event-stream")) return false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", msg = null, got = false, errored = false;
  voice.beginStream();

  const handle = (line) => {
    const payload = line.replace(/^data:\s?/, "").trim();
    if (!payload || payload === "[DONE]") return;
    let obj; try { obj = JSON.parse(payload); } catch { return; }
    if (obj.error) { errored = true; return; }
    if (obj.reset) {
      // Server is replacing a partial reply (a Gemini stream failed and it fell
      // back). Discard what we've shown and cancel queued speech, then continue.
      if (msg) { msg.content = ""; if (msg._bubble) msg._bubble.textContent = ""; }
      voice.beginStream();
      return;
    }
    if (obj.delta) {
      if (!got) { chat.hideTyping(); setStatus("speaking"); msg = chat.addStreamingMessage(); got = true; }
      chat.appendToStreaming(msg, obj.delta);
      voice.feedStream(obj.delta);
    }
    if (obj.done) {
      if (!got) { chat.hideTyping(); msg = chat.addStreamingMessage(); got = true; }
      chat.finalizeStreaming(msg, obj.full);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n\n")) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 2); }
  }
  if (buf.trim()) handle(buf);

  if (!got) return false;        // server errored before any content → fall back
  voice.endStream();
  return true;
}

// Deck path — calls /api/deck, renders an outline + .pptx/.html/.md download
// buttons (built client-side), and speaks a short confirmation (NOT the outline).
// Throws on a transport/HTTP failure so sendMessage falls back to normal chat.
async function deckMessage(text, pastHistory) {
  const res = await fetch("/api/deck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, sessionId: chat.sessionId, history: pastHistory }),
  });
  if (!res.ok) throw new Error("deck HTTP " + res.status);
  const data = await res.json();
  chat.hideTyping();
  if (!data.ok) {
    const m = data.error || "I couldn't build that deck.";
    chat.addMessage("assistant", m);
    voice.speak(m);
    setStatus("idle");
    return;
  }
  chat.addDeckMessage(data);
  const n = (data.spec && Array.isArray(data.spec.slides)) ? data.spec.slides.length : 0;
  const summary = `Built your ${data.title}${n ? " — " + n + " slides" : ""}. Download it as PowerPoint, web slides, or markdown using the buttons below.`;
  voice.speak(summary);
  setStatus("idle");
}

// Buffered path (the original /api/chat flow) — also the streaming fallback.
async function bufferedMessage(text, pastHistory, attachments) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, sessionId: chat.sessionId, history: pastHistory, attachments }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  chat.hideTyping();
  chat.addMessage("assistant", data.response);
  voice.speak(data.response);
}

function toggleMic() {
  if (voice.isListening) {
    voice.stopListening();
    UI.micBtn.classList.remove("active");
    delete UI.micBtn.dataset.lang;
  } else {
    voice.startListening();
    UI.micBtn.classList.add("active");
    // FIX: Tag mic button with active language so CSS badge shows "AR" or "EN"
    UI.micBtn.dataset.lang = currentLang === "ar" ? "AR" : "EN";
  }
}

function toggleLanguage() {
  setLanguage(currentLang === "ar" ? "en" : "ar");
}

function setLanguage(lang) {
  currentLang = lang;
  voice.setLanguage(lang);

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  // FIX: Show the ACTIVE language (not the switch target) + tooltip explains intent
  UI.langToggle.textContent = lang === "ar" ? "عر" : "EN";
  UI.langToggle.dataset.lang = lang;
  UI.langToggle.title = lang === "ar"
    ? "النشط: عربي (ar-SA) · اضغط للتبديل إلى الإنجليزية"
    : "Active: English (en-US) · tap to switch to Arabic";

  UI.textInput.placeholder = LABELS[lang].placeholder;
  setStatus("idle");
}

function setStatus(status) {
  let label = LABELS[currentLang][status] || LABELS[currentLang].idle;
  // FIX: Append active language code to status text when mic is recording
  if (status === "listening") {
    label += currentLang === "ar" ? " · عر" : " · EN";
  }
  UI.statusText.textContent = label;

  // Update orb class
  UI.orb.className = "orb " + status;

  // Update mic button
  if (status !== "listening") {
    UI.micBtn.classList.remove("active");
    delete UI.micBtn.dataset.lang;
  }
}

document.addEventListener("DOMContentLoaded", init);
