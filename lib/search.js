/**
 * M8 Search — lib/search.js
 *
 * Thin interface between orchestrator and the search tools.
 * Orchestrator calls search(); this runs a PROVIDER WATERFALL and handles errors.
 * Tools stay swappable without touching orchestrator.
 *
 * Build-118 — WATERFALL (free-first, his "keep it free" rule):
 *   1. Serper  (google.serper.dev · 2,500/mo free · literal Google → best live data)
 *   2. Tavily  (api.tavily.com    · 1,000/mo free · fallback)
 * => ~3,500 free live searches/month. Each provider is env-gated and fails SAFE:
 * a throw or an empty result set falls through to the next; if all fail we return
 * an empty set and the orchestrator's EMPTY-SEARCH HONESTY GUARD tells the user
 * it couldn't verify (never fabricates). Gemini built-in grounding is a future
 * PAID tier-3 (kept OFF by default — premium opt-in).
 */
const { searchSerper } = require("./tools/serperSearch");
const { searchTavily } = require("./tools/searchTool");

function hasResults(out) {
  return out && Array.isArray(out.results) && out.results.length > 0;
}

async function search(query, category = "RESEARCH") {
  // ── Tier 1: Serper (free, literal Google) ──
  if (process.env.SERPER_API_KEY) {
    try {
      const out = await searchSerper(query, category);
      if (hasResults(out) || (out && out.answer)) {
        return out;
      }
      console.warn("[search] Serper returned no results — falling back to Tavily");
    } catch (err) {
      console.error("[search] Serper error (falling back to Tavily):", err.message);
    }
  }

  // ── Tier 2: Tavily (free fallback) ──
  if (process.env.TAVILY_API_KEY) {
    try {
      return await searchTavily(query, category);
    } catch (err) {
      console.error("[search] Tavily error:", err.message);
    }
  }

  // ── All providers exhausted → empty (orchestrator's honesty guard takes over) ──
  return { results: [], answer: null };
}

module.exports = { search };
