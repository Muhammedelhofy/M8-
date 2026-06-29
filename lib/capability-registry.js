"use strict";
/**
 * Build-155 — lib/capability-registry.js
 *
 * THE SINGLE SOURCE OF TRUTH for "which domain does a message belong to?"
 *
 * WHY THIS EXISTS (GPT's anti-drift point, council round 2026-06-25):
 *   M8's router was keyword whack-a-mole — every new ability meant another hand-placed
 *   guard scattered across orchestrator.js, and the wallet⇄fleet decision was duplicated
 *   ~14 times. Build-152 fixed the wallet⇄fleet seam with ONE arbiter. This file
 *   generalises that idea: every domain declares its OWN ownership vocabulary + coarse
 *   actions in ONE place, so adding an ability is a registry line, not a new parser.
 *
 * GROUNDED, NOT INVENTED:
 *   Signals are lifted from patterns already shipped + proven in prod — wallet from
 *   lib/domain-arbiter.js; fleet from looksFleet (fleet.js); finance from FINANCE_RE
 *   (finance.js); tasks/notes from capabilityFallback + parseNoteCapture (orchestrator.js);
 *   docs/web/memory from classifyIntent (intentClassifier.js); driver_profile from
 *   classifyDriverProfile (Build-100); knowledge = the RAG/ask-my-docs lane (Stream 2).
 *
 * THE 11 DOMAINS (match the live lanes + tests/routing_corpus.jsonl):
 *   driver_profile · wallet · finance · fleet · tasks · notes · knowledge · memory ·
 *   docs · web · chat.
 *   - wallet  = the OWNER's personal/household money (privacy wall lives here).
 *   - finance = the BUSINESS's P&L / revenue / margins (company-level).
 *   - fleet   = driver/captain operations (earnings, utilisation, the daily brief).
 *   - knowledge = retrieval over INGESTED content (books, the owner's CV/notes via RAG).
 *   - docs    = GENERATING an artifact (a deck/report/plan).
 *   - memory  = recall of stored personal facts / entity cards.
 *
 * COARSE ACTIONS ONLY (Gemini's anti-bloat rule): read/add/edit/delete/convert/recall/
 * search/generate. NOT 50 micro-intents — small free models drop params when the menu bloats.
 *
 * PURITY / PRIVACY: scoreMessage() is PURE over the message TEXT only — no DB, no LLM, no
 * money figures, no side effects — so it is trivially mirror-testable in PowerShell (Node
 * is absent on the host). The free-LLM tie-breaker lives in domain-arbiter.classifyAll().
 *
 * THIS FILE CHANGES NO BEHAVIOUR ON ITS OWN. Build-155 wires it in DORMANT (shadow-log only)
 * behind M8_REGISTRY_ROUTER; the per-boundary flips that ACT on it are Builds 156–158.
 */

const ACTIONS = ["read", "add", "edit", "delete", "convert", "recall", "search", "generate"];

// DOMAIN ORDER = deterministic tie-break priority (lower index wins a pure tie). Most-
// specific / owned domains first so an incidental shared word doesn't steal the turn:
//   driver_profile before fleet ("driver profile" > "driver")
//   knowledge/docs/notes before fleet  ("search my notes for FLEET strategy" → notes;
//                                        "write a report on the FLEET" → docs;
//                                        "REVENUE for the fleet" → finance)
// The wallet⇄fleet money-safety contest is resolved by a dedicated rule in classifyAll,
// NOT by this order.
const DOMAINS = ["driver_profile", "knowledge", "docs", "notes", "tasks", "wallet", "finance", "fleet", "memory", "web", "chat"];

// ── PER-DOMAIN OWNERSHIP SIGNALS (strong → score 2, present → score 1) ────────────
// Kept as standalone consts so the PowerShell mirror can copy them verbatim.

// WALLET — personal/household money. STRONG = unambiguously the owner's wallet (incl.
// payment-checks "did I pay the rent"). Wallet signals are lifted from domain-arbiter.js.
const WALLET_STRONG = /\bmy\s+(spend(?:ing)?|expenses?|wallet|budget|bills?|transactions?|money)\b|\b(?:did|do|does|how much did)\s+i\s+(?:spend|spent|pay|paid)\b|\bi\s+(?:spent|paid)\b|\bmy\s+(?:last|recent|latest)\s+(?:expenses?|transactions?|purchases?)\b|\b(?:did|have|has)\s+\w+\s+pa(?:y|id)\b|\b(?:paid|pay)\s+(?:the\s+|for\s+|my\s+|our\s+)?(?:rent|electricity|water|internet|bills?|fees?|school\s+fees?|tuition|subscription|installment)\b|مصروفي|مصاريفي|محفظتي|صرفت\s+أنا|مصروفاتي/i;
const WALLET_PRESENT = /\b(expenses?|wallet|spending|budget|bills?)\b|\bspent\b|\bspend\b(?!\s+(?:time|the\s+night|the\s+day|the\s+weekend))|محفظة|مصروف|مصاريف|ميزانيتي|فاتورة|فواتير/i;

// DRIVER_PROFILE — Build-100 driver-cost CRUD. STRONG so it wins over plain "driver"→fleet.
const DRIVER_PROFILE_STRONG = /\bdriver\s+profiles?\b|\b(?:set|update)\s+\w+(?:'s)?\s+(?:rental|salary|fuel)\b/i;

// FINANCE — the BUSINESS P&L (FINANCE_RE scope + revenue/operating-cost, which the corpus
// labels finance). Ordered before fleet so "revenue breakdown for the fleet" → finance.
const FINANCE_STRONG = /\bp\s*&\s*l\b|\bpnl\b|\bprofit\w*\b|\b(?:net\s+|gross\s+)?margin\b|\brevenue\b|\boperating\s+(?:costs?|expenses?)\b|\bunit\s+economics\b|\bbreak[\s-]?even\b|\bbottom\s+line\b|\bcost\s+per\s+order\b|\bfinancial\s+(?:situation|health|analysis)\b/i;

// FLEET — driver/captain operations (looksFleet's scope). P&L/pnl moved to FINANCE.
const FLEET_STRONG = /\b(drivers?|captains?|couriers?|fleet|riders?)\b|سائق|سواق|كباتن|كبتن|أسطول|اسطول|سائقين|مندوب|مناديب/i;
const FLEET_PRESENT = /\b(bikes?|motorbikes?|utili[sz]ation|acceptance\s+rate|payroll|earnings|tier|bonus|cash\s+collection|morning\s+brief|daily\s+brief|fleet\s+brief|active\s+drivers?|[56]k\s+target)\b|عمولة|تحصيل/i;

// TASKS — _CAP_TASK_RE + "remind me" + "my list".
const TASK_PRESENT = /\b(tasks?|reminders?|to-?dos?)\b|\bremind\s+me\b|\b(?:on\s+)?my\s+(?:to-?do\s+)?list\b|مهمة|مهام|تذكير|ذكّرني|ذكرني/i;

// NOTES — the personal note store. STRONG = explicit capture/recall verbs (so "search my
// notes for FLEET strategy" stays notes). present from parseNoteCapture's vocabulary.
const NOTE_STRONG = /\b(?:search|check|find\s+in|look\s+in)\s+my\s+notes?\b|^\s*note\s*:|\b(?:take|make|add|leave|write|jot)\s+(?:a\s+|this\s+)?note\b|\bjot\s+(?:this\s+)?down\b/i;
const NOTE_PRESENT = /\bnotes?\b|\bnote\s+(?:that|down|about)\b|\b(?:fyi|for\s+the\s+record)\b|\bremember\s+that\b|ملاحظة|ملاحظات|دوّن|دون/i;

// KNOWLEDGE — RAG retrieval over INGESTED content (books + the owner's CV/notes, Stream 2).
// Distinct from docs (artifact generation) and notes (the quick-note store).
const KNOWLEDGE_STRONG = /\bsearch\s+my\s+(?:books?|docs?|documents?|sources?|cv|resume|knowledge)\b|\bwhat\s+(?:does|do|did)\s+[\w\s]{1,30}?\s+say\s+about\b|\baccording\s+to\s+(?:my\s+)?(?:books?|sources?|cv)\b|\bin\s+my\s+(?:cv|resume|books?|documents?)\b|\bmy\s+cv\b/i;

// MEMORY — recall of stored personal facts / entity cards / identity teaching.
const MEMORY_PRESENT = /\b(?:who\s+(?:is|was|are)|tell\s+me\s+about|what\s+do\s+(?:you|we)\s+know\s+about|do\s+you\s+(?:remember|recall)|what\s+did\s+i\s+(?:say|tell\s+you)\s+about|remind\s+me\s+(?:who|what|about))\b|\bmy\s+(?:wife|husband|brother|sister|son|daughter|mother|father|friend|colleague|boss)\b|من\s+هو|من\s+هي|وش\s+تعرف\s+عن|تذكر\s+مين|زوجتي|زوجي|أخي|اخي|أختي|اختي/i;

// DOCS — GENERATING an artifact (classifyIntent DOC). STRONG (verb+artifact) so "write me a
// report on the fleet" → docs, while "daily fleet report" (no generate verb) stays fleet.
const DOCS_STRONG = /\b(make|create|write|draft|build|generate|prepare|design|put\s+together|give\s+me|i\s+need)\b.{0,40}\b(plan|brief|summary|report|deck|slides?|presentation|proposal|outline|document|memo|agenda|one[-\s]?pager|action\s+plan|checklist)\b|\b(slide\s+deck|pitch\s+deck|power\s?point)\b/i;

// WEB — external fetch (classifyIntent LIVE_DATA/LOOKUP/NEWS + checkable-fact).
const WEB_PRESENT = /\b(weather|temperature|forecast|humidity)\b|\b(scores?|who\s+won|match(?:es)?|fixtures?|standings)\b|\b(exchange\s+rate|stock\s+price|share\s+price|price\s+of)\b|\b(flights?|hotels?|airbnb)\b|\b(latest|recent|breaking)\s+(?:news|updates?)\b|\bnews\b|\b(near(?:by|est)?|closest)\b|\bwho\s+(?:founded|owns|invented|acquired)\b|طقس|حرارة|نتيجة|من\s+فاز|سعر\s+الصرف|طيران|فندق|أخبار/i;

const REGISTRY = {
  driver_profile: { actions: ["add", "edit", "delete", "read"], strong: DRIVER_PROFILE_STRONG },
  knowledge:      { actions: ["search", "recall"],              strong: KNOWLEDGE_STRONG },
  docs:           { actions: ["generate"],                      strong: DOCS_STRONG },
  notes:          { actions: ["add", "search", "read"],         strong: NOTE_STRONG, present: NOTE_PRESENT },
  tasks:          { actions: ["add", "edit", "delete", "read"], present: TASK_PRESENT },
  wallet:         { actions: ["read", "add", "edit", "convert"], strong: WALLET_STRONG, present: WALLET_PRESENT },
  finance:        { actions: ["read"],                          strong: FINANCE_STRONG },
  fleet:          { actions: ["read", "generate"],              strong: FLEET_STRONG, present: FLEET_PRESENT },
  memory:         { actions: ["recall", "add"],                 present: MEMORY_PRESENT },
  web:            { actions: ["search"],                        present: WEB_PRESENT },
  chat:           { actions: ["read"] }, // no positive signal — the no-domain fallback
};

// ── PURE SCORER ───────────────────────────────────────────────────────────────
// Score every domain from the message TEXT alone. strong→2, present→1, none→0.
function scoreMessage(message) {
  const s = String(message || "");
  const scores = {};
  for (const d of DOMAINS) {
    const def = REGISTRY[d];
    if (!def) { scores[d] = 0; continue; }
    if (def.strong && def.strong.test(s)) scores[d] = 2;
    else if (def.present && def.present.test(s)) scores[d] = 1;
    else scores[d] = 0;
  }
  return scores;
}

// ── DETERMINISTIC PICK ────────────────────────────────────────────────────────
// Choose the domain from a score map. A genuine tie between two scoring domains →
// ambiguous. All-zero → chat. DOMAINS order breaks pure ties (matches lane priority).
function pickDomain(scores) {
  let best = "chat", bestScore = 0, second = null, secondScore = 0;
  for (const d of DOMAINS) {
    const v = scores[d] || 0;
    if (v > bestScore) { second = best; secondScore = bestScore; best = d; bestScore = v; }
    else if (v > secondScore && d !== best) { second = d; secondScore = v; }
  }
  if (bestScore === 0) return { domain: "chat", confidence: 0.5, ambiguous: false, runnerUp: null, top: 0 };
  const ambiguous = secondScore === bestScore && second && second !== best;
  const confidence = ambiguous ? 0.5 : (bestScore >= 2 ? 0.9 : 0.7);
  return { domain: best, confidence, ambiguous: !!ambiguous, runnerUp: ambiguous ? second : null, top: bestScore };
}

module.exports = {
  REGISTRY,
  DOMAINS,
  ACTIONS,
  scoreMessage,
  pickDomain,
  // exported individually so the PowerShell mirror + tests can assert each signal:
  WALLET_STRONG, WALLET_PRESENT, DRIVER_PROFILE_STRONG, FINANCE_STRONG,
  FLEET_STRONG, FLEET_PRESENT, TASK_PRESENT, NOTE_STRONG, NOTE_PRESENT,
  KNOWLEDGE_STRONG, MEMORY_PRESENT, DOCS_STRONG, WEB_PRESENT,
};
