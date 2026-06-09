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
};

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
  if (text) sendMessage(text);
}

// Flip to false to force the proven buffered path (no streaming) without a redeploy.
const STREAMING_ENABLED = true;

async function sendMessage(text) {
  if (!text || isProcessing) return;
  isProcessing = true;

  // Stop any ongoing speech
  voice.stopSpeaking();

  // Clear input and reset height
  UI.textInput.value = "";
  UI.textInput.style.height = "auto";

  // Display user message
  chat.addMessage("user", text);

  // Show thinking state
  chat.showTyping();
  setStatus("thinking");

  // FIX: Send history WITHOUT the current message — backend appends it explicitly.
  const pastHistory = chat.getHistory().slice(0, -1);

  try {
    let streamed = false;
    if (STREAMING_ENABLED) {
      try { streamed = await streamMessage(text, pastHistory); }
      catch (streamErr) { console.warn("Stream failed, falling back to buffered:", streamErr); streamed = false; }
    }
    if (!streamed) await bufferedMessage(text, pastHistory);
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
async function streamMessage(text, pastHistory) {
  const res = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, sessionId: chat.sessionId, history: pastHistory }),
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

// Buffered path (the original /api/chat flow) — also the streaming fallback.
async function bufferedMessage(text, pastHistory) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, sessionId: chat.sessionId, history: pastHistory }),
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
