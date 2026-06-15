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

// ─── Parse Gemini output ──────────────────────────────────────────────────────
function parseExtractionOutput(raw, source_class, source_doc_id) {
  if (!raw) return [];
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?|```$/gm, "").trim();
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
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
async function extractConcepts(source_id) {
  const { data: src, error } = await getDb()
    .from("m8_knowledge_sources")
    .select("raw_text, source_class, title")
    .eq("id", source_id)
    .single();
  if (error || !src) throw new Error(`Source ${source_id} not found`);

  const chunks = chunkText(src.raw_text);
  const allCandidates = [];

  for (const [i, chunk] of chunks.entries()) {
    let raw;
    try {
      raw = await generate({
        systemInstruction: EXTRACTION_SYSTEM,
        contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(chunk, src.title, i) }] }],
        genConfig: { temperature: 0, maxOutputTokens: 1200 },
      });
    } catch (e) {
      // A failed chunk is skipped, not fatal
      continue;
    }
    const candidates = parseExtractionOutput(raw, src.source_class, source_id);
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

  let source_id, candidates, added = 0, skipped = 0;
  try {
    ({ source_id } = await ingestDocument({ title, text: raw_text, source_class }));
    candidates = await extractConcepts(source_id);
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
        `Document is stored and can be queried later. Your response MUST say:`,
        `"Ingested '${title}' as ${source_class} (source_id ${source_id}) — 0 nodes extracted.`,
        ` The document is stored. Re-ingest with a longer excerpt to extract nodes."`,
        `DO NOT restate the document content. Report the zero count explicitly.`,
      ].join("\n"),
      data: { source_id, added: 0, skipped: 0, pending_count: 0 },
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
  // exported for tests
  chunkText,
  parseExtractionOutput,
  buildExtractionPrompt,
  parseIngestMessage,
  parseDecomposition, resolveKernelStanding, isEstablishedNode,
};
