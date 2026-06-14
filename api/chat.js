/**
 * M8 Chat Endpoint — POST /api/chat
 * Thin HTTP handler only. All logic lives in orchestrator.js.
 */
const { orchestrate } = require("../lib/orchestrator");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    const { message, sessionId, history, attachments } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const response = await orchestrate({ message, sessionId, history, attachments });
    return res.status(200).json({ response });

  } catch (error) {
    const errMsg  = error?.message || String(error);
    const errStatus = error?.status || error?.statusCode || "unknown";
    const model   = process.env.GEMINI_MODEL || "gemini-1.5-flash";

    console.error(`=== M8 ERROR === model:${model} status:${errStatus} msg:${errMsg}`);

    let hint = "Check Vercel logs for details";
    if (errMsg.includes("API key") || errMsg.includes("401")) hint = "Invalid GEMINI_API_KEY";
    if (errStatus === 429) hint = "Quota exceeded — check Google AI Studio";
    if (errMsg.includes("not found") || errMsg.includes("404")) hint = `Model '${model}' not found`;

    return res.status(500).json({ error: errMsg, hint });
  }
};
