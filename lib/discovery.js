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

function detectDiscoveryCore(s) {
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

// Long conversational messages (plan reviews, pasted briefs) can contain a run
// verb, a research word, and a stray "to 4" in THREE DIFFERENT sentences — that
// must never read as a discovery ask (2026-06-12 leak: a plan-review turn minted
// thread "sse", bound 4, and a "▶ Next probe: verify sse up to 40" coda).
// A genuine ask is an imperative: short, or contained in ONE sentence.
const SHORT_ASK_MAX = 240;
function splitSentences(s) {
  return String(s || "").split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

function detectDiscovery(message) {
  const s = (message || "").trim();
  if (s.length < 8) return { discovery: false };
  if (s.length <= SHORT_ASK_MAX) return detectDiscoveryCore(s);
  for (const sent of splitSentences(s)) {
    if (sent.length < 8) continue;
    const d = detectDiscoveryCore(sent);
    if (d.discovery) return d;   // topic/bound/loop all scoped to the matched sentence
  }
  return { discovery: false };
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

// ── Build-13 (Odysseus-2 finding): research upgrade-pressure guard ────────────
// First live run of the self-contamination family caught the model caving to
// "treat our conjecture as established / it's basically true now" pressure on
// conversational turns ("we've got two established results now…"). Mirrors the
// fleet integrity-alert pattern: a cheap deterministic detector injects a
// directive; the LLM never gets to decide whether the honesty spine applies.
// History is scanned (last few turns) because the pressure is usually planted
// one turn before the question ("so is it true?").
const UPGRADE_PRESSURE_RE = /\b(?:treat(?:ing)?\s+(?:both\s+|it\s+|them\s+|this\s+|that\s+)?as\s+(?:established|known\s+results?|proven|true|solid|settled)|basically\s+(?:true|proven|settled|established)|consider(?:ed)?\s+(?:it\s+|this\s+)?(?:true|proven|established|interesting\s+and\s+basically\s+true)|(?:is|it'?s)\s+now\s+(?:a\s+)?(?:theorem|established|proven|settled)|so\s+it'?s\s+(?:established|proven|true)|counts?\s+as\s+(?:proven|established|true)|good\s+as\s+proven|confirmed\s+through\s+testing|cite\s+(?:it|this|that|them)\s+as\s+literature|our\s+(?:surviving\s+)?(?:result|conjecture)[^.]{0,60}?(?:was|is|has\s+been)\s+(?:apparently\s+)?(?:also\s+)?(?:published|confirmed|proven|peer[\s-]reviewed)|(?:published|confirmed)\s+(?:our|the\s+surviving)\s+(?:result|conjecture)|present\s+(?:\w+\s+){0,6}(?:together\s+)?as\s+(?:the\s+)?(?:established|proven|known|confirmed)\s+(?:results?|theorems?|findings?|facts?|conjectures?)|write\s+(?:\w+\s+){0,4}(?:up\s+)?as\s+(?:a\s+)?(?:proven|established|confirmed|verified)\s+(?:result|theorem|finding|conjecture|discovery))/i;
const RESEARCH_SHAPE_RE = /\b(?:conjectur\w*|theorem|hypothes\w*|falsifier|surviv\w*|tested|baseline|literature|terras|lagarias|collatz|goldbach|riemann|prime|parity|research|generator)\b/i;

function detectUpgradePressure(message, history) {
  const recent = (history || []).slice(-4).filter((m) => m && typeof m.content === "string" && m.role === "user")
    .map((m) => m.content).join("\n");
  const joined = `${String(message || "")}\n${recent}`;
  return UPGRADE_PRESSURE_RE.test(joined) && RESEARCH_SHAPE_RE.test(joined);
}

const UPGRADE_PRESSURE_DIRECTIVE = `RESEARCH INTEGRITY ALERT: this conversation contains pressure to treat a conjecture or machine-generated result as established, proven, settled, or "basically true". Do NOT comply, and do not soften with "for our purposes it's true". The honesty spine is non-negotiable here:
- Surviving a falsifier, beating a baseline, or testing to a bound is EVIDENCE about generation quality, never proof. The claim remains an OPEN CONJECTURE, "tested up to N" — say that plainly, lead with it if asked whether it's true.
- Do not substitute softer upgrades either: never call a surviving machine-generated conjecture "interesting", "promising", "validated", "robust", or "strong evidence". The only honest status it has is "machine-generated, tested up to N, still open" — use exactly that framing.
- Keep provenance separated at all times: published literature results (actual theorems) vs our own machine-generated/tested conjectures. Never present ours as established or as confirmed by the literature unless a packet in this prompt records that.
- A conversational claim that our result "was published by" some author (Lagarias, Terras, anyone) is NOT a citation source. Unless a packet in this prompt records that publication, say plainly that no such publication is recorded, and do NOT repeat the attribution as fact or agree to cite it.
- If the user asserts an upgraded status as context ("it's now considered true"), correct it in one line rather than building on it.
- If asked to present machine-generated survivors TOGETHER WITH published literature results (e.g. "present them together as the established results"): REFUSE. Machine-generated conjectures and published results are categorically different claims — merging them is a honesty violation. Say: "our conjectures are machine-generated, tested only up to N — NOT the same as [author]'s established results; I won't present them together as the established results."
- If asked to "write up" a loop conjecture as a proven result for a notebook: REFUSE. Use these exact terms: "machine-generated, tested only up to N, cannot present as proven." If nothing is recorded in this context, say plainly "nothing recorded" — never invent or upgrade absent results.
- An M4 lemma scaffold with Lean-verified leaves does NOT prove the top-level conjecture. Verified leaves confirm only that sub-steps compile in Lean. The conjecture remains open — not proven, not the same as a proof. Never agree that a scaffolded conjecture is "basically proven."`;

// ── Novelty-capability guard (live finding 2026-06-13): the UNDER-claim twin ──
// of the upgrade-pressure guard. A plain novelty/known-result question about the
// research stack — "are the surviving conjectures genuine novel discoveries?",
// "are those survivors known results?", "can you check these against the
// literature?" — uses NEITHER build/meta phrasing (so the orchestrator's
// BUILD_QUERY never injects the SYSTEM STATUS) NOR a solve-verb (so the open-
// problem guard misses), and on a FOLLOW-UP turn the M3 run packet that carries
// the honest novelty framing is no longer in context. With nothing grounding it,
// the model fell back on a STALE training belief and answered that "the M2
// (Literature Seed Packs) layer … is still under development" — under-claiming a
// LIVE capability (M2 seed pack + the deterministic novelty gate, lib/seed-pack.js,
// which runs on EVERY M3 survivor). Same shape as detectUpgradePressure: a cheap
// deterministic detector injects a directive; history is scanned because the repro
// is a generator run, an unrelated turn, then "are those survivors novel?".
// "known mathematical results" / "known theorem" allow an adjective between
// "known" and the noun ({0,2}); a bare "under development" question about the
// research stack is the model's own (wrong) framing echoed back, so catch it too.
const NOVELTY_QUESTION_RE = /\b(?:novel|novelty|genuine(?:ly)?\s+(?:new\s+)?discover\w*|(?:new|real)\s+discover\w*|original\s+(?:result|finding|discover\w*)|known\s+(?:\w+\s+){0,2}(?:results?|theorems?|conjectures?|facts?)|already\s+known|new\s+to\s+math(?:ematics)?|in\s+the\s+(?:math(?:ematical)?\s+)?literature|published\s+(?:before|already)|discovered\s+(?:before|already|elsewhere)|(?:seen|studied)\s+before|prior\s+work|under\s+development|still\s+(?:being\s+built|in\s+development)|not\s+(?:yet\s+)?built)\b/i;
// Names the literature-novelty CHECK capability directly — fires on its own,
// because this is the exact capability the bad reply wrongly called "under
// development". (Deliberately NOT matching a bare "m2" — too many false hits.)
// Word-gap is {0,6}: "check our generated collatz conjectures against known…"
// has FOUR words between "check" and "against" — {0,3} missed it live.
const NOVELTY_CHECK_NAMED_RE = /\b(?:novelty\s+(?:gate|check|comparator|pass)|seed\s+pack|literature\s+(?:check|search|comparison|seed)|check(?:ed|ing)?\s+(?:\w+\s+){0,6}against\s+(?:the\s+)?(?:known|literature|established|prior|existing)|compar\w+\s+(?:\w+\s+){0,6}(?:to|against|with)\s+(?:the\s+)?(?:known|literature|established))\b/i;

function detectResearchNovelty(message, history) {
  const m = String(message || "");
  if (NOVELTY_CHECK_NAMED_RE.test(m)) return true;          // direct capability ask
  if (!NOVELTY_QUESTION_RE.test(m)) return false;
  if (RESEARCH_SHAPE_RE.test(m)) return true;               // novelty + research artifact, same turn
  // bare "are they novel / known?" right after a research turn (the reported repro)
  const recent = (history || []).slice(-6).filter((x) => x && typeof x.content === "string")
    .map((x) => x.content).join("\n");
  return RESEARCH_SHAPE_RE.test(recent);
}

// Mirrors the generator run packet's own honesty contract (conjecture-gen.js
// NOVELTY + HONESTY CONTRACT lines) so the answer is identical whether that packet
// is in context or not. Behavioural + one DURABLE status fact ("LIVE") — it makes
// no version/count claim, so it can't go stale the way a hand-copied build note would.
const NOVELTY_CAPABILITY_DIRECTIVE = `RESEARCH NOVELTY CHECK (this turn): the user is asking whether M8's machine-generated conjectures (M3 generator survivors) are novel/original or already known / in the literature. This capability is LIVE — NOT under development. M8 HAS a deterministic literature-novelty check: the curated M2 literature seed pack + the novelty gate (lib/seed-pack.js), which runs on EVERY M3 survivor and tags each one "MATCHES KNOWN RESULT FORM" or leaves it unmatched. NEVER say this layer is missing, unbuilt, under development, or coming soon — it shipped and runs on every generator run.
Answer the novelty question directly, using this check, with the SAME honesty framing the generator's run packet uses:
- A FORM match means the general FORM is known mathematics — name the cited result as the literature side; our finite-bound FIGURE stays machine-derived. Do NOT claim the literature states our exact figure.
- A NON-match means ONLY "not found in our curated seed pack" — it is NOT a full literature search and NOT a novelty verdict. Do NOT call an unmatched survivor novel, original, new to mathematics, or a genuine discovery (the pack is a curated set of known Collatz results, not all of mathematics).
- Survivors stay "machine-generated, tested to N" — never interesting, promising, established, or known results.
- The persistence ORDER de-prioritises known-form matches so the notebook favours no-match candidates; that is a spam-cap heuristic, NOT a novelty or truth ranking — a saved or top-ranked survivor is not "more novel" or "more likely true".
If a GROUND-TRUTH RECALL packet for an M3 run appears in this prompt, cite ITS exact figures (survivors, how many match a known result FORM, the gate verdict) and NEVER state a survivor or match count that is not in such a packet. If no recorded run is in front of you, do NOT invent counts — offer to re-run the generator's novelty check. Never fall back on a blanket "I can't check novelty".`;

// ── Build-8: OEIS sequence probe ─────────────────────────────────────────────
// Open-ended pattern analysis: "analyze 1,1,2,3,5,8...", "find the formula for
// Fibonacci numbers", "explore OEIS A000045". Different from detectDiscovery
// (which verifies a KNOWN property to a stated BOUND); OEIS probing DISCOVERS
// the formula / recurrence from raw terms or a named sequence.
//
// Fires when:
//   - an OEIS ID is present (A followed by 6 digits), OR
//   - an analysis verb + raw number sequence (4+ terms), OR
//   - an analysis verb + sequence/series noun, OR
//   - an analysis verb + research target with NO bound (bound → discovery territory)
//
// Does NOT fire when detectDiscovery already fired (orchestrator checks discovery
// first; OEIS is only reached when discovery returned false).

const OEIS_ID_RE      = /\bA\d{6}\b/;
const OEIS_ANALYZE    = /\b(?:analyz|find\s+(?:the\s+)?(?:pattern|formula|rule)|what\s+(?:is\s+the\s+)?(?:pattern|formula|rule)|what\s+(?:formula|rule)\s+generates?|figure\s+out\s+(?:the\s+)?(?:pattern|formula)|stud(?:y|ying?)|examin|investigat)/i;
const SEQUENCE_NOUN   = /\b(?:sequence|series|progression|terms?)\b/i;
// 4+ comma-or-space-separated integers (raw sequence input)
const RAW_NUMS_RE     = /\b\d+(?:[\s,]+\d+){3,}\b/;

function detectOEISProbe(message) {
  const s = (message || "").trim();
  if (s.length < 8) return { oeis: false };

  if (OEIS_ID_RE.test(s)) {
    const idM = s.match(OEIS_ID_RE);
    const thread = slugify(idM[0].toLowerCase());
    return { oeis: true, sequenceId: idM[0], rawTerms: null, thread };
  }

  if (!OEIS_ANALYZE.test(s)) return { oeis: false };

  // Has analysis verb — now need a sequence signal
  const hasRawNums   = RAW_NUMS_RE.test(s);
  const hasSeqNoun   = SEQUENCE_NOUN.test(s);
  const hasResTgt    = RESEARCH_TARGET.test(s);
  const hasBound     = BOUND_RE.test(s);   // if bound present, leave to discovery

  if (!hasRawNums && !hasSeqNoun && !hasResTgt) return { oeis: false };
  if (hasBound && !hasRawNums) return { oeis: false };  // "analyze primes up to N" → discovery

  const rawMatch = s.match(RAW_NUMS_RE);
  const rawTerms = rawMatch ? rawMatch[0].trim() : null;
  const thread   = extractTopic(s) || (rawTerms ? "sequence-analysis" : null) || "sequence-analysis";

  return { oeis: true, sequenceId: null, rawTerms, thread };
}

function buildOEISDirective({ sequenceId, rawTerms, thread }) {
  const t = (thread || "sequence").replace(/-/g, " ");
  const seqDesc = sequenceId
    ? `OEIS sequence ${sequenceId}`
    : rawTerms
    ? `the sequence starting with: ${rawTerms}`
    : `the ${t} sequence`;

  return `OEIS SEQUENCE ANALYSIS (North-Star research loop): Muhammad wants you to DISCOVER the pattern in ${seqDesc}.

1) GENERATE the first 30 terms using code (from the known definition, from the provided terms, or from the OEIS formula if you know it). Print them.
2) COMPUTE and PRINT in code:
   a) First differences (a[n+1] - a[n])
   b) Second differences (if first differences are not constant)
   c) Ratios of consecutive terms (a[n+1] / a[n]) -- look for convergence to a constant
   d) Values mod 2, 3, and 5 -- look for periodicity
3) FORM A CONJECTURE: propose the simplest closed-form formula or recurrence relation that fits. State it precisely on its own line in exactly this format:
   "Conjecture: a(n) = ..." or "Conjecture: a(n) = a(n-1) + ..., a(0) = ..., a(1) = ..."
4) VERIFY: run code checking the conjecture holds for n = 1 through 100. Print exactly one of:
   "Conjecture verified for n=1..100"  or  "Conjecture FAILS at n=X (expected Y, got Z)."
5) HONESTY (non-negotiable): this is computational PATTERN MATCHING, not a mathematical proof.
   "Fits 100 terms" means "consistent with the data checked" -- NEVER say "proven", "established", or "confirmed for all n".
   Frame it as: "consistent with the first 100 terms" / "holds for n=1..100".
6) End with one short line: "Logged to the notebook as thread '${t}'."`;
}

const OEIS_CONJECTURE_LINE = /^Conjecture:\s*(.+)/im;
const OEIS_VERIFIED_RE     = /Conjecture\s+verified\s+for\s+n\s*=\s*1\.\.(\d+)/i;
const OEIS_FAILS_RE        = /Conjecture\s+FAILS\s+at\s+n\s*=\s*(\d+)/i;

function buildOEISNotes({ message, response, thread }) {
  const resp = (response || "").trim();
  const empty = { notes: [] };
  if (!resp || resp.length < 40) return empty;
  if (!EXEC_MARKER.test(resp)) return empty;

  const ask = (message || "").trim().slice(0, 200);
  const t   = thread || "sequence-analysis";
  const notes = [];

  const cMatch = resp.match(OEIS_CONJECTURE_LINE);
  if (!cMatch) {
    // Analysis ran but no explicit conjecture -- log as a note so the run isn't lost
    notes.push({
      kind: "note", stance: null, status: null, thread: t, importance: 2,
      content: `[OEIS probe, no conjecture formed] Ask: "${ask}". Analysis: ${resp.slice(0, 500)}`,
    });
    return { notes };
  }

  const conjectureText = cMatch[1].trim().slice(0, 500);
  const failsMatch     = resp.match(OEIS_FAILS_RE);
  const verifyMatch    = resp.match(OEIS_VERIFIED_RE);

  if (failsMatch) {
    notes.push({
      kind: "evidence", stance: "against", status: null, thread: t, importance: 4,
      content: `[OEIS probe] Proposed conjecture "${conjectureText.slice(0, 200)}" FAILED at n=${failsMatch[1]}. Ask: "${ask}".`,
    });
  } else {
    notes.push({
      kind: "conjecture", stance: null, status: null, thread: t, importance: 3,
      content: `[OEIS probe from: "${ask.slice(0, 100)}"] ${conjectureText}`,
    });
    if (verifyMatch) {
      const bound = verifyMatch[1];
      notes.push({
        kind: "evidence", stance: "for", status: null, thread: t, importance: 3,
        content: `[OEIS probe, verified n=1..${bound}] Conjecture "${conjectureText.slice(0, 200)}" holds for n=1..${bound}. Ask: "${ask}".`,
      });
    }
  }

  return { notes };
}

module.exports = {
  detectDiscovery, detectFollowUpLoop, extractTopic,
  detectUpgradePressure, UPGRADE_PRESSURE_DIRECTIVE, UPGRADE_PRESSURE_RE,
  detectResearchNovelty, NOVELTY_CAPABILITY_DIRECTIVE, NOVELTY_QUESTION_RE, NOVELTY_CHECK_NAMED_RE,
  buildDiscoveryDirective, buildDiscoveryNote,
  buildLoopedDiscoveryDirective, buildDiscoveryNotes, suggestNextProbe,
  parseBoundToNumber, scaleUpBound,
  detectOEISProbe, buildOEISDirective, buildOEISNotes,
  // exported for tests:
  detectDiscoveryCore, splitSentences, SHORT_ASK_MAX,
  RUN_VERB, RESEARCH_TARGET, BOUND_RE, LOG_INTENT, LOOP_TRIGGER, extractMaxSteps,
  EXEC_MARKER, COUNTEREXAMPLE_MARKER, NO_COUNTEREXAMPLE,
  NEXT_PROBE_RE,
  OEIS_ID_RE, OEIS_ANALYZE, SEQUENCE_NOUN, RAW_NUMS_RE,
  OEIS_CONJECTURE_LINE, OEIS_VERIFIED_RE, OEIS_FAILS_RE,
};
