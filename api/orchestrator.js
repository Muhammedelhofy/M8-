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
const { generate }           = require("./llm");
const { recallMemory, saveMemory } = require("./memory");
const { search }             = require("./search");
const { classifyIntent, INTENT } = require("./intentClassifier");

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

async function orchestrate({ message, sessionId, history }) {

  // ── SLOT 1: MEMORY ─────────────────────────────────────────────
  // Phase 1: keyword-filtered recall from raw history
  // Phase 2: swap recallMemory() → recallSummaries() (one-line change)
  // Phase 3: swap → semanticRecall()
  const pastMemory = await recallMemory(sessionId, message);

  // ── SLOT 2: SEARCH ─────────────────────────────────────────────
  const intent = classifyIntent(message);
  let searchData = null;
  if (intent !== INTENT.NONE) {
    searchData = await search(message, intent);
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

  // Phase 2: inject search results as static context above the dynamic conversation
  if (searchData && searchData.results.length > 0) {
    const snippets = searchData.results
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content?.slice(0, 300) ?? ""}`)
      .join("\n\n");
    const answerLine = searchData.answer ? `\nDirect answer: ${searchData.answer}\n` : "";
    // LOOKUP queries need an explicit directive — Gemini defaults to generic advice otherwise
    const closingDirective = intent === INTENT.LOOKUP
      ? "Give the user specific options or answers from these results directly. Do NOT tell them how to search — act like Jarvis and present what you found."
      : "Cite sources naturally in your response.";
    systemInstruction +=
      `\n\nWEB SEARCH RESULTS (live, retrieved now — use these to answer):${answerLine}\n${snippets}\n\n${closingDirective}`;
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
  // Orchestrator is provider-agnostic — all model details live in llm.js
  const response = await generate({ systemInstruction, contents });

  // ── STORE ──────────────────────────────────────────────────────
  await saveMemory(sessionId, message, response);

  return response;
}

module.exports = { orchestrate };
