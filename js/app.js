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
};

// ── Pasted file attachments (Build-33) ───────────────────────────────────
// Text-like files pasted into the textarea are read client-side and sent as
// {name, content} alongside the message; the orchestrator injects their text
// into THIS turn's LLM context only (never into memory/classification).
const ATTACHMENT_TEXT_RE = /^(text\/|application\/json)/;
const ATTACHMENT_EXT_RE = /\.(txt|csv|tsv|json|md|markdown|log|yaml|yml)$/i;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_CHARS = 20000;
let pendingAttachments = []; // [{name, content, size}]

function isTextAttachment(file) {
  return ATTACHMENT_TEXT_RE.test(file.type || "") || ATTACHMENT_EXT_RE.test(file.name || "");
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function handlePaste(e) {
  const files = (e.clipboardData && e.clipboardData.files) || [];
  if (!files.length) return;

  for (const file of Array.from(files)) {
    if (!isTextAttachment(file)) {
      flashStatus(currentLang === "ar" ? "نوع الملف غير مدعوم — نص/CSV فقط حالياً" : "Only text/CSV files are supported for now");
      continue;
    }
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      flashStatus(currentLang === "ar" ? `حد أقصى ${MAX_ATTACHMENTS} ملفات` : `Max ${MAX_ATTACHMENTS} attached files`);
      break;
    }
    try {
      e.preventDefault();
      const text = await readFileAsText(file);
      pendingAttachments.push({ name: file.name || "file.txt", content: text, size: file.size || text.length });
      renderAttachmentChips();
    } catch (err) {
      console.error("paste attachment read error:", err);
    }
  }
}

function renderAttachmentChips() {
  UI.attachmentChips.innerHTML = "";
  pendingAttachments.forEach((att, i) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = `📎 ${att.name}`;
    chip.appendChild(name);

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
}

// Briefly show a message in the status line, then restore the normal status.
let _flashTimer = null;
function flashStatus(text) {
  if (_flashTimer) clearTimeout(_flashTimer);
  UI.statusText.textContent = text;
  _flashTimer = setTimeout(() => setStatus("idle"), 2200);
}

// Cap + format a pending attachment for the wire — server re-caps too, this
// just avoids shipping huge payloads from the browser.
function packAttachments() {
  return pendingAttachments.map((a) => ({
    name: a.name,
    content: a.content.length > MAX_ATTACHMENT_CHARS ? a.content.slice(0, MAX_ATTACHMENT_CHARS) : a.content,
  }));
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
  if (text || pendingAttachments.length) sendMessage(text);
}

// Flip to false to force the proven buffered path (no streaming) without a redeploy.
const STREAMING_ENABLED = true;

// Deck/presentation requests route to the dedicated /api/deck path (rich download
// buttons + client-side file build), bypassing the voice/streaming chat flow.
// Mirrors lib/deckgen.js looksDeck so the UI and backend agree on what's a deck.
const DECK_RE = /\b(decks?|slides?|slide\s*deck|presentations?|pitch(?:\s*deck)?|power\s?point|ppt|pptx|keynote)\b/i;

async function sendMessage(text) {
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

  // Display user message + attachment chips, then clear pending attachments.
  chat.addMessage("user", text, attachments.map((a) => ({ name: a.name })));
  pendingAttachments = [];
  renderAttachmentChips();

  // Show thinking state
  chat.showTyping();
  setStatus("thinking");

  // FIX: Send history WITHOUT the current message — backend appends it explicitly.
  const pastHistory = chat.getHistory().slice(0, -1);

  try {
    // Deck path first — its own endpoint + download buttons. On any failure we
    // fall through to the normal chat so a deck request is never a dead end.
    if (DECK_RE.test(text)) {
      try { await deckMessage(text, pastHistory); return; }
      catch (deckErr) { console.warn("Deck path failed, falling back to chat:", deckErr); }
    }
    let streamed = false;
    if (STREAMING_ENABLED) {
      try { streamed = await streamMessage(text, pastHistory, attachments); }
      catch (streamErr) { console.warn("Stream failed, falling back to buffered:", streamErr); streamed = false; }
    }
    if (!streamed) await bufferedMessage(text, pastHistory, attachments);
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
