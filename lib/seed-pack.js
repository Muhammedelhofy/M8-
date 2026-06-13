/**
 * M8 M2 Literature Seed Pack — lib/seed-pack.js  (Build-15, S8)
 *
 * The curated-literature layer of the ladder (M1 ✅ → M3-lite ✅ → M2 → M3-full):
 * hand-curated, source-verified known results as `external`-provenance graph
 * nodes, plus NOVELTY GATE v1 — the deterministic comparator that stops the
 * generator from calling known math a discovery (Gemini's round-3 warning:
 * "M3's Type B templates will keep re-deriving exactly these statistical
 * baselines").
 *
 * DESIGN (round-3 Q1, BUILD_15_SPEC.md):
 *   - The pack JSON (data/seed-packs/collatz-v1.json) is the single source of
 *     truth: git-reviewed, schema-validated, every load-bearing figure verified
 *     against its cited source AT CURATION TIME (Manus's KG-integrity step).
 *   - Novelty v1 = canonical-form FIRST (template + structural slots vs each
 *     seed's matches_templates patterns — symbolic, hermetic, deterministic),
 *     embedding similarity SECOND (async adjacency pass in memory-graph.js;
 *     suggestive only). Paraphrase drift can't fail this open: the first pass
 *     never reads prose.
 *   - A match means the FORM is known mathematics. It does NOT mean the
 *     literature states our finite-bound figure, and a non-match does NOT mean
 *     novel (the pack is 18 seeds, not all of mathematics). Narration carries
 *     both caveats (spec critique A4).
 *   - Seeding into the live graph is api/seed-pack.js (source='external' after
 *     migrations/m2_external_source.sql). This lib stays sync + DB-free so the
 *     generator can call it in-process and tests run hermetically.
 *
 * NON-GOALS (locked): PDF-parsing/crawling pipelines · novelty SCORES (M3-full)
 * · Lean contradiction checks (M3-full era).
 */
const PACK = require("../data/seed-packs/collatz-v1.json");

const RESULT_TYPES = new Set(["theorem", "conjecture", "computational_result", "counterexample", "survey_claim"]);
const SCOPES = new Set(["finite", "asymptotic", "density", "structural"]);
const PROOF_STRENGTHS = new Set(["proved", "conditional", "empirical"]);

/** Validate one seed against the adopted schema. Returns [] or error strings. */
function validateSeed(s) {
  const errs = [];
  if (!s || typeof s !== "object") return ["seed is not an object"];
  if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) errs.push("bad id");
  if (!s.title || typeof s.title !== "string") errs.push("missing title");
  if (!s.statement || String(s.statement).length < 40) errs.push("statement too thin to be atomic");
  if (!RESULT_TYPES.has(s.result_type)) errs.push(`bad result_type ${s.result_type}`);
  if (!SCOPES.has(s.scope)) errs.push(`bad scope ${s.scope}`);
  if (s.proof_strength != null && !PROOF_STRENGTHS.has(s.proof_strength)) errs.push(`bad proof_strength ${s.proof_strength}`);
  if (typeof s.negative_result !== "boolean") errs.push("negative_result must be boolean");
  if (!s.source_citation) errs.push("missing source_citation");
  if (!s.author || !s.year) errs.push("missing author/year");
  if (!Array.isArray(s.related_features)) errs.push("related_features must be an array");
  if (!Array.isArray(s.matches_templates)) errs.push("matches_templates must be an array");
  if (!s.verification || !s.verification.method || !s.verification.date) errs.push("missing curation verification record (KG-integrity step)");
  return errs;
}

function validatePack() {
  const errs = [];
  const ids = new Set();
  for (const s of PACK.seeds || []) {
    for (const e of validateSeed(s)) errs.push(`${s && s.id}: ${e}`);
    if (ids.has(s.id)) errs.push(`duplicate id ${s.id}`);
    ids.add(s.id);
  }
  if ((PACK.seeds || []).length < 15) errs.push(`pack has ${(PACK.seeds || []).length} seeds — round-3 scope is 15-20`);
  if ((PACK.seeds || []).length > 20) errs.push(`pack has ${(PACK.seeds || []).length} seeds — round-3 scope is 15-20`);
  return errs;
}

/**
 * NOVELTY GATE v1, deterministic pass. candidate = an M3 candidate object
 * ({ template, plus structural slots like t/k/m/r }). A seed pattern is either
 * "TEMPLATE" (covers the whole family — adopted semantics: the statistical
 * baseline behind that template family is known math) or "TEMPLATE:slot=val"
 * (pins one structural slot). First hit wins.
 * Returns { id, title, citation } or null. Pure, sync, hermetic-safe.
 */
function seedKnownMatch(candidate) {
  if (!candidate || !candidate.template) return null;
  for (const s of PACK.seeds || []) {
    for (const pat of s.matches_templates || []) {
      const [tpl, cond] = String(pat).split(":");
      if (tpl !== candidate.template) continue;
      if (cond) {
        const [slot, val] = cond.split("=");
        if (String(candidate[slot]) !== String(val)) continue;
      }
      return { id: s.id, title: s.title, citation: s.source_citation };
    }
  }
  return null;
}

/** Map a seed to its graph-node shape (api/seed-pack.js uses this 1:1). */
const KIND_BY_RESULT_TYPE = {
  theorem: "theorem",
  conjecture: "conjecture",
  computational_result: "evidence",
  counterexample: "counterexample",
  survey_claim: "evidence",
};
function seedToNode(s) {
  const kind = s.node_kind || KIND_BY_RESULT_TYPE[s.result_type] || "evidence";
  return {
    kind,
    label: `${s.author} ${s.year}: ${s.title.replace(/^[^—]*—\s*/, "")}`.slice(0, 200),
    normLabel: `seed-${s.id}`,
    content: `[LITERATURE — curated external seed, pack ${PACK.pack}] ${s.statement} Source: ${s.source_citation}.${s.tested_bound ? ` Tested bound: ${s.tested_bound}.` : ""}${s.negative_result ? " (Negative result — constrains failure modes.)" : ""}`,
    thread: PACK.thread,
    status: "literature",
    source: "external",
    metadata: {
      seed_id: s.id,
      seed_pack: PACK.pack,
      provenance: "external",
      result_type: s.result_type,
      scope: s.scope,
      proof_strength: s.proof_strength || null,
      tested_bound: s.tested_bound || null,
      negative_result: !!s.negative_result,
      source_citation: s.source_citation,
      author: s.author,
      year: s.year,
      url: s.url || null,
      keywords: s.keywords || [],
      related_features: s.related_features || [],
      verification: s.verification || null,
    },
  };
}

module.exports = {
  PACK,
  seeds: PACK.seeds,
  seedKnownMatch, seedToNode, validatePack, validateSeed,
  KIND_BY_RESULT_TYPE, RESULT_TYPES, SCOPES, PROOF_STRENGTHS,
};
