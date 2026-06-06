/**
 * M8 LLM Adapter — api/llm.js
 *
 * Single provider interface. Orchestrator calls generate() and knows nothing
 * about the underlying model(s). To change providers or priority: edit here only.
 *
 * MULTI-PROVIDER FALLBACK CHAIN
 * Default order: Gemini → Gemini2 → Groq → Cerebras → OpenRouter → OpenAI → Grok (free first).
 * If a provider fails for ANY reason — 429 quota, safety block, empty
 * response, network, missing key — generate() tries the next provider.
 * A provider with no API key set throws immediately and is skipped, so
 * listing one in the order before you have its key is harmless.
 *
 * Configure via env:
 *   LLM_PROVIDER_ORDER   comma list, default "gemini,gemini2,groq,cerebras,openrouter,openai,grok"
 *   GEMINI_API_KEY       Google Gemini key      (free tier — personal account, primary)
 *   GEMINI_MODEL         default "gemini-1.5-flash"
 *   GEMINI_API_KEY_2     2nd Gemini account key (separate free quota bucket — work account)
 *   GEMINI_MODEL_2       default = GEMINI_MODEL
 *   GROQ_API_KEY         Groq key — FREE, console.groq.com (NOT xAI Grok)
 *   GROQ_MODEL           default "llama-3.3-70b-versatile"
 *   CEREBRAS_API_KEY     Cerebras key — FREE, cloud.cerebras.ai (fast Llama)
 *   CEREBRAS_MODEL       default "llama3.3-70b"  (Cerebras naming: no hyphen after 'llama')
 *   OPENROUTER_API_KEY   OpenRouter key — FREE models available, openrouter.ai
 *   OPENROUTER_MODEL     default "meta-llama/llama-3.3-70b-instruct:free"
 *   OPENAI_API_KEY       OpenAI key             (paid)
 *   OPENAI_MODEL         default "gpt-4o-mini"
 *   XAI_API_KEY          xAI Grok key           (paid)
 *   XAI_MODEL            default "grok-2-latest"
 *
 * Both providers receive the SAME inputs:
 *   systemInstruction : string
 *   contents          : [{ role: "user"|"model", parts: [{ text }] }]
 * and return a plain string. Each provider translates as needed.
 */
const { GoogleGenAI } = require("@google/genai");

// ─────────────────────────────────────────────────────────────────
// PROVIDER: Google Gemini (via @google/genai SDK)
// ─────────────────────────────────────────────────────────────────
async function generateGeminiWith(apiKey, model, { systemInstruction, contents, genConfig }) {
  if (!apiKey) throw new Error("Gemini API key not set");

  const ai = new GoogleGenAI({ apiKey });

  const config = {
    systemInstruction,
    // Default Gemini filters silently block legit non-mainstream discussion
    // (conspiracy/power-structures/jinn) under DANGEROUS_CONTENT / HARASSMENT.
    // Relax to BLOCK_ONLY_HIGH so M8 can engage these honestly. (Owner is single
    // adult user; we still block the genuinely high-severity tier.)
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };
  if (genConfig?.temperature != null) config.temperature = genConfig.temperature;
  if (genConfig?.maxOutputTokens)     config.maxOutputTokens = genConfig.maxOutputTokens;

  const result = await ai.models.generateContent({
    model,
    contents,
    config,
  });

  // ── ROBUST TEXT EXTRACTION ────────────────────────────────────
  // result.text is a getter that throws if the response has no text parts
  // (e.g. safety block, empty candidates). Extract defensively with logging.

  // Try result.text first (standard SDK getter)
  try {
    const text = result.text;
    if (text && typeof text === "string") return text;
  } catch (textGetterErr) {
    console.error("[LLM] gemini result.text threw:", textGetterErr.message);
  }

  // Manual extraction — works across SDK versions
  const candidate    = result?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const blockReason  = result?.promptFeedback?.blockReason;

  console.error("[LLM] gemini extracting text manually:", JSON.stringify({
    model,
    candidateCount: result?.candidates?.length ?? 0,
    finishReason:   finishReason ?? "none",
    blockReason:    blockReason ?? "none",
    hasParts:       !!candidate?.content?.parts?.length,
  }));

  const parts     = candidate?.content?.parts ?? [];
  const textParts = parts.filter((p) => typeof p.text === "string" && p.text.length > 0);
  if (textParts.length > 0) {
    return textParts.map((p) => p.text).join("");
  }

  const reason = blockReason ?? finishReason ?? "unknown";
  throw new Error(`Gemini returned no text. Reason: ${reason}`);
}

async function generateGemini(args) {
  return generateGeminiWith(
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_MODEL || "gemini-1.5-flash",
    args
  );
}

// Second Gemini account = separate free-tier quota bucket. Used when the
// primary (personal) account hits its ~20/day cap, before falling to Groq.
async function generateGemini2(args) {
  return generateGeminiWith(
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_MODEL_2 || process.env.GEMINI_MODEL || "gemini-1.5-flash",
    args
  );
}

// ─────────────────────────────────────────────────────────────────
// PROVIDER: OpenAI-compatible (via fetch — no SDK dependency; Node 18+)
// Shared by OpenAI and xAI Grok — both expose the same /chat/completions
// schema, so only the base URL, key, and default model differ.
// ─────────────────────────────────────────────────────────────────
async function generateOpenAICompatible({ providerName, apiKey, baseUrl, model, systemInstruction, contents, genConfig }) {
  if (!apiKey) throw new Error(`${providerName} API key not set`);

  // Translate Gemini-shaped inputs → OpenAI-style chat messages.
  // model → assistant, user → user; systemInstruction → leading system message.
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  for (const c of contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const text = (c.parts || []).map((p) => p?.text || "").join("");
    if (text) messages.push({ role, content: text });
  }

  const payload = { model, messages, temperature: genConfig?.temperature ?? 0.7 };
  if (genConfig?.maxOutputTokens) payload.max_tokens = genConfig.maxOutputTokens;

  const res = await fetch(baseUrl, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${providerName} ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error(`${providerName} returned no text`);
  }
  return text;
}

async function generateOpenAI(args) {
  return generateOpenAICompatible({
    providerName:      "openai",
    apiKey:            process.env.OPENAI_API_KEY,
    baseUrl:           "https://api.openai.com/v1/chat/completions",
    model:             process.env.OPENAI_MODEL || "gpt-4o-mini",
    systemInstruction: args.systemInstruction,
    contents:          args.contents,
    genConfig:         args.genConfig,
  });
}

// xAI Grok — OpenAI-compatible endpoint. PAID API (console.x.ai).
// NOTE: confirm the exact model string in your xAI console and set XAI_MODEL.
// The "-latest" alias tracks the newest stable Grok; override if you want a pin.
async function generateGrok(args) {
  return generateOpenAICompatible({
    providerName:      "grok",
    apiKey:            process.env.XAI_API_KEY,
    baseUrl:           "https://api.x.ai/v1/chat/completions",
    model:             process.env.XAI_MODEL || "grok-2-latest",
    systemInstruction: args.systemInstruction,
    contents:          args.contents,
    genConfig:         args.genConfig,
  });
}

// Groq — FREE, fast, OpenAI-compatible (console.groq.com). NOT xAI's Grok.
// Generous free tier running Llama models — ideal for stacking free quota.
// Confirm the current model name in the Groq console and set GROQ_MODEL.
async function generateGroq(args) {
  return generateOpenAICompatible({
    providerName:      "groq",
    apiKey:            process.env.GROQ_API_KEY,
    baseUrl:           "https://api.groq.com/openai/v1/chat/completions",
    model:             process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    systemInstruction: args.systemInstruction,
    contents:          args.contents,
    genConfig:         args.genConfig,
  });
}

// Cerebras — FREE, extremely fast Llama inference, OpenAI-compatible (cloud.cerebras.ai).
// Confirm the current model name in the Cerebras console and set CEREBRAS_MODEL.
async function generateCerebras(args) {
  return generateOpenAICompatible({
    providerName:      "cerebras",
    apiKey:            process.env.CEREBRAS_API_KEY,
    baseUrl:           "https://api.cerebras.ai/v1/chat/completions",
    model:             process.env.CEREBRAS_MODEL || "llama3.3-70b",
    systemInstruction: args.systemInstruction,
    contents:          args.contents,
    genConfig:         args.genConfig,
  });
}

// OpenRouter — aggregator; one key → many models incl. free ":free" variants
// (openrouter.ai). Default targets a free model; override via OPENROUTER_MODEL.
async function generateOpenRouter(args) {
  return generateOpenAICompatible({
    providerName:      "openrouter",
    apiKey:            process.env.OPENROUTER_API_KEY,
    baseUrl:           "https://openrouter.ai/api/v1/chat/completions",
    model:             process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
    systemInstruction: args.systemInstruction,
    contents:          args.contents,
    genConfig:         args.genConfig,
  });
}

// ─────────────────────────────────────────────────────────────────
// FALLBACK CHAIN
// ─────────────────────────────────────────────────────────────────
const PROVIDERS = {
  gemini:     generateGemini,
  gemini2:    generateGemini2,
  groq:       generateGroq,
  cerebras:   generateCerebras,
  openrouter: generateOpenRouter,
  openai:     generateOpenAI,
  grok:       generateGrok,
};

async function generate({ systemInstruction, contents, providerOrder, genConfig }) {
  // Default order favours FREE providers first (gemini, groq), then paid.
  // An optional per-call providerOrder overrides the env order — used e.g. by
  // background summarization to prefer free non-Gemini providers and spare quota.
  const order = (providerOrder || process.env.LLM_PROVIDER_ORDER || "gemini,gemini2,groq,cerebras,openrouter,openai,grok")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const errors = [];
  for (const name of order) {
    const fn = PROVIDERS[name];
    if (!fn) continue;

    try {
      const text = await fn({ systemInstruction, contents, genConfig });
      if (text && typeof text === "string") {
        if (errors.length) {
          console.warn(`[LLM] recovered via ${name} after failures: ${errors.join(" | ")}`);
        }
        return text;
      }
      errors.push(`${name}: empty response`);
    } catch (err) {
      // Trim noisy provider payloads (e.g. Gemini dumps a ~800-char 429 JSON).
      const brief = String(err.message || err).replace(/\s+/g, " ").slice(0, 140);
      console.error(`[LLM] provider ${name} failed:`, brief);
      errors.push(`${name}: ${brief}`);
      // fall through to next provider
    }
  }

  // Every configured provider failed — let orchestrator catch and show fallback.
  throw new Error(`All LLM providers failed → ${errors.join(" | ")}`);
}

module.exports = { generate };
