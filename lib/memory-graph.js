/**
 * M8 Research Memory Graph — lib/memory-graph.js  (Build-10, Session 1)
 *
 * The GRAPH LAYER over the research notebook: typed nodes + typed edges +
 * pgvector embeddings in Supabase, so every conjecture, verified theorem, dead
 * end and technique becomes a CONNECTED, SEMANTICALLY SEARCHABLE fact instead
 * of a flat ledger row. This is the compounding substrate Track B needs — the
 * layer that makes work on open problems CUMULATIVE rather than episodic.
 *
 * ONTOLOGY (canonical — BUILD_10_SPEC.md):
 *   nodes: conjecture | theorem | evidence | counterexample | failed_attempt
 *          | technique | sequence | research_thread
 *   edges: supports | contradicts | generalizes | depends_on | formalizes
 *          | derived_from          (directions pinned in the spec table)
 *
 * TWO WRITE PATHS, SAME HONESTY SPINE:
 *   1. DETERMINISTIC (write-time, code-owned): persistNote() calls ingestNote()
 *      — notebook entry → node is a 1:1 CODE mapping, edges are code-derived
 *      (evidence —supports→ conjecture, theorem —formalizes→ conjecture, …).
 *      One budget-capped embedding call; failure degrades to a node without an
 *      embedding (the sweep backfills). NEVER blocks or fails the notebook write.
 *   2. EXTRACTION (nightly sweep, LLM-assisted): prompts AUTHORED BY FABLE 5,
 *      EXECUTED BY GEMINI FLASH (the crystallization pattern). Strict-JSON
 *      output, schema-validated against the ontology, hard-capped, provenance-
 *      tagged source='extraction' + confidence 0.7. Anything off-schema is
 *      dropped, never inserted. lean_verified is the ONLY path to a 'theorem'
 *      node — extraction cannot mint theorems.
 *
 * RETRIEVAL CORE (wired into chat in Session 2): graphMatch() = cosine top-k
 * via the m8_graph_match RPC; fetchNeighbors() = 1-hop graph walk.
 *
 * Fails SAFE everywhere: any Supabase / Gemini error logs and returns a
 * degraded result; nothing in this file ever throws into the notebook or the
 * orchestrator. Kill switch: GRAPH_DISABLED=1.
 */
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI } = require("@google/genai");
const { generate } = require("./llm");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const NODES_TABLE = "m8_graph_nodes";
const EDGES_TABLE = "m8_graph_edges";
const NOTES_TABLE = "m8_research_notes";

const NODE_KINDS = new Set([
  "conjecture", "theorem", "evidence", "counterexample",
  "failed_attempt", "technique", "sequence", "research_thread",
]);
const EDGE_RELS = new Set([
  "supports", "contradicts", "generalizes", "depends_on", "formalizes", "derived_from",
]);

// Build-41 (D2): SCHEMA EDGE-BAN — a speculative node may never occupy an
// EVIDENCE-bearing or PROOF-bearing edge (team rule 2b, GPT). The structural
// guarantee that a label-narration can't give: a speculative claim can never be
// recorded AS support for, or a formalization of, anything — so recall can never
// surface it as a "connection" that implies evidentiary/proof weight.
//   supports    — banned (evidence-FOR weight)
//   formalizes  — banned (proof weight; already lean-only, this adds endpoint ban)
//   contradicts — ALLOWED (honest refutation of/by a speculative claim is useful)
//   generalizes/depends_on/derived_from — ALLOWED (structure/lineage, not evidence;
//     derived_from is also the Build-42 kernel/leap relation).
// 'fringe' is treated as 'speculative' (pre-D1-migration safety).
const EVIDENCE_BEARING_RELS = new Set(["supports", "formalizes"]);
const isSpeculativeClass = (c) => c === "speculative" || c === "fringe";
/** Pure predicate (no DB) — mirrored by tests/epistemic-axis-verify.ps1. */
function edgeAllowed(rel, srcClass, dstClass) {
  if (!EVIDENCE_BEARING_RELS.has(rel)) return true;
  return !(isSpeculativeClass(srcClass) || isSpeculativeClass(dstClass));
}

// ─────────────────────────────────────────────────────────────────
// Build-38: UNIVERSAL NODE PROVENANCE ("trust before taxonomy")
// ─────────────────────────────────────────────────────────────────
// Every node carries source · timestamp (created_at) · evidence_kind · confidence
// · verification_state. These three derivations MIRROR
// migrations/m8_graph_nodes_provenance.sql EXACTLY — keep them in lockstep.
// HONESTY CONTRACT: lean status is the ONLY path to 'proven'; a counterexample is
// the only 'refuted'. Extraction/ingestion can never reach proven/refuted. A
// caller may override any field (e.g. intake sets evidence_kind='reference').
const EVIDENCE_KINDS = new Set(["hypothesis", "experiment", "result", "failed_path", "reference"]);
const VERIFICATION_STATES = ["unverified", "heuristic", "empirical", "proven"]; // forward-only rank (refuted is terminal, set only by a falsifier)

// Build-39: read-path trust tiers for renderGraphPacket — most-trusted first.
// Any node whose verification_state doesn't match one of these (including
// missing/null, e.g. pre-Build-38 nodes) is bucketed under "unverified".
const TRUST_TIERS = [
  { state: "proven",     header: "VERIFIED (machine-checked, e.g. Lean — established within our own work):" },
  { state: "empirical",  header: "EMPIRICAL (tested/observed, not proven):" },
  { state: "heuristic",  header: "HEURISTIC (partially checked, not fully verified):" },
  { state: "unverified", header: "UNVERIFIED (recorded hypotheses — NOT verified; do not present as findings):" },
  { state: "refuted",    header: "REFUTED (counterexamples on record — known FALSE; never cite as support):" },
];
function deriveEvidenceKind(kind) {
  switch (kind) {
    case "conjecture":     return "hypothesis";
    case "theorem":        return "result";
    case "evidence":       return "result";
    case "counterexample": return "result";
    case "failed_attempt": return "failed_path";
    case "sequence":       return "experiment";
    case "document":       return "reference";
    case "entity":         return "reference";
    case "technique":      return "reference";
    case "claim":          return "hypothesis";
    default:               return null;   // research_thread / anchors: no epistemic role (matches SQL: no case → NULL)
  }
}
function deriveConfidence(source, status) {
  if (status === "lean_verified") return 1.0;
  if (source === "code")          return 1.0;
  if (source === "external")      return 0.9;
  return 0.6;                              // extraction / unknown
}
// Intake claims carry an extraction_confidence (high/med/low) that is a truer
// signal than the source='external' blanket — map it to the numeric axis.
function confidenceFromExtraction(extractionConfidence) {
  switch (extractionConfidence) {
    case "high":   return 0.8;
    case "medium": return 0.6;
    case "low":    return 0.4;
    default:       return null;
  }
}
function deriveVerificationState(kind, source, status) {
  if (status === "lean_verified") return "proven";
  if (kind === "counterexample")  return "refuted";
  if (kind === "evidence")        return "empirical";
  if (source === "external")      return "empirical";
  return "unverified";
}
// True if the supabase error is "this provenance column doesn't exist yet" — i.e.
// the Build-38 migration hasn't been applied. Lets the write-path degrade safely
// (strip the new fields + retry) during the deploy-before-migration window.
function isMissingProvenanceColumn(err) {
  const m = String(err?.message || err || "");
  return /column .*(evidence_kind|confidence|verification_state).* does not exist/i.test(m)
      || /(evidence_kind|verification_state|confidence)/.test(m) && /schema cache|does not exist|could not find/i.test(m);
}

// Embeddings: gemini-embedding-001 @ 768 dims. Values are NOT pre-normalized
// below 3072 dims, so we L2-normalize client-side — required for honest cosine
// similarity. The dim is baked into the vector(768) schema; changing models
// means a re-embed sweep (embedding_model is recorded per node for that).
const EMBED_MODEL    = () => process.env.GRAPH_EMBED_MODEL || "gemini-embedding-001";
const EMBED_DIM      = 768;
const EMBED_BUDGET_MS = parseInt(process.env.GRAPH_EMBED_BUDGET_MS, 10) || 2500;

// ─────────────────────────────────────────────────────────────────
// SMALL UTILITIES
// ─────────────────────────────────────────────────────────────────
function normLabel(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 160);
}

// Truncate a DISPLAY label without splitting a number or word in half (Build-15
// follow-up / S7 finding): content.slice(0,160) turned "2 <= n <= 10,000" into
// "...10" and recall narrated a WRONG figure (tested to 10, not 10,000). We back
// off to the last word boundary; if the cut lands inside a digit group we walk
// out of the whole number, so a label can NEVER end on a partial number that
// reads as a smaller complete one. Honesty-relevant, not cosmetic. Idempotent.
function smartTruncate(s, max) {
  const str = String(s == null ? "" : s).trim();
  if (str.length <= max) return str;
  let cut = max;
  const between = (i) => /\S/.test(str[i] || "");      // non-space at i
  if (between(cut - 1) && between(cut)) {               // boundary is inside a token
    const sp = str.lastIndexOf(" ", cut);
    if (sp > Math.floor(max * 0.6)) {
      cut = sp;                                          // clean word boundary nearby
    } else {
      // one long token (or a number) straddles the cut — walk out of any digit
      // group so we don't emit a truncated number.
      while (cut > 0 && /[\d.,]/.test(str[cut - 1]) && /[\d.,]/.test(str[cut] || "")) cut--;
    }
  }
  return str.slice(0, cut).replace(/[\s,.;:]+$/, "") + "…";
}

function l2normalize(vals) {
  let ss = 0;
  for (const v of vals) ss += v * v;
  const n = Math.sqrt(ss);
  if (!n || !isFinite(n)) return null;
  return vals.map((v) => v / n);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label || "timeout")), ms)),
  ]);
}

// Lean status for HISTORICAL rows (the staged write carries write.status, but
// persistNote only stored it in metadata from Build-10 on — older rows encode
// it in the content prefix lean.js writes).
function leanFromContent(content) {
  const c = String(content || "");
  if (/^\[Lean verified\]/i.test(c))            return "lean_verified";
  if (/^\[Lean statement verified\]/i.test(c))  return "lean_stated";
  if (/^\[Lean rejected\]/i.test(c))            return "lean_rejected";
  return null;
}

// ─────────────────────────────────────────────────────────────────
// EMBEDDINGS (budget-capped, fail-safe → null)
// ─────────────────────────────────────────────────────────────────
async function embedText(text, taskType) {
  const t = String(text || "").trim().slice(0, 6000);
  if (!t) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await withTimeout(
      ai.models.embedContent({
        model: EMBED_MODEL(),
        contents: t,
        config: { taskType: taskType || "RETRIEVAL_DOCUMENT", outputDimensionality: EMBED_DIM },
      }),
      EMBED_BUDGET_MS,
      "embed timeout"
    );
    const vals = res && res.embeddings && res.embeddings[0] && res.embeddings[0].values;
    if (!Array.isArray(vals) || vals.length !== EMBED_DIM) return null;
    return l2normalize(vals);
  } catch (err) {
    console.error("[M8] graph embed error (non-fatal):", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// NODE / EDGE PRIMITIVES (idempotent — unique (kind, norm_label) is the merge)
// ─────────────────────────────────────────────────────────────────
/**
 * Upsert a node by (kind, norm_label). Existing node → merge (newest content/
 * status/note_id win, embedding NEVER clobbered, merge_count bumped). New node
 * → insert with a budgeted embedding (null is fine; sweep backfills).
 * Returns the node row ({ id, ... }) or null on failure. Never throws.
 */
async function upsertNode(fields) {
  try {
    const kind = fields.kind;
    if (!NODE_KINDS.has(kind)) return null;
    const label = String(fields.label || "").trim().slice(0, 200);
    const norm = normLabel(fields.normLabel || label);
    if (!label || !norm) return null;

    const supabase = getClient();
    const ex = await supabase
      .from(NODES_TABLE)
      .select("id, embedding, metadata")
      .eq("kind", kind)
      .eq("norm_label", norm)
      .maybeSingle();

    const srcVal = (fields.source === "extraction" || fields.source === "external") ? fields.source : "code";

    if (ex.data && ex.data.id) {
      const patch = { updated_at: new Date().toISOString() };
      if (fields.content)  patch.content  = String(fields.content).slice(0, 4000);
      if (fields.status)   patch.status   = fields.status;
      if (fields.noteId)   patch.note_id  = fields.noteId;
      const meta = (ex.data.metadata && typeof ex.data.metadata === "object") ? ex.data.metadata : {};
      patch.metadata = { ...meta, ...(fields.metadata || {}), merge_count: (meta.merge_count || 0) + 1 };
      // Build-38: a re-write may UPGRADE verification (forward-only). The only
      // forward transition that happens on a re-write is lean verification of a
      // previously-unproven node → promote to 'proven' + confidence 1.0. We never
      // downgrade an existing provenance state here.
      if (fields.status === "lean_verified") {
        patch.verification_state = "proven";
        patch.confidence = 1.0;
      }
      let upd = await supabase.from(NODES_TABLE).update(patch).eq("id", ex.data.id);
      if (upd.error && isMissingProvenanceColumn(upd.error)) {     // pre-migration safety
        delete patch.verification_state; delete patch.confidence;
        await supabase.from(NODES_TABLE).update(patch).eq("id", ex.data.id);
      }
      return { id: ex.data.id, kind, norm_label: norm, existing: true };
    }

    let embedding = null;
    if (fields.embed !== false) {
      embedding = await embedText(fields.content || label, "RETRIEVAL_DOCUMENT");
    }
    const row = {
      kind,
      label,
      norm_label:      norm,
      content:         fields.content ? String(fields.content).slice(0, 4000) : null,
      thread:          fields.thread || null,
      status:          fields.status || null,
      // Build-15 (M2): 'external' = curated literature seeds (api/seed-pack.js,
      // after migrations/m2_external_source.sql). Anything else stays 'code'.
      source:          srcVal,
      note_id:         fields.noteId || null,
      session_id:      fields.sessionId || null,
      embedding,
      embedding_model: embedding ? EMBED_MODEL() : null,
      metadata:        fields.metadata || {},
      // Build-38: universal provenance (caller may override; else derived).
      evidence_kind:      (fields.evidenceKind && EVIDENCE_KINDS.has(fields.evidenceKind)) ? fields.evidenceKind : deriveEvidenceKind(kind),
      confidence:         (typeof fields.confidence === "number") ? Math.max(0, Math.min(1, fields.confidence)) : deriveConfidence(srcVal, fields.status),
      verification_state: (fields.verificationState && (VERIFICATION_STATES.includes(fields.verificationState) || fields.verificationState === "refuted")) ? fields.verificationState : deriveVerificationState(kind, srcVal, fields.status),
    };
    let ins = await supabase.from(NODES_TABLE).insert([row]).select("id").single();
    if (ins.error && isMissingProvenanceColumn(ins.error)) {     // pre-migration safety: retry without the new columns
      const { evidence_kind, confidence, verification_state, ...legacy } = row;
      ins = await supabase.from(NODES_TABLE).insert([legacy]).select("id").single();
    }
    if (ins.error) {
      // unique-race: another writer inserted the same (kind, norm) — read it back
      const again = await supabase.from(NODES_TABLE).select("id").eq("kind", kind).eq("norm_label", norm).maybeSingle();
      if (again.data && again.data.id) return { id: again.data.id, kind, norm_label: norm, existing: true };
      console.error("[M8] graph node insert error (non-fatal):", ins.error.message);
      return null;
    }
    return { id: ins.data.id, kind, norm_label: norm, existing: false };
  } catch (err) {
    console.error("[M8] graph upsertNode error (non-fatal):", err.message);
    return null;
  }
}

/** Insert an edge; duplicates (src,dst,rel) are silently ignored. Never throws. */
async function addEdge({ srcId, dstId, rel, source, noteId, confidence, metadata } = {}) {
  try {
    if (!srcId || !dstId || srcId === dstId || !EDGE_RELS.has(rel)) return null;
    const supabase = getClient();
    // Build-41 (D2): schema edge-ban. For an evidence/proof-bearing relation only,
    // look up the endpoints' source_class and refuse if either is speculative.
    // Cheap (one select; off the hot path) and fail-SAFE: a lookup error ALLOWS the
    // edge (never block notebook ingestion on a transient DB error) — the recall-time
    // [SPECULATIVE] wrapper (Build-28) is the backstop; this ban is a second belt.
    if (EVIDENCE_BEARING_RELS.has(rel)) {
      const { data: ends, error: lookErr } = await supabase
        .from(NODES_TABLE).select("id, source_class").in("id", [srcId, dstId]);
      if (!lookErr && Array.isArray(ends)) {
        const cls = new Map(ends.map((n) => [n.id, n.source_class]));
        if (!edgeAllowed(rel, cls.get(srcId), cls.get(dstId))) {
          console.error(`[M8] edge-ban (Build-41): refused '${rel}' touching a speculative node (src ${srcId}, dst ${dstId}).`);
          return null;
        }
      }
    }
    const res = await supabase
      .from(EDGES_TABLE)
      .upsert(
        [{
          src_id:     srcId,
          dst_id:     dstId,
          rel,
          source:     source === "extraction" ? "extraction" : "code",
          note_id:    noteId || null,
          confidence: source === "extraction" ? (confidence || 0.7) : (confidence || 1),
          metadata:   metadata || {},
        }],
        { onConflict: "src_id,dst_id,rel", ignoreDuplicates: true }
      );
    if (res.error) { console.error("[M8] graph edge error (non-fatal):", res.error.message); return null; }
    return true;
  } catch (err) {
    console.error("[M8] graph addEdge error (non-fatal):", err.message);
    return null;
  }
}

/** Anchor node for a thread (kind research_thread, norm_label = thread slug). */
async function ensureThreadNode(thread, sessionId) {
  const slug = normLabel(thread || "general") || "general";
  return upsertNode({
    kind: "research_thread",
    label: slug.replace(/-/g, " "),
    normLabel: slug,
    content: `Research thread: ${slug.replace(/-/g, " ")}`,
    thread: slug,
    sessionId,
  });
}

/** Latest current conjecture node in a thread (for code-owned edge targets).
 *  Build-14 (M3-lite, spec critique A3): MACHINE-GENERATED survivors (status
 *  tested_to_*) are excluded — a generator survivor must never silently become
 *  the supports-edge target for future discovery evidence. (Survivors also live
 *  in their own thread, collatz-m3 — this filter is the second belt.) */
async function latestConjectureNode(thread) {
  try {
    const { data } = await getClient()
      .from(NODES_TABLE)
      .select("id, label")
      .eq("kind", "conjecture")
      .eq("thread", thread)
      .or("status.is.null,status.not.ilike.tested_to%")
      .order("created_at", { ascending: false })
      .limit(1);
    return (data && data[0]) || null;
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────────────────────────
// DETERMINISTIC MAPPING — notebook entry → graph node (code-owned; the spine)
// ─────────────────────────────────────────────────────────────────
// lean_verified is the ONLY path to a 'theorem' node. A lean_stated claim is a
// formally-STATED conjecture (typechecks, proof admitted) — honest kind, not a
// result. Generic notes get NO deterministic node (no honest kind without
// classification — the extraction sweep handles them). status / next_step /
// lean_rejected are thread state / noise, never knowledge nodes.
function mapNoteToNode(n) {
  const lean = (/^lean_/.test(n.status || "") ? n.status : null)
    || (n.metadata && n.metadata.lean)
    || leanFromContent(n.content);
  if (lean === "lean_rejected") return null;
  // Build-14 (M3-lite): a machine-generated survivor carries its provenance as
  // node status (tested_to_<N>) — the m8_graph_match RPC returns status but not
  // metadata, so this is what lets recall label it MACHINE-GENERATED (A4).
  if (n.kind === "conjecture" && n.metadata && n.metadata.m3_generated) {
    const b = parseInt(n.metadata.tested_to, 10);
    return { kind: "conjecture", status: `tested_to_${b > 0 ? b : "N"}` };
  }
  if (n.kind === "conjecture")     return { kind: "conjecture", status: null };
  if (n.kind === "evidence")       return lean === "lean_verified"
                                     ? { kind: "theorem",  status: "lean_verified" }
                                     : { kind: "evidence", status: null };
  if (n.kind === "counterexample") return { kind: "counterexample", status: null };
  if (n.kind === "dead_end")       return { kind: "failed_attempt", status: null };
  if (n.kind === "note" && lean === "lean_stated") return { kind: "conjecture", status: "lean_stated" };
  return null;
}

/**
 * THE WRITE-TIME ENTRY POINT — called from persistNote() right after a notebook
 * row lands (one choke point covers every orchestrator call site + streaming).
 *
 * note: { id, thread, kind, content, stance, status, session_id, metadata }
 * opts: { withExtraction } — false on the hot path (latency + quota), true in
 *       the nightly sweep.
 *
 * Deterministic spine: ensure thread anchor → map kind → upsert primary node
 * (one budgeted embed) → code-owned edges per the spec table. Idempotent (the
 * (kind, norm_label) upsert), fail-safe (returns { ok:false } — never throws).
 */
async function ingestNote(note, opts = {}) {
  try {
    if (process.env.GRAPH_DISABLED === "1") return { ok: false, skipped: "disabled" };
    if (!note || !note.content || !note.kind) return { ok: false, skipped: "empty" };
    const thread = normLabel(note.thread || "general") || "general";

    const threadNode = await ensureThreadNode(thread, note.session_id);

    const mapped = mapNoteToNode(note);
    let primary = null;
    if (mapped) {
      const label = smartTruncate(note.content, 160);
      primary = await upsertNode({
        kind:      mapped.kind,
        label,
        content:   note.content,
        thread,
        status:    mapped.status,
        noteId:    note.id || null,
        sessionId: note.session_id || null,
        metadata:  { ...(note.metadata && typeof note.metadata === "object" ? note.metadata : {}), origin_kind: note.kind, stance: note.stance || null },
      });

      if (primary && primary.id) {
        // anchor: every node —derived_from→ its thread
        if (threadNode && threadNode.id) {
          await addEdge({ srcId: primary.id, dstId: threadNode.id, rel: "derived_from", noteId: note.id });
        }
        // code-owned semantic edges (only when a real target exists — an honest
        // miss beats a forced wrong edge; see spec critique #6)
        if (mapped.kind !== "conjecture") {
          const conj = await latestConjectureNode(thread);
          if (conj && conj.id && conj.id !== primary.id) {
            if (mapped.kind === "theorem") {
              await addEdge({ srcId: primary.id, dstId: conj.id, rel: "formalizes", noteId: note.id });
            } else if (mapped.kind === "evidence") {
              // M1 (Build-13): a NEUTRAL structural census (metadata.neutral)
              // is descriptive data, not evidence FOR the conjecture — minting
              // a supports edge would be dishonest. Thread anchor only.
              const neutral = !!(note.metadata && note.metadata.neutral);
              if (!neutral) {
                const rel = note.stance === "against" ? "contradicts" : "supports";
                await addEdge({ srcId: primary.id, dstId: conj.id, rel, noteId: note.id });
              }
            } else if (mapped.kind === "counterexample") {
              await addEdge({ srcId: primary.id, dstId: conj.id, rel: "contradicts", noteId: note.id });
            }
          }
        }
      }
    }

    let extracted = null;
    if (opts.withExtraction) {
      extracted = await extractFromNote(note, primary, thread);
    }

    return { ok: true, nodeId: primary ? primary.id : null, extracted };
  } catch (err) {
    console.error("[M8] graph ingestNote error (non-fatal):", err.message);
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// EXTRACTION — prompts authored by Fable 5, executed by Gemini Flash.
// The crystallization pattern: the reasoning is in THIS prompt + validator;
// the cheap runtime model only fills the template.
// ─────────────────────────────────────────────────────────────────
const EXTRACTION_SYSTEM = `You are the entity-and-relation extraction stage of a mathematical research memory graph. You receive ONE research-notebook entry. You extract ONLY what the entry itself states — never outside knowledge, never your own mathematical opinions.

OUTPUT CONTRACT — exactly one JSON object, no markdown fences, no prose:
{
  "note_node": {"kind": "...", "label": "..."} | null,
  "entities": [{"kind": "technique"|"sequence", "label": "...", "summary": "..."}],
  "edges": [{"src": "...", "rel": "...", "dst": "..."}]
}

RULES — violating any of these gets your output discarded:
1. "note_node": ONLY if asked for it in the user message (the entry had no classified kind). Choose the single most honest kind from: "conjecture" (an open claim), "evidence" (a recorded observation/result), "technique" (a method), "sequence" (an integer/function sequence). Its "label" is a faithful <=120-char restatement of the entry's core claim. If the entry is administrative chatter with no research content, use null.
2. "entities": 0 to 5 items. ONLY kinds "technique" (a named proof/search method the entry actually mentions, e.g. "strong induction", "modular arithmetic sieve") or "sequence" (a named or defined sequence, e.g. "Collatz trajectory", "A000045 Fibonacci"). The label must name something EXPLICIT in the entry text. No generic filler ("math", "numbers", "research").
3. "edges": 0 to 8 items. "rel" must be one of: supports, contradicts, generalizes, depends_on, formalizes, derived_from. "src"/"dst" must each be either the literal string "THIS" (this entry's own node) or the EXACT label of one of your "entities", or the EXACT label of a known node listed in the user message. Direction conventions: evidence supports a conjecture; a counterexample contradicts a conjecture; X depends_on a technique. NEVER emit "formalizes" — only machine verification may create that edge.
4. A conjecture in the entry is an OPEN CLAIM. Nothing you output may state or imply it is proven.
5. When in doubt, output less. An empty {"note_node":null,"entities":[],"edges":[]} is a perfectly good answer.`;

function buildExtractionPrompt(note, knownNodes, askNoteNode) {
  const known = (knownNodes || [])
    .slice(0, 20)
    .map((n) => `- [${n.kind}] ${n.label}`)
    .join("\n");
  return [
    `Notebook entry (thread "${note.thread || "general"}", recorded kind "${note.kind}"${note.stance ? `, stance ${note.stance}` : ""}):`,
    `---`,
    String(note.content || "").slice(0, 1800),
    `---`,
    askNoteNode
      ? `This entry has NO classified node yet — include "note_node" (or null if it has no research content).`
      : `This entry already has its own node — set "note_node" to null.`,
    known ? `Known nodes in this thread you may reference as edge endpoints (exact labels):\n${known}` : `No other known nodes in this thread.`,
    `Output the JSON object now.`,
  ].join("\n");
}

/** Parse + validate extraction output. Anything off-schema is dropped. Never throws. */
function parseExtraction(raw) {
  const empty = { note_node: null, entities: [], edges: [] };
  try {
    let s = String(raw || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end <= start) return empty;
    const obj = JSON.parse(s.slice(start, end + 1));

    const out = { note_node: null, entities: [], edges: [] };
    const NOTE_NODE_KINDS = new Set(["conjecture", "evidence", "technique", "sequence"]);
    const ENTITY_KINDS = new Set(["technique", "sequence"]);
    const okLabel = (l) => typeof l === "string" && l.trim().length >= 3 && l.trim().length <= 120;

    if (obj.note_node && NOTE_NODE_KINDS.has(obj.note_node.kind) && okLabel(obj.note_node.label)) {
      out.note_node = { kind: obj.note_node.kind, label: obj.note_node.label.trim() };
    }
    for (const e of Array.isArray(obj.entities) ? obj.entities.slice(0, 5) : []) {
      if (e && ENTITY_KINDS.has(e.kind) && okLabel(e.label)) {
        out.entities.push({
          kind: e.kind,
          label: e.label.trim(),
          summary: typeof e.summary === "string" ? e.summary.trim().slice(0, 500) : null,
        });
      }
    }
    for (const ed of Array.isArray(obj.edges) ? obj.edges.slice(0, 8) : []) {
      // extraction may NEVER mint a formalizes edge (lean-verification-only)
      if (ed && EDGE_RELS.has(ed.rel) && ed.rel !== "formalizes"
          && typeof ed.src === "string" && typeof ed.dst === "string" && ed.src !== ed.dst) {
        out.edges.push({ src: ed.src.trim(), rel: ed.rel, dst: ed.dst.trim() });
      }
    }
    return out;
  } catch (_) {
    return empty;
  }
}

/**
 * Run Gemini extraction over one note and insert the VALIDATED results
 * (source='extraction', confidence 0.7). primary may be null (generic note) —
 * then a valid note_node classification becomes the entry's node.
 * Returns { entities, edges } counts. Never throws.
 */
async function extractFromNote(note, primary, thread) {
  try {
    const supabase = getClient();
    // known same-thread nodes = legal edge endpoints for the model
    const { data: known } = await supabase
      .from(NODES_TABLE)
      .select("id, kind, label, norm_label")
      .eq("thread", thread)
      .neq("kind", "research_thread")
      .order("created_at", { ascending: false })
      .limit(20);

    const askNoteNode = !primary;
    const raw = await generate({
      systemInstruction: EXTRACTION_SYSTEM,
      contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(note, known, askNoteNode) }] }],
      genConfig: { temperature: 0, maxOutputTokens: 800 },
    });
    const ext = parseExtraction(raw);

    let primaryId = primary && primary.id;
    // a generic note classified by extraction becomes its own (extraction-sourced) node
    if (!primaryId && ext.note_node) {
      const created = await upsertNode({
        kind:      ext.note_node.kind,
        label:     ext.note_node.label,
        content:   note.content,
        thread,
        source:    "extraction",
        noteId:    note.id || null,
        sessionId: note.session_id || null,
        metadata:  { origin_kind: note.kind },
      });
      if (created && created.id) {
        primaryId = created.id;
        const tn = await ensureThreadNode(thread, note.session_id);
        if (tn && tn.id) await addEdge({ srcId: primaryId, dstId: tn.id, rel: "derived_from", source: "extraction", noteId: note.id });
      }
    }

    // entity nodes (technique / sequence only — validator enforced)
    const labelToId = new Map();
    for (const n of known || []) labelToId.set(normLabel(n.label), n.id);
    if (primaryId) labelToId.set("this", primaryId);
    let entities = 0;
    for (const e of ext.entities) {
      const created = await upsertNode({
        kind:      e.kind,
        label:     e.label,
        content:   e.summary || e.label,
        thread,
        source:    "extraction",
        noteId:    note.id || null,
        sessionId: note.session_id || null,
      });
      if (created && created.id) {
        labelToId.set(normLabel(e.label), created.id);
        entities++;
      }
    }

    // edges between resolvable endpoints only — unresolvable labels are dropped
    let edges = 0;
    for (const ed of ext.edges) {
      const src = ed.src === "THIS" ? primaryId : labelToId.get(normLabel(ed.src));
      const dst = ed.dst === "THIS" ? primaryId : labelToId.get(normLabel(ed.dst));
      if (src && dst && src !== dst) {
        const ok = await addEdge({ srcId: src, dstId: dst, rel: ed.rel, source: "extraction", noteId: note.id, confidence: 0.7 });
        if (ok) edges++;
      }
    }

    // mark the primary node enriched (sweep bookkeeping)
    if (primaryId) {
      await supabase.from(NODES_TABLE).update({ enriched_at: new Date().toISOString() }).eq("id", primaryId);
    }
    return { entities, edges };
  } catch (err) {
    console.error("[M8] graph extraction error (non-fatal):", err.message);
    return { entities: 0, edges: 0, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// NIGHTLY SWEEP — wired into /api/cron-summarize (no new Vercel function).
// (1) backfill embeddings nodes missed on the hot path, (2) full ingest +
// extraction for unprocessed notes, oldest first → history backfills itself.
// Budget-capped so it never starves the summary sweep or the Gemini quota.
// ─────────────────────────────────────────────────────────────────
async function runGraphSweep(opts = {}) {
  const out = { embedded: 0, ingested: 0, extracted_entities: 0, extracted_edges: 0, skipped: 0 };
  if (process.env.GRAPH_DISABLED === "1") return { ...out, disabled: true };
  try {
    const supabase = getClient();

    // 1) embedding backfill
    const embedLimit = opts.embedLimit || parseInt(process.env.GRAPH_SWEEP_EMBED_LIMIT, 10) || 20;
    const { data: missing } = await supabase
      .from(NODES_TABLE)
      .select("id, label, content")
      .is("embedding", null)
      .order("id", { ascending: true })
      .limit(embedLimit);
    for (const n of missing || []) {
      const emb = await embedText(n.content || n.label, "RETRIEVAL_DOCUMENT");
      if (emb) {
        await supabase.from(NODES_TABLE)
          .update({ embedding: emb, embedding_model: EMBED_MODEL(), updated_at: new Date().toISOString() })
          .eq("id", n.id);
        out.embedded++;
      }
    }

    // 2) unprocessed notes → ingest + extraction
    const noteLimit = opts.noteLimit || parseInt(process.env.GRAPH_SWEEP_NOTE_LIMIT, 10) || 6;
    const { data: notes } = await supabase
      .from(NOTES_TABLE)
      .select("id, thread, kind, content, stance, status, session_id, metadata")
      .is("graph_processed_at", null)
      .order("id", { ascending: true })
      .limit(noteLimit);

    for (const note of notes || []) {
      const lean = (note.metadata && note.metadata.lean) || leanFromContent(note.content);
      const permanentSkip =
        note.kind === "status" || note.kind === "next_step" || lean === "lean_rejected";
      if (permanentSkip) {
        await supabase.from(NOTES_TABLE).update({ graph_processed_at: new Date().toISOString() }).eq("id", note.id);
        out.skipped++;
        continue;
      }
      const res = await ingestNote(note, { withExtraction: true });
      if (res.ok) {
        // mark processed ONLY on success — a transient LLM/DB failure retries next night
        await supabase.from(NOTES_TABLE).update({ graph_processed_at: new Date().toISOString() }).eq("id", note.id);
        out.ingested++;
        if (res.extracted) {
          out.extracted_entities += res.extracted.entities || 0;
          out.extracted_edges    += res.extracted.edges || 0;
        }
      }
    }
    return out;
  } catch (err) {
    console.error("[M8] graph sweep error (non-fatal):", err.message);
    return { ...out, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// ONE-TIME RELABEL BACKFILL  (Build-15 smartTruncate follow-up)
// ─────────────────────────────────────────────────────────────────
/**
 * Re-derive the DISPLAY label of HISTORICAL nodes that were labelled with the
 * pre-fix dumb truncation `content.trim().slice(0,160)` — which could cut a
 * figure mid-number ("2 <= n <= 10,000" -> "...10") and made recall narrate a
 * WRONG bound. smartTruncate now governs labels at write time (ingestNote); this
 * repairs the OLD ones from the intact `content` field. Forward path already
 * correct, so this only ever touches nodes created before the fix.
 *
 * SCOPE GUARD (honesty / zero collateral damage): a node is rewritten ONLY when
 * its current label is a literal prefix of its (trimmed) content — that is
 * EXACTLY the dumb-truncation signature. Extraction PARAPHRASES, curated
 * external/LITERATURE titles ("Author Year: ...", content starts "[LITERATURE
 * —…]"), entity summaries and thread anchors ("Research thread: ...") are NOT
 * content prefixes, so they are left untouched.
 *
 * ONLY `label` and its `norm_label` dedup key change. content / status /
 * metadata / embedding / edges are NEVER modified — so this is display-only and
 * RETRIEVAL-NEUTRAL: the embedding was built from `content` (unchanged), the
 * m8_graph_match RPC never returns norm_label, and edges reference node id, not
 * norm. Updating norm_label keeps a future re-ingest of identical content
 * MERGING (kind, norm_label) instead of duplicating.
 *
 * dryRun=true (DEFAULT) reports what WOULD change without writing — pass
 * dryRun:false to commit. Idempotent: after a run each label already equals
 * smartTruncate(content,160), so re-runs are no-ops. Fail-safe: per-node/page
 * errors are counted, never thrown.
 */
async function relabelNodes(opts = {}) {
  const dryRun = opts.dryRun !== false;        // must explicitly pass dryRun:false to write
  const max = parseInt(opts.max, 10) || 160;   // label cap — matches ingestNote
  const report = {
    dryRun, scanned: 0, changed: 0,
    skipped_no_content: 0, skipped_already_ok: 0,
    skipped_not_prefix: 0, skipped_collision: 0, errors: 0,
    samples: [], collisions: [],               // samples: {id,kind,old,new}; <=25
  };
  if (process.env.GRAPH_DISABLED === "1") return { ...report, disabled: true };
  try {
    const supabase = getClient();
    const PAGE = 200;
    const claimed = new Map();                  // `${kind}::${newNorm}` -> first node id this run
    let cursor = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(NODES_TABLE)
        .select("id, kind, label, norm_label, content")
        .gt("id", cursor)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (error) { console.error("[M8] relabel page error:", error.message); report.errors++; break; }
      if (!data || !data.length) break;
      for (const n of data) {
        cursor = n.id;
        report.scanned++;
        const ct = (n.content == null ? "" : String(n.content)).trim();
        if (!ct) { report.skipped_no_content++; continue; }              // nothing better to derive from
        const newLabel = smartTruncate(ct, max);
        if (newLabel === n.label) { report.skipped_already_ok++; continue; } // post-fix / short — correct already
        // dumb-truncation signature: current label is a prefix of (trimmed) content
        const bare = String(n.label || "").replace(/[…\s]+$/, "");
        if (!bare || ct.length <= bare.length || !ct.startsWith(bare)) {
          report.skipped_not_prefix++; continue;                         // paraphrase / literature / anchor — leave alone
        }
        const newNorm = normLabel(newLabel);
        const key = `${n.kind}::${newNorm}`;
        // collision: another node (already in the DB, or earlier this run) owns (kind, newNorm)
        let clashId = claimed.get(key);
        if (!clashId) {
          const { data: clash } = await supabase
            .from(NODES_TABLE).select("id").eq("kind", n.kind).eq("norm_label", newNorm).neq("id", n.id).maybeSingle();
          clashId = clash && clash.id;
        }
        if (clashId) {
          report.skipped_collision++;
          report.collisions.push({ id: n.id, kind: n.kind, norm: newNorm, conflictsWith: clashId });
          continue;                                                      // never break the UNIQUE(kind,norm_label) constraint
        }
        if (report.samples.length < 25) report.samples.push({ id: n.id, kind: n.kind, old: n.label, new: newLabel });
        if (!dryRun) {
          const up = await supabase.from(NODES_TABLE)
            .update({ label: newLabel, norm_label: newNorm, updated_at: new Date().toISOString() })
            .eq("id", n.id);
          if (up.error) { console.error("[M8] relabel update error:", up.error.message); report.errors++; continue; }
        }
        claimed.set(key, n.id);
        report.changed++;
      }
      if (data.length < PAGE) break;
    }
    return report;
  } catch (err) {
    console.error("[M8] relabelNodes error (non-fatal):", err.message);
    return { ...report, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// RETRIEVAL CORE (Session 2 wires these into chat — shipped now so the graph
// is never write-only; see spec critique #1)
// ─────────────────────────────────────────────────────────────────
/** Cosine top-k nodes for a free-text query. Returns [] on any failure. */
async function graphMatch(queryText, opts = {}) {
  try {
    const emb = await embedText(queryText, "RETRIEVAL_QUERY");
    if (!emb) return [];
    const { data, error } = await getClient().rpc("m8_graph_match", {
      query_embedding: emb,
      match_count:     opts.k || 8,
      min_similarity:  opts.minSimilarity != null ? opts.minSimilarity : 0.25,
    });
    if (error) { console.error("[M8] graphMatch rpc error (non-fatal):", error.message); return []; }
    return data || [];
  } catch (err) {
    console.error("[M8] graphMatch error (non-fatal):", err.message);
    return [];
  }
}

/** 1-hop neighbors of a node set: edges + the nodes on their far ends. */
async function fetchNeighbors(nodeIds, opts = {}) {
  try {
    const ids = (nodeIds || []).filter(Boolean).slice(0, 20);
    if (!ids.length) return { edges: [], nodes: [] };
    const supabase = getClient();
    const limit = opts.limit || 40;
    const [a, b] = await Promise.all([
      supabase.from(EDGES_TABLE).select("id, src_id, dst_id, rel, source, confidence").in("src_id", ids).limit(limit),
      supabase.from(EDGES_TABLE).select("id, src_id, dst_id, rel, source, confidence").in("dst_id", ids).limit(limit),
    ]);
    const seen = new Set();
    const edges = [];
    for (const e of [...(a.data || []), ...(b.data || [])]) {
      if (!seen.has(e.id)) { seen.add(e.id); edges.push(e); }
    }
    const farIds = [...new Set(edges.flatMap((e) => [e.src_id, e.dst_id]))].filter((id) => !ids.includes(id));
    let nodes = [];
    if (farIds.length) {
      const { data } = await supabase
        .from(NODES_TABLE)
        .select("id, kind, label, thread, status, source")
        .in("id", farIds.slice(0, 40));
      nodes = data || [];
    }
    return { edges, nodes };
  } catch (err) {
    console.error("[M8] fetchNeighbors error (non-fatal):", err.message);
    return { edges: [], nodes: [] };
  }
}

// Build-42 (D3): for the given leap node ids, return Map(leapId -> {kernelId,
// kernelLabel, kernelClass}) from the leap --derived_from--> kernel edges
// (metadata.decomposition='leap_of_kernel'). The co-retrieval invariant uses this
// so a speculative leap is NEVER surfaced without its kernel + both classifications.
async function fetchKernelLinks(leapIds) {
  try {
    const ids = (leapIds || []).filter(Boolean);
    if (!ids.length) return new Map();
    const supabase = getClient();
    const { data: edges } = await supabase
      .from(EDGES_TABLE)
      .select("src_id, dst_id")
      .in("src_id", ids)
      .eq("rel", "derived_from")
      .eq("metadata->>decomposition", "leap_of_kernel");
    if (!edges || !edges.length) return new Map();
    const kernelIds = [...new Set(edges.map((e) => e.dst_id))];
    const { data: kernels } = await supabase
      .from(NODES_TABLE).select("id, label, source_class").in("id", kernelIds);
    const kById = new Map((kernels || []).map((k) => [k.id, k]));
    const map = new Map();
    for (const e of edges) {
      const k = kById.get(e.dst_id);
      if (k) map.set(e.src_id, { kernelId: k.id, kernelLabel: k.label, kernelClass: k.source_class || "speculative" });
    }
    return map;
  } catch (err) {
    console.error("[M8] fetchKernelLinks error (non-fatal):", err.message);
    return new Map();
  }
}

// ─────────────────────────────────────────────────────────────────
// CHAT RETRIEVAL LANE (Session 2) — "what do I already know about X?" /
// "what contradicts X?" answered from the graph as a HARD-ROUTE: code queries,
// the LLM only narrates the deterministic packet. Same honesty contract as the
// notebook — an empty result renders a CONFIRMED-EMPTY packet so the model
// can't confabulate research that was never recorded.
// ─────────────────────────────────────────────────────────────────

// Eval / smoke sessions are hermetic (mirrors lib/notebook.js): they never read
// the real graph, so probes test behaviour, not Muhammad's stored research.
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// DETECTION — conservative on purpose: "what do I/WE know about X" is a memory
// ask; "what do YOU know about X" is general knowledge and stays out. Notebook
// detection runs BEFORE this lane in the orchestrator, so notebook-shaped reads
// ("what evidence do we have", "where are we on collatz") keep their lane.
const GRAPH_KNOW_RE = /\b(?:what\s+do\s+(?:i|we)\s+(?:already\s+)?know\s+about|what\s+do(?:es)?\s+(?:the\s+|our\s+|my\s+)?(?:memory\s+)?graph\s+(?:know|say|have)\s+(?:about|on)|what(?:'s|\s+is)\s+in\s+(?:the\s+|our\s+|my\s+)?(?:memory\s+)?graph\s+(?:about|on|for)|what\s+(?:do|have)\s+(?:i|we)\s+(?:got\s+)?(?:recorded|stored|learned|found)\s+(?:about|on)|what\s+do\s+(?:i|we)\s+have\s+on)\s+(.{2,80})/i;
const GRAPH_CONTRA_RE = /\b(?:what\s+(?:contradicts|refutes|undermines|argues?\s+against|cuts\s+against|goes\s+against)|(?:is\s+there|do\s+we\s+have|have\s+we\s+(?:got|found))\s+(?:anything|any\s+\w+|evidence)\s+(?:that\s+)?(?:contradict(?:s|ing)?|against|refut(?:es|ing)))\s+(.{2,80})/i;
const GRAPH_SUPPORT_RE = /\bwhat\s+supports\s+(.{2,80})/i;
const GRAPH_RELATED_RE = /\b(?:what(?:'s|\s+is)\s+(?:related|connected)\s+to|how\s+(?:does|is)\s+(.{2,60}?)\s+(?:relate(?:d)?|connect(?:ed)?)\s+to)\s+(.{2,80})/i;
const GRAPH_FORCED_RE  = /^\s*(?:memory\s+)?graph\b[\s:,\-]+(.+)$/i;

function cleanTopic(t) {
  return String(t || "")
    .replace(/[?؟.!]+\s*$/g, "")
    .replace(/^\s*(?:the|our|my)\s+/i, "")
    .trim()
    .slice(0, 100);
}

/** Classify a message as a graph query. Returns { mode, topic } or { mode:null }. */
function detectGraphQuery(message) {
  const s = String(message || "").trim();
  if (s.length < 6) return { mode: null };
  let m = s.match(GRAPH_CONTRA_RE);
  if (m) { const t = cleanTopic(m[1]); if (t) return { mode: "contradicts", topic: t }; }
  m = s.match(GRAPH_KNOW_RE);
  if (m) { const t = cleanTopic(m[1]); if (t) return { mode: "recall", topic: t }; }
  m = s.match(GRAPH_SUPPORT_RE);
  if (m) { const t = cleanTopic(m[1]); if (t) return { mode: "supports", topic: t }; }
  m = s.match(GRAPH_RELATED_RE);
  if (m) { const t = cleanTopic([m[1], m[2]].filter(Boolean).join(" ")); if (t) return { mode: "recall", topic: t }; }
  m = s.match(GRAPH_FORCED_RE);
  if (m) { const t = cleanTopic(m[1]); if (t) return { mode: "recall", topic: t }; }
  return { mode: null };
}

const GRAPH_GROUND = "GROUND TRUTH from Muhammad's persistent RESEARCH MEMORY GRAPH — narrate and reason over it, but do NOT invent nodes, edges, or results beyond this packet, and never upgrade a conjecture into a settled fact. A 'theorem' node has exactly TWO honest origins, distinguished by its labels here: a machine-verified Lean type-check (our work), or a CITED LITERATURE result from the curated external seed pack (marked LITERATURE — someone else's theorem, with its citation; NOT our discovery, NOT machine-verified by us). Nothing else mints a theorem. CRITICAL (live finding 2026-06-12): every SPECIFIC figure you attribute to our research — verification bounds, counts, statuses, dates — must appear in THIS packet. Do NOT pull figures from the conversation-memory block above or from training data and present them as recorded research; if memory suggests more work exists than shown here, say the graph may not have ingested it yet instead of stating it as fact.";

function renderGraphEmptyPacket(topic, mode) {
  const what = mode === "contradicts" ? "contradictions of" : "recorded research about";
  return [
    `RESEARCH MEMORY GRAPH — CONFIRMED EMPTY for "${topic}".`,
    `The graph query returned ZERO nodes for ${what} "${topic}". Nothing about it is in the research memory graph.`,
    `You MUST say plainly that nothing is recorded about ${topic} in the research memory yet. Do NOT supplement with outside knowledge presented as recorded research — any specific finding, bound, or result you name from training data would be a fabrication of Muhammad's research history.`,
    `You may offer to start a notebook thread on it (log a conjecture, evidence, or a next step).`,
  ].join("\n");
}

/**
 * Render the deterministic recall packet: matched nodes (cosine top-k) + the
 * edges among/around them, every line provenance-labelled (code vs
 * machine-extracted). Budget-capped: <=8 nodes, <=12 edge lines.
 */
function renderGraphPacket(det, matches, edges, farNodes, kernelLinks) {
  const byId = new Map();
  for (const n of matches) byId.set(n.id, n);
  for (const n of farNodes || []) if (!byId.has(n.id)) byId.set(n.id, n);
  const name = (id) => {
    const n = byId.get(id);
    if (!n) return null;
    return `"${smartTruncate(n.label || n.content || "", 90)}"`;
  };

  const lines = [
    `RESEARCH MEMORY GRAPH — semantic recall for "${det.topic}" (${matches.length} node${matches.length === 1 ? "" : "s"}, cosine top-k). ${GRAPH_GROUND}`,
    `NODES:`,
  ];
  // Build-14 (M3-lite, spec critique A4): generator survivors carry status
  // tested_to_<N> — label them so recall can never launder M8's own output as
  // recorded knowledge, literature, or an established result.
  const isGenerated = (n) => /^tested_to_/i.test(n.status || "");
  const isExternal  = (n) => n.source === "external";
  let anyGenerated = false, anyExternal = false, anySpecFringe = false, anyLeap = false;
  const links = kernelLinks || new Map();
  const top = matches.slice(0, 8);
  // Build-39: group nodes into trust tiers by verification_state (most-trusted
  // first), cosine order preserved within each tier. This makes the Build-38
  // provenance ACT on the read path, not just appear as a per-node tag —
  // unverified hypotheses can no longer sit visually level with proven results.
  const tierBuckets = TRUST_TIERS.map(() => []);
  top.forEach((n) => {
    let idx = TRUST_TIERS.findIndex((t) => t.state === n.verification_state);
    if (idx === -1) idx = TRUST_TIERS.findIndex((t) => t.state === "unverified");
    tierBuckets[idx].push(n);
  });
  let counter = 0;
  TRUST_TIERS.forEach((tier, ti) => {
    const bucket = tierBuckets[ti];
    if (!bucket.length) return;
    lines.push(tier.header);
    bucket.forEach((n) => {
      counter++;
      // Build-42: a co-retrieved kernel (force-pulled for its leap) has no cosine
      // rank of its own — say so rather than printing a meaningless 0.00.
      const simBit = n.coRetrieved ? "co-retrieved with its leap (kernel)" : `similarity ${Number(n.similarity).toFixed(2)}`;
      const bits = [`thread ${n.thread || "—"}`, simBit];
      if (n.status) bits.push(`status ${n.status}`);
      // Build-42 (D3) co-retrieval: annotate a LEAP node inline with its kernel +
      // the kernel's classification, so both standings are always visible together.
      if (links.has(n.id)) {
        anyLeap = true;
        const k = links.get(n.id);
        bits.push(`decomposed-from kernel "${smartTruncate(k.kernelLabel || "", 90)}" [${(k.kernelClass || "speculative").toUpperCase()}] — speculative LEAP, only meaningful beside its kernel`);
      }
      // Build-38: surface the universal provenance triple so recall states how
      // trustworthy each node is, not just what it says. 'proven' = lean-verified
      // ONLY; 'unverified' = a recorded-but-unchecked hypothesis. (No-op on nodes
      // written before the Build-38 migration backfilled these.)
      if (n.verification_state) {
        const conf = (typeof n.confidence === "number") ? `, confidence ${n.confidence.toFixed(2)}` : "";
        bits.push(`trust: ${n.verification_state}${conf}`);
      }
      // Build-39: a node below the confidence threshold is a weaker bet than its
      // tier alone implies (e.g. an extraction-sourced unverified node at 0.4 vs
      // a curated-seed unverified node at 0.9). 'proven' is exempt — confidence 1.0
      // by construction (lean_verified).
      if (typeof n.confidence === "number" && n.confidence < 0.5 && n.verification_state !== "proven") {
        bits.push("low confidence");
      }
      if (n.source === "extraction") bits.push("machine-extracted");
      // Build-15 (M2): curated literature seeds — the OTHER side of the provenance
      // split. Labeled so recall can never blur cited results with our own output.
      // Build-28: Build-27 also writes source==="external" nodes for Muhammad's
      // ingested documents, each carrying a source_class — those are NOT the
      // curated seed pack and must be tagged by their own classification instead.
      if (isExternal(n)) {
        if (n.source_class === "speculative" || n.source_class === "fringe") {
          anySpecFringe = true;
          bits.push(`[${n.source_class.toUpperCase()}] claim from an ingested document — Muhammad classified this as ${n.source_class}, NOT an established result, NOT literature consensus`);
        } else if (n.source_class === "established") {
          anyExternal = true;
          bits.push(`[ESTABLISHED] cited result from an ingested document — established, but attribute it to its source, not our research`);
        } else {
          anyExternal = true;
          bits.push("LITERATURE — cited external result from the curated seed pack, NOT our work");
        }
      }
      if (isGenerated(n)) { anyGenerated = true; bits.push("MACHINE-GENERATED — M8's own conjecture generator, NOT literature, NOT established"); }
      lines.push(`${counter}. [${n.kind}] ${smartTruncate(n.label || n.content || "", 200)} (${bits.join("; ")})`);
    });
  });
  if (top.length) {
    lines.push(`TRUST TIERS: nodes above are grouped by verification_state, most-trusted first. Lead with VERIFIED/EMPIRICAL findings; treat HEURISTIC/UNVERIFIED nodes as recorded hypotheses and flag them as such if you mention them; REFUTED nodes are known FALSE on this record — never cite as support.`);
  }
  if (anyGenerated) {
    lines.push(`PROVENANCE WARNING: node(s) marked MACHINE-GENERATED are M8's OWN conjecture-generator output, merely tested to the bound in their status — citing one as known mathematics, literature, an established result, or as independent support for anything would be self-contamination. Always name them as "our machine-generated conjecture, tested to N".`);
  }
  if (anyExternal) {
    lines.push(`LITERATURE NOTE: node(s) marked LITERATURE or [ESTABLISHED] are cited external results — established mathematics by OTHERS. Attribute them to their authors, never to our research${anyGenerated ? "; never merge them with our MACHINE-GENERATED conjectures into one list of \"established results\"" : ""}.`);
  }
  if (anySpecFringe) {
    lines.push(`SPECULATIVE/FRINGE NOTE: node(s) marked [SPECULATIVE] or [FRINGE] are claims from documents Muhammad ingested and classified that way himself — they are NOT established results and NOT literature consensus, no matter how confident the source text sounds. Do not narrate them as known mathematics or proven facts; if asked, say plainly that this is a speculative/fringe claim from an ingested source.`);
  }
  if (anyLeap) {
    lines.push(`CO-RETRIEVAL NOTE: a node marked "decomposed-from kernel" is the SPECULATIVE LEAP half of an ingested idea; its established/real core is the named kernel node (shown with its own classification). NEVER present the leap's claim as standing on its own or as established — always pair it with, and defer to, its kernel's standing.`);
  }

  // research_thread anchor edges are structural noise in narration — skip them.
  const threadIds = new Set([...byId.values()].filter((n) => n.kind === "research_thread").map((n) => n.id));
  const interesting = (edges || []).filter((e) => !threadIds.has(e.src_id) && !threadIds.has(e.dst_id));
  const contra = interesting.filter((e) => e.rel === "contradicts");

  const edgeLine = (e) => {
    const a = name(e.src_id), b = name(e.dst_id);
    if (!a || !b) return null;
    const prov = e.source === "extraction" ? ` [machine-extracted, confidence ${Number(e.confidence).toFixed(1)} — suggestive, not authoritative]` : " [code-recorded]";
    return `- ${a} ${e.rel.replace(/_/g, " ")} ${b}${prov}`;
  };

  // Build-15 (round-3 unsolicited risk #2, Gemini): when the edge set exceeds
  // the render cap, SAY SO with counts by relation instead of silently
  // truncating — a packet that hides edges starves the narration of structure
  // it thinks it has seen in full.
  const EDGE_CAP = 12;
  const edgeSummary = (allEdges, shownCount) => {
    const hidden = allEdges.length - shownCount;
    if (hidden <= 0) return null;
    const byRel = new Map();
    for (const e of allEdges.slice(shownCount)) byRel.set(e.rel, (byRel.get(e.rel) || 0) + 1);
    const parts = [...byRel.entries()].map(([rel, n]) => `${rel.replace(/_/g, " ")} x${n}`);
    return `- (+${hidden} more edge${hidden === 1 ? "" : "s"} on record, not shown: ${parts.join(", ")})`;
  };

  if (det.mode === "contradicts") {
    lines.push(`CONTRADICTIONS ON RECORD:`);
    const resolvable = contra.filter((e) => edgeLine(e));
    const cl = resolvable.slice(0, EDGE_CAP).map(edgeLine);
    if (cl.length) {
      lines.push(...cl);
      const sum = edgeSummary(resolvable, cl.length);
      if (sum) lines.push(sum);
    }
    else lines.push(`- NONE recorded. No counterexample or contradicting evidence is linked to these nodes in the graph. Say that plainly — do not invent objections and present them as recorded research (you MAY separately reason about weaknesses, clearly framed as your own analysis, not the ledger's).`);
  } else {
    const resolvable = interesting.filter((e) => edgeLine(e));
    const el = resolvable.slice(0, EDGE_CAP).map(edgeLine);
    if (el.length) {
      lines.push(`CONNECTIONS:`);
      lines.push(...el);
      const sum = edgeSummary(resolvable, el.length);
      if (sum) lines.push(sum);
    }
    else lines.push(`CONNECTIONS: none recorded among these nodes yet.`);
  }

  lines.push(`Answer Boss's question from this packet ONLY. Keep a clean separation: (1) what is RECORDED — exactly the nodes/edges above; (2) any general mathematical context you add must carry NO specific figures presented as ours. If the packet doesn't contain what he asked for, say what's missing and offer to log it.`);
  return lines.join("\n");
}

/**
 * ORCHESTRATOR ENTRY POINT (mirrors buildNotebookContext's shape):
 * { text, mode, data } — text empty when this isn't a graph turn or on any
 * failure-with-no-detection. A DETECTED query that finds nothing (or errors)
 * renders the CONFIRMED-EMPTY packet, never silence — silence here would drop
 * the model straight into confabulating "what we know". Read-only; fails safe.
 */
async function buildGraphContext(message, sessionId) {
  const det = detectGraphQuery(message);
  if (!det.mode) return { text: "", mode: null, data: null };
  if (process.env.GRAPH_DISABLED === "1") return { text: "", mode: null, data: null };

  // Hermetic eval sessions: deterministic honest-empty, zero DB reads.
  if (isEphemeralSession(sessionId)) {
    return { text: renderGraphEmptyPacket(det.topic, det.mode), mode: det.mode, data: { nodes: 0, ephemeral: true } };
  }

  try {
    // CONTEXT-DILUTION GUARD (Build-13 / team round 2): M1 probe packs multiply
    // evidence nodes fast, and a recall flooded with censuses pushes conjectures,
    // theorems and the honesty contract out of attention (RAG-poisoning risk).
    // HARD deterministic cap: at most GRAPH_EVIDENCE_CAP evidence/external nodes
    // per turn; non-evidence kinds keep their similarity rank. Code-level — not
    // a prompt request.
    const EVIDENCE_CAP = parseInt(process.env.GRAPH_EVIDENCE_CAP, 10) || 4;
    const raw = await graphMatch(det.topic, { k: 12, minSimilarity: 0.25 });
    const matches = [];
    let evCount = 0;
    for (const n of raw) {
      const diluting = n.kind === "evidence" || n.source === "external";
      if (diluting && evCount >= EVIDENCE_CAP) continue;
      if (diluting) evCount++;
      matches.push(n);
      if (matches.length >= 8) break;
    }
    if (!matches.length) {
      return { text: renderGraphEmptyPacket(det.topic, det.mode), mode: det.mode, data: { nodes: 0 } };
    }
    // Build-28: annotate external matches with their source_class so the
    // packet can distinguish curated literature from ingested
    // established/speculative/fringe claims (see renderGraphPacket).
    const externalIds = matches.filter((n) => n.source === "external").map((n) => n.id);
    if (externalIds.length) {
      const { fetchSourceClasses } = require("./knowledge-intake");
      const sourceClassById = await fetchSourceClasses(externalIds);
      for (const n of matches) if (sourceClassById.has(n.id)) n.source_class = sourceClassById.get(n.id);
    }
    // Build-42 (D3) co-retrieval invariant: for any matched LEAP node, force its
    // kernel into the render set (even if it missed the cosine top-k), capped to
    // protect attention. So a speculative leap is never surfaced without its kernel.
    const kernelLinks = await fetchKernelLinks(matches.map((m) => m.id));
    if (kernelLinks.size) {
      const present = new Set(matches.map((m) => m.id));
      const missing = [...new Set([...kernelLinks.values()].map((v) => v.kernelId))]
        .filter((id) => !present.has(id)).slice(0, 4);
      if (missing.length) {
        const { data: kn } = await getClient().from(NODES_TABLE)
          .select("id, kind, label, content, thread, status, source, source_class, verification_state, confidence")
          .in("id", missing);
        for (const n of kn || []) { n.coRetrieved = true; n.similarity = 0; matches.push(n); }
      }
    }
    const { edges, nodes: farNodes } = await fetchNeighbors(matches.map((m) => m.id));
    return {
      text: renderGraphPacket(det, matches, edges, farNodes, kernelLinks),
      mode: det.mode,
      data: { nodes: matches.length, edges: edges.length, topic: det.topic, kernelLinks: kernelLinks.size },
    };
  } catch (err) {
    console.error("[M8] graph retrieval error (non-fatal):", err.message);
    return { text: renderGraphEmptyPacket(det.topic, det.mode), mode: det.mode, data: { nodes: 0, error: err.message } };
  }
}

// ─────────────────────────────────────────────────────────────────
// M2 NOVELTY — embedding SECOND pass (Build-15). The deterministic
// canonical-form pass lives in lib/seed-pack.js (sync, in the generator). This
// pass adds semantic ADJACENCY: each survivor statement vs the live external
// (literature) nodes by cosine. Suggestive only — narrated as "semantically
// close to", never as an identity claim. Fail-safe: any error → no lines.
// Skipped for hermetic eval sessions (no DB reads in probes).
// ─────────────────────────────────────────────────────────────────
const NOVELTY_SIM_MIN = 0.82;
async function noveltySemanticPass(survivorStatements, sessionId) {
  const out = { lines: [], text: "" };
  try {
    if (process.env.GRAPH_DISABLED === "1") return out;
    if (isEphemeralSession(sessionId)) return out;
    const stmts = (survivorStatements || []).filter(Boolean).slice(0, 5);
    if (!stmts.length) return out;
    const { fetchNodeSourceClass } = require("./knowledge-intake");
    const checks = await Promise.all(stmts.map(async (stmt, i) => {
      const hits = await graphMatch(stmt, { k: 6, minSimilarity: NOVELTY_SIM_MIN });
      const ext = (hits || []).filter((n) => n.source === "external");
      if (!ext.length) return null;
      const top = ext[0];
      const label = smartTruncate(top.label || "", 120);
      const cosine = Number(top.similarity).toFixed(2);
      const sourceClass = await fetchNodeSourceClass(top.id);
      if (sourceClass === "speculative" || sourceClass === "fringe") {
        return `- survivor ${i + 1} is semantically CLOSE to a claim from an ingested document marked [${sourceClass.toUpperCase()}]: "${label}" (cosine ${cosine}) — this is NOT an established result; do not narrate it as known mathematics.`;
      }
      return `- survivor ${i + 1} is semantically CLOSE to a known literature result: "${label}" (cosine ${cosine}) — possible known-form overlap; the deterministic novelty check is authoritative, this is adjacency only.`;
    }));
    out.lines = checks.filter(Boolean);
    if (out.lines.length) {
      out.text = [
        ``,
        `NOVELTY ADJACENCY (embedding pass vs the curated literature seeds — suggestive, not a literature search):`,
        ...out.lines,
      ].join("\n");
    }
    return out;
  } catch (err) {
    console.error("[M8] novelty semantic pass error (non-fatal):", err.message);
    return out;
  }
}

module.exports = {
  ingestNote, runGraphSweep, relabelNodes, graphMatch, fetchNeighbors,
  buildGraphContext, detectGraphQuery, noveltySemanticPass,
  // exported for tests / future reuse:
  upsertNode, addEdge, ensureThreadNode, latestConjectureNode,
  mapNoteToNode, leanFromContent, normLabel, smartTruncate, l2normalize,
  embedText, buildExtractionPrompt, parseExtraction, extractFromNote,
  renderGraphPacket, renderGraphEmptyPacket,
  EXTRACTION_SYSTEM, NODE_KINDS, EDGE_RELS,
  // Build-38 provenance derivations (shared with intake + tests):
  deriveEvidenceKind, deriveConfidence, deriveVerificationState,
  confidenceFromExtraction, isMissingProvenanceColumn,
  EVIDENCE_KINDS, VERIFICATION_STATES,
  // Build-39 read-path trust tiers (shared with tests):
  TRUST_TIERS,
  // Build-41 (D2) schema edge-ban (shared with tests):
  edgeAllowed, EVIDENCE_BEARING_RELS,
  // Build-42 (D3) kernel/leap co-retrieval:
  fetchKernelLinks,
};
