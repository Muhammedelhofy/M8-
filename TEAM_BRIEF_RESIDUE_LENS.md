# Team Brief — "Residue Lens" (digital-root / mod-9 analysis for M8's math engine)

**For:** the AI Council (GPT · Gemini · Grok · Manus)
**From:** Muhammad + Claude Code
**Decision wanted:** go / modify / kill on a proposed **5-build arc**, before any code is written.
**Date:** 2026-06-21

---

## 0. TL;DR
We're considering teaching M8's nightly math engine to see the **digital-root / mod-9 structure** of the Collatz and Lychrel numbers it already computes — the real arithmetic under "vortex math" (the 1·2·4·8·7·5 doubling cycle is just the units mod 9; 3·6·9 are the multiples of 3). It's a 5-build arc, mostly branch-only. **We want you to pressure-test whether this is worth doing at all**, not help us do it.

## 1. Context you need to judge it fairly
- **M8 is PARKED.** Muhammad made a settled "keep-or-kill → hybrid" call: no new M8 *product* features; only the headless parts keep running (the nightly Collatz/Lychrel/Lean engine as a free sidecar, plus a 7 AM fleet brief) until he exits the Bolt job (~July 2026).
- **His #1 priority is landing a market-rate job.** M8 was deliberately de-prioritised to protect that.
- **The math engine is the one designated "safe sandbox"** and the one piece meant to keep evolving for free. This proposal lives entirely inside it.
- **Doctrine: depth over breadth.** A prior decision said: stop adding new problem domains, deepen the ones we have.
- **Honesty is M8's core identity** — hard bans on overclaiming, no machine-minted "theorems," speculative content is labelled. Any "vortex"-adjacent work must not leak numerology into M8's outputs.
- **Infra constraint:** the Vercel deploy was just refactored from 30 → 10 serverless functions (Hobby plan caps at 12). Two slots of headroom. New work should avoid adding API functions.

## 2. The proposal (what we'd build)
| # | Build | Adds | Touches live? |
|---|---|---|---|
| RL1 | Digital-root core + Collatz instrumentation | `lib/digital-root.js`; residue summary on each Collatz trajectory | no |
| RL2 | Lychrel residue lens | digital-root invariants across reverse-and-add | no |
| RL3 | Residue records & stats | "do Collatz records cluster in certain mod-9 classes?" + an `m8_*` stats table | migration only |
| RL4 | Nightly wiring + graph write | engine records residue findings into its own knowledge graph → M8 becomes "aware" of the structure | **yes (live nightly loop)** |
| RL5 | Vortex dashboard + chat surface | live visual on real engine data; chat can answer residue questions | dashboard: no · chat: yes |

After it, M8 could (it can't today): record mod-9 structure of every trajectory; answer "do records cluster mod 9?" with real numbers; reason about the vortex in chat; show a live dashboard; seed residue-pattern conjectures into its existing conjecture engine.

## 3. The honest case FOR
1. It's the **only lane consistent with "parked"** — the math sidecar evolving for free, no product scope-creep.
2. It's **genuine depth** on existing domains (residue classes mod 9 are legitimate number theory), not a new domain.
3. **Low risk:** 3 of 5 builds are branch-only / zero deploy.
4. It **connects a real curiosity to the engine** and finally puts the topic into M8's graph.
5. Cheap, fun, high learning-per-hour.

## 4. The honest case AGAINST (please weight this hard)
1. **Opportunity cost.** 5 sessions is real time. His #1 is a job, not Collatz. Is this defensible, or should it be capped at 1–2 builds?
2. **Mathematical substance.** Is mod-9 structure of Collatz a *real* lever for an unsolved-problem engine, or largely already understood / a dead end dressed up as discovery? Where, specifically, could it yield something novel vs where is it just descriptive statistics?
3. **Depth or detour?** Is a "residue lens" actual depth on Collatz, or a new analytical sidetrack (breadth in disguise) that violates the doctrine it claims to honour?
4. **Honesty exposure.** "Vortex" branding is numerology. What guardrail would you *insist* on so M8 never emits a mod-9 claim with more confidence than the evidence supports?

## 5. Claude's prior (named, so you can discount it)
I (Claude) proposed this. My bias: it's the cleanest fun-but-aligned use of the sandbox, and I find the math genuinely pretty. **Where I could be wrong:** I may be over-rating "pretty + adjacent to a curiosity" over "advances something that matters," and 5 builds may be 3 too many. I'd rather you kill or shrink it than endorse it to be agreeable.

## 6. Questions for your verdict
1. **Go / modify / kill** — one word, then why.
2. If go: **how many builds** (1, 2, or 5)? What's the minimum that delivers real value?
3. Is there a **sharper adjacent target** than Collatz-mod-9 (a different modulus, a Lean-verifiable residue lemma, a tie to the conjecture engine) that would make this *advance the frontier* rather than just visualise it?
4. The **one honesty guardrail** you'd require before any of this ships.
5. Given M8 is parked and a job hunt is #1: **is this the right thing to spend a sandbox session on at all**, or is there a better free-sidecar improvement?
