/**
 * M8 Specificity Gate — api/slots.js
 *
 * Deterministic, ZERO-LLM clarification. A query can be "searchable" yet not
 * "answerable" — "cheap flights" has a clear intent but no destination/date, so
 * searching it returns garbage. This module decides, with pure heuristics:
 *   - is a slot-requiring topic present?  (flights, hotels, weather, stocks, restaurants)
 *   - are its required slots filled?      (date via regex; entity via residual tokens)
 * If not → return a 1–2 question clarification instead of searching.
 *
 * It also rewrites queries with profile context before search (origin, year)
 * so well-specified queries return relevant results.
 *
 * Slot detection is by TOKEN PRESENCE, not meaning-parsing — so it works across
 * English + Arabic without a gazetteer. We don't need to know the city is Cairo;
 * we only need to know the user named *something* specific.
 */

const USER_HOME = "Riyadh";

// Words stripped before checking whether the user named anything specific.
const FILLER = new Set([
  // English
  "the","a","an","to","from","in","on","at","for","of","me","my","i","want",
  "need","needed","looking","look","find","get","show","give","please","cheap",
  "cheapest","best","good","affordable","budget","some","any","options","option",
  "search","near","nearby","nearest","closest","around","here","is","are","what",
  "whats","price","prices","cost","how","much","book","booking","can","you","help",
  "there","with","and","or","want","wanna","like","would","could","do","does",
  // Arabic fillers
  "عايز","عاوز","اريد","أريد","ابحث","أبحث","عن","لي","في","من","الى","إلى",
  "ارخص","أرخص","افضل","أفضل","سعر","كم","ممكن","محتاج","رخيص","حجز",
]);

// Date / time signals — presence means the "date" slot is filled.
const DATE_RE = new RegExp(
  [
    "today","tonight","tomorrow","yesterday","this (week|weekend|month|year)",
    "next (week|weekend|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
    "weekend","jan(uary)?","feb(ruary)?","mar(ch)?","apr(il)?","may","jun(e)?",
    "jul(y)?","aug(ust)?","sep(tember)?","oct(ober)?","nov(ember)?","dec(ember)?",
    "\\d{1,2}\\s*(st|nd|rd|th)?\\s*(of\\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)",
    "\\d{1,2}[\\/\\-]\\d{1,2}","in \\d+ (days?|weeks?|months?)","\\b20\\d{2}\\b",
    // Arabic
    "غدا","بكرة","اليوم","الليلة","الأسبوع (القادم|الجاي|المقبل)",
    "الشهر (القادم|المقبل)","نهاية الأسبوع","بعد (غد|أسبوع|يومين)",
  ].join("|"),
  "i"
);

// Topics that genuinely fail without parameters. Keep this list SMALL.
const TOPICS = [
  {
    topic: "flights",
    trigger: /\b(flight|flights|fly|flying|airfare|airfares|airline|airlines)\b|سفر|أسافر|اسافر|طيران|تذكرة|تذاكر/i,
    needs: ["destination", "date"],
  },
  {
    topic: "hotels",
    trigger: /\b(hotel|hotels|accommodation|hostel|airbnb|resort)\b|فندق|فنادق|إقامة/i,
    needs: ["location", "date"],
  },
  {
    topic: "restaurants",
    trigger: /\b(restaurant|restaurants|dining|cafe|eatery)\b|مطعم|مطاعم|كافيه/i,
    needs: ["location"],
  },
  {
    topic: "weather",
    trigger: /\b(weather|forecast|temperature)\b|طقس|الطقس|الجو/i,
    needs: ["location"],
  },
  {
    topic: "stocks",
    trigger: /\b(stock price|share price|stock|shares|ticker)\b|سهم|أسهم/i,
    needs: ["entity"],
  },
];

function isArabic(text) { return /[؀-ۿ]/.test(text || ""); }

function hasDate(text) { return DATE_RE.test(text); }

// Residual content tokens after removing the topic trigger, dates, and filler.
// A non-empty result means the user named something specific (a place, company…).
function residual(text, trigger) {
  return text.toLowerCase()
    .replace(trigger, " ")
    .replace(DATE_RE, " ")
    .replace(/[^\w\s؀-ۿ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));
}

function hasEntity(text, trigger) { return residual(text, trigger).length > 0; }

// Build a 1–2 question clarification tailored to what's actually missing.
function buildQuestion(topic, missing, ar) {
  const Q = {
    flights: {
      both:        ar ? "تمام — إلى أين تريد السفر، وفي أي تاريخ؟" : "Sure — where would you like to fly to, and on what dates?",
      destination: ar ? "إلى أين تريد السفر؟"                      : "Where would you like to fly to?",
      date:        ar ? "وفي أي تاريخ تريد السفر؟"                 : "And on what dates would you like to travel?",
    },
    hotels: {
      both:        ar ? "في أي مدينة، وما هي تواريخ الإقامة؟" : "Which city, and what dates?",
      location:    ar ? "في أي مدينة تريد الإقامة؟"          : "Which city should I look in?",
      date:        ar ? "وما هي تواريخ الإقامة؟"             : "And what dates?",
    },
    restaurants: { location: ar ? "في أي مدينة أو منطقة تريد أن أبحث؟" : "Which city or area should I look in?" },
    weather:     { location: ar ? "لأي مدينة؟"                        : "For which city?" },
    stocks:      { entity:   ar ? "أي شركة أو رمز سهم؟"               : "Which company or ticker?" },
  };
  const t = Q[topic] || {};
  if (missing.length >= 2 && t.both) return t.both;
  return t[missing[0]] || (ar ? "هل يمكنك إعطائي تفاصيل أكثر؟" : "Could you give me a bit more detail?");
}

/**
 * @returns {{ specific: boolean, topic: string|null, question?: string }}
 *   specific=true with topic=null → not a slot-requiring query (proceed as normal)
 *   specific=false → ask `question` instead of searching
 */
function checkSpecificity(message) {
  for (const t of TOPICS) {
    if (!t.trigger.test(message)) continue;
    const missing = [];
    for (const need of t.needs) {
      if (need === "date") { if (!hasDate(message)) missing.push("date"); }
      else if (!hasEntity(message, t.trigger)) missing.push(need);
    }
    if (missing.length > 0) {
      return { specific: false, topic: t.topic, question: buildQuestion(t.topic, missing, isArabic(message)) };
    }
    return { specific: true, topic: t.topic };
  }
  return { specific: true, topic: null };
}

// Enrich a well-specified query with profile context before searching.
function rewriteQuery(message, topic) {
  const year = new Date().getFullYear();
  if (topic === "flights") {
    const origin = /\bfrom\b|من /i.test(message) ? "" : ` from ${USER_HOME}`;
    return `${message}${origin} ${year} flight ticket price`;
  }
  if (topic === "hotels") return `${message} hotel price per night ${year}`;
  return message;
}

module.exports = { checkSpecificity, rewriteQuery, isArabic };
