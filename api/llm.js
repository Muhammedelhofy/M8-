/**
 * M8 LLM Adapter — api/llm.js
 *
 * Single provider interface. Orchestrator calls generate() and knows nothing
 * about the underlying model. To hot-swap providers: replace this file only.
 *
 * Current provider: Google Gemini (via @google/genai SDK)
 */
const { GoogleGenAI } = require("@google/genai");

async function generate({ systemInstruction, contents }) {
  const ai    = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const result = await ai.models.generateContent({
    model,
    contents,
    config: { systemInstruction },
  });

  // ── ROBUST TEXT EXTRACTION ────────────────────────────────────
  // result.text is a getter that throws if the response has no text parts
  // (e.g. safety block, empty candidates). Extract defensively with logging.

  // Try result.text first (standard SDK getter)
  try {
    const text = result.text;
    if (text && typeof text === "string") return text;
  } catch (textGetterErr) {
    // Log the SDK getter error and fall through to manual extraction
    console.error("[LLM] result.text threw:", textGetterErr.message);
  }

  // Manual extraction — works across SDK versions
  const candidate = result?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const blockReason  = result?.promptFeedback?.blockReason;

  console.error("[LLM] Extracting text manually:", JSON.stringify({
    model,
    candidateCount:  result?.candidates?.length ?? 0,
    finishReason:    finishReason ?? "none",
    blockReason:     blockReason ?? "none",
    hasParts:        !!candidate?.content?.parts?.length,
  }));

  // Try manual part extraction
  const parts = candidate?.content?.parts ?? [];
  const textParts = parts.filter((p) => typeof p.text === "string" && p.text.length > 0);
  if (textParts.length > 0) {
    return textParts.map((p) => p.text).join("");
  }

  // Response was blocked or empty — throw with useful context
  const reason = blockReason ?? finishReason ?? "unknown";
  throw new Error(`Gemini returned no text. Reason: ${reason}`);
}

module.exports = { generate };
