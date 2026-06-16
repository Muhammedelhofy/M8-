# Build-43 Option C Spec — Second Problem Domain (prove the engine generalizes)

**Status:** SPEC — proceeding with the recommended problem (Lychrel / reverse-and-add) unless Muhammad
vetoes. Roadmap rung 4 of 4 (D→B→A→C, all four built one at a time). Written Session-38 (Opus),
2026-06-16. This is the LAST breadth rung; per the depth-over-breadth doctrine we stop adding domains
after this and return to making the engine smarter.

## The point of Option C
Today the whole research engine (M1 census + M3 generator + falsifier) only knows ONE problem: Collatz.
"Does it generalize, or is it a one-trick Collatz machine?" is answered by porting the SAME machinery to
ONE more open problem. Two clean data points = "yes, the engine is general." No new engine *power* — this
is breadth — but it's a real milestone and it lands a second, vortex/number-pattern-adjacent target
Muhammad cares about.

## Recommended problem: the reverse-and-add / Lychrel ("196") problem
**Why this one (vs an additive-NT conjecture):**
- **Digit/number-pattern flavour** — aligned with his vortex / number-pattern / "unforbidden-knowledge"
  steer. The map is literally about a number's DIGITS.
- **Structurally a twin of Collatz** — iterate a simple deterministic map, ask a long-term-behaviour /
  reachability question. So M1 (census of an iterated map) and M3 (template conjectures over census
  features, deterministically falsified) port with MINIMAL new machinery — the cheapest real port.
- **Genuinely open** — whether 196 (and other "Lychrel candidates") ever reaches a palindrome is
  UNSOLVED. Perfect honesty target: we can only ever say "observed: reached a palindrome in k steps for
  n ≤ N" or "no palindrome within K steps (suspected Lychrel, OPEN)", never "proven".

**The map.** `R(n) = n + reverse_digits(n)`. Iterate R. `n` is a *palindrome-reacher* if some iterate
is a base-10 palindrome; a *Lychrel candidate* if it isn't within a step cap K. (196 is the smallest
suspected Lychrel — open.)

**Big-number note:** iterates grow fast (196 explodes past 10^80 in a few hundred steps), so the
iteration MUST use JS `BigInt` for the value and string ops for reverse/palindrome — no Number, no
float. The census is deterministic, sync, CPU-only (like collatz-probes.js).

## Smallest useful slice (v1)
1. **`lib/lychrel-probes.js` (M1 analog)** — deterministic census over n ∈ [1..N] (default N=10,000,
   hard-capped), step cap K (default 500):
   - per-n: `steps_to_palindrome` (or `null` if unresolved within K), terminal status
     (`reached` / `unresolved`).
   - census features (all OBSERVED/empirical, NEVER proven): distribution of steps-to-palindrome;
     fraction reaching a palindrome within K; max steps observed (+ which n); the set of UNRESOLVED
     seeds within [1..N] (the suspected-Lychrel list — narrated as "suspected, OPEN", never "is Lychrel").
   - PURE core (reverse / isPalindrome / oneStep / stepsToPalindrome) mirror-tested.
2. **M3 generator port** — reuse `lib/conjecture-gen.js`'s pattern: template conjectures over the census
   features, each **deterministically falsified over the full TEST range** by the existing falsifier
   discipline. Example templates (closed, code-checkable):
   - "every n < B reaches a palindrome within S steps" (falsified by the first unresolved/over-S n).
   - "no n < B with <digit-count d> exceeds S steps" etc.
   Survivors persist as MACHINE-GENERATED, tested-to-N, **still OPEN** notes — down-ranked if trivial.
   Reuse the gate/novelty machinery as-is; if a clean port needs a tiny domain hook, add it, don't fork.
3. **Orchestrator hard-route** — `detectLychrelCensus` ("census the reverse-and-add problem", "run the
   digit-reversal engine", "reverse-and-add up to N"), non-streamable, fails SAFE, deterministic packet
   the LLM narrates (code computes truth — same doctrine as Collatz M1).

## Honesty invariants (non-negotiable, inherited)
- NEVER "196 is Lychrel" (unproven/open) and NEVER "all numbers reach a palindrome" (open). Only
  "observed: reached a palindrome in k steps for n ≤ N" or "no palindrome within K steps for n ≤ N —
  suspected Lychrel, OPEN".
- Survivors are "machine-generated, tested to N, still open" — never proven. Lean is still the only path
  to `proven`; this domain mints conjecture/empirical nodes only.
- Census order / down-ranking is a triage heuristic, never a truth/quality verdict (no quality scalar).
- Code computes; the LLM only narrates the precomputed packet.

## Offline proof (PS-mirror, no Node)
`tests/lychrel-verify.ps1` — mirror reverse/isPalindrome/oneStep/stepsToPalindrome with **`[bigint]`**
(System.Numerics.BigInteger) in PowerShell; assert: known reachers (e.g. 56 → 121 in 1 step, 59 → 1111
in 3 steps) match published step counts; 196 stays UNRESOLVED within K (suspected Lychrel) and is
narrated OPEN, never "is Lychrel"; the census fractions/max are deterministic; a planted-false template
("every n<B within S steps") is killed with the first counterexample. Pure ASCII, flat loops.

## Why it's still SMALL
One new census lib (a structural twin of collatz-probes.js) + a thin generator port reusing the
existing falsifier/gate + one detection route. No new infra, no new proof machinery, no autonomy, free
stack. Ship the usual way: code → offline PS-mirror → confirm deploy via `/api/health` → live-check
with Muhammad's OK.

## Recommendation in one line
Build **Lychrel / reverse-and-add** as the 2nd domain — digit-pattern-aligned, structurally a Collatz
twin (cheapest port), genuinely open (clean honesty story). Then STOP adding domains (depth-over-breadth).
