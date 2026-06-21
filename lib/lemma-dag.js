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
const { upsertNode, addEdge, ensureThreadNode, normLabel, graphMatch, smartTruncate } = require("./memory-graph");

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

// ── BUILD-55: M4 -> proposer FEEDBACK LOOP (bounded iterative leaf repair) ──
// M4-manual (Build-18) drafted a leaf, /check'd it, and did exactly ONE repair on a
// lean_rejected. Engine DEPTH (handoff Session-43 #3): generalize that single repair
// into a BOUNDED loop — redraft from the LATEST Lean error up to MAX_LEAF_REPAIRS
// times, each pass fed back via buildLeafDirective's error hint. With MAX=1 this is
// byte-for-byte the legacy behavior; default 2 gives the model a second corrective
// shot after the first. Capped [0..4] so a runaway env can't blow the chat latency
// budget. ONLY a genuine lean_rejected is retried: lean_verified is done, a sorry'd
// lean_stated is HONEST (retrying it would pressure a bogus proof — banned by the
// LEAF_SYSTEM contract), and lean_pending/lean_error are a COLD/SLOW checker a redraft
// can't beat. Kill: M4_MAX_LEAF_REPAIRS=0 (no repair at all).
const MAX_LEAF_REPAIRS = Math.max(0, Math.min(4, parseInt(process.env.M4_MAX_LEAF_REPAIRS || "2", 10) || 0));
const RETRYABLE_LEAN_KINDS = new Set(["lean_rejected"]);
/** PURE (PS-mirror-tested): retry iff the verdict is a real rejection AND budget remains. */
function shouldRetryLeaf(kind, repairsUsed) {
  return RETRYABLE_LEAN_KINDS.has(kind) && repairsUsed < MAX_LEAF_REPAIRS;
}

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
  • TACTIC DISCIPLINE — avoid "no goals to be solved": \`exact\`, \`rfl\`, \`ring\`, \`omega\`, \`norm_num\`, \`simp\`, and \`decide\` each CLOSE their goal completely. After any of these finishes a branch, do NOT write another tactic on the next line for that same branch. Start the next branch with \`·\` or end the proof. A tactic after a goal-closer is the sole cause of "no goals to be solved".
- Do not restate or weaken the lemma to make it pass. The statement must faithfully formalize exactly what was asked.
- MATHLIB SHORTCUTS (prefer shortest proof):
  * \Odd n\ IS DEFINED as \exists k, n = 2*k+1\ -- proof of 'n odd iff n=2k+1' is just \:= Iff.rfl\`n  * Any definitional iff -> \:= Iff.rfl\ (no by, no branches)
  * Simple arithmetic -> \:= by omega\ or \:= by ring\`n  * Simp-provable -> \:= by simp [Odd]\ or similar one-liner
- If the lemma references a concept that does not exist in Mathlib and cannot be faithfully stated, output EXACTLY one line \`UNFORMALIZABLE: <short reason>\` and nothing else.`;

function buildLeafDirective(prose, priorError) {
  let user = `Formalize and prove this base lemma as one Lean 4 theorem (use induction and named Mathlib lemmas as needed):\n\n${String(prose || "").trim()}`;
  if (priorError) {
    const errText = String(priorError).slice(0, 1200);
    let hint = "";
    if (/no goals to be solved/i.test(errText)) {
      hint = `\nDIAGNOSIS: 'no goals to be solved' — you have redundant tactics AFTER a goal was already closed. MANDATORY: rewrite the proof from scratch as the SHORTEST possible proof. Do NOT use multi-branch constructor proofs. Prefer these in order:
1. A direct term: \`:= Iff.rfl\` (if the statement is definitional equality, e.g. Odd is DEFINED as ∃ k, n = 2*k+1)
2. A single named Mathlib lemma: \`:= by exact Int.odd_iff\` or similar
3. A single tactic: \`:= by simp [Odd]\` or \`:= by omega\` or \`:= by ring\`
Never use constructor+branches unless 1-3 are impossible. One closer per proof.`;
    }
    user += `\n\nYour previous attempt was REJECTED by Lean with this error:\n---\n${errText}\n---\n${hint}\nRewrite from scratch. Output ONLY the corrected Lean 4 code, same contract.`;
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
    // BUILD-55 feedback loop: redraft from the LATEST Lean error, up to
    // MAX_LEAF_REPAIRS times (generalizes the legacy single repair). Each redraft
    // sees result.errorText via buildLeafDirective. Fail-safe: a draft failure, a
    // worse rewrite (unformalizable/banned), or a cold-checker miss STOPS the loop and
    // keeps the last real verdict — a redraft never beats a cold checker, so we never
    // burn the whole budget chasing one.
    let repairs = 0;
    while (shouldRetryLeaf(result.kind, repairs)) {
      repairs++;
      let codeN;
      try { codeN = await draftLeaf(prose, result.errorText, meta); }
      catch (_) { break; }
      if (isUnformalizable(codeN) || hasBannedTokens(codeN)) break;
      const chkN = await runLeanCheck({ code: codeN });
      if (!chkN.ok) break;
      code = codeN;
      result = interpretLeanResult(chkN.data);
    }
    if (log) log("m4_leaf", { leanKind: result.kind, repairs });
    const ns = leanNamespacesUsed(code);
    // BUILD-57: if the leaf is still lean_rejected after exhausting the repair budget,
    // flag it so renderScaffoldPacket can suggest 'expand L<n>' to go deeper.
    return { lean_status: result.kind, code, namespaces: ns, qualifying: isQualifyingLeaf(result.kind, code), reason: result.errorText || null, repairs, suggestExpand: result.kind === "lean_rejected" };
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
// SPECULATIVE-TARGET GUARD (Epistemic Axis surgical exception, Build-29)
// ─────────────────────────────────────────────────────────────────
// The team's epistemic-classification round (2026-06-13) deferred the full
// axis but called out ONE exception that fires once M4 goes live: don't hand
// a fringe/speculative claim Lean-grade credibility. M4 went live (Build-18).
// If the scaffold's TARGET is semantically close to an ingested document that
// Muhammad classified speculative/fringe (Build-27 source_class), refuse to
// draft/submit ANY leaf for it -- before any LLM or Lean call.
// 0.82 (noveltySemanticPass's bar) was calibrated for survivor-vs-pack-template
// matches -- near-identical generated text. A scaffold TARGET is free-form
// human paraphrase of an ingested document's prose, a looser match; 0.82 missed
// a live true-positive (re-stated "the Collatz map has a hidden periodic
// attractor besides 1-4-2" vs the ingested "...admits a previously undiscovered
// periodic attractor distinct from the trivial 1-4-2 cycle..."). Lowered for
// this check specifically. RETRIEVE_SIM_MIN is a wider net so the top external
// hit (and its similarity) is always visible in logs for future tuning, even
// when it falls short of the gating bar.
const SPECULATIVE_TARGET_SIM_MIN = 0.75;
const SPECULATIVE_RETRIEVE_SIM_MIN = 0.5;

async function checkSpeculativeTarget(targetText, sessionId) {
  try {
    if (process.env.GRAPH_DISABLED === "1") return null;
    if (isEphemeralSession(sessionId)) return null;
    const hits = await graphMatch(targetText, { k: 4, minSimilarity: SPECULATIVE_RETRIEVE_SIM_MIN });
    const ext = (hits || []).find((n) => n.source === "external");
    if (!ext) return null;
    const { fetchNodeSourceClass } = require("./knowledge-intake");
    const sourceClass = await fetchNodeSourceClass(ext.id);
    console.error(`[M8] M4 speculative-target check: top external hit sim=${Number(ext.similarity).toFixed(3)} class=${sourceClass || "(none)"} label="${smartTruncate(ext.label || "", 80)}"`);
    if (ext.similarity < SPECULATIVE_TARGET_SIM_MIN) return null;
    if (sourceClass === "speculative" || sourceClass === "fringe") {
      return { sourceClass, label: smartTruncate(ext.label || "", 120), similarity: Number(ext.similarity).toFixed(2) };
    }
    return null;
  } catch (err) {
    console.error("[M8] M4 speculative-target check error (non-fatal):", err.message);
    return null;
  }
}

function renderSpeculativeRefusalPacket(target, hit) {
  return [
    `I'm not formalizing this scaffold in Lean.`,
    ``,
    `Target: "${target}"`,
    `This is semantically close (cosine ${hit.similarity}) to "${hit.label}" -- a claim from an ingested document Muhammad classified as [${hit.sourceClass.toUpperCase()}], not an established result.`,
    ``,
    `Submitting a leaf for this target to the Lean checker would lend a ${hit.sourceClass} claim false Lean-grade credibility, even if the leaf itself only checks a narrow base case. Nothing was drafted or sent to the checker, and nothing was written to the graph.`,
    ``,
    `If you want to work on this, the honest framing is to formalize the established KERNEL of the idea (if any) as its own target, separate from the ${hit.sourceClass} claim.`,
  ].join("\n");
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
  const specHit = await checkSpeculativeTarget(dag.target, sessionId);
  if (specHit) {
    return { text: renderSpeculativeRefusalPacket(dag.target, specHit), ok: true, write: null };
  }
  let qualifyingLeaf = false, shortcutRejected = false, gateDetail = "";
  for (const lemma of dag.lemmas) {
    if (!lemma.is_leaf) { lemma.lean_status = "scaffolded"; continue; }   // parents held as honest scaffold (sorry)
    const r = await dischargeLeaf(lemma.prose, { meta, log });
    lemma.lean_status = r.lean_status;
    lemma.code = r.code || null;
    lemma.namespaces = r.namespaces || [];
    lemma.reason = r.reason || null;
    lemma.suggestExpand = r.suggestExpand || false;
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
        // Build-B: bounded second-chance repair counter — persisted (upsert rebuilds
        // the leaf, so it must be a first-class field) so a stuck leaf is retried at
        // most M4_MAX_SECOND_CHANCES times, never forever.
        second_chance: l.second_chance || 0,
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
    const sorryLeaves = [];   // Build-99: leaves rechecked to `sorry` this run (failed approaches)
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
      // Build-99: a leaf that elaborates but leaves the proof as `sorry` is a FAILED
      // approach — record its code (which carries the `sorry`) so the loop can feed it
      // to the proposer's AVOID block. Self-deduping across runs: lean_stated leaves
      // exit the RECHECKABLE set, so they are not re-collected next night.
      if (result.kind === "lean_stated") sorryLeaves.push({ name: l.name || null, code: l.code });
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
    base.sorryLeaves = sorryLeaves;   // Build-99: surfaced to loop.js for failed-approach memory
    if (log) log("m4_recheck", { rechecked: base.rechecked, newlyVerified: base.newlyVerified, checksUsed: base.checksUsed });
    return base;
  } catch (err) {
    console.error("[M8] lemma-dag recheckScaffold error (non-fatal):", err.message);
    return { ...base, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// BUILD-B — SECOND-CHANCE REPAIR of graveyard leaves (the M4 error-repair loop).
// Unlike recheckScaffold (conservative, NO LLM), this DELIBERATELY re-drafts a leaf
// the checker genuinely REJECTED (lean_rejected), giving dischargeLeaf's Build-55
// repair loop a fresh attempt. Heavily bounded: warm-only (called past the health
// gate), time-guarded (deadlineMs), 1 leaf/run, retried at most M4_MAX_SECOND_CHANCES
// times (persisted), and a re-draft NEVER downgrades a stored leaf. Honesty unchanged:
// a repaired leaf is still only 'leaf verified'; the target stays an OPEN CONJECTURE.
// Kill: M4_REPAIR_DISABLED=1 (or M4_MAX_SECOND_CHANCES=0).
// ─────────────────────────────────────────────────────────────────
const REPAIRABLE = new Set(["lean_rejected"]);
const MAX_SECOND_CHANCES = Math.max(0, parseInt(process.env.M4_MAX_SECOND_CHANCES || "2", 10));

/** One 'open' scaffold with a lean_rejected leaf (with code) still under its
 *  second-chance budget. Returns { row, error }. Never throws. */
async function fetchRepairableScaffold() {
  if (process.env.M4_REPAIR_DISABLED === "1" || MAX_SECOND_CHANCES === 0) return { row: null, error: null };
  try {
    const sb = getClient();
    const { data, error } = await sb.from(TABLE)
      .select("*").eq("status", "open").order("updated_at", { ascending: true }).limit(25);
    if (error) return { row: null, error: error.message };
    for (const row of data || []) {
      const lemmas = Array.isArray(row.lemmas) ? row.lemmas : [];
      if (lemmas.some((l) => l && l.is_leaf && l.code && REPAIRABLE.has(l.lean_status)
            && (l.second_chance || 0) < MAX_SECOND_CHANCES)) {
        return { row, error: null };
      }
    }
    return { row: null, error: null };
  } catch (err) {
    console.error("[M8] lemma-dag fetchRepairableScaffold error (non-fatal):", err.message);
    return { row: null, error: err.message };
  }
}

/**
 * Re-draft up to `repairCap` graveyard (lean_rejected) leaves of one scaffold via
 * dischargeLeaf (LLM + Build-55 repair loop). Time-guarded by deadlineMs (skips a
 * leaf when out of budget — never interrupts a /check mid-flight; persist is atomic
 * at the end, so a hard timeout corrupts nothing). NEVER downgrades a stored leaf —
 * only ACCEPTS an improvement (verified/stated). Bumps the persisted second_chance
 * counter up-front so a dead leaf is bounded. Mirrors recheckScaffold's persist+gate.
 * Returns { repaired, newlyVerified, leaf_count, leaves_verified }. Never throws.
 */
async function repairScaffold(row, { log, repairCap = 1, deadlineMs = 0 } = {}) {
  const base = { repaired: 0, newlyVerified: 0,
                 leaf_count: (row && row.leaf_count) || 0, leaves_verified: (row && row.leaves_verified) || 0 };
  if (!row || process.env.LEMMA_DAG_DISABLED === "1" || process.env.M4_REPAIR_DISABLED === "1" || MAX_SECOND_CHANCES === 0) {
    return { ...base, disabled: true };
  }
  try {
    const lemmas = (Array.isArray(row.lemmas) ? row.lemmas : []).map((l) => ({ ...l }));
    const sessionId = `loop-repair-${new Date().toISOString().slice(0, 10)}`;
    let qualifyingLeaf = false, shortcutRejected = false, gateDetail = "";
    let attempts = 0;
    for (const l of lemmas) {
      if (attempts >= repairCap) break;
      if (deadlineMs && Date.now() >= deadlineMs) break;          // time-budget guard
      if (!l.is_leaf || !l.code || !REPAIRABLE.has(l.lean_status)) continue;
      if ((l.second_chance || 0) >= MAX_SECOND_CHANCES) continue;
      attempts++;
      l.second_chance = (l.second_chance || 0) + 1;               // bound retries (counted up-front)
      const r = await dischargeLeaf(l.prose, { meta: { sessionId }, log });
      base.repaired++;
      const improved = r && (r.lean_status === "lean_verified" || r.lean_status === "lean_stated");
      if (improved) {
        l.lean_status   = r.lean_status;
        l.code          = r.code || l.code;
        l.namespaces    = r.namespaces || l.namespaces || [];
        l.reason        = r.reason || null;
        l.suggestExpand = r.suggestExpand || false;
        if (r.lean_status === "lean_verified") base.newlyVerified++;
        if (r.qualifying && !qualifyingLeaf && (!deadlineMs || Date.now() < deadlineMs)) {
          qualifyingLeaf = true;
          const probe = await runInvalidShortcutProbe(r.code);   // gate belt on the first qualifying leaf
          shortcutRejected = probe.rejected; gateDetail = probe.detail;
        }
      }
      // not improved -> leave the stored leaf lean_rejected; the bumped counter stops
      // us re-drafting it after MAX_SECOND_CHANCES.
    }
    const counts = computeCounts(lemmas);
    const gate = {
      qualifying_leaf:   qualifyingLeaf || !!row.gate_qualifying_leaf,
      shortcut_rejected: qualifyingLeaf ? shortcutRejected : !!row.gate_shortcut_rejected,
      detail:            gateDetail || (row.metadata && row.metadata.gate_detail) || "",
    };
    await persistScaffold({ target: row.target, lemmas, counts, gate, sessionId });
    base.leaf_count = counts.leaf_count;
    base.leaves_verified = counts.leaves_verified;
    if (log) log("m4_repair", { repaired: base.repaired, newlyVerified: base.newlyVerified });
    return base;
  } catch (err) {
    console.error("[M8] lemma-dag repairScaffold error (non-fatal):", err.message);
    return { ...base, error: err.message };
  }
}

/**
 * Build-111 — every scaffold that currently holds >=1 Lean-verified leaf, shaped for
 * outcome reconciliation. Returns [{ id, target, sketch }] where `sketch` is the
 * concatenated Lean code of the VERIFIED leaves ONLY (so conjecture-memory classifies
 * the row as a SUCCESS, never a sorry/failed approach — a non-verified sibling leaf's
 * `sorry` can't leak into it). Filters by the leaves_verified column (>0), so a
 * partially verified 'open' scaffold qualifies too, not just 'leaves_done'. Read by
 * loop.runVerifyPhase to keep m8_conjecture_outcomes in sync with the graph even when a
 * per-run newlyVerified transition write was missed/dropped. [] on any error; never throws.
 */
async function fetchVerifiedScaffolds(limit = 100, db = null) {
  try {
    const sb = db || getClient();
    const { data, error } = await sb.from(TABLE)
      .select("id, target, lemmas")
      .gt("leaves_verified", 0)
      .order("updated_at", { ascending: true })
      .limit(Math.max(1, limit));
    if (error) {
      console.error("[M8] lemma-dag fetchVerifiedScaffolds error (non-fatal):", error.message);
      return [];
    }
    const out = [];
    for (const row of data || []) {
      if (!row || !row.target) continue;
      const lemmas = Array.isArray(row.lemmas) ? row.lemmas : [];
      const verified = lemmas.filter((l) => l && l.is_leaf && l.lean_status === "lean_verified");
      const sketch = verified.map((l) => l.code || l.prose || l.name || "").filter(Boolean).join("\n").slice(0, 1000);
      out.push({ id: row.id, target: row.target, sketch: sketch || null });
    }
    return out;
  } catch (err) {
    console.error("[M8] lemma-dag fetchVerifiedScaffolds exception (non-fatal):", err.message);
    return [];
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
  const stuckLeaves = lemmas.filter((l) => l.suggestExpand);
  if (stuckLeaves.length) {
    lines.push(``);
    lines.push(`STUCK LEAVES — rejected even after repairs. Try going deeper:`);
    for (const sl of stuckLeaves) {
      const prose = sl.prose.length > 70 ? sl.prose.slice(0, 70).trimEnd() + "…" : sl.prose;
      lines.push(`  expand ${sl.name}  — sub-decomposes "${prose}" into sub-lemmas`);
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
  // Build-B: second-chance repair of graveyard (lean_rejected) leaves
  fetchRepairableScaffold, repairScaffold,
  // Build-111: verified-scaffold snapshot for durable outcome reconciliation
  fetchVerifiedScaffolds,
  // exported for tests / reuse:
  parseDAG, computeCounts, leanNamespacesUsed, isQualifyingLeaf, statementSignature,
  shouldRetryLeaf, MAX_LEAF_REPAIRS,
  renderScaffoldPacket, renderParseErrorPacket, runInvalidShortcutProbe, dischargeLeaf,
  checkSpeculativeTarget, renderSpeculativeRefusalPacket,
  TABLE, M4_VERSION, M4_THREAD,
};
