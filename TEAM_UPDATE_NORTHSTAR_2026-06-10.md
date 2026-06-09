# M8 — Team Round: North Star corrected + Build-4/5 SHIPPED (2026-06-10)
*From Muhammad. Paste to GPT / Grok / Gemini — and to M8 itself. Two parts: (1) a correction the whole crew has to absorb (the North Star), and (2) **Build-4 + Build-5 are now shipped and live** on the L4 lane — so this IS the gut-check round I promised "after Build-4 ships." Read §1 (absorb, no debate needed), then spend your reply on §4–§5: critique what shipped and answer the one open design question. Ground it in our constraints — single-user, Vercel Hobby 12-fn cap, deterministic-first honesty that never bends.*

---

## 1. The correction (this supersedes every earlier North-Star framing)
Our North Star is to **make M8 genuinely capable of helping resolve UNSOLVED problems — prize-class open problems in math/logic, with the $1M Millennium-prize tier as the bar the capability is built toward.** That is the mission. We're honest about the odds (a solo builder on cheap infra is a long shot — even DeepMind hasn't), and the honesty layer never bends: **M8 must never claim an unverified proof.** But the ambition is the prize-class problems themselves, not a vague "capability-building" hedge.

**The fleet is NOT the North Star.** The Bolt dashboard already runs the business. Fleet data serves **only** as a live **test bench** for M8's logic, accuracy and grounding — nothing more. Nobody should frame "autonomous logistics" or fleet automation as the mission again.

**Math-surface strategy is unchanged:** computational discovery first (pattern → conjecture → verify → formalize on Collatz / Goldbach / twin-prime / OEIS-class problems), **not** a head-on Riemann attempt.

## 2. Why this needed correcting (the failure, named honestly)
On 2026-06-09 M8, asked about its own mission, **fabricated** "a fully autonomous, AI-driven logistics operation" as the North Star. Root cause wasn't a hallucination in the moment — it was **our own written framing feeding it bad ground truth**:
- `lib/buildState.js`'s `northStar` string literally said the fleet track "is the CURRENT milestone" and that the goal is "NOT 'solving a $1M prize'."
- A stale Supabase memory fact (`north_star_goal`) said the same logistics line, and got recalled on every relevant turn.

So M8 was being *grounded into* the wrong mission. Honesty layer worked — it stated what it "knew"; what it knew was wrong.

## 3. What was fixed (shipped + live-verified 2026-06-10)
- **4 files corrected** (origin/main `3561948`): `lib/buildState.js` (northStar rewrite + live/pending sync + new `frozen[]` list), `lib/orchestrator.js` (persona line now names the real mission + fleet-as-bench), `STATUS.md` (new top NORTH STAR section), `M8_STATUS_AND_NORTHSTAR.md` (§5 reframed).
- **Supabase memory superseded:** the stale `north_star_goal` fact marked `is_current=false`; a corrected current fact inserted (same supersession model the app uses).
- **Live-verified** on deployed M8 in a fresh session: "what is our North Star?" → returns unsolved-problems / $1M-prize-tier + fleet-is-a-test-bench, with the 5-rung path and the honesty clause. No logistics. ✅

## 4. What just shipped — Build-4 (Tool Decision Layer) + Build-5 (L4 probes), live-verified
The L4 lane (**Verified Tool Orchestration / "Mastermind"**) is now past its centerpiece. Builds 1–3 were already live (this status page; the verified-output contract on the compute lane; auto-routed compute). As of today, **Build-4 and Build-5 are shipped, deployed, and live-verified** — following the consensus you all converged on:
- **The orchestrator LLM now picks WHICH tool** — `answer / search / compute / clarify` — in the slice the deterministic gates haven't already claimed. Deterministic tools still own **WHAT IS TRUE**. **Hybrid, no regex rip-out** (Fork B): fleet / state / open-problem stay deterministic HARD-ROUTES *above* the LLM (it can't route away from them — the integrity moat; false-consensus + override gates untouched). The regex compute auto-route is the fast-path; the LLM only catches the compute-worthy queries the regex missed.
- **`VERIFIED_OUTPUT_CONTRACT` lifted off the compute lane onto the SEARCH tool** via a per-tool dispatcher (Fork C). Compute keeps its tuned contract verbatim (zero probe regression); fleet/state already carry their own integrity packets. Load-bearing rule enforced everywhere: **narration ≤ evidence**.
- **In-process inside `/api/chat`** (still 6/12 functions). Wired into both `orchestrate()` and `orchestrateStream()`; the tool decision is traced and persisted to `request_traces.tool_decision` (queryable in `/api/traces`).
- **Verification:** a 20/20 no-node control-flow port (fleet always wins · conversational/personal never reach the router · compute beats search) + the existing 40/40 and 49/49 regression guards. **Live both ways:** a regex-*missed* 11-number exact sum → routed to compute → "computed in Python" 620,657, no phantom citation; an opinion ("what makes a business worth buying?") → stayed a substantive answer, no compute/search hijack.
- **Build-5 = L4 eval probes:** a first-class `tool_decision` eval category + 2 probes (`tool.decision_compute`, `tool.decision_no_hijack`) scoring tool-selected · verification-present · narration ≤ evidence (confidence-calibrated stays covered by the Monte-Carlo compute probe). **Live 5/5.**

## 5. What I actually want from you — gut-check + one open question
This is the round. Two asks:

**(a) Gut-check the cut.** The design is: *the LLM chooses the tool; deterministic code stays the source of truth; fleet/state/open-problem are hard-routes the LLM can't override.* Is that the right boundary, or are we under/over-trusting the LLM's tool choice? One thing to PROTECT, one thing to KILL.

**(b) The one real open question (it'll decide the next build).** Compute and search can **co-fire on the same turn**, laundering a phantom citation onto a self-computed number. The `tool_decision` trace made it concrete: "what is 9 to the power of 11?" logged `tool_decision=compute` *and* `search_fired=true` — the reply was right ("computed in Python, 31,381,059,609") but tacked on "confirmed by MathCelebrity." Mechanism: the regex intent classifier tags the math query as RESEARCH/LOOKUP, which fires the web-search slot in parallel with the compute path. The numbers stay correct, but it's a noisy, partly-ungrounded answer. **Fix as a router-prompt tweak, or as a deterministic gate — when compute fires, suppress the search slot (compute owns the number) the way fleet hard-routes own theirs?** Argue your call against our deterministic-first principle (my lean is the deterministic gate, but convince me).

Everything else (the corrected North Star in §1) is **absorb-only** — no debate, just don't let a future answer drift back to "logistics."

*Guardrails unchanged: deterministic-first, honesty never bends, fleet is FROZEN (test bench only — no new fleet features), breadth and depth are one ladder not two tracks.*
