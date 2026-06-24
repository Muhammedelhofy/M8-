"use strict";
/**
 * M8 Intent Router — Phase 1 of the intent-routing upgrade (INTENT_UPGRADE_ROADMAP.md).
 *
 * A small, fast, FREE-model classifier that reads ONE user message and returns a
 * strict-JSON intent. It is the "front door brain" for a lane: the keyword parsers
 * still run first (instant, free); this only fires when they MISS, so messy/typo/
 * synonym phrasings get understood instead of looping.
 *
 * ── DIVISION OF LABOUR (council round 2, 2026-06-24) ─────────────────────────
 * The model decides ONLY the KIND + CATEGORY (what it's good at). It does NOT
 * return the amount/currency — those are parsed DETERMINISTICALLY by the caller
 * from the real message. A free model must never be trusted to invent a figure
 * (it will confidently hallucinate "50" for "add lunch"). So writes are gated on a
 * real number being present in the text, not on the model's say-so or its
 * self-reported confidence (which is statistically meaningless).
 *
 * ── HARD RULES ───────────────────────────────────────────────────────────────
 *  • AI proposes, locked code disposes — returns a *proposal*; the caller maps it
 *    to the SAME confirm-gated, scoped actions. NO new authority.
 *  • PRIVACY (honest): the model sees ONLY the live message — never stored
 *    balances/history, never the conversation. Numeric amounts are MASKED to "#"
 *    before the call, so the exact figure never leaves M8; the provider may still
 *    log the rest of the text per its own policy (free-tier reality). Not logged
 *    by M8.
 *  • Fail-safe: error / unknown / model-down / long paste → null → the caller falls
 *    back to the deterministic Phase 0 capability message.
 *  • Latency: one fast call, temperature 0, tiny output, thinkingBudget 0, hard
 *    timeout, native JSON mode where supported.
 *
 * Kill switch: M8_INTENT_BRAIN_DISABLED=1 → classifyMoneyIntent() returns null.
 */
const { generate } = require("./llm");

const MONEY_KINDS = ["add", "edit_last", "delete_last", "total", "category", "last_expense", "unknown"];

const INTENT_PROVIDER_ORDER =
  process.env.M8_INTENT_PROVIDER_ORDER || "groq,cerebras,gemini,gemini2,mistral,openrouter";
const INTENT_TIMEOUT_MS = parseInt(process.env.M8_INTENT_TIMEOUT_MS || "6000", 10);
const INTENT_MAX_LEN = parseInt(process.env.M8_INTENT_MAX_LEN || "240", 10); // long pastes aren't commands

function buildMoneyPrompt(categories) {
  return [
    "You are a STRICT intent classifier for a personal expense wallet.",
    "The user sends ONE short message (amounts may appear masked as '#'). Output ONLY a JSON object",
    "— no prose, no markdown, no code fences.",
    "",
    "Schema:",
    '{"kind": "add" | "edit_last" | "delete_last" | "total" | "category" | "last_expense" | "unknown",',
    ' "category": string | null,',
    ' "note": string | null,',
    ' "confidence": number}',
    "",
    "Do NOT output an amount — the app handles numbers itself. Decide only the kind + category.",
    "",
    "Meaning of kind:",
    '- "add": logging a NEW expense (spent / paid / bought / put down / add / log / record …).',
    '- "edit_last": change the MOST RECENT expense ("fix/change that" / "make the last one …").',
    '- "delete_last": remove the MOST RECENT expense (remove / delete / undo / get rid of "it"/"that").',
    '- "total": how much was spent overall (this month).',
    '- "category": how much was spent in ONE specific category.',
    '- "last_expense": READ the most recent expense itself — what/when it was, NOT a total ("what\'s my last expense", "show my latest transaction", "what did i last spend on").',
    '- "unknown": anything not clearly one of the above. When unsure → "unknown".',
    "",
    "Rules:",
    "- category MUST be one of this exact list or null: " + categories.join(", ") + ".",
    "  Infer from the note (lunch/coffee→Dining, taxi/uber→Transport, fuel→Fuel, groceries→Groceries …).",
    "- note: a short label for what it was (e.g. \"lunch\"), or null.",
    "",
    "Examples:",
    '"put down # riyals for lunch" => {"kind":"add","category":"Dining","note":"lunch","confidence":0.95}',
    '"throw # egp to groceries" => {"kind":"add","category":"Groceries","note":"groceries","confidence":0.92}',
    '"i wanna remove my last expense" => {"kind":"delete_last","category":null,"note":null,"confidence":0.9}',
    '"make that last one # instead" => {"kind":"edit_last","category":null,"note":null,"confidence":0.88}',
    '"how much did i spend on food this month" => {"kind":"category","category":"Dining","note":null,"confidence":0.9}',
    '"what did i spend this month" => {"kind":"total","category":null,"note":null,"confidence":0.9}',
    '"what was my last expense" => {"kind":"last_expense","category":null,"note":null,"confidence":0.93}',
    '"show me my most recent transaction" => {"kind":"last_expense","category":null,"note":null,"confidence":0.9}',
    '"what is the weather" => {"kind":"unknown","category":null,"note":null,"confidence":0.96}',
  ].join("\n");
}

// Pull the first balanced-looking JSON object out of a model reply (fallback for
// when a provider ignores JSON mode and adds fences / prose).
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

// Returns { kind, category, note, confidence } or null. The caller parses the
// amount/currency deterministically. `categories` is the allowed category list.
async function classifyMoneyIntent(message, categories) {
  if (process.env.M8_INTENT_BRAIN_DISABLED === "1") return null;
  const text = String(message || "").trim();
  if (!text || text.length > INTENT_MAX_LEN) return null; // empty or long paste → not a command
  const cats = Array.isArray(categories) && categories.length ? categories : [];
  // PRIVACY: mask numeric amounts before the message leaves for the provider. The
  // exact figure is parsed locally by the caller; the model only needs the shape.
  const masked = text.replace(/\d[\d.,]*/g, "#");

  let raw;
  try {
    const call = generate({
      systemInstruction: buildMoneyPrompt(cats),
      contents: [{ role: "user", parts: [{ text: masked }] }], // masked live message ONLY
      providerOrder: INTENT_PROVIDER_ORDER,
      genConfig: {
        temperature: 0,
        maxOutputTokens: 200,
        thinkingBudget: 0,
        responseFormat: { type: "json_object" }, // OpenAI-compatible (Groq/Cerebras/…)
        responseMimeType: "application/json",     // Gemini
      },
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

  // Validate category against the allowed list (case-insensitive); else drop it.
  let category = null;
  if (obj.category && cats.length) {
    const hit = cats.find((c) => c.toLowerCase() === String(obj.category).toLowerCase());
    category = hit || null;
  }
  const confidence = coerceNum(obj.confidence);

  return {
    kind: obj.kind,
    category,
    note: obj.note != null ? String(obj.note).slice(0, 120) : null,
    confidence: confidence == null ? 0.5 : Math.max(0, Math.min(1, confidence)),
  };
}

module.exports = { classifyMoneyIntent, extractJson, MONEY_KINDS };
