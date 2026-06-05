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
    welcome: "مرحباً، أنا M8 — مساعدك الشخصي. كيف يمكنني مساعدتك اليوم؟",
    error: "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.",
  },
  en: {
    idle: "Ready",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
    placeholder: "Type a message or press the mic...",
    welcome: "Hello, I'm M8 — your personal AI agent. How can I help you today?",
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
  setLanguage("ar");
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

  try {
    // FIX: Send history WITHOUT the current message — backend appends it explicitly.
    // chat.addMessage("user", text) was already called above, so getHistory() would
    // include it. Slicing off the last item avoids duplicating it in the Gemini payload.
    const pastHistory = chat.getHistory().slice(0, -1);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: chat.sessionId,
        history: pastHistory,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    chat.hideTyping();
    chat.addMessage("assistant", data.response);
    voice.speak(data.response);
  } catch (err) {
    console.error("Send error:", err);
    chat.hideTyping();
    chat.addMessage("assistant", LABELS[currentLang].error);
    setStatus("idle");
  } finally {
    isProcessing = false;
  }
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
