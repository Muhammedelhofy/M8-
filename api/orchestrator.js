/**
 * M8 Orchestrator — api/orchestrator.js
 *
 * Single decision point for every message. All future capabilities
 * are added as slots in this pipeline — never in chat.js.
 *
 * Phase 1 (NOW):    Memory → LLM → Store
 * Phase 2 (NEXT):   Memory(summaries) → Search(Tavily) → LLM → Store
 * Phase 3 (FUTURE): Memory(semantic) → Search → Analysis(dashboard) → LLM → Store
 *
 * FAULT TOLERANCE: Every slot is independently guarded.
 * A search failure → Gemini runs without search context.
 * A memory failure → Gemini runs without memory context.
 * Gemini failure → graceful fallback message returned.
 * orchestrate() NEVER throws — always returns a string.
 */
const { generate }                 = require("./llm");
const { recallMemory, saveMemory } = require("./memory");
const { search }                   = require("./search");
const { classifyIntent, INTENT }   = require("./intentClassifier");

// ─────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
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
2. If the exact date or price requested is not in the results, say: I could not find exact data for that request. Here is the closest information found.
3. Never substitute a different date for the one the user asked for.
4. Give specific options (airline, price, time) when the data exists. Do not say "try Skyscanner."`,

  LOOKUP:     "Give specific options or answers from these results directly. Do NOT tell the user how to search — present what you found.",
  NEWS:       "Report what the results say. Cite sources naturally.",
  RESEARCH:   "Use these results to give a thorough, accurate answer. Cite sources naturally.",
  FACT_CHECK: "Answer yes or no directly, then cite the source. If unclear, say so.",
};

const FALLBACK_RESPONSE = "I'm having trouble connecting right now. Please try again in a moment.";

async function orchestrate({ message, sessionId, history }) {

  // ── DEBUG TRACE (Vercel logs — never sent to user) ─────────────
  const trace = { intent: "?", step: "init", memoryRows: 0, searchExecuted: false, searchResults: 0 };
  const log = (step, extra = {}) => {
    trace.step = step;
    Object.assign(trace, extra);
    console.log("[M8]", JSON.stringify(trace));
  };

  try {

    // ── SLOT 1: MEMORY ───────────────────────────────────────────
    log("memory_start");
    let pastMemory = [];
    try {
      pastMemory = await recallMemory(sessionId, message);
      log("memory_done", { memoryRows: pastMemory.length });
    } catch (memErr) {
      console.error("[M8] memory error (non-fatal):", memErr.message);
      log("memory_failed");
    }

    // ── SLOT 2: SEARCH ───────────────────────────────────────────
    const intent = classifyIntent(message);
    trace.intent = intent;
    log("search_start");

    let searchData = null;
    if (intent !== INTENT.NONE) {
      trace.searchExecuted = true;
      try {
        searchData = await search(message, intent);
        log("search_done", { searchResults: searchData?.results?.length ?? 0 });
      } catch (searchErr) {
        console.error("[M8] search error (non-fatal):", searchErr.message);
        log("search_failed");
      }
    } else {
      log("search_skipped");
    }

    // ── SLOT 3: ANALYSIS ─────────────────────────────────────────
    // Phase 3: const analysisContext = await analyze(message);

    // ── COMPOSE: STATIC TOP → DYNAMIC BOTTOM ─────────────────────
    log("compose_start");

    // TEMPORAL ANCHOR — without this the model has no idea what "now" is and
    // will repeat stale projections as if current (e.g. "Metro projected for
    // 2025" answered in 2026). Inject today's date so it can reason about
    // whether dated info in the search results is past or future.
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Riyadh", year: "numeric", month: "long", day: "numeric", weekday: "long",
    });
    let systemInstruction =
      `CURRENT DATE: Today is ${today} (Riyadh time). ` +
      `Treat any date before today as the PAST. When sources cite a "projected", ` +
      `"planned", or "expected" date that has already passed, do NOT present that date ` +
      `as the current status or the takeaway. The deadline has passed, so the real ` +
      `status has almost certainly advanced beyond what older sources describe — say ` +
      `the projection date has passed and the situation is likely further along, and ` +
      `lead with the most recent information available rather than the stale forecast.\n\n` +
      M8_SYSTEM_PROMPT;

    if (pastMemory.length > 0) {
      const memoryBlock = pastMemory
        .map((m) => `${m.role === "assistant" ? "M8" : "Muhammad"}: ${m.content}`)
        .join("\n");
      systemInstruction += `\n\nRELEVANT MEMORY (past sessions — use for context, do not repeat verbatim):\n${memoryBlock}`;
    }

    if (searchData && Array.isArray(searchData.results) && searchData.results.length > 0) {
      const snippets = searchData.results
        .slice(0, 5)
        .map((r, i) => {
          const title   = r.title   ?? "(no title)";
          const url     = r.url     ?? "";
          const content = typeof r.content === "string" ? r.content.slice(0, 300) : "";
          return `[${i + 1}] ${title}\n    ${url}\n    ${content}`;
        })
        .join("\n\n");
      const answerLine = (typeof searchData.answer === "string" && searchData.answer)
        ? `\nDirect answer: ${searchData.answer}\n`
        : "";
      const directive = SEARCH_DIRECTIVES[intent] ?? "Cite sources naturally.";
      systemInstruction += `\n\nWEB SEARCH RESULTS (live, retrieved now — use these to answer):${answerLine}\n${snippets}\n\n${directive}`;
    }

    // Dynamic: current session history
    const recentHistory = (history || []).slice(-20);
    let contents = recentHistory
      .filter((msg) => msg && typeof msg.content === "string")  // guard against null/undefined content
      .map((msg) => ({
        role:  msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));
    while (contents.length > 0 && contents[0].role === "model") {
      contents.shift();
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    // ── EXECUTE ──────────────────────────────────────────────────
    log("llm_start");
    let response;
    try {
      response = await generate({ systemInstruction, contents });
      if (!response || typeof response !== "string") {
        console.error("[M8] LLM returned empty/invalid response:", response);
        log("llm_empty");
        response = FALLBACK_RESPONSE;
      } else {
        log("llm_done");
      }
    } catch (llmErr) {
      console.error("[M8] LLM error:", llmErr.message, llmErr.stack);
      log("llm_failed", { llmError: llmErr.message });
      response = FALLBACK_RESPONSE;
    }

    // ── STORE ────────────────────────────────────────────────────
    log("store_start");
    await saveMemory(sessionId, message, response);
    log("complete");

    return response;

  } catch (fatalErr) {
    // Should never reach here — each slot is individually guarded above.
    // If it does, log and return fallback rather than crashing chat.js.
    console.error("[M8] FATAL unhandled error in orchestrate():", fatalErr.message, fatalErr.stack);
    return FALLBACK_RESPONSE;
  }
}

module.exports = { orchestrate };
