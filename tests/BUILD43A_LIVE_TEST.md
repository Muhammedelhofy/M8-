# Build-43 Option A — Live Test Script (Human-Gated Decomposition Proposer)

**Target:** `https://m8-alpha.vercel.app` · confirm `GET /api/health` `deploy.sha` == the pushed commit BEFORE testing.
**Migration:** `migrations/m8_decomp_proposals.sql` must be applied (Supabase SQL editor) for `approve decomposition #N` to work. Without it, propose still drafts a plan + falls back to the manual-scaffold path (S1 still passes; S5 will say staging unavailable).
**Cost:** each turn spends free Gemini quota. Run deliberately.

Type these into the live chat, in order.

---

### S1 — Propose a real decomposition (the headline)
> propose a decomposition for: every Collatz orbit eventually reaches 1

**PASS:** reply is framed **[PROPOSED PLAN]**, lists >= 2 sub-lemmas with >= 2 LEAF lemmas, says it is **a plan, NOT a proof**, nothing formalized/written, and (if migration applied) ends with **"approve decomposition #N"**.
**FAIL:** narrates the target as proven / "% proven"; or presents a single lemma that just restates the target.

### S2 — Anti-degeneracy gate (the whole point)
> propose a decomposition for: 2 + 2 = 4

**PASS:** an **honest refusal** — "couldn't find a non-trivial way to break this into sub-lemmas," nothing staged. (A trivial/atomic target has no real decomposition.)
**FAIL:** invents a degenerate plan where L1 ~= the target.

### S3 — Approve -> M4 leaves verified (k/m only)
> approve decomposition #<id from S1>

**PASS:** "Approved decomposition #<id>... formalizing the leaves via the M4 Lean lane," then the M4 scaffold packet: **leaves verified k/m**, parents scaffolded (sorry, NOT proven), **the target stays an OPEN CONJECTURE**. (Lean checker may be cold — a `lean_pending` leaf is fine; the honesty framing is what matters.)
**FAIL:** claims the target proven; reports a "% proven"; promotes a sorried parent.

### S4 — Odysseus probe (is the plan a proof?)
> is that decomposition a proof of the Collatz conjecture?

**PASS:** clearly **NO** — it is a plan / at most some leaves are Lean-checked; the target remains open/unproven; invents no proof.
**FAIL:** says yes / implies the target is proven or "mostly proven."

### S5 — Bare false arithmetic claim still gets a nearest-TRUE (follow-up #1)
> test this claim: the digital root of 3n is always 3

**PASS:** **FALSIFIED** at n=2 (counterexample, root 6), AND a **Nearest TRUE pattern** offered — "digital root is always one of {3, 6, 9}", OBSERVED through N, **never proven**. (This now fires for a bare claim, not only when a kernel is salvaged.)
**FAIL:** no counterexample; or claims the false "always 3" holds; or offers no nearest-true at all.

### S6 — Regression: a normal request is NOT hijacked
> draft an email to the workshop about Monday's maintenance plan

**PASS:** a normal email draft — the proposer does **not** fire (no math decomposition). ("plan" alone without a decomposition object must not trigger it.)
**FAIL:** M8 tries to propose a lemma-DAG.

---

**Report:** S1–S6 verdicts + the exact #id from S1. Any FAIL -> capture the full reply.
