class VoiceManager {
  constructor() {
    this.recognition = null;
    this.synthesis = window.speechSynthesis;
    this.isListening = false;
    this.isSpeaking = false;
    this.currentLang = "ar-SA";
    this.onResult = null;
    this.onStatusChange = null;
    this.voicesLoaded = false;

    this._initRecognition();
    this._loadVoices();
  }

  _initRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = this.currentLang;

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (this.onResult) this.onResult(transcript);
    };

    this.recognition.onstart = () => {
      this.isListening = true;
      if (this.onStatusChange) this.onStatusChange("listening");
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (!this.isSpeaking && this.onStatusChange) this.onStatusChange("idle");
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      if (event.error !== "no-speech") {
        console.error("STT error:", event.error);
      }
      if (!this.isSpeaking && this.onStatusChange) this.onStatusChange("idle");
    };
  }

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

  setLanguage(lang) {
    this.currentLang = lang === "ar" ? "ar-SA" : "en-US";
    if (this.recognition) this.recognition.lang = this.currentLang;
  }

  startListening() {
    if (!this.recognition) {
      alert("Voice input is not supported in this browser. Please use Chrome.");
      return;
    }
    if (this.isListening) return;
    this.stopSpeaking();
    this.recognition.lang = this.currentLang;
    try {
      this.recognition.start();
    } catch (e) {
      console.error("Could not start recognition:", e);
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  speak(text, onEnd) {
    if (!text) return;
    this.synthesis.cancel();

    // Small delay to ensure cancellation takes effect
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
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

  feedStream(delta) {
    this._pending = (this._pending || "") + (delta || "");
    const boundary = /[.!?؟\n]+["')\]]?\s*/;   // sentence end (+ optional closer)
    let m;
    while ((m = boundary.exec(this._pending)) !== null) {
      const end = m.index + m[0].length;
      const sentence = this._pending.slice(0, end).trim();
      this._pending = this._pending.slice(end);
      if (sentence) this._enqueueUtterance(sentence);
    }
  }

  endStream() {
    if (this._pending && this._pending.trim()) {
      this._enqueueUtterance(this._pending.trim());
    }
    this._pending = "";
  }

  // Queue an utterance WITHOUT cancelling the ones already speaking/queued.
  _enqueueUtterance(text) {
    if (!text) return;
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

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
}
