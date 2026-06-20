/**
 * M8 Build-83d — Proposer Feedback Loop  (lib/proposer-feedback.js)
 *
 * Queries the knowledge graph for VERIFIED leaves (theorem nodes that passed Lean)
 * and DEAD-END leaves (leaf lemmas that were lean_rejected and never recovered), then
 * formats them as a feedback context block that conjecture-gen.js and
 * decomp-proposer.js inject into their generation prompts.
 *
 * WHY: the conjecture generator and decomposition proposer currently ignore what the
 * engine has already learned. Feeding back (a) verified ground lets the proposer skip
 * already-proven sub-goals; (b) dead-end patterns lets it avoid reformulations that
 * Lean rejected.
 *
 * PURE CORE (feedbackTokens, feedbackJaccard, matchesVerified, buildFeedbackContext)
 * is mirror-tested in tests/B83d-proposer-feedback-verify.ps1 (pure PS 5.1, offline).
 *
 * FAIL-SAFE: every Supabase call catches and returns [] — feedback is an enhancement
 * only; a network error must never break the generation pipeline.
 * DISABLED when GRAPH_DISABLED=1.
 */
const { createClient } = require("@supabase/supabase-js");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── PURE CORE (PS-mirror-tested) ─────────────────────────────────────────────

const FEEDBACK_STOPWORDS = new Set([
  "the","a","an","of","for","to","is","are","be","every","each","all","and","or",
  "that","this","with","by","in","on","its","it","as","at","if","then","so","we",
  "i","you","n","x","k","m","have","has","had","let","let's","be","does","do",
]);

/** Lower-case content tokens, punctuation stripped, stopwords removed. */
function feedbackTokens(s) {
  const toks = [];
  for (const t of String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (t.length > 0 && !FEEDBACK_STOPWORDS.has(t)) toks.push(t);
  }
  return toks;
}

/** Jaccard similarity over two token arrays (treated as sets). 0 when either is empty. */
function feedbackJaccard(tokA, tokB) {
  const A = new Set(tokA), B = new Set(tokB);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Minimum similarity for a proposed leaf to be flagged "already verified". */
const VERIFIED_MATCH_MIN = 0.70;

/** Days a scaffold must be idle with 0 verified leaves to count as stale. */
const STALE_DAYS = 3;

/**
 * Check whether a proposed leaf prose matches any verified leaf in the graph.
 * Returns { matched, matchedLabel?, sim? }. PURE, sync — PS-mirror-tested.
 */
function matchesVerified(prose, verifiedLeaves) {
  const tokA = feedbackTokens(prose);
  let best = { matched: false };
  for (const vl of verifiedLeaves || []) {
    const tokB = feedbackTokens(vl.label || "");
    const sim = feedbackJaccard(tokA, tokB);
    if (sim >= VERIFIED_MATCH_MIN && (!best.matched || sim > best.sim)) {
      best = { matched: true, matchedLabel: vl.label, sim };
    }
  }
  return best;
}

/**
 * Format verified + dead-end leaves into a prompt fragment.
 * Empty arrays produce an empty string. PURE, sync — PS-mirror-tested.
 *
 * Output format:
 *   VERIFIED GROUND ...:
 *     V1. <label>
 *   DEAD-END PATTERNS ...:
 *     D1. <content> [Lean error: ...]
 */
function buildFeedbackContext(verifiedLeaves, deadEndLeaves) {
  const lines = [];
  if (verifiedLeaves && verifiedLeaves.length) {
    lines.push("VERIFIED GROUND (Lean-machine-checked — sub-goals matching these are already proven):");
    verifiedLeaves.forEach((n, i) => {
      lines.push(`  V${i + 1}. ${String(n.label || "").slice(0, 200)}`);
    });
  }
  if (deadEndLeaves && deadEndLeaves.length) {
    lines.push("DEAD-END PATTERNS (lean_rejected after repair attempts — avoid similar sub-goal formulations):");
    deadEndLeaves.forEach((n, i) => {
      const text = String(n.content || n.label || "").slice(0, 200);
      const why = n.reason ? ` [Lean error: ${String(n.reason).replace(/\s+/g, " ").trim().slice(0, 120)}]` : "";
      lines.push(`  D${i + 1}. ${text}${why}`);
    });
  }
  return lines.join("\n");
}

// ── SUPABASE QUERIES ─────────────────────────────────────────────────────────

/**
 * Fetch the most recently Lean-verified theorem nodes from the knowledge graph.
 * Returns [{label, content}] or [] on error.
 */
async function getVerifiedLeaves(limit = 10) {
  try {
    const { data, error } = await getClient()
      .from("m8_graph_nodes")
      .select("label, content")
      .eq("kind", "theorem")
      .eq("status", "lean_verified")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.floor(limit)));
    if (error) {
      console.error("[M8] getVerifiedLeaves error (non-fatal):", error.message);
      return [];
    }
    return (data || []).map((n) => ({ label: n.label || "", content: n.content || "" }));
  } catch (err) {
    console.error("[M8] getVerifiedLeaves exception (non-fatal):", err.message);
    return [];
  }
}

/**
 * Fetch stale dead-end leaf lemmas: open scaffolds (leaves_verified=0) that have been
 * idle for >= STALE_DAYS days and whose individual leaves are lean_rejected.
 * Returns [{label, content, reason}] or [] on error.
 */
async function getDeadEndLeaves(limit = 10) {
  try {
    const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
    const { data, error } = await getClient()
      .from("m8_lemma_scaffold")
      .select("target, lemmas")
      .eq("status", "open")
      .eq("leaves_verified", 0)
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(Math.max(1, Math.floor(limit) * 3));
    if (error) {
      console.error("[M8] getDeadEndLeaves error (non-fatal):", error.message);
      return [];
    }
    const out = [];
    for (const row of data || []) {
      const lemmas = Array.isArray(row.lemmas) ? row.lemmas : [];
      for (const l of lemmas) {
        if (l && l.is_leaf && l.lean_status === "lean_rejected" && out.length < limit) {
          out.push({
            label: `${String(row.target || "").slice(0, 80)} / ${l.name || "?"}`,
            content: String(l.prose || ""),
            reason: l.reason ? String(l.reason).slice(0, 200) : null,
          });
        }
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.error("[M8] getDeadEndLeaves exception (non-fatal):", err.message);
    return [];
  }
}

module.exports = {
  // pure (PS-mirror-tested)
  feedbackTokens, feedbackJaccard, matchesVerified, buildFeedbackContext,
  VERIFIED_MATCH_MIN, STALE_DAYS,
  // Supabase queries (fail-safe)
  getVerifiedLeaves, getDeadEndLeaves,
};
