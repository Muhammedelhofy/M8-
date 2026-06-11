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
const { slugify, parseThread, DEFAULT_THREAD } = require("./notebook");

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
// Loop trigger: user wants N sequential steps, not just one check.
// "keep going for 3 steps" / "for 2 steps" / "2 steps" / "automatically" / "multi-step"
const LOOP_TRIGGER = /\bkeep\s+going\b|\bfor\s+(\d+)\s+(?:more\s+)?steps?\b|\b(\d+)\s+(?:more\s+)?steps?\b|\bautomatically(?:\s+(?:run|continue|loop))?\b|\bmulti[- ]?step\b/i;

function extractMaxSteps(s) {
  let m = (s || "").match(/\bfor\s+(\d+)\s+(?:more\s+)?steps?\b/i);
  if (m) return Math.min(Math.max(parseInt(m[1], 10), 1), 5);
  m = (s || "").match(/\b(\d+)\s+(?:more\s+)?steps?\b/i);
  if (m) return Math.min(Math.max(parseInt(m[1], 10), 1), 5);
  return 3;  // default for bare "keep going" / "automatically"
}

function detectDiscovery(message) {
  const s = (message || "").trim();
  if (s.length < 8) return { discovery: false };
  if (!RUN_VERB.test(s) || !RESEARCH_TARGET.test(s)) return { discovery: false };
  const bound = s.match(BOUND_RE);
  const wantsLog = LOG_INTENT.test(s);
  // A bound alone is enough (a bounded research check IS the discovery loop);
  // a log-intent alone also fires (the user explicitly wants the ledger fed).
  if (!bound && !wantsLog) return { discovery: false };
  const looped = LOOP_TRIGGER.test(s);
  return {
    discovery: true,
    bound: bound ? bound[1] : null,
    wantsLog,
    thread: extractTopic(s),
    looped,
    maxSteps: looped ? extractMaxSteps(s) : 1,
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
2) REPORT exactly what the code found: how many cases were checked, the bound reached, and the outcome (no counterexample found / counterexample at n=…, with the value). Signal the execution EXPLICITLY in your reply — say "computed" or "ran the code" — so the run is unmistakable. The printed output is ground truth — narration must not exceed it.
3) FRAME IT HONESTLY: a bounded computational check is EVIDENCE, never a proof. Say "verified up to N" / "holds for all n ≤ N tested" — NEVER "proven", "confirmed true", or any wording implying the open problem is settled.
4) THE LEDGER: this outcome is being recorded to the research notebook thread "${t}" automatically — acknowledge that in one short line at the end ("logged to the notebook"). Do not claim anything was logged beyond what you actually found.`;
}

// ── post-LLM: build the ledger entry from the COMPUTED outcome ────────────────
// Only stages a note when the response shows a real execution happened; a failed
// or evasive turn logs NOTHING (an unverified claim never enters the ledger).
const EXEC_MARKER = /\bcomput|python|ran\s+(?:the\s+)?(?:code|check|verification)|run\s+the\s+(?:check|verification)|execut|sandbox|code\s+execution/i;
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

// ── Build-2: bound scaling ────────────────────────────────────────────────────
// Parse a bound string to a raw number. Handles plain numbers, 10^N, 1eN, 2^N,
// and suffix forms (M/B/K). Returns null if unparseable.
function parseBoundToNumber(s) {
  if (!s) return null;
  const c = String(s).replace(/,|_/g, "").trim();
  let m = c.match(/^10\s*\^\s*(\d+(?:\.\d+)?)$/i);
  if (m) return Math.pow(10, parseFloat(m[1]));
  m = c.match(/^2\s*\^\s*(\d+(?:\.\d+)?)$/i);
  if (m) return Math.pow(2, parseFloat(m[1]));
  m = c.match(/^(\d+(?:\.\d+)?)[eE]\+?(\d+)$/);
  if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
  m = c.match(/^(\d+(?:\.\d+)?)\s*(million|billion|thousand|k|m|b)$/i);
  if (m) {
    const n = parseFloat(m[1]), sfx = m[2].toLowerCase();
    if (/^(m|million)$/.test(sfx)) return n * 1e6;
    if (/^(b|billion)$/.test(sfx)) return n * 1e9;
    if (/^(k|thousand)$/.test(sfx)) return n * 1e3;
  }
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

// Scale a bound string up ~10x. Preserves the original notation style.
function scaleUpBound(bound) {
  const s = String(bound || "").replace(/,|_/g, "").trim();
  // "10^N" → "10^(N+1)"
  let m = s.match(/^10\s*\^\s*(\d+)$/i);
  if (m) return `10^${parseInt(m[1], 10) + 1}`;
  // "1eN" → "1e(N+1)"
  m = s.match(/^1\s*[eE]\s*(\d+)$/);
  if (m) return `1e${parseInt(m[1], 10) + 1}`;
  // "NeN" (e.g. "5e6") — bump exponent
  m = s.match(/^(\d+(?:\.\d+)?)\s*[eE]\s*(\d+)$/);
  if (m) return `1e${parseInt(m[2], 10) + 1}`;
  // "2^N" → "2^(N+4)" ≈ 16x (practical power-of-2 exploration step)
  m = s.match(/^2\s*\^\s*(\d+)$/i);
  if (m) return `2^${parseInt(m[1], 10) + 4}`;
  const n = parseBoundToNumber(s);
  if (n === null) return bound;
  const scaled = n * 10;
  if (scaled >= 1e9) return `${Math.round(scaled / 1e9)}B`;
  if (scaled >= 1e6) return `${Math.round(scaled / 1e6)}M`;
  return scaled.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ── Build-2: looped directive ─────────────────────────────────────────────────
// A single LLM call that runs N sequential bounds in one Python code block.
// Falls back to Build-1 single-step behavior at the caller if maxSteps <= 1.
function buildLoopedDiscoveryDirective(thread, startBound, maxSteps) {
  const t = (thread || "general").replace(/-/g, " ");
  const steps = Math.min(Math.max(maxSteps || 3, 2), 5);
  const bounds = [startBound || "100,000"];
  for (let i = 1; i < steps; i++) bounds.push(scaleUpBound(bounds[i - 1]));
  const stepsDesc = bounds.map((b, i) => `Step ${i + 1}: up to ${b}`).join("; ");
  return `COMPUTATIONAL DISCOVERY LOOP — ${steps} sequential steps (${stepsDesc}).
Muhammad wants a chained exploration run. Execute ALL steps in a SINGLE Python code block:
1) Loop through bounds [${bounds.join(", ")}] in order.
2) For each bound, run the ${t} verification and print EXACTLY this format on its own line: "Step N (bound B): <outcome>" — where outcome states how many cases checked and whether a counterexample was found ("No counterexample found through B" or "Counterexample found at n=X with value Y").
3) STOP immediately if a counterexample is found — do NOT continue to larger bounds.
4) FRAME HONESTLY: each step is computational EVIDENCE up to that bound, not a proof. Say "verified up to N" or "no counterexample found through N" — NEVER "proven", "confirmed", or "solved".
5) After all steps, one summary line: "Exploration complete: checked ${bounds[0]} through [largest bound reached], [total N] cases, [no counterexample / counterexample at n=X]."
6) End with one short line: "Logged to the notebook." — claim only what the code actually found.`;
}

// ── Build-2: parse N step entries from a looped response ─────────────────────
// Returns { notes[], lastBound, foundCounter }. Falls back to single-note
// (Build-1) if no "Step N (bound B):" markers are found in the response.
// A failed run (no EXEC_MARKER) returns empty — nothing logged.
function buildDiscoveryNotes({ message, response, thread, startBound }) {
  const resp = (response || "").trim();
  const empty = { notes: [], lastBound: startBound, foundCounter: false };
  if (!resp || resp.length < 40) return empty;
  if (!EXEC_MARKER.test(resp)) return empty;

  const ask = (message || "").trim().slice(0, 200);
  const notes = [];

  // Match "Step N (bound B): text" blocks up to the next step header or sentinel
  const STEP_RE = /Step\s+(\d+)\s*\(bound\s*([^)]+)\)\s*:\s*([\s\S]*?)(?=Step\s+\d+\s*\(bound|Exploration\s+complete|Logged\s+to|$)/gi;
  const steps = [];
  let m;
  while ((m = STEP_RE.exec(resp)) !== null) {
    const text = m[3].trim();
    if (text.length > 5) steps.push({ stepNum: parseInt(m[1], 10), bound: m[2].trim(), text });
  }

  if (steps.length === 0) {
    // No structured step markers — fall back to Build-1 single-note behavior
    const single = buildDiscoveryNote({ message, response, thread, bound: startBound });
    return { notes: single ? [single] : [], lastBound: startBound, foundCounter: false };
  }

  let lastBound = startBound;
  let foundCounter = false;
  for (const step of steps) {
    lastBound = step.bound || lastBound;
    const isCounter = COUNTEREXAMPLE_MARKER.test(step.text) && !NO_COUNTEREXAMPLE.test(step.text);
    if (isCounter) foundCounter = true;
    notes.push({
      kind:       isCounter ? "counterexample" : "evidence",
      stance:     isCounter ? null : "for",
      status:     null,
      thread:     thread || DEFAULT_THREAD,
      content:    `[discovery loop step ${step.stepNum}, bound ${lastBound}] Ask: "${ask}". Outcome: ${step.text.slice(0, 600)}`,
      importance: isCounter ? 5 : Math.min(2 + step.stepNum, 4),
    });
    if (isCounter) break;
  }
  return { notes, lastBound, foundCounter };
}

// ── Build-2: follow-up loop detection ────────────────────────────────────────
// Handles a bare "keep going" / "for N steps" follow-up that doesn't contain a
// RUN_VERB or RESEARCH_TARGET (so detectDiscovery returns false), but references
// the previous run's "▶ Next probe: `command`" coda in assistant history.
// Returns a full discovery descriptor (same shape as detectDiscovery) or null.
const NEXT_PROBE_RE = /▶ Next probe:\s*`([^`]+)`/;
function detectFollowUpLoop(message, history) {
  if (!LOOP_TRIGGER.test(message || "")) return null;
  const h = (history || []).filter((m) => m && typeof m.content === "string");
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].role !== "assistant") continue;
    const m = h[i].content.match(NEXT_PROBE_RE);
    if (!m) continue;
    const nextCmd = m[1].trim();
    const d = detectDiscovery(nextCmd);
    if (!d.discovery) continue;
    return {
      discovery: true,
      bound: d.bound,
      thread: d.thread,
      wantsLog: true,
      looped: true,
      maxSteps: extractMaxSteps(message),
    };
  }
  return null;
}

// ── Build-2: deterministic next-probe suggestion ──────────────────────────────
// Called after a discovery run (single or looped) to close the exploration loop.
// Returns { content, coda } — content is the next_step notebook entry;
// coda is a one-line string appended to the LLM response. Returns null if
// not enough context to suggest anything useful.
function suggestNextProbe({ lastBound, foundCounter, thread }) {
  const t = (thread || "general").replace(/-/g, " ");
  if (foundCounter) {
    return {
      content: `narrow down to find the minimal counterexample in the ${t} problem`,
      coda: `\n\n▶ Next: narrow down to find the minimal counterexample.`,
    };
  }
  if (!lastBound) return null;
  const nextBound = scaleUpBound(lastBound);
  const cmd = `verify ${t} up to ${nextBound} and log it`;
  return {
    content: cmd,
    coda: `\n\n▶ Next probe: \`${cmd}\``,
  };
}

module.exports = {
  detectDiscovery, detectFollowUpLoop, extractTopic,
  buildDiscoveryDirective, buildDiscoveryNote,
  buildLoopedDiscoveryDirective, buildDiscoveryNotes, suggestNextProbe,
  parseBoundToNumber, scaleUpBound,
  // exported for tests:
  RUN_VERB, RESEARCH_TARGET, BOUND_RE, LOG_INTENT, LOOP_TRIGGER, extractMaxSteps,
  EXEC_MARKER, COUNTEREXAMPLE_MARKER, NO_COUNTEREXAMPLE,
  NEXT_PROBE_RE,
};
