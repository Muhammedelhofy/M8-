"use strict";
/**
 * GET /api/health -- Build-103
 * Shows which LLM providers are configured, plus Supabase connectivity.
 * Call this anytime M8 seems unresponsive to see exactly what is missing.
 */
const { createClient } = require("@supabase/supabase-js");

const PROVIDERS = [
  { name: "gemini",     key: "GEMINI_API_KEY",     label: "Gemini (primary, free)" },
  { name: "gemini2",    key: "GEMINI_API_KEY_2",   label: "Gemini 2 (backup free account)" },
  { name: "groq",       key: "GROQ_API_KEY",        label: "Groq / Llama (free, best backup)" },
  { name: "cerebras",   key: "CEREBRAS_API_KEY",    label: "Cerebras (free, fast)" },
  { name: "mistral",    key: "MISTRAL_API_KEY",     label: "Mistral (free tier)" },
  { name: "openrouter", key: "OPENROUTER_API_KEY",  label: "OpenRouter (free models available)" },
  { name: "openai",     key: "OPENAI_API_KEY",      label: "OpenAI (paid)" },
  { name: "grok",       key: "XAI_API_KEY",         label: "xAI Grok (paid)" },
];

module.exports = async function handler(req, res) {
  const providers = PROVIDERS.map(p => ({
    name:       p.name,
    label:      p.label,
    configured: !!process.env[p.key],
    keyHint:    process.env[p.key] ? process.env[p.key].slice(0, 6) + "..." : null,
  }));

  const configured = providers.filter(p => p.configured);
  const missing    = providers.filter(p => !p.configured);

  let supabase = { ok: false, error: "keys not set" };
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { error } = await db.from("m8_conversations").select("id").limit(1);
      supabase = error ? { ok: false, error: error.message } : { ok: true };
    }
  } catch (e) {
    supabase = { ok: false, error: e.message };
  }

  const llmOk = configured.length > 0;
  const ok    = llmOk && supabase.ok;

  return res.status(200).json({
    ok,
    llm: {
      ok:          llmOk,
      configured:  configured.map(p => p.name),
      missing:     missing.map(p => ({ name: p.name, label: p.label })),
    },
    supabase,
    advice: !configured.some(p => p.name === "groq")
      ? "Add GROQ_API_KEY (free at console.groq.com) as a Gemini quota backup. When Gemini hits its daily limit M8 goes silent without it."
      : null,
    sha: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  });
};
