/**
 * M8 Search — api/search.js
 *
 * Thin interface between orchestrator and searchTool.
 * Orchestrator calls search(); this delegates to the tool and handles errors.
 * searchTool stays swappable without touching orchestrator.
 */
const { searchTavily } = require("./tools/searchTool");

async function search(query, category = "RESEARCH") {
  try {
    return await searchTavily(query, category);
  } catch (err) {
    console.error("[search] Tavily error:", err.message);
    return { results: [], answer: null };
  }
}

module.exports = { search };
