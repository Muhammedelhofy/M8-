class VoiceManager {
  constructor() {
    this.synthesis = window.speechSynthesis;
    this.isListening = false;
    this.isSpeaking = false;
    this.currentLang = "ar-SA";
    this.onResult = null;
    this.onStatusChange = null;
    this.voicesLoaded = false;
    // muted = no text-to-speech. Set true for TYPED turns, false for SPOKEN turns,
    // so M8 replies in text when you type and out loud when you talk.
    this.muted = false;

    // INPUT: record mic audio -> Groq Whisper (/api/transcribe). Uses
    // getUserMedia + MediaRecorder, which WORK inside installed PWAs — unlike
    // the browser Web Speech API (webkitSpeechRecognition), which silently fails
    // in standalone mode and is flaky in the tab too.
    this._stream = null;
    this._recorder = null;
    this._chunks = [];
    this._recMime = "audio/webm";

    this._loadVoices();
  }

  setLanguage(lang) {
    this.currentLang = lang === "ar" ? "ar-SA" : "en-US";
  }

  // ── INPUT: mic -> Groq Whisper ─────────────────────────────────────────────
  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async startListening() {
    if (this.isListening) return;
    if (!this.isSupported()) {
      alert("Voice input needs a modern browser with microphone access.");
      return;
    }
    this.stopSpeaking();
    this.isListening = true; // set early so a quick second tap routes to stop
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this.isListening = false;
      console.error("Mic permission denied:", e);
      if (this.onStatusChange) this.onStatusChange("idle");
      alert("Microphone is blocked. Allow mic access for M8 in your browser/app settings, then try again.");
      return;
    }
    // pick a container the device supports (Chrome -> webm, Safari/iOS -> mp4)
    let mime = "";
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4";
    }
    try {
      this._recorder = mime
        ? new MediaRecorder(this._stream, { mimeType: mime })
        : new MediaRecorder(this._stream);
    } catch (e) {
      this._recorder = new MediaRecorder(this._stream);
    }
    this._recMime = this._recorder.mimeType || mime || "audio/webm";
    this._chunks = [];
    this._recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) this._chunks.push(ev.data);
    };
    this._recorder.onstop = () => this._transcribe();
    this._recorder.start();
    if (this.onStatusChange) this.onStatusChange("listening");
  }

  stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    if (this.onStatusChange) this.onStatusChange("thinking"); // transcribing
    if (this._recorder && this._recorder.state !== "inactive") {
      try {
        this._recorder.stop();
      } catch (e) {
        this._cleanupStream();
        if (this.onStatusChange) this.onStatusChange("idle");
      }
    } else {
      this._cleanupStream();
      if (this.onStatusChange) this.onStatusChange("idle");
    }
  }

  _cleanupStream() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  }

  async _transcribe() {
    this._cleanupStream();
    const blob = new Blob(this._chunks, { type: this._recMime });
    this._chunks = [];
    if (!blob.size) {
      if (this.onStatusChange) this.onStatusChange("idle");
      return;
    }
    try {
      const audio = await this._blobToBase64(blob);
      const resp = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, mime: this._recMime, lang: this.currentLang.split("-")[0] }),
      });
      const data = await resp.json().catch(() => ({}));
      if (this.onStatusChange) this.onStatusChange("idle");
      const text = ((data && (data.text || data.transcript)) || "").trim();
      if (text && this.onResult) this.onResult(text);
      else console.warn("Empty transcription:", data);
    } catch (e) {
      console.error("Transcription failed:", e);
      if (this.onStatusChange) this.onStatusChange("idle");
    }
  }

  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ── OUTPUT: text-to-speech (unchanged) ─────────────────────────────────────
  _loadVoices() {
    // Voices load asynchronously in some browsers
    if (this.synthesis.getVoices().length > 0) {
      this.voicesLoaded = true;
    } else {
      this.synthesis.addEventListener("voiceschanged", () => {
        this.voicesLoaded = true;
      });
    }
  }

  _getBestVoice(langCode) {
    const voices = this.synthesis.getVoices();
    // Try exact match first, then language prefix
    return (
      voices.find((v) => v.lang === langCode) ||
      voices.find((v) => v.lang.startsWith(langCode.split("-")[0])) ||
      null
    );
  }

  speak(text, onEnd) {
    if (!text || this.muted) { if (onEnd) onEnd(); return; }
    this.synthesis.cancel();

    // Small delay to ensure cancellation takes effect
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(this._stripMarkdown(text));
      utterance.lang = this.currentLang;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voice = this._getBestVoice(this.currentLang);
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        this.isSpeaking = true;
        if (this.onStatusChange) this.onStatusChange("speaking");
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        if (this.onStatusChange) this.onStatusChange("idle");
        if (onEnd) onEnd();
      };

      utterance.onerror = (e) => {
        this.isSpeaking = false;
        if (this.onStatusChange) this.onStatusChange("idle");
      };

      this.synthesis.speak(utterance);
    }, 100);
  }

  stopSpeaking() {
    this.synthesis.cancel();
    this.isSpeaking = false;
    this._pending = "";
  }

  // ── streaming TTS ────────────────────────────────────────────────
  // Speak sentences AS they arrive (queued utterances) so the voice starts on
  // the first sentence while the model is still generating — the whole point of
  // streaming. beginStream() resets; feedStream(delta) speaks each completed
  // sentence; endStream() flushes the tail.
  beginStream() {
    this.synthesis.cancel();
    this._pending = "";
    this.isSpeaking = false;
  }

  // Strip markdown syntax that TTS would vocalise as literal punctuation names.
  _stripMarkdown(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, "$1")   // **bold**
      .replace(/\*([^*]+)\*/g, "$1")        // *italic*
      .replace(/`[^`]*`/g, "")             // `inline code` — omit entirely
      .replace(/^#{1,6}\s+/gm, "")         // # headings
      .replace(/^[-*+]\s+/gm, "")          // - bullet list items
      .replace(/^\d+\.\s+/gm, "")          // 1. numbered list items
      .replace(/__([^_]+)__/g, "$1")       // __bold__
      .replace(/_([^_]+)_/g, "$1");        // _italic_
  }

  feedStream(delta) {
    this._pending = (this._pending || "") + (delta || "");
    // sentence end: Arabic comma ، included so Arabic prose is chunked at pauses
    const boundary = /[.!?؟،\n]+["')\]]?\s*/;
    let m;
    while ((m = boundary.exec(this._pending)) !== null) {
      const end = m.index + m[0].length;
      const sentence = this._pending.slice(0, end).trim();
      this._pending = this._pending.slice(end);
      if (sentence) this._enqueueUtterance(this._stripMarkdown(sentence));
    }
  }

  endStream() {
    if (this._pending && this._pending.trim()) {
      this._enqueueUtterance(this._stripMarkdown(this._pending.trim()));
    }
    this._pending = "";
  }

  // Queue an utterance WITHOUT cancelling the ones already speaking/queued.
  _enqueueUtterance(text) {
    if (!text || this.muted) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.currentLang;
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
    const voice = this._getBestVoice(this.currentLang);
    if (voice) u.voice = voice;
    u.onstart = () => {
      this.isSpeaking = true;
      if (this.onStatusChange) this.onStatusChange("speaking");
    };
    u.onend = () => {
      // Only return to idle once the whole queue has drained.
      if (!this.synthesis.speaking && !this.synthesis.pending) {
        this.isSpeaking = false;
        if (this.onStatusChange) this.onStatusChange("idle");
      }
    };
    u.onerror = () => {
      if (!this.synthesis.speaking && !this.synthesis.pending) {
        this.isSpeaking = false;
        if (this.onStatusChange) this.onStatusChange("idle");
      }
    };
    this.synthesis.speak(u);
  }
}
