# Build-12 Live Test — Lean Hardening (S4, 2026-06-12)

Fresh session each unless noted. Automated versions: `tests/lean-corpus/validate-corpus.ps1` (37/37) and `run-lean-bench.ps1` (before 0.3 → after 0.65).

**1.** `formalize and verify in Lean: the square root of 2 is irrational`
✅ Lane claims it (deterministic narration), faithful statement (e.g. `¬ ∃ q : ℚ, q^2 = 2`), honest sorry/stated or verified — NEVER a prose Lean-tutorial with `import`/`axiom` (the pre-fix failure).

**2.** `formalize and verify in Lean: for any integers a and b, (a + b)^2 = a^2 + 2*a*b + b^2`
✅ **verified** via `by ring` (new allowlist tactic).

**3.** `formalize in Lean: every even number greater than or equal to 4 is the sum of two primes`
✅ **lean_stated**: "statement type-checks… proof left as sorry… NOT proven", logged as formally-stated conjecture. (Since the precedence fix below, "formalize **and verify** in Lean: …" works too.)

**4.** `formalize and verify in Lean: frobnicate n = n for all natural numbers n`
✅ still honest UNFORMALIZABLE refusal (no weakening).

**5.** `formalize the driver onboarding process for the fleet`
✅ does NOT enter the Lean lane (business phrasing unaffected).

**6.** `Invoke-RestMethod https://m8-lean-check-vbhba5tbgq-ue.a.run.app/health`
✅ `mathlib: b580ec53f9e3` (pinned) · cold start ≈ 10 min then ms-fast.

**Known — FIXED (S4 close-out session, 2026-06-12):** "formalize AND VERIFY in Lean: <claim>" could be claimed by the DISCOVERY lane first (unchecked prose Lean draft, bypassing /check). Root cause: BOUND_RE's `to\s+\d` matched "…greater than or equal **to 4**…" as a discovery bound, so verify+primes+bound fired. Fix: `isExplicitLeanAsk()` (LEAN_EXPLICIT minus meta-questions) now outranks discovery + OEIS in the orchestrator; `lean_over_discovery` is logged when it preempts. Plain "verify Collatz up to 100,000" (no Lean mention) still routes to discovery.

**7.** `formalize and verify in Lean: every even number greater than or equal to 4 is the sum of two primes`
✅ Lean lane claims it (NOT discovery): faithful Goldbach statement, **lean_stated**, honest sorry. Trace shows `lean_over_discovery`.

**8.** `verify Collatz up to 100,000`
✅ still a DISCOVERY run (computed evidence, notebook-logged) — precedence fix did not over-claim.
