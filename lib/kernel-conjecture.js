/**
 * M8 Build-43 · Option D — Speculative-Kernel → Conjecture bridge
 * lib/kernel-conjecture.js
 *
 * The first rung of the problem-solving engine. The Build-41/42 epistemic axis
 * already CLASSIFIES a fringe idea (vortex math, number patterns, "geometria")
 * and EXTRACTS its established KERNEL (e.g. "the digital root of a number cycles
 * mod 9"). This module makes that kernel DO WORK: it turns the kernel into a
 * concrete, machine-CHECKABLE number-pattern claim and tests it deterministically
 * by exhaustive computation — reporting "observed through N" or the first
 * counterexample. It NEVER proves anything and NEVER touches the speculative leap.
 *
 * HONESTY (load-bearing, mirrors the spine):
 *   - The strongest verdict is "observed by exhaustive computation through N" →
 *     verification_state 'empirical' AT MOST. NEVER 'proven' (only Lean proves),
 *     never "true for all n". A held claim is evidence-to-N, not a theorem.
 *   - The speculative LEAP is untouched and stays speculative. We only test the
 *     kernel-derived claim.
 *   - The LLM proposer can ONLY pick from a CLOSED, code-checkable template +
 *     generator whitelist. Anything off-schema → null. So the LLM cannot smuggle
 *     an unverifiable claim — the same discipline as the M3-lite generator
 *     (proposal narrowed to what the deterministic checker can falsify).
 *   - A kernel that yields no expressible computable claim → null ("couldn't form
 *     a checkable claim"), never a fabricated one.
 *
 * Pure functions for the checker (no eval, no BigInt — modular arithmetic only,
 * so it stays fast + exhaustive to large N). The proposer is the only async/LLM
 * part and fails safe → null. Mirrored by tests/kernel-conjecture-verify.ps1.
 */
const { generate } = require("./llm");

// ── tunables (FIXED) ──────────────────────────────────────────────
const N_DEFAULT = 10000;
const N_MIN     = 100;
const N_MAX     = 200000;     // exhaustive, modular — sub-second well past this
const MOD_MAX   = 1000;       // residue modulus cap
const PERIOD_MAX = 100;       // claimed period cap

// ── CLOSED generator whitelist: g(n) value mod m, via modular arithmetic ──
// Each returns g(n) reduced mod `m` (no big integers). n >= 1.
function modexp(base, exp, m) {
  if (m === 1) return 0;
  let r = 1; base = ((base % m) + m) % m;
  while (exp > 0) { if (exp & 1) r = (r * base) % m; base = (base * base) % m; exp = Math.floor(exp / 2); }
  return r;
}
const GENERATORS = {
  // g(n) = n
  n:          (n, m) => n % m,
  // g(n) = k * n   (params.k)
  multiple:   (n, m, p) => (((p.k % m) * (n % m)) % m),
  // g(n) = base^n  (params.base) — the canonical "doubling/vortex" sequence is base=2
  power:      (n, m, p) => modexp(p.base, n, m),
  // g(n) = n^2
  square:     (n, m) => (((n % m) * (n % m)) % m),
  // g(n) = n^3
  cube:       (n, m) => ((((n % m) * (n % m)) % m) * (n % m)) % m,
  // g(n) = n(n+1)/2  (triangular)
  triangular: (n, m) => { const t = (n % (2 * m)) * ((n + 1) % (2 * m)); return (t / 2) % m; },
  // g(n) = Fibonacci(n) mod m  (iterative — Pisano, no big ints)
  fib:        (n, m) => { let a = 0, b = 1; for (let i = 1; i <= n; i++) { const c = (a + b) % m; a = b; b = c; } return a % m; },
};
function genValueMod(generator, params, n, m) {
  const g = GENERATORS[generator];
  if (!g) return null;
  let v = g(n, m, params || {});
  v = ((v % m) + m) % m;
  return v;
}
// Digital root of g(n): value mod 9, with 0 → 9 (for positive values; the
// whitelist only produces positive g(n) for n >= 1, k >= 1, base >= 2).
function digitalRootOfGen(generator, params, n) {
  const r = genValueMod(generator, params, n, 9);
  if (r === null) return null;
  return r === 0 ? 9 : r;
}

// ── CLOSED claim templates ────────────────────────────────────────
const TEMPLATES = ["dr_periodic", "dr_constant", "dr_set", "mod_cycle"];

/**
 * Validate a proposed claim against the closed whitelist. Returns a normalized
 * claim or null (off-schema → null; this IS the anti-smuggling gate).
 *   { template, generator, params, bound, label }
 */
function validateClaim(c) {
  if (!c || typeof c !== "object") return null;
  if (!TEMPLATES.includes(c.template)) return null;
  if (!Object.prototype.hasOwnProperty.call(GENERATORS, c.generator)) return null;
  const p = (c.params && typeof c.params === "object") ? c.params : {};
  // generator-specific param checks
  if (c.generator === "multiple") { if (!Number.isInteger(p.k) || p.k < 1 || p.k > 10000) return null; }
  if (c.generator === "power")    { if (!Number.isInteger(p.base) || p.base < 2 || p.base > 10000) return null; }
  let bound = Number.isInteger(c.bound) ? c.bound : N_DEFAULT;
  bound = Math.max(N_MIN, Math.min(N_MAX, bound));
  const norm = { template: c.template, generator: c.generator, params: {}, bound, label: String(c.label || "").slice(0, 160) };
  if (c.generator === "multiple") norm.params.k = p.k;
  if (c.generator === "power") norm.params.base = p.base;
  if (c.template === "dr_periodic") {
    if (!Number.isInteger(p.period) || p.period < 1 || p.period > PERIOD_MAX) return null;
    norm.params.period = p.period;
  } else if (c.template === "dr_constant") {
    if (!Number.isInteger(p.value) || p.value < 1 || p.value > 9) return null;
    norm.params.value = p.value;
  } else if (c.template === "dr_set") {
    if (!Array.isArray(p.set) || p.set.length < 1 || p.set.length > 9) return null;
    const set = [...new Set(p.set)].filter((x) => Number.isInteger(x) && x >= 1 && x <= 9).sort((a, b) => a - b);
    if (set.length < 1 || set.length !== new Set(p.set).size) return null;   // any out-of-range member → reject
    norm.params.set = set;
  } else if (c.template === "mod_cycle") {
    if (!Number.isInteger(p.m) || p.m < 2 || p.m > MOD_MAX) return null;
    if (!Number.isInteger(p.period) || p.period < 1 || p.period > PERIOD_MAX) return null;
    norm.params.m = p.m; norm.params.period = p.period;
  }
  return norm;
}

/**
 * Deterministic exhaustive checker. PURE, sync. Returns
 *   { holds:boolean, checkedTo:N, counterexample:{n,...}|null, observedPeriod:number|null }
 * holds = the claim survived falsification over every n in [1..N].
 */
function evaluateClaim(claim) {
  const c = validateClaim(claim);
  if (!c) return { holds: false, checkedTo: 0, counterexample: null, observedPeriod: null, invalid: true };
  const N = c.bound;
  if (c.template === "dr_periodic") {
    const p = c.params.period;
    for (let n = 1; n + p <= N; n++) {
      if (digitalRootOfGen(c.generator, c.params, n) !== digitalRootOfGen(c.generator, c.params, n + p)) {
        return { holds: false, checkedTo: N, counterexample: { n, dr_n: digitalRootOfGen(c.generator, c.params, n), dr_n_plus_p: digitalRootOfGen(c.generator, c.params, n + p), period: p }, observedPeriod: observedDrPeriod(c) };
      }
    }
    return { holds: true, checkedTo: N, counterexample: null, observedPeriod: observedDrPeriod(c) };
  }
  if (c.template === "dr_constant") {
    const v = c.params.value;
    for (let n = 1; n <= N; n++) {
      const dr = digitalRootOfGen(c.generator, c.params, n);
      if (dr !== v) return { holds: false, checkedTo: N, counterexample: { n, dr, expected: v }, observedPeriod: null };
    }
    return { holds: true, checkedTo: N, counterexample: null, observedPeriod: 1 };
  }
  if (c.template === "dr_set") {
    const set = c.params.set;
    for (let n = 1; n <= N; n++) {
      const dr = digitalRootOfGen(c.generator, c.params, n);
      if (!set.includes(dr)) return { holds: false, checkedTo: N, counterexample: { n, dr, set }, observedPeriod: null };
    }
    return { holds: true, checkedTo: N, counterexample: null, observedPeriod: observedDrPeriod(c) };
  }
  if (c.template === "mod_cycle") {
    const { m, period: p } = c.params;
    for (let n = 1; n + p <= N; n++) {
      if (genValueMod(c.generator, c.params, n, m) !== genValueMod(c.generator, c.params, n + p, m)) {
        return { holds: false, checkedTo: N, counterexample: { n, period: p, m }, observedPeriod: observedModPeriod(c) };
      }
    }
    return { holds: true, checkedTo: N, counterexample: null, observedPeriod: observedModPeriod(c) };
  }
  return { holds: false, checkedTo: 0, counterexample: null, observedPeriod: null, invalid: true };
}

// Minimal observed period of the digital-root sequence (diagnostic, capped scan).
function observedDrPeriod(c) {
  const cap = Math.min(c.bound, PERIOD_MAX * 4);
  const seq = []; for (let n = 1; n <= cap; n++) seq.push(digitalRootOfGen(c.generator, c.params, n));
  return minimalPeriod(seq);
}
function observedModPeriod(c) {
  const cap = Math.min(c.bound, c.params.m * 4 + PERIOD_MAX);
  const seq = []; for (let n = 1; n <= cap; n++) seq.push(genValueMod(c.generator, c.params, n, c.params.m));
  return minimalPeriod(seq);
}
function minimalPeriod(seq) {
  for (let p = 1; p <= Math.floor(seq.length / 2); p++) {
    let ok = true;
    for (let i = 0; i + p < seq.length; i++) { if (seq[i] !== seq[i + p]) { ok = false; break; } }
    if (ok) return p;
  }
  return null;
}

// ── LLM proposer: kernel → claim (or null) ────────────────────────
const PROPOSE_SYSTEM = `You turn an ESTABLISHED arithmetic KERNEL into ONE concrete, machine-checkable number-pattern claim a computer can falsify by exhaustive computation. This is for honest research: the claim will be CHECKED, never assumed true.

You may ONLY use this closed vocabulary (anything else is rejected):
TEMPLATES:
  - "dr_periodic":  the DIGITAL ROOT of g(n) repeats with period P.  params: {"period": <int 1..100>}
  - "dr_constant":  the DIGITAL ROOT of g(n) equals a constant C for all n.  params: {"value": <int 1..9>}
  - "dr_set":       the DIGITAL ROOT of g(n) is ALWAYS one of a fixed set of values.  params: {"set": [<ints 1..9>]}
  - "mod_cycle":    g(n) mod M is periodic with period P.  params: {"m": <int 2..1000>, "period": <int 1..100>}
GENERATORS g(n):
  - "n"           g(n)=n
  - "multiple"    g(n)=k*n        params also need {"k": <int 1..10000>}
  - "power"       g(n)=base^n     params also need {"base": <int 2..10000>}  (base=2 is the classic doubling/vortex sequence)
  - "square"      g(n)=n^2
  - "cube"        g(n)=n^3
  - "triangular"  g(n)=n(n+1)/2
  - "fib"         g(n)=Fibonacci(n)

OUTPUT CONTRACT — exactly one JSON object, no markdown, no prose:
{"template":"...","generator":"...","params":{...},"bound":<int e.g. 10000>,"label":"<one-line plain statement>"}

RULES:
1. The claim must follow ONLY from the kernel's established arithmetic — NOT from any speculative/energy/mystical framing. Test the arithmetic, never the mysticism.
2. If the kernel yields no claim expressible in the vocabulary above, output exactly: null
3. Invent nothing the kernel does not support. A missing claim is better than a wrong one.
4. params must merge the template's and the generator's required keys into one flat object.`;

function parseClaim(raw) {
  try {
    let s = String(raw || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    if (/^null$/i.test(s)) return null;
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    return JSON.parse(s.slice(a, b + 1));
  } catch { return null; }
}

// Build-43 Option B: capture the user's LITERAL assertion as a checkable claim —
// even if it looks false. The whole point is to TEST what they actually said and
// hand back a counterexample when it's wrong (the Scenario-B fix). Fidelity over
// truth: do NOT "repair" a false claim into a true one here (the nearest-true
// variant is offered SEPARATELY, by kernelToConjecture on the salvaged kernel).
const LITERAL_SYSTEM = `You convert the user's STATED number-pattern assertion into ONE machine-checkable claim that captures EXACTLY what they said — even if you suspect it is FALSE. We will test it by exhaustive computation and report a counterexample if it fails; that is the goal, so do not "fix" it.

You may ONLY use this closed vocabulary (anything else is rejected):
TEMPLATES:
  - "dr_periodic":  the DIGITAL ROOT of g(n) repeats with period P.  params: {"period": <int 1..100>}
  - "dr_constant":  the DIGITAL ROOT of g(n) equals a constant C for all n.  params: {"value": <int 1..9>}
  - "dr_set":       the DIGITAL ROOT of g(n) is ALWAYS one of a fixed set.  params: {"set": [<ints 1..9>]}
  - "mod_cycle":    g(n) mod M is periodic with period P.  params: {"m": <int 2..1000>, "period": <int 1..100>}
GENERATORS g(n): "n" | "multiple"{"k":1..10000} | "power"{"base":2..10000} | "square" | "cube" | "triangular" | "fib"

OUTPUT — exactly one JSON object, no markdown: {"template":"...","generator":"...","params":{...},"bound":<int>,"label":"<the user's claim, restated plainly>"}
RULES:
1. Mirror the user's literal claim. "the digital root of 3n is always 3" -> {"template":"dr_constant","generator":"multiple","params":{"k":3,"value":3},...}. Do NOT widen "always 3" into a set or a period.
2. If the user's assertion cannot be expressed in the vocabulary above, output exactly: null
3. Invent nothing they did not assert.`;

/** Gemini maps the user's LITERAL assertion to a checkable claim. Fail-safe → null. */
async function proposeLiteralClaim(text) {
  const t = String(text || "");
  if (!t.trim()) return null;
  try {
    const raw = await generate({
      systemInstruction: LITERAL_SYSTEM,
      contents: [{ role: "user", parts: [{ text: `USER ASSERTION: "${t.slice(0, 600)}"\n\nOutput the JSON object (or null) now.` }] }],
      genConfig: { temperature: 0, maxOutputTokens: 300 },
    });
    return validateClaim(parseClaim(raw));
  } catch (e) {
    console.error("[M8] proposeLiteralClaim error (non-fatal):", e.message);
    return null;
  }
}

/** Gemini proposes a checkable claim for a kernel. Fail-safe → null. Validated against the whitelist. */
async function kernelToConjecture(kernel) {
  const label = (kernel && (kernel.label || "")) + "";
  const content = (kernel && (kernel.content || "")) + "";
  if (!label && !content) return null;
  try {
    const raw = await generate({
      systemInstruction: PROPOSE_SYSTEM,
      contents: [{ role: "user", parts: [{ text: `KERNEL label: "${label}"\nKERNEL content: "${content.slice(0, 500)}"\n\nOutput the JSON object (or null) now.` }] }],
      genConfig: { temperature: 0, maxOutputTokens: 300 },
    });
    return validateClaim(parseClaim(raw));   // null if off-schema or unproposable
  } catch (e) {
    console.error("[M8] kernelToConjecture error (non-fatal):", e.message);
    return null;
  }
}

// ── Honest narration ──────────────────────────────────────────────
// verification_state a held claim may carry — capped at 'empirical', NEVER 'proven'.
function heldVerificationState() { return "empirical"; }

function renderKernelConjecture(kernel, claim, result) {
  const kl = (kernel && (kernel.label || kernel.content)) || "the kernel";
  if (!claim) {
    return `I couldn't form a machine-checkable number-pattern claim from this kernel ("${String(kl).slice(0, 80)}"). Nothing tested — no result to report. (The kernel stays as classified; the speculative idea remains speculative.)`;
  }
  const head = `Kernel under test: ${String(kl).slice(0, 100)}\nDerived checkable claim: ${claim.label || `${claim.template} / ${claim.generator}`}`;
  if (result.invalid) return `${head}\n\nThe proposed claim was off-schema and was rejected — nothing was tested.`;
  if (result.holds) {
    return `${head}\n\n✅ OBSERVED by exhaustive computation through n = ${result.checkedTo.toLocaleString()}` +
      (result.observedPeriod ? ` (observed minimal period ${result.observedPeriod})` : "") +
      `.\n\nThis is evidence up to N — it is NOT a proof for all n, and it does NOT validate the broader speculative idea (which stays speculative). Status: tested-to-N / empirical, never proven.`;
  }
  const ce = result.counterexample || {};
  const drSetMiss = (ce.dr !== undefined && Array.isArray(ce.set)) ? ` (digital root ${ce.dr} not in {${ce.set.join(", ")}})` : "";
  return `${head}\n\n❌ FALSIFIED. First counterexample at n = ${ce.n}` +
    (ce.dr_n !== undefined ? ` (digital root ${ce.dr_n} ≠ ${ce.dr_n_plus_p} at n+${ce.period})` : "") +
    (ce.dr !== undefined && ce.expected !== undefined ? ` (digital root ${ce.dr} ≠ expected ${ce.expected})` : "") +
    drSetMiss +
    `.\n\nThe claim is FALSE as stated. Recorded as a failed attempt (data, not noise).`;
}

// ── Chat detection + end-to-end orchestration ─────────────────────
// Trigger: an explicit ask to TEST/CHECK the established CORE of an idea. Kept
// tight so it never steals a normal research/ingest turn — requires a test verb
// AND the word "kernel"/"core"/"arithmetic"/"pattern" near it.
// Specific math-flavoured nouns: a test verb near one of these always fires.
const KERNEL_TEST_RE = /\b(?:test|check|verify|falsif(?:y|ies)|extract(?:\s+and\s+(?:test|check))?)\b[^?.!]{0,30}\b(?:kernel|established core|real (?:arithmetic|math|core)|number[- ]pattern|digital[- ]root|conjecture)\b/i;
// The broader nouns ("claim"/"pattern") only fire WITH a math signal in the
// message — so "check this claim" about an insurance/fleet matter never hijacks.
const CLAIM_VERB_RE = /\b(?:test|check|verify|falsif(?:y|ies))\b[^?.!]{0,30}\b(?:claim|pattern)\b/i;
const MATH_SIGNAL_RE = /\b(?:digital[- ]root|digit sum|modul[oa]r?\b|mod \d|2\s*\^|3n\b|\d+\s*\^\s*n|fibonacci|sequence|periodic|cycles?\b|vortex)\b/i;
function detectKernelTest(message) {
  const m = message || "";
  return KERNEL_TEST_RE.test(m) || (CLAIM_VERB_RE.test(m) && MATH_SIGNAL_RE.test(m));
}

/**
 * End-to-end Option-D flow for a chat turn (no DB writes; pure-LLM + deterministic
 * checking). Decompose the idea → kernel/leap (Build-42), propose a checkable claim
 * from the kernel, evaluate it exhaustively, narrate honestly. Returns a string.
 * Fails safe: any error → a short honest "couldn't run it" message (never throws).
 */
async function runKernelTest(message) {
  try {
    const { proposeDecomposition } = require("./knowledge-intake");
    // Run the two proposals + the decomposition in parallel (all fail-safe → null).
    const [literal, dec] = await Promise.all([
      proposeLiteralClaim(message),
      proposeDecomposition("user idea", message).catch(() => null),
    ]);

    // ── Option B: test the user's LITERAL claim FIRST (so a false claim gets a
    //    counterexample instead of being quietly reframed into a true kernel). ──
    if (literal) {
      const litResult = evaluateClaim(literal);
      const litBlock = renderKernelConjecture({ label: "your stated claim" }, literal, litResult);
      // Speculative-leap note (if the idea carried a leap beyond the arithmetic).
      const leapNote = (dec && dec.leap) ? `\n\nNote: the broader idea ("${dec.leap.label}") stays SPECULATIVE either way — a number pattern holding tells us nothing about it.` : "";
      if (litResult.holds) return litBlock + leapNote;
      // FALSE literal claim → also offer the nearest TRUE pattern (the salvaged kernel).
      let nearest = "";
      if (dec && dec.kernel) {
        const kClaim = await kernelToConjecture(dec.kernel);
        if (kClaim) {
          const kRes = evaluateClaim(kClaim);
          if (kRes.holds) {
            nearest = `\n\n🔎 Nearest TRUE pattern I could find: ${kClaim.label || `${kClaim.template}/${kClaim.generator}`} — OBSERVED by computation through n = ${kRes.checkedTo.toLocaleString()}` +
              (kRes.observedPeriod ? ` (period ${kRes.observedPeriod})` : "") + ` (still evidence-to-N, not proven).`;
          }
        }
      }
      return litBlock + nearest + leapNote;
    }

    // ── No literal claim expressible → fall back to the D path: salvage + test the
    //    established kernel of the idea (still never validates the speculative leap). ──
    if (!dec || !dec.kernel) {
      return "I couldn't turn that into a machine-checkable number-pattern claim — and I couldn't isolate an established arithmetic kernel either. So there's nothing to test yet, and I won't invent a result. (The idea stays speculative.)";
    }
    const split = `Decomposition (honesty-gated):\n  • KERNEL (the established core): ${dec.kernel.label}\n  • LEAP (the speculative claim): ${dec.leap.label}  → stays SPECULATIVE; I only test the kernel.\n\n`;
    const claim = await kernelToConjecture(dec.kernel);
    const result = claim ? evaluateClaim(claim) : null;
    return split + renderKernelConjecture(dec.kernel, claim, result || { invalid: true });
  } catch (e) {
    console.error("[M8] runKernelTest error (non-fatal):", e.message);
    return "I hit an error setting up the test and won't guess a result. Try rephrasing the idea, Boss.";
  }
}

module.exports = {
  // pure core (mirror-tested)
  modexp, genValueMod, digitalRootOfGen, validateClaim, evaluateClaim,
  minimalPeriod, observedDrPeriod, heldVerificationState,
  TEMPLATES, GENERATORS,
  // llm + narration
  parseClaim, kernelToConjecture, proposeLiteralClaim, renderKernelConjecture,
  // chat integration
  detectKernelTest, runKernelTest, KERNEL_TEST_RE,
  N_DEFAULT, N_MAX,
};
