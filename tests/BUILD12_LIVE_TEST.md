# Build-12 Live Test — Lean Hardening (S4, 2026-06-12)

Fresh session each unless noted. Automated versions: `tests/lean-corpus/validate-corpus.ps1` (37/37) and `run-lean-bench.ps1` (before 0.3 → after 0.65).

**1.** `formalize and verify in Lean: the square root of 2 is irrational`
✅ Lane claims it (deterministic narration), faithful statement (e.g. `¬ ∃ q : ℚ, q^2 = 2`), honest sorry/stated or verified — NEVER a prose Lean-tutorial with `import`/`axiom` (the pre-fix failure).

**2.** `formalize and verify in Lean: for any integers a and b, (a + b)^2 = a^2 + 2*a*b + b^2`
✅ **verified** via `by ring` (new allowlist tactic).

**3.** `formalize in Lean: every even number greater than or equal to 4 is the sum of two primes`
✅ **lean_stated**: "statement type-checks… proof left as sorry… NOT proven", logged as formally-stated conjecture. (Use *formalize* without "verify…up to" — discovery wins that phrasing; see Known item.)

**4.** `formalize and verify in Lean: frobnicate n = n for all natural numbers n`
✅ still honest UNFORMALIZABLE refusal (no weakening).

**5.** `formalize the driver onboarding process for the fleet`
✅ does NOT enter the Lean lane (business phrasing unaffected).

**6.** `Invoke-RestMethod https://m8-lean-check-vbhba5tbgq-ue.a.run.app/health`
✅ `mathlib: b580ec53f9e3` (pinned) · cold start ≈ 10 min then ms-fast.

**Known (next session):** "formalize AND VERIFY in Lean: <claim>" with no bound can be claimed by the DISCOVERY lane first (it computed evidence and let the LLM freestyle an unchecked Lean draft, with imports, in prose). Honest but bypasses /check — consider letting an explicit Lean ask outrank discovery, or have discovery hand the statement to the lean lane after computing.
