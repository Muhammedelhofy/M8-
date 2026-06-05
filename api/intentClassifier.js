/**
 * M8 Intent Classifier — api/intentClassifier.js
 *
 * Classifies a user message into one of five routing categories.
 * Priority order matters — first match wins.
 *
 * FACT_CHECK → NEWS → LOOKUP → RESEARCH → NONE
 *
 * FACT_CHECK  Binary yes/no about an external event
 * NEWS        Recency signals — user wants what's happening now
 * LOOKUP      User expects M8 to FETCH a specific answer (flights, prices,
 *             locations, services) — not explain HOW to find it
 * RESEARCH    User wants an explanation, summary, or background
 * NONE        Personal/operational/conversational — answered from memory
 */

const INTENT = {
  NONE:       "NONE",
  NEWS:       "NEWS",
  RESEARCH:   "RESEARCH",
  FACT_CHECK: "FACT_CHECK",
  LOOKUP:     "LOOKUP",
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

  // ── LOOKUP ─────────────────────────────────────────────────────
  // User expects M8 to fetch a specific answer, not give generic advice.
  // "Find me flights" not "here's how to find flights."
  const lookupPatterns = [
    // Travel & routes
    /\bflights?\b/,
    /\bhotel(s|ing)?\b/,
    /\bfrom .{2,30} to .{2,30}/,

    // Price & cost
    /\b(price|cost|rate|fee|fare|how much|كم سعر|سعر|تكلفة|بكام)\b/,
    /\b(cheap|cheapest|affordable|budget|أرخص|اقتصادي)\b/,

    // Location services
    /\b(near(by)?|nearest|closest|around here|قريب|أقرب|بالقرب)\b/,
    /\bin (riyadh|jeddah|dammam|khobar|alexandria|cairo|mecca|medina|saudi|ksa|egypt)\b/,
    /\b(restaurant|school|hospital|clinic|pharmacy|gym|mall|salon|معلم|مدرسة|مطعم|مستشفى|صيدلية)\b/,

    // Weather
    /\b(weather|temperature|forecast|humidity|طقس|حرارة|درجة الحرارة)\b/,

    // Currency & finance
    /\b(exchange rate|currency rate|convert .{1,10} to|صرف|سعر الصرف)\b/,

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
