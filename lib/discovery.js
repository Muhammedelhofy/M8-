/**
 * M8 Computational Discovery Loop — lib/discovery.js  (Phase 4, Build-1)
 *
 * The North-Star math track: pattern → conjecture → VERIFY (compute) → LOG.
 * A discovery turn FUSES the two truth-tools that already exist:
 *   - the Gemini-native code-execution lane (the verification runs as real code)
 *   - the Research Notebook (the outcome lands in the persistent ledger)
 *
 * THE GAP THIS CLOSES: "verify Collatz up to 100,000 and log the result" used to
 * either (a) hit the notebook WRITE detection and log the USER'S TEXT without
 * computing anything, or (b) hit the compute lane and produce a result that never
 * reached the ledger. Now: the computation runs, and a notebook entry built from
 * the COMPUTED OUTCOME is staged post-LLM and persisted once at STORE.
 *
 * HONESTY (load-bearing, this is the North-Star lane):
 *   - A computational check is EVIDENCE, never a proof. The directive forces
 *     "verified up to N" framing; the ledger entry records a bounded check.
 *   - The note content carries PROVENANCE ("auto-logged from a code-execution
 *     run") and quotes the model's reported outcome — which the verified-output
 *     contract already constrains to narration ≤ evidence.
 *   - If the run failed (fallback response / no execution marker), NOTHING is
 *     logged — an unverified claim must never enter the ledger as evidence.
 *   - A found counterexample is logged as kind 'counterexample' (a permanent
 *     finding), not as supporting evidence.
 *
 * Fails SAFE everywhere; pure functions except for what the orchestrator wires.
 */
const { slugify, parseThread } = require("./notebook");

// ── detection ─────────────────────────────────────────────────────────────────
// A discovery turn = a RUN-THE-CHECK ask on a research-shaped target, with a
// bound or an explicit log-to-notebook intent. Deliberately surgical:
//   - "verify the Collatz conjecture up to 100000"            → fires (bound)
//   - "check Goldbach for every even number below 10^6"       → fires (bound)
//   - "explore twin primes up to 1e7 and log what you find"   → fires (log+bound)
//   - "what is 7^13"                                          → does NOT fire (plain compute)
//   - "log a conjecture on collatz: ..."                      → does NOT fire (plain notebook write)
//   - "where are we on collatz"                               → does NOT fire (notebook read)
const RUN_VERB = /\b(verify|check|test|explore|search|scan|run|confirm|probe|compute)\b/i;
const RESEARCH_TARGET = /\b(conjecture|hypothesis|collatz|goldbach|twin\s+primes?|primes?|perfect\s+numbers?|abundant|amicable|fibonacci|oeis|sequence|riemann|mersenne|fermat|abc\s+conjecture|beal|counterexamples?|digit\s+sums?|happy\s+numbers?|palindrom)\b/i;
const BOUND_RE = /\b(?:up\s+to|below|under|first|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m))?|10\s*\^\s*\d+|1e\d+|2\s*\^\s*\d+)\b/i;
const LOG_INTENT = /\b(?:log|record|save|capture|note|write)\b[^.?!]{0,40}\b(?:notebook|ledger|finding|result|outcome|evidence)\b|\bnotebook\b/i;

function detectDiscovery(message) {
  const s = (message || "").trim();
  if (s.length < 8) return { discovery: false };
  if (!RUN_VERB.test(s) || !RESEARCH_TARGET.test(s)) return { discovery: false };
  const bound = s.match(BOUND_RE);
  const wantsLog = LOG_INTENT.test(s);
  // A bound alone is enough (a bounded research check IS the discovery loop);
  // a log-intent alone also fires (the user explicitly wants the ledger fed).
  if (!bound && !wantsLog) return { discovery: false };
  return {
    discovery: true,
    bound: bound ? bound[1] : null,
    wantsLog,
    thread: extractTopic(s),
  };
}

// Topic → thread slug. Explicit notebook markers win; else capture the research
// target ("verify the COLLATZ CONJECTURE up to…"); else null (caller defaults).
const TOPIC_CAPTURE = /\b(?:verify|check|test|explore|search|scan|run|confirm|probe)\s+(?:that\s+|whether\s+|if\s+)?(?:the\s+)?([a-z][a-z0-9\s'’-]{2,40}?)\s*(?:conjecture|hypothesis|sequence|problem)?\s*(?:holds?\s+)?(?:\bup\s+to\b|\bbelow\b|\bunder\b|\bto\b|\bfor\b|,|$)/i;
function extractTopic(s) {
  const explicit = parseThread(s);
  if (explicit) return explicit;
  const m = (s || "").match(TOPIC_CAPTURE);
  if (m) {
    const t = slugify(m[1].replace(/\b(every|each|all|numbers?|even|odd|integers?|n|holds?)\b/gi, "").trim());
    if (t && t.length >= 3) return t;
  }
  const known = (s || "").match(RESEARCH_TARGET);
  if (known && !/^(conjecture|hypothesis|sequence|counterexamples?|primes?)$/i.test(known[0])) return slugify(known[0]);
  return null;
}

// ── the directive injected for the LLM turn ───────────────────────────────────
function buildDiscoveryDirective(thread, bound) {
  const t = (thread || "general").replace(/-/g, " ");
  return `COMPUTATIONAL DISCOVERY RUN (this turn — the North-Star research loop): Muhammad is asking you to actually RUN this check, not discuss it.
1) WRITE AND EXECUTE code that performs the verification${bound ? ` to the stated bound (${bound})` : ""} — never estimate or recall the answer. If the full bound is too heavy for the sandbox, run the largest feasible bound and SAY what you actually checked.
2) REPORT exactly what the code found: how many cases were checked, the bound reached, and the outcome (no counterexample found / counterexample at n=…, with the value). The printed output is ground truth — narration must not exceed it.
3) FRAME IT HONESTLY: a bounded computational check is EVIDENCE, never a proof. Say "verified up to N" / "holds for all n ≤ N tested" — NEVER "proven", "confirmed true", or any wording implying the open problem is settled.
4) THE LEDGER: this outcome is being recorded to the research notebook thread "${t}" automatically — acknowledge that in one short line at the end ("logged to the notebook"). Do not claim anything was logged beyond what you actually found.`;
}

// ── post-LLM: build the ledger entry from the COMPUTED outcome ────────────────
// Only stages a note when the response shows a real execution happened; a failed
// or evasive turn logs NOTHING (an unverified claim never enters the ledger).
const EXEC_MARKER = /\bcomput|python|ran\s+(?:the\s+)?code|execut|sandbox|code\s+execution/i;
const COUNTEREXAMPLE_MARKER = /\bcounter\s*-?\s*examples?\s+(?:found|at|exists?|discovered)|\bfails?\s+(?:at|for)\s+n?\s*=?\s*\d|\bfound\s+a\s+counter\s*-?\s*example\b|\brefuted\b/i;
const NO_COUNTEREXAMPLE = /\bno\s+counter\s*-?\s*examples?\b|\bholds?\s+(?:for|up\s+to|through)\b|\ball\s+(?:cases|values|numbers)\s+(?:checked|verified|passed)|\bverified\s+(?:up\s+to|through|for)\b/i;

function buildDiscoveryNote({ message, response, thread, bound }) {
  const resp = (response || "").trim();
  if (!resp || resp.length < 40) return null;
  if (!EXEC_MARKER.test(resp)) return null;   // no evidence a run actually happened

  const foundCounter = COUNTEREXAMPLE_MARKER.test(resp) && !NO_COUNTEREXAMPLE.test(resp);
  const ask = (message || "").trim().slice(0, 200);
  // Quote the model's reported outcome (contract-constrained), with provenance.
  const outcome = resp.replace(/\s+/g, " ").slice(0, 700);

  return {
    kind: foundCounter ? "counterexample" : "evidence",
    stance: foundCounter ? null : "for",
    status: null,
    thread: thread || "general",
    content: `[auto-logged from a code-execution run${bound ? `, bound ${bound}` : ""}] Ask: "${ask}". Reported outcome: ${outcome}`,
    importance: foundCounter ? 5 : 3,
  };
}

module.exports = {
  detectDiscovery, extractTopic,
  buildDiscoveryDirective, buildDiscoveryNote,
  // exported for tests:
  RUN_VERB, RESEARCH_TARGET, BOUND_RE, LOG_INTENT, EXEC_MARKER, COUNTEREXAMPLE_MARKER, NO_COUNTEREXAMPLE,
};
