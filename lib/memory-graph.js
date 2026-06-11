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

    if (ex.data && ex.data.id) {
      const patch = { updated_at: new Date().toISOString() };
      if (fields.content)  patch.content  = String(fields.content).slice(0, 4000);
      if (fields.status)   patch.status   = fields.status;
      if (fields.noteId)   patch.note_id  = fields.noteId;
      const meta = (ex.data.metadata && typeof ex.data.metadata === "object") ? ex.data.metadata : {};
      patch.metadata = { ...meta, ...(fields.metadata || {}), merge_count: (meta.merge_count || 0) + 1 };
      await supabase.from(NODES_TABLE).update(patch).eq("id", ex.data.id);
      return { id: ex.data.id, kind, norm_label: norm, existing: true };
    }

    let embedding = null;
    if (fields.embed !== false) {
      embedding = await embedText(fields.content || label, "RETRIEVAL_DOCUMENT");
    }
    const ins = await supabase
      .from(NODES_TABLE)
      .insert([{
        kind,
        label,
        norm_label:      norm,
        content:         fields.content ? String(fields.content).slice(0, 4000) : null,
        thread:          fields.thread || null,
        status:          fields.status || null,
        source:          fields.source === "extraction" ? "extraction" : "code",
        note_id:         fields.noteId || null,
        session_id:      fields.sessionId || null,
        embedding,
        embedding_model: embedding ? EMBED_MODEL() : null,
        metadata:        fields.metadata || {},
      }])
      .select("id")
      .single();
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

/** Latest current conjecture node in a thread (for code-owned edge targets). */
async function latestConjectureNode(thread) {
  try {
    const { data } = await getClient()
      .from(NODES_TABLE)
      .select("id, label")
      .eq("kind", "conjecture")
      .eq("thread", thread)
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
      const label = String(note.content).trim().slice(0, 160);
      primary = await upsertNode({
        kind:      mapped.kind,
        label,
        content:   note.content,
        thread,
        status:    mapped.status,
        noteId:    note.id || null,
        sessionId: note.session_id || null,
        metadata:  { origin_kind: note.kind, stance: note.stance || null },
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
              const rel = note.stance === "against" ? "contradicts" : "supports";
              await addEdge({ srcId: primary.id, dstId: conj.id, rel, noteId: note.id });
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
const GRAPH_KNOW_RE = /\b(?:what\s+do\s+(?:i|we)\s+(?:already\s+)?know\s+about|what\s+do(?:es)?\s+(?:the\s+|our\s+|my\s+)?(?:memory\s+)?graph\s+(?:know|say|have)\s+about|what\s+(?:do|have)\s+(?:i|we)\s+(?:got\s+)?(?:recorded|stored|learned|found)\s+(?:about|on)|what\s+do\s+(?:i|we)\s+have\s+on)\s+(.{2,80})/i;
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

const GRAPH_GROUND = "GROUND TRUTH from Muhammad's persistent RESEARCH MEMORY GRAPH — narrate and reason over it, but do NOT invent nodes, edges, or results beyond this packet, and never upgrade a conjecture into a settled fact. A 'theorem' node means exactly one thing: a machine-verified Lean type-check — nothing more. CRITICAL (live finding 2026-06-12): every SPECIFIC figure you attribute to our research — verification bounds, counts, statuses, dates — must appear in THIS packet. Do NOT pull figures from the conversation-memory block above or from training data and present them as recorded research; if memory suggests more work exists than shown here, say the graph may not have ingested it yet instead of stating it as fact.";

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
function renderGraphPacket(det, matches, edges, farNodes) {
  const byId = new Map();
  for (const n of matches) byId.set(n.id, n);
  for (const n of farNodes || []) if (!byId.has(n.id)) byId.set(n.id, n);
  const name = (id) => {
    const n = byId.get(id);
    if (!n) return null;
    return `"${String(n.label || n.content || "").slice(0, 90)}"`;
  };

  const lines = [
    `RESEARCH MEMORY GRAPH — semantic recall for "${det.topic}" (${matches.length} node${matches.length === 1 ? "" : "s"}, cosine top-k). ${GRAPH_GROUND}`,
    `NODES:`,
  ];
  matches.slice(0, 8).forEach((n, i) => {
    const bits = [`thread ${n.thread || "—"}`, `similarity ${Number(n.similarity).toFixed(2)}`];
    if (n.status) bits.push(`status ${n.status}`);
    if (n.source === "extraction") bits.push("machine-extracted");
    lines.push(`${i + 1}. [${n.kind}] ${String(n.label || n.content || "").slice(0, 200)} (${bits.join("; ")})`);
  });

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

  if (det.mode === "contradicts") {
    lines.push(`CONTRADICTIONS ON RECORD:`);
    const cl = contra.map(edgeLine).filter(Boolean).slice(0, 12);
    if (cl.length) lines.push(...cl);
    else lines.push(`- NONE recorded. No counterexample or contradicting evidence is linked to these nodes in the graph. Say that plainly — do not invent objections and present them as recorded research (you MAY separately reason about weaknesses, clearly framed as your own analysis, not the ledger's).`);
  } else {
    const el = interesting.map(edgeLine).filter(Boolean).slice(0, 12);
    if (el.length) { lines.push(`CONNECTIONS:`); lines.push(...el); }
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
    const matches = await graphMatch(det.topic, { k: 8, minSimilarity: 0.25 });
    if (!matches.length) {
      return { text: renderGraphEmptyPacket(det.topic, det.mode), mode: det.mode, data: { nodes: 0 } };
    }
    const { edges, nodes: farNodes } = await fetchNeighbors(matches.map((m) => m.id));
    return {
      text: renderGraphPacket(det, matches, edges, farNodes),
      mode: det.mode,
      data: { nodes: matches.length, edges: edges.length, topic: det.topic },
    };
  } catch (err) {
    console.error("[M8] graph retrieval error (non-fatal):", err.message);
    return { text: renderGraphEmptyPacket(det.topic, det.mode), mode: det.mode, data: { nodes: 0, error: err.message } };
  }
}

module.exports = {
  ingestNote, runGraphSweep, graphMatch, fetchNeighbors,
  buildGraphContext, detectGraphQuery,
  // exported for tests / future reuse:
  upsertNode, addEdge, ensureThreadNode, latestConjectureNode,
  mapNoteToNode, leanFromContent, normLabel, l2normalize,
  embedText, buildExtractionPrompt, parseExtraction, extractFromNote,
  renderGraphPacket, renderGraphEmptyPacket,
  EXTRACTION_SYSTEM, NODE_KINDS, EDGE_RELS,
};
