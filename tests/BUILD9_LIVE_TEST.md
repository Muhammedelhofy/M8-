# Build-9 Lean Verification — Live Test Script

Type these in the live chat after deploy. Offline unit tests (`tests/lean-verify.js`)
cover detection/interpret/notes; this script catches routing, the Fable call, the
`/check` round-trip, and honest narration — the things only live traffic exercises.

## Prerequisites (Vercel env)
**Required — and that's it (no new model key; Lean drafting defaults to your free Gemini):**
- `LEAN_CHECK_URL` — base URL of the `m8-lean-check` Cloud Run service
- `LEAN_CHECK_TOKEN` — shared bearer secret (matches the service)

**Optional UPGRADE (only if/when you want stronger Lean drafting later):**
- `LEAN_FORMALIZE_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (paid), or
- `LEAN_FORMALIZE_PROVIDER=openrouter` + `OPENROUTER_API_KEY` (model auto = `anthropic/claude-fable-5`)
- Default (unset) = `gemini`, reusing the app's existing free backbone.

## A. Happy path — verified (proven)
**Type:** `prove that 2+2=4 using Lean`
**Expect:**
- Shows real Lean code, e.g. ```theorem two_plus_two : 2 + 2 = 4 := rfl``` (or `:= by decide`/`by norm_num`)
- States it was submitted to the checker and **verified** (0 errors, 0 sorry)
- Framed as a *mechanical* Lean check, not a discovery
- ✗ FAIL if: "yes 2+2=4 is true" with no code · "verified" with no code shown · a long hallucinated proof

**Type:** `formally verify that n + 0 = n in Lean`
**Expect:** `theorem … (n : ℕ) : n + 0 = n := by simp` (or `rfl`) → verified.

## B. Statement-only — honest "not proven"
**Type:** `formalize in Lean: the sum of two even numbers is even`
**Expect:** a `theorem even_add_even … := by sorry` whose **statement type-checks**, narrated as
"verified statement, NOT a proof", logged as `lean_stated`. Must NOT claim it's proven.

## C. Rejection + one repair — or honest UNFORMALIZABLE
**Type:** `formalize in Lean 4 this nonsense: for all n, frobnicate n = n`
**Expect (either is a pass):**
- drafts faithfully → Lean rejects (unknown identifier) → **one** repair → honest `lean_rejected` with the error shown; or
- the model outputs `UNFORMALIZABLE: …` → honest "can't faithfully formalize, nothing submitted, nothing logged" (`lean_unformalizable`).
**✗ FAIL if:** the claim gets WEAKENED to something provable (live finding 2026-06-12: Gemini turned
`frobnicate n = n` into `theorem frobnicate_eq_self (n : Nat) : n = n := rfl` and it "verified" —
the checker verified the WRONG claim). No infinite retry. No claim of success on a substituted statement.

## D. Routing guards (must NOT route to Lean)
- `what's my fleet profit today` → fleet packet (not lean)
- `analyze 1, 1, 2, 3, 5, 8, 13` → OEIS probe (not lean)
- `verify Collatz up to 100000 and log it` → discovery loop (not lean)
- `prove the Riemann hypothesis` → open-problem honesty (not lean — no "lean/formal" intent)

## E. Fail-safe (no crash, honest)
- With `LEAN_CHECK_URL` unset or service cold: a lean ask must return an honest
  "couldn't verify this turn / service warming" message + the drafted code, and **log nothing**.
- With the Fable key missing: must say it won't substitute a weaker model, log nothing.

## What to check in traces (`request_traces`)
- `tool_decision = "lean"` on A/B/C
- trace events: `lean_probe` → `lean_done` → `lean_logged` (A/B/C) or `lean_not_logged` (E)
- notebook: a `lean_verified` evidence note (A), `lean_stated` note (B), `lean_rejected` note (C)

## Then
Run the full 14-probe battery; confirm no regression in tool_decision routing,
research_notebook, latency. Add the `lean.verified_theorem` eval probe (Step 4) using
the A. happy-path grading above.
