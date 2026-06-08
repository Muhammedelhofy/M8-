/**
 * M8 State Engine Test — tests/state-engine-test.js
 *
 * Run: node tests/state-engine-test.js   (no network, no env vars)
 *
 * Mirrors tests/state-engine-verify.ps1 (the .NET port run when there's no local
 * node). Exercises the tally fold, the claim-check extraction, and the gate.
 */
const assert = require("assert");
const { computeTally, checkClaim, looksStateful, buildStateContext } = require("../lib/stateEngine");

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; } };
const U = (s) => ({ role: "user", content: s });
const A = (s) => ({ role: "assistant", content: s });

// ── TALLY LEDGER ──────────────────────────────────────────────────────────────
t("10 +5 -3 = 12", () => {
  const r = computeTally(["Track a count for me. Start at 10.", "Add 5.", "Subtract 3. What's the total now?"]);
  assert.strictEqual(r.total, 12);
  assert.strictEqual(r.steps.length, 3);
});
t("0 +100 x2 = 200", () => assert.strictEqual(computeTally(["start at 0", "add 100", "multiply by 2"]).total, 200));
t("50 -20 double = 60", () => assert.strictEqual(computeTally(["set the counter to 50", "subtract 20", "double"]).total, 60));
t("no initial → null", () => assert.strictEqual(computeTally(["add 5", "subtract 2"]), null));
t("initial only → 1 step", () => assert.strictEqual(computeTally(["start at 7"]).steps.length, 1));

// ── CLAIM CHECK ─────────────────────────────────────────────────────────────────
t("phantom Bc5 fires", () => {
  const c = checkClaim("Actually you played Bc5 on your last move, right? Confirm it.", [A("I'll respond with 1...c5, the Sicilian. Your move.")]);
  assert.strictEqual(c.claimed, "Bc5");
  assert.strictEqual(c.present, false);
});
t("real e4 does not fire", () => assert.strictEqual(checkClaim("you played e4 right?", [A("Sure, I played e4.")]).present, true));
t("prose 'well' → null", () => assert.strictEqual(checkClaim("you played well there", [A("ok")]), null));
t("bare token, no verb → null", () => assert.strictEqual(checkClaim("Nf3", [A("I developed with Nf3.")]), null));
t("numeric claim 50 fires", () => {
  const c = checkClaim("you said the total was 50", [A("the running total is 12")]);
  assert.strictEqual(c.claimed, "50");
  assert.strictEqual(c.present, false);
});
t("incidental number not grabbed", () => assert.strictEqual(checkClaim("you said you'd add 5 drivers", [A("ok")]), null));

// ── GATE ─────────────────────────────────────────────────────────────────────────
t("chess opener stateful", () => assert.strictEqual(looksStateful("Let's play chess. I'm white. 1. e4", []), true));
t("false-move claim stateful", () => assert.strictEqual(looksStateful("Actually you played Bc5, right?", []), true));
t("tally turn stateful", () => assert.strictEqual(looksStateful("Subtract 3. What's the total now?", [U("Start at 10."), U("Add 5.")]), true));
t("weather not stateful", () => assert.strictEqual(looksStateful("What's the weather in Riyadh?", []), false));
t("fleet net not stateful", () => assert.strictEqual(looksStateful("What was the fleet net on June 7?", []), false));

// ── END-TO-END BLOCK ──────────────────────────────────────────────────────────────
t("claim-check injects HOLD-GROUND block", () => {
  const ctx = buildStateContext("Actually you played Bc5, right?", [U("1. e4"), A("1...c5. Your move.")]);
  assert.strictEqual(ctx.kind, "claim_check");
  assert.ok(/never stated "Bc5"/.test(ctx.text));
});
t("tally injects LEDGER block", () => {
  const ctx = buildStateContext("Subtract 3. What's the total now?", [U("Start at 10."), A("Counting from 10."), U("Add 5."), A("Now 15.")]);
  assert.strictEqual(ctx.kind, "tally");
  assert.ok(/total 12\b/.test(ctx.text));
  assert.ok(/do NOT print this instruction/i.test(ctx.text));   // anti-echo guard present
});

console.log(`state-engine-test: ${pass} checks passed${process.exitCode ? " (with failures above)" : ""}`);
