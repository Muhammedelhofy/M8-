# M8 — STATUS (the one living page)
*The single source of truth for "where are we." Updated every session. If this disagrees with a chat or memory, THIS wins. Last updated: 2026-06-10 (North-Star correction + L4 Build-4 Tool Decision Layer + Build-5 probes + Build-6 compute/search gate + ★ RESEARCH NOTEBOOK shipped [the L5 substrate — persistent research memory] — all routing/packet/no-fabrication live-verified; full persistence pending the user-run migration).*

---

## NORTH STAR (corrected 2026-06-10 — Muhammad's words, supersedes all earlier framings)
**Make M8 genuinely capable of helping resolve UNSOLVED problems — prize-class open problems in math/logic (the $1M Millennium-prize tier is the bar).**
- **The fleet is NOT the North Star.** The Bolt dashboard already runs the business. Fleet data = a live **test bench** for M8's logic, thinking and accuracy — nothing more. Never frame "autonomous logistics" as the mission (M8 fabricated exactly that on 2026-06-09; root cause was the old `buildState.js` northStar string saying the fleet track "is the CURRENT milestone" — fixed).
- Math-surface strategy unchanged (Fork D): computational discovery first, not "solve Riemann" head-on.
- Honesty never bends: **no unverified proof claim, ever** — at this North Star a fabricated proof is the worst possible failure.

## CURRENT RUNG
**L4 Verified Tool Orchestration — climbing (Tool Decision Layer live). L3 stays ~85% (fleet frozen at rider-risk).**
L1 ✅ · L2 ✅ (solid) · **L3 🟢 ~85%** · **L4 🟡 ~55%** (compute + auto-route + output contract + tool-decision layer + truth-ownership gate all live; traced) · **L5 ⚪ ~12%** (the persistent-research-memory SUBSTRATE — the Research Notebook — is shipped; exploration loops still ahead)

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
- ☑ **Auto-route compute** (Build-3, DONE + live-verified) — `COMPUTE_HEURISTIC` broadened with high-precision math patterns (powers/roots/`N% of`/unit-conversion/big-arithmetic). Genuine math fires without the `compute:` prefix; conversational/opinion/fleet/unitless text does NOT (40/40 port: 22 fire, 18 silent). Live: "what is 7 to the power of 13?" → auto-computed; "what do you think about hiring 20 drivers?" → stayed a data-grounded opinion, no hijack. Probe reason.compute_autoroute.
- ☑ **Tool Decision Layer** (Build-4, DONE + live-verified) — `decideAction` (router.js) gained a 4th tool: the orchestrator LLM now picks `answer | search | compute | clarify` in the slice the deterministic gates haven't claimed. Fleet/state/open-problem stay deterministic HARD-ROUTES above the LLM (the integrity moat — the LLM can't route away from them; false-consensus + override gates untouched). Hybrid: the regex compute auto-route is the fast-path; the LLM catches the compute-worthy queries it missed. Lifted `VERIFIED_OUTPUT_CONTRACT` off the compute lane onto the SEARCH tool via a per-tool dispatcher (`verifiedOutputContract(tool)`); compute keeps its tuned contract verbatim (zero probe regression); fleet/state already carry their own integrity packets. Tool decision traced in both `orchestrate()` + `orchestrateStream()` (console channel; idempotent `tool_decision` column shipped in the migration for the user to run, NOT wired into the insert yet). LIVE both ways: a regex-missed 11-number exact sum → routed to compute, "computed in Python" 620,657 no phantom citation; an opinion ("what makes a business worth buying") → stayed a substantive answer, no compute/search hijack.
- ☑ **L4 eval probes** (Build-5, DONE + live 5/5) — new first-class `tool_decision` category (weight 1.2) + 2 probes in BOTH probes.js (canonical) and run-eval-live.ps1 (PS port): `tool.decision_compute` (tool-selected + verification-present + narration≤evidence via no-phantom-citation) and `tool.decision_no_hijack` (the negative — an opinion must NOT be over-routed to a tool / fake a computation). confidence-calibrated stays covered by reason.compute_confidence. Port-verified offline (graders vs the real live replies + a faked-compute negative control) then live 5/5 via `-Only tool_decision`.
- ☑ **Tool decision persisted** (2026-06-10) — the idempotent `tool_decision` column was applied to request_traces and wired into `logTrace` (both orchestrate call sites) + surfaced in `/api/traces`. The tool-selection mix is now queryable for trend analysis.
- ☑ **Compute/search gate** (Build-6, DONE + live-verified — team-unanimous call GPT/Grok/Gemini/Manus/M8: deterministic gate, NOT a prompt tweak). `!computeMode` added to the regex SEARCH slot + clarification gate: when the self-contained-math fast-path fires, **compute owns the number and the web-search slot is suppressed** (one canonical source of truth per fact, like the fleet hard-route). Kills the co-fire that laundered phantom citations onto computed answers. Does NOT break the compound "search a live value THEN compute" case (its primary signal is search; the math regex doesn't match it). Port 27/27; new probe `tool.compute_no_search_cofire`. **LIVE before/after:** "9 to the power of 11?" — same `intent=RESEARCH`/`tool_decision=compute`, but `search_fired` flipped `true→false`, and the reply dropped "confirmed by MathCelebrity" → clean "computed in Python."
- ☑ **Research Notebook (persistent research memory)** — DONE (the L5 substrate; routing/packet/no-fabrication live-verified, full persistence pending the user-run migration). New `lib/notebook.js` + `migrations/research_notes.sql` (table `m8_research_notes`) extend the memory spine into a STRUCTURED research ledger: M8 logs entries to a line-of-inquiry **thread** — `conjecture · evidence(for|against) · counterexample · dead-end · status · next-step` — and reads back the current ledger of any thread ("where are we on the &lt;thread&gt; research", "what dead ends have we hit"). SAME contract as the fleet/state spine: **code owns the ledger, the LLM only narrates** — never invents a finding, never upgrades a conjecture into a proof. Supersession-aware (status/next-step keep one current row per thread; the rest accumulate; a dead-end is permanent). A notebook turn is a **HARD-ROUTE** (suppresses the LLM router, web search, compute, doc-gen) traced as `tool_decision='notebook'`; the WRITE persists **once** at STORE (staged on `notebookCtx.data.write`) so the buffered + streaming paths can't double-write. New eval category `research_notebook` (weight 1.2) + 2 hermetic probes (write-no-fabricate / read-honest-empty) in `probes.js` + the PS runner. Port-verified 36/36 (`tests/notebook-verify.ps1`). **⚠ USER ACTION: run `migrations/research_notes.sql` in Supabase (project ltqpoupferwituusxwal) to create the table — before that, writes acknowledge but don't persist and reads fall through; everything is non-fatal.** Known limitation (fast-follow): a read needs the `notebook:` prefix or a research keyword — "where are we on collatz" alone won't yet resolve a known thread (the known-thread inference is the next step, mirroring the driver registry).
- □ **Then** — (Phase 3) a MINIMAL Lean verification probe (M8 proposes → a checker accepts/rejects; formalize KNOWN theorems first, NOT "prove Riemann") · (Phase 4) computational-discovery loops (Collatz/Goldbach/OEIS to huge N — they now feed the notebook) · (Phase 5) long-horizon exploration. Notebook fast-follows: known-thread inference for reads; fuzzy topic→thread on writes; a notebook viewer. Other fast-follows: chained search→compute tool; fresh full 35-probe baseline (NOT back-to-back); calendar tool.

## STRATEGIC FRAME (2026-06-10 — the "what does it take / why us" discussion, all 5 crew + Claude)
**The honest cut: two piles, not one ladder.** (1) The **buildable harness** — computation, formal verification, research memory, orchestration — is *engineering*; M8 can be world-class at it on cheap infra. (2) The **discovery spark** — conjecture, creative reframing, *extrapolation* (inventing new frameworks) — is the real bottleneck that NO ONE has cracked, including the $1B labs (DeepMind AlphaProof, OpenAI o-series, the Lean community are all this exact lane). **M8 = a deterministic harness around a frontier model's spark** — it rides frontier models, it does not replace scale. We build the harness; the model supplies the spark. **Realistic contribution = smaller open problems + computational verification + being a genuine thinking instrument for Muhammad. $1M Millennium tier = the bar we build toward, NEVER the claim.** (Honesty check: M8 is NOT the first and Muhammad is NOT the only one — the edge is *deterministic-first + personal + persistent + compounding over years*, a lane the labs structurally won't build, not "first to the idea".)

## OPERATOR ASSISTANT (breadth — runs ON THE SAME SPINE, not a separate track)
Muhammad relies on M8 as his honest day-to-day work partner, and this is NOT a drift from the North Star — it is the SAME deterministic-honesty + verified-compute + memory muscle, pointed at his work. Keep these in mind on every build:
- **Honest professional assistant** — presentations/decks + documents (docgen exists → extend to slide/deck output), real-life scenario reasoning, decisions — always grounded, "fact: vs my read", narration ≤ evidence.
- **Financial models + tracking** — built on the VERIFIED-compute lane (numbers are executed, not estimated), not hand-wavy. This is on-mission: it exercises the exact verification muscle the North Star needs.
- **Legal / regulatory awareness** — KSA labour / commercial / 3PL context: inform and lay out the picture, but HOLD the escalation rule (binding contracts / liability / filing specifics → a qualified professional). Never fake legal certainty.
- **Multi-company adaptability** — today Bolt 3PL; tomorrow Thrivve.sa / Noon / others. Keep the data/test-bench layer ADAPTABLE (don't hard-lock to Bolt's blob shape) so M8 follows Muhammad across platforms. The fleet stays a *test bench*, but the assistant must travel.

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
