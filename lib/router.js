/**
 * M8 Knowledge-Decision Router — api/router.js
 *
 * The anti-whack-a-mole layer. Instead of enumerating every topic in regex,
 * we ask the model the only question that matters:
 *   "Can I answer this from what I know, do I need CURRENT info, or am I
 *    missing a key detail?"  →  answer | search | clarify
 *
 * Used ONLY for messages the regex classifier left as NONE and that aren't
 * personal/fleet (those go to memory). Runs on a FAST FREE provider to spare
 * Gemini quota, with a single short JSON output. Fails SAFE: any error → answer.
 */
const { generate } = require("./llm");

// Free, fast providers first — this is a cheap routing decision, not the answer.
const ROUTER_PROVIDER_ORDER = process.env.ROUTER_PROVIDER_ORDER || "groq,cerebras,gemini,gemini2,openrouter";

function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/**
 * Decide how to handle a message.
 * @returns {{action:"answer"|"search"|"clarify", query?:string, question?:string}}
 */
async function decideAction({ message, history }) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "long", day: "numeric",
  });

  const system =
`You are M8's routing brain (Muhammad is in Riyadh, Saudi Arabia). Today is ${today}.
Decide how to handle the user's latest message. Output ONLY JSON, nothing else:
{"action":"answer"|"search"|"clarify","query":"<web query if search>","question":"<one short question if clarify>"}

Pick "search" when a good answer needs CURRENT or external info that may not be in your training:
- live schedules/results (sports kickoff times, fixtures, scores), prices, flights, FX, weather
- news, today's status, recent or post-2023 developments
- specific real-world facts about people/companies/events you may not reliably know
- ANY question ABOUT a specific named product, tool, app, library, company, service, or project — "what is X", "how does X work", "how can X help", "tell me about X", "is X any good", "X vs Y". Decide by the QUESTION SHAPE, not by whether you think you know X: named things are often new/niche or share a name with something else, so a confident description from memory is the #1 fabrication risk. When in doubt about a named entity, search — set query to the entity name.
Pick "answer" when it's conceptual, historical, explanatory, advice, opinion, or personal/chat about GENERAL ideas (not a specific named external product) — answerable from knowledge.
Pick "clarify" ONLY when the request is too vague to search or answer well (a key detail is missing).
For "search", write a precise query that includes the current year and obvious context (e.g. Riyadh).`;

  const recent = (history || [])
    .slice(-4)
    .filter((m) => m && typeof m.content === "string")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  recent.push({ role: "user", parts: [{ text: message }] });

  let out;
  try {
    out = await generate({
      systemInstruction: system,
      contents: recent,
      providerOrder: ROUTER_PROVIDER_ORDER,
      genConfig: { temperature: 0, maxOutputTokens: 200 },
    });
  } catch (err) {
    console.error("[M8] router decide error (non-fatal):", err.message);
    return { action: "answer" };
  }

  const parsed = parseJsonLoose(out);
  if (!parsed || !parsed.action) return { action: "answer" };
  const action = ["answer", "search", "clarify"].includes(parsed.action) ? parsed.action : "answer";
  return { action, query: (parsed.query || message).toString(), question: (parsed.question || "").toString() };
}

module.exports = { decideAction };
