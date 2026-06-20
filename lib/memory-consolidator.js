/**
 * lib/memory-consolidator.js — Build-85e: Memory Consolidation
 *
 * Over time M8's fact store (m8_conversations, memory_type profile/operational)
 * accumulates near-duplicate facts ("the fleet has 12 cars" / "fleet is 12 cars")
 * and occasionally outright contradictions ("net target 5000" vs "4000"). This
 * module keeps the store clean WITHOUT ever hard-deleting:
 *
 *   findDuplicates(db)     — group current facts by Jaccard >= 0.6 on their text;
 *                            returns [{ canonical, duplicates[] }].
 *   consolidate(db)        — soft-merge each group's duplicates into the canonical
 *                            row via a `merged_into` pointer (+ is_current=false),
 *                            so recall (which filters merged_into IS NULL) only
 *                            ever sees one copy. Reversible — nothing is deleted.
 *   flagContradictions(db) — for candidate fact pairs (same memory_key), ask
 *                            gemini-2.5-flash (cheap, 100 tok) whether they
 *                            contradict; if so flag the LOWER-confidence row
 *                            (contradiction_flag + reason). The Gemini calls are
 *                            FIRE-AND-FORGET (never awaited, never block) and the
 *                            run is capped at 50 pairs.
 *
 * Everything is fail-safe: any DB/LLM error is swallowed + logged; the caller
 * (api/memory-consolidate.js) always gets a usable result object.
 */
const { generate } = require("./llm");

const JACCARD_THRESHOLD = 0.6;        // group facts at/above this text overlap
const MAX_PAIRS         = 50;         // contradiction-check budget per run
const FACT_FETCH_LIMIT  = 500;        // cap the working set per run
const CONTRA_MODEL      = "gemini-2.5-flash";
const CONTRA_ORDER      = "gemini,gemini2";   // free Gemini bucket(s) only

// ── text similarity (PURE — mirrored byte-for-byte in the PS verifier) ───────
function tokenSet(s) {
  const words = String(s == null ? "" : s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  return new Set(words);
}

function jaccard(a, b) {
  const A = a instanceof Set ? a : tokenSet(a);
  const B = b instanceof Set ? b : tokenSet(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Canonical = most important; tie-break to the OLDEST (most established) row.
function pickCanonical(rows) {
  return rows.slice().sort((a, b) =>
    ((b.importance || 0) - (a.importance || 0)) ||
    (new Date(a.created_at || 0) - new Date(b.created_at || 0))
  )[0];
}

// Greedy grouping by Jaccard >= threshold (a fact joins a group if it overlaps
// ANY member). Returns [{ canonical, duplicates[] }] only for groups that
// actually contain >= 1 duplicate.
function groupByJaccard(facts, threshold) {
  const th = (typeof threshold === "number") ? threshold : JACCARD_THRESHOLD;
  const groups = [];   // [{ sets:[Set], rows:[row] }]
  for (const f of (facts || [])) {
    const fset = tokenSet(f && f.content);
    let placed = false;
    for (const g of groups) {
      if (g.sets.some((s) => jaccard(fset, s) >= th)) {
        g.sets.push(fset); g.rows.push(f); placed = true; break;
      }
    }
    if (!placed) groups.push({ sets: [fset], rows: [f] });
  }
  return groups
    .filter((g) => g.rows.length > 1)
    .map((g) => {
      const canonical  = pickCanonical(g.rows);
      const duplicates = g.rows.filter((r) => r.id !== canonical.id);
      return { canonical, duplicates };
    });
}

// Confidence ranking for "which row loses a contradiction": trust dominates,
// importance breaks ties.
function confidence(r) {
  return (r && r.trust_level ? r.trust_level : 0) * 10 + (r && r.importance ? r.importance : 0);
}

// Candidate contradiction pairs = facts sharing a memory_key (same subject,
// possibly different value). Capped at `cap` pairs for the whole run.
function candidatePairs(facts, cap) {
  const limit = (typeof cap === "number") ? cap : MAX_PAIRS;
  const byKey = new Map();
  for (const f of (facts || [])) {
    const k = (f && f.memory_key) ? f.memory_key : "_nokey_";
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  }
  const pairs = [];
  for (const rows of byKey.values()) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        pairs.push([rows[i], rows[j]]);
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}

// Tolerant JSON extraction (fenced / unquoted-key tolerant).
function parseContradiction(raw) {
  const s = String(raw == null ? "" : raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); }
  catch (_) {
    try { return JSON.parse(m[0].replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')); }
    catch (_2) { return null; }
  }
}

// ── DB fetch (current, non-merged profile/operational facts) ─────────────────
async function fetchFacts(db) {
  const res = await db
    .from("m8_conversations")
    .select("id, content, importance, trust_level, memory_key, memory_type, created_at")
    .eq("is_current", true)
    .in("memory_type", ["profile", "operational"])
    .is("merged_into", null)
    .order("created_at", { ascending: true })
    .limit(FACT_FETCH_LIMIT);
  return res.data || [];
}

/**
 * findDuplicates(db) — returns [{ canonical, duplicates[] }] for the current
 * fact set. Never throws.
 */
async function findDuplicates(db) {
  try {
    const facts = await fetchFacts(db);
    return groupByJaccard(facts, JACCARD_THRESHOLD);
  } catch (e) {
    console.error("[M8 consolidator] findDuplicates error (non-fatal):", e && e.message);
    return [];
  }
}

/**
 * consolidate(db) — soft-merge duplicates into their canonical row via
 * merged_into (+ is_current=false). Returns { consolidated, kept }:
 *   consolidated = number of duplicate rows folded away this run,
 *   kept         = number of canonical (current, non-merged) facts remaining.
 * Never throws.
 */
async function consolidate(db) {
  let consolidated = 0;
  try {
    const groups = await findDuplicates(db);
    for (const g of groups) {
      const dupIds = (g.duplicates || []).map((d) => d.id);
      if (!dupIds.length) continue;
      const { error } = await db
        .from("m8_conversations")
        .update({ merged_into: g.canonical.id, is_current: false })
        .in("id", dupIds);
      if (error) {
        console.error("[M8 consolidator] merge error (non-fatal):", error.message);
        continue;
      }
      consolidated += dupIds.length;
    }
  } catch (e) {
    console.error("[M8 consolidator] consolidate error (non-fatal):", e && e.message);
  }

  let kept = null;
  try {
    const res = await db
      .from("m8_conversations")
      .select("id", { count: "exact", head: true })
      .eq("is_current", true)
      .in("memory_type", ["profile", "operational"])
      .is("merged_into", null);
    kept = (res && res.count != null) ? res.count : null;
  } catch (_) { /* count is best-effort */ }

  return { consolidated, kept };
}

// fire-and-forget: ask Gemini whether two facts contradict; if so, flag the
// lower-confidence row. NEVER awaited by the caller.
function checkPairAsync(db, a, b) {
  const prompt =
    "Do these two stored facts about the same subject CONTRADICT each other " +
    "(assert incompatible values)? Return JSON only: {contradict: true/false, reason: \"short\"}.\n" +
    "Fact A: " + String(a && a.content || "").slice(0, 300) + "\n" +
    "Fact B: " + String(b && b.content || "").slice(0, 300);
  Promise.resolve()
    .then(() => generate({
      systemInstruction: "You detect factual contradictions between two stored facts. Return ONLY the JSON object.",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      providerOrder: CONTRA_ORDER,
      genConfig: { temperature: 0, maxOutputTokens: 100, geminiModel: CONTRA_MODEL },
    }))
    .then((raw) => {
      const v = parseContradiction(raw);
      if (!v || v.contradict !== true) return null;
      const loser = confidence(a) <= confidence(b) ? a : b;
      return db
        .from("m8_conversations")
        .update({ contradiction_flag: true, contradiction_reason: String(v.reason || "").slice(0, 500) })
        .eq("id", loser.id);
    })
    .catch((e) => console.error("[M8 consolidator] contradiction check (non-fatal):", e && e.message));
}

/**
 * flagContradictions(db) — dispatch up to MAX_PAIRS fire-and-forget gemini-2.5-flash
 * contradiction checks over candidate pairs. Returns { pairs } = number dispatched
 * this run. Never throws; the per-pair Gemini calls + DB flags run asynchronously.
 */
async function flagContradictions(db) {
  let pairs = 0;
  try {
    const facts = await fetchFacts(db);
    const cands = candidatePairs(facts, MAX_PAIRS);
    pairs = cands.length;
    for (const [a, b] of cands) checkPairAsync(db, a, b);   // fire-and-forget
  } catch (e) {
    console.error("[M8 consolidator] flagContradictions error (non-fatal):", e && e.message);
  }
  return { pairs };
}

module.exports = {
  findDuplicates,
  consolidate,
  flagContradictions,
  // exported for tests/B85e-memory-consolidation-verify.ps1 (pure-logic mirror)
  tokenSet,
  jaccard,
  groupByJaccard,
  pickCanonical,
  candidatePairs,
  confidence,
  parseContradiction,
  fetchFacts,
  JACCARD_THRESHOLD,
  MAX_PAIRS,
};
