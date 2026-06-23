/**
 * M8 Serper Search Tool — lib/tools/serperSearch.js  (Build-118)
 *
 * Pure Serper (google.serper.dev) wrapper. Serper returns LITERAL Google
 * results — far stronger than Tavily for live/transactional queries (scores,
 * weather, prices) because Google surfaces an answerBox / sports card with the
 * current value. Returns the SAME normalized shape as searchTool (Tavily):
 *   { results: [{ title, url, content }], answer: string|null }
 * so lib/search.js can use either provider interchangeably.
 *
 * Free tier: 2,500 searches/month. Paired with Tavily (1,000/mo) in the
 * lib/search.js waterfall => ~3,500 free live searches/month.
 *
 * No summarization or reasoning here — Gemini synthesizes the final answer
 * from the normalized snippets, exactly as it does for Tavily.
 */

const SERPER_URL = "https://google.serper.dev/search";

// 7-second hard timeout — leaves room for the Gemini answer call inside Vercel's
// ~15s window (mirrors searchTool's TAVILY_TIMEOUT_MS).
const SERPER_TIMEOUT_MS = 7000;

// Per-category Serper params. Serper is literal Google, so freshness is steered
// via `tbs` (time-based search). NEWS/LIVE_DATA bias to the past day/week so a
// live score or breaking item is current, not an evergreen page.
const CATEGORY_PARAMS = {
  NEWS:       { num: 8, tbs: "qdr:w" },  // past week
  LIVE_DATA:  { num: 8, tbs: "qdr:d" },  // past day — live scores/prices
  LOOKUP:     { num: 8 },
  RESEARCH:   { num: 8 },
  FACT_CHECK: { num: 8, tbs: "qdr:y" },  // past year — current status, not stale forecasts
};

// Normalize a raw Serper JSON payload into M8's canonical search shape.
// Pure + exported so the PS mirror test can assert the mapping without a network
// call. Serper's richest signals (answerBox, sports card, knowledgeGraph) become
// the `answer`; `organic` becomes the ranked snippet `results`.
function normalizeSerper(data) {
  if (!data || typeof data !== "object") return { results: [], answer: null };

  // answer: prefer the answerBox, then a sports scoreboard card, then the
  // knowledge-graph description. Any of these is Google's own "direct answer".
  let answer = null;
  const ab = data.answerBox;
  if (ab && typeof ab === "object") {
    answer = ab.answer || ab.snippet || ab.title || null;
  }
  if (!answer && data.sports_results && typeof data.sports_results === "object") {
    const sr = data.sports_results;
    // e.g. { title, games:[{teams, score}] } or { title, game_spotlight }
    if (sr.game_spotlight && typeof sr.game_spotlight === "string") {
      answer = `${sr.title ? sr.title + ": " : ""}${sr.game_spotlight}`;
    } else if (sr.title) {
      answer = sr.title;
    }
  }
  if (!answer && data.knowledgeGraph && typeof data.knowledgeGraph === "object") {
    answer = data.knowledgeGraph.description || data.knowledgeGraph.title || null;
  }

  const organic = Array.isArray(data.organic) ? data.organic : [];
  const results = organic
    .filter((o) => o && (o.link || o.title))
    .map((o) => ({
      title:   o.title || "(no title)",
      url:     o.link || "",
      // include the date prefix when Serper supplies one (e.g. "2 hours ago"),
      // so the source-trust recency pass and the model both see freshness.
      content: [o.date ? `(${o.date})` : "", o.snippet || ""].filter(Boolean).join(" ").trim(),
    }));

  return { results, answer: answer || null };
}

async function searchSerper(query, category = "RESEARCH") {
  if (!process.env.SERPER_API_KEY) {
    throw new Error("SERPER_API_KEY not set");
  }
  const params = CATEGORY_PARAMS[category] || CATEGORY_PARAMS.RESEARCH;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERPER_TIMEOUT_MS);

  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, ...params }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Serper ${res.status}: ${await res.text()}`);
    }

    return normalizeSerper(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searchSerper, normalizeSerper };
