# M8 Team Round — Routing V2 Rollout (red-team, 2026-06-25)

**For:** GPT · Grok · Gemini · Manus. **From:** Muhammad + Claude Code.
**This is NOT an architecture round** — the architecture was settled in the last round
(`TEAM_ROUND_ROUTING_2026-06-25_RESPONSES.md`: tiered cascade, deterministic fast-path +
free-LLM-on-contest arbiter, shadow-first, capability registry). **Red-team the ROLLOUT** and
settle ONE open question (embeddings). Keep answers tight + ranked.

## What already shipped (live on prod, his phone-confirmed)
- **B-152**: a wallet⇄fleet "front-door arbiter" (`lib/domain-arbiter.js`) — deterministic
  ownership scoring + a free-LLM tie-breaker ONLY on a true contest; toss-ups ASK; most-recent
  turn wins for bare anaphora. Default-safe (kill switch ⇒ old behaviour). Decisions log
  (redacted) to `m8_router_misses`.
- **B-153/154**: single-currency wallet view + two live-caught follow-up fixes.

## The plan now (full detail in `ROUTING_V2_PLAN.md`)
Extend that arbiter from wallet⇄fleet to **ALL domains** (wallet, fleet, finance, tasks, notes,
memory, docs, knowledge/RAG, web, chat) via a `CAPABILITY_REGISTRY` (one source of truth). Roll
out: **B-155 shadow** (classify all domains, log vs the live decision, ZERO behavior change, ~3–5
days of his real traffic) → flip **per boundary, lowest-risk first**: B-156 lookup
(memory⇄web⇄knowledge⇄chat), B-157 CRUD (tasks⇄notes⇄wallet⇄fleet), B-158 docs⇄finance⇄fleet.
Each flip kill-switched + gated on shadow agreement + a live phone test. **Free stack only**
(Groq/Gemini classifier; optional Gemini free embeddings + Supabase pgvector). Single central
file (`orchestrator.js`) ⇒ sequential, not parallel.

## Hard constraints
Free-LLM default (premium OFF). Privacy wall absolute (money/financial DATA never enters any LLM
prompt/log — only the message + masked digits). Vercel **12-function cap is FULL** — no new
`api/*.js`. Confirm-before-write (model proposes, gated code disposes). Node ABSENT on host →
every build = a PS-5.1 mirror + a live phone test. Must NOT regress the ~170 working paths.

## Questions (rank + one-line rationale each; name the single biggest risk)
1. **Rollout order / regression safety.** Is *shadow → per-boundary flip, lookup-first* the
   safest way to change the central router without breaking the 170? Is any boundary mis-ordered
   (e.g. should CRUD flip before lookup)? What's the agreement-bar to trust a shadow flip for a
   ONE-USER app (no big sample)?
2. **Embeddings — worth it on a free stack, or does the broadened LLM classifier suffice?**
   When exactly does pgvector + free Gemini embeddings earn its keep vs add maintenance? If yes,
   how few seed examples per domain are enough?
3. **Capability registry granularity.** Coarse actions (read/add/edit/delete/convert/generate/
   recall/search) vs finer — to avoid BOTH capability drift (GPT) AND free-model attention
   degradation / schema bloat (Gemini). Where's the line?
4. **Shadow telemetry.** What should we log per turn (beyond existing_route/classifier_route/
   agree/confidence) to actually DECIDE flips + whether embeddings are needed — without logging
   anything that touches the privacy wall?
5. **What are we getting wrong?** Anything in the plan that's a trap for a solo-dev, free-tier,
   single-central-file, must-not-regress context.

Return: a ranked take per question + the single biggest regression risk you see.
