"use strict";
/**
 * M8 Intent Router — Phase 1 of the intent-routing upgrade (INTENT_UPGRADE_ROADMAP.md).
 *
 * A small, fast, FREE-model classifier that reads ONE user message and returns a
 * strict-JSON intent. It is the "front door brain" for a lane: the keyword parsers
 * still run first (instant, free); this only fires when they MISS, so messy/typo/
 * synonym phrasings get understood instead of looping.
 *
 * ── HARD RULES (mirror the roadmap's locked invariants) ──────────────────────
 *  • AI proposes, locked code disposes — this returns a *proposal*; the caller maps
 *    it to the SAME confirm-gated, scoped actions. It is granted NO new authority.
 *  • PRIVACY: the model sees ONLY the live message passed in — never stored wallet
 *    data (balances/history) and never the conversation history. The message is
 *    NOT logged here (only a parse-failure flag, never the text).
 *  • Fail-safe: any error / low confidence / model-unavailable → returns null, and
 *    the caller falls back to the deterministic Phase 0 capability message.
 *  • Latency: one fast call, temperature 0, tiny output, thinkingBudget 0, hard
 *    timeout — it sits in the per-turn critical path.
 *
 * Kill switch: M8_INTENT_BRAIN_DISABLED=1 makes classifyMoneyIntent() a no-op (null)
 * → instant rollback to pure Phase 0 behaviour without a redeploy.
 */
const { generate } = require("./llm");

const MONEY_KINDS = ["add", "edit_last", "delete_last", "total", "category", "unknown"];

// Fast-first provider order for the classifier (override via env). Groq/Cerebras are
// the lowest-latency free providers; Gemini/Mistral/OpenRouter back them up.
const INTENT_PROVIDER_ORDER =
  process.env.M8_INTENT_PROVIDER_ORDER || "groq,cerebras,gemini,gemini2,mistral,openrouter";
const INTENT_TIMEOUT_MS = parseInt(process.env.M8_INTENT_TIMEOUT_MS || "6000", 10);

function buildMoneyPrompt(categories) {
  return [
    "You are a STRICT intent classifier for a personal expense wallet.",
    "The user sends ONE short message. Output ONLY a JSON object — no prose, no markdown, no code fences.",
    "",
    "Schema:",
    '{"kind": "add" | "edit_last" | "delete_last" | "total" | "category" | "unknown",',
    ' "amount": number | null,',
    ' "currency": "SAR" | "EGP" | null,',
    ' "category": string | null,',
    ' "note": string | null,',
    ' "confidence": number}',
    "",
    "Meaning of kind:",
    '- "add": logging a NEW expense (spent / paid / bought / put down / add / log / record …).',
    '- "edit_last": change the MOST RECENT expense (fix/change/update "that" / "the last one" / "what I just added").',
    '- "delete_last": remove the MOST RECENT expense (remove / delete / undo / get rid of "it" / "that" / "the last one").',
    '- "total": how much was spent overall (this month).',
    '- "category": how much was spent in ONE specific category.',
    '- "unknown": anything not clearly one of the above. When unsure, use "unknown" with low confidence.',
    "",
    "Rules:",
    "- NEVER invent an amount. If no number is stated, amount = null.",
    "- currency: SAR for riyal/sar/sr, EGP for pound/egp/جنيه; else null.",
    "- category MUST be one of this exact list or null: " + categories.join(", ") + ".",
    "  Infer from the note (lunch/coffee→Dining, taxi/uber→Transport, fuel→Fuel, groceries→Groceries …).",
    "- note: a short label for what it was (e.g. \"lunch\"), or null.",
    "- confidence: 0..1, your certainty in kind.",
    "",
    "Examples:",
    '"put down fifty riyals for lunch" => {"kind":"add","amount":50,"currency":"SAR","category":"Dining","note":"lunch","confidence":0.95}',
    '"throw 30 egp to groceries" => {"kind":"add","amount":30,"currency":"EGP","category":"Groceries","note":"groceries","confidence":0.92}',
    '"i wanna remove my last expense" => {"kind":"delete_last","amount":null,"currency":null,"category":null,"note":null,"confidence":0.9}',
    '"actually make that last one 35" => {"kind":"edit_last","amount":35,"currency":null,"category":null,"note":null,"confidence":0.88}',
    '"how much did i spend on food this month" => {"kind":"category","amount":null,"currency":null,"category":"Dining","note":null,"confidence":0.9}',
    '"what did i spend this month" => {"kind":"total","amount":null,"currency":null,"category":null,"note":null,"confidence":0.9}',
    '"what is the weather" => {"kind":"unknown","amount":null,"currency":null,"category":null,"note":null,"confidence":0.96}',
  ].join("\n");
}

// Pull the first balanced-looking JSON object out of a model reply (handles code
// fences / stray prose despite the instruction to emit bare JSON).
function extractJson(text) {
  if (typeof text !== "string") return null;
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (_) { return null; }
}

function coerceNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Returns a validated intent object or null. `categories` is the allowed category
// list (passed in so this module never reaches into the wallet directly).
async function classifyMoneyIntent(message, categories) {
  if (process.env.M8_INTENT_BRAIN_DISABLED === "1") return null;
  const text = String(message || "").trim();
  if (!text) return null;
  const cats = Array.isArray(categories) && categories.length ? categories : [];

  let raw;
  try {
    const call = generate({
      systemInstruction: buildMoneyPrompt(cats),
      contents: [{ role: "user", parts: [{ text }] }], // ONLY the live message
      providerOrder: INTENT_PROVIDER_ORDER,
      genConfig: { temperature: 0, maxOutputTokens: 200, thinkingBudget: 0 },
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("intent timeout")), INTENT_TIMEOUT_MS));
    raw = await Promise.race([call, timeout]);
  } catch (e) {
    console.error("[intent] money classify failed:", String(e && e.message).slice(0, 120)); // no message text
    return null;
  }

  const obj = extractJson(raw);
  if (!obj || typeof obj !== "object") return null;
  if (!MONEY_KINDS.includes(obj.kind)) return null;

  const confidence = coerceNum(obj.confidence);
  // Validate category against the allowed list (case-insensitive); else drop it.
  let category = null;
  if (obj.category && cats.length) {
    const hit = cats.find((c) => c.toLowerCase() === String(obj.category).toLowerCase());
    category = hit || null;
  }
  let currency = null;
  if (obj.currency === "SAR" || obj.currency === "EGP") currency = obj.currency;

  return {
    kind: obj.kind,
    amount: coerceNum(obj.amount),
    currency,
    category,
    note: obj.note != null ? String(obj.note).slice(0, 120) : null,
    confidence: confidence == null ? 0.5 : Math.max(0, Math.min(1, confidence)),
  };
}

module.exports = { classifyMoneyIntent, extractJson, MONEY_KINDS };
