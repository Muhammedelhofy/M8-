// M8 voice input — transcribe recorded mic audio via Groq Whisper (FREE).
// The frontend (js/voice.js) records audio with MediaRecorder and POSTs
// { audio: <base64>, mime, lang }. We forward it to Groq's OpenAI-compatible
// audio endpoint (whisper-large-v3) and return { text }. Uses the existing
// GROQ_API_KEY — no new key, no cost. Works inside the installed PWA, unlike
// the browser Web Speech API.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const { audio, mime, lang } = req.body || {};
    if (!audio) {
      res.status(400).json({ error: "no audio" });
      return;
    }
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      res.status(500).json({ error: "GROQ_API_KEY not set" });
      return;
    }

    const buf = Buffer.from(audio, "base64");
    if (!buf.length) {
      res.status(400).json({ error: "empty audio" });
      return;
    }
    const type = mime || "audio/webm";
    const ext = type.indexOf("mp4") >= 0 ? "mp4" : type.indexOf("ogg") >= 0 ? "ogg" : "webm";

    const fd = new FormData();
    fd.append("file", new Blob([buf], { type }), `audio.${ext}`);
    fd.append("model", "whisper-large-v3");
    if (lang && lang !== "auto") fd.append("language", lang); // "ar" / "en"
    fd.append("response_format", "json");

    const gr = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });

    if (!gr.ok) {
      const t = await gr.text().catch(() => "");
      console.error("[transcribe] Groq error", gr.status, t.slice(0, 300));
      res.status(502).json({ error: "transcription failed", status: gr.status });
      return;
    }

    const j = await gr.json().catch(() => ({}));
    res.status(200).json({ text: ((j && j.text) || "").trim() });
  } catch (e) {
    console.error("[transcribe] error", e && e.message);
    res.status(500).json({ error: "server error" });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: "12mb" } } };
