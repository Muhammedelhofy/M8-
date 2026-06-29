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
 *   LLM_PROVIDER_ORDER   comma list, default "gemini,gemini2,groq,cerebras,mistral,openrouter,openai,grok"
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
 *   MISTRAL_API_KEY      Mistral key — FREE tier, console.mistral.ai
 *   MISTRAL_MODEL        default "mistral-small-latest"
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
// Shared Gemini request config (safety + generation params + thinking budget),
// used by both the buffered and streaming Gemini paths so they never drift.
function buildGeminiConfig(systemInstruction, genConfig) {
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
  // JSON mode for Gemini (constrained decoding) — set only when the caller asks.
  if (genConfig?.responseMimeType)    config.responseMimeType = genConfig.responseMimeType;
  // 2.5-flash "thinking" eats maxOutputTokens (caused truncation) + adds latency/cost.
  // Default OFF (0). A per-call genConfig.thinkingBudget (deep-reasoning mode) wins;
  // else the GEMINI_THINKING_BUDGET env; else 0.
  const thinkingBudget = genConfig?.thinkingBudget != null
    ? genConfig.thinkingBudget
    : (process.env.GEMINI_THINKING_BUDGET ? parseInt(process.env.GEMINI_THINKING_BUDGET, 10) : 0);
  // Only send thinkingConfig when budget > 0. gemini-2.0-flash (and 1.5-flash)
  // do not support the thinkingConfig field at all — sending it causes a 400.
  // Only gemini-2.5-* models accept it. Budget=0 means "off", so omitting the
  // field entirely achieves the same result for non-thinking models.
  if (thinkingBudget > 0) config.thinkingConfig = { thinkingBudget };
  // CODE EXECUTION (compute: mode) — let Gemini write+run Python in Google's
  // sandbox and return the computed result. The executed output is ground truth
  // (deterministic-first extends from fleet to general math). Gemini-only; on a
  // non-Gemini fallback this flag is simply ignored and the model answers normally.
  if (genConfig?.codeExecution) config.tools = [{ codeExecution: {} }];
  return config;
}

// Gemini's code-execution tool sometimes appends grounding-citation markers
// like "[3, 4]" to the narration — but a self-run computation has NO external
// sources, so they reference nothing (a narration-exceeds-evidence artifact).
// Strip them; only ever called on compute turns (genConfig.codeExecution set),
// so normal replies are untouched. Conservative: removes a space-preceded
// bracketed integer list, then tidies the spacing/punctuation it leaves behind.
function stripCodeExecCitations(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}

async function generateGeminiWith(apiKey, model, { systemInstruction, contents, genConfig }) {
  if (!apiKey) throw new Error("Gemini API key not set");

  const ai = new GoogleGenAI({ apiKey });
  const config = buildGeminiConfig(systemInstruction, genConfig);

  const result = await ai.models.generateContent({
    model,
    contents,
    config,
  });

  // ── ROBUST TEXT EXTRACTION ────────────────────────────────────
  // result.text is a getter that throws if the response has no text parts
  // (e.g. safety block, empty candidates). Extract defensively with logging.

  // Try result.text first (standard SDK getter). SKIP it for code-exec turns:
  // the getter can fold the model's "thought" planning part into the text, so
  // we route compute through the part-aware manual path below (which drops
  // thought parts) instead — the user must never see the raw planning preamble.
  if (!genConfig?.codeExecution) {
    try {
      const text = result.text;
      if (text && typeof text === "string") return text;
    } catch (textGetterErr) {
      console.error("[LLM] gemini result.text threw:", textGetterErr.message);
    }
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

  // Exclude "thought" parts (Gemini's internal planning) — they're never for
  // the user. Two forms seen: (1) the SDK flags it p.thought===true; (2) on
  // code-exec turns the planning arrives as a PLAIN text part that opens with a
  // bare "thought" line (concatenated onto the real answer with no separator).
  // Drop both — no genuine answer begins with a standalone "thought" token.
  const parts        = candidate?.content?.parts ?? [];
  const allTextParts = parts.filter((p) => typeof p.text === "string" && p.text.length > 0);
  const isPlanningPart = (p) => p.thought === true || /^\s*thought\s*\n/i.test(p.text);
  // Drop pure-planning parts — but NEVER nuke the sole text part (guards the
  // case where planning + answer share one part; better a leak than an empty reply).
  const nonPlanning  = allTextParts.filter((p) => !isPlanningPart(p));
  const chosen       = nonPlanning.length > 0 ? nonPlanning : allTextParts;
  if (chosen.length > 0) {
    const joined = chosen.map((p) => p.text).join("");
    return genConfig?.codeExecution ? stripCodeExecCitations(joined) : joined;
  }

  // Code-execution fallback: a compute turn can return only executed-code parts
  // (no narration text). Surface the computed output so we never throw on a
  // valid compute result.
  const execOut = parts
    .map((p) => p?.codeExecutionResult?.output)
    .filter((o) => typeof o === "string" && o.length > 0);
  if (execOut.length > 0) return execOut.join("\n");

  const reason = blockReason ?? finishReason ?? "unknown";
  throw new Error(`Gemini returned no text. Reason: ${reason}`);
}

async function generateGemini(args) {
  return generateGeminiWith(
    process.env.GEMINI_API_KEY,
    // per-call model override (deep-reasoning → gemini-2.5-pro) wins, else env default.
    args.genConfig?.geminiModel || process.env.GEMINI_MODEL || "gemini-1.5-flash",
    args
  );
}

// Second Gemini account = separate free-tier quota bucket. Used when the
// primary (personal) account hits its ~20/day cap, before falling to Groq.
async function generateGemini2(args) {
  return generateGeminiWith(
    process.env.GEMINI_API_KEY_2,
    args.genConfig?.geminiModel || process.env.GEMINI_MODEL_2 || process.env.GEMINI_MODEL || "gemini-1.5-flash",
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
    const partsArr = c.parts || [];
    const text = partsArr.map((p) => p?.text || "").join("");
    // Build-34: image (inlineData) parts → OpenAI multimodal content blocks
    // (gpt-4o family is vision-capable). The orchestrator only routes image turns
    // to vision providers, so a text-only model never receives these; if one ever
    // did, the content-block shape errors out (clean fail-over) rather than the
    // model silently answering blind about an image it can't see.
    const imageParts = partsArr.filter((p) => p && p.inlineData && p.inlineData.data);
    if (imageParts.length) {
      const blocks = [];
      if (text) blocks.push({ type: "text", text });
      for (const ip of imageParts) {
        blocks.push({ type: "image_url", image_url: { url: `data:${ip.inlineData.mimeType};base64,${ip.inlineData.data}` } });
      }
      messages.push({ role, content: blocks });
    } else if (text) {
      messages.push({ role, content: text });
    }
  }

  const payload = { model, messages, temperature: genConfig?.temperature ?? 0.7 };
  if (genConfig?.maxOutputTokens) payload.max_tokens = genConfig.maxOutputTokens;
  // Native JSON mode (Groq/Cerebras/Mistral/OpenRouter/OpenAI all accept this) — constrained
  // decoding beats prompt-only JSON. Harmless if a provider ignores it; the caller still parses
  // defensively. Only set when asked, so normal prose calls are unaffected.
  if (genConfig?.responseFormat) payload.response_format = genConfig.responseFormat;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);   // 30 s per-provider hard cap
  let res;
  try {
    res = await fetch(baseUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

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
// (openrouter.ai). Default targets a free model; override via OPENROUTER_MODEL,
// or per-call via genConfig.openrouterModel (used to pin anthropic/claude-fable-5
// for the Lean formalization step without changing the default).
async function generateOpenRouter(args) {
  return generateOpenAICompatible({
    providerName:      "openrouter",
    apiKey:            process.env.OPENROUTER_API_KEY,
    baseUrl:           "https://openrouter.ai/api/v1/chat/completions",
    model:             args.genConfig?.openrouterModel || process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
    systemInstruction: args.systemInstruction,
    contents:          args.contents,
    genConfig:         args.genConfig,
  });
}

// Anthropic — native Messages API (api.anthropic.com). Used for the Build-9 Lean
// formalization step (model claude-fable-5), where model ceiling matters most.
// Schema differs from OpenAI: `system` is a top-level field, content is block-shaped.
async function generateAnthropic(args) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Anthropic API key not set");
  const model = args.genConfig?.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-fable-5";

  const messages = [];
  for (const c of args.contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const text = (c.parts || []).map((p) => p?.text || "").join("");
    if (text) messages.push({ role, content: text });
  }

  const payload = { model, max_tokens: args.genConfig?.maxOutputTokens || 1024, messages };
  if (args.systemInstruction)               payload.system = args.systemInstruction;
  if (args.genConfig?.temperature != null)  payload.temperature = args.genConfig.temperature;

  const anthropicCtrl = new AbortController();
  const anthropicTimeout = setTimeout(() => anthropicCtrl.abort(), 30000);
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "content-type":     "application/json",
        "x-api-key":        apiKey,
        "anthropic-version": "2023-06-01",
      },
      body:   JSON.stringify(payload),
      signal: anthropicCtrl.signal,
    });
  } finally {
    clearTimeout(anthropicTimeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data?.content || [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("");
  if (!text) throw new Error("anthropic returned no text");
  return text;
}

// Mistral La Plateforme — FREE tier, OpenAI-compatible (api.mistral.ai).
async function generateMistral(args) {
  return generateOpenAICompatible({
    providerName:      "mistral",
    apiKey:            process.env.MISTRAL_API_KEY,
    baseUrl:           "https://api.mistral.ai/v1/chat/completions",
    model:             process.env.MISTRAL_MODEL || "mistral-small-latest",
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
  mistral:    generateMistral,
  openai:     generateOpenAI,
  grok:       generateGrok,
  anthropic:  generateAnthropic,
};

// ── CIRCUIT BREAKER ──────────────────────────────────────────────
// When a provider fails (esp. 429/quota), skip it for a cooldown window so we
// stop hammering it and fail over instantly. In-memory per warm instance —
// enough for a bursty single-user agent (consecutive requests reuse instances).
const providerCooldownUntil = {};
function coolDown(name, errMsg) {
  const rateLimited = /429|quota|rate.?limit|exhaust|too many|temporarily/i.test(errMsg || "");
  providerCooldownUntil[name] = Date.now() + (rateLimited ? 60000 : 15000);
}

// ── PAYLOAD GUARD (B-162) ────────────────────────────────────────
// A long M8 session (up to 20 turns, some carrying fleet tables / KG citations /
// long prior answers) can blow a provider's context window — the live "groq 413
// Request too large" that knocked out a key non-Google fallback right when Google
// was down. Drop the OLDEST turns first, ALWAYS keeping the final (current) turn,
// until contents fit a conservative char budget. Provider-agnostic; a no-op for
// normal short turns. Env-tunable; never trims systemInstruction (ground truth).
const LLM_MAX_CONTENT_CHARS = parseInt(process.env.LLM_MAX_CONTENT_CHARS || "32000", 10);
function trimContents(contents) {
  if (!Array.isArray(contents) || contents.length <= 1) return contents;
  const sz = (c) => { try { return JSON.stringify(c).length; } catch { return 0; } };
  let total = 0;
  const kept = [];
  for (let i = contents.length - 1; i >= 0; i--) {
    const len = sz(contents[i]);
    if (kept.length >= 1 && total + len > LLM_MAX_CONTENT_CHARS) break; // keep >=1 (the latest turn)
    total += len;
    kept.unshift(contents[i]);
  }
  // Gemini requires the first turn to be 'user' — drop any leading 'model' turn the trim exposed.
  while (kept.length > 1 && kept[0] && kept[0].role === "model") kept.shift();
  if (kept.length < contents.length) {
    console.warn(`[LLM] trimmed history ${contents.length}->${kept.length} turns (~${total} chars) to fit provider limits`);
  }
  return kept;
}

async function generate({ systemInstruction, contents, providerOrder, genConfig, meta }) {
  contents = trimContents(contents);
  // Default order favours FREE providers first (gemini, groq), then paid.
  // An optional per-call providerOrder overrides the env order — used e.g. by
  // background summarization to prefer free non-Gemini providers and spare quota.
  const order = (providerOrder || process.env.LLM_PROVIDER_ORDER || "gemini,gemini2,groq,cerebras,mistral,openrouter,openai,grok")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const errors = [];
  const now = Date.now();
  for (const name of order) {
    const fn = PROVIDERS[name];
    if (!fn) continue;
    // Skip providers currently in cooldown (recently rate-limited / failed).
    if (providerCooldownUntil[name] && providerCooldownUntil[name] > now) {
      errors.push(`${name}: cooling down`);
      continue;
    }

    try {
      const text = await fn({ systemInstruction, contents, genConfig });
      if (text && typeof text === "string") {
        delete providerCooldownUntil[name];          // healthy again
        if (meta) { meta.provider = name; meta.recovered = errors.length > 0; }
        if (errors.length) {
          console.warn(`[LLM] recovered via ${name} after: ${errors.join(" | ")}`);
        }
        return text;
      }
      errors.push(`${name}: empty response`);
    } catch (err) {
      // Trim noisy provider payloads (e.g. Gemini dumps a ~800-char 429 JSON).
      const brief = String(err.message || err).replace(/\s+/g, " ").slice(0, 140);
      console.error(`[LLM] provider ${name} failed:`, brief);
      errors.push(`${name}: ${brief}`);
      coolDown(name, brief);                          // circuit-break this provider
    }
  }

  if (meta) meta.provider = null;

  // Every configured provider failed — let orchestrator catch and show fallback.
  throw new Error(`All LLM providers failed → ${errors.join(" | ")}`);
}

// ─────────────────────────────────────────────────────────────────
// STREAMING (real token streaming for the voice path)
// ─────────────────────────────────────────────────────────────────
// Streams via Gemini's generateContentStream, calling onChunk(text) per chunk
// and returning the full accumulated text (the orchestrator still needs the
// whole reply for memory/trace). Only Gemini streams here; if every Gemini
// provider fails/cools down, it FALLS BACK to the buffered generate() chain
// (incl. the non-Gemini providers) and emits the whole reply as one chunk — so
// streaming never reduces reliability, it only improves time-to-first-token
// when Gemini is healthy. meta.streamed records which path served the turn.
async function generateStream({ systemInstruction, contents, providerOrder, genConfig, meta, onChunk, onReset }) {
  contents = trimContents(contents);
  const order = (providerOrder || process.env.LLM_PROVIDER_ORDER || "gemini,gemini2,groq,cerebras,mistral,openrouter,openai,grok")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const now = Date.now();
  const errors = [];
  // Track whether ANY chunk has been emitted to the client. If a Gemini stream
  // emits partial text then fails (or we switch to the buffered fallback), we
  // must RESET the client first — otherwise the next emitter's text concatenates
  // onto the abandoned partial (the "...This is aHeadline: net…" splice bug).
  let emitted = false;
  const resetIfNeeded = () => { if (emitted && onReset) { try { onReset(); } catch (_) {} } emitted = false; };

  for (const name of order) {
    if (name !== "gemini" && name !== "gemini2") continue;   // only Gemini streams; rest handled by the buffered fallback
    if (providerCooldownUntil[name] && providerCooldownUntil[name] > now) { errors.push(`${name}: cooling down`); continue; }
    const apiKey = name === "gemini" ? process.env.GEMINI_API_KEY : process.env.GEMINI_API_KEY_2;
    if (!apiKey) { errors.push(`${name}: no key`); continue; }
    const model = genConfig?.geminiModel
      || (name === "gemini"
            ? (process.env.GEMINI_MODEL || "gemini-1.5-flash")
            : (process.env.GEMINI_MODEL_2 || process.env.GEMINI_MODEL || "gemini-1.5-flash"));
    try {
      const ai = new GoogleGenAI({ apiKey });
      const config = buildGeminiConfig(systemInstruction, genConfig);
      const stream = await ai.models.generateContentStream({ model, contents, config });
      let full = "";
      let clientDisconnected = false;
      for await (const chunk of stream) {
        let t = "";
        try { t = chunk.text || ""; } catch { t = ""; }     // .text getter can throw on a part-less chunk
        if (t) {
          if (!full) resetIfNeeded();   // first chunk of THIS attempt → discard any earlier partial on the client
          full += t;
          if (onChunk) {
            try { onChunk(t); emitted = true; }
            catch (_writeErr) {
              // Client disconnected mid-stream. The provider is healthy — stop
              // iterating but do NOT circuit-break it. Return what we accumulated.
              clientDisconnected = true;
              break;
            }
          }
        }
      }
      if (full && full.trim()) {
        delete providerCooldownUntil[name];
        if (meta) { meta.provider = name; meta.recovered = errors.length > 0; meta.streamed = true; }
        if (clientDisconnected) console.warn(`[LLM] client disconnected mid-stream from ${name}; returning partial`);
        return full;
      }
      errors.push(`${name}: empty stream`);
    } catch (err) {
      const brief = String(err.message || err).replace(/\s+/g, " ").slice(0, 140);
      console.error(`[LLM] stream provider ${name} failed:`, brief);
      errors.push(`${name}: ${brief}`);
      coolDown(name, brief);
    }
  }

  // Fallback: the buffered chain (covers non-Gemini providers and any Gemini
  // streaming failure). Reset the client first if we already streamed a partial,
  // then emit the whole reply as a single clean chunk.
  if (errors.length) console.warn(`[LLM] stream fell back to buffered after: ${errors.join(" | ")}`);
  const text = await generate({ systemInstruction, contents, providerOrder, genConfig, meta });
  if (meta) meta.streamed = false;
  resetIfNeeded();
  if (onChunk && text) { try { onChunk(text); } catch (_) {} }
  return text;
}

// ─────────────────────────────────────────────────────────────────
// PINNED SINGLE-PROVIDER CALL (no fallback chain)
// ─────────────────────────────────────────────────────────────────
// For steps where a SPECIFIC model is the point and a silent substitution would
// defeat the purpose — Build-9 Lean formalization MUST be Fable 5, not whatever
// free provider happens to be warm. Calls exactly one provider with a pinned
// model and THROWS on failure (caller decides what the honest fallback is).
async function generateOnce({ provider, model, systemInstruction, contents, genConfig, meta }) {
  const name = (provider || "anthropic").toLowerCase();
  const fn = PROVIDERS[name];
  if (!fn) throw new Error(`generateOnce: unknown provider '${name}'`);

  const gc = { ...(genConfig || {}) };
  if (model) {
    if      (name === "anthropic")                   gc.anthropicModel  = model;
    else if (name === "openrouter")                  gc.openrouterModel = model;
    else if (name === "gemini" || name === "gemini2") gc.geminiModel    = model;
  }

  const text = await fn({ systemInstruction, contents, genConfig: gc });
  if (!text || typeof text !== "string") throw new Error(`generateOnce: ${name} returned no text`);
  if (meta) meta.provider = name;
  return text;
}

module.exports = { generate, generateStream, generateOnce };
