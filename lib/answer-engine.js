/**
 * M8 Answer Engine — lib/answer-engine.js  (Build-84)
 *
 * The multi-source ROUTER for context injection. The orchestrator used to inject
 * EVERY context block (fleet + finance + KG + entity + semantic recall) into every
 * answer regardless of what was asked — a fleet question got book knowledge, a
 * history question got fleet rollups. Token bloat + diluted answers.
 *
 * This module decides WHICH sources a turn actually needs, then MERGES the
 * knowledge sources (knowledge graph + semantic recall) into one deduplicated,
 * citation-tagged, confidence-annotated block.
 *
 * Four pieces:
 *   1. classifyIntent()  — one cheap gemini-2.5-flash call → fleet | finance |
 *                          knowledge | math | general | hybrid.
 *   2. selectSources()   — intent + existing routing flags → which sources to pull.
 *                          The flags are hard OVERRIDES (fleet CSV upload, image
 *                          turns, ingest mode, regex compute) so classification can
 *                          never suppress a deterministic packet.
 *   3. mergeEvidence()   — KG hits + memory hits, deduped by word-overlap Jaccard
 *                          (≥0.5 = same claim → keep the higher-confidence copy).
 *   4. renderEvidenceBlock() — citation tags ([KG]/[Memory]/[Entity]/[Fleet]) +
 *                          a confidence hedge whenever similarity < 0.75.
 *
 * FAULT TOLERANCE (mirrors the orchestrator's contract): classifyIntent never
 * throws. A failed/empty/garbled classifier call falls back to "hybrid" — which
 * selects EVERY source — so a classifier outage degrades to exactly the old
 * inject-everything behavior, never to a wrong, narrowed answer.
 */

let _generate = null;
function lazyGenerate() {
  // Lazy require so unit tests can load this module without a configured LLM stack.
  if (!_generate) ({ generate: _generate } = require("./llm"));
  return _generate;
}

const INTENTS = ["fleet", "finance", "knowledge", "math", "general", "hybrid"];

const CLASSIFIER_MODEL = process.env.ANSWER_ENGINE_MODEL || "gemini-2.5-flash";
const CLASSIFIER_ORDER = process.env.ANSWER_ENGINE_ORDER || "gemini,gemini2";

const CLASSIFIER_SYSTEM =
  `You are M8's intent router. Read the user's message and classify it into EXACTLY ONE label. ` +
  `Reply with ONLY the single lowercase label word — no punctuation, no explanation.\n\n` +
  `Labels:\n` +
  `• fleet — drivers, orders, earnings, acceptance, the delivery fleet, "who's on pace", rankings, the morning brief.\n` +
  `• finance — P&L, profit, costs, salaries, rent, margins, EOSB, company money.\n` +
  `• knowledge — facts from ingested books/authors, history, religion, science, "what does <book> say".\n` +
  `• math — arithmetic, number theory, statistics, a computation or simulation to run.\n` +
  `• general — chat, opinion, planning, web/current-events, anything not covered above.\n` +
  `• hybrid — the message genuinely spans two or more of the above (e.g. "compare our fleet profit to what the book says about margins").\n\n` +
  `Output one word only.`;

/**
 * Classify a message into one of INTENTS using a fast, cheap Gemini Flash call.
 * Never throws. On any failure (no key, timeout, garbled output) → { intent:"hybrid",
 * fallback:true } so the caller injects everything (old behavior).
 *
 * @param {string} message
 * @param {object} [opts]  { generate, providerOrder, model } — `generate` injectable for tests.
 * @returns {Promise<{intent:string, fallback:boolean, raw?:string, error?:string}>}
 */
async function classifyIntent(message, opts = {}) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return { intent: "general", fallback: false, raw: "" };

  const gen = opts.generate || lazyGenerate();
  try {
    const raw = await gen({
      systemInstruction: CLASSIFIER_SYSTEM,
      contents: [{ role: "user", parts: [{ text: text.slice(0, 2000) }] }],
      providerOrder: opts.providerOrder || CLASSIFIER_ORDER,
      genConfig: { geminiModel: opts.model || CLASSIFIER_MODEL, maxOutputTokens: 200, temperature: 0 },
      meta: { kind: "answer-engine-classify" },
    });
    const intent = parseIntent(raw);
    if (!intent) return { intent: "hybrid", fallback: true, raw: typeof raw === "string" ? raw : "" };
    return { intent, fallback: false, raw };
  } catch (e) {
    return { intent: "hybrid", fallback: true, error: e && e.message ? e.message : String(e) };
  }
}

/** Pull the first recognised intent word out of a raw model reply, or null. */
function parseIntent(raw) {
  if (!raw || typeof raw !== "string") return null;
  const low = raw.toLowerCase();
  for (const i of INTENTS) {
    if (new RegExp("\\b" + i + "\\b").test(low)) return i;
  }
  return null;
}

// Which sources each intent wants. entity + recall (semantic memory) travel with
// most intents because identity/personal context helps any non-math answer; math
// is deliberately lean (a self-contained computation owns its own number).
const SOURCE_MAP = {
  fleet:     { fleet: true,  finance: false, knowledge: false, math: false, entity: true,  recall: true  },
  finance:   { fleet: true,  finance: true,  knowledge: false, math: false, entity: true,  recall: true  },
  knowledge: { fleet: false, finance: false, knowledge: true,  math: false, entity: true,  recall: true  },
  math:      { fleet: false, finance: false, knowledge: false, math: true,  entity: false, recall: false },
  general:   { fleet: false, finance: false, knowledge: true,  math: false, entity: true,  recall: true  },
  hybrid:    { fleet: true,  finance: true,  knowledge: true,  math: true,  entity: true,  recall: true  },
};

/**
 * Decide which context sources to fetch for this turn.
 * The existing routing flags are HARD OVERRIDES — they force a source ON regardless
 * of the classifier so a fleet CSV upload, an image turn, ingest mode, or a regex
 * compute can never be starved of the data its downstream code expects.
 *
 * @param {string} intent  one of INTENTS
 * @param {object} [flags] { fleetLike, financeLike, computeMode, knowledgeIngestMode, imgTurn }
 * @returns {{fleet:boolean, finance:boolean, knowledge:boolean, math:boolean, entity:boolean, recall:boolean}}
 */
function selectSources(intent, flags = {}) {
  const base = SOURCE_MAP[intent] || SOURCE_MAP.hybrid;
  const sel = { ...base };

  if (flags.fleetLike)           sel.fleet = true;
  if (flags.financeLike)       { sel.finance = true; sel.fleet = true; }
  if (flags.computeMode)         sel.math = true;
  if (flags.knowledgeIngestMode) sel.knowledge = true;
  // Image turns own their own pipeline downstream; don't let the classifier narrow
  // them. Leave knowledge/entity available so a "what is this in the photo" still
  // gets supporting context.
  if (flags.imgTurn)             sel.knowledge = sel.knowledge || base.knowledge;

  return sel;
}

// ── Evidence merge (KG + semantic recall) ────────────────────────────────────
const STOP = new Set([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","from","by",
  "is","are","was","were","be","been","being","it","its","this","that","these","those",
  "as","into","about","over","than","then","so","such","not","no","yes","i","you","he",
  "she","they","we","his","her","their","our","my","your","what","when","where","which",
  "who","how","why","do","does","did","has","have","had","will","would","can","could",
]);

/** Normalised content-word set for Jaccard similarity (stop-words + short tokens dropped). */
function wordSet(text) {
  if (!text || typeof text !== "string") return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  );
}

/** Jaccard overlap of two word-sets, 0..1. Two empty sets = 0 (no evidence of sameness). */
function jaccard(a, b) {
  if (!a || !b || (a.size === 0 && b.size === 0)) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/** Coerce a raw source (string of newline rows | array of strings | array of objects)
 *  into a uniform [{content, source, confidence, ref}] list. */
function toItems(raw, source) {
  if (!raw) return [];
  let rows;
  if (typeof raw === "string") {
    rows = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(raw)) {
    rows = raw;
  } else {
    rows = [raw];
  }
  return rows.map((r) => {
    if (r && typeof r === "object") {
      return {
        content: String(r.content ?? r.text ?? "").trim(),
        source: r.source || source,
        confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
        ref: r.ref || null,
      };
    }
    return { content: String(r).trim(), source, confidence: 0.5, ref: null };
  }).filter((it) => it.content.length > 0);
}

/**
 * Merge knowledge-graph hits and semantic-recall (memory) hits, deduplicating by
 * content similarity. Two items whose word-overlap Jaccard ≥ threshold are treated
 * as the SAME claim — the higher-confidence copy is kept, and the surviving item is
 * annotated with the `similarity` it matched at (so renderEvidenceBlock can hedge).
 *
 * @param {string|Array} kgItems   knowledge-graph source (string rows or items)
 * @param {string|Array} memItems  semantic-recall / memory source
 * @param {object} [opts] { threshold = 0.5 }
 * @returns {Array<{content,source,confidence,ref,similarity:number|null,merged:boolean}>}
 */
function mergeEvidence(kgItems, memItems, opts = {}) {
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.5;
  const items = [...toItems(kgItems, "KG"), ...toItems(memItems, "Memory")];

  const kept = [];
  for (const it of items) {
    const ws = wordSet(it.content);
    let bestDup = null;
    let bestSim = 0;
    for (const k of kept) {
      const sim = jaccard(ws, k._ws);
      if (sim >= threshold && sim > bestSim) { bestDup = k; bestSim = sim; }
    }
    if (bestDup) {
      // Same claim from two sources — record the match similarity, keep the more
      // confident copy's content/source.
      bestDup.merged = true;
      bestDup.similarity = Math.max(bestDup.similarity ?? 0, bestSim);
      if ((it.confidence ?? 0) > (bestDup.confidence ?? 0)) {
        bestDup.content = it.content;
        bestDup.source = it.source;
        bestDup.confidence = it.confidence;
        bestDup.ref = it.ref;
        bestDup._ws = ws;
      }
    } else {
      kept.push({ ...it, _ws: ws, similarity: null, merged: false });
    }
  }
  return kept.map((k) => { const { _ws, ...rest } = k; return rest; });
}

/** Citation tag for a source: [KG: bn01] / [KG] / [Memory] / [Entity] / [Fleet]. */
function citationTag(source, ref) {
  if (source === "KG")     return ref ? `[KG: ${ref}]` : "[KG]";
  if (source === "Memory") return "[Memory]";
  if (source === "Entity") return "[Entity]";
  if (source === "Fleet")  return "[Fleet]";
  return `[${source}]`;
}

/** Confidence hedge appended when a merged item matched below the "confident" bar.
 *  Below 0.75 similarity we flag it as supporting context, not confirmed fact. */
function confidenceNote(similarity) {
  if (typeof similarity !== "number") return "";
  if (similarity < 0.75) {
    return ` (found with ${similarity.toFixed(2)} similarity — treat as supporting context, not confirmed fact)`;
  }
  return "";
}

/**
 * Render merged evidence into a single citation-tagged injection block.
 * Each line: <citation tag> <content><optional confidence hedge>.
 * Returns "" for an empty merge so the caller can skip injection cleanly.
 */
function renderEvidenceBlock(merged) {
  if (!Array.isArray(merged) || merged.length === 0) return "";
  return merged
    .map((m) => `${citationTag(m.source, m.ref)} ${m.content}${confidenceNote(m.similarity)}`)
    .join("\n");
}

/** Prefix a plain source block (string) with its citation tag — used for single-source
 *  blocks (entity roster, fleet packet) that don't go through the merger. */
function tagSourceBlock(source, text, ref) {
  if (!text) return "";
  return `${citationTag(source, ref)}\n${text}`;
}

module.exports = {
  INTENTS,
  classifyIntent,
  parseIntent,
  selectSources,
  SOURCE_MAP,
  wordSet,
  jaccard,
  toItems,
  mergeEvidence,
  citationTag,
  confidenceNote,
  renderEvidenceBlock,
  tagSourceBlock,
};
