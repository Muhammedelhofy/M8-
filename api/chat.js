const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const M8_SYSTEM_PROMPT = `You are M8, the personal AI agent of Muhammad El-Hofy — Senior Operations Manager based in Riyadh, Saudi Arabia.

LANGUAGE RULE: Always match the user's language exactly.
- If the user writes in Arabic, respond in Arabic.
- If the user writes in English, respond in English.

PERSONALITY: You are like Jarvis — intelligent, direct, concise, professional.

CONTEXT: Muhammad manages a Bolt KSA bike delivery fleet (~102 bikes). He oversees Hunger Station, Noon, Keeta, Uber courier supply. He also has YouTube channels and is interested in AI. Based in Riyadh, Egyptian.

RESPONSE STYLE: Keep responses short and clear. You are often read aloud. Be direct.`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set");
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const { message, sessionId, history } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const genAI = new GoogleGenerativeAI(apiKey);

    // gemini-1.5-flash was deprecated in 2026 — now using gemini-2.0-flash
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const recentHistory = (history || []).slice(-20);

    const geminiHistory = recentHistory.slice(0, -1).map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const fullMessage = geminiHistory.length === 0
      ? `${M8_SYSTEM_PROMPT}\n\n---\n\n${message}`
      : message;

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(fullMessage);
    const response = result.response.text();

    // Save to Supabase (non-fatal)
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
      await supabase.from("m8_conversations").insert([
        { session_id: sessionId || "default", role: "user", content: message },
        { session_id: sessionId || "default", role: "assistant", content: response },
      ]);
    } catch (dbErr) {
      console.error("DB save error (non-fatal):", dbErr.message);
    }

    return res.status(200).json({ response });

  } catch (error) {
    const errMsg = error?.message || String(error);
    const errStatus = error?.status || error?.statusCode || "unknown";
    const modelUsed = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    console.error("=== M8 API ERROR ===");
    console.error(`Model: ${modelUsed}`);
    console.error(`HTTP Status: ${errStatus}`);
    console.error(`Message: ${errMsg}`);

    let hint = "Check Vercel logs for details";
    if (errMsg.includes("API key")) hint = "Invalid GEMINI_API_KEY in Vercel env vars";
    if (errStatus === 429) hint = "Quota exceeded — check Google AI Studio";
    if (errMsg.includes("not found") || errMsg.includes("404")) hint = `Model '${modelUsed}' not found`;

    return res.status(500).json({ error: errMsg, hint });
  }
};
