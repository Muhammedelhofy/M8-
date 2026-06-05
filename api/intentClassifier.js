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
};

function classifyIntent(message) {
  const m = message.toLowerCase();

  // ── FACT_CHECK ─────────────────────────────────────────────────
  // Binary yes/no questions about external events
  const factPatterns = [
    /^(did |has |is it true|was |were |هل )/,
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
    // Flights & travel booking
    /\bflights?\b/,
    /\bbook(ing)? (a )?(flight|ticket|seat)\b/,
    /\bfly(ing)? from\b/,
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

    // Explicit fetch intent
    /\b(find me|show me|get me|give me options|list .{1,20} options|أحضر|ابحث عن|أوجد)\b/,
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

module.exports = { classifyIntent, INTENT };
