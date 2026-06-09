/**
 * M8 Streaming Chat Endpoint — POST /api/chat-stream  (Server-Sent Events)
 *
 * ADDITIVE: the buffered POST /api/chat is untouched and remains the frontend's
 * automatic fallback. This endpoint streams token chunks so TTS can start
 * speaking the first sentence while the rest still generates (masks the ~8-10s
 * wall-clock). Thin HTTP handler only — all logic is in orchestrateStream().
 *
 * Wire format (one JSON object per SSE `data:` line):
 *   {delta:"..."}      a token chunk to append/speak
 *   {done:true, full}  end of the reply (full = the complete text, for safety)
 *   {error:"..."}      something failed (client should fall back to /api/chat)
 *
 * (6th of 12 Vercel Hobby functions. If Vercel buffers the response on Hobby,
 * the client still receives the whole reply at the end — graceful degrade.)
 */
const { orchestrateStream } = require("../lib/orchestrator");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  const { message, sessionId, history } = req.body || {};
  if (!message) return res.status(400).json({ error: "Message required" });

  res.setHeader("Content-Type",  "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");          // ask proxies not to buffer
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {} };

  try {
    const full = await orchestrateStream({
      message, sessionId, history,
      onChunk: (delta) => send({ delta }),
    });
    send({ done: true, full });
  } catch (err) {
    console.error("[M8] /api/chat-stream error:", err?.message || err);
    send({ error: err?.message || "stream failed" });
  } finally {
    try { res.write("data: [DONE]\n\n"); res.end(); } catch (_) {}
  }
};
