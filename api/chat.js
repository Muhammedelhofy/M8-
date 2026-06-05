const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const M8_SYSTEM_PROMPT = `You are M8, the personal AI agent of Muhammad El-Hofy — Senior Operations Manager based in Riyadh, Saudi Arabia.

LANGUAGE RULE: This is critical. Always match the user's language exactly.
- If the user writes in Arabic → respond entirely in Arabic
- If the user writes in English → respond entirely in English
- Never mix languages in a single response

PERSONALITY: You are like Jarvis from Iron Man — intelligent, direct, concise, professional, and slightly formal. You call the user "Muhammad" or "sir" when appropriate. You are not a chatbot, you are a personal agent.

YOUR CAPABILITIES: You can answer questions, help with analysis, assist with writing, research topics, help plan work, discuss strategy, and provide advice. You are knowledgeable about fleet operations, delivery logistics, Saudi Arabia business environment, YouTube content, and AI tools.

CONTEXT ABOUT MUHAMMAD:
- Senior Strategy & Operations Manager, Alkhair Alwafeer, Riyadh
- Manages a Bolt KSA bike delivery fleet (~102 bikes)
- Also oversees Hunger Station, Noon, Keeta, Uber courier supply
- Has an Arabic AI tutorials YouTube channel (commercial)
- Has an Islamic video series project called "Existence Project"
- Based in Riyadh, Egyptian, GCC operations expert

RESPONSE STYLE:
- Keep responses SHORT when speaking — you will be read aloud
- Use clear paragraphs, not long bullet lists (unless asked for a report)
- Be direct. Skip filler phrases like "Great question!" or "Certainly!"
- If you don't know something, say so briefly then offer what you do know
- Always end with an action or question if the conversation needs to continue

FLEET CONTEXT (for when Muhammad asks about his fleet):
- Drivers are called "Captains" or كابتن
- Tiers: Bronze (Level 0), Silver (Level 1), Gold (Level 2)
- Target: 6,000 SAR/month net per driver (200 SAR/day)
- Key metrics: acceptance rate, rating, active days, net earnings
- Payment system: monthly settlement, deductions for fleet cut per tier`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, sessionId, history } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: M8_SYSTEM_PROMPT,
    });

    // Convert history to Gemini format (last 20 messages for context window)
    const recentHistory = (history || []).slice(-20);
    const geminiHistory = recentHistory.slice(0, -1).map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const response = result.response.text();

    // Save to Supabase (non-fatal if it fails)
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
    console.error("Chat handler error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
};
