/**
 * Build-9 Lean probe — offline unit tests (no live /check, no Fable call).
 * Covers: detection, sanitize, banned-token screen, three-state interpret,
 * notebook staging, and directive shape. Run: node tests/lean-verify.js
 */
const assert = require("assert");
const {
  detectLeanProbe, buildLeanDirective, sanitizeLeanCode, hasBannedTokens,
  interpretLeanResult, buildLeanNotes,
} = require("../lib/lean");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("  ✗ " + name); }
}

// ── DETECTION: should fire ───────────────────────────────────────
[
  "prove that 2+2=4 using Lean",
  "formalize the conjecture that the sum of two even numbers is even in Lean 4",
  "can you verify in lean that n + 0 = n",
  "formally verify that 3 is prime",
  "machine-check this theorem in Lean: for all n, n = n",
].forEach((m) => ok(`fires: "${m.slice(0,40)}"`, detectLeanProbe(m).lean === true));

// ── DETECTION: should NOT fire ───────────────────────────────────
[
  "what's my fleet profit today",
  "analyze 1, 1, 2, 3, 5, 8, 13",                 // OEIS, no lean intent
  "verify Collatz up to 100000 and log it",        // discovery, no lean intent
  "prove the Riemann hypothesis",                  // no lean/formal intent
  "lean",                                          // too short
  "summarize today's standup",
].forEach((m) => ok(`no-fire: "${m.slice(0,40)}"`, detectLeanProbe(m).lean === false));

// ── SANITIZE: strip fences ───────────────────────────────────────
ok("sanitize unwraps ```lean fence",
  sanitizeLeanCode("```lean\ntheorem t : 2+2=4 := rfl\n```") === "theorem t : 2+2=4 := rfl");
ok("sanitize passes raw code through",
  sanitizeLeanCode("theorem t : 2+2=4 := rfl") === "theorem t : 2+2=4 := rfl");
ok("sanitize strips import Mathlib (checker pre-imports it, rejects any import)",
  sanitizeLeanCode("import Mathlib\ntheorem t : 2+2=4 := rfl") === "theorem t : 2+2=4 := rfl");
ok("sanitize strips import Mathlib inside a fence",
  sanitizeLeanCode("```lean\nimport Mathlib\n\ntheorem t : 2+2=4 := rfl\n```") === "theorem t : 2+2=4 := rfl");

// ── UNFORMALIZABLE ESCAPE HATCH ──────────────────────────────────
{
  const { isUnformalizable } = require("../lib/lean");
  ok("UNFORMALIZABLE: line detected",      isUnformalizable("UNFORMALIZABLE: 'frobnicate' is not defined in Mathlib") === true);
  ok("unformalizable case-insensitive",    isUnformalizable("unformalizable: no such concept") === true);
  ok("plain theorem is not unformalizable", isUnformalizable("theorem t : 2+2=4 := rfl") === false);
  ok("mention mid-text does not trip it",  isUnformalizable("theorem t : 2+2=4 := rfl -- UNFORMALIZABLE") === false);
}

// ── BANNED-TOKEN SCREEN ──────────────────────────────────────────
ok("allows import Mathlib",      hasBannedTokens("import Mathlib\ntheorem t : 2+2=4 := rfl") === false);
ok("blocks #eval",               hasBannedTokens("#eval 2+2") === true);
ok("blocks axiom",               hasBannedTokens("axiom bad : False") === true);
ok("blocks foreign import",      hasBannedTokens("import Lean\ntheorem t : True := trivial") === true);
ok("allows clean theorem",       hasBannedTokens("theorem t : 2+2=4 := rfl") === false);

// ── THREE-STATE INTERPRET ────────────────────────────────────────
ok("verified: errors[] sorries[]",
  interpretLeanResult({ verified: true, errors: [], sorries: [] }).kind === "lean_verified");
ok("stated: errors[] sorries[1]",
  interpretLeanResult({ verified: false, errors: [], sorries: ["sorry@1"] }).kind === "lean_stated");
ok("rejected: errors[1]",
  interpretLeanResult({ verified: false, errors: ["unknown identifier"], sorries: [] }).kind === "lean_rejected");
ok("rejected: empty but not verified",
  interpretLeanResult({ verified: false, errors: [], sorries: [] }).kind === "lean_rejected");
ok("rejected carries error text",
  interpretLeanResult({ errors: ["type mismatch at foo"], sorries: [] }).errorText.includes("type mismatch"));

// ── NOTEBOOK STAGING ─────────────────────────────────────────────
const nVer = buildLeanNotes({ message: "prove 2+2=4 in lean", code: "theorem t : 2+2=4 := rfl",
  result: { kind: "lean_verified" }, thread: "arith" }).notes;
ok("verified → evidence/for",       nVer.length === 1 && nVer[0].kind === "evidence" && nVer[0].stance === "for");
ok("verified → status lean_verified", nVer[0].status === "lean_verified");

const nStated = buildLeanNotes({ message: "x", code: "theorem t : P := by sorry",
  result: { kind: "lean_stated" }, thread: "t" }).notes;
ok("stated → note, NOT evidence-for", nStated[0].kind === "note" && nStated[0].status === "lean_stated");

const nRej = buildLeanNotes({ message: "x", code: "theorem t := bad",
  result: { kind: "lean_rejected", errorText: "boom" }, thread: "t" }).notes;
ok("rejected → note logged (data)",  nRej.length === 1 && nRej[0].status === "lean_rejected");

ok("pending → stage nothing",        buildLeanNotes({ message: "x", code: "c", result: { kind: "lean_pending" }, thread: "t" }).notes.length === 0);
ok("no code → stage nothing",        buildLeanNotes({ message: "x", code: "", result: { kind: "lean_verified" }, thread: "t" }).notes.length === 0);

// ── DIRECTIVE SHAPE ──────────────────────────────────────────────
const d1 = buildLeanDirective({ goal: "sum of two evens is even", thread: "even" });
ok("directive has system contract",  /OUTPUT CONTRACT/.test(d1.system) && /sorry/.test(d1.system));
ok("directive user carries claim",   d1.user.includes("sum of two evens is even"));
const d2 = buildLeanDirective({ goal: "x", priorError: "unknown identifier 'Evn'" });
ok("repair directive includes error", d2.user.includes("REJECTED") && d2.user.includes("unknown identifier"));

console.log(`\nLean probe tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
