# Session — B-160 · FIX ASK-MY-DOCS RETRIEVAL (the door opens to an empty room)
**Model: Opus · Effort: MAX** (debug in the central orchestrator + knowledge layer)
**Branch:** `feat/b160-askmydocs-fix` off `origin/main`
**This file IS your kickoff prompt — self-contained. Read the files it names before editing.**

## STEP 0 — isolated worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/b160-askmydocs-fix ../../M8-b160 origin/main
```
`cd ../../M8-b160`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout.

## THE BUG (confirmed LIVE on prod 2026-06-29)
Every "ask my docs" query answers **"I don't have your CV / resume / books / notes loaded"** — even though the content is ingested. Confirmed it is NOT the provider outage: re-tested at 11:32 *after* providers recovered (weather/FX/fleet all worked again) and `"what does my CV say about my Careem experience"` STILL returned *"I don't have access to your personal CV or any ingested documents."* So it's a **wiring/retrieval bug**, deterministic.

## WHAT'S ALREADY VERIFIED — do NOT re-debug these
- **Routing is CORRECT.** Telemetry (`m8_router_misses`) shows these turns route to `lk:knowledge` / `reg:knowledge` at conf 0.90. **The router/registry is fine — do NOT touch `capability-registry.js` or the arbiter.** The bug is DOWNSTREAM of routing.
- **The content IS in the DB.** `m8_knowledge_sources` ids 34–39 (37 = CV, 38 = Bolt fleet, 39 = kafala); `m8_graph_nodes` = 44 career nodes, **all 44 embedded**. Keyword-findable via `ilike` on content/label: **careem=14, operations=11, kafala=3** nodes.
- **It's NOT RLS / not a missing key.** `knowledge-intake.js:getDb()` (line ~101) uses `SUPABASE_SERVICE_KEY`, which bypasses RLS — and that key works in prod (router-log writes succeeded *after* RLS was enabled on `m8_router_misses`).

## STRONGEST LEAD
Since the keyword fallback *would* match 14 "careem" nodes, `searchKnowledgeGraph()` itself should return content — so the bug is most likely the **orchestrator not calling it (or not injecting its result) for a knowledge-routed turn.** Trace these:
- `lib/orchestrator.js` ~line 4376: `kgContext = await searchKnowledgeGraph(effectiveMessage, 6)`. **Is that branch REACHED when the turn is routed to `knowledge` (the B-156 lookup flip, `lk:knowledge`)?** Or does the B-156 "force knowledge" path set a flag that nothing consumes? Is `kgContext` actually placed into the LLM prompt / answer-engine context?
- `lib/knowledge-intake.js:searchKnowledgeGraph()` (line ~1345): semantic (`match_kg_nodes` RPC, threshold 0.65, min 2 hits) → keyword `ilike` fallback. Confirm it returns non-null for "…Careem experience" (the keyword path on "careem" should hit 14 nodes; the stopword filter drops short/common words — make sure useful terms survive).
- The "I don't have it loaded" + `MISSED_SOURCE_NOTE` ("additional context may exist", `reflector.js:46`) strongly implies kgContext was empty/never injected when the answer was composed.

## THE FIX
Make a knowledge-routed turn actually (1) call `searchKnowledgeGraph`, (2) inject the returned nodes into the answer context, so M8 answers FROM the CV/notes and cites them. On a genuine no-match, it should say "not in your docs" — distinct from "not loaded".

## TEST
- Live (the real proof): `"what does my CV say about my Careem experience"` → cites CV content (source 37); `"tell me about my kafala operation"` → cites source 39.
- Add a PS-5.1 mirror for whatever deterministic logic you change (Node is ABSENT on host). You can exercise `searchKnowledgeGraph` against live Supabase via the existing API path if needed (the anon key is RLS-blocked on these tables — use the service-key path).

## Constraints
Privacy wall absolute · free-LLM default · Vercel **12-fn cap FULL** (no new `api/*.js`) · confirm-before-write · **no push to `main` without Muhammad's OK** · finish with `reports/build-160-done.json` → commit → push the BRANCH.

## After this (separate follow-ups, NOT this build — just so they're recorded)
- **Resilience:** the live test hit "all providers failed" — root causes: gemini+gemini2 are both Google (one outage = both down), groq `413 Request too large` (conversation-history bloat), cerebras/mistral in cooldown. Fix: trim the prompt/history before the LLM call (also helps this bug), add a non-Google independent fallback, ease cooldowns.
- **Memory fact:** "what do you know about Bolt" → "a Family Wallet member" (WRONG — Bolt is the fleet/company). Correct the stored fact.
- **Polish:** "how many drivers >4000" miscounted (15→13) mid-answer; "write me a report on fleet performance" didn't auto-pull fleet data (needed a re-ask).
