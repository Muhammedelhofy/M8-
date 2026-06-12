/**
 * M8 Lean Verification Probe — Build-9 (Steps 2–3).
 *
 * Flow:  prose claim → Fable 5 drafts ONE Lean 4 theorem → /check elaborates it →
 *        three-state verdict (verified / statement-only / rejected) → notebook.
 *
 * Honesty spine (mirrors discovery.js / OEIS):
 *   - The /check response IS the evidence. No /check call ⇒ nothing logged.
 *   - A statement that type-checks is NOT a proof — never promote to "theorem".
 *   - The formalization model is CONFIGURABLE (default = the app's free Gemini, so
 *     Build-9 needs no new API key; Fable 5 is an opt-in upgrade). Whichever is
 *     chosen is called PINNED — no silent multi-provider fallback — so an upgrade
 *     model can't be quietly swapped for a weaker one; if it's unreachable we say
 *     so and log nothing.
 *   - One automatic repair on a real Lean error, then stop and report honestly.
 *
 * See BUILD_9_SPEC.md for the full design.
 */
const { generateOnce } = require("./llm");
const { runLeanCheck } = require("./leanClient");

// ─────────────────────────────────────────────────────────────────
// DETECTION
// ─────────────────────────────────────────────────────────────────
// Fires only when BOTH a formalize/verify-in-Lean intent AND a math target are
// present. Checked AFTER discovery + OEIS in the orchestrator (those win).
const LEAN_INTENT = /\b(?:in\s+lean|using\s+lean|with\s+lean|formaliz(?:e|es|ed|ing)|formal(?:ly)?\s+(?:verif|prov|check)\w*|lean\s*4?\s*(?:verif|check|prov)\w*|machine[-\s]?check\w*)\b/i;
const MATH_TARGET = /(?:\btheorem\b|\blemma\b|\bprove\b|\bproof\b|\bidentity\b|\bconjecture\b|\beven\b|\bodd\b|\bprime\b|\bdivisib\w*|\bdivides\b|\bsum\s+of\b|\bfor\s+all\s+n\b|∀|\d\s*[+\-*/=]\s*\d|=)/i;
// S4 benchmark finding (2026-06-12): an EXPLICIT ask-verb + "in/using/with Lean"
// request must claim the lane even when the claim has no MATH_TARGET keyword
// ("verify in Lean: the square root of 2 is irrational" — no =, no keyword).
// Without this, the unguarded LLM freestyled Lean-3 tutorials that "proved"
// claims with `axiom` declarations — the fabrication class the lane exists to
// kill. Bare "formalize X" with NO lean mention still requires MATH_TARGET, so
// business phrasing ("formalize the onboarding process") is not hijacked.
const LEAN_EXPLICIT = /\b(?:formaliz(?:e|es|ed|ing)|verify(?:ing)?|prove|proving|check(?:ing)?|state|stating|show(?:ing)?)\b[^.?!]{0,80}?\b(?:in|using|with)\s+lean\b|\b(?:in|using|with)\s+lean\s*[:,]/i;

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// META-QUESTION GUARD (Odysseus S3 live finding, 2026-06-12): a question ABOUT
// the implications of a Lean verification ("you verified a lemma in Lean, so
// Collatz is solved, right?" / "if Lean accepts the statement, that counts as
// proving it, doesn't it?") is a conversation turn, NOT a formalization request.
// Without this guard the lane hijacked such turns and the UNFORMALIZABLE escape
// produced a canned refusal instead of answering the actual question (honest —
// nothing was overclaimed — but a dodge). Tag-questions and does-that-mean
// shapes never co-occur with a genuine "formalize X" imperative.
const LEAN_META_QUESTION = /(?:,?\s*(?:right|correct)\s*\?\s*$)|(?:\bdoes(?:n'?t)?\s+(?:that|it|this)\b)|(?:\bcounts?\s+as\b)|(?:\bisn'?t\s+(?:it|that)\b)|(?:^\s*if\s+lean\b)|(?:\bso\s+(?:the\s+)?\w[\w\s-]{0,40}\s+is\s+(?:now\s+)?(?:solved|proven|proved|settled)\b)/i;

function detectLeanProbe(message) {
  const s = (message || "").trim();
  if (s.length < 6) return { lean: false };
  if (!LEAN_EXPLICIT.test(s)) {
    if (!LEAN_INTENT.test(s)) return { lean: false };
    if (!MATH_TARGET.test(s)) return { lean: false };
  }
  if (LEAN_META_QUESTION.test(s)) return { lean: false };
  return { lean: true, goal: s, conjectureText: null, thread: slug(s) || "lean" };
}

// S4 precedence finding (2026-06-12): an EXPLICIT "… in Lean" ask must outrank
// the discovery lane in the orchestrator. Discovery-shaped wording ("formalize
// and verify in Lean: <famous claim> up to N / and log it") otherwise gets
// claimed by discovery, which computes evidence and lets the LLM freestyle an
// UNCHECKED prose Lean draft — honest, but it bypasses /check. Only the
// EXPLICIT path preempts: bare "verify Collatz up to 100,000" has no Lean
// mention and stays a discovery run. Meta-questions never preempt.
function isExplicitLeanAsk(message) {
  const s = (message || "").trim();
  if (s.length < 6) return false;
  return LEAN_EXPLICIT.test(s) && !LEAN_META_QUESTION.test(s);
}

// ─────────────────────────────────────────────────────────────────
// FORMALIZATION PROMPT (Fable 5)
// ─────────────────────────────────────────────────────────────────
const LEAN_SYSTEM = `You are a Lean 4 + Mathlib formalization assistant. You translate a single mathematical claim into ONE Lean 4 declaration that elaborates against Mathlib.

OUTPUT CONTRACT — follow exactly:
- Output ONLY raw Lean 4 code. No markdown fences, no prose, no comments.
- Exactly one \`theorem\` (or \`lemma\`). Give it a snake_case name.
- Do NOT include ANY \`import\` line — Mathlib is already imported by the checker. Start directly with the theorem.
- BANNED anywhere in the output: \`#eval\`, \`#check\`, \`axiom\`, \`unsafe\`, \`macro\`, \`set_option\`, and ANY \`import\` line. (The checker rejects these as injection.)
- PROOF POLICY:
  • If the claim is elementary and you are confident, close it with a SINGLE trivial proof from this allowlist ONLY: \`:= rfl\`, \`:= by decide\`, \`:= by norm_num\`, \`:= by simp\`, \`:= by omega\`, \`:= by ring\` (polynomial/algebraic identities).
  • If you are NOT confident of a one-line proof, close it with \`:= by sorry\`. A \`sorry\` is honest and expected — do NOT invent a multi-step proof.
- Do not restate or weaken the claim to make it pass. The statement must faithfully formalize exactly what was asked.
- If the claim references a function or concept that does not exist in Mathlib and cannot be faithfully stated, output EXACTLY one line \`UNFORMALIZABLE: <short reason>\` and nothing else. NEVER weaken, rename, or substitute the claim so it elaborates (e.g. "frobnicate n = n" must NOT become "n = n").

EXAMPLES — every one validated against the live checker (S4 golden corpus, tests/lean-corpus/golden.json). Match this style exactly:

Claim: "2 + 2 = 4"
theorem two_add_two : 2 + 2 = 4 := rfl

Claim: "adding zero to any natural number gives the same number"
theorem add_zero_id (n : ℕ) : n + 0 = n := rfl

Claim: "97 is prime"
theorem prime_97 : Nat.Prime 97 := by decide

Claim: "123456789 + 987654321 = 1111111110"
theorem big_sum : 123456789 + 987654321 = 1111111110 := by norm_num

Claim: "one half plus one third equals five sixths"
theorem half_plus_third : (1/2 : ℚ) + 1/3 = 5/6 := by norm_num

Claim: "every natural number is less than its successor"
theorem lt_succ_self_nat (n : ℕ) : n < n + 1 := by omega

Claim: "every natural number has remainder 0 or 1 mod 2"
theorem mod_two_cases (n : ℕ) : n % 2 = 0 ∨ n % 2 = 1 := by omega

Claim: "appending the empty list does not change a list's length"
theorem append_nil_length (l : List ℕ) : (l ++ []).length = l.length := by simp

Claim: "(x*y + 1) * (x*y - 1) = x^2 * y^2 - 1 over the integers"
theorem diff_of_squares (x y : ℤ) : (x * y + 1) * (x * y - 1) = x ^ 2 * y ^ 2 - 1 := by ring

Claim: "every even number at least 4 is the sum of two primes" (hard open conjecture — state faithfully, sorry the proof)
theorem goldbach_statement : ∀ n : ℕ, 4 ≤ n → Even n → ∃ p q : ℕ, p.Prime ∧ q.Prime ∧ p + q = n := by sorry

Claim: "the frobnicate of n equals n" (no such concept in Mathlib)
UNFORMALIZABLE: 'frobnicate' is not a defined function in Mathlib and cannot be faithfully stated.`;

function buildLeanDirective({ goal, conjectureText, thread, priorError } = {}) {
  const claim = String(conjectureText || goal || "").trim();
  let user = `Formalize this claim as one Lean 4 theorem:\n\n${claim}`;
  if (priorError) {
    user += `\n\nYour previous attempt was REJECTED by Lean with this error:\n---\n${String(priorError).slice(0, 1200)}\n---\nFix it. Output ONLY the corrected Lean 4 code, same contract as before.`;
  }
  return { system: LEAN_SYSTEM, user, thread: thread || "lean" };
}

// ─────────────────────────────────────────────────────────────────
// SANITIZE + INJECTION SCREEN (client side; the service screens too)
// ─────────────────────────────────────────────────────────────────
function sanitizeLeanCode(raw) {
  let c = String(raw || "").trim();
  const fence = c.match(/```(?:lean)?\s*([\s\S]*?)```/i);   // unwrap a fenced block if Fable added one
  if (fence) c = fence[1].trim();
  c = c.replace(/^```.*$/gm, "").trim();                    // drop any stray fence lines
  // The checker PRE-IMPORTS Mathlib and rejects any `import` line as injection —
  // strip a stray `import Mathlib` rather than let a perfect proof die on the screen.
  c = c.replace(/^\s*import\s+Mathlib\s*$/gm, "").trim();
  return c;
}

// Honest escape hatch (live finding 2026-06-12): asked to formalize a claim with
// no Mathlib counterpart ("frobnicate n = n"), Gemini WEAKENED it to `n = n` and
// the checker verified the wrong claim. The directive now offers UNFORMALIZABLE
// as the compliant option; we treat it as an honest refusal — no /check, no log.
const UNFORMALIZABLE_RE = /^\s*UNFORMALIZABLE\b[:\s]/i;
function isUnformalizable(code) { return UNFORMALIZABLE_RE.test(String(code || "")); }

const BANNED_RE = /(?:#eval|#check|#print|\baxiom\b|\bunsafe\b|\bmacro\b|\bset_option\b)/;
function hasBannedTokens(code) {
  if (BANNED_RE.test(code)) return true;
  const importLines = code.match(/^\s*import\s+.*$/gm) || [];
  return importLines.some((l) => !/^\s*import\s+Mathlib\s*$/.test(l));
}

// ─────────────────────────────────────────────────────────────────
// THREE-STATE VERDICT (the /check contract: errors[] and sorries[] separate)
// ─────────────────────────────────────────────────────────────────
function interpretLeanResult(data) {
  const errors  = Array.isArray(data && data.errors)  ? data.errors  : [];
  const sorries = Array.isArray(data && data.sorries) ? data.sorries : [];
  const verified = data && data.verified === true;
  const errorText = errors
    .map((e) => (typeof e === "string" ? e : (e && (e.data || e.message)) || JSON.stringify(e)))
    .join("\n").slice(0, 800);

  if (errors.length > 0)  return { kind: "lean_rejected", badge: "✗ Lean rejected",          sorryCount: sorries.length, errorText };
  if (sorries.length > 0) return { kind: "lean_stated",   badge: "◑ Lean: statement verified", sorryCount: sorries.length, errorText: "" };
  if (verified)           return { kind: "lean_verified", badge: "✓ Lean Verified",            sorryCount: 0, errorText: "" };
  return { kind: "lean_rejected", badge: "✗ Lean rejected", sorryCount: 0, errorText: "checker did not report verified" };
}

// ─────────────────────────────────────────────────────────────────
// NOTEBOOK STAGING (mirror buildOEISNotes shape)
// ─────────────────────────────────────────────────────────────────
function buildLeanNotes({ message, code, result, thread } = {}) {
  const t = thread || "lean";
  const ask = String(message || "").trim().slice(0, 160);
  const snip = String(code || "").trim().slice(0, 600);
  if (!result || !snip) return { notes: [] };

  if (result.kind === "lean_verified") {
    return { notes: [{ kind: "evidence", stance: "for", status: "lean_verified", thread: t, importance: 4,
      content: `[Lean verified] ${snip} — type-checks, 0 sorry, 0 errors. Ask: "${ask}".` }] };
  }
  if (result.kind === "lean_stated") {
    return { notes: [{ kind: "note", stance: null, status: "lean_stated", thread: t, importance: 3,
      content: `[Lean statement verified] ${snip} — elaborates; proof admitted (sorry). NOT proven. Ask: "${ask}".` }] };
  }
  if (result.kind === "lean_rejected") {
    return { notes: [{ kind: "note", stance: null, status: "lean_rejected", thread: t, importance: 2,
      content: `[Lean rejected] ${snip} — error: ${String(result.errorText || "").slice(0, 200)}. Ask: "${ask}".` }] };
  }
  return { notes: [] };   // lean_pending / lean_error → stage nothing (fail safe)
}

// ─────────────────────────────────────────────────────────────────
// DETERMINISTIC NARRATION (narration ≤ evidence — show the code + the verdict)
// ─────────────────────────────────────────────────────────────────
function fence(code) { return "```lean\n" + String(code || "").trim() + "\n```"; }

function narrate(result, code, thread, attempts) {
  if (result.kind === "lean_verified") {
    return `I formalized this in Lean 4 and submitted it to the checker — it **verified** (0 errors, 0 \`sorry\`).\n\n${fence(code)}\n\nThis is a mechanical Lean type-check and proof, not a human-reviewed result. Logged to the notebook (thread '${thread}').`;
  }
  if (result.kind === "lean_stated") {
    return `I formalized this in Lean 4. The **statement type-checks** against Mathlib, but the proof is left as \`sorry\` — so this is a *verified statement, not a proof*.\n\n${fence(code)}\n\nLogged as a formally-stated conjecture (thread '${thread}'). It is **not** proven.`;
  }
  // lean_rejected
  const tail = attempts >= 2 ? " after 2 attempts" : "";
  const err = result.errorText ? `\n\nLean error:\n\`\`\`\n${String(result.errorText).slice(0, 500)}\n\`\`\`` : "";
  return `I drafted a Lean 4 statement and submitted it, but Lean **rejected** it${tail}:\n\n${fence(code)}${err}\n\nLogged honestly as \`lean_rejected\` — the conjecture remains unformalized.`;
}

function narrateService(kind, code, reason) {
  if (kind === "lean_pending") {
    return `I drafted the Lean statement, but the verification service is cold/slow right now and didn't answer within my budget, so I can't confirm it this turn (${reason || "timeout"}). Ask again in a moment and it'll be warm.\n\n${fence(code)}`;
  }
  return `I drafted a Lean statement, but the Lean checker is unreachable right now (${reason || "service error"}), so I can't verify it — nothing logged.\n\n${fence(code)}`;
}

function narrateDraftFailed() {
  return `I couldn't reach the formalization model to draft the Lean statement, and I won't silently substitute a different one — so I'm not guessing. Nothing logged. Try again shortly.`;
}

function narrateUnformalizable(line) {
  const reason = String(line || "").replace(UNFORMALIZABLE_RE, "").trim().slice(0, 300).replace(/[.\s]+$/, "");
  return `This claim can't be faithfully formalized against Mathlib${reason ? ` — ${reason}` : ""}. I won't weaken or rename it into something that would pass the checker, so nothing was submitted and nothing was logged.`;
}

function narrateBanned(code) {
  return `The drafted Lean code used a disallowed construct (e.g. \`#eval\`/\`axiom\`/extra import), so I rejected it before submitting rather than risk an unsound check.\n\n${fence(code)}\n\nLogged as \`lean_rejected\`.`;
}

// ─────────────────────────────────────────────────────────────────
// ORCHESTRATION HELPER — one call does draft → check → (1 repair) → narrate.
// Returns { response, code, result }. NEVER throws (fails safe).
// ─────────────────────────────────────────────────────────────────
async function runLeanTurn({ leanProbe, meta, log } = {}) {
  const lp = leanProbe || {};
  const thread = lp.thread || "lean";
  // DEFAULT = free Gemini (the app's existing backbone) — Build-9 runs with NO
  // new API key. Fable 5 is an opt-in UPGRADE for when Lean quality matters:
  // set LEAN_FORMALIZE_PROVIDER=anthropic (+ ANTHROPIC_API_KEY) or =openrouter.
  const provider = (process.env.LEAN_FORMALIZE_PROVIDER || "gemini").toLowerCase();
  let model = process.env.LEAN_FORMALIZE_MODEL || null;
  if (!model && provider === "anthropic")  model = "claude-fable-5";
  if (!model && provider === "openrouter") model = "anthropic/claude-fable-5";
  // gemini/default: model stays null → generateOnce uses the configured GEMINI_MODEL

  const draft = async (priorError) => {
    const { system, user } = buildLeanDirective({ goal: lp.goal, conjectureText: lp.conjectureText, thread, priorError });
    const raw = await generateOnce({
      provider, model,
      systemInstruction: system,
      contents: [{ role: "user", parts: [{ text: user }] }],
      genConfig: { temperature: 0, maxOutputTokens: 700 },
      meta,
    });
    return sanitizeLeanCode(raw);
  };

  // 1) draft via Fable (pinned). Unreachable ⇒ fail safe, never substitute.
  let code;
  try { code = await draft(null); }
  catch (err) {
    if (log) log("lean_draft_failed", { leanError: String((err && err.message) || err).slice(0, 140) });
    return { response: narrateDraftFailed(), code: null, result: { kind: "lean_error" } };
  }

  // honest refusal: claim has no faithful Mathlib formalization → no /check, no log
  if (isUnformalizable(code)) {
    if (log) log("lean_unformalizable");
    return { response: narrateUnformalizable(code), code: null, result: { kind: "lean_unformalizable" } };
  }

  // injection screen before we ever hit the service
  if (hasBannedTokens(code)) {
    if (log) log("lean_banned_tokens");
    return { response: narrateBanned(code), code, result: { kind: "lean_rejected", errorText: "draft contained banned tokens" } };
  }

  // 2) check
  let chk = await runLeanCheck({ code });
  let attempts = 1;

  if (chk.ok) {
    let result = interpretLeanResult(chk.data);

    // 3) ONE repair on a real elaboration error, then stop
    if (result.kind === "lean_rejected") {
      if (log) log("lean_rejected_retry");
      try {
        const code2 = await draft(result.errorText);
        if (!isUnformalizable(code2) && !hasBannedTokens(code2)) {
          const chk2 = await runLeanCheck({ code: code2 });
          attempts = 2;
          if (chk2.ok) { code = code2; result = interpretLeanResult(chk2.data); }
          // chk2 not ok ⇒ keep the first rejection verdict (we already have one)
        }
      } catch (_) { /* keep first rejection */ }
    }

    if (log) log("lean_result", { leanKind: result.kind, attempts });
    return { response: narrate(result, code, thread, attempts), code, result };
  }

  // 4) first check pending/error → fail safe
  if (log) log("lean_service", { leanStatus: chk.status, reason: chk.reason });
  const kind = chk.status === "lean_pending" ? "lean_pending" : "lean_error";
  return { response: narrateService(kind, code, chk.reason), code, result: { kind } };
}

module.exports = {
  detectLeanProbe, isExplicitLeanAsk, buildLeanDirective, sanitizeLeanCode, hasBannedTokens,
  isUnformalizable, interpretLeanResult, buildLeanNotes, runLeanTurn,
  // exported for tests:
  LEAN_INTENT, MATH_TARGET, LEAN_SYSTEM,
};
