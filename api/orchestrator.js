/**
 * M8 Orchestrator — api/orchestrator.js
 *
 * Single decision point for every message. All future capabilities
 * are added as slots in this pipeline — never in chat.js.
 *
 * Phase 1 (NOW):    Memory → LLM → Store
 * Phase 2 (NEXT):   Memory(summaries) → Search(Tavily) → LLM → Store
 * Phase 3 (FUTURE): Memory(semantic) → Search → Analysis(dashboard) → LLM → Store
 */
const { generate }                 = require("./llm");
const { recallMemory, saveMemory } = require("./memory");
const { search }                   = require("./search");
const { classifyIntent, INTENT }   = require("./intentClassifier");

// ─────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// Kept in orchestrator (business logic), not in llm.js (provider plumbing).
// Position: absolute TOP of every API call.
// Static content here enables future explicit prompt caching (Gemini ≥32K tokens).
// ─────────────────────────────────────────────────────────────────
const M8_SYSTEM_PROMPT = `You are M8, the personal AI agent of Muhammad El-Hofy — Senior Operations Manager based in Riyadh, Saudi Arabia.

LANGUAGE RULE: Always match the user's language exactly.
- If the user writes in Arabic, respond in Arabic.
- If the user writes in English, respond in English.

PERSONALITY: You are like Jarvis — intelligent, direct, concise, professional.

CONTEXT: Muhammad manages a Bolt KSA bike delivery fleet (~102 bikes). He oversees Hunger Station, Noon, Keeta, Uber courier supply. He also has YouTube channels and is interested in AI. Based in Riyadh, Egyptian.

RESPONSE STYLE: Keep responses short and clear. You are often read aloud. Be direct.`;

// Per-intent closing directives injected with search results
const SEARCH_DIRECTIVES = {
  LIVE_DATA: `LIVE DATA RULES — follow strictly:
1. Only state what is explicitly in the search results above. Never invent prices, dates, or availability.
2. If the exact date or price requested is not in the results, say: "I couldn't find exact data for [request]. Closest found: [what was found]."
3. Never substitute a different date for the one the user asked for.
4. Give specific options (airline, price, time) when the data exists. Do not say "try Skyscanner."`,

  LOOKUP: `Give specific options or answers from these results directly. Do NOT tell the user how to search — act like Jarvis and present what you found.`,

  NEWS:       `Report what the results say. Cite sources naturally.`,
  RESEARCH:   `Use these results to give a thorough, accurate answer. Cite sources naturally.`,
  FACT_CHECK: `Answer yes or no directly, then cite the source. If unclear, say so.`,
};

async function orchestrate({ message, sessionId, history }) {

  // ── DEBUG LOG (Vercel logs only — never sent to user) ──────────
  const dbg = {
    intent:         null,
    memoryRows:     0,
    searchExecuted: false,
    searchResults:  0,
    llmCalled:      false,
  };

  // ── SLOT 1: MEMORY ─────────────────────────────────────────────
  // Phase 2: swap recallMemory() → recallSummaries() (one-line change)
  // Phase 3: swap → semanticRecall()
  const pastMemory = await recallMemory(sessionId, message);
  dbg.memoryRows = pastMemory.length;

  // ── SLOT 2: SEARCH ─────────────────────────────────────────────
  const intent = classifyIntent(message);
  dbg.intent = intent;

  let searchData = null;
  if (intent !== INTENT.NONE) {
    dbg.searchExecuted = true;
    searchData = await search(message, intent);
    dbg.searchResults = searchData?.results?.length ?? 0;
  }

  // ── SLOT 3: ANALYSIS ───────────────────────────────────────────
  // Phase 3: const analysisContext = await analyze(message);
  // (api/analysis.js — dashboard/Excel, stubbed until Milestone 3)

  // ── COMPOSE: STATIC TOP → DYNAMIC BOTTOM ──────────────────────
  // Static layer (system prompt + retrieved memory) sits at the top.
  // Dynamic layer (current conversation + new message) sits at the bottom.
  // This structure is required for Gemini explicit prompt caching in Phase 2.

  let systemInstruction = M8_SYSTEM_PROMPT;

  if (pastMemory.length > 0) {
    const memoryBlock = pastMemory
      .map((m) => `${m.role === "assistant" ? "M8" : "Muhammad"}: ${m.content}`)
      .join("\n");
    systemInstruction +=
      `\n\nRELEVANT MEMORY (past sessions — use for context, do not repeat verbatim):\n${memoryBlock}`;
  }

  // Inject search results with intent-specific directive
  if (searchData && searchData.results.length > 0) {
    const snippets = searchData.results
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content?.slice(0, 300) ?? ""}`)
      .join("\n\n");
    const answerLine = searchData.answer ? `\nDirect answer: ${searchData.answer}\n` : "";
    const directive  = SEARCH_DIRECTIVES[intent] ?? "Cite sources naturally.";
    systemInstruction +=
      `\n\nWEB SEARCH RESULTS (live, retrieved now — use these to answer):${answerLine}\n${snippets}\n\n${directive}`;
  }

  // Phase 3 addition (analysis context injected into systemInstruction here)

  // Dynamic: current session history (strip leading model turns — Gemini requirement)
  const recentHistory = (history || []).slice(-20);
  let contents = recentHistory.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));
  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }

  // Current user message at absolute BOTTOM — always the final dynamic item
  contents.push({ role: "user", parts: [{ text: message }] });

  // ── EXECUTE ────────────────────────────────────────────────────
  dbg.llmCalled = true;
  const response = await generate({ systemInstruction, contents });

  // ── DEBUG OUTPUT ───────────────────────────────────────────────
  console.log("[M8]", JSON.stringify(dbg));

  // ── STORE ──────────────────────────────────────────────────────
  await saveMemory(sessionId, message, response);

  return response;
}

module.exports = { orchestrate };
