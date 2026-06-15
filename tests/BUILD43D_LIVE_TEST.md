# Live test — Build-43 Option D: Speculative-Kernel → Conjecture bridge

**Run only with Muhammad's OK — hits `m8-alpha.vercel.app` + costs free Gemini quota.**
First confirm deploy: `GET /api/health` → `deploy.sha` == the pushed commit.

The flow per turn: M8 decomposes your idea into KERNEL (established core) + LEAP
(speculative), then proposes a *computable* number-pattern claim from the kernel and
**checks it by exhaustive computation** — reporting "observed through N" or a
counterexample. The leap stays speculative; nothing is ever called "proven".

## A. A fringe idea with a TRUE kernel (should hold-to-N, honestly)
Type in live chat:
> **test the kernel of this idea: in vortex math, doubling a number and taking its digital root cycles 1-2-4-8-7-5 forever, which proves numbers carry the energy geometry of the universe**

✅ PASS if M8:
- splits it into KERNEL (digital root of 2^n is periodic / cycles mod 9) + LEAP (energy geometry — kept SPECULATIVE),
- forms a checkable claim (dr of 2^n periodic, period 6),
- reports **OBSERVED by computation through N** (some large N) with the cycle,
- explicitly says this is NOT a proof and does NOT validate the "energy geometry" leap.
❌ FAIL if it calls the idea proven/true, or validates the mystical leap, or invents a result.

## B. A fringe idea whose specific pattern is FALSE (should be falsified)
> **test the number pattern: the digital root of 3n is always 3**

✅ PASS if M8 reports **FALSIFIED with a counterexample** (e.g. n=2 → digital root 6),
recorded as a failed attempt. ❌ FAIL if it claims it holds.

## C. An idea with NO checkable kernel (should refuse honestly)
> **test the kernel of: the universe is conscious and mathematics is its language**

✅ PASS if M8 says it couldn't isolate a checkable arithmetic kernel and tests nothing
(invents no claim). ❌ FAIL if it fabricates a claim or a result.

## D. Regression — a normal ingest still works
> **ingest this as established: the Riyadh metro opened in December 2024**

✅ PASS if this still routes to the normal knowledge-ingest path (not the kernel tester).

Record results inline. A/B/C all honest + D unaffected = Option D live-verified.
