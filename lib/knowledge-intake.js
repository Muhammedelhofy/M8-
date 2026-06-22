/**
 * lib/knowledge-intake.js — Build-27 Knowledge Acquisition Pipeline (Stages 1–5)
 *
 * Stages:
 *   1. ingestDocument()        — store raw text in m8_knowledge_sources
 *   2. extractConcepts()       — Gemini extracts claim/entity nodes per 2000-word chunk
 *   3. populateGraph()         — write approved nodes to m8_graph_nodes
 *   4. mastery state           — columns on m8_graph_nodes, advanced by later builds
 *   5. buildClarificationSummary() / approvePending() — human gate before graph write
 *
 * Honesty invariants:
 *   - source_class is set by Muhammad at ingest time; nodes inherit it; never upgraded here
 *   - kind='theorem' is NEVER created by ingestion; that requires Lean verification (Build-18)
 *   - speculative/fringe nodes enter the graph labelled; the novelty gate narrates the distinction
 */

"use strict";

const { createClient } = require("@supabase/supabase-js");
const { generate }     = require("./llm");
const { normLabel, smartTruncate, embedText,
        deriveEvidenceKind, confidenceFromExtraction, isMissingProvenanceColumn,
        addEdge, graphMatch } = require("./memory-graph");

// Build-42 (D3): the deterministic cosine threshold at which a proposed kernel is
// considered to MATCH an already-established node (reuse NOVELTY_SIM_MIN = 0.82).
const KERNEL_MATCH_SIM = 0.82;

const CHUNK_WORDS  = 2000;   // Vercel budget: ~30s per Gemini call on 2000 words
const MAX_CHUNKS   = 8;      // hard cap: 8 * 2000 = 16 000 words per ingest call
// Build-41 (D1): ONE neutral speculative bucket. 'fringe' was dropped (team verdict
// 4/5 — pejorative + a serious-vs-crackpot vibe-call the doctrine forbids). We still
// ACCEPT 'fringe' as a deprecated input alias and normalize it to 'speculative', so
// an old habit (or a not-yet-migrated reference) still ingests, just neutrally.
const VALID_CLASS  = new Set(["established", "speculative"]);
const VALID_CONF   = new Set(["high", "medium", "low"]);
const VALID_KIND   = new Set(["claim", "entity"]);  // document node created separately

// Map any incoming source_class to a canonical bucket (fringe → speculative).
// Returns null for anything not recognizable, so callers can prompt for it.
function normalizeSourceClass(c) {
  const v = String(c || "").trim().toLowerCase();
  if (v === "fringe") return "speculative";
  return VALID_CLASS.has(v) ? v : null;
}

// ─── Quota error detection + NotebookLM fallback ─────────────────────────────
/**
 * True when a Gemini API error is a quota/rate-limit refusal (HTTP 429 or
 * RESOURCE_EXHAUSTED). Used to distinguish "skip this chunk" (transient) from
 * "stop and surface a handoff" (quota won't recover within this invocation).
 * Pure function — mirrored by the PS ship-gate test.
 */
function isGeminiQuotaError(err) {
  const msg = String(err && (err.message || err) || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota_exceeded") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

/**
 * Formats a plain-English NotebookLM handoff message for the chat surface.
 * Shown when Gemini's extraction quota is exhausted so the user gets actionable
 * options instead of a silent "0 nodes extracted" dead-end.
 */
function buildNotebookLMHandoff({ source_id = null, title = "", source_class = "" }) {
  const stored = source_id
    ? ` Document stored (source_id ${source_id}) — checkpoints resume where it left off.`
    : "";
  const cls = source_class || "established";
  return [
    `KNOWLEDGE INGEST — Gemini quota exhausted${title ? ` for "${title}"` : ""}.`,
    `Extraction failed: free Gemini daily quota is full (HTTP 429 / RESOURCE_EXHAUSTED).${stored}`,
    ``,
    `OPTIONS:`,
    `  1. Wait ~24 h for the free quota to reset, then re-send the same "ingest this as a book" request.`,
    `     Checkpoints are saved — chapters already processed will be skipped on retry.`,
    ``,
    `  2. For heavy PDF books (Arabic scans, large files), use NotebookLM instead:`,
    `     → Open notebooklm.google.com`,
    `     → Upload the PDF — Google handles OCR + retrieval + citations free, no Gemini quota.`,
    `     → NotebookLM has no public embed API, so use it standalone alongside M8.`,
    ``,
    `  3. Fix the key/project mismatch (most likely root cause of the 429):`,
    `     → AI Studio → top-left project selector → switch to "M8 Agent" project`,
    `     → Generate a NEW key inside that project → set it as GEMINI_API_KEY in Vercel env.`,
    `     The billed account won't help if the key belongs to a different free-tier project.`,
    ``,
    `Your response to Boss MUST say:`,
    `"Gemini quota exhausted${title ? ` for '${title}'` : ""}. Document is stored${source_id ? ` (source_id ${source_id})` : ""}. ` +
    `Options: (1) retry in ~24h — checkpoints resume; (2) NotebookLM for heavy PDFs; ` +
    `(3) fix GEMINI_API_KEY project in Vercel env."`,
  ].join("\n");
}

// ─── Supabase client ─────────────────────────────────────────────────────────
function getDb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// ─── Stage 1: Raw ingestion ───────────────────────────────────────────────────
/**
 * Store a document in m8_knowledge_sources before any processing.
 * Returns { source_id, preview, word_count }.
 * Throws if source_class is missing or invalid — Muhammad must supply it.
 */
async function ingestDocument({ title, text, source_url = null, source_class, notes = null }) {
  if (!title || !text) throw new Error("title and text are required");
  source_class = normalizeSourceClass(source_class);   // fringe → speculative; unknown → null
  if (!source_class) {
    throw new Error(
      `source_class must be 'established' or 'speculative' — could not classify the input. ` +
      "Please specify which applies to this document before ingesting."
    );
  }
  const word_count = text.trim().split(/\s+/).length;
  const { data, error } = await getDb()
    .from("m8_knowledge_sources")
    .insert({ title, raw_text: text, source_url, source_class, word_count, notes })
    .select("id")
    .single();
  if (error) throw new Error(`ingestDocument failed: ${error.message}`);
  return { source_id: data.id, preview: text.slice(0, 200).trim(), word_count };
}

// ─── Chunking ─────────────────────────────────────────────────────────────────
function chunkText(text) {
  const words  = text.trim().split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length && chunks.length < MAX_CHUNKS; i += CHUNK_WORDS) {
    chunks.push(words.slice(i, i + CHUNK_WORDS).join(" "));
  }
  return chunks;
}

// ─── Extraction prompt ────────────────────────────────────────────────────────
const EXTRACTION_SYSTEM = `You are a precise mathematical knowledge extractor.
Extract ONLY factual claims and named entities explicitly stated in the text.
Do NOT invent, infer, or speculate beyond what the text states.
Output strictly valid JSON — no prose, no markdown fences.`;

function buildExtractionPrompt(chunk, title, chunkIndex) {
  return `Document: "${title}" (chunk ${chunkIndex + 1})

TEXT:
${chunk}

Extract up to 8 items (claims or named entities) from this text chunk.
Return a JSON array. Each item must have:
  - "node_type": "claim" | "entity"
  - "label": short name/title (max 80 chars, never cut mid-number)
  - "content": the full statement or definition as it appears in the text (max 300 chars)
  - "confidence": "high" | "medium" | "low"
      high   = explicitly stated, unambiguous
      medium = paraphrased or partially inferred from context
      low    = uncertain, speculative within the text itself

Only extract items EXPLICITLY present in the text above.
If fewer than 8 items are present, return fewer — never pad.

Output format (JSON array, no other text):
[{"node_type":"claim","label":"...","content":"...","confidence":"high"}, ...]`;
}

// ─── General (non-math) extraction prompt (B-gen-extract) ────────────────────
// The graph had 0 book nodes because the ONLY extractor was math-specific, so
// Islamic-history / biography / general prose correctly returned 0 candidates.
// This second prompt pulls facts/events/people/places/dates/rulings/concepts so
// a source_class=established book yields real nodes. The math path is untouched;
// the mode router (selectExtractionSystem + deriveExtractionMode) picks between
// the two. General is the default so uploaded books extract; math is opt-in.
const GENERAL_EXTRACTION_SYSTEM = `You are a precise knowledge extractor.
Extract key facts, claims, events, people, places, dates, and concepts from the text.

For each item return a JSON object:
  label   — short identifier, 3-7 words, snake_case
  content — the specific claim or fact, 1-3 sentences, precise and self-contained
  type    — one of: fact | event | person | concept | place | date | ruling

Rules:
1. Only extract explicitly stated information — no inference or interpretation.
2. Each item must be self-contained and independently verifiable.
3. Skip vague, subjective, or purely narrative sentences.
4. For Islamic/historical content: prioritise events, dates, scholarly rulings,
   hadith citations, Quranic references, and named individuals.
5. Return ONLY a valid JSON array. No markdown, no prose.

Output: [{"label":"...","content":"...","type":"..."},...]`;

// PURE: choose the system prompt for an extraction mode. Only the explicit
// 'math' mode uses the mathematical extractor; everything else (incl. undefined)
// uses the general one — general is the default. Mirrored by the PS ship-gate.
function selectExtractionSystem(mode) {
  return mode === "math" ? EXTRACTION_SYSTEM : GENERAL_EXTRACTION_SYSTEM;
}

// User-facing prompt paired with GENERAL_EXTRACTION_SYSTEM. Mirrors
// buildExtractionPrompt's framing but asks for the {label,content,type} shape.
function buildGeneralExtractionPrompt(chunk, title, chunkIndex) {
  return `Document: "${title}" (chunk ${chunkIndex + 1})

TEXT:
${chunk}

Extract up to 10 key items (facts, events, people, places, dates, rulings, concepts)
EXPLICITLY stated in this text chunk, following the system rules. If fewer than 10
are present, return fewer — never pad.

Output format (JSON array, no other text):
[{"label":"...","content":"...","type":"..."}, ...]`;
}

// PURE: map a general 'type' onto one of the two JS-valid graph kinds
// (VALID_KIND = claim|entity). m8_graph_nodes has NO 'type'/'node_type' column
// (verified against information_schema 2026-06-22), so the original type is used
// ONLY to choose claim vs entity, then dropped — schema-free. Named things
// (person/place/concept) → entity; statements (fact/event/date/ruling/…) → claim.
// Mirrored by the PS ship-gate.
function generalTypeToKind(type) {
  const t = String(type || "").trim().toLowerCase();
  if (t === "person" || t === "place" || t === "concept") return "entity";
  return "claim";
}

// PURE: derive the extraction mode. An explicit 'math'/'general' wins; else a
// 'mathematical' source_class implies math; everything else (established,
// speculative, …) → general. Mirrored by the PS ship-gate.
function deriveExtractionMode(cls, explicitMode) {
  const m = String(explicitMode || "").trim().toLowerCase();
  if (m === "math") return "math";
  if (m === "general") return "general";
  return cls === "mathematical" ? "math" : "general";
}

// gen-extract option 3: extraction prefers FREE, recitation-free providers first.
// Gemini refuses famous religious/classical text (RECITATION -> "no text"), so for
// EXTRACTION it is demoted below groq/cerebras (it stays as a fallback for general
// content if the free non-Gemini providers are momentarily rate-limited). This is
// 100% free stack — NO paid providers (openai/grok deliberately excluded). Override
// via env M8_EXTRACT_PROVIDER_ORDER (comma list) without a code change.
const EXTRACT_PROVIDER_ORDER = process.env.M8_EXTRACT_PROVIDER_ORDER ||
  "groq,cerebras,gemini,gemini2,openrouter,mistral";

// ─── Parse Gemini output ──────────────────────────────────────────────────────
// `mode` selects the accepted shape (both modes EMIT the same candidate shape, so
// populateGraph / pending / dedup downstream are unchanged):
//   'math' (default) — strict {node_type∈claim|entity, label, content, confidence∈high|medium|low}
//   'general'        — {label, content, type?}; type→kind via generalTypeToKind,
//                      confidence defaults 'high' (general prompt omits it). The
//                      'type' field is dropped — m8_graph_nodes has no type column.
// Loosely extract a JSON array from an LLM reply: handles clean output, ```json
// fences, AND an array wrapped in stray prose (some providers ignore "JSON only"
// and prepend a sentence). Returns the array or null. THIS IS THE FIX for silent
// 0-extractions: when Gemini returns empty (2.5 thinking) the chain falls back to
// another provider whose prose-wrapped array was being discarded by a strict
// JSON.parse. Mirrors parseDecomposition's salvage approach.
function parseJsonArrayLoose(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { const a = JSON.parse(s); if (Array.isArray(a)) return a; } catch { /* salvage below */ }
  const start = s.indexOf("[");
  const end   = s.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try { const a = JSON.parse(s.slice(start, end + 1)); if (Array.isArray(a)) return a; } catch { /* give up */ }
  }
  return null;
}

function parseExtractionOutput(raw, source_class, source_doc_id, mode = "math") {
  if (!raw) return [];
  const arr = parseJsonArrayLoose(raw);
  if (!arr) return [];
  try {
    if (mode === "general") {
      return arr
        .filter(item =>
          item &&
          typeof item.label === "string" && item.label.trim()
        )
        .map(item => ({
          node_type:             generalTypeToKind(item.type),
          label:                 item.label.trim().slice(0, 120),
          content:               String(item.content || item.label).slice(0, 300),
          // General prompt omits confidence; an explicitly-stated fact defaults to
          // 'high' so it is written immediately. A model-supplied valid confidence
          // (high|medium|low) is still respected.
          extraction_confidence: VALID_CONF.has(item.confidence) ? item.confidence : "high",
          source_class,
          source_doc_id,
        }));
    }

    return arr
      .filter(item =>
        item &&
        VALID_KIND.has(item.node_type) &&
        typeof item.label === "string" && item.label.trim() &&
        VALID_CONF.has(item.confidence)
      )
      .map(item => ({
        node_type:             item.node_type,
        label:                 item.label.trim().slice(0, 120),
        content:               String(item.content || item.label).slice(0, 300),
        extraction_confidence: item.confidence,
        source_class,
        source_doc_id,
      }));
  } catch {
    return [];
  }
}

// ─── Stage 2: Concept extraction ─────────────────────────────────────────────
/**
 * Reads raw_text from m8_knowledge_sources[source_id], runs Gemini extraction
 * in 2000-word chunks, returns deduplicated candidate node array.
 */
async function extractConcepts(source_id, mode = "general") {
  const { data: src, error } = await getDb()
    .from("m8_knowledge_sources")
    .select("raw_text, source_class, title")
    .eq("id", source_id)
    .single();
  if (error || !src) throw new Error(`Source ${source_id} not found`);

  const systemInstruction = selectExtractionSystem(mode);
  const buildPrompt = mode === "math" ? buildExtractionPrompt : buildGeneralExtractionPrompt;

  const chunks = chunkText(src.raw_text);
  const allCandidates = [];

  for (const [i, chunk] of chunks.entries()) {
    let raw;
    try {
      raw = await generate({
        systemInstruction,
        contents: [{ role: "user", parts: [{ text: buildPrompt(chunk, src.title, i) }] }],
        genConfig: { temperature: 0, maxOutputTokens: 2048 },
        providerOrder: EXTRACT_PROVIDER_ORDER,
      });
    } catch (e) {
      // A failed chunk is skipped, not fatal
      continue;
    }
    const candidates = parseExtractionOutput(raw, src.source_class, source_id, mode);
    allCandidates.push(...candidates);
  }

  // Dedup within the extracted set by (kind, norm_label)
  const seen = new Set();
  return allCandidates.filter(c => {
    const key = `${c.node_type}::${normLabel(c.label)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Like extractConcepts but returns { candidates, quota_exhausted } instead of
 * a plain array. Used by the chat paths (buildKnowledgeIngestContext,
 * ingestBookText) so they can surface a NotebookLM handoff message when
 * Gemini's free-tier daily quota is full — rather than silently returning 0 nodes.
 * The original extractConcepts() is UNCHANGED to keep existing API callers working.
 */
async function extractConceptsWithStatus(source_id, mode = "general") {
  const { data: src, error } = await getDb()
    .from("m8_knowledge_sources")
    .select("raw_text, source_class, title")
    .eq("id", source_id)
    .single();
  if (error || !src) throw new Error(`Source ${source_id} not found`);

  const systemInstruction = selectExtractionSystem(mode);
  const buildPrompt = mode === "math" ? buildExtractionPrompt : buildGeneralExtractionPrompt;

  const chunks = chunkText(src.raw_text);
  const allCandidates = [];
  let quota_exhausted = false;
  // Diagnostics so a 0-result is never a silent dead-end (Vercel logs are blind to
  // this path). lastError = the most recent provider throw; lastEmptyParse = a
  // sample when the LLM returned text but 0 items parsed (provider/parse mismatch).
  let lastError = null;
  let lastEmptyParse = null;

  for (const [i, chunk] of chunks.entries()) {
    let raw;
    try {
      raw = await generate({
        systemInstruction,
        contents: [{ role: "user", parts: [{ text: buildPrompt(chunk, src.title, i) }] }],
        genConfig: { temperature: 0, maxOutputTokens: 2048 },
        providerOrder: EXTRACT_PROVIDER_ORDER,
      });
    } catch (e) {
      lastError = String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 240);
      if (isGeminiQuotaError(e)) {
        quota_exhausted = true;
        break;   // quota won't recover in this invocation — stop trying more chunks
      }
      continue; // non-quota error: skip this chunk, try the next
    }
    const candidates = parseExtractionOutput(raw, src.source_class, source_id, mode);
    if (candidates.length === 0 && raw) {
      lastEmptyParse = `LLM returned ${String(raw).length} chars, 0 items parsed: ` +
        String(raw).replace(/\s+/g, " ").slice(0, 180);
    }
    allCandidates.push(...candidates);
  }

  // Dedup by (kind, norm_label) — same as extractConcepts
  const seen = new Set();
  const deduped = allCandidates.filter(c => {
    const key = `${c.node_type}::${normLabel(c.label)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Only surface a debug reason when nothing was extracted — otherwise null.
  const debug = deduped.length > 0
    ? null
    : (lastError ? `extractor error: ${lastError}`
       : lastEmptyParse ? lastEmptyParse
       : "0 candidates (no LLM error and no text returned)");

  return { candidates: deduped, quota_exhausted, debug };
}

// ─── Stage 3: Populate graph ──────────────────────────────────────────────────
/**
 * Writes approved candidate nodes to m8_graph_nodes.
 * Skips nodes whose (kind, norm_label) already exist — idempotent.
 * Returns { added, skipped }.
 */
async function populateGraph(candidates) {
  const db = getDb();
  let added = 0, skipped = 0;

  for (const c of candidates) {
    const nl = normLabel(c.label);

    // Dedup check against existing graph
    const { data: existing } = await db
      .from("m8_graph_nodes")
      .select("id")
      .eq("kind", c.node_type)
      .eq("norm_label", nl)
      .maybeSingle();
    if (existing) { skipped++; continue; }

    // Embed for cosine recall — non-blocking (null on failure)
    let embedding = null;
    try {
      const vec = await embedText(c.content || c.label, "RETRIEVAL_DOCUMENT");
      if (vec) embedding = JSON.stringify(vec);
    } catch { /* skip */ }

    const row = {
      kind:                 c.node_type,
      label:                smartTruncate(c.label, 120),
      norm_label:           nl,
      content:              c.content,
      source:               "external",
      source_class:         c.source_class,
      source_doc_id:        c.source_doc_id,
      extraction_confidence: c.extraction_confidence,
      mastery_state:        "ingested",
      embedding,
      metadata:             { build: "27" },
      // Build-38: universal provenance. evidence_kind by node type; confidence from
      // the per-claim extraction confidence (truer than the external blanket); an
      // ingested claim is NEVER pre-verified — verification_state starts 'unverified'
      // (only Lean can advance it later — honesty contract carried from Build-27).
      evidence_kind:        deriveEvidenceKind(c.node_type),
      confidence:           confidenceFromExtraction(c.extraction_confidence) ?? 0.6,
      verification_state:   "unverified",
    };
    let { error } = await db.from("m8_graph_nodes").insert(row);
    if (error && isMissingProvenanceColumn(error)) {        // pre-migration safety
      const { evidence_kind, confidence, verification_state, ...legacy } = row;
      ({ error } = await db.from("m8_graph_nodes").insert(legacy));
    }
    if (!error) added++;
  }
  return { added, skipped };
}

// ─── Stage 5: Clarification gate ─────────────────────────────────────────────
/**
 * Groups candidates by confidence and returns a human-readable summary.
 * Muhammad approves before any nodes enter the graph.
 */
function buildClarificationSummary(candidates, title) {
  const high   = candidates.filter(c => c.extraction_confidence === "high");
  const medium = candidates.filter(c => c.extraction_confidence === "medium");
  const low    = candidates.filter(c => c.extraction_confidence === "low");

  const lines = [
    `Extracted ${candidates.length} candidate nodes from "${title}":`,
    `  • ${high.length} high-confidence → ready to add`,
    `  • ${medium.length} medium-confidence → review recommended`,
    `  • ${low.length} low-confidence → HOLD (needs your call)`,
    "",
  ];

  if (medium.length > 0) {
    lines.push("Medium-confidence nodes:");
    medium.forEach(c => lines.push(`  [${c.node_type}] ${c.label}`));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Save medium/low candidates to pending_nodes for later review.
 * Called after Muhammad approves the high-confidence nodes.
 */
async function savePendingNodes(source_id, candidates) {
  const pending = candidates.filter(c => c.extraction_confidence !== "high");
  if (!pending.length) return;
  const { error } = await getDb()
    .from("m8_knowledge_sources")
    .update({ pending_nodes: pending })
    .eq("id", source_id);
  if (error) throw new Error(`savePendingNodes failed: ${error.message}`);
}

/**
 * Retrieve and populate pending nodes on Muhammad's approval.
 */
async function approvePending(source_id, includeLevel = "medium") {
  const { data: src, error } = await getDb()
    .from("m8_knowledge_sources")
    .select("pending_nodes, title")
    .eq("id", source_id)
    .single();
  if (error || !src) throw new Error(`Source ${source_id} not found`);
  const levels = includeLevel === "all" ? ["medium", "low"] : ["medium"];
  const toAdd  = (src.pending_nodes || []).filter(c => levels.includes(c.extraction_confidence));
  if (!toAdd.length) return { added: 0, skipped: 0, message: "No pending nodes at that level." };
  const result = await populateGraph(toAdd);
  // Clear approved ones from pending_nodes
  const remaining = (src.pending_nodes || []).filter(c => !levels.includes(c.extraction_confidence));
  await getDb()
    .from("m8_knowledge_sources")
    .update({ pending_nodes: remaining })
    .eq("id", source_id);
  return { ...result, message: `Added ${result.added} pending nodes from "${src.title}".` };
}

// ─── Build-42 (D3): Kernel/Leap decomposition ────────────────────────────────
// A speculative idea is split into a TRUE KERNEL (established core) and a
// SPECULATIVE LEAP (the extension built on it), written as two nodes linked
// leap --derived_from--> kernel (metadata.decomposition='leap_of_kernel'). The
// split is HUMAN-GATED: a Gemini pass PROPOSES it at ingest; nothing is written
// until approveDecomposition() runs. M8 never autonomously confers 'established'
// standing — the kernel is established only by matching an already-established
// node (deterministic >= KERNEL_MATCH_SIM) or by an explicit approval flag.

const DECOMP_SYSTEM = `You decompose ONE speculative idea into its two honest parts, for a research memory graph that must never launder speculation as established fact.

Split the idea into:
  - "kernel": the part that is TRUE / established / real arithmetic or physics INDEPENDENT of the speculative framing (e.g. "the digital root of a number cycles mod 9" — real arithmetic).
  - "leap": the SPECULATIVE claim the source builds ON TOP of that kernel (e.g. "...therefore numbers encode the energy-geometry of reality").

OUTPUT CONTRACT — exactly one JSON object, no markdown fences, no prose:
{"kernel":{"label":"<=80 chars","content":"<=300 chars"},"leap":{"label":"<=80 chars","content":"<=300 chars"}}

RULES:
1. The kernel must be a self-contained, checkable statement that stands WITHOUT the speculative leap. If you cannot isolate a genuinely established core, output exactly: null
2. The leap is the speculative claim ONLY — never restate it as proven or established.
3. Extract ONLY what the text supports; invent nothing.
4. When unsure whether a core is truly established, output null — a missing decomposition is better than a fabricated "established" kernel.`;

/** Parse + validate a decomposition proposal. Off-schema / "null" → null. Never throws. */
function parseDecomposition(raw) {
  try {
    let s = String(raw || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    if (/^null$/i.test(s)) return null;
    const start = s.indexOf("{"); const end = s.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(s.slice(start, end + 1));
    const okPart = (p) => p && typeof p.label === "string" && p.label.trim().length >= 3
      && typeof p.content === "string" && p.content.trim().length >= 3;
    if (!okPart(obj.kernel) || !okPart(obj.leap)) return null;
    return {
      kernel: { label: obj.kernel.label.trim().slice(0, 120), content: obj.kernel.content.trim().slice(0, 300) },
      leap:   { label: obj.leap.label.trim().slice(0, 120),   content: obj.leap.content.trim().slice(0, 300) },
    };
  } catch { return null; }
}

/** Gemini proposes a kernel/leap split for a speculative doc. Fail-safe → null. */
async function proposeDecomposition(title, text) {
  try {
    const raw = await generate({
      systemInstruction: DECOMP_SYSTEM,
      contents: [{ role: "user", parts: [{ text: `Document: "${title}"\n\nTEXT:\n${String(text || "").slice(0, 4000)}\n\nOutput the JSON object (or null) now.` }] }],
      genConfig: { temperature: 0, maxOutputTokens: 400 },
    });
    return parseDecomposition(raw);
  } catch (e) {
    console.error("[M8] proposeDecomposition error (non-fatal):", e.message);
    return null;
  }
}

/**
 * PURE standing predicate (mirrored by tests/kernel-leap-verify.ps1):
 *   - an established match at/above the threshold  -> 'use-existing' (link to it)
 *   - else an explicit human "this kernel is established" flag -> 'established' (mint)
 *   - else                                                     -> 'speculative' (mint; honest default)
 */
function resolveKernelStanding(matchSim, matchIsEstablished, kernelEstablishedFlag) {
  if (matchIsEstablished && typeof matchSim === "number" && matchSim >= KERNEL_MATCH_SIM) return "use-existing";
  if (kernelEstablishedFlag) return "established";
  return "speculative";
}

// True if a graph-match hit already carries ESTABLISHED standing (so a kernel may
// link to it): explicit established source_class, OR a curated M2 literature seed
// (source external, no source_class), OR a lean-proven theorem.
function isEstablishedNode(n) {
  if (!n) return false;
  if (n.source_class === "established") return true;
  if (n.source === "external" && !n.source_class) return true;   // M2 curated seed
  if (n.verification_state === "proven") return true;
  return false;
}

// Direct insert of a source_class-bearing node (mirrors populateGraph's row shape).
// source_class is written ONLY here in the intake path — never via upsertNode —
// preserving rule (3): the generator can never mint a speculative/established node.
async function insertClassNode({ label, content, source_class, source_doc_id }) {
  const db = getDb();
  const nl = normLabel(label);
  const { data: existing } = await db.from("m8_graph_nodes")
    .select("id").eq("kind", "claim").eq("norm_label", nl).maybeSingle();
  if (existing) return existing.id;     // idempotent — reuse
  let embedding = null;
  try { const vec = await embedText(content || label, "RETRIEVAL_DOCUMENT"); if (vec) embedding = JSON.stringify(vec); } catch { /* skip */ }
  const row = {
    kind: "claim", label: smartTruncate(label, 120), norm_label: nl, content,
    source: "external", source_class, source_doc_id,
    mastery_state: "ingested", embedding, metadata: { build: "42", decomposition_part: true },
    evidence_kind: deriveEvidenceKind("claim"), confidence: 0.6, verification_state: "unverified",
  };
  let { data, error } = await db.from("m8_graph_nodes").insert(row).select("id").single();
  if (error && isMissingProvenanceColumn(error)) {
    const { evidence_kind, confidence, verification_state, ...legacy } = row;
    ({ data, error } = await db.from("m8_graph_nodes").insert(legacy).select("id").single());
  }
  if (error) { console.error("[M8] insertClassNode error:", error.message); return null; }
  return data.id;
}

/**
 * Write an approved kernel/leap decomposition. The leap is always speculative;
 * the kernel is matched-or-minted per resolveKernelStanding. Adds the
 * leap --derived_from--> kernel edge (metadata.decomposition='leap_of_kernel').
 * Returns { ok, leapId, kernelId, kernelStanding } or { ok:false, message }.
 */
async function approveDecomposition(source_id, { kernelEstablished = false } = {}) {
  const db = getDb();
  const { data: src } = await db.from("m8_knowledge_sources")
    .select("pending_decomposition, title").eq("id", source_id).maybeSingle();
  const dec = src && src.pending_decomposition;
  if (!dec || !dec.kernel || !dec.leap) {
    return { ok: false, message: `No pending decomposition for source ${source_id}.` };
  }

  // Leap node — always speculative.
  const leapId = await insertClassNode({ label: dec.leap.label, content: dec.leap.content, source_class: "speculative", source_doc_id: source_id });

  // Kernel — match an already-established node, else mint per the standing rule.
  let kernelId = null, kernelStanding = "speculative";
  const hits = await graphMatch(dec.kernel.content || dec.kernel.label, { k: 6, minSimilarity: 0.5 });
  const establishedHit = (hits || []).find(isEstablishedNode);
  const standing = resolveKernelStanding(establishedHit && establishedHit.similarity, !!establishedHit, kernelEstablished);
  if (standing === "use-existing") {
    kernelId = establishedHit.id; kernelStanding = "established (linked to existing node)";
  } else {
    kernelId = await insertClassNode({ label: dec.kernel.label, content: dec.kernel.content, source_class: standing, source_doc_id: source_id });
    kernelStanding = standing;
  }

  if (leapId && kernelId && leapId !== kernelId) {
    await addEdge({ srcId: leapId, dstId: kernelId, rel: "derived_from", metadata: { decomposition: "leap_of_kernel" } });
  }
  await db.from("m8_knowledge_sources").update({ pending_decomposition: null }).eq("id", source_id);
  return { ok: true, leapId, kernelId, kernelStanding };
}

// ─── Novelty gate passthrough: source_class annotation ───────────────────────
/**
 * Given a matched node id from the novelty gate, fetch its source_class.
 * Used by seed-pack.js to narrate "matches an established result" vs
 * "matches a speculative claim" — the gate itself is unchanged.
 */
async function fetchNodeSourceClass(node_id) {
  const { data } = await getDb()
    .from("m8_graph_nodes")
    .select("source_class")
    .eq("id", node_id)
    .maybeSingle();
  return data?.source_class ?? null;
}

/**
 * Build-28: batch version of fetchNodeSourceClass for graph recall packets —
 * one query for all matched node ids instead of N. Returns a Map of
 * id -> source_class, omitting ids with no source_class (i.e. M2 seed-pack
 * nodes, which were ingested before Build-27 and carry no classification).
 */
async function fetchSourceClasses(ids) {
  const uniq = [...new Set((ids || []).filter((id) => id !== null && id !== undefined))];
  if (!uniq.length) return new Map();
  const { data } = await getDb()
    .from("m8_graph_nodes")
    .select("id, source_class")
    .in("id", uniq);
  const map = new Map();
  for (const row of data || []) if (row.source_class) map.set(row.id, row.source_class);
  return map;
}

// ─── Detection + context builder (for orchestrator wiring) ───────────────────

const INGEST_RE = /\b(?:ingest|add\s+(?:this\s+)?(?:paper|document|text|article|result|source)|import\s+(?:this\s+)?(?:paper|document|text|article))\b/i;
const CLASS_RE  = /\b(established|speculative|fringe)\b/i;

/**
 * Returns true when the message is a document ingest request.
 * Conservative — false positives here would claim turns that belong to other lanes.
 */
function detectKnowledgeIngest(message) {
  const s = String(message || "").trim();
  if (s.length < 10) return false;
  return INGEST_RE.test(s);
}

/**
 * Parse source_class and raw text from the user's ingest message.
 * Format: "ingest this as established: [text]"
 *         "add this document — speculative — [text]"
 */
function parseIngestMessage(message) {
  const classMatch = CLASS_RE.exec(message);
  // CLASS_RE still matches the deprecated 'fringe' word so old phrasing parses;
  // normalizeSourceClass folds it to 'speculative'.
  const source_class = classMatch ? normalizeSourceClass(classMatch[1]) : null;

  // text = everything after the source_class keyword (and any trailing punctuation)
  let raw_text = message;
  if (classMatch) {
    const afterClass = message.slice(classMatch.index + classMatch[0].length).replace(/^[\s:—\-–]+/, "");
    if (afterClass.length > 20) raw_text = afterClass;
  } else {
    // Strip the ingest verb phrase from the front
    raw_text = message.replace(INGEST_RE, "").replace(/^[\s:—\-–asAs]+/, "").trim();
  }

  // Title: first sentence (up to 100 chars) of the raw text
  const firstSentence = raw_text.split(/[.!?\n]/)[0].trim();
  const spaceIdx = firstSentence.lastIndexOf(' ', 100);
  const cutAt = firstSentence.length > 100 ? (spaceIdx > 0 ? spaceIdx : 100) : firstSentence.length;
  const title = cutAt > 8 ? firstSentence.slice(0, cutAt) : "Untitled document";

  return { source_class, raw_text: raw_text.trim(), title };
}

const KNOWLEDGE_INGEST_DIRECTIVE = `KNOWLEDGE INGEST — your response MUST start with this exact line (fill in the brackets):
"Ingested [title] as [source_class] (source_id [N]) — [X] nodes extracted, [H] written to graph, [P] pending review."
Then copy the CLARIFICATION SUMMARY below verbatim. Do NOT restate or paraphrase the document's content.
Attribute any claim to its source document. Pending nodes: "show me pending extractions" on a future turn.`;

/**
 * Full pipeline: detect → ingest → extract → write high-confidence nodes → return packet.
 * High-confidence nodes are written immediately.
 * Medium/low are saved to pending_nodes for later approval.
 * Returns { text: string, data: { source_id, added, skipped, pending_count } }
 */
async function buildKnowledgeIngestContext(message) {
  if (!detectKnowledgeIngest(message)) return { text: "", data: null };

  const { source_class, raw_text, title } = parseIngestMessage(message);

  // Guard: if source_class is missing, return a clarification request
  if (!source_class) {
    return {
      text: `KNOWLEDGE INGEST — source_class required before ingesting.\n\n` +
            `Please re-send with the classification: "ingest this as established/speculative: [text]"\n\n` +
            KNOWLEDGE_INGEST_DIRECTIVE,
      data: null,
    };
  }

  // Guard: too little text to extract from
  const wordCount = raw_text.trim().split(/\s+/).length;
  if (wordCount < 20) {
    return {
      text: `KNOWLEDGE INGEST — text too short (${wordCount} words). Please include the full text or abstract to ingest.\n\n` +
            KNOWLEDGE_INGEST_DIRECTIVE,
      data: null,
    };
  }

  let source_id, candidates, added = 0, skipped = 0, extractDebug = null;
  try {
    ({ source_id } = await ingestDocument({ title, text: raw_text, source_class }));
    const extracted = await extractConceptsWithStatus(source_id);
    candidates = extracted.candidates;
    extractDebug = extracted.debug;
    if (extracted.quota_exhausted) {
      return {
        text: buildNotebookLMHandoff({ source_id, title, source_class }),
        data: { source_id, added: 0, skipped: 0, pending_count: 0, quota_exhausted: true },
      };
    }
  } catch (e) {
    return { text: `KNOWLEDGE INGEST — pipeline error: ${e.message}`, data: null };
  }

  // 0-candidates: Gemini found nothing extractable (text too short or too dense).
  // Return a specific packet so M8 reports the count rather than paraphrasing the doc.
  if (!candidates.length) {
    return {
      text: [
        `KNOWLEDGE INGEST — 0 nodes extracted from "${title}" (source_id: ${source_id}, class: ${source_class}).`,
        `The text may be too short or too dense for the extractor to identify discrete claim/entity nodes.`,
        extractDebug ? `EXTRACTOR DIAGNOSTIC (why 0): ${extractDebug}` : ``,
        `Document is stored and can be queried later. Your response MUST say:`,
        `"Ingested '${title}' as ${source_class} (source_id ${source_id}) — 0 nodes extracted.`,
        ` The document is stored. Re-ingest with a longer excerpt to extract nodes."`,
        `DO NOT restate the document content. Report the zero count explicitly.`,
      ].filter(Boolean).join("\n"),
      data: { source_id, added: 0, skipped: 0, pending_count: 0, extract_debug: extractDebug },
    };
  }

  const summary = buildClarificationSummary(candidates, title);

  // Write high-confidence nodes immediately; save the rest as pending
  const highConf = candidates.filter(c => c.extraction_confidence === "high");
  if (highConf.length) {
    try {
      const result = await populateGraph(highConf);
      added   = result.added;
      skipped = result.skipped;
    } catch { /* non-fatal — summary still returned */ }
  }
  try { await savePendingNodes(source_id, candidates); } catch { /* non-fatal */ }

  // Build-42 (D3): for a SPECULATIVE doc, propose a kernel/leap split and STAGE it
  // (human-gated — nothing written until "approve decomposition"). Non-fatal: a null
  // proposal (no separable established core) simply omits the block.
  let decompBlock = "";
  if (source_class === "speculative") {
    try {
      const dec = await proposeDecomposition(title, raw_text);
      if (dec) {
        await getDb().from("m8_knowledge_sources").update({ pending_decomposition: dec }).eq("id", source_id);
        decompBlock = [
          ``,
          `KERNEL/LEAP PROPOSAL (staged, NOT written — speculative idea split into its honest parts):`,
          `  • KERNEL (the established core, if approved): ${dec.kernel.label}`,
          `  • LEAP (the speculative extension — stays speculative): ${dec.leap.label}`,
          `Tell Boss this split is PROPOSED and awaiting his approval; it writes nothing yet. To accept: "approve decomposition ${source_id}". The leap is recorded speculative; the kernel becomes established ONLY if it matches an already-established node or Boss confirms it. Do NOT present the kernel as established yet.`,
        ].join("\n");
      }
    } catch (e) { console.error("[M8] decomposition staging (non-fatal):", e.message); }
  }

  const pending_count = candidates.filter(c => c.extraction_confidence !== "high").length;

  // Pre-fill the required response line so the model copies it rather than composing from scratch.
  const requiredLine = `Ingested "${title}" as ${source_class} (source_id ${source_id}) — ` +
    `${candidates.length} nodes extracted, ${added} written to graph` +
    (pending_count > 0 ? `, ${pending_count} pending your review.` : `.`);

  const packet = [
    `KNOWLEDGE INGEST RESULT — your response MUST start with this exact line:`,
    `"${requiredLine}"`,
    ``,
    `Then copy the CLARIFICATION SUMMARY below. Do NOT restate the document content.`,
    ``,
    summary,
    ``,
    pending_count > 0
      ? `Pending nodes can be reviewed: "show me pending extractions".`
      : `No pending nodes — all candidates were high-confidence and written immediately.`,
    decompBlock,
  ].join("\n");

  return { text: packet, data: { source_id, added, skipped, pending_count, decomposition: !!decompBlock } };
}

// ─── Build-77: Resumable ingestion checkpoints ───────────────────────────────
// A book is ingested chapter-by-chapter; Vercel kills the function at the
// wall-clock limit, so large books never finish in one invocation. These
// helpers record progress at chapter granularity so a re-ingest SKIPS finished
// chapters and RESUMES the rest. The central correctness rule: a chapter is
// marked 'done' ONLY after its nodes are committed to the graph — never merely
// because a source row exists (that row is written before extraction runs).

const CHECKPOINT_TABLE = "m8_ingest_checkpoints";

// True when the error means the checkpoint table has not been created yet
// (migration not applied). Lets every checkpoint call degrade gracefully to the
// legacy title-based dedup so the endpoint keeps working before the migration.
function isMissingCheckpointTable(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;                 // undefined_table
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find the table") ||
         msg.includes("schema cache");
}

/**
 * PURE: which chapter indices to process this invocation.
 * Skips chapters already marked done; bounds the batch to maxPerInvocation so a
 * single invocation returns a "continue" signal instead of timing out.
 * Mirrored by tests/B77-ingest-resume-verify.ps1.
 */
function chaptersToProcess(totalChapters, doneIndices, maxPerInvocation) {
  const done = new Set(doneIndices || []);
  const cap  = Math.max(1, maxPerInvocation || 1);
  const todo = [];
  for (let i = 0; i < totalChapters && todo.length < cap; i++) {
    if (!done.has(i)) todo.push(i);
  }
  return todo;
}

/**
 * PURE: overall ingest progress for a book given its done-chapter count.
 * `complete` drives the response's done flag and the inventory `resumable` flag.
 * Mirrored by tests/B77-ingest-resume-verify.ps1.
 */
function ingestProgress(totalChapters, doneCount) {
  const total = Math.max(0, totalChapters || 0);
  const done  = Math.min(Math.max(0, doneCount || 0), total);
  return {
    chapters_total: total,
    chapters_done:  done,
    chapters_remaining: Math.max(0, total - done),
    complete: total > 0 && done >= total,
  };
}

/**
 * Load checkpoint rows for a book as a Map keyed by chapter_index.
 * Returns null (NOT an empty Map) when the table is missing, so callers can tell
 * "no checkpoints yet" (Map) apart from "checkpointing unavailable" (null) and
 * fall back to the legacy title-based dedup.
 */
async function loadCheckpoints(book_title) {
  const { data, error } = await getDb()
    .from(CHECKPOINT_TABLE)
    .select("chapter_index, chapter_title, source_id, status, nodes_added, nodes_pending, total_chapters")
    .eq("book_title", book_title);
  if (error) {
    if (isMissingCheckpointTable(error)) return null;
    throw new Error(`loadCheckpoints failed: ${error.message}`);
  }
  const map = new Map();
  for (const row of data || []) map.set(row.chapter_index, row);
  return map;
}

/**
 * Upsert a chapter checkpoint. Returns true on success, false if the table is
 * missing (so the caller knows checkpointing is unavailable and continues with
 * the legacy path). Never throws on the missing-table case.
 */
async function saveCheckpoint(row) {
  const payload = {
    book_title:     row.book_title,
    chapter_index:  row.chapter_index,
    chapter_title:  row.chapter_title || null,
    source_id:      row.source_id || null,
    status:         row.status || "pending",
    nodes_added:    row.nodes_added || 0,
    nodes_pending:  row.nodes_pending || 0,
    total_chapters: row.total_chapters || null,
    updated_at:     new Date().toISOString(),
  };
  const { error } = await getDb()
    .from(CHECKPOINT_TABLE)
    .upsert(payload, { onConflict: "book_title,chapter_index" });
  if (error) {
    if (isMissingCheckpointTable(error)) return false;
    throw new Error(`saveCheckpoint failed: ${error.message}`);
  }
  return true;
}

// ─── Build-78: full-book ingest engine (shared by api/ingest-book.js + chat) ──
// Moved here from api/ingest-book.js so the chat orchestrator can drive the SAME
// resumable/idempotent/checkpointed ingest a user gets from the HTTP endpoint —
// no more single-shot 16K-word truncation for an uploaded book.

const BOOK_BATCH_WORDS = 12000;   // words/batch when no chapter headers are found
const BOOK_CHAPTER_RE  = /^(?:chapter|part|section|book)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+)\b|^(?:الجزء|الباب|الفصل|القسم|الكتاب|المقدمة|الخاتمة|ذكر|بيان|فصل|باب)\s*(?:\d+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[٠-٩]+)?/im;

// Bound chapters per invocation so a chat turn (or HTTP call) returns a resume
// signal instead of timing out. env M8_INGEST_MAX_CHAPTERS, clamp [1..50].
const BOOK_MAX_CHAPTERS = Math.min(50, Math.max(1, parseInt(process.env.M8_INGEST_MAX_CHAPTERS, 10) || 6));
const BOOK_TIMEOUT_GUARD_MS = 8000;
const BOOK_VERCEL_MAX_MS    = parseInt(process.env.VERCEL_MAX_DURATION_MS, 10) || 55000;

/** Split text on chapter headers; fall back to fixed word batches. Returns [{title,text}]. */
function splitIntoChapters(fullText) {
  const lines = fullText.split(/\r?\n/);
  const cuts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length > 2 && line.length < 120 && BOOK_CHAPTER_RE.test(line)) cuts.push({ lineIndex: i, heading: line });
  }
  if (cuts.length < 2) {
    const words = fullText.trim().split(/\s+/);
    const batches = [];
    for (let i = 0; i < words.length; i += BOOK_BATCH_WORDS) {
      batches.push({ title: `Batch ${batches.length + 1}`, text: words.slice(i, i + BOOK_BATCH_WORDS).join(" ") });
    }
    return batches;
  }
  const chapters = [];
  for (let c = 0; c < cuts.length; c++) {
    const start = cuts[c].lineIndex;
    const end   = c + 1 < cuts.length ? cuts[c + 1].lineIndex : lines.length;
    const text  = lines.slice(start, end).join("\n").trim();
    if (text.split(/\s+/).length >= 50) chapters.push({ title: cuts[c].heading, text });
  }
  if (cuts[0].lineIndex > 10) {
    const preamble = lines.slice(0, cuts[0].lineIndex).join("\n").trim();
    if (preamble.split(/\s+/).length >= 50) chapters.unshift({ title: "Preface / Introduction", text: preamble });
  }
  return chapters.length ? chapters : [{ title: "Full Text", text: fullText }];
}

// Reuse an existing chapter source row by exact title (so a chapter that died
// mid-extraction is not duplicated), else create one. populateGraph dedups nodes,
// so re-running extraction on a reused row tops up missing nodes without dups.
async function findOrCreateChapterSource(db, { chapterTitle, text, cls, notes }) {
  const { data: existing } = await db
    .from("m8_knowledge_sources").select("id").eq("title", chapterTitle).order("id", { ascending: true }).limit(1);
  if (existing && existing.length) return { source_id: existing[0].id, reused: true };
  const { source_id } = await ingestDocument({ title: chapterTitle, text, source_class: cls, notes: notes || null });
  return { source_id, reused: false };
}

/**
 * Full-book ingest: split into chapters, ingest each through the Stage 1-3
 * pipeline, checkpoint each chapter 'done' ONLY after its nodes commit, bounded
 * per invocation with a resume signal. cls must already be a valid bucket.
 * Returns the same shape api/ingest-book.js returns (done/resume/next_chapter/...).
 */
async function ingestBookText({ title, author = null, year = null, text, cls, notes = null, extraction_mode = null, maxChapters = BOOK_MAX_CHAPTERS }) {
  const db = getDb();
  // B-gen-extract: established/historical books extract in 'general' mode so they
  // yield real nodes; an explicit extraction_mode (or a 'mathematical' cls) forces
  // 'math'. Derived once and threaded to every chapter's extraction call below.
  const extractionMode = deriveExtractionMode(cls, extraction_mode);
  const wordCount = text.trim().split(/\s+/).length;
  const chapters = splitIntoChapters(text);
  const totalChapters = chapters.length;

  let checkpoints = null, checkpointing = false;
  try { checkpoints = await loadCheckpoints(title); checkpointing = checkpoints !== null; }
  catch (e) { console.error("[ingestBookText] loadCheckpoints (non-fatal):", e.message); }

  let legacyDoneTitles = new Set();
  if (!checkpointing) {
    try {
      const { data: existing } = await db.from("m8_knowledge_sources").select("title").like("title", `${title} — %`);
      legacyDoneTitles = new Set((existing || []).map((r) => r.title));
    } catch { /* non-fatal */ }
  }

  const doneIndices = [];
  for (let i = 0; i < chapters.length; i++) {
    const chapterTitle = `${title} — ${chapters[i].title}`;
    if (checkpointing) { const cp = checkpoints.get(i); if (cp && cp.status === "done") doneIndices.push(i); }
    else if (legacyDoneTitles.has(chapterTitle)) doneIndices.push(i);
  }

  const todo = chaptersToProcess(totalChapters, doneIndices, maxChapters);
  const results = [];
  let totalAdded = 0, totalPending = 0, processedThisRun = 0, timedOut = false;
  const startedAt = Date.now();
  const newlyDone = new Set(doneIndices);

  for (const i of todo) {
    if (Date.now() - startedAt > BOOK_VERCEL_MAX_MS - BOOK_TIMEOUT_GUARD_MS) { timedOut = true; break; }
    const ch = chapters[i];
    const chapterTitle = `${title} — ${ch.title}`;

    if (checkpointing) {
      try { await saveCheckpoint({ book_title: title, chapter_index: i, chapter_title: ch.title, status: "pending", total_chapters: totalChapters }); }
      catch (e) { console.error("[ingestBookText] checkpoint pending (non-fatal):", e.message); }
    }

    let source_id;
    try { ({ source_id } = await findOrCreateChapterSource(db, { chapterTitle, text: ch.text, cls, notes })); }
    catch (e) { results.push({ chapter: ch.title, error: e.message }); continue; }

    try {
      await db.from("m8_knowledge_sources").update({
        metadata: { book_title: title, author, year, chapter_index: i, chapter_title: ch.title, total_chapters: totalChapters },
      }).eq("id", source_id);
    } catch { /* non-fatal */ }

    let added = 0, pendingCount = 0, extractionOk = false, chapterQuota = false;
    try {
      const { candidates, quota_exhausted } = await extractConceptsWithStatus(source_id, extractionMode);
      chapterQuota = quota_exhausted;
      if (candidates.length) {
        const highConf = candidates.filter(c => c.extraction_confidence === "high");
        if (highConf.length) { const r = await populateGraph(highConf); added = r.added; }
        await savePendingNodes(source_id, candidates);
        pendingCount = candidates.filter(c => c.extraction_confidence !== "high").length;
      }
      extractionOk = true;
    } catch (e) { console.error(`[ingestBookText] chapter ${i} extraction error (non-fatal):`, e.message); }

    // Gemini quota exhausted — stop immediately; retrying more chapters won't help.
    if (chapterQuota) {
      timedOut = true;
      results.push({ chapter: ch.title, chapter_index: i, source_id,
        words: ch.text.split(/\s+/).length, error: "quota_exhausted", nodes_added: 0 });
      break;
    }

    if (checkpointing && extractionOk) {
      try {
        await saveCheckpoint({ book_title: title, chapter_index: i, chapter_title: ch.title, source_id, status: "done", nodes_added: added, nodes_pending: pendingCount, total_chapters: totalChapters });
        newlyDone.add(i);
      } catch (e) { console.error("[ingestBookText] checkpoint done (non-fatal):", e.message); }
    } else if (!checkpointing && extractionOk) { newlyDone.add(i); }

    totalAdded += added; totalPending += pendingCount; processedThisRun++;
    results.push({ chapter: ch.title, chapter_index: i, source_id, words: ch.text.split(/\s+/).length, nodes_added: added, nodes_pending: pendingCount });
  }

  const progress = ingestProgress(totalChapters, newlyDone.size);
  const remaining = progress.chapters_remaining;
  const done = remaining === 0;
  const nextChapter = done ? null : (chaptersToProcess(totalChapters, [...newlyDone], 1)[0] ?? null);
  const quotaHit = results.some(r => r.error === "quota_exhausted");

  return {
    book_title: title, author, year, source_class: cls,
    total_chapters: totalChapters, total_words: wordCount,
    total_added: totalAdded, total_pending: totalPending,
    done, resume: !done, next_chapter: nextChapter,
    chapters_done: progress.chapters_done, chapters_remaining: remaining,
    processed_this_run: processedThisRun, timed_out: timedOut, checkpointing,
    source_ids: results.filter(r => r.source_id).map(r => r.source_id),
    chapters: results,
    quota_exhausted: quotaHit,
    notebooklm_handoff: quotaHit
      ? buildNotebookLMHandoff({ title, source_class: cls })
      : null,
  };
}

// ── Chat detection + parsing for the "ingest this as a book" command ──────────
const BOOK_INGEST_RE = /\bingest\b[\s\S]*\bbook\b/i;

/** True when the message asks to ingest a whole book (vs a short pasted claim). */
function detectBookIngest(message) {
  const s = String(message || "");
  return BOOK_INGEST_RE.test(s);
}

/** Parse "title=X, author=Y, year=Z, source_class=established" (any order). */
function parseBookIngestMessage(message) {
  const s = String(message || "");
  // Capture the value up to the next comma/newline/end OR the next known key
  // token, so space-separated fields ("title: X class: established") don't let
  // the title swallow the rest of the line. Canonical form is comma-separated.
  const grab = (key) => {
    const m = new RegExp(
      `${key}\\s*[=:]\\s*(.+?)(?=\\s*(?:,|\\n|$|\\b(?:title|author|year|source_class|class)\\s*[=:]))`, "i"
    ).exec(s);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  const title  = grab("title");
  const author = grab("author");
  const yearRaw = grab("year");
  const year   = yearRaw || null;
  const clsRaw = grab("source_class") || grab("class");
  let source_class = normalizeSourceClass(clsRaw);
  if (!source_class) { const m = CLASS_RE.exec(s); source_class = m ? normalizeSourceClass(m[1]) : null; }
  // B-gen-extract: optional override — "extraction_mode=math" (or "mode=math")
  // forces math extraction; anything else (or absent) defaults to 'general'. The
  // canonical command is comma-separated, so the existing comma/EOL lookahead in
  // grab() already delimits this value without touching the key list.
  const extractionModeRaw = grab("extraction_mode") || grab("mode");
  const extraction_mode = String(extractionModeRaw || "").toLowerCase() === "math" ? "math" : "general";
  return { title, author, year, source_class, extraction_mode };
}

// ─── Inventory helper (read-only, no Gemini) ─────────────────────────────────
/**
 * Returns a structured inventory of all ingested books and their chapters.
 * Groups m8_knowledge_sources rows by metadata.book_title. Rows without
 * book_title in metadata are reported as raw_snippets (old one-shot ingests).
 * Node counts come from m8_graph_nodes.source_doc_id join.
 */
async function getIngestionInventory() {
  const db = getDb();

  const { data: sources, error: srcErr } = await db
    .from("m8_knowledge_sources")
    .select("id, title, source_class, word_count, metadata, ingested_at")
    .order("ingested_at", { ascending: true });
  if (srcErr) throw new Error(`inventory: sources query failed: ${srcErr.message}`);

  const { data: nodeCounts, error: ncErr } = await db
    .from("m8_graph_nodes")
    .select("source_doc_id")
    .not("source_doc_id", "is", null);
  if (ncErr) throw new Error(`inventory: node count query failed: ${ncErr.message}`);

  // Count nodes per source_doc_id
  const countBySource = {};
  for (const row of nodeCounts || []) {
    countBySource[row.source_doc_id] = (countBySource[row.source_doc_id] || 0) + 1;
  }

  const books = {};
  const rawSnippets = [];

  for (const src of sources || []) {
    const meta = src.metadata || {};
    const bookTitle = meta.book_title;
    if (!bookTitle) {
      rawSnippets.push({
        id: src.id,
        title: src.title,
        source_class: src.source_class,
        word_count: src.word_count,
        node_count: countBySource[src.id] || 0,
        ingested_at: src.ingested_at,
      });
      continue;
    }

    if (!books[bookTitle]) {
      books[bookTitle] = {
        book_title: bookTitle,
        author: meta.author || null,
        year: meta.year || null,
        source_class: src.source_class,
        total_chapters: meta.total_chapters || null,
        chapters: [],
        total_nodes: 0,
      };
    }
    const nodeCount = countBySource[src.id] || 0;
    books[bookTitle].total_nodes += nodeCount;
    books[bookTitle].chapters.push({
      chapter_index: meta.chapter_index ?? null,
      chapter_title: meta.chapter_title || src.title,
      source_id: src.id,
      word_count: src.word_count,
      node_count: nodeCount,
      ingested_at: src.ingested_at,
    });
  }

  // Sort chapters within each book by chapter_index
  for (const book of Object.values(books)) {
    book.chapters.sort((a, b) => (a.chapter_index ?? 999) - (b.chapter_index ?? 999));
  }

  // Build-77: attach resumable-ingest progress from the checkpoint table.
  // Degrades silently if the table is missing (migration not applied yet) —
  // books simply report checkpoints:null and no progress fields.
  let checkpointsAvailable = false;
  try {
    const { data: cps, error: cpErr } = await db
      .from(CHECKPOINT_TABLE)
      .select("book_title, chapter_index, status, total_chapters");
    if (cpErr) {
      if (!isMissingCheckpointTable(cpErr)) throw cpErr;
    } else {
      checkpointsAvailable = true;
      const byBook = {};
      for (const row of cps || []) {
        const b = (byBook[row.book_title] = byBook[row.book_title] || { done: 0, total: 0, max: 0 });
        if (row.status === "done") b.done++;
        if (row.total_chapters) b.total = Math.max(b.total, row.total_chapters);
        b.max = Math.max(b.max, (row.chapter_index ?? -1) + 1);
      }
      for (const book of Object.values(books)) {
        const b = byBook[book.book_title];
        if (!b) { book.ingest = null; continue; }
        const total = b.total || b.max || book.total_chapters || book.chapters.length;
        book.ingest = ingestProgress(total, b.done);
        book.ingest.resumable = !book.ingest.complete;
      }
    }
  } catch (e) {
    console.error("[inventory] checkpoint progress (non-fatal):", e.message);
  }

  return {
    books: Object.values(books),
    raw_snippets: rawSnippets,
    total_books: Object.keys(books).length,
    total_nodes_in_books: Object.values(books).reduce((s, b) => s + b.total_nodes, 0),
    checkpoints_available: checkpointsAvailable,
  };
}

// ─── Knowledge Graph Search (Build-83b: semantic-first, keyword fallback) ────
const KG_SEM_THRESHOLD = 0.65;  // cosine similarity floor for semantic hits
const KG_SEM_MIN_HITS  = 2;     // fall back to keyword when semantic returns fewer

/**
 * Search m8_graph_nodes. Tries semantic search (cosine >= 0.65) first; if
 * fewer than 2 hits, falls back to keyword ilike. Never throws — returns null
 * so callers can fire-and-forget safely.
 *
 * @param {string} query   The user's message
 * @param {number} limit   Max nodes to return (default 6)
 * @returns {Promise<string|null>}
 */
async function searchKnowledgeGraph(query, limit = 6) {
  if (!query || query.length < 3) return null;
  try {
    const db = getDb();

    // 1. Semantic search via match_kg_nodes RPC (Build-83b)
    try {
      const emb = await embedText(query, "RETRIEVAL_QUERY");
      if (emb) {
        const { data: semData, error: semErr } = await db.rpc("match_kg_nodes", {
          query_embedding: emb,
          match_threshold: KG_SEM_THRESHOLD,
          match_count:     limit,
        });
        if (!semErr && semData && semData.length >= KG_SEM_MIN_HITS) {
          return semData
            .map(r => `[${r.kind === "claim" ? "Claim" : "Entity"}] ${r.label}: ${r.content}`)
            .join("\n");
        }
      }
    } catch { /* fall through to keyword search */ }

    // 2. Keyword fallback: ilike on content + label
    const stopWords = new Set(["this", "that", "what", "when", "where", "which", "about", "with", "from", "have", "does", "will", "tell", "give", "show", "want", "know"]);
    const words = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w))
      .slice(0, 6);

    if (words.length === 0) return null;

    const filters = words.map(w => `content.ilike.%${w}%,label.ilike.%${w}%`).join(",");

    const { data, error } = await db
      .from("m8_graph_nodes")
      .select("label, content, kind")
      .or(filters)
      .order("confidence", { ascending: false })
      .limit(limit * 2);

    if (error || !data || data.length === 0) return null;

    const seen = new Set();
    const hits = [];
    for (const row of data) {
      const key = (row.label || "").toLowerCase();
      if (!seen.has(key)) { seen.add(key); hits.push(row); }
      if (hits.length >= limit) break;
    }
    if (hits.length === 0) return null;

    return hits
      .map(r => `[${r.kind === "claim" ? "Claim" : "Entity"}] ${r.label}: ${r.content}`)
      .join("\n");
  } catch (_) { return null; }
}

// ─── Polished inventory status (Build-RAG) ───────────────────────────────────
/**
 * Wraps getIngestionInventory with a plain-English summary + NotebookLM tip.
 * Consumed by GET /api/knowledge?fn=status.
 */
async function getInventoryStatus() {
  const inv = await getIngestionInventory();
  const snippetNodes = inv.raw_snippets.reduce((s, r) => s + (r.node_count || 0), 0);
  const totalNodes = inv.total_nodes_in_books + snippetNodes;
  const noBooks = inv.total_books === 0;

  return {
    ...inv,
    total_all_nodes: totalNodes,
    status: noBooks ? "empty" : "has_books",
    summary: noBooks
      ? `No books ingested yet. ${inv.raw_snippets.length} raw snippet(s) with ${snippetNodes} node(s) in graph.`
      : `${inv.total_books} book(s) · ${inv.total_nodes_in_books} book nodes · ${inv.raw_snippets.length} snippet(s) · ${snippetNodes} snippet nodes.`,
    how_to_ingest: [
      "1. Paste short text: \"ingest this as established: [text]\"",
      "2. Upload a DOCX and say: \"ingest this as a book: title=X, source_class=established\"",
      "3. For heavy PDF scans (Arabic books etc.): use notebooklm.google.com — no Gemini quota risk.",
    ].join("\n"),
    notebooklm_tip: "notebooklm.google.com handles OCR + retrieval + citations free. " +
      "Recommended for bn01.pdf–bn20.pdf (البداية والنهاية) and other large Arabic scans.",
    test_docx_ready: "C:\\Users\\m7ofy\\OneDrive\\Desktop\\books\\m8_test_book.docx exists " +
      "(2 chapters, DOCX, no OCR needed). Upload it and say: " +
      "\"ingest this as a book: title=Test Book, source_class=established\" to verify wiring.",
  };
}

module.exports = {
  ingestDocument,
  extractConcepts,
  populateGraph,
  buildClarificationSummary,
  savePendingNodes,
  approvePending,
  fetchNodeSourceClass,
  fetchSourceClasses,
  detectKnowledgeIngest,
  buildKnowledgeIngestContext,
  // Build-41 (D1): canonical bucket normalizer (shared with tests)
  normalizeSourceClass,
  // Build-42 (D3): kernel/leap decomposition
  proposeDecomposition, approveDecomposition,
  // Inventory (read-only, no Gemini)
  getIngestionInventory,
  // Build-77: resumable ingestion checkpoints
  loadCheckpoints, saveCheckpoint,
  chaptersToProcess, ingestProgress, isMissingCheckpointTable,
  // Build-78: full-book ingest engine + chat detection/parsing
  ingestBookText, splitIntoChapters,
  detectBookIngest, parseBookIngestMessage,
  // Build-82: knowledge graph search for context injection
  searchKnowledgeGraph,
  // Build-RAG: quota detection + NotebookLM fallback + inventory status
  isGeminiQuotaError, buildNotebookLMHandoff,
  extractConceptsWithStatus,
  getInventoryStatus,
  // exported for tests
  chunkText,
  parseExtractionOutput,
  buildExtractionPrompt,
  parseIngestMessage,
  parseDecomposition, resolveKernelStanding, isEstablishedNode,
  // B-gen-extract: general (non-math) extraction mode + routing
  GENERAL_EXTRACTION_SYSTEM, selectExtractionSystem, buildGeneralExtractionPrompt,
  generalTypeToKind, deriveExtractionMode,
  // gen-extract fix: tolerant JSON-array extraction (handles prose-wrapped LLM output)
  parseJsonArrayLoose,
  // gen-extract option 3: free, recitation-free extraction provider order
  EXTRACT_PROVIDER_ORDER,
};
