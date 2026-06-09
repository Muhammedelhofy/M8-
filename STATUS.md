# M8 — STATUS (the one living page)
*The single source of truth for "where are we." Updated every session. If this disagrees with a chat or memory, THIS wins. Last updated: 2026-06-09 (L4 Build-2 shipped).*

---

## CURRENT RUNG
**L3 Proactive Operator (~85%) → climbing to L4.**
L1 ✅ · L2 ✅ (solid) · **L3 🟢 ~85%** · L4 🟡 ~15% · L5 ⚪ ~5%

## ACTIVE LANE
**Verified Tool Orchestration (= L4 "Mastermind").**
M8 decides what truth-source it needs → invokes it → verifies → narrates ONLY verified output. Code execution is tool #1; fleet / search / calendar / Lean are all tools on the same orchestrator. (Reframed from "Code-Exec L4" per GPT, 2026-06-09 — kills the breadth-vs-depth split: everything is a tool on one spine.)

## DONE (live + verified)
- ✓ Deterministic fleet spine — matches the dashboard to the decimal (L2/L3 truth-source)
- ✓ Honesty/grounding brain — boundary rule, data-integrity, like-for-like, **causal/false-certainty guard**
- ✓ Fleet L3 layer — auto-brief, driver-churn, tier-slip, cash-collection, false-consensus gate
- ✓ Memory — cross-session recall + fact supersession + rolling summaries
- ✓ Eval harness — 30 probes, ~4.5/5 baseline, no-node PowerShell runner
- ✓ Streaming SSE + sentence-buffered TTS (additive, fallback-safe)
- ✓ Socratic tutor — **sticky sessions** (stays Socratic across turns)
- ✓ `compute:` seed — Gemini-native code execution, gated OFF the fleet packet (17! / 2^1000 digit-sum / π(100000) verified live)

## NEXT (L4 build order)
- ☑ **THIS page** (done)
- ☑ **L4 output contract** (Build-2, DONE + live-verified) — `VERIFIED_OUTPUT_CONTRACT` in orchestrator.js, scoped to the compute lane only (NOT tutor/fleet). Compute replies now carry result + executed-not-estimated + calibrated confidence (deterministic = implicit-high; stochastic = flagged-as-estimate), narration ≤ evidence. Also fixed at the extractor (llm.js): stripped Gemini code-exec phantom `[N]` citations + dropped the leaked "thought" planning part. Probes: reason.compute_contract (7^13) + reason.compute_confidence (Monte-Carlo pi), both 100%.
- □ **Auto-route compute** (Build-3, NEXT) — drop the `compute:` prefix requirement (intent detects when code is needed)
- □ **Tool Decision Layer** (Build-4) — orchestrator picks WHICH tool; deterministic tools stay responsible for WHAT IS TRUE (hybrid, no regex rip-out); lift the contract to all tools
- □ **L4 eval probes** (Build-5) — score: tool-selected · verification-present · confidence-calibrated · **narration ≤ evidence** (the key one)

## OPEN FORKS — now decided (team consensus 2026-06-09)
- **A. Where code runs** → ✅ **Gemini-native NOW**, Cloud Run later (move only when persistent files / custom libs / long jobs / repeated sims / Lean force it)
- **B. Tool-calling timing** → ✅ **Hybrid** — add a tool-decision layer inside the orchestrator; keep deterministic gates; NO full migration
- **C. Output contract** → ✅ result/verification/confidence/sources; **the load-bearing eval = narration must not exceed evidence** (GPT)
- **D. Math surface** → ✅ **computational discovery** (Collatz/Goldbach/twin-prime/OEIS pattern → conjecture → verify → formalize), NOT "solve Riemann"

## GUARDRAILS (never bend)
- **Deterministic-first** — code/tools find the truth; the LLM only narrates a verified packet. This is the moat, not a feature.
- **Honesty layer is load-bearing at every rung** — a fabricated answer at L5 is worse than no answer at L1.
- **Breadth and depth are NOT competing tracks** — calendar, email, search, fleet, code-exec, Lean are all tools on one orchestrator. The moment they feel like separate projects, fog returns.
- **Vercel Hobby: 12-fn cap** (at 6) — tool-calling loops in-process inside `/api/chat`, not new endpoints.

## REAL OPEN MISSES (non-blocking, L2 polish — do NOT make these the main thrust)
- `honesty.capability_limit` — "no live feed" phrasing slightly soft
- `silentfail.net_vs_profit` — doesn't always flag net ≠ full profit
- Reasoning-axis eval noise under throttle → an OpenAI paid-key fallback backstop would end it

---
*Repo: Muhammedelhofy/M8- · Live: m8-alpha.vercel.app · origin/main updated each session.*
