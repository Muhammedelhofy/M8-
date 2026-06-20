/**
 * M8 Intent Classifier — api/intentClassifier.js
 *
 * Classifies a user message into one of six routing categories.
 * Priority order matters — first match wins.
 *
 * FACT_CHECK → NEWS → LIVE_DATA → LOOKUP → RESEARCH → NONE
 *
 * FACT_CHECK  Binary yes/no about an external event
 * NEWS        Recency signals — user wants what's happening now
 * LIVE_DATA   Real-time transactional data (flights, stocks, weather, rates)
 *             Tavily searches but response must NOT extrapolate or invent dates
 * LOOKUP      User expects M8 to FETCH a specific answer (schools, restaurants,
 *             locations, services) — general info, not time-sensitive
 * RESEARCH    User wants an explanation, summary, or background
 * NONE        Personal/operational/conversational — answered from memory
 */

const INTENT = {
  NONE:           "NONE",
  NEWS:           "NEWS",
  RESEARCH:       "RESEARCH",
  FACT_CHECK:     "FACT_CHECK",
  LOOKUP:         "LOOKUP",
  LIVE_DATA:      "LIVE_DATA",
  DOC:            "DOC",
  CONVERT:        "CONVERT",
  DRIVER_PROFILE: "DRIVER_PROFILE",
};

// Personal/possessive queries → memory (NOT web search, NOT the knowledge router).
const PERSONAL_PATTERNS = [
  /\bmy (fleet|drivers?|bikes?|team|schedule|earnings|salary|riders?|performance|data|stats|numbers)\b/,
  /\b(our|my) .{0,25}(this week|this month|today|last week|last month|yesterday)\b/,
];
function isPersonal(message) {
  return PERSONAL_PATTERNS.some((p) => p.test((message || "").toLowerCase()));
}

// Build-40: self-referential questions ABOUT M8 itself (its build/version/
// capabilities/architecture) are answered from build-state + memory, NEVER web
// search. Without this guard "what's your most recent build?" hits the `recent`
// token in newsPatterns and web-searches it (the documented Windows-update
// misroute). EXPORTED + reused by the orchestrator's buildQuery so the intent
// route AND the search-suppression/context-injection stay in lockstep (one
// regex, no drift). Requires a build/version token or an explicit you/your
// self-reference, so it never steals external "latest X news" / "recent updates
// from Y" queries.
const SELF_STATUS_RE = /\b(?:(?:most\s+recent|latest|last|current|newest|which|what|your)\s+(?:build|version)\b|what\s+build\s+(?:are|is|was|am)\b|build\s+number\b|(?:your|you'?re|are\s+you)\b[^?.!]{0,30}\b(?:version|capabilit|architecture|trained|knowledge\s+cutoff|able\s+to)\b|what\s+(?:can|do)\s+you\s+(?:do|support|handle)\b|did\s+(?:you|we)\s+(?:build|ship|add|implement|finish)\b)/i;
function isSelfStatus(message) {
  return SELF_STATUS_RE.test(message || "");
}

// Under-routing guard (backlog #12 / Build-40 follow-up). A narrow, high-precision
// set of checkable EXTERNAL-FACT question SHAPES that currently fall through
// every intent to NONE and get answered from training (the fabrication risk).
// These are the past/perfect-tense + who/role siblings of cases LIVE_DATA
// already routes (the future-tense "when is/does/will"): "when was X founded",
// "who founded/owns/acquired X", "who is the [current] CEO of X", "what year …".
// Evaluated LAST (right before the NONE fall-through) so it can only ever catch
// genuine fall-throughs — it never steals an existing route. The personal +
// self-status guards run first and still pre-empt; the temporal sub-pattern also
// carries a negative lookahead so "when did i/you/we/my/our …" stays conversational
// (never a clumsy web search of M8's own history). Corpus + rationale:
// tests/odysseus/under-routing-corpus.md. Exported for the mirror test.
const CHECKABLE_FACT_RE = new RegExp([
  // past/perfect temporal factual questions (future-tense already routes via LIVE_DATA)
  "\\bwhen (?:was|were|did|had|has)\\b(?!\\s+(?:i|you|we|my|our)\\b)",
  // year-of-event
  "\\b(?:what|which) year\\b",
  // who-did factual: real people / companies / orgs (no "did" → misses FACT_CHECK)
  "\\bwho (?:founded|owns|owned|acquired|bought|created|invented|developed|built|runs|leads|led|makes|made|designed|launched)\\b",
  // who-is-the-role-of: current officeholder / attribute lookup
  "\\bwho (?:is|was|are|were)\\s+(?:the\\s+)?(?:current\\s+)?(?:ceo|cfo|coo|cto|founder|co-?founder|owner|president|head|chief|director|minister|king|crown\\s+prince|prince|mayor|governor|author|inventor|creator|maker)\\b",
].join("|"), "i");
function isCheckableFact(message) {
  return CHECKABLE_FACT_RE.test(message || "");
}

function classifyIntent(message) {
  const m = message.toLowerCase();

  // ── PERSONAL GUARD (runs before everything) ────────────────────
  if (isPersonal(m)) return INTENT.NONE;

  // ── SELF-STATUS GUARD (Build-40) ───────────────────────────────
  // Questions about M8's own build/version/capabilities → answered from
  // build-state + memory, never web search. Must precede NEWS (which would
  // otherwise grab "recent"/"latest") and FACT_CHECK (which grabs "did you…").
  if (isSelfStatus(m)) return INTENT.NONE;

  // ── DOC (artifact generation: plans, briefs, decks, proposals) ──
  // EXPLICIT-REQUEST GUARD: for long messages (pasted briefs, team notes, context
  // dumps) only test the opening 200 chars — the user's actual command. A brief
  // that *mentions* "deck generator" or "presentation" as background context must
  // NOT trigger artifact generation; only a request that STARTS with an explicit
  // build/create/generate verb followed by an artifact noun should fire.
  const docCheckStr = m.length > 200 ? m.slice(0, 200) : m;
  const docPatterns = [
    /\b(make|create|write|draft|build|generate|prepare|put together|design|give me|i need)\b.{0,40}\b(plan|brief|summary|report|deck|slides?|presentation|proposal|outline|document|memo|meeting minutes|agenda|one[- ]?pager|action plan|checklist)\b/,
    /\b(slide deck|pitch deck|power ?point)\b/,
  ];
  if (docPatterns.some((p) => p.test(docCheckStr))) return INTENT.DOC;

  // ── FACT_CHECK ─────────────────────────────────────────────────
  // Binary yes/no questions about external events or current status
  const factPatterns = [
    /^(did |has |is it true|was |were |هل )/,
    // "Is the metro operational?" / "Is X available/open/working?"
    /^is (the |a |an |there ).{2,50}(operational|available|open|closed|working|live|active|running|fully|complete|finished|real|accurate)\b/,
    /did .*(launch|open|clos|merg|acqui|announc|releas)/,
    /هل (أطلق|أعلن|فتح|أغلق)/,
  ];
  if (factPatterns.some((p) => p.test(m))) return INTENT.FACT_CHECK;

  // ── NEWS ───────────────────────────────────────────────────────
  // Recency signals — user wants current events / recent updates
  const newsPatterns = [
    /\b(latest|recent|news|update|happened|breaking|جديد|آخر|أخبار|تحديث)\b/,
    /this (week|month|year)/,
    /هذا (الأسبوع|الشهر)/,
  ];
  if (newsPatterns.some((p) => p.test(m))) return INTENT.NEWS;

  // ── LIVE_DATA ──────────────────────────────────────────────────
  // Real-time transactional data — exact dates, prices, schedules, live rates.
  // Tavily searches, but Gemini must NOT extrapolate or invent missing specifics.
  const liveDataPatterns = [
    // Flights & travel booking (incl. natural phrasings — "travel/trip to X")
    /\bflights?\b/,
    /\bbook(ing)? (a )?(flight|ticket|seat)\b/,
    /\bfly(ing)? (from|to)\b/,
    /\b(travel|traveling|travelling|trip|getaway)\b/,
    /\b(travel|trip|getaway)\s+to\b/,
    /\b(depart|arrive|departure|arrival|layover|stopover)\b/,
    /\bairline(s)?\b/,

    // Stock & crypto prices
    /\b(stock price|share price|market cap|trading at|ticker)\b/,
    /\b(nasdaq|nyse|tadawul|stock market)\b/,
    /\bprice of (uber|apple|tesla|aramco|amazon|google|meta|microsoft)\b/,

    // Live currency & exchange rates
    /\b(exchange rate|currency rate|forex|usd to|sar to|egp to|convert .{1,15} to)\b/,
    /\b(سعر الصرف|صرف العملة)\b/,

    // Weather (time-sensitive)
    /\b(weather|temperature|forecast|humidity|rain|طقس|حرارة|درجة الحرارة)\b/,

    // Hotel availability
    /\b(hotel|accommodation|hostel|airbnb).{0,30}(book|available|price|cost|night)\b/,

    // Arabic travel / flights / hotels (no \b — JS word boundaries are ASCII-only)
    /سفر|أسافر|اسافر|طيران|تذكرة طيران|تذاكر|رحلة طيران|حجز (طيران|تذكرة|رحلة|فندق)|فندق|فنادق/,

    // Sports fixtures / live events / schedules (time-sensitive → MUST search, never answer stale)
    /\b(match|matches|fixture|fixtures|kick-?off|line-?up|scoreline|standings|results?)\b/,
    /\b(playing|plays|play)\s+(against|vs\.?|versus|with)\b/,
    /\b(vs\.?|versus)\b/,
    /\bwhat time\b/,
    /\bwhen (is|are|does|do|will|s)\b/,
    /\b(world cup|premier league|champions league|la ?liga|bundesliga|serie a|euros?|afcon|olympics|formula ?1|f1)\b/,
    /متى (يلعب|تلعب|المباراة|مباراة)|مباراة|الدوري|كأس العالم/,
  ];
  if (liveDataPatterns.some((p) => p.test(m))) return INTENT.LIVE_DATA;

  // ── LOOKUP ─────────────────────────────────────────────────────
  // User expects M8 to fetch a specific answer, not give generic advice.
  // General info — not time-sensitive or transactional.
  const lookupPatterns = [
    // Price & cost (general, non-live)
    /\b(price|cost|fee|fare|how much|كم سعر|سعر|تكلفة|بكام)\b/,
    /\b(cheap|cheapest|affordable|budget|أرخص|اقتصادي)\b/,

    // Routes (non-flight)
    /\bfrom .{2,30} to .{2,30}/,

    // Location services
    /\b(near(by)?|nearest|closest|around here|قريب|أقرب|بالقرب)\b/,
    /\bin (riyadh|jeddah|dammam|khobar|alexandria|cairo|mecca|medina|saudi|ksa|egypt)\b/,
    /\b(restaurant|school|hospital|clinic|pharmacy|gym|mall|salon|معلم|مدرسة|مطعم|مستشفى|صيدلية)\b/,

    // Explicit fetch intent & list/enumerate queries
    /\b(find me|show me|get me|give me options|أحضر|ابحث عن|أوجد)\b/,
    /\b(list|enumerate|name) (the |a )?(top|best|major|leading|main|biggest|largest)\b/,
    /\b(top|best|leading|major) \d+ \b/,
  ];
  if (lookupPatterns.some((p) => p.test(m))) return INTENT.LOOKUP;

  // ── RESEARCH ───────────────────────────────────────────────────
  // User wants explanation, summary, or background knowledge
  const researchPatterns = [
    /\b(summarize|summary|explain|what is|what are|how does|how do|tell me about|شرح|ملخص|ما هو|ما هي|كيف)\b/,
    /\b(book|article|study|research|report|paper|كتاب|تقرير|دراسة)\b/,
    /\b(history|background|overview|introduction|نبذة|مقدمة|تاريخ)\b/,
  ];
  if (researchPatterns.some((p) => p.test(m))) return INTENT.RESEARCH;

  // ── CHECKABLE EXTERNAL FACT (under-routing guard, backlog #12) ─
  // Last gate before NONE: high-precision checkable-fact shapes that slipped
  // every intent above (who founded/owns X, who is the CEO of X, when was X
  // founded, what year …). Grounded fetch, not time-sensitive → LOOKUP. Only
  // catches genuine fall-throughs; personal/self-status already pre-empted.
  if (isCheckableFact(m)) return INTENT.LOOKUP;

  // ── NONE (fallback) ────────────────────────────────────────────
  // Personal, conversational, or fleet-operational — memory handles it
  return INTENT.NONE;
}

// -- DRIVER_PROFILE (Build-100): chat-driven CRUD over driver_cost_profiles --
// A deterministic command parser, separate from classifyIntent's web-routing.
// The orchestrator calls this FIRST and, on a non-null result, answers the turn
// with a code-computed reply (no LLM). Returns null when the message is not a
// driver-profile command, so the caller falls through to normal routing.
//
//   { intent:'DRIVER_PROFILE', op:'upsert'|'list'|'delete', driverName, field, amount }
//
// Field labels map to DB columns; amount is a Number with SAR / commas stripped.
const DRIVER_FIELD_MAP = {
  rental: "rental_amount",
  salary: "salary_amount",
  fuel:   "fuel_estimate",
  other:  "other_costs",
};
// Apostrophe class covers both ASCII ' and the curly U+2019 phones often insert.
// Built via fromCharCode so this source file stays pure ASCII.
const APOS = "['" + String.fromCharCode(0x2019) + "]";

function parseDriverAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/sar/ig, "").replace(/,/g, "").replace(/[^\d.]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Strip a trailing possessive ('s) and surrounding quotes/punctuation from a name.
function cleanDriverName(s) {
  return String(s || "")
    .trim()
    .replace(new RegExp(APOS + "s$", "i"), "")
    .replace(/^["']+/, "")
    .replace(/["'?.!,]+$/g, "")
    .trim();
}

function classifyDriverProfile(message) {
  const raw = String(message || "").trim();
  if (!raw) return null;

  // 1) delete / remove driver <name>
  let m = raw.match(/\b(?:delete|remove)\s+driver\s+(.+)$/i);
  if (m) {
    const driverName = cleanDriverName(m[1]);
    if (driverName && !/^profiles?$/i.test(driverName)) {
      return { intent: INTENT.DRIVER_PROFILE, op: "delete", driverName, field: null, amount: null };
    }
  }

  // 2) set <name>'s <field> to <amount>   (possessive required: ' or curly U+2019)
  m = raw.match(new RegExp("\\bset\\s+(.+?)" + APOS + "s\\s+(rental|salary|fuel|other)\\b\\s+to\\s+([0-9][\\d,]*(?:\\.\\d+)?)", "i"));
  if (m) {
    const driverName = cleanDriverName(m[1]);
    const field = DRIVER_FIELD_MAP[m[2].toLowerCase()];
    if (driverName && field) {
      return { intent: INTENT.DRIVER_PROFILE, op: "upsert", driverName, field, amount: parseDriverAmount(m[3]) };
    }
  }

  // 3) update <name> <field> <amount>   (no possessive)
  m = raw.match(/\bupdate\s+(.+?)\s+(rental|salary|fuel|other)\b\s+(?:to\s+)?([0-9][\d,]*(?:\.\d+)?)/i);
  if (m) {
    const driverName = cleanDriverName(m[1]);
    const field = DRIVER_FIELD_MAP[m[2].toLowerCase()];
    if (driverName && field) {
      return { intent: INTENT.DRIVER_PROFILE, op: "upsert", driverName, field, amount: parseDriverAmount(m[3]) };
    }
  }

  // 4) show / list driver profiles  (or a bare "driver profiles")
  if (/\bdriver\s+profiles?\b/i.test(raw)) {
    return { intent: INTENT.DRIVER_PROFILE, op: "list", driverName: null, field: null, amount: null };
  }

  // 5) add driver <name>
  m = raw.match(/\badd\s+(?:a\s+|new\s+)*driver\s+(.+)$/i);
  if (m) {
    const driverName = cleanDriverName(m[1]);
    if (driverName && !/^profiles?$/i.test(driverName)) {
      return { intent: INTENT.DRIVER_PROFILE, op: "upsert", driverName, field: null, amount: null };
    }
  }

  return null;
}

module.exports = { classifyIntent, INTENT, isPersonal, isSelfStatus, SELF_STATUS_RE, isCheckableFact, CHECKABLE_FACT_RE, classifyDriverProfile };

// Re-export CONVERT detection so orchestrator can import from one place
const { detectConvertRequest } = require("./converter");
module.exports.detectConvertRequest = detectConvertRequest;
