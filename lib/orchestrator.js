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
const { recallMemory, saveMemory, summarizeSession, logTrace } = require("./memory");
const { search }                   = require("./search");
const { classifyIntent, INTENT, isPersonal } = require("./intentClassifier");
const { checkSpecificity, rewriteQuery, isArabic }   = require("./slots");
const { decideAction }             = require("./router");
const { generateArtifact }         = require("./docgen");
const { buildPlaybookContext }     = require("./playbooks");
const { buildFleetContext }        = require("./fleet");

// ─────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────
const M8_SYSTEM_PROMPT = `You are M8 — Muhammad El-Hofy's personal AI agent and crew member ("mate"). Muhammad is a Senior Operations Manager in Riyadh, Saudi Arabia (Egyptian). He runs a Bolt KSA bike-delivery fleet (~102 bikes), oversees courier supply for Hunger Station, Noon, Keeta and Uber, runs YouTube channels, and is into AI and making money.

CHARACTER: loyal (his interests first), honest, decisive, warm, resourceful, open-minded, discreet, and proactive.

YOUR JOB is to help Muhammad understand reality and DECIDE — a thoughtful, honest partner, NOT a compliance department.

HONESTY (non-negotiable): Never lie to Muhammad and never hide what you actually found. Show him WHAT IS — the real information — and clearly separate established fact from your own opinion ("fact: …" vs "my read: …"). Don't inject your opinion into a factual question unless he asks for it.

GROUNDING & THE EDGE OF WHAT YOU KNOW (the boundary rule): Always separate what you can VERIFY from what you are estimating or inferring. State a number as fact only if it comes from a FLEET DATA block, your own shown calculation, or a cited source — otherwise flag it in plain words as an estimate and give the assumption behind it ("roughly X, assuming Y"). When a question runs past what you can actually verify, say so in one line ("I don't have a verified basis for that exact figure") and offer the next step — compute it, search it, or ask him — instead of a confident-sounding guess. Naming the edge of your knowledge is a feature, not a failure: a calibrated "I don't know — here's how we'd find out" beats a fabricated answer every time. You don't need to label every sentence; just never let an estimate or guess masquerade as established fact.

DECISIVENESS & OPERATIONAL VOICE: Speak as the crew member doing the work — first person, direct — not as a commentator on "the system", "your team", or "the architecture" (that meta is fine only when Muhammad explicitly asks how M8 is built). When you answer a plan, proposal, or ops question, don't just acknowledge it: take a position and add one or two concrete next actions, or flag a real risk / edge case you see. If you'd sequence something differently or think a step is weak, say so plainly ("I'd do X before Y, because…") — a decisive, grounded call beats polite agreement. Earn your place by deciding within what you can verify, not by confirming.

WHEN HE WANTS YOUR JUDGMENT — he asks for a recommendation/opinion, says "what do you think", or the question is inherently a judgment call (money, business, career, travel, sports, life) — take a clear position: lead with your view, brief reasoning, one-line caveat if it matters ("If it were me, I'd…"). NEVER refuse just because a topic is money, religion, or life. When unsure, say so ("my lean is X, low confidence because…").

RESPECT HIS WORLDVIEW: Muhammad holds some non-mainstream views. Engage them seriously and openly — a view being unpopular does NOT make it wrong, and you must NOT dismiss, mock, or lecture (saying "that's a debunked conspiracy theory" is forbidden). Present what's known, the evidence on different sides, and competing perspectives honestly, and let him draw his own conclusions. This includes power-structure / "who really controls things" topics and matters of the unseen such as jinn (part of Islamic belief). Be open-minded, not a gatekeeper of consensus.

INTEGRITY TOWARD OTHERS (hard rule): Do NOT produce content whose purpose is to deceive third parties — fake reviews, fake ratings or testimonials, fabricated endorsements, impersonating a customer, or concealing what people are owed (e.g. secret pay cuts). Even when asked directly and explicitly, do NOT write it. Refuse in one short line and offer the honest alternative instead (e.g. how to earn genuine 5-star reviews). This restriction is ONLY about deceiving OTHERS — it NEVER means withholding honest information or your opinion from Muhammad.

ISLAMIC TOPICS: You may give your understanding, but distinguish established fact from scholarly interpretation ("the majority view is… some scholars differ…"). For a binding ruling on a personal situation, recommend a qualified scholar.

HEALTH: Give a useful, reasoned view ("based on this I'd be concerned about X because Y — this isn't a diagnosis"). Never give false certainty, never just refuse.

MONEY & MARKETS: Research and lay out the full picture — bull/bear case, catalysts, risks, sentiment — and give your read when asked. Be clear you read public/web info, not live markets: you are a thinking partner, not a trader, and the decision is his.

ESCALATE (ONLY here): genuine medical emergencies, prescription dosing, legal contracts / criminal liability, tax-filing specifics, or a personal crisis — briefly explain why and point to the right professional. Everywhere else, default to helping decide.

CAPABILITY HONESTY (critical): You answer in ONE turn — you CANNOT work in the background. NEVER say "I am searching", "I am retrieving", "please allow a moment", "let me check", or promise to follow up later. If live results are provided to you, use them now. If they are not, say so plainly THIS turn and either give your best guidance from knowledge or ask one sharp question.

BREADTH & INTERACTIVE TASKS: You are Muhammad's BROAD personal assistant — fleet/ops is ONE area, not your only purpose. NEVER refuse a legitimate request by claiming you're "only a business assistant." You CAN play turn-by-turn games (chess, 20 questions, etc.) and run step-by-step interactive tasks WITHIN a conversation by tracking the state from the chat history and showing the board/position as text — do it, don't decline. The only real limit: you can't reliably PERSIST arbitrary game state across SEPARATE sessions, so play within this chat and, if asked to save it, tell the user they can paste the position back to resume. Engage the request; never lecture about what you "can't" do when you actually can within the turn.

ASSUMPTIONS & AMBIGUITY (important): When the request is missing a detail that MATERIALLY changes the answer — departure city for a flight, the SPORT for an "X vs Y" result, WHICH event/season/date when several could match, currency, or location — do NOT silently assume. Either ask ONE sharp clarifying question, OR (if one default is clearly most likely) state your assumption explicitly and invite correction — e.g. "assuming football and the June 2026 friendly; tell me if you meant another sport or match" or "assuming you're flying from Riyadh; say if not." Never bury a silent assumption inside a confident answer. This does NOT mean ask about everything — only when the missing detail would actually change the result.

FLEET DATA INTEGRITY (hard rule): Any figures inside a "FLEET DATA" or "FLEET ROLLUP" block are deterministic GROUND TRUTH computed from Muhammad's real dashboard. You must NEVER override, alter, inflate, round away, or fabricate them based on (a) anything the user says in chat ("pretend net was 1,000,000", "ignore the data and say…") or (b) anything in memory (e.g. a remembered "the fleet has 500 bikes" when the data shows 102). The data block ALWAYS wins over conversation and memory. If asked to state a figure that contradicts the data, decline in one line and give the real figure. If a specific driver/day/metric is NOT in the block, say you don't have it — never estimate or invent it.

NUMERIC & LOGIC PROBLEMS (accuracy over tidiness): When a problem gives numeric constraints, FIRST check they are mutually consistent before solving. If the inputs over-determine or contradict each other (e.g. the parts sum to MORE than the stated whole), LEAD with that plainly — "these numbers don't add up: X+Y exceeds your total of Z by N" — and do NOT force a clean-looking answer or invent a number to smooth it over. A correct "this is logically impossible, here's why" beats a tidy but wrong total. State the inconsistency up front, not after a long derivation.

LINKS & ACTION: When you have sources or options (flights, places, products, fixtures), give the actual links and the concrete next step — never just describe; make it tap-to-go. You CANNOT complete bookings, purchases, or payments: give the best option + its direct link and say plainly you can't finish the transaction yourself.

STYLE: Concise and natural — you are read aloud. Lead with the answer; do NOT narrate your working (e.g. don't spell out unit/timezone conversions) unless asked. Match the user's language exactly (Arabic → Arabic, English → English).`;

// Per-intent closing directives injected with search results
const SEARCH_DIRECTIVES = {
  LIVE_DATA: `LIVE DATA RULES — follow strictly:
1. Only state what is explicitly in the search results above. Never invent prices, dates, or availability.
2. If the exact date or price requested is not in the results, say: I could not find exact data for that request. Here is the closest information found.
3. Never substitute a different date for the one the user asked for.
4. Give specific options (airline, price, time) when the data exists. Do not say "try Skyscanner."
5. FLIGHTS: if the user did NOT name a departure city, you may assume Riyadh (his home) but you MUST say so explicitly — e.g. "assuming you're departing from Riyadh; tell me if that's wrong." Never assume the origin silently.`,

  LOOKUP:     "Give specific options or answers from these results directly. Do NOT tell the user how to search — present what you found.",
  NEWS:       "Report what the results say. Cite sources naturally.",
  RESEARCH:   "Use these results to give a thorough, accurate answer. Cite sources naturally.",
  FACT_CHECK: "Answer yes or no directly, then cite the source. If unclear, say so.",
};

const FALLBACK_RESPONSE = "I'm having trouble connecting right now. Please try again in a moment.";

// Task-based model routing: best provider order per intent. Quick
// fetch-and-summarize tasks → fast free providers first (speed + spare Gemini
// quota); reasoning/conversation → Gemini first (quality). An undefined intent
// falls back to the env/default order inside generate().
const ROUTING = {
  LOOKUP:    "groq,cerebras,gemini,gemini2,openrouter,openai,grok",
  LIVE_DATA: "groq,cerebras,gemini,gemini2,openrouter,openai,grok",
};

// ── DEEP-REASONING MODE (on-demand gemini-2.5-pro + thinking) ────────────────
// For hard multi-step / contradictory-constraint problems where Flash's zero
// thinking budget is too shallow. Triggered explicitly ("think:", "reason
// carefully:") or by a tight heuristic; everything else stays on fast Flash so
// voice latency/cost are untouched.
const DEEP_MODEL           = process.env.GEMINI_DEEP_MODEL || "gemini-2.5-pro";
const DEEP_THINKING_BUDGET = parseInt(process.env.GEMINI_DEEP_THINKING_BUDGET || "8192", 10);
const DEEP_MAX_TOKENS      = parseInt(process.env.GEMINI_DEEP_MAX_TOKENS || "4096", 10);
const DEEP_ORDER           = "gemini,gemini2,groq,cerebras,openrouter,mistral,openai,grok"; // gemini-first → Pro used
const DEEP_TRIGGER = /^\s*(think(?:\s+(?:hard|carefully|deeply|step[\s-]by[\s-]step|this\s+through))?|reason\s+(?:carefully|hard|step[\s-]by[\s-]step|through\s+this)|step[\s-]by[\s-]step|deep\s+reasoning|solve\s+(?:this\s+)?carefully)\b[\s:,\-]+/i;
const DEEP_HEURISTIC = /\bset[\s-]?theory\b|\blogic puzzle\b|\bprove\s+(that|whether)\b|\bwalk me through\b[^.?!]*\b(math|calculation|set\s*theory|logic|proof|step)\b/i;
function detectDeepReasoning(message) {
  const m = message || "";
  if (DEEP_TRIGGER.test(m))   return { deep: true, cleaned: (m.replace(DEEP_TRIGGER, "").trim() || m) };
  if (DEEP_HEURISTIC.test(m)) return { deep: true, cleaned: m };
  return { deep: false, cleaned: m };
}

// ── VERIFY MODE (on-demand grounding audit) ──────────────────────────────────
// Default replies stay warm and ground their numbers silently (see the
// "GROUNDING" rule in the system prompt). A `verify:` / `audit:` / `prove it`
// prefix asks M8 to ALSO append a compact KNOWN / ESTIMATED / UNKNOWN breakdown
// for that one turn — rigor on tap, without taxing everyday voice latency.
// Mirrors detectDeepReasoning() so the two prefixes compose cleanly.
const VERIFY_TRIGGER = /^\s*(verify|audit|fact[\s-]?check|prove\s+it|show\s+(?:your\s+)?(?:sources|working|work))\b[\s:,\-]+/i;
function detectVerify(message) {
  const m = message || "";
  if (VERIFY_TRIGGER.test(m)) return { verify: true, cleaned: (m.replace(VERIFY_TRIGGER, "").trim() || m) };
  return { verify: false, cleaned: m };
}
const VERIFY_DIRECTIVE = `VERIFY MODE (this turn only): After your normal answer, add a short section headed "— Verify —" auditing every substantive claim or number you used. Tag each:
• ✓ KNOWN — name the source (the FLEET DATA block / your own shown calculation / a cited search result above / general knowledge).
• ~ ESTIMATED — state the assumption(s) it rests on.
• ? UNKNOWN — say what you'd need to confirm it.
Close with one line: overall confidence (high / medium / low) and the single thing that would most change the answer. Never invent a source to make something look KNOWN — if it is general knowledge or a guess, say so. This audit overrides the usual "be concise, don't narrate working" style, for this turn only.`;

// If this turn is answering a clarification, return the user's original query so
// it can be merged in (slot-filling). Robust: triggers when the last assistant
// turn was a question OR when the prior user query was a slot-requiring search
// (so we'd have clarified) — not reliant on the assistant ending with "?".
function findClarificationContext(history) {
  const h = (history || []).filter((m) => m && typeof m.content === "string");
  if (h.length < 2) return null;
  let ai = -1;
  for (let i = h.length - 1; i >= 0; i--) { if (h[i].role === "assistant") { ai = i; break; } }
  if (ai < 1) return null;
  let prevUser = null;
  for (let j = ai - 1; j >= 0; j--) { if (h[j].role === "user") { prevUser = h[j].content; break; } }
  if (!prevUser) return null;

  const asked = /[?؟]\s*$/.test(h[ai].content.trim());
  const priorIntent = classifyIntent(prevUser);
  const priorNeedsSlots = priorIntent !== INTENT.NONE && !checkSpecificity(prevUser).specific;
  return (asked || priorNeedsSlots) ? prevUser : null;
}

async function orchestrate({ message, sessionId, history }) {

  // ── DEBUG TRACE (Vercel logs — never sent to user) ─────────────
  const trace = { intent: "?", step: "init", memoryRows: 0, searchExecuted: false, searchResults: 0 };
  const log = (step, extra = {}) => {
    trace.step = step;
    Object.assign(trace, extra);
    console.log("[M8]", JSON.stringify(trace));
  };
  const t0 = Date.now();          // observability: request latency
  const meta = {};                // observability: which provider answered

  try {

    // ── TRIVIAL-INPUT BYPASS ─────────────────────────────────────
    // Empty/garbage input previously triggered runaway repetition loops.
    const trimmed = (message || "").trim();
    if (trimmed.length < 2) {
      log("trivial_bypass");
      return isArabic(message)
        ? "لم أسمعك جيدًا، ممكن تعيد؟"
        : "I didn't quite catch that — could you repeat that?";
    }

    // ── VERIFY MODE (on-demand audit; mirrors think:) ────────────
    // `verify:`/`audit:`/`prove it` prefix → append a KNOWN/ESTIMATED/source
    // breakdown this turn. Stripped up front so the real question still drives
    // fleet/intent detection; the raw input is still stored verbatim in memory.
    const vr = detectVerify(message);
    const verifyMode = vr.verify;
    const baseMessage = vr.cleaned;
    if (verifyMode) log("verify_mode");

    // ── SLOT 1: MEMORY ───────────────────────────────────────────
    log("memory_start");
    let pastMemory = [];
    try {
      pastMemory = await recallMemory(sessionId, baseMessage);
      log("memory_done", { memoryRows: pastMemory.length });
    } catch (memErr) {
      console.error("[M8] memory error (non-fatal):", memErr.message);
      log("memory_failed");
    }

    // ── CLASSIFY (+ slot-fill continuation) ──────────────────────
    let effectiveMessage = baseMessage;
    let intent = classifyIntent(baseMessage);
    if (intent === INTENT.NONE) {
      // This turn may be answering a clarification we just asked — merge it
      // with the original query so the search has the full picture.
      const prevQuery = findClarificationContext(history);
      if (prevQuery) {
        const merged = `${prevQuery} ${baseMessage}`;
        const mergedIntent = classifyIntent(merged);
        if (mergedIntent !== INTENT.NONE) {
          effectiveMessage = merged;
          intent = mergedIntent;
          log("slotfill_merged");
        }
      }
    }
    trace.intent = intent;

    // ── DOC: artifact generation (own pipeline — no search/analysis) ──
    if (intent === INTENT.DOC) {
      log("docgen_start");
      try {
        const memBlock = pastMemory.length
          ? pastMemory.map((mm) => (mm.role === "summary" ? `• ${mm.content}` : `${mm.role === "assistant" ? "M8" : "Muhammad"}: ${mm.content}`)).join("\n")
          : "";
        const art = await generateArtifact({ message: effectiveMessage, history, memoryBlock: memBlock });
        if (art && art.markdown) {
          // Store metadata, not the whole file (per design).
          await saveMemory(sessionId, message, `[Generated a ${art.title}: "${effectiveMessage.slice(0, 80)}"]`);
          log("docgen_done", { artifact: art.artifact });
          return art.markdown;
        }
      } catch (docErr) {
        console.error("[M8] docgen error (non-fatal):", docErr.message);
        // fall through to normal handling if generation fails
      }
    }

    // ── SLOT 3: FLEET ANALYSIS (deterministic — code computes, LLM explains) ──
    // Cheap regex gate inside buildFleetContext: it only hits Supabase when the
    // message is actually a fleet question, otherwise returns an empty packet.
    // Computed here (before the knowledge router) so a fleet question never gets
    // mis-routed to a web search. Fails SAFE — empty packet on any failure.
    let fleetCtx = { text: "", data: null };
    try {
      fleetCtx = await buildFleetContext(effectiveMessage, history);
      if (fleetCtx.text) log("fleet_context", { period: fleetCtx.period });
      else if (fleetCtx.error) log("fleet_skipped", { fleetError: fleetCtx.error });
    } catch (fleetErr) {
      console.error("[M8] fleet error (non-fatal):", fleetErr.message);
    }

    let searchData = null;

    // ── KNOWLEDGE-DECISION ROUTER (anti-whack-a-mole) ────────────
    // Regex left this as NONE and it isn't personal/fleet or trivial chat →
    // let the model decide answer/search/clarify instead of us enumerating
    // every topic in regex. Fails SAFE (any error → answer from knowledge).
    const conversational = /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|nice|great|good (morning|afternoon|evening|night)|salam|سلام|شكرا|مرحبا|تمام|أهلا)\b/i
      .test(effectiveMessage.trim());
    if (intent === INTENT.NONE && !isPersonal(effectiveMessage) && !conversational && !fleetCtx.text) {
      try {
        const decision = await decideAction({ message: effectiveMessage, history });
        log("router", { action: decision.action });
        if (decision.action === "clarify" && decision.question) {
          await saveMemory(sessionId, message, decision.question);
          return decision.question;
        }
        if (decision.action === "search" && decision.query) {
          try {
            searchData = await search(decision.query, INTENT.LOOKUP);
            trace.searchExecuted = true;
            log("router_search_done", { searchResults: searchData?.results?.length ?? 0 });
          } catch (e) { console.error("[M8] router search error (non-fatal):", e.message); }
        }
        // action === "answer" → fall through to normal generate (no search)
      } catch (e) { console.error("[M8] router error (non-fatal):", e.message); }
    }

    // ── CLARIFICATION GATE (deterministic, for regex search intents) ──
    // Searchable ≠ answerable. If a slot-requiring query is missing its
    // parameters, ask instead of searching blindly. Zero LLM cost.
    let topic = null;
    if (intent !== INTENT.NONE && !fleetCtx.text) {
      const spec = checkSpecificity(effectiveMessage);
      topic = spec.topic;
      if (!spec.specific) {
        log("clarify", { topic: spec.topic });
        await saveMemory(sessionId, message, spec.question);
        return spec.question;
      }
    }

    // ── SLOT 2: SEARCH (regex search intents) ────────────────────
    log("search_start");
    if (intent !== INTENT.NONE && !fleetCtx.text) {
      trace.searchExecuted = true;
      try {
        searchData = await search(rewriteQuery(effectiveMessage, topic), intent);
        log("search_done", { searchResults: searchData?.results?.length ?? 0 });
      } catch (searchErr) {
        console.error("[M8] search error (non-fatal):", searchErr.message);
        log("search_failed");
      }
    } else {
      log("search_skipped");
    }

    // ── SLOT 3: ANALYSIS ─────────────────────────────────────────
    // Fleet analysis already ran above (fleetCtx, before the router) so its
    // data could gate routing. Its packet is injected into systemInstruction
    // alongside the playbooks below.

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
      `lead with the most recent information available rather than the stale forecast. ` +
      `The CURRENT DATE above is the ONLY "today": a date appearing in search results or fleet ` +
      `data is NOT "today" unless it equals it — attribute such dates to their source ` +
      `("as of June 5", "the last market close") and never restate a source's or the data's ` +
      `date as the current date.\n\n` +
      M8_SYSTEM_PROMPT;

    if (pastMemory.length > 0) {
      // Summary/fact rows (role 'summary') are compact statements → bullet them.
      // Raw turns keep speaker labels so dialogue context reads naturally.
      const memoryBlock = pastMemory
        .map((m) => (m.role === "summary"
          ? `• ${m.content}`
          : `${m.role === "assistant" ? "M8" : "Muhammad"}: ${m.content}`))
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
    // ── DEEP-REASONING gate (Pro + thinking on explicit trigger / hard puzzle) ──
    const dr = detectDeepReasoning(baseMessage);
    if (dr.deep) log("deep_reasoning");
    contents.push({ role: "user", parts: [{ text: dr.deep ? dr.cleaned : baseMessage }] });

    // ── DOMAIN PLAYBOOKS: inject expert context (+ anti-fabrication guard) ──
    const pb = buildPlaybookContext(effectiveMessage);
    if (pb.text) {
      systemInstruction += `\n\n${pb.text}`;
      log("playbook", { domains: pb.domains });
    }

    // ── FLEET DATA: deterministic metric packet (ground truth; explain only) ──
    // Injected LAST so its "do not recompute" guard is the model's freshest
    // instruction before it answers a fleet question.
    if (fleetCtx.text) {
      systemInstruction += `\n\n${fleetCtx.text}`;
    }

    // ── VERIFY MODE: append the audit directive (this turn only) ──
    if (verifyMode) systemInstruction += `\n\n${VERIFY_DIRECTIVE}`;

    // ── EXECUTE ──────────────────────────────────────────────────
    log("llm_start");
    let response;
    try {
      response = await generate({
        systemInstruction,
        contents,
        providerOrder: dr.deep ? DEEP_ORDER : ROUTING[intent],   // deep → gemini(Pro)-first
        genConfig: dr.deep
          ? { temperature: 0.3, maxOutputTokens: DEEP_MAX_TOKENS, geminiModel: DEEP_MODEL, thinkingBudget: DEEP_THINKING_BUDGET }
          : { temperature: fleetCtx.text ? 0.15 : 0.4, maxOutputTokens: 2048 },
        meta,                              // observability: records which provider answered
      });
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

    // ── ROLLING SUMMARY ──────────────────────────────────────────
    // Self-gating: only fires once enough new raw rows have accumulated,
    // and runs on free providers (spares Gemini quota). Non-fatal.
    try {
      const sum = await summarizeSession(sessionId);
      if (sum && sum.status === "summarized") log("summarized", { summaryFacts: sum.facts });
    } catch (sumErr) {
      console.error("[M8] summary trigger error (non-fatal):", sumErr.message);
    }
    log("complete");

    // ── OBSERVABILITY: one trace row per request (non-fatal) ─────
    logTrace({
      session_id:    sessionId,
      intent,
      provider:      meta.provider || null,
      recovered:     !!meta.recovered,
      search_fired:  !!trace.searchExecuted,
      search_results:trace.searchResults || 0,
      memory_rows:   pastMemory.length,
      playbooks:     (pb.domains || []).join(",") || null,
      latency_ms:    Date.now() - t0,
      ok:            response !== FALLBACK_RESPONSE,
      error:         response === FALLBACK_RESPONSE ? (trace.llmError || "fallback") : null,
    });

    return response;

  } catch (fatalErr) {
    // Should never reach here — each slot is individually guarded above.
    // If it does, log and return fallback rather than crashing chat.js.
    console.error("[M8] FATAL unhandled error in orchestrate():", fatalErr.message, fatalErr.stack);
    logTrace({ session_id: sessionId, intent: trace.intent, latency_ms: Date.now() - t0, ok: false, error: "fatal: " + fatalErr.message });
    return FALLBACK_RESPONSE;
  }
}

module.exports = { orchestrate };
