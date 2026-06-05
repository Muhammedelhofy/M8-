/**
 * M8 LLM Adapter — api/llm.js
 *
 * Single provider interface. Orchestrator calls generate() and knows nothing
 * about the underlying model. To hot-swap to OpenAI / Groq / Claude:
 * replace this file only — zero changes anywhere else.
 *
 * Current provider: Google Gemini (via @google/genai SDK)
 */
const { GoogleGenAI } = require("@google/genai");

/**
 * Generate a response from the configured LLM.
 *
 * @param {Object} params
 * @param {string} params.systemInstruction  Static context (system prompt + memory).
 *                                           Sits at TOP of every call — primed for
 *                                           future explicit prompt caching (≥32K tokens).
 * @param {Array}  params.contents           Dynamic conversation turns [{role, parts}].
 *                                           Current user message is always the last item.
 * @returns {Promise<string>}
 */
async function generate({ systemInstruction, contents }) {
  const ai    = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const result = await ai.models.generateContent({
    model,
    contents,
    config: { systemInstruction },
  });

  return result.text;
}

module.exports = { generate };
