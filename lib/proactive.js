/**
 * lib/proactive.js — Build-88: Proactive Intelligence
 *
 * After M8 answers a question, it proactively surfaces 1-2 natural follow-up
 * questions the user is likely to want to ask next. This turns M8 from a
 * reactive responder into a forward-leaning partner (the Grok review finding:
 * "Did Muhammad use M8 today without prompting?" is the real success metric).
 *
 * Design choices:
 *   • One cheap gemini-2.5-flash call (100-120 tokens max).
 *   • Hard 1.5s budget: if it takes longer, return [] so the turn isn't held.
 *   • Only fires for knowledge + general lanes (fleet/finance have their own
 *     deterministic proactive path; research/math have specialist UX).
 *   • Returns question strings, not chip labels — the caller formats into chips.
 *   • All failures are silent (never modifies the main answer).
 */

"use strict";

const { generate } = require("./llm");

const PROACTIVE_MODEL  = "gemini-2.5-flash";
const PROACTIVE_ORDER  = "gemini,gemini2";
const PROACTIVE_BUDGET = 1500;   // ms hard cap

const ELIGIBLE_INTENTS = new Set(["knowledge", "general", "hybrid"]);

// Intent labels that should NEVER get proactive follow-ups.
const SKIP_INTENTS = new Set(["fleet", "finance", "math"]);

const SYSTEM =
  "You are a follow-up question generator. " +
  "Given a question and its answer, output 1 or 2 SHORT follow-up questions " +
  "that the user is most likely to ask next, as a JSON array of strings. " +
  "Questions must be short (under 12 words), natural, and directly related to the answer. " +
  "Return ONLY the JSON array — no explanation, no labels, no other text. " +
  "Example: [\"What does that mean for the business?\", \"Can you show the numbers?\"]";

/**
 * Parse the model reply into a clean string[].
 * Tolerates code fences, prose, or malformed JSON.
 */
function parseFollowUps(raw) {
  if (!raw || typeof raw !== "string") return [];
  const text = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try {
    const arr = JSON.parse(text.slice(a, b + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, 2);
  } catch (_) {
    return [];
  }
}

/**
 * suggestFollowUps(question, answer, intent) — main export.
 *
 * @param {string} question   user's original message
 * @param {string} answer     M8's response (after reflection)
 * @param {string} intent     classifier intent ("knowledge" / "general" / etc.)
 * @returns {Promise<string[]>}  0-2 follow-up question strings
 */
async function suggestFollowUps(question, answer, intent) {
  if (!question || !answer) return [];
  if (SKIP_INTENTS.has(intent)) return [];
  if (!ELIGIBLE_INTENTS.has(intent)) return [];
  // Only fire on substantive answers (short answers don't warrant follow-ups).
  if (answer.length < 150) return [];

  const prompt =
    `Question: ${String(question).slice(0, 400)}\n\n` +
    `Answer: ${String(answer).slice(0, 800)}\n\n` +
    `What are 1-2 natural follow-up questions?`;

  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error("proactive timeout")), PROACTIVE_BUDGET);
  });

  try {
    const raw = await Promise.race([
      generate({
        systemInstruction: SYSTEM,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        providerOrder: PROACTIVE_ORDER,
        genConfig: { temperature: 0.4, maxOutputTokens: 120, geminiModel: PROACTIVE_MODEL },
        meta: { kind: "proactive-follow-ups" },
      }),
      timeout,
    ]);
    return parseFollowUps(raw);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timerId);
  }
}

module.exports = { suggestFollowUps, parseFollowUps };
