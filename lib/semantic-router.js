"use strict";
/**
 * Build-164 — lib/semantic-router.js
 *
 * SEMANTIC (meaning-based) domain scorer. SHADOW ONLY in B-164: it MEASURES which
 * domain a turn would map to by MEANING, never by keywords — but it changes NO
 * routing decision. The orchestrator logs what this WOULD pick (lane=sem:*)
 * alongside the real route so we can see how often meaning would fix a keyword
 * miss BEFORE letting it act (that flip is B-165). Same dormant-shadow contract
 * as Build-155's reg:* registry layer.
 *
 * WHY THIS EXISTS:
 *   The deterministic registry/arbiter (capability-registry.js + domain-arbiter.js)
 *   is still pattern-matching — novel phrasings ("tell me about my kafala operation")
 *   mis-route because no regex anticipated them. Embeddings map a turn to a point in
 *   meaning-space, so "tell me about my kafala operation" lands near the knowledge
 *   exemplars even though it shares no keyword with them. This is the real
 *   "understand what I mean" leap, and it is FREE: M8 already embeds for the
 *   knowledge graph (the same gemini-embedding-001 searchKnowledgeGraph uses).
 *
 * HOW IT WORKS:
 *   - EXEMPLARS: a small curated map of domain -> a handful of example phrasings.
 *   - embedExemplars(): embed each exemplar ONCE (RETRIEVAL_DOCUMENT) and cache the
 *     vectors in-module (warm-instance). Lazy + idempotent.
 *   - scoreSemantic(message): embed the message (RETRIEVAL_QUERY), cosine-compare to
 *     every exemplar, take each domain's best match, return the top domain + margin.
 *
 * PRIVACY: only the message TEXT is ever embedded — never any money figure (the
 *   wallet privacy wall is upstream; this module never sees DB rows or amounts).
 *
 * FAIL-SAFE: every public function swallows its own errors and returns null. A
 *   missing GEMINI key, a timeout, a malformed response — none can ever throw into
 *   the turn. With no key, embedText returns null ⇒ the cache is empty ⇒
 *   scoreSemantic returns null ⇒ the shadow logs nothing and the turn is untouched.
 *
 * THIS FILE CHANGES NO BEHAVIOUR ON ITS OWN. The orchestrator wires it in DORMANT
 * (shadow-log only) behind M8_SEMANTIC_ROUTER; nothing reads its result into a route.
 */

const { embedText } = require("./memory-graph");

// ── EXEMPLARS ───────────────────────────────────────────────────────────────
// domain -> example phrasings, written the way a USER actually asks (meaning, not
// keywords). Must cover every live domain in capability-registry.js DOMAINS:
//   driver_profile · knowledge · docs · notes · tasks · wallet · finance · fleet ·
//   memory · web · chat.
// `knowledge` is seeded with the KNOWN keyword-router misses; fleet/wallet/finance
// echo the real detectors in natural prose. A few Arabic phrasings are included for
// the domains he uses bilingually (wallet/fleet/memory) — the embedding model is
// multilingual, so Arabic queries land near them too.
const EXEMPLARS = {
  driver_profile: [
    "set Ahmed's monthly rental to 1800",
    "update the fuel cost for driver Khalid",
    "change Mohammed's salary in his driver profile",
    "add a new driver profile for the new guy",
    "what rental am I charging this captain",
    "edit the driver's cost details",
    "remove the driver profile for Omar",
  ],
  knowledge: [
    "tell me about my kafala operation",
    "what does my CV say about my logistics experience",
    "search my books for what they say about leadership",
    "according to my documents, what is my notice period",
    "look in my resume for my education history",
    "summarise what my ingested sources say about pricing",
    "find in my knowledge base the part about fleet strategy",
    "what do my uploaded books say about the new world order",
  ],
  docs: [
    "write me a one-page report on the fleet performance",
    "create a slide deck for the investor pitch",
    "draft a proposal for the new rental plan",
    "put together an action plan for next quarter",
    "generate a summary memo of this month",
    "build me a checklist for onboarding drivers",
    "prepare an agenda for tomorrow's meeting",
  ],
  notes: [
    "take a note that the landlord called today",
    "jot this down: renew the iqama in March",
    "note: Khalid prefers the morning shift",
    "search my notes for what I saved about insurance",
    "leave a quick note about the car service date",
    "for the record, the deposit was returned",
    "write down that the bonus tier resets monthly",
  ],
  tasks: [
    "remind me to pay the rent on Sunday",
    "add a task to call the accountant",
    "what's on my to-do list today",
    "mark the visa renewal as done",
    "show me my pending reminders",
    "delete the task about the car wash",
    "set a reminder for the school fees",
  ],
  wallet: [
    "how much did I spend this month",
    "what was my last expense",
    "did I pay the electricity bill",
    "show my household budget",
    "what are my recent transactions",
    "how much money is left in my wallet",
    "كم صرفت هذا الشهر",
    "هل دفعت فاتورة الكهرباء",
  ],
  finance: [
    "what's the company profit this month",
    "show me the revenue breakdown",
    "what are our operating costs",
    "how is our profit margin trending",
    "what's the unit economics per order",
    "are we above break-even yet",
    "give me the business P&L",
  ],
  fleet: [
    "how are my drivers doing today",
    "show the daily fleet brief",
    "which captains hit the bonus tier",
    "what's the fleet utilisation this week",
    "how many active drivers do we have",
    "driver earnings and cash collection",
    "كم سائق نشط اليوم",
    "مين الكباتن اللي وصلوا التارجت",
  ],
  memory: [
    "who is my wife Sara",
    "what do you know about my brother",
    "do you remember what I told you about my boss",
    "tell me about my colleague Ahmed",
    "what did I say about my landlord",
    "remind me who handles my insurance",
    "من هو أخي",
  ],
  web: [
    "what's the weather in Riyadh today",
    "who won the match last night",
    "what's the SAR to EGP exchange rate",
    "latest news about Bolt",
    "find me the nearest petrol station",
    "what's the price of gold right now",
    "who founded this company",
  ],
  chat: [
    "good morning, how are you",
    "thanks, that was really helpful",
    "can you explain how this works",
    "tell me a joke",
    "what can you do for me",
    "I'm feeling a bit tired today",
    "let's just chat for a minute",
  ],
};

// ── COSINE ──────────────────────────────────────────────────────────────────
// Cosine similarity of two equal-length numeric vectors. embedText already returns
// L2-normalised vectors (so this equals their dot product), but we divide by the
// norms anyway so the function is correct for ANY input and unit-testable on its
// own. Fail-safe: malformed / mismatched / zero-vector input -> 0 (never throws).
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]), y = Number(b[i]);
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb || !isFinite(na) || !isFinite(nb)) return 0;
  const d = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return isFinite(d) ? d : 0;
}

// ── EXEMPLAR CACHE (warm-instance, lazy, idempotent) ──────────────────────────
let _exemplarCache = null;   // { domain: number[][] } once warmed
let _warmInFlight = null;    // shared promise so concurrent callers warm ONCE

/**
 * Embed every exemplar ONCE and cache the vectors in-module. Subsequent calls reuse
 * the warm cache. Concurrent callers share a single in-flight warm-up. The cache is
 * committed only when at least one vector came back, so a no-key/offline run leaves
 * it empty and a later call (e.g. once the key is present) can retry. Never throws.
 * @returns {Promise<Object|null>} domain -> vectors, or null if nothing embedded.
 */
async function embedExemplars() {
  if (_exemplarCache) return _exemplarCache;
  if (_warmInFlight) return _warmInFlight;
  _warmInFlight = (async () => {
    const cache = {};
    for (const domain of Object.keys(EXEMPLARS)) {
      // Embed a domain's exemplars in parallel (bounded ~8 concurrent) so a cold
      // warm-up is ~seconds, not ~minute; dropped (null) embeds are filtered out.
      const vecs = (await Promise.all(
        EXEMPLARS[domain].map((t) => embedText(t, "RETRIEVAL_DOCUMENT"))
      )).filter(Boolean);
      if (vecs.length) cache[domain] = vecs;
    }
    return Object.keys(cache).length ? cache : null;
  })();
  try {
    const result = await _warmInFlight;
    if (result) _exemplarCache = result;
    return result;
  } catch (_) {
    return null;
  } finally {
    _warmInFlight = null;
  }
}

/**
 * Score a message by MEANING against the exemplar map.
 * @param {string} message  the raw user turn (text only)
 * @returns {Promise<{domain,confidence,runnerUp,margin}|null>}
 *   domain     = best-matching domain
 *   confidence = top cosine similarity (its best exemplar)
 *   runnerUp   = second-best domain (or null)
 *   margin     = top - runnerUp (how decisive the win is)
 *   null on ANY error / empty input / no embeddings available.
 */
async function scoreSemantic(message) {
  try {
    const msg = String(message || "").trim();
    if (msg.length < 2) return null;
    const cache = await embedExemplars();
    if (!cache) return null;
    const qv = await embedText(msg, "RETRIEVAL_QUERY");
    if (!qv) return null;

    const ranked = [];
    for (const domain of Object.keys(cache)) {
      let best = -Infinity;
      for (const vec of cache[domain]) {
        const c = cosine(qv, vec);
        if (c > best) best = c;
      }
      if (best > -Infinity) ranked.push({ domain, score: best });
    }
    if (!ranked.length) return null;
    ranked.sort((a, b) => b.score - a.score);

    const top = ranked[0];
    const runner = ranked[1] || null;
    return {
      domain: top.domain,
      confidence: top.score,
      runnerUp: runner ? runner.domain : null,
      margin: runner ? (top.score - runner.score) : top.score,
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  EXEMPLARS,
  cosine,
  embedExemplars,
  scoreSemantic,
};
