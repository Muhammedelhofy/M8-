/**
 * M8 Build-45 — Engine Capability Self-Catalog
 * lib/engine-catalog.js
 *
 * A deterministic, code-owned answer to "what can your problem-solving engine do?" /
 * "how do I run the engine?" / "list your research commands". M8 has many research/engine
 * capabilities (census, kernel-test, decomposition proposer, M4 scaffold, …) but no single
 * place that tells the user what they are or how to invoke them — you had to remember the
 * exact phrasing. This returns a precise menu with example commands + the honesty caveats.
 *
 * HONESTY: the catalog is FACTUAL about commands; it ships the same caveats the engine
 * itself enforces (observed-to-N is never a proof; leaves verified k/m never proves the
 * target; Lean is the only path to `proven`). The packet IS the answer (deterministic
 * hard-return, like the census/kernel lanes) — no LLM narration to drift it.
 *
 * Pure functions; fails safe (detection returns false on any doubt).
 */

// ── detection ─────────────────────────────────────────────────────────────────
// Fires on a CAPABILITY / how-to question about the research/problem-solving engine —
// NOT on an actual run (those carry a target + run verb and are claimed by the census /
// kernel / decomposition detectors, which run BEFORE this lane). Kept tight so a normal
// fleet/ops "what can you do" doesn't trip it: needs an ENGINE noun AND a catalog intent.
const CATALOG_INTENT = /\b(?:what\s+can|what\s+(?:are|kind|kinds|type|types)\b|how\s+(?:do|can|would|should)\s+(?:i|we)\b|how\s+to\b|list\b|show\s+me\b|which\b|tell\s+me\s+(?:about|what)|menu\b|catalog(?:ue)?\b)/i;
const ENGINE_NOUN = /\b(?:problem[- ]solving\s+engine|unsolved[- ]problem\s+engine|research\s+engine|conjecture\s+(?:engine|generator|templates?)|(?:your|the)\s+engine|engine'?s\b|research\s+(?:commands?|capabilit\w*|tools?|lanes?)|engine\s+(?:commands?|capabilit\w*)|what\s+(?:problems?|conjectures?|patterns?)\s+can\s+you\s+(?:test|attack|work)|census(?:es)?|kernel\s+test|decompositions?|lemma[- ]?dag)\b/i;
// A direct "engine capabilities/commands" phrase fires on its own.
const ENGINE_DIRECT = /\b(?:engine|research)\s+(?:capabilit\w*|commands?|menu|catalog(?:ue)?)\b/i;
// "what problems/conjectures/patterns can you test/attack/…" fires on its own.
const WHAT_CAN_TEST = /\bwhat\s+(?:problems?|conjectures?|patterns?|math)\s+can\s+you\s+(?:test|attack|work|solve|prove|explore)\b/i;

function detectEngineCatalog(message) {
  const s = String(message || "").trim();
  if (s.length < 8) return false;
  if (ENGINE_DIRECT.test(s)) return true;
  if (WHAT_CAN_TEST.test(s)) return true;
  return CATALOG_INTENT.test(s) && ENGINE_NOUN.test(s);
}

// ── the catalog (deterministic ground truth) ───────────────────────────────────
function renderEngineCatalog() {
  return [
    `M8 PROBLEM-SOLVING ENGINE — what I can do + how to ask (deterministic catalog, computed in code).`,
    ``,
    `RESEARCH / ENGINE COMMANDS:`,
    ``,
    `1) Structural census — Collatz (M1)`,
    `   • "run the structural probes on collatz up to 100000"`,
    `   → a neutral feature census (stopping times, parity, 2-adic, residues, records). Observed up to N, NOT evidence for/against the conjecture.`,
    ``,
    `2) Structural census — reverse-and-add / Lychrel "196" (2nd domain)`,
    `   • "run the reverse-and-add census up to 1000"`,
    `   → steps-to-palindrome census + the suspected-Lychrel seeds. "Suspected/OPEN" — never "is Lychrel", never "all numbers reach a palindrome".`,
    ``,
    `3) Conjecture generator (M3)`,
    `   • "run the conjecture generator on collatz up to 100000"`,
    `   → mined template conjectures, each deterministically falsified. Survivors are "tested to N, still open", never proven.`,
    ``,
    `4) Test the kernel of a number-pattern / fringe idea`,
    `   • "test the kernel of the vortex doubling idea"  ·  "test this claim: the digital root of 3n is always 3"`,
    `   → splits the idea into its established KERNEL vs speculative LEAP, tests a computable claim by exhaustive computation ("observed through N"), falsifies a false claim with a counterexample and offers the nearest TRUE pattern. The leap stays speculative.`,
    ``,
    `5) Plan the attack — decomposition proposer (Option A)`,
    `   • "propose a decomposition for: <target conjecture>"  → a [PROPOSED PLAN]: a candidate lemma-DAG (a plan, NOT a proof).`,
    `   • "approve decomposition #N"                          → formalizes the leaves via the Lean lane.`,
    `   → leaves are checked k/m; the target stays an OPEN CONJECTURE even at 100% leaves discharged.`,
    ``,
    `6) Lemma-DAG scaffold (M4-manual) + Lean`,
    `   • "scaffold this proof: target: …  L1: …  L2: … [deps: L1]"`,
    `   → formalizes + machine-checks the LEAF lemmas in Lean; parents held as honest \`sorry\`.`,
    ``,
    `7) Ingest external knowledge`,
    `   • "ingest this as established: <text>"  ·  "add this paper speculative: <text>"`,
    `   → stores claims in the research graph with your epistemic classification (you set established/speculative, never me).`,
    ``,
    `IRON HONESTY RULES (the engine enforces these in code, not just prose):`,
    `• "Observed/tested to N" is NEVER a proof, and NEVER says "all n".`,
    `• A verified leaf does NOT prove its parent or the target — only "leaves verified k/m".`,
    `• Lean machine-check is the ONLY path to "proven"; a counterexample the ONLY path to "refuted".`,
    `• I compute the result in code; I never invent a figure or launder a speculative idea as established.`,
    ``,
    `Ask "run the reverse-and-add census up to 1000" or "propose a decomposition for: <your target>" to try one.`,
  ].join("\n");
}

module.exports = { detectEngineCatalog, renderEngineCatalog };
