# M8 — Team Alignment Brief & Vision Request (2026-06-09)
*From Muhammad. Paste this to GPT / Grok / Gemini / Manus. Two things I want from each of you: (1) your **VISION for what's next** — where should M8 go, what am I missing, what would you do differently; and (2) concrete answers to the lane questions below. Be honest and challenge the plan if you see a better path — but ground it in the constraints (single-user, Vercel Hobby, deterministic-first honesty).*

## ⇒ YOUR TASK (read this first)
1. **Your vision:** Given where M8 is (a hardened fleet/honesty brain, now pivoting to a multi-tool Jarvis), what's the smartest next 1–3 months? What's the highest-leverage capability I'm underrating? What would *you* build first, and why? Push back if the sequence below is wrong.
2. **Your lane questions:** answer the ones tagged to you, and rank the Phase-1 tools by ROI.
3. **One thing to protect, one thing to kill:** name the single thing we must NOT lose, and the single thing we're wasting effort on.

## The decision so far (my current call — convince me if you disagree)
We were over-investing in the **Bolt-dashboard ↔ M8 fleet plumbing** and drifting from the real goal. My approved **v2 PRD** is explicit: *M8 is a Jarvis-style personal agent; Bolt fleet is ONE tool of many.* So:

- **Fleet = FROZEN.** The deterministic fleet spine is done and live-verified (matches the dashboard to the decimal; auto-brief, churn, tier-slip, cash, and a false-consensus integrity gate all shipped). Rider-risk was ruled **infeasible** (our data blob is 100% driver-aggregated — no rider entity exists). Bugs only from here.
- **The two North Stars are now ONE.** Jarvis breadth (calendar/email/search/voice/mobile) and the hard-problem exploration system (code-exec → Lean → open math) are **two tool-families on one spine** — deterministic-first tool-orchestration where tools find truth and the LLM only explains, honesty layer never bends.
- **Build sequence:** **(1) Jarvis breadth now → (2) code-exec North Star (L4) → (3) mobile + voice polish.**

## Where we stand (facts)
- **Stack:** Node on Vercel (Hobby, **12-serverless-function cap**, currently ~5) + Supabase. Frontend → `POST /api/chat` → `lib/orchestrator.js` → multi-LLM chain (Gemini paid tier active). Heavy logic lives in `lib/` (free); `api/` = endpoints only.
- **Brain (strong):** decisive/honest persona (separates "fact:" from "my read:"), knowledge-decision router, clarification gate, 9 domain playbooks, cross-session memory, request tracing, an eval/red-team harness (~4.5/5 baseline).
- **The architectural catch:** the fleet tool was built as **bespoke deterministic regex gates**. Beautiful for one tool, but adding 8 more PRD tools that way = 8× the effort. The PRD already anticipates the fix: **LLM tool-calling** (Gemini picks the tool). Invest once in a tool-calling spine → all 9 tools get cheap. Fleet stays deterministic *inside* its own tool; only tool *selection* becomes LLM-driven.

## Questions (answer the ones in your lane; rank by ROI for a fleet operator who also wants the math North Star)

**Gemini (stack / architecture):**
1. Migrating tool *selection* from regex gates → **Gemini function-calling** within the Vercel/Hobby constraints (12-fn cap, 30s maxDuration, stateless): recommended pattern? One `/api/chat` that loops tool-calls in-process, or a thin dispatcher? How do we keep the deterministic fleet spine as a callable tool unchanged?
2. **Google Calendar + Gmail** as M8 tools: OAuth flow for a single-user agent on Vercel — where do tokens live (Supabase), refresh handling, least-privilege scopes?

**GPT (architecture / discipline):**
3. How do we adopt tool-calling **without losing the honesty/grounding guarantees** we hard-won (no fabrication, "fact vs read", verification contract)? Where does the deterministic-first rule live once the LLM is choosing tools?
4. Minimal Phase-1 scope that ships real daily value in ~2–3 builds without a half-built cathedral?

**Grok (data / UX / real-world):**
5. For a Riyadh ops manager: which **first action-tool** earns its keep fastest — calendar, email, or live web-search? Arabic/English voice realities on mobile (Web Speech API) — worth it now or defer to Phase 3?

**Manus (execution / sequencing):**
6. Concrete build order for Phase 1 (tool-calling spine → first tool → second tool), with the smallest safe migration that keeps `/api/chat` live the whole time.

**All:** Rank the Phase-1 tools (calendar / email / search / voice / mobile-PWA) by ROI. Flag anything that risks the honesty layer or the 12-function cap.

---
## ⇒ Close with your VISION (the part I care most about)
In 3–5 lines: **where is M8 in 3 months if we do this right?** What's the one capability that turns it from "a smart fleet chatbot" into something I rely on every day? And if you think the whole Jarvis-breadth pivot is wrong, say so now and tell me what to build instead. Don't hedge — give me your real read.
