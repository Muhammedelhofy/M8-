module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const keys = {
    GEMINI_API_KEY:     !!process.env.GEMINI_API_KEY,
    GEMINI_API_KEY_2:   !!process.env.GEMINI_API_KEY_2,
    GEMINI_MODEL:       process.env.GEMINI_MODEL || "(default: gemini-1.5-flash)",
    GROQ_API_KEY:       !!process.env.GROQ_API_KEY,
    GROQ_MODEL:         process.env.GROQ_MODEL || "(default: llama-3.3-70b-versatile)",
    CEREBRAS_API_KEY:   !!process.env.CEREBRAS_API_KEY,
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    MISTRAL_API_KEY:    !!process.env.MISTRAL_API_KEY,
    OPENAI_API_KEY:     !!process.env.OPENAI_API_KEY,
    XAI_API_KEY:        !!process.env.XAI_API_KEY,
    SUPABASE_URL:       !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    TAVILY_API_KEY:     !!process.env.TAVILY_API_KEY,
    LLM_PROVIDER_ORDER: process.env.LLM_PROVIDER_ORDER || "(default: gemini,gemini2,groq,cerebras,openrouter,mistral,openai,grok)",
  };

  const activeProviders = [
    keys.GEMINI_API_KEY     && "gemini",
    keys.GEMINI_API_KEY_2   && "gemini2",
    keys.GROQ_API_KEY       && "groq",
    keys.CEREBRAS_API_KEY   && "cerebras",
    keys.OPENROUTER_API_KEY && "openrouter",
    keys.MISTRAL_API_KEY    && "mistral",
    keys.OPENAI_API_KEY     && "openai",
    keys.XAI_API_KEY        && "grok",
  ].filter(Boolean);

  const ok = activeProviders.length > 0 && keys.SUPABASE_URL && keys.SUPABASE_SERVICE_KEY;

  return res.status(ok ? 200 : 500).json({
    ok,
    timestamp: new Date().toISOString(),
    deploy: {
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      env: process.env.VERCEL_ENV || null,
    },
    activeProviders,
    keys,
  });
};
