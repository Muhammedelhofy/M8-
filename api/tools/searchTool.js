/**
 * M8 Search Tool — api/tools/searchTool.js
 *
 * Pure Tavily wrapper. Returns raw results only.
 * No summarization, no ranking, no reasoning — Gemini handles that.
 */

const TAVILY_URL = "https://api.tavily.com/search";

// Per-category Tavily parameters.
// include_answer is intentionally omitted — it triggers Tavily's internal LLM
// which adds 3-8s latency and causes Vercel function timeouts. Gemini handles
// answer synthesis instead.
const CATEGORY_PARAMS = {
  NEWS:       { search_depth: "basic",    topic: "news",    days: 7, max_results: 5 },
  LIVE_DATA:  { search_depth: "basic",    topic: "general",          max_results: 5 },
  LOOKUP:     { search_depth: "basic",    topic: "general",          max_results: 5 },
  RESEARCH:   { search_depth: "advanced", topic: "general",          max_results: 5 },
  FACT_CHECK: { search_depth: "advanced", topic: "general",          max_results: 5 },
};

// 7-second hard timeout — leaves room for Gemini call within Vercel's 15s window
const TAVILY_TIMEOUT_MS = 7000;

async function searchTavily(query, category = "RESEARCH") {
  const params = CATEGORY_PARAMS[category] || CATEGORY_PARAMS.RESEARCH;

  const body = {
    api_key: process.env.TAVILY_API_KEY,
    query,
    ...params,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Tavily ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return { results: data.results || [], answer: data.answer || null };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searchTavily };
