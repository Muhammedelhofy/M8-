/**
 * M8 M4-manual — Human-Architected Lemma-DAG Scaffolding  (Build-18)
 *
 * The rung between `lean_stated` and a real proof. A HUMAN supplies a lemma DAG in
 * plain English; M8 formalizes + machine-checks the LEAVES via the Lean lane
 * (/check) and scaffolds the parents as honest `sorry`. M8 does NOT invent the
 * decomposition and does NOT search for proofs (de-scoped, NORTH_STAR) — it only
 * formalizes the leaves the human named.
 *
 * LOAD-BEARING HONESTY (BUILD_18_SPEC §0, the iron rule):
 *   - The ONLY progress reported is "leaves verified k / m". There is NO "% proven"
 *     for the target — a sorried parent is UNPROVEN, and 100% leaves discharged is
 *     NOT a proof. The target stays a `conjecture` (<= lean_stated) at every count.
 *   - /check is the ONLY ground truth. `sorry` -> lean_stated (honest, not proven).
 *     A verified leaf -> `theorem` node (lean_verified) — the existing graph rule,
 *     unchanged. The target is NEVER minted a theorem in v1.
 *   - Leaf proofs may use induction + named Mathlib lemmas (leaf-mode), but the
 *     injection screen (axiom/unsafe/#eval/#check/macro/set_option/extra import) and
 *     the UNFORMALIZABLE escape are unchanged. The adversarial invalid-shortcut probe
 *     proves a qualifying leaf's structure is NECESSARY, not pattern-matched.
 *
 * Fails SAFE everywhere (mirrors review-queue.js / memory-graph.js): any Supabase /
 * model / Lean error logs and returns a degraded result; nothing here throws into
 * the orchestrator. Kill switch: LEMMA_DAG_DISABLED=1.
 */
const { createClient } = require("@supabase/supabase-js");
const { generateOnce } = require("./llm");
const { runLeanCheck } = require("./leanClient");
const { interpretLeanResult, sanitizeLeanCode, hasBannedTokens, isUnformalizable } = require("./lean");
const { upsertNode, addEdge, ensureThreadNode, normLabel } = require("./memory-graph");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
const TABLE = "m8_lemma_scaffold";
const M4_VERSION = 1;
const M4_THREAD = "collatz-m4";                 // scaffolds land in their own thread (never the main supports target)
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// ─────────────────────────────────────────────────────────────────
// PURE CORE — parse / counts / namespaces / signature (PS-mirror-tested)
// ─────────────────────────────────────────────────────────────────
/**
 * Parse a semi-structured lemma DAG. Deterministic, sync. Returns
 *   { ok, target, lemmas:[{idx,name,prose,deps:[idx],is_leaf}], leaves:[idx], errors:[] }
 * Leaves = lemmas whose deps are empty. Rejects (ok:false) on: no target, no lemma,
 * a dep referencing a missing lemma (dangling), a cycle, or no leaf at all — and
 * nothing is formalized in those cases.
 *
 * Format:
 *   target: <prose>
 *   L1: <prose>
 *   L2: <prose>  [deps: L1]
 *   L3: <prose>  [deps: L1, L2]
 */
function parseDAG(message) {
  const s = String(message || "");
  const errors = [];
  const tm = s.match(/^\s*target\s*:\s*(.+?)\s*$/im);
  const target = tm ? tm[1].trim() : "";
  if (!target) errors.push("no `target:` line found");

  const lemmas = [];
  const re = /^\s*L(\d+)\s*:\s*(.+?)\s*$/gim;
  let m;
  while ((m = re.exec(s)) !== null) {
    const idx = parseInt(m[1], 10);
    let body = m[2].trim();
    const dm = body.match(/\[\s*deps?\s*:\s*([^\]]*)\]\s*$/i);
    let deps = [];
    if (dm) {
      deps = (dm[1].match(/\d+/g) || []).map((x) => parseInt(x, 10));
      body = body.slice(0, dm.index).trim();
    }
    lemmas.push({ idx, name: `L${idx}`, prose: body, deps, is_leaf: deps.length === 0 });
  }
  if (!lemmas.length) errors.push("no `L<n>:` lemma lines found");

  // dangling-dep + self-dep check
  const known = new Set(lemmas.map((l) => l.idx));
  for (const l of lemmas) {
    for (const d of l.deps) {
      if (!known.has(d)) errors.push(`L${l.idx} depends on missing L${d}`);
      if (d === l.idx)   errors.push(`L${l.idx} depends on itself`);
    }
  }
  // cycle check (DFS over the dep graph)
  if (!errors.length) {
    const byIdx = new Map(lemmas.map((l) => [l.idx, l]));
    const state = new Map();   // idx -> 0 unvisited | 1 in-stack | 2 done
    const dfs = (idx) => {
      state.set(idx, 1);
      for (const d of (byIdx.get(idx) || { deps: [] }).deps) {
        const st = state.get(d) || 0;
        if (st === 1) return true;                 // back-edge => cycle
        if (st === 0 && dfs(d)) return true;
      }
      state.set(idx, 2);
      return false;
    };
    for (const l of lemmas) {
      if ((state.get(l.idx) || 0) === 0 && dfs(l.idx)) { errors.push("dependency cycle detected"); break; }
    }
  }

  const leaves = lemmas.filter((l) => l.is_leaf).map((l) => l.idx);
  if (lemmas.length && !leaves.length && !errors.length) errors.push("no leaf lemma (every lemma has a dependency)");

  return { ok: errors.length === 0, target, lemmas, leaves, errors };
}

// Distinct Mathlib-looking namespaces referenced in a proof (Nat.*, Finset.*, …).
// Used for the §0.4 "qualifying leaf" check (>= 2 distinct namespaces).
function leanNamespacesUsed(code) {
  const out = new Set();
  const re = /\b([A-Z][A-Za-z0-9]*)\.[A-Za-z]/g;
  let m;
  while ((m = re.exec(String(code || ""))) !== null) out.add(m[1]);
  return [...out];
}
const HAS_INDUCTION = /\binduction\b|\binduction'\b|\bNat\.rec\b|\brec\b\s*\(/;

/** A verified leaf "qualifies" for the gate iff: verified + uses induction + >=2 namespaces. */
function isQualifyingLeaf(leanStatus, code) {
  return leanStatus === "lean_verified" && HAS_INDUCTION.test(String(code || "")) && leanNamespacesUsed(code).length >= 2;
}

// Strip the proof term so we can re-attach an INVALID shortcut (gate probe). The
// proof starts at the first top-level ` := ` after the statement type.
function statementSignature(code) {
  const c = String(code || "").trim();
  const i = c.indexOf(":=");
  return i > 0 ? c.slice(0, i).trim() : null;
}

function computeCounts(lemmas) {
  const leaves = lemmas.filter((l) => l.is_leaf);
  return {
    leaf_count:       leaves.length,
    leaves_verified:  leaves.filter((l) => l.lean_status === "lean_verified").length,
    parents_sorried:  lemmas.filter((l) => !l.is_leaf).length,
  };
}

// ─────────────────────────────────────────────────────────────────
// DETECTION — scaffold (heavy: drafts + /checks) vs view (cheap read)
// ─────────────────────────────────────────────────────────────────
const SCAFFOLD_VERB = /\b(?:scaffold(?:\s+this)?(?:\s+proof)?|lemma[-\s]?dag|decompose\b[^.?!]*\binto\s+lemmas|formaliz(?:e|ing)\s+(?:the\s+)?(?:base\s+)?(?:leaves|lemmas))\b/i;
const HAS_LEMMA_LINE = /^\s*L\d+\s*:/im;
const VIEW_RE = /\b(?:show|view|display|list|what'?s\s+in)\b[^.?!]*\b(?:proof\s+)?scaffold|\blemma[-\s]?dag\b/i;

/** { mode: 'scaffold'|'view'|null, id? }. Scaffold requires the L<n>: structural anchor. */
function detectLemmaDAG(message) {
  const s = String(message || "").trim();
  if (s.length < 6) return { mode: null };
  if (SCAFFOLD_VERB.test(s) && HAS_LEMMA_LINE.test(s)) return { mode: "scaffold" };
  if (VIEW_RE.test(s)) {
    const idm = s.match(/#(\d+)/);
    return { mode: "view", id: idm ? parseInt(idm[1], 10) : null };
  }
  return { mode: null };
}

// ─────────────────────────────────────────────────────────────────
// LEAF FORMALIZATION — leaf-mode directive (structured proof permitted),
// honesty spine reused verbatim from lean.js (screen + verdict + escape).
// ─────────────────────────────────────────────────────────────────
const LEAF_SYSTEM = `You are a Lean 4 + Mathlib formalization assistant. You translate ONE mathematical LEMMA (a base step of a human-architected proof DAG) into ONE Lean 4 declaration that elaborates against Mathlib.

OUTPUT CONTRACT — follow exactly:
- Output ONLY raw Lean 4 code. No markdown fences, no prose, no comments.
- Exactly one \`theorem\` (or \`lemma\`) with a snake_case name.
- Do NOT include ANY \`import\` line — Mathlib is already imported. Start with the theorem.
- BANNED anywhere: \`#eval\`, \`#check\`, \`#print\`, \`axiom\`, \`unsafe\`, \`macro\`, \`set_option\`, and ANY \`import\` line. (The checker rejects these as injection.)
- PROOF POLICY (leaf mode — a STRUCTURED proof is allowed, unlike a one-liner):
  • You MAY use \`by\` with: \`induction\` / \`induction'\` (structural induction), \`rcases\`/\`obtain\`/\`cases\`, \`intro\`, \`constructor\`, and the application of NAMED Mathlib lemmas (e.g. \`exact Nat.succ_le_of_lt h\`, \`simp [Nat.add_comm]\`), plus the closers \`rfl\`, \`decide\`, \`norm_num\`, \`simp\`, \`omega\`, \`ring\`.
  • Prefer a genuine proof. If you are NOT able to prove it, close it with \`:= by sorry\`. A \`sorry\` is HONEST and expected — do NOT invent a bogus proof, and NEVER use \`axiom\` or weaken the statement to make it pass.
- Do not restate or weaken the lemma to make it pass. The statement must faithfully formalize exactly what was asked.
- If the lemma references a concept that does not exist in Mathlib and cannot be faithfully stated, output EXACTLY one line \`UNFORMALIZABLE: <short reason>\` and nothing else.`;

function buildLeafDirective(prose, priorError) {
  let user = `Formalize and prove this base lemma as one Lean 4 theorem (use induction and named Mathlib lemmas as needed):\n\n${String(prose || "").trim()}`;
  if (priorError) {
    user += `\n\nYour previous attempt was REJECTED by Lean with this error:\n---\n${String(priorError).slice(0, 1200)}\n---\nFix it. Output ONLY the corrected Lean 4 code, same contract.`;
  }
  return { system: LEAF_SYSTEM, user };
}

function resolveFormalizeModel() {
  const provider = (process.env.LEAN_FORMALIZE_PROVIDER || "gemini").toLowerCase();
  let model = process.env.LEAN_FORMALIZE_MODEL || null;
  if (!model && provider === "anthropic")  model = "claude-fable-5";
  if (!model && provider === "openrouter") model = "anthropic/claude-fable-5";
  return { provider, model };
}

async function draftLeaf(prose, priorError, meta) {
  const { provider, model } = resolveFormalizeModel();
  const { system, user } = buildLeafDirective(prose, priorError);
  const raw = await generateOnce({
    provider, model,
    systemInstruction: system,
    contents: [{ role: "user", parts: [{ text: user }] }],
    genConfig: { temperature: 0, maxOutputTokens: 900 },
    meta,
  });
  return sanitizeLeanCode(raw);
}

/**
 * Discharge ONE leaf: draft (leaf-mode) -> screen -> /check -> ONE repair -> verdict.
 * Returns { lean_status, code, namespaces, qualifying, reason }. Never throws.
 */
async function dischargeLeaf(prose, { meta, log } = {}) {
  let code;
  try { code = await draftLeaf(prose, null, meta); }
  catch (e) { return { lean_status: "lean_error", code: null, namespaces: [], qualifying: false, reason: "draft failed" }; }

  if (isUnformalizable(code)) return { lean_status: "lean_unformalizable", code: null, namespaces: [], qualifying: false };
  if (hasBannedTokens(code))  return { lean_status: "lean_rejected", code, namespaces: [], qualifying: false, reason: "banned tokens" };

  let chk = await runLeanCheck({ code });
  if (chk.ok) {
    let result = interpretLeanResult(chk.data);
    if (result.kind === "lean_rejected") {                 // ONE repair (mirror lean.js)
      try {
        const code2 = await draftLeaf(prose, result.errorText, meta);
        if (!isUnformalizable(code2) && !hasBannedTokens(code2)) {
          const chk2 = await runLeanCheck({ code: code2 });
          if (chk2.ok) { code = code2; result = interpretLeanResult(chk2.data); }
        }
      } catch (_) { /* keep first verdict */ }
    }
    if (log) log("m4_leaf", { leanKind: result.kind });
    const ns = leanNamespacesUsed(code);
    return { lean_status: result.kind, code, namespaces: ns, qualifying: isQualifyingLeaf(result.kind, code), reason: result.errorText || null };
  }
  // pending/error → fail safe
  if (log) log("m4_leaf_service", { leanStatus: chk.status });
  return { lean_status: chk.status === "lean_pending" ? "lean_pending" : "lean_error", code, namespaces: [], qualifying: false };
}

/**
 * GATE BELT — submit a QUALIFYING leaf's statement with forced one-line shortcuts
 * (`:= by decide`, `:= by simp`) and assert BOTH are NOT verified — proving the
 * induction structure is NECESSARY (anti-laundering). Returns { rejected, detail }.
 */
async function runInvalidShortcutProbe(verifiedCode) {
  const sig = statementSignature(verifiedCode);
  if (!sig) return { rejected: false, detail: "no signature" };
  const shortcuts = [`${sig} := by decide`, `${sig} := by simp`];
  const verdicts = [];
  for (const sc of shortcuts) {
    if (hasBannedTokens(sc)) { verdicts.push("screened"); continue; }
    const chk = await runLeanCheck({ code: sc });
    if (!chk.ok) { verdicts.push(chk.status); continue; }
    verdicts.push(interpretLeanResult(chk.data).kind);
  }
  const anyVerified = verdicts.some((v) => v === "lean_verified");
  return { rejected: !anyVerified, detail: verdicts.join(", ") };
}

// ─────────────────────────────────────────────────────────────────
// SCAFFOLD RUN (heavy path — drafts + /checks; buffered, like the Lean lane)
// ─────────────────────────────────────────────────────────────────
/**
 * Parse + discharge leaves + gate probe + render. Returns { text, ok, write }.
 * `write` is the staged persistence applied ONCE at STORE via persistScaffold().
 * Never throws.
 */
async function scaffoldProof(message, sessionId, { meta, log } = {}) {
  if (process.env.LEMMA_DAG_DISABLED === "1") return { text: "", ok: false, write: null };
  const dag = parseDAG(message);
  if (!dag.ok) {
    return { text: renderParseErrorPacket(dag), ok: false, write: null };
  }
  // discharge each leaf (hermetic eval sessions skip the network — deterministic empty)
  if (isEphemeralSession(sessionId)) {
    return { text: renderScaffoldPacket(dag.target, dag.lemmas, computeCounts(dag.lemmas), { ephemeral: true }), ok: true, write: null };
  }
  let qualifyingLeaf = false, shortcutRejected = false, gateDetail = "";
  for (const lemma of dag.lemmas) {
    if (!lemma.is_leaf) { lemma.lean_status = "scaffolded"; continue; }   // parents held as honest scaffold (sorry)
    const r = await dischargeLeaf(lemma.prose, { meta, log });
    lemma.lean_status = r.lean_status;
    lemma.code = r.code || null;
    lemma.namespaces = r.namespaces || [];
    lemma.reason = r.reason || null;
    if (r.qualifying && !qualifyingLeaf) {
      qualifyingLeaf = true;
      const probe = await runInvalidShortcutProbe(r.code);            // gate belt on the first qualifying leaf
      shortcutRejected = probe.rejected;
      gateDetail = probe.detail;
    }
  }
  const counts = computeCounts(dag.lemmas);
  const gate = { qualifying_leaf: qualifyingLeaf, shortcut_rejected: shortcutRejected, detail: gateDetail };
  const text = renderScaffoldPacket(dag.target, dag.lemmas, counts, { gate });
  return { text, ok: true, write: { target: dag.target, lemmas: dag.lemmas, counts, gate, sessionId } };
}

// ─────────────────────────────────────────────────────────────────
// PERSISTENCE — graph (reuse) + the working-state table. Applied at STORE.
// ─────────────────────────────────────────────────────────────────
/**
 * Graph: target -> conjecture node; verified leaf -> theorem node (lean_verified);
 * other lemma -> conjecture node. depends_on edges = the DAG. Plus the
 * m8_lemma_scaffold working row. Fail-safe; never blocks the turn.
 */
async function persistScaffold(write) {
  const out = { nodes: 0, edges: 0, row: false };
  if (!write || process.env.LEMMA_DAG_DISABLED === "1") return out;
  try {
    if (process.env.GRAPH_DISABLED !== "1") {
      await ensureThreadNode(M4_THREAD, write.sessionId);
      const targetNode = await upsertNode({
        kind: "conjecture", label: write.target, content: `[M4 target] ${write.target}`,
        thread: M4_THREAD, metadata: { m4_target: true, m4_version: M4_VERSION },
      });
      if (targetNode && targetNode.id) out.nodes++;
      const idToNode = new Map();
      for (const l of write.lemmas) {
        const verified = l.is_leaf && l.lean_status === "lean_verified";
        const node = await upsertNode({
          kind:    verified ? "theorem" : "conjecture",
          label:   `${l.name}: ${l.prose}`,
          content: `[M4 ${l.is_leaf ? "leaf" : "parent"} ${l.name}] ${l.prose}${l.code ? `\n${l.code}` : ""}`,
          thread:  M4_THREAD,
          status:  verified ? "lean_verified" : (l.lean_status === "lean_stated" ? "lean_stated" : null),
          metadata: { m4_lemma: l.name, is_leaf: l.is_leaf, lean_status: l.lean_status, namespaces: l.namespaces || [] },
        });
        if (node && node.id) { out.nodes++; idToNode.set(l.idx, node.id); l.node_id = node.id; }
      }
      // depends_on edges: target -> each lemma, and parent -> child
      if (targetNode && targetNode.id) {
        for (const l of write.lemmas) {
          const lid = idToNode.get(l.idx);
          if (lid && (await addEdge({ srcId: targetNode.id, dstId: lid, rel: "depends_on" }))) out.edges++;
          for (const d of l.deps || []) {
            const did = idToNode.get(d);
            if (lid && did && (await addEdge({ srcId: lid, dstId: did, rel: "depends_on" }))) out.edges++;
          }
        }
      }
    }
    out.row = await upsertScaffoldRow(write);
    return out;
  } catch (err) {
    console.error("[M8] lemma-dag persist error (non-fatal):", err.message);
    return { ...out, error: err.message };
  }
}

async function upsertScaffoldRow(write) {
  try {
    const norm = normLabel(write.target);
    if (!norm) return false;
    const c = write.counts, g = write.gate || {};
    const status = (c.leaf_count > 0 && c.leaves_verified === c.leaf_count) ? "leaves_done" : "open";  // NEVER 'proven'
    const payload = {
      target: write.target, target_norm: norm,
      lemmas: write.lemmas.map((l) => ({
        idx: l.idx, name: l.name, prose: l.prose, deps: l.deps, is_leaf: l.is_leaf,
        lean_status: l.lean_status, node_id: l.node_id || null,
        code: l.code ? String(l.code).slice(0, 1200) : null, namespaces: l.namespaces || [],
        reason: l.reason ? String(l.reason).slice(0, 800) : null,
      })),
      leaf_count: c.leaf_count, leaves_verified: c.leaves_verified, parents_sorried: c.parents_sorried,
      gate_qualifying_leaf: !!g.qualifying_leaf, gate_shortcut_rejected: !!g.shortcut_rejected,
      status, metadata: { m4_version: M4_VERSION, gate_detail: g.detail || "" },
      updated_at: new Date().toISOString(),
    };
    const sb = getClient();
    const ex = await sb.from(TABLE).select("id").eq("target_norm", norm).maybeSingle();
    if (ex.data && ex.data.id) {
      const u = await sb.from(TABLE).update(payload).eq("id", ex.data.id);
      return !u.error;
    }
    const ins = await sb.from(TABLE).insert([payload]);
    return !ins.error;
  } catch (err) {
    console.error("[M8] lemma-dag row upsert error (non-fatal):", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// L5 (Build-19) — RE-CHECK a human-architected scaffold's ALREADY-DRAFTED leaf
// code against a WARM checker. NO re-draft, NO LLM, NO new DAG: the autonomous
// verify phase only re-submits stored code that a daytime session drafted but the
// COLD checker returned lean_pending/lean_error for. The existence of the scaffold
// row IS the human-architecture act (the chat lane is its only writer), so this is
// strictly MORE conservative than dischargeLeaf (which drafts via the LLM). §0.3.
// ─────────────────────────────────────────────────────────────────
const RECHECKABLE = new Set(["lean_pending", "lean_error"]);

/** One 'open' scaffold row with >=1 leaf that has stored code AND a recheckable
 *  status. PostgREST can't compare two columns, so we fetch open rows and filter
 *  in JS. Returns { row, error }. Never throws. */
async function fetchPendingScaffold() {
  try {
    const sb = getClient();
    const { data, error } = await sb.from(TABLE)
      .select("*").eq("status", "open").order("updated_at", { ascending: true }).limit(25);
    if (error) return { row: null, error: error.message };
    for (const row of data || []) {
      const lemmas = Array.isArray(row.lemmas) ? row.lemmas : [];
      if (lemmas.some((l) => l && l.is_leaf && l.code && RECHECKABLE.has(l.lean_status))) {
        return { row, error: null };
      }
    }
    return { row: null, error: null };
  } catch (err) {
    console.error("[M8] lemma-dag fetchPendingScaffold error (non-fatal):", err.message);
    return { row: null, error: err.message };
  }
}

/**
 * Re-check the recheckable leaves of one scaffold row by RE-SUBMITTING their stored
 * code via /check (no draft). Caps total /check calls at checkCap (the §budget Lean
 * ceiling; 0 calls if nothing recheckable). Re-establishes the gate belt if a leaf
 * newly qualifies and budget remains. Re-persists via persistScaffold (graph + row).
 * Returns { rechecked, newlyVerified, checksUsed, leaf_count, leaves_verified }.
 * Never throws.
 */
async function recheckScaffold(row, { log, checkCap = 6 } = {}) {
  const base = { rechecked: 0, newlyVerified: 0, checksUsed: 0,
                 leaf_count: row && row.leaf_count || 0, leaves_verified: row && row.leaves_verified || 0 };
  if (!row || process.env.LEMMA_DAG_DISABLED === "1") return { ...base, disabled: true };
  try {
    const lemmas = (Array.isArray(row.lemmas) ? row.lemmas : []).map((l) => ({ ...l }));
    let qualifyingLeaf = false, shortcutRejected = false, gateDetail = "";
    for (const l of lemmas) {
      if (base.checksUsed >= checkCap) break;
      if (!l.is_leaf || !l.code || !RECHECKABLE.has(l.lean_status)) continue;
      if (hasBannedTokens(l.code)) { l.lean_status = "lean_rejected"; base.rechecked++; continue; }
      const chk = await runLeanCheck({ code: l.code });
      base.checksUsed++; base.rechecked++;
      if (!chk.ok) { l.lean_status = chk.status === "lean_pending" ? "lean_pending" : "lean_error"; continue; }
      const result = interpretLeanResult(chk.data);
      l.lean_status = result.kind;
      l.namespaces  = leanNamespacesUsed(l.code);
      l.reason      = result.errorText || null;
      if (result.kind === "lean_verified") base.newlyVerified++;
      if (isQualifyingLeaf(result.kind, l.code) && !qualifyingLeaf && base.checksUsed + 2 <= checkCap) {
        qualifyingLeaf = true;
        const probe = await runInvalidShortcutProbe(l.code);
        base.checksUsed += 2;
        shortcutRejected = probe.rejected; gateDetail = probe.detail;
      }
    }
    const counts = computeCounts(lemmas);
    // Preserve a previously-established gate; only OVERWRITE when re-established this run.
    const gate = {
      qualifying_leaf:   qualifyingLeaf || !!row.gate_qualifying_leaf,
      shortcut_rejected: qualifyingLeaf ? shortcutRejected : !!row.gate_shortcut_rejected,
      detail:            gateDetail || (row.metadata && row.metadata.gate_detail) || "",
    };
    await persistScaffold({ target: row.target, lemmas, counts, gate, sessionId: `loop-${new Date().toISOString().slice(0, 10)}` });
    base.leaf_count = counts.leaf_count;
    base.leaves_verified = counts.leaves_verified;
    if (log) log("m4_recheck", { rechecked: base.rechecked, newlyVerified: base.newlyVerified, checksUsed: base.checksUsed });
    return base;
  } catch (err) {
    console.error("[M8] lemma-dag recheckScaffold error (non-fatal):", err.message);
    return { ...base, error: err.message };
  }
}

async function fetchScaffold({ id, targetNorm } = {}) {
  try {
    const sb = getClient();
    let res;
    if (id)               res = await sb.from(TABLE).select("*").eq("id", id).maybeSingle();
    else if (targetNorm)  res = await sb.from(TABLE).select("*").eq("target_norm", targetNorm).maybeSingle();
    else                  res = await sb.from(TABLE).select("*").order("updated_at", { ascending: false }).limit(1);
    if (res.error) return { row: null, error: res.error.message };
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return { row: row || null, error: null };
  } catch (err) {
    return { row: null, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// PACKETS (deterministic ground truth the LLM narrates) — honesty-laden
// ─────────────────────────────────────────────────────────────────
// Short-circuit pattern (like the Lean lane): the packet IS the final, deterministic
// answer — no LLM narrates it, so the iron rule below can't be softened or rephrased.
const SCAFFOLD_FOOTER = "Honesty: this scaffold does NOT prove the target. Even if every leaf verifies, the target stays an OPEN CONJECTURE — a verified leaf is a Lean machine-check (0 sorry, 0 errors) of that one leaf, and a lemma marked \"scaffolded\" is a placeholder (sorry), not a proof. There is no \"percent proven\", by design. You architected this decomposition; M8 only formalized the named leaf lemmas.";

function renderParseErrorPacket(dag) {
  return [
    `I couldn't read that lemma DAG, so nothing was formalized.`,
    `Problem${dag.errors.length > 1 ? "s" : ""}: ${dag.errors.join("; ")}.`,
    ``,
    `Expected format:`,
    `  target: <the conjecture>`,
    `  L1: <a base lemma>`,
    `  L2: <a lemma>  [deps: L1]`,
    ``,
    `Leaves (no deps) get formalized + machine-checked; lemmas with deps are held as scaffold.`,
  ].join("\n");
}

function renderScaffoldPacket(target, lemmas, counts, opts = {}) {
  const statusBadge = (l) => {
    if (!l.is_leaf) return "PARENT — scaffolded (sorry, NOT proven)";
    switch (l.lean_status) {
      case "lean_verified":      return "LEAF — ✓ Lean-verified (this leaf only)";
      case "lean_stated":        return "LEAF — statement type-checks, proof admitted (sorry) — NOT proven";
      case "lean_rejected":      return "LEAF — ✗ Lean rejected";
      case "lean_unformalizable":return "LEAF — could not be faithfully formalized (nothing submitted)";
      case "lean_pending":       return "LEAF — checker cold/slow, not confirmed this turn";
      default:                   return `LEAF — ${l.lean_status || "?"}`;
    }
  };
  const lines = [
    `M4 PROOF SCAFFOLD (human-architected lemma DAG). Target conjecture: "${target}".`,
    `PROGRESS: leaves verified ${counts.leaves_verified} / ${counts.leaf_count}  ·  parents scaffolded (sorried, NOT proven): ${counts.parents_sorried}.`,
    `THE TARGET REMAINS AN OPEN CONJECTURE — this scaffold does NOT prove it (there is no "% proven", by design).`,
    ``,
    `LEMMAS:`,
  ];
  for (const l of lemmas) {
    const dep = (l.deps && l.deps.length) ? ` [deps: ${l.deps.map((d) => "L" + d).join(", ")}]` : "";
    const ns = (l.namespaces && l.namespaces.length) ? ` {Mathlib: ${l.namespaces.join(", ")}}` : "";
    lines.push(`  #${l.name} ${statusBadge(l)}${dep}${ns}: ${l.prose}`);
    if (l.lean_status === "lean_rejected" && l.reason) {
      const why = l.reason === "banned tokens"
        ? "the draft contained a banned token (e.g. `import`, `#eval`, `axiom`) and was rejected before reaching Lean"
        : String(l.reason).slice(0, 400).replace(/\s+/g, " ").trim();
      lines.push(`      Lean error: ${why}`);
    }
  }
  if (opts.gate) {
    lines.push(``);
    lines.push(`GATE: qualifying verified leaf (induction + ≥2 Mathlib namespaces): ${opts.gate.qualifying_leaf ? "YES" : "no"} · invalid-shortcut rejected: ${opts.gate.shortcut_rejected ? "YES" : "no"}${opts.gate.detail ? ` (shortcut verdicts: ${opts.gate.detail})` : ""}.`);
  }
  if (opts.ephemeral) lines.push(`(eval session — leaves not actually submitted to the checker)`);
  lines.push(``);
  lines.push(SCAFFOLD_FOOTER);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// ORCHESTRATOR ENTRY — VIEW is cheap (read-only). SCAFFOLD is heavy (drafts +
// /checks): the orchestrator calls scaffoldProof() on the buffered path (like the
// Lean lane) and applies write at STORE via persistScaffold(). Mirrors the
// { text, mode, data } shape. Fails safe.
// ─────────────────────────────────────────────────────────────────
async function buildLemmaDAGContext(message, sessionId) {
  const det = detectLemmaDAG(message);
  if (!det.mode) return { text: "", mode: null, data: null };
  if (process.env.LEMMA_DAG_DISABLED === "1") return { text: "", mode: null, data: null };
  if (det.mode === "view") {
    if (isEphemeralSession(sessionId)) return { text: renderScaffoldPacket("(none)", [], { leaf_count: 0, leaves_verified: 0, parents_sorried: 0 }, { ephemeral: true }), mode: "view", data: { ephemeral: true } };
    try {
      const { row, error } = await fetchScaffold({ id: det.id });
      if (error || !row) {
        return { text: `No proof scaffold is stored yet${error ? ` (the scaffold store isn't reachable — the m8_lemma_scaffold table may still need its one-time migration)` : ""}.`, mode: "view", data: { error: error || null } };
      }
      const lemmas = Array.isArray(row.lemmas) ? row.lemmas : [];
      return { text: renderScaffoldPacket(row.target, lemmas, { leaf_count: row.leaf_count, leaves_verified: row.leaves_verified, parents_sorried: row.parents_sorried }, { gate: { qualifying_leaf: row.gate_qualifying_leaf, shortcut_rejected: row.gate_shortcut_rejected } }), mode: "view", data: { id: row.id } };
    } catch (err) {
      return { text: `I couldn't read the proof-scaffold store right now (${String(err.message).slice(0, 120)}).`, mode: "view", data: { error: err.message } };
    }
  }
  // scaffold mode is heavy — signal the orchestrator to run scaffoldProof() on the buffered path
  return { text: "", mode: "scaffold", data: { heavy: true } };
}

module.exports = {
  buildLemmaDAGContext, scaffoldProof, persistScaffold, detectLemmaDAG, fetchScaffold,
  // L5 (Build-19): autonomous warm-window re-check of human-drafted leaf code
  fetchPendingScaffold, recheckScaffold,
  // exported for tests / reuse:
  parseDAG, computeCounts, leanNamespacesUsed, isQualifyingLeaf, statementSignature,
  renderScaffoldPacket, renderParseErrorPacket, runInvalidShortcutProbe, dischargeLeaf,
  TABLE, M4_VERSION, M4_THREAD,
};
