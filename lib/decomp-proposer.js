/**
 * M8 Build-43 · Option A — Human-Gated Decomposition Proposer ("M8 plans the attack")
 * lib/decomp-proposer.js
 *
 * The third rung of the problem-solving engine (roadmap D -> B -> A -> C). M4-manual
 * (Build-18) can formalize + machine-check the LEAVES of a lemma-DAG, but the
 * decomposition — the actual mathematical insight "break the target into THESE
 * sub-lemmas" — was 100% human. This module lets M8 DRAFT a candidate lemma-DAG for
 * a target conjecture, validate it against an anti-degeneracy gate, and STAGE it as a
 * [PROPOSED PLAN]. A human APPROVES it; only then does the existing, trusted
 * lemma-dag.js / Lean machinery formalize the leaves.
 *
 * Reuses the Build-42 propose -> stage -> human-approve -> write gate pattern.
 *
 * HONESTY (load-bearing, mirrors the spine):
 *   - A proposed DAG is a [PROPOSED PLAN], NEVER evidence. It mints NO graph nodes and
 *     NO edges until approved (staged data only, like Build-42's pending_decomposition).
 *   - Approval changes nothing about proof semantics — it only feeds M4-manual. The
 *     target is NEVER promoted; "leaves verified k/m" only; the target stays an OPEN
 *     CONJECTURE even at 100% leaves discharged.
 *   - ANTI-DEGENERACY GATE (the whole point): reject "L1 ~= target" proposals. Require
 *     >= 2 lemmas, the target is not itself a leaf (no lemma ~= the target), and >= 2
 *     leaves with DISTINCT prose. A degenerate proposal returns null ("couldn't find a
 *     non-trivial decomposition"), NEVER a fake plan.
 *
 * The pure pieces (target-similarity, the anti-degeneracy gate, canonical
 * re-serialization, the [PROPOSED PLAN] render) are mirrored by
 * tests/decomp-proposer-verify.ps1. The Gemini proposer is the only async/LLM part
 * and fails safe -> null. Staging/approval are fail-safe DB ops (missing table -> a
 * degraded but honest reply). Kill switch: DECOMP_PROPOSER_DISABLED=1.
 */
const { createClient } = require("@supabase/supabase-js");
const { generate } = require("./llm");
const { parseDAG, scaffoldProof, persistScaffold } = require("./lemma-dag");
const { leanHealth, warmLeanChecker } = require("./leanClient");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
const TABLE = "m8_decomp_proposals";
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// ── anti-degeneracy thresholds (FIXED) ─────────────────────────────
const TARGET_SIM_MAX = 0.75;   // a lemma sharing >= this many content tokens with the target = a restatement (degenerate)
const LEAF_DISTINCT_MAX = 0.85; // two leaves >= this similar = not distinct prose

// Small stopword set so structural/function words don't inflate token overlap.
const STOPWORDS = new Set(["the","a","an","of","for","to","is","are","be","every","each","all","and","or","that","this","with","by","in","on","its","it","as","at","if","then","so","we","i","you","n","x","k","m"]);

// ── PURE CORE (PS-mirror-tested) ───────────────────────────────────
/** lower-case content tokens, punctuation stripped, stopwords removed. */
function contentTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}
/** Jaccard similarity of two token SETS. 0 when either side is empty. */
function tokenJaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Anti-degeneracy gate over a parsed DAG. PURE, sync. Returns { ok, reason }.
 * Assumes the DAG already passed parseDAG's structural checks (no dangling/cycle).
 * Rejects: < 2 lemmas; < 2 leaves; any lemma whose prose ~= the target (L1 ~=
 * target — the explicit caveat); two leaves with near-identical prose.
 */
function checkNonDegenerate(dag) {
  if (!dag || !dag.lemmas || dag.lemmas.length < 2) {
    return { ok: false, reason: "a real attack plan needs at least 2 lemmas (a single lemma restating the target is not a decomposition)" };
  }
  const targetTok = contentTokens(dag.target);
  for (const l of dag.lemmas) {
    const sim = tokenJaccard(contentTokens(l.prose), targetTok);
    if (sim >= TARGET_SIM_MAX) {
      return { ok: false, reason: `${l.name} just restates the target (token overlap ${sim.toFixed(2)} >= ${TARGET_SIM_MAX}) — that is a degenerate "L1 = target" split, not a decomposition` };
    }
  }
  const leaves = dag.lemmas.filter((l) => l.is_leaf);
  if (leaves.length < 2) {
    return { ok: false, reason: "a useful decomposition needs at least 2 independent base lemmas (leaves)" };
  }
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const sim = tokenJaccard(contentTokens(leaves[i].prose), contentTokens(leaves[j].prose));
      if (sim >= LEAF_DISTINCT_MAX) {
        return { ok: false, reason: `${leaves[i].name} and ${leaves[j].name} are near-duplicate leaves (overlap ${sim.toFixed(2)}) — the leaves must be distinct` };
      }
    }
  }
  return { ok: true, reason: "" };
}

/**
 * Re-serialize a parsed DAG into the EXACT M4-manual text format, so the staged
 * plan is guaranteed parseable by scaffoldProof (strips any LLM formatting noise).
 */
function serializeDAG(dag) {
  const lines = [`target: ${dag.target}`];
  for (const l of dag.lemmas.slice().sort((a, b) => a.idx - b.idx)) {
    const deps = (l.deps && l.deps.length) ? `  [deps: ${l.deps.map((d) => "L" + d).join(", ")}]` : "";
    lines.push(`${l.name}: ${l.prose}${deps}`);
  }
  return lines.join("\n");
}

// ── BUILD-56: MULTI-LEVEL DAG (recursive sub-decomposition) — PURE CORE ──────
// Expand one lemma of a plan into its OWN sub-DAG and graft it back, so the proof
// tree goes deeper than one layer and more of it bottoms out in machine-checkable
// leaves. All structural logic here is pure + sync (PS-mirror-tested); the Gemini
// sub-draft is the only async part and reuses proposeDecompositionPlan's gate.
const MAX_DECOMP_DEPTH = Math.max(2, Math.min(6, parseInt(process.env.M8_MAX_DECOMP_DEPTH || "4", 10) || 4));

/** Longest dependency chain (node count) in a parsed DAG. A leaf = 1; a lemma that
 *  depends on a depth-d lemma = d+1. parseDAG already rejects cycles, but a `seen`
 *  guard keeps this total even on malformed input. */
function dagDepth(dag) {
  const lemmas = (dag && dag.lemmas) || [];
  const byIdx = new Map(lemmas.map((l) => [l.idx, l]));
  const depthOf = (idx, seen) => {
    const l = byIdx.get(idx);
    if (!l || !l.deps || !l.deps.length) return 1;
    let best = 1;
    for (const d of l.deps) {
      if (seen.has(d)) continue;                       // cycle guard
      best = Math.max(best, 1 + depthOf(d, new Set(seen).add(d)));
    }
    return best;
  };
  let max = lemmas.length ? 1 : 0;
  for (const l of lemmas) max = Math.max(max, depthOf(l.idx, new Set([l.idx])));
  return max;
}

/** The sub-DAG's conclusion lemmas: those no OTHER sub-lemma depends on (the roots
 *  the expanded parent will rest on). Returns original (un-offset) sub indices. */
function subDagRoots(subLemmas) {
  const depended = new Set();
  for (const l of subLemmas || []) for (const d of l.deps || []) depended.add(d);
  return (subLemmas || []).filter((l) => !depended.has(l.idx)).map((l) => l.idx);
}

/**
 * Graft subDag under lemma L<targetIdx> of parentDag. PURE, sync.
 *   { ok, dag, dagText, errors }
 * Sub-lemmas are re-indexed by +offset (offset = max parent idx) so they can never
 * collide with parent indices; the expanded lemma's deps gain the sub-roots (UNION —
 * never drops existing structure; sub-lemmas only point at new indices so no cycle is
 * possible) and it stops being a leaf. The merged text is re-parsed to re-validate.
 */
function mergeSubDAG(parentDag, targetIdx, subDag) {
  if (!parentDag || !parentDag.lemmas || !parentDag.lemmas.length) return { ok: false, dag: null, dagText: "", errors: ["the plan has no lemmas to expand"] };
  const target = parentDag.lemmas.find((l) => l.idx === targetIdx);
  if (!target) return { ok: false, dag: null, dagText: "", errors: [`the plan has no lemma L${targetIdx}`] };
  if (!subDag || !subDag.lemmas || subDag.lemmas.length < 2) return { ok: false, dag: null, dagText: "", errors: ["the sub-plan had fewer than 2 lemmas"] };

  const offset = Math.max(...parentDag.lemmas.map((l) => l.idx));
  const remapped = subDag.lemmas.map((l) => ({
    idx: l.idx + offset,
    name: `L${l.idx + offset}`,
    prose: l.prose,
    deps: (l.deps || []).map((d) => d + offset),
    is_leaf: !(l.deps && l.deps.length),
  }));
  const roots = subDagRoots(subDag.lemmas).map((i) => i + offset);

  const merged = parentDag.lemmas.map((l) => {
    if (l.idx !== targetIdx) return { ...l };
    const newDeps = Array.from(new Set([...(l.deps || []), ...roots]));
    return { ...l, deps: newDeps, is_leaf: false };
  }).concat(remapped);

  const dagText = serializeDAG({ target: parentDag.target, lemmas: merged });
  const reparsed = parseDAG(dagText);                  // re-validate: no cycle/dangling
  if (!reparsed.ok) return { ok: false, dag: null, dagText, errors: reparsed.errors };
  return { ok: true, dag: reparsed, dagText, errors: [] };
}

/** Extract the target prose from a "propose a decomposition for: <target>" message. */
function extractTarget(message) {
  const s = String(message || "").trim();
  const colon = s.indexOf(":");
  if (colon >= 0 && colon < s.length - 1) {
    const after = s.slice(colon + 1).trim();
    if (after.length >= 6) return after;
  }
  const kw = s.match(/\b(?:for|on|of|that|to\s+prove|prove|attack(?:ing)?|decompose)\b\s+(.+)$/i);
  if (kw && kw[1] && kw[1].trim().length >= 6) return kw[1].trim();
  return s;
}

// ── DETECTION ──────────────────────────────────────────────────────
// PROPOSE: an explicit ask for M8 to DRAFT a decomposition / attack plan, with NO
// L<n>: lines (those belong to the M4 scaffold lane, which OWNS that anchor).
const DECOMP_VERB = "propose|draft|suggest|sketch|outline|plan|decompose|break\\s+(?:down|up)";
const DECOMP_OBJ  = "decomposition|attack(?:\\s+plan)?|lemma[- ]?dag|sub-?lemmas|proof\\s+(?:plan|sketch|strategy|outline|attack)|into\\s+(?:sub-?)?lemmas";
const PROPOSE_RE = new RegExp(`\\b(?:${DECOMP_VERB})\\b[^?.!]{0,40}\\b(?:${DECOMP_OBJ})\\b`, "i");
// the gap before the id excludes '#' and digits so it can't swallow the '#1' and
// leave a stray '2' (a greedy [^?.!] would capture the wrong number).
const APPROVE_RE = /\bapprove\b[^?.!]{0,40}\b(?:decomposition|attack(?:\s+plan)?|plan|lemma[- ]?dag|proposal)\b[^?.!#\d]{0,12}#?\s*(\d+)/i;
const HAS_LEMMA_LINE = /^\s*L\d+\s*:/im;

// EXPAND (Build-56): go a level deeper on a named lemma of a staged plan. Requires an
// explicit L<n> token so it can't swallow a plain "propose a decomposition" ask. The
// proposal id is optional (#N) — absent => the most-recent pending proposal.
const EXPAND_RE = /\b(?:expand|go\s+deeper(?:\s+on)?|further\s+decompose|sub-?decompose|decompose|break\s+(?:down|up))\b[^?.!]*?\bL(\d+)\b/i;

// VERIFY_NOW (Build-51): re-submit leaves after a warm-pending cold miss.
// Matches explicit retry phrases only — bare "verify" is intentionally excluded
// so "verify today's earnings" / "verify in lean: X" are not hijacked.
// The Lean explicit lane already owns "verify in lean: X" and fires first.
const VERIFY_NOW_RE = /\b(?:verify\s+(?:now|lea(?:f|ves?)|it|them)|check\s+lea(?:f|ves?)|recheck|re-?verify|go\s+ahead(?:\s+(?:with\s+lean|lean))?|lean\s+(?:now|ready|go)|run\s+(?:the\s+)?(?:lean|lea(?:f|ves?)))\b/i;
function detectVerifyNow(s) { return VERIFY_NOW_RE.test(String(s || "")); }

/** { mode: 'propose'|'approve'|'verify_now'|null, id? }. */
function detectDecompProposal(message) {
  const s = String(message || "").trim();
  if (s.length < 6) return { mode: null };
  const am = s.match(APPROVE_RE);
  if (am) return { mode: "approve", id: parseInt(am[1], 10) };
  // EXPAND must precede PROPOSE: "decompose ... L3" is a deepen-existing ask, not a new plan.
  const em = s.match(EXPAND_RE);
  if (em) {
    const idm = s.match(/(?:decomposition|plan|proposal)\s*#?\s*(\d+)|#\s*(\d+)/i);
    const id = idm ? parseInt(idm[1] || idm[2], 10) : null;
    return { mode: "expand", lemmaIdx: parseInt(em[1], 10), id };
  }
  if (detectVerifyNow(s)) return { mode: "verify_now" };
  if (HAS_LEMMA_LINE.test(s)) return { mode: null };   // a pasted L<n>: DAG is a scaffold, not a propose-ask
  if (PROPOSE_RE.test(s)) return { mode: "propose" };
  return { mode: null };
}

// ── LLM proposer: target prose -> candidate lemma-DAG (or null) ────
const PROPOSE_SYSTEM = `You are a research mathematician drafting a CANDIDATE proof-attack plan: a decomposition of one target conjecture into smaller sub-lemmas. This is a PROPOSAL a human will review — it is NOT a proof and will not be treated as one.

Output the decomposition in EXACTLY this plain-text format, nothing else (no markdown, no prose, no commentary):
target: <restate the target conjecture in one line>
L1: <a base lemma with NO dependencies>
L2: <a base lemma with NO dependencies>
L3: <a lemma that combines earlier ones>  [deps: L1, L2]

RULES (a violation makes the plan worthless):
1. At LEAST 2 lemmas, and at least 2 of them must be LEAVES (no [deps:] — genuinely independent base facts).
2. NO lemma may simply RESTATE the target. "L1: <the target again>" is forbidden — that is not a decomposition. Each lemma must be a strictly smaller, more basic statement.
3. The leaves must be DISTINCT from each other (different mathematical content, not paraphrases).
4. Dependencies (the [deps: ...] tags) must reference only earlier-defined lemmas and must not form a cycle.
5. If you genuinely cannot break this target into a non-trivial set of sub-lemmas, output exactly: null
6. A missing plan (null) is far better than a degenerate or fabricated one. Invent no mathematics you cannot justify.
7. FORMALIZABLE LEAVES (important): the LEAVES (lemmas with NO [deps:]) will be handed to a Lean 4 + Mathlib
   proof checker, so make them as ELEMENTARY and self-contained as possible — base facts provable from the
   standard library (induction, finite sums/Finset, basic arithmetic and elementary number theory). Push the
   hard, problem-specific reasoning UP into the PARENT lemmas (the ones with [deps:]). A good decomposition
   has small, machine-checkable leaves and harder parents — not a deep, unformalizable statement as a leaf.`;

/**
 * One Gemini pass: draft a candidate DAG for the target, validate shape (parseDAG)
 * + the anti-degeneracy gate. Returns { ok, dag, dagText, reason }.
 *   ok=false carries a human reason; ok=true carries the validated dag + canonical text.
 * Fail-safe: any error -> { ok:false, reason }.
 *
 * Build-51: fires a Lean /health wake-ping IN PARALLEL with Gemini (3s timeout).
 * Even if the ping times out, Cloud Run receives the HTTP request and starts the
 * container — so by the time the human reads the plan and approves (~minutes later)
 * the checker may already be warm.
 */
async function proposeDecompositionPlan(targetProse) {
  const target = String(targetProse || "").trim();
  if (target.length < 6) return { ok: false, reason: "I couldn't read a target conjecture to decompose." };

  // Fire a wake-ping in parallel with Gemini — zero added latency on the happy path.
  const warmPingDone = leanHealth({ timeoutMs: 3000 }).catch(() => {});

  let raw;
  try {
    raw = await generate({
      systemInstruction: PROPOSE_SYSTEM,
      contents: [{ role: "user", parts: [{ text: `TARGET CONJECTURE:\n${target.slice(0, 1200)}\n\nDraft the decomposition (or null) now.` }] }],
      genConfig: { temperature: 0, maxOutputTokens: 600 },
    });
  } catch (e) {
    console.error("[M8] proposeDecompositionPlan generate error (non-fatal):", e.message);
    return { ok: false, reason: "I hit an error drafting the plan and won't guess one." };
  }
  // Ensure the ping request was fully dispatched before we return.
  await warmPingDone;

  if (/^\s*null\s*$/i.test(String(raw || ""))) {
    return { ok: false, reason: "I couldn't find a non-trivial way to break this target into sub-lemmas, so I won't invent one." };
  }
  const dag = parseDAG(raw);
  if (!dag.ok) {
    return { ok: false, reason: `the draft plan wasn't a well-formed DAG (${dag.errors.join("; ")})` };
  }
  const gate = checkNonDegenerate(dag);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason };
  }
  return { ok: true, dag, dagText: serializeDAG(dag), reason: "" };
}

// ── STAGING (fail-safe; missing table -> degraded reply) ───────────
async function stageProposal(target, dagText, dag) {
  try {
    const payload = {
      target,
      target_norm: String(target || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 400),
      dag_text: dagText,
      dag: { lemmas: dag.lemmas, leaves: dag.leaves, target: dag.target },
      status: "pending",
    };
    const { data, error } = await getClient().from(TABLE).insert([payload]).select("id").single();
    if (error) { console.error("[M8] stageProposal error (non-fatal):", error.message); return null; }
    return data && data.id;
  } catch (err) {
    console.error("[M8] stageProposal exception (non-fatal):", err.message);
    return null;
  }
}

async function fetchProposal(id) {
  try {
    const { data, error } = await getClient().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) return { row: null, error: error.message };
    return { row: data || null, error: null };
  } catch (err) {
    return { row: null, error: err.message };
  }
}

/** Re-stage a proposal's DAG in place (Build-56 expand). Keeps status 'pending'. Fail-safe. */
async function updateProposalDag(id, dagText, dag) {
  try {
    const { error } = await getClient().from(TABLE).update({
      dag_text: dagText,
      dag: { lemmas: dag.lemmas, leaves: dag.leaves, target: dag.target },
    }).eq("id", id);
    if (error) { console.error("[M8] updateProposalDag error (non-fatal):", error.message); return false; }
    return true;
  } catch (err) {
    console.error("[M8] updateProposalDag exception (non-fatal):", err.message);
    return false;
  }
}

// ── RENDER (deterministic — the [PROPOSED PLAN] framing the LLM never re-narrates) ──
const PROPOSAL_FOOTER = "Honesty: this is a [PROPOSED PLAN], NOT a proof and NOT evidence. M8 drafted this decomposition; nothing has been formalized, machine-checked, or written to the research graph. Approving it only feeds the leaves to the M4 Lean lane — even if every leaf then verifies, the target stays an OPEN CONJECTURE (\"leaves verified k/m\", never \"% proven\").";

function renderProposalPacket(target, dag, id) {
  const leaves = dag.lemmas.filter((l) => l.is_leaf);
  const lines = [
    `[PROPOSED PLAN] — a CANDIDATE decomposition of the target (drafted by M8, not yet checked):`,
    ``,
    `Target conjecture: "${dag.target}"`,
    `${dag.lemmas.length} sub-lemmas (${leaves.length} independent leaves). This is a plan to ATTACK the target, not a proof of it.`,
    ``,
    `LEMMAS:`,
  ];
  for (const l of dag.lemmas.slice().sort((a, b) => a.idx - b.idx)) {
    const dep = (l.deps && l.deps.length) ? ` [deps: ${l.deps.map((d) => "L" + d).join(", ")}]` : "";
    const tag = l.is_leaf ? "LEAF (base lemma — would be Lean-checked on approval)" : "PARENT (combines earlier lemmas — held as scaffold/sorry)";
    lines.push(`  #${l.name} ${tag}${dep}: ${l.prose}`);
  }
  lines.push(``);
  if (id) {
    lines.push(`To formalize + machine-check the leaves of THIS plan, approve it:  approve decomposition #${id}`);
  } else {
    lines.push(`I couldn't stage this for one-click approval (the ${TABLE} table may still need its one-time migration). To formalize the leaves now, send the M4 scaffold command with the block below:`);
    lines.push(``);
    lines.push(serializeDAG(dag));
  }
  lines.push(``);
  lines.push(PROPOSAL_FOOTER);
  return lines.join("\n");
}

/** Build-56: wrap renderProposalPacket with a "deepened" header naming the expanded lemma. */
function renderExpandedPacket(id, lemmaIdx, lemmaProse, dag) {
  const trunc = String(lemmaProse || "").replace(/\s+/g, " ").trim().slice(0, 90);
  const head = [
    `[PROPOSED PLAN — DEEPENED] I expanded lemma L${lemmaIdx} ("${trunc}") into its own sub-decomposition. The plan is now multi-level — the new sub-leaves below are what would actually be Lean-checked; L${lemmaIdx} becomes a parent held as scaffold (sorry).`,
    ``,
  ].join("\n");
  return head + renderProposalPacket(dag.target, dag, id);
}

function renderRejectionPacket(target, reason) {
  return [
    `I won't propose a decomposition for this target, because ${reason}.`,
    ``,
    `Target: "${String(target).slice(0, 200)}"`,
    ``,
    `Nothing was staged and nothing was written. A degenerate plan (e.g. one lemma that just restates the target) would be worse than none — the whole value of a decomposition is that the sub-lemmas are strictly smaller and independent. Try giving me a target with more structure to break apart, Boss.`,
  ].join("\n");
}

// ── BUILD-51: WARM-CHECKER HELPERS ──────────────────────────────────

/** Narrate a cold-checker miss: ping was sent, tell user to retry. */
function narrateWarmPending(id) {
  return [
    `The Lean checker is starting up from cold — I've just sent it a fresh wake-up ping. **Wait 10 minutes from now**, then say **verify now**. Don't say it sooner (it'll still be loading) or wait more than 20 minutes (it scales back down after idle).`,
    ``,
    `Decomposition #${id} is staged and nothing has been formalized yet. When you're ready, just say:`,
    ``,
    `  **verify now**`,
    ``,
    `and I'll re-submit the leaves to the warm checker.`,
  ].join("\n");
}

/** Find the most recently proposed decomposition still in 'pending' state. */
async function findLatestPendingProposal() {
  try {
    const { data, error } = await getClient()
      .from(TABLE)
      .select("id, target, dag_text")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (e) {
    console.error("[M8] findLatestPendingProposal error (non-fatal):", e.message);
    return null;
  }
}

// ── APPROVAL — hand the staged DAG to the existing M4 scaffold pipeline ──
async function approveProposal(id, sessionId, { meta, log } = {}) {
  const { row, error } = await fetchProposal(id);
  if (error || !row) {
    return `I couldn't find a staged decomposition #${id}${error ? ` (the ${TABLE} store isn't reachable — it may still need its one-time migration)` : ""}. Propose one first with "propose a decomposition for: <target>".`;
  }
  if (row.status === "approved") {
    return `Decomposition #${id} was already approved and formalized. Ask me to "show the scaffold" to see its current leaf-verification status.`;
  }

  // Build-51/53 warm-checker gate: ping /health before submitting leaves.
  // If cold, fire a FRESH wake ping so the container starts loading from NOW,
  // then tell the user to retry in ~10 min. The status stays 'pending'.
  const wm = await warmLeanChecker({ timeoutMs: 8000 });
  if (!wm.warm) {
    // Re-ping so Cloud Run starts a fresh boot cycle from this moment.
    leanHealth({ timeoutMs: 3000 }).catch(() => {});
    if (log) log("lean_warm_pending", { decompId: id, reason: wm.reason });
    return narrateWarmPending(id);
  }

  let scaffoldText = "";
  try {
    const sc = await scaffoldProof(row.dag_text, sessionId, { meta, log });
    scaffoldText = sc.text || "";
    if (sc.write) { try { await persistScaffold(sc.write); } catch (pErr) { console.error("[M8] approveProposal persist error (non-fatal):", pErr.message); } }
  } catch (e) {
    console.error("[M8] approveProposal scaffold error (non-fatal):", e.message);
    return `I approved decomposition #${id} but hit an error formalizing the leaves. Nothing was promoted — the target stays an open conjecture.`;
  }
  try { await getClient().from(TABLE).update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id); }
  catch (uErr) { console.error("[M8] approveProposal status-update error (non-fatal):", uErr.message); }
  return `Approved decomposition #${id}. Formalizing the leaves you approved via the M4 Lean lane:\n\n${scaffoldText}`;
}

// ── BUILD-56: EXPAND — graft a sub-decomposition under one lemma of a staged plan ──
async function expandProposal(propId, lemmaIdx, sessionId, { meta, log } = {}) {
  // Load the proposal (explicit #N, else the most-recent pending one).
  let row = null;
  if (propId) { const r = await fetchProposal(propId); row = r.row; }
  else { row = await findLatestPendingProposal(); }
  if (!row) {
    return `I couldn't find a staged decomposition to expand${propId ? ` (#${propId})` : ""}. Propose one first with "propose a decomposition for: <target>", then say "expand L<n>".`;
  }
  if (row.status === "approved") {
    return `Decomposition #${row.id} was already approved and formalized, so I won't restructure it. Propose a fresh one to explore a deeper plan.`;
  }
  const parentDag = parseDAG(row.dag_text || "");
  if (!parentDag.ok) {
    return `I couldn't re-read the stored plan for #${row.id} (${parentDag.errors.join("; ")}), so I won't risk grafting onto a broken DAG.`;
  }
  const targetLemma = parentDag.lemmas.find((l) => l.idx === lemmaIdx);
  if (!targetLemma) {
    return `Decomposition #${row.id} has no lemma L${lemmaIdx}. Its lemmas are: ${parentDag.lemmas.map((l) => l.name).join(", ")}.`;
  }
  // Depth guard — refuse BEFORE spending a Gemini draft if the branch is already deep.
  if (dagDepth(parentDag) >= MAX_DECOMP_DEPTH) {
    return `Decomposition #${row.id} is already ${dagDepth(parentDag)} levels deep (cap ${MAX_DECOMP_DEPTH}). I won't expand it further — a too-deep plan is harder to verify, not easier. Approve it and let the M4 lane check the leaves you have.`;
  }

  // Draft a sub-plan for the lemma's prose (reuses the proposer + anti-degeneracy gate).
  const sub = await proposeDecompositionPlan(targetLemma.prose);
  if (!sub.ok) {
    return [
      `I won't deepen L${lemmaIdx} of #${row.id}, because ${sub.reason}.`,
      ``,
      `L${lemmaIdx}: "${String(targetLemma.prose).slice(0, 160)}"`,
      ``,
      `Nothing was changed — #${row.id} stands exactly as it was. A degenerate sub-plan would be worse than leaving this lemma as a single scaffold.`,
    ].join("\n");
  }
  const merged = mergeSubDAG(parentDag, lemmaIdx, sub.dag);
  if (!merged.ok) {
    return `I drafted a sub-plan for L${lemmaIdx} but couldn't graft it cleanly (${merged.errors.join("; ")}). Nothing was changed — #${row.id} stands as it was.`;
  }
  if (dagDepth(merged.dag) > MAX_DECOMP_DEPTH) {
    return `Grafting that sub-plan would push #${row.id} past the depth cap (${MAX_DECOMP_DEPTH} levels). Nothing was changed. Approve the current plan instead.`;
  }
  const saved = await updateProposalDag(row.id, merged.dagText, merged.dag);
  if (log) log("decomp_expanded", { id: row.id, lemmaIdx, added: sub.dag.lemmas.length, depth: dagDepth(merged.dag), staged: saved });
  if (!saved) {
    return `I built the deeper plan for L${lemmaIdx} but couldn't save it (the ${TABLE} store wasn't reachable). Re-propose and try again — nothing was half-written.`;
  }
  return renderExpandedPacket(row.id, lemmaIdx, targetLemma.prose, merged.dag);
}

// ── ORCHESTRATOR ENTRY (buffered — Gemini draft + DB + /check) ─────
/**
 * det = detectDecompProposal(message). Returns { text }. Never throws.
 * propose: draft -> validate (shape + anti-degeneracy) -> stage -> [PROPOSED PLAN].
 * approve: load staged DAG -> M4 scaffold pipeline.
 */
async function buildDecompProposalContext(det, message, sessionId, { meta, log } = {}) {
  if (process.env.DECOMP_PROPOSER_DISABLED === "1") return { text: "" };
  try {
    if (det.mode === "approve") {
      if (isEphemeralSession(sessionId)) return { text: `(eval session — decomposition approval not run against the live store)` };
      return { text: await approveProposal(det.id, sessionId, { meta, log }) };
    }
    if (det.mode === "expand") {
      if (isEphemeralSession(sessionId)) return { text: `(eval session — decomposition expansion not run against the live store)` };
      return { text: await expandProposal(det.id, det.lemmaIdx, sessionId, { meta, log }) };
    }
    if (det.mode === "verify_now") {
      if (isEphemeralSession(sessionId)) return { text: `(eval session — verify-now not run against the live store)` };
      const pending = await findLatestPendingProposal();
      if (!pending) return { text: `No pending decomposition found to verify. Propose one first with "propose a decomposition for: <target>".` };
      if (log) log("decomp_verify_now", { pendingId: pending.id });
      return { text: await approveProposal(pending.id, sessionId, { meta, log }) };
    }
    if (det.mode === "propose") {
      const target = extractTarget(message);
      const res = await proposeDecompositionPlan(target);
      if (!res.ok) return { text: renderRejectionPacket(target, res.reason) };
      const id = isEphemeralSession(sessionId) ? null : await stageProposal(res.dag.target, res.dagText, res.dag);
      if (log) log("decomp_proposed", { staged: !!id, lemmas: res.dag.lemmas.length });
      return { text: renderProposalPacket(target, res.dag, id) };
    }
  } catch (e) {
    console.error("[M8] buildDecompProposalContext error (non-fatal):", e.message);
    return { text: "I hit an error handling that decomposition request and won't guess a result, Boss." };
  }
  return { text: "" };
}

module.exports = {
  // pure core (mirror-tested)
  contentTokens, tokenJaccard, checkNonDegenerate, serializeDAG, extractTarget,
  TARGET_SIM_MAX, LEAF_DISTINCT_MAX,
  // Build-56 multi-level pure core
  dagDepth, subDagRoots, mergeSubDAG, MAX_DECOMP_DEPTH,
  // detection
  detectDecompProposal, detectVerifyNow, PROPOSE_RE, APPROVE_RE, VERIFY_NOW_RE, EXPAND_RE,
  // llm + staging + approval
  proposeDecompositionPlan, stageProposal, fetchProposal, updateProposalDag, approveProposal,
  expandProposal, findLatestPendingProposal,
  // render
  renderProposalPacket, renderExpandedPacket, renderRejectionPacket, narrateWarmPending,
  // orchestrator entry
  buildDecompProposalContext,
  TABLE,
};
