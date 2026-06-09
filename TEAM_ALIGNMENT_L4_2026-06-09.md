# M8 — Lane Decision & Alignment Check: Code-Exec L4 (2026-06-09)
*From Muhammad. Paste to GPT / Grok / Gemini — and to M8 itself. I felt the project drifting and the team pulling in different directions, so I'm re-anchoring everyone on ONE lane before we build. I want two things from each of you: (1) a gut-check on the decision below, and (2) answers to the open forks. Push back hard if I'm wrong — but ground it in our constraints (single-user, Vercel Hobby 12-fn cap, deterministic-first honesty that never bends).*

---

## ⇒ READ THIS FIRST — the one question I need answered
Before any building: **do we have enough structure, visibility, and alignment to commit to this lane — or do we need more?** Specifically:
1. Is **Code-Exec L4** the right next lane (see §2), or am I underrating a different rung?
2. Do we need **better project visibility** so this fog doesn't recur (a single always-current status page / roadmap), and if so, what's the lightest version?
3. Does anyone need **another opinion, more structure, or a different framing** before we move?

Answer those three first. Then the forks in §4.

---

## 1. Where we actually are (honest, no changelog)
M8 climbs ONE ladder — fleet, Jarvis, and the math North Star are rungs, not competing directions:

| Rung | Meaning | Status |
|---|---|---|
| **L1** Reactive chatbot | answers from training | ✅ 100% |
| **L2** Grounded assistant | data-truth + memory + honesty + playbooks | ✅ 100% — solidly here |
| **L3** Proactive operator | M8 *manages*: briefs, churn, tier-slip, cash | 🟢 ~85% (all live; rider-risk ruled infeasible, not a gap) |
| **L4** Mastermind / code-exec | computation-truth layer + tool-orchestration | 🟡 ~15% — `compute:` seed is LIVE, the real layer isn't built |
| **L5** Autonomous math exploration | hypothesis→verify (Lean) loops | ⚪ ~5% — the horizon |

**The fog, named honestly:** our written plan said "Phase 1 = Jarvis breadth (calendar/email/search)." But the last ~4 sessions actually went *depth* — code-exec seed, eval harness, Socratic tutor, honesty guards. All solid, but we've been polishing a brain already at ~4.5/5 (diminishing returns) while the team kept answering breadth + math questions. **Nobody was wrong; we just never re-picked the fork out loud.** This brief re-picks it.

## 2. The decision (my call — convince me or confirm)
**Commit the next lane to Code-Exec L4 — the computation-truth layer.** Reasons:
- It's the **most North-Star-aligned** rung (L4 is the direct step toward L5 math exploration).
- It **serves the fleet too** — ad-hoc what-if math / simulations on the real blob (the "every phase serves the fleet" guardrail holds).
- We already have a **live seed**: `compute:` mode (Gemini-native code execution, gated OFF the deterministic fleet packet, zero infra). Project-Euler #16 / 17! / π(100000) all verified live. We're upgrading something that works, not starting cold.
- Deferring breadth (calendar/email) is fine — those are connections, lower strategic weight than the truth-engine.

**What L4 means concretely (the "Mastermind" discipline):** M8 = the decision engine; tools (Python sandbox / Supabase / search) = truth; the LLM only narrates a verified packet; output carries explicit **verification + confidence + sources**. Code execution is the spine of that — deterministic-first, honesty never bends.

## 3. What's already done vs. what L4 needs
- **DONE (live):** `compute:` on-demand mode (Gemini-native), the deterministic fleet spine as a sealed truth-source, the honesty/grounding brain, an eval harness (~4.5/5) that can score L4 work.
- **NOT built (the L4 gap):** code-exec that's *routed automatically* (not just a `compute:` prefix); a decision on **where heavy/persistent code runs** (Gemini-native vs. external sandbox); a structured **verification/confidence/source output contract**; whether tool *selection* migrates to LLM tool-calling now or later.

## 4. The open forks (need your input)
**A — Where does code execution run?** (Gemini's lane)
Gemini-native code-exec (zero infra, already live, but Gemini-only + sandbox-limited) vs. a small external **Cloud Run** Python sandbox ($300 credit, more control/persistence/libraries, but a new service + latency + token storage). Recommend the pragmatic path given Vercel can't host a persistent sandbox and we're at 6/12 functions.

**B — Spine now, or modes-alongside?** (GPT's lane)
Do we migrate routing from regex gates → **LLM tool-calling** as part of L4 (bigger, but the eventual Jarvis enabler), or keep adding deterministic modes alongside the existing router for now (Claude's earlier call: "don't do the full rip-out for only ~3 tools")? Which sequencing protects the honesty guarantees and the 12-fn cap?

**C — What's the output contract?** (GPT/Grok)
Minimal, *useful* verification+confidence+source format that's not theatre — what should an L4 answer actually carry, and how do we eval it?

**D — Realistic math surface?** (Grok's lane)
2026 state of AI-assisted math (AlphaProof, Lean community): for a solo builder, what's the tractable *computational-search* contribution surface — which smaller open problems / patterns are worth M8's first real exploration loop?

## 5. Two-line ask to each of you
- **One thing to PROTECT, one thing to KILL** in this lane.
- **Your honest confidence (0–10)** that Code-Exec L4 is the right next move, and what would raise it.

*(M8: answer §0's three questions about yourself + fork C honestly — where are your real gaps for an L4 truth-layer, and do you have the structure to know when a computed result should override your own narration?)*
