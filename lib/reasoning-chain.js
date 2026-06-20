/**
 * lib/reasoning-chain.js — Build-85d: Multi-hop Reasoning Chain
 *
 * For complex "why/how/compare" questions, M8 normally answers in one shot. This
 * module makes it reason STEP BY STEP, visibly: decompose the question into 2-4
 * sub-questions, answer each one (reusing the KG/entity context already fetched
 * for the turn — never a new fetch), then synthesize a final answer that SHOWS
 * the chain ("Step 1 … → … / Step 2 … → … / Therefore …").
 *
 * HARD GATES (enforced by the caller AND by isComplex):
 *   - Fleet / finance / compute questions NEVER go through the chain. Those have
 *     deterministic ground-truth packets (FLEET DATA / FLEET P&L / computed math)
 *     and must not be laundered through a generative multi-hop narration.
 *   - isComplex() is SYNCHRONOUS — pure regex, never an API call.
 *   - Total chain latency budget = 8s. If decompose + all sub-answers blow the
 *     budget, runChain returns null and the orchestrator falls back to a normal
 *     single-hop answer. A failed/empty decompose also degrades to single-hop.
 *
 * Every DB / LLM touch is fail-safe: this module never throws to the orchestrator.
 */

const { generate } = require("./llm");
const { createClient } = require("@supabase/supabase-js");

const CHAIN_MODEL   = "gemini-2.5-flash";
const CHAIN_ORDER   = "gemini,gemini2";   // force the free Gemini bucket(s)
const BUDGET_MS     = 8000;               // total chain latency budget
const MAX_SUBQ      = 4;

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Eval / smoke sessions are stateless — never persist a chain from them.
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// ── Gate vocab ──────────────────────────────────────────────────────────────
// Triggers: the question reads like a reasoning/relationship question.
const COMPLEX_RE = /\b(why|how|compare|difference|explain|between|relationship|cause|result|impact)\b/i;
// Hard exclusions: anything that smells of the fleet/finance/compute lanes, which
// own their own deterministic answer path and must never enter the chain.
const FLEET_FINANCE_RE = /\b(sar|sr|riyals?|driver|drivers|fleet|courier|ambassador|captain|p&l|pnl|salary|salaries|payout|bonus|profit|revenue|net\s+earnings|rental|rent)\b/i;

/**
 * isComplex(message) — SYNCHRONOUS. True when the message is long enough AND
 * reads like a multi-hop reasoning question, and is NOT a fleet/finance/compute
 * query. Never makes an API call.
 */
function isComplex(message) {
  const m = typeof message === "string" ? message : "";
  if (m.length <= 80) return false;
  if (FLEET_FINANCE_RE.test(m)) return false;   // fleet/finance/compute → never the chain
  return COMPLEX_RE.test(m);
}

// Extract a JSON array of strings from a model reply (tolerant of code fences /
// prose around it). Returns [] on any failure.
function parseSubQuestions(raw) {
  const s = typeof raw === "string" ? raw : "";
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try {
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  } catch (_) {
    return [];
  }
}

/**
 * decompose(question) — async. Breaks the question into 2-4 sub-questions that
 * together fully answer it. Capped at MAX_SUBQ. On ANY failure → [question]
 * (single-hop fallback).
 */
async function decompose(question) {
  const q = String(question || "").slice(0, 1000);
  try {
    const raw = await generate({
      systemInstruction:
        "You break a complex question into the minimal set of sub-questions that, answered in order, fully resolve it.",
      contents: [{
        role: "user",
        parts: [{ text:
          `Break this into 2-4 sub-questions that together fully answer it. ` +
          `Return JSON array of strings only. Question: ${q}` }],
      }],
      providerOrder: CHAIN_ORDER,
      genConfig: { temperature: 0.2, maxOutputTokens: 300, geminiModel: CHAIN_MODEL },
    });
    const subs = parseSubQuestions(raw).slice(0, MAX_SUBQ);
    if (subs.length === 0) return [q];          // empty/garbled → single-hop
    return subs;
  } catch (e) {
    console.error("[M8] reasoning-chain decompose error (non-fatal):", e.message);
    return [q];                                 // single-hop fallback
  }
}

// Render the already-fetched KG / entity context into a compact grounding block
// (no new fetches — we reuse exactly what the turn already gathered).
function buildContextBlock(kgContext, entityCtx) {
  let block = "";
  if (kgContext && typeof kgContext === "string" && kgContext.trim()) {
    block += `\n\nKNOWLEDGE GRAPH (ingested books — cite the book/author when used):\n${kgContext}`;
  }
  if (entityCtx && typeof entityCtx === "string" && entityCtx.trim()) {
    block += `\n\nKNOWN ENTITIES (tracked across sessions):\n${entityCtx}`;
  }
  return block;
}

/**
 * answerSubQuestion(subQ, kgContext, entityCtx) — async. One short (≤200 token)
 * Gemini call per sub-question, grounded on whatever context was already fetched.
 * Returns { subQ, answer }. Never throws.
 */
async function answerSubQuestion(subQ, kgContext, entityCtx) {
  const ctx = buildContextBlock(kgContext, entityCtx);
  try {
    const raw = await generate({
      systemInstruction:
        "Answer the single sub-question concisely and factually. If you don't have a verified basis, say so plainly — never invent specifics." +
        ctx,
      contents: [{ role: "user", parts: [{ text: String(subQ || "").slice(0, 600) }] }],
      providerOrder: CHAIN_ORDER,
      genConfig: { temperature: 0.2, maxOutputTokens: 200, geminiModel: CHAIN_MODEL },
    });
    const answer = (typeof raw === "string" && raw.trim()) ? raw.trim() : "(no answer)";
    return { subQ, answer };
  } catch (e) {
    console.error("[M8] reasoning-chain answerSubQuestion error (non-fatal):", e.message);
    return { subQ, answer: "(couldn't resolve this step)" };
  }
}

/**
 * synthesize(originalQ, steps) — async. Takes [{subQ, answer}] and produces the
 * final answer that EXPLICITLY shows the reasoning, ending in a "Therefore"
 * conclusion. ≤600 tokens. Never throws (falls back to a plain stitched answer).
 */
async function synthesize(originalQ, steps) {
  const stepText = (steps || [])
    .map((s, i) => `Step ${i + 1}: ${s.subQ} → ${s.answer}`)
    .join("\n");
  try {
    const raw = await generate({
      // Build-85g (Gemini review): hide the chain inside <thought_process> XML.
      // The orchestrator strips it before the user sees the answer, exposing only
      // the synthesized conclusion. This preserves conversational UX while keeping
      // the full reasoning trace in the log for debugging.
      systemInstruction:
        "You are M8 answering Muhammad. You are given a question and the answers to its sub-questions. " +
        "Output in this EXACT format:\n" +
        "<thought_process>\nStep 1: [sub-question] → [answer]\nStep 2: [sub-question] → [answer]\n...\n</thought_process>\n" +
        "Then write the final answer as a natural paragraph starting with 'Therefore: ' — no bullet points, no headers, just a clean conclusion. " +
        "Never invent facts beyond the steps.",
      contents: [{
        role: "user",
        parts: [{ text: `QUESTION: ${String(originalQ || "").slice(0, 800)}\n\nSUB-ANSWERS:\n${stepText}\n\nWrite the thought_process block then the final answer now.` }],
      }],
      providerOrder: CHAIN_ORDER,
      genConfig: { temperature: 0.3, maxOutputTokens: 600, geminiModel: CHAIN_MODEL },
    });
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  } catch (e) {
    console.error("[M8] reasoning-chain synthesize error (non-fatal):", e.message);
  }
  // Fallback: deterministically stitch the steps so we still SHOW the reasoning.
  const concl = steps && steps.length ? steps[steps.length - 1].answer : "";
  return `${stepText}${stepText ? "\n" : ""}Therefore: ${concl}`.trim();
}

/**
 * logChain(sessionId, question, steps, finalAnswer) — fire-and-forget. Saves the
 * chain to m8_reasoning_chains. Never throws; skipped for ephemeral sessions.
 */
function logChain(sessionId, question, steps, finalAnswer) {
  if (isEphemeralSession(sessionId)) return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;
  try {
    getClient()
      .from("m8_reasoning_chains")
      .insert({
        session_id:   sessionId || null,
        question:     question || null,
        steps:        steps || [],
        final_answer: finalAnswer || null,
      })
      .then(({ error }) => { if (error) console.error("[M8] logChain insert error (non-fatal):", error.message); })
      .catch((e) => console.error("[M8] logChain error (non-fatal):", e.message));
  } catch (e) {
    console.error("[M8] logChain throw (non-fatal):", e.message);
  }
}

/**
 * runChain(originalQ, kgContext, entityCtx, sessionId) — orchestrate the full
 * multi-hop chain inside an 8s latency budget. Returns the final answer string,
 * or null to signal the orchestrator should fall back to a single-hop answer.
 *
 * Budget rule: if decompose + the sub-answers exceed BUDGET_MS, bail to null
 * BEFORE spending more time on synthesis. A 1-element decomposition (the fallback)
 * also returns null — a single sub-question is just a single-hop answer, so let
 * the normal path handle it rather than wrapping it in chain ceremony.
 */
async function runChain(originalQ, kgContext, entityCtx, sessionId) {
  const t0 = Date.now();
  try {
    const subs = await decompose(originalQ);
    // Single-hop (decompose failed or returned the question itself) → let the
    // normal answer path handle it; the chain adds nothing here.
    if (!subs || subs.length < 2) return null;
    if (Date.now() - t0 > BUDGET_MS) return null;

    // Answer sub-questions in parallel (each reuses already-fetched context).
    const steps = await Promise.all(
      subs.map((sq) => answerSubQuestion(sq, kgContext, entityCtx))
    );
    if (Date.now() - t0 > BUDGET_MS) return null;   // over budget → single-hop fallback

    const rawAnswer = await synthesize(originalQ, steps);
    if (!rawAnswer) return null;

    // Strip the hidden reasoning chain before returning to the orchestrator.
    // synthesize() wraps step-by-step work in <thought_process>…</thought_process>;
    // only the conclusion (after those tags) reaches the user.
    const finalAnswer = rawAnswer
      .replace(/<thought_process>[\s\S]*?<\/thought_process>/gi, "")
      .replace(/^[\s\n]+/, "")
      .trim();
    if (!finalAnswer) return null;

    logChain(sessionId, originalQ, steps, finalAnswer);  // fire-and-forget
    return finalAnswer;
  } catch (e) {
    console.error("[M8] runChain error (non-fatal):", e.message);
    return null;
  }
}

module.exports = {
  isComplex,
  decompose,
  answerSubQuestion,
  synthesize,
  logChain,
  runChain,
  // exported for tests
  parseSubQuestions,
  BUDGET_MS,
  MAX_SUBQ,
};
