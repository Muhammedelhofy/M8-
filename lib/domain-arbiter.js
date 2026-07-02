"use strict";
/**
 * Build-152 — lib/domain-arbiter.js  (the "front door" wallet⇄fleet traffic cop)
 *
 * THE PROBLEM IT FIXES
 *   M8 used to send personal-wallet questions to the FLEET engine. Root cause
 *   (orchestrator.js): the fleet detector `looksFleet()` is greedy, the wallet
 *   lanes each self-guard with `!looksFleet(m)`, and the money "intent brain" was
 *   gated behind `!looksFleet(m)` — so when the greedy fleet matcher fired, it both
 *   STOLE the turn AND DISABLED the layer meant to catch the mistake. Every new
 *   wallet ability meant another hand-placed guard. Whack-a-mole.
 *
 * WHAT THIS DOES
 *   One shared decision, made ONCE per turn, for the wallet⇄fleet boundary only:
 *     • wallet  — personal-money signal present, no fleet signal  → protect it
 *     • fleet   — fleet signal present, no personal-money signal   → let fleet run
 *     • ask     — genuinely contested → return a clarifier, don't guess
 *     • neutral — not our boundary (tasks/notes/chat/etc.)         → DO NOTHING
 *   "neutral" / disabled ⇒ the caller behaves EXACTLY as before (it falls back to
 *   the old `looksFleet(m)` guards). That keeps the ~168 working paths untouched.
 *
 * DIVISION OF LABOUR (matches the existing intent-router contract)
 *   The model — when it's consulted at all — picks the DOMAIN only (wallet vs
 *   fleet). It never sees or returns money figures; amounts are MASKED to "#"
 *   before the call. Deterministic code does all the real work and all the maths.
 *
 * WHEN THE LLM IS CONSULTED
 *   Only on a genuine CONTEST (both a wallet AND a fleet signal in one message) —
 *   a small minority of turns. A clear single-signal turn is decided by regex with
 *   NO model call (free + instant). No signal at all → neutral, no model call.
 *
 * KILL SWITCHES
 *   M8_DOMAIN_ARBITER_DISABLED=1 → arbitrate() always returns {domain:"neutral"}
 *                                  (old behaviour everywhere).
 *   M8_ARBITER_LLM_DISABLED=1    → skip the model leg; a contest resolves to "ask".
 */

const { generate } = require("./llm");
const _registry = require("./capability-registry"); // Build-155 — all-domain scoring

const CLARIFY_SENTINEL = "⁣⁣ARB⁣⁣"; // invisible marker on a clarifier reply

const ARB_PROVIDER_ORDER =
  process.env.M8_INTENT_PROVIDER_ORDER || "groq,cerebras,gemini,gemini2,mistral,openrouter";
const ARB_TIMEOUT_MS = parseInt(process.env.M8_ARBITER_TIMEOUT_MS || "5000", 10);
const ARB_MAX_LEN = 200; // long pastes aren't wallet/fleet commands

// ── PERSONAL-MONEY (WALLET) SIGNALS ───────────────────────────────────────────
// STRONG = unambiguously the user's own wallet ("my spend", "I paid", "my bills").
// A strong wallet signal WINS a contest even if a fleet word is also present.
const _WALLET_STRONG_EN = /\bmy\s+(spend(?:ing)?|expenses?|wallet|budget|bills?|transactions?)\b|\b(?:did|do|does|how much did)\s+i\s+(?:spend|spent|pay|paid)\b|\bi\s+(?:spent|paid)\b|\bmy\s+(?:last|recent|latest)\s+(?:expense|transaction|purchase)\b/i;
const _WALLET_STRONG_AR = /مصروفي|مصاريفي|محفظتي|صرفت\s+أنا|مصروفاتي/;
// PRESENT = a wallet/expense word, weaker (could be chat). Used for the "one side
// only" decision and to detect a contest.
const _WALLET_PRESENT_EN = /\b(expenses?|wallet|spending|budget|bills?)\b|\bspent\b|\bspend\b(?!\s+(?:time|the\s+night|the\s+day))/i;
const _WALLET_PRESENT_AR = /محفظة|مصروف|مصاريف|ميزانيتي|فاتورة|فواتير/;

function walletSignal(message) {
  const s = String(message || "");
  const strong = _WALLET_STRONG_EN.test(s) || _WALLET_STRONG_AR.test(s);
  const present = strong || _WALLET_PRESENT_EN.test(s) || _WALLET_PRESENT_AR.test(s);
  return { present, strong };
}

// ── LLM LEG (contest tie-breaker, DOMAIN only, amounts masked) ────────────────
function _buildPrompt() {
  return [
    "You decide which part of a personal assistant a message is for. Output ONLY JSON",
    "— no prose, no markdown, no code fences.",
    "",
    'Schema: {"domain": "wallet" | "fleet" | "other", "confidence": number}',
    "",
    "Definitions:",
    '- "wallet": the user\'s OWN personal/household money — what THEY or a family member',
    "  spent/paid/owe, their expenses, budget, bills, personal transactions.",
    '- "fleet": their DELIVERY BUSINESS — drivers/captains/couriers, fleet earnings,',
    "  utilisation, acceptance, the daily fleet brief, driver P&L, cash collection.",
    '- "other": neither of the above.',
    "",
    "Amounts may appear masked as '#'. Decide ONLY the domain.",
    "",
    "Examples:",
    '"breakdown of my spend in june" => {"domain":"wallet","confidence":0.95}',
    '"how are my drivers doing" => {"domain":"fleet","confidence":0.96}',
    '"what did sara spend" => {"domain":"wallet","confidence":0.9}',
    '"net earnings yesterday" => {"domain":"fleet","confidence":0.9}',
    '"what is the breakdown" => {"domain":"other","confidence":0.5}',
  ].join("\n");
}

function _extractJson(text) {
  if (typeof text !== "string") return null;
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

async function classifyDomain(message) {
  if (process.env.M8_ARBITER_LLM_DISABLED === "1") return null;
  const text = String(message || "").trim();
  if (!text || text.length > ARB_MAX_LEN) return null;
  const masked = text.replace(/\d[\d.,]*/g, "#"); // privacy: the figure never leaves
  let raw;
  try {
    const call = generate({
      systemInstruction: _buildPrompt(),
      contents: [{ role: "user", parts: [{ text: masked }] }],
      providerOrder: ARB_PROVIDER_ORDER,
      genConfig: {
        temperature: 0, maxOutputTokens: 60, thinkingBudget: 0,
        responseFormat: { type: "json_object" }, responseMimeType: "application/json",
      },
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("arb timeout")), ARB_TIMEOUT_MS));
    raw = await Promise.race([call, timeout]);
  } catch (e) {
    console.error("[arbiter] classify failed:", String(e && e.message).slice(0, 100)); // no message text
    return null;
  }
  const obj = _extractJson(raw);
  if (!obj || !["wallet", "fleet", "other"].includes(obj.domain)) return null;
  let c = Number(obj.confidence);
  if (!Number.isFinite(c)) c = 0.5;
  return { domain: obj.domain, confidence: Math.max(0, Math.min(1, c)) };
}

// ── B-169a: FOLLOW-UP GATE for the context lean ───────────────────────────────
// The wallet/fleet context lean (conf 0.60) exists for BARE FOLLOW-UPS right
// after a money/fleet answer: "in EGP", "now in sar", "what about last week?".
// Live bug (2026-07-02, screenshots + m8_router_misses): it also fired on full
// NOVEL questions — "What is the result of Senegal vs Belgium…?" → wallet ("No
// expenses this month"), "What is the weather in riyadh today" → fleet, where
// the injected fleet packet then SUPPRESSED the web search entirely, even though
// registry (0.70) and semantic (0.82) both said web. The lean must never outrank
// a real question: it only fires when the turn actually LOOKS like a follow-up.
// Kill switch: M8_LEAN_GATE=off restores the old unconditional lean.
const _CONT_START_RE = /^(?:and|also|ok(?:ay)?|now|then|so|what about|how about|طيب|كمان|وبعدين|و)\b/i;
const _ANAPHOR_RE    = /\b(?:it|that|this|these|those|them|same|instead|too|again|نفس|ده|دي|كده|هي|هو)\b/i;
function isBareFollowUp(message) {
  const s = String(message || "").trim();
  if (!s) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return true;                     // "in EGP", "now in sar"
  if (words.length <= 7 && (_CONT_START_RE.test(s) || _ANAPHOR_RE.test(s))) return true; // "what about last week?"
  return false;                                           // full novel question
}
function leanAllowed(message) {
  if (process.env.M8_LEAN_GATE === "off") return true;    // kill switch → old behaviour
  return isBareFollowUp(message);
}

// ── THE DECISION ──────────────────────────────────────────────────────────────
/**
 * Decide wallet vs fleet for ONE message. Pure-ish: the only side effect is the
 * optional model call on a contest. Fails SAFE → {domain:"neutral"} on any error.
 *
 * @param {string} message
 * @param {object} opts
 *   - fleetSignal {bool}  caller passes looksFleet(message) (reuse the real detector)
 *   - memberHit   {bool}  caller passes !!matchMember(message) (a household name)
 *   - walletRef   {bool}  was the LAST turn a wallet reply? (anaphora lean)
 *   - fleetRef    {bool}  was the LAST turn a fleet reply?  (anaphora lean)
 * @returns {Promise<{domain:"wallet"|"fleet"|"ask"|"neutral", confidence:number, why:string}>}
 */
async function arbitrate(message, opts = {}) {
  try {
    if (process.env.M8_DOMAIN_ARBITER_DISABLED === "1") return { domain: "neutral", confidence: 0, why: "disabled" };
    const s = String(message || "").trim();
    if (!s || s.length > ARB_MAX_LEN) return { domain: "neutral", confidence: 0, why: "empty_or_long" };

    const f = !!opts.fleetSignal;
    const w = walletSignal(s);
    // A bare household name (memberHit) is a WALLET hint only when NO fleet signal is
    // present — otherwise "Sara called about the drivers" would manufacture a false
    // wallet⇄fleet contest and make M8 needlessly ASK. With a fleet signal present,
    // a bare name is left to the (pre-152) fleet behaviour, not turned into a toss-up.
    const wPresent = w.present || (!!opts.memberHit && !f);
    const wStrong  = w.strong  || (!!opts.memberHit && !f);

    // Clear single-signal turns — decided deterministically, NO model call.
    if (wPresent && !f) return { domain: "wallet", confidence: wStrong ? 0.95 : 0.75, why: wStrong ? "wallet_strong" : "wallet_only" };
    if (f && !wPresent) return { domain: "fleet",  confidence: 0.85, why: "fleet_only" };

    // No signal either way — lean on conversation context for a bare anaphor
    // ("what's the breakdown?", "now in sar" right after an answer). The MOST RECENT
    // turn wins: walletRef = the LAST turn was a wallet reply; fleetRef = fleet seen
    // anywhere in the last few turns. So if the last turn was wallet, lean wallet even
    // when an earlier fleet brief is still in the window (the bug that sent "i want the
    // amounts in sar" to the fleet). Symmetric: last turn fleet → fleet.
    if (!wPresent && !f) {
      // B-169a: lean only on turns that actually look like follow-ups — a full
      // novel question ("Senegal vs Belgium?", "weather in riyadh") stays neutral
      // so the registry/semantic/web signals decide instead of topic stickiness.
      if (!leanAllowed(s)) return { domain: "neutral", confidence: 0, why: "lean_gated" };
      if (opts.walletRef) return { domain: "wallet", confidence: 0.6, why: "wallet_context" };
      if (opts.fleetRef)  return { domain: "fleet",  confidence: 0.6, why: "fleet_context" };
      return { domain: "neutral", confidence: 0, why: "no_signal" };
    }

    // CONTEST: both a wallet and a fleet signal in one message.
    if (wStrong) return { domain: "wallet", confidence: 0.7, why: "contest_wallet_strong" }; // "my spend" wins
    const c = await classifyDomain(s); // the ONLY place a model is consulted
    if (c && (c.domain === "wallet" || c.domain === "fleet") && c.confidence >= 0.6) {
      return { domain: c.domain, confidence: c.confidence, why: "llm" };
    }
    return { domain: "ask", confidence: 0.5, why: c ? "llm_unsure" : "contest_no_llm" };
  } catch (e) {
    return { domain: "neutral", confidence: 0, why: "error" };
  }
}

// ── CLARIFIER + its follow-up resolution ──────────────────────────────────────
function clarifierText(ar) {
  return (ar
    ? "تقصد محفظتك الشخصية ولا أرقام الأسطول؟ 🧾"
    : "Do you mean your personal wallet, or the fleet numbers? 🧾") + CLARIFY_SENTINEL;
}

// The user's reply to a clarifier. Returns "wallet" | "fleet" | null.
const _PICK_WALLET = /^\s*(?:my\s+)?(?:personal\s+)?wallet\b|^\s*personal\b|^\s*(?:my\s+)?expenses?\b|محفظ|الشخصي|مصروف/i;
const _PICK_FLEET  = /^\s*(?:the\s+)?fleet\b|^\s*drivers?\b|^\s*business\b|أسطول|اسطول|سائق|كباتن/i;
function pickedDomain(message) {
  const s = String(message || "").trim();
  if (s.length > 40) return null; // a fresh question, not a one-word pick
  if (_PICK_FLEET.test(s)) return "fleet";
  if (_PICK_WALLET.test(s)) return "wallet";
  return null;
}

// Was the previous assistant turn our clarifier? (so a bare "wallet"/"fleet"
// reply can be resolved against the question that triggered it).
function lastWasClarifier(history) {
  const h = Array.isArray(history) ? history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i]; if (!m || m.role !== "assistant" || typeof m.content !== "string") continue;
    return m.content.includes(CLARIFY_SENTINEL);
  }
  return false;
}

// The user message that triggered the clarifier = the last USER turn in history.
function originalQuestion(history) {
  const h = Array.isArray(history) ? history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i];
    if (m && (m.role === "user" || m.role === "human") && typeof m.content === "string" && m.content.trim()) return m.content.trim();
  }
  return null;
}

// ── BUILD-155: ALL-DOMAIN registry-driven classification ──────────────────────
/**
 * Decide the domain for ONE message across ALL domains (wallet, fleet, tasks,
 * notes, memory, docs, web, chat) using the capability-registry's deterministic
 * ownership scoring. This GENERALISES arbitrate() (which is wallet⇄fleet only).
 * It does NOT replace arbitrate(); the live wallet⇄fleet seam still uses arbitrate.
 *
 * Build-155 wires this in DORMANT (shadow-log only) behind M8_REGISTRY_ROUTER — it
 * changes no routing. The per-boundary flips that act on it are Builds 156–158.
 *
 * The free-LLM tie-breaker is OPTIONAL (opts.useLLM) and, in B-155, OFF — so during
 * Muhammad's live testing the shadow path is 100% deterministic + free. Today the
 * model leg can only adjudicate a wallet⇄fleet contest (reusing classifyDomain); a
 * fully generalised LLM classifier arrives with the lookup-boundary flip (B-156),
 * exactly where it's first needed. Until then a non-wallet/fleet contest stays
 * `ambiguous` (the caller would ASK, never silently guess).
 *
 * Fails SAFE → {domain:"chat"} on any error. Pure-ish: the only side effect is the
 * optional model call, which B-155 never triggers.
 *
 * @param {string} message
 * @param {object} opts  { fleetSignal, memberHit, walletRef, fleetRef, useLLM }
 * @returns {Promise<{domain,confidence,ambiguous,runnerUp,why,scores}>}
 */
// B-163: an explicit READ-MY-DOCS reference (the owner's OWN ingested CV/resume/docs/
// books/sources) is UNAMBIGUOUSLY the knowledge lane, even when a fleet/wallet TOPIC word
// co-occurs ("what does my CV say about my EARNINGS"). Tightly gated to real doc nouns +
// a read context; EXCLUDES "notes" (the note-store lane). cv/resume/docs/documents/books/
// sources/knowledge-base only -- generic words ("my files/balance") never match.
const _DOC_NOUN = "(?:cv|resumes?|r\\u00e9sum\\u00e9s?|docs?|documents?|books?|sources?|knowledge\\s*base)";
const DOC_READ_DOMINANT = new RegExp(
  "\\bmy\\s+" + _DOC_NOUN + "\\b[^?.!]{0,45}?\\b(?:say|says|said|states?|mentions?|shows?|covers?|includes?|about)\\b" +
  "|\\b(?:in|according\\s+to|from|search(?:ing)?|pull\\s+from|look\\s+in|check)\\s+(?:my\\s+)?" + _DOC_NOUN + "\\b" +
  "|\\bwhat(?:'?s| is| are| does| do| did)?\\b[^?.!]{0,30}?\\bmy\\s+" + _DOC_NOUN + "\\b",
  "i"
);
async function classifyAll(message, opts = {}) {
  try {
    const s = String(message || "").trim();
    if (!s || s.length > ARB_MAX_LEN) {
      return { domain: "chat", confidence: 0.5, ambiguous: false, runnerUp: null, why: "empty_or_long", scores: {} };
    }
    const scores = _registry.scoreMessage(s);

    // B-163: a clear READ-MY-DOCS reference DOMINATES — return knowledge non-ambiguously
    // BEFORE the fleet hint + wallet/fleet money-safety contest below, so a topic word
    // like "earnings"/"salary" inside "what does my CV say about …" can no longer tie it
    // to AMBIGUOUS and starve the ask-my-docs lookup. (CV salary text is the document, not
    // the wallet — no money-safety risk.)
    if (DOC_READ_DOMINANT.test(s)) {
      return { domain: "knowledge", confidence: 0.9, ambiguous: false, runnerUp: null, why: "doc_read_dominant", scores };
    }

    // Fold in the SAME caller hints arbitrate() trusts — they come from the real,
    // prod-tuned detectors the registry can't see on its own:
    //   fleetSignal = looksFleet(message) — authoritative fleet detector (fleet.js).
    //   memberHit   = a household name (matchMember) — a wallet hint when no fleet.
    if (opts.fleetSignal) scores.fleet = Math.max(scores.fleet || 0, 2);
    if (opts.memberHit && !opts.fleetSignal) scores.wallet = Math.max(scores.wallet || 0, 2);

    // WALLET⇄FLEET money-safety contest (mirrors arbitrate()): when BOTH a personal-money
    // signal AND a fleet signal are present, never let tie-break order silently pick one —
    // a STRONG wallet signal wins (protect personal money); otherwise ASK. This is the one
    // boundary where a wrong guess is costly (personal money ↔ business numbers).
    if ((scores.wallet || 0) > 0 && (scores.fleet || 0) > 0) {
      if ((scores.wallet || 0) >= 2) return { domain: "wallet", confidence: 0.7, ambiguous: false, runnerUp: "fleet", why: "contest_wallet_strong", scores };
      return { domain: "ask", confidence: 0.5, ambiguous: true, runnerUp: "fleet", why: "contest_wallet_fleet", scores };
    }

    const pick = _registry.pickDomain(scores);

    // No domain signal at all → lean on the MOST-RECENT turn for a bare anaphor
    // ("what's the breakdown?", "now in sar") — mirrors arbitrate()'s context lean.
    if (pick.domain === "chat") {
      // B-169a: same follow-up gate as arbitrate() — see leanAllowed().
      if (!leanAllowed(s)) return { domain: "chat", confidence: pick.confidence, ambiguous: false, runnerUp: null, why: "lean_gated", scores };
      if (opts.walletRef) return { domain: "wallet", confidence: 0.6, ambiguous: false, runnerUp: null, why: "wallet_context", scores };
      if (opts.fleetRef)  return { domain: "fleet",  confidence: 0.6, ambiguous: false, runnerUp: null, why: "fleet_context", scores };
      return { domain: "chat", confidence: pick.confidence, ambiguous: false, runnerUp: null, why: "no_signal", scores };
    }

    // CONTEST → optional free-LLM tie-breaker (B-155: OFF; the leg is inert).
    if (pick.ambiguous && opts.useLLM && process.env.M8_REGISTRY_LLM_DISABLED !== "1") {
      const pair = [pick.domain, pick.runnerUp];
      if (pair.includes("wallet") && pair.includes("fleet")) {
        const c = await classifyDomain(s); // today only adjudicates wallet vs fleet
        if (c && (c.domain === "wallet" || c.domain === "fleet") && c.confidence >= 0.6) {
          return { domain: c.domain, confidence: c.confidence, ambiguous: false, runnerUp: null, why: "llm", scores };
        }
      }
      // any other contest (or an unsure model) → stay ambiguous so the caller ASKS.
    }

    return {
      domain: pick.domain,
      confidence: pick.confidence,
      ambiguous: pick.ambiguous,
      runnerUp: pick.runnerUp,
      why: pick.ambiguous ? "contest" : "registry",
      scores,
    };
  } catch (e) {
    return { domain: "chat", confidence: 0, ambiguous: false, runnerUp: null, why: "error", scores: {} };
  }
}

module.exports = {
  arbitrate,
  classifyAll, // Build-155
  isBareFollowUp, // Build-169a (exported for tests)
  walletSignal,
  classifyDomain,
  clarifierText,
  pickedDomain,
  lastWasClarifier,
  originalQuestion,
  CLARIFY_SENTINEL,
};
