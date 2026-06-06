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
  NONE:       "NONE",
  NEWS:       "NEWS",
  RESEARCH:   "RESEARCH",
  FACT_CHECK: "FACT_CHECK",
  LOOKUP:     "LOOKUP",
  LIVE_DATA:  "LIVE_DATA",
  DOC:        "DOC",
};

// Personal/possessive queries → memory (NOT web search, NOT the knowledge router).
const PERSONAL_PATTERNS = [
  /\bmy (fleet|drivers?|bikes?|team|schedule|earnings|salary|riders?|performance|data|stats|numbers)\b/,
  /\b(our|my) .{0,25}(this week|this month|today|last week|last month|yesterday)\b/,
];
function isPersonal(message) {
  return PERSONAL_PATTERNS.some((p) => p.test((message || "").toLowerCase()));
}

function classifyIntent(message) {
  const m = message.toLowerCase();

  // ── PERSONAL GUARD (runs before everything) ────────────────────
  if (isPersonal(m)) return INTENT.NONE;

  // ── DOC (artifact generation: plans, briefs, decks, proposals) ──
  const docPatterns = [
    /\b(make|create|write|draft|build|generate|prepare|put together|design|give me|i need)\b.{0,40}\b(plan|brief|summary|report|deck|slides?|presentation|proposal|outline|document|memo|minutes|agenda|one[- ]?pager|action plan|checklist)\b/,
    /\b(slide deck|pitch deck|power ?point)\b/,
  ];
  if (docPatterns.some((p) => p.test(m))) return INTENT.DOC;

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

  // ── NONE (fallback) ────────────────────────────────────────────
  // Personal, conversational, or fleet-operational — memory handles it
  return INTENT.NONE;
}

module.exports = { classifyIntent, INTENT, isPersonal };
