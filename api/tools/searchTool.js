/**
 * M8 Search Tool — api/tools/searchTool.js
 *
 * Pure Tavily wrapper. Returns raw results only.
 * No summarization, no ranking, no reasoning — Gemini handles that.
 */

const TAVILY_URL = "https://api.tavily.com/search";

// Per-category Tavily parameters
const CATEGORY_PARAMS = {
  NEWS:       { search_depth: "basic",    topic: "news",    days: 7,  max_results: 5 },
  RESEARCH:   { search_depth: "advanced", topic: "general",           max_results: 5 },
  FACT_CHECK: { search_depth: "advanced", topic: "general",           max_results: 5, include_answer: true },
};

async function searchTavily(query, category = "RESEARCH") {
  const params = CATEGORY_PARAMS[category] || CATEGORY_PARAMS.RESEARCH;

  const body = {
    api_key: process.env.TAVILY_API_KEY,
    query,
    ...params,
  };

  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return { results: data.results || [], answer: data.answer || null };
}

module.exports = { searchTavily };
