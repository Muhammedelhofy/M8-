/**
 * M8 Orchestrator
 *
 * Single decision point for every message. Today it routes:
 *   Memory → LLM → Store
 *
 * Future slots (add here, not in chat.js):
 *   Memory → Search → Analysis → LLM → Store
 */
const { GoogleGenAI } = require("@google/genai");
const { recallMemory, saveMemory } = require("./memory");

const M8_SYSTEM_PROMPT = `You are M8, the personal AI agent of Muhammad El-Hofy — Senior Operations Manager based in Riyadh, Saudi Arabia.

LANGUAGE RULE: Always match the user's language exactly.
- If the user writes in Arabic, respond in Arabic.
- If the user writes in English, respond in English.

PERSONALITY: You are like Jarvis — intelligent, direct, concise, professional.

CONTEXT: Muhammad manages a Bolt KSA bike delivery fleet (~102 bikes). He oversees Hunger Station, Noon, Keeta, Uber courier supply. He also has YouTube channels and is interested in AI. Based in Riyadh, Egyptian.

RESPONSE STYLE: Keep responses short and clear. You are often read aloud. Be direct.`;

async function orchestrate({ message, sessionId, history }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  // ── 1. MEMORY ──────────────────────────────────────────────────
  // Retrieve recent exchanges from past sessions (cross-session recall).
  const pastMemory = await recallMemory(sessionId);

  // Inject past memory into system prompt so M8 "remembers" without
  // polluting the conversation turns that Gemini validates.
  let systemInstruction = M8_SYSTEM_PROMPT;
  if (pastMemory.length > 0) {
    const memoryLines = pastMemory
      .map((m) => `${m.role === "assistant" ? "M8" : "Muhammad"}: ${m.content}`)
      .join("\n");
    systemInstruction +=
      `\n\nMEMORY — past sessions (use for context, do not repeat verbatim):\n${memoryLines}`;
  }

  // ── 2. COMPOSE ─────────────────────────────────────────────────
  // Map current session history. Strip any leading model messages
  // (the welcome message can cause Gemini to reject the payload).
  const recentHistory = (history || []).slice(-20);
  let contents = recentHistory.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));
  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }

  // Append current user message (history was sent without it).
  contents.push({ role: "user", parts: [{ text: message }] });

  // ── 3. EXECUTE ─────────────────────────────────────────────────
  const result = await ai.models.generateContent({
    model: modelName,
    contents,
    config: { systemInstruction },
  });
  const response = result.text;

  // ── 4. STORE ───────────────────────────────────────────────────
  await saveMemory(sessionId, message, response);

  return response;
}

module.exports = { orchestrate };
