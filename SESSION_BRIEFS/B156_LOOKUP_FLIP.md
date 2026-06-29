# Parallel Session — B-156 · FLIP THE LOOKUP BOUNDARY (router core)
**Model: Opus · Effort: MAX** (first real behavior change; central file; must-not-regress)
**Branch:** `feat/b156-lookup-flip` off `origin/main`
**This file IS your kickoff prompt — self-contained. Read the files it names before editing.**

---

## STEP 0 — create your ISOLATED worktree FIRST (mandatory; do not skip)
Parallel sessions in the SAME folder share one git HEAD and **clobber each other**. Run in your OWN
`git worktree`. From the `M8` repo, before anything else:
```bash
git fetch origin
git worktree add -b feat/b156-lookup-flip ../../M8-b156 origin/main
```
Then `cd ../../M8-b156` and do ALL work there. Verify `git rev-parse --abbrev-ref HEAD` = `feat/b156-lookup-flip`.
NEVER work in the shared `Bolt/M8` checkout alongside another live session.

## Who you are
The **router core** session for **M8** (repo `Muhammedelhofy/M8-`; prod `m8-alpha.vercel.app`
auto-deploys on push to `main` — **never push `main` without Muhammad's explicit OK**).

## Where we are (cold-start context)
B-155 shipped (on `main`): `lib/capability-registry.js` (single source of truth, **11 domains**:
driver_profile/knowledge/docs/notes/tasks/wallet/finance/fleet/memory/web/chat) + a generalised
`domain-arbiter.classifyAll()` (deterministic ownership scoring + hints + a wallet⇄fleet money-safety
co-presence rule). It is wired into `resolveDomainRoute()` (orchestrator.js) behind
`M8_REGISTRY_ROUTER=1` but **DORMANT — shadow-log only** (`lane=arbiter:reg:*` in `m8_router_misses`),
changing NO routing. Read `lib/capability-registry.js`, `lib/domain-arbiter.js` (classifyAll), and
`resolveDomainRoute()` + the shadow block in `lib/orchestrator.js` first.

## YOUR JOB — flip the LOWEST-RISK boundary only
Make `classifyAll()` actually ROUTE the **lookup domains** — `memory`, `web`, `knowledge`, `chat`
— (all read-only, no money, no writes), behind a NEW kill switch `M8_REGISTRY_LOOKUP=1` (default OFF
⇒ pre-156 behaviour). **Do NOT touch the wallet/fleet/finance/tasks/notes/driver_profile routing** —
those flip in B-157/158 and the wallet⇄fleet arbiter must keep behaving exactly as today.

The high-value win in this boundary: **wire the `knowledge` (ask-my-docs) lane.** Muhammad's CV +
vault notes are already ingested into `m8_knowledge_sources` / `m8_graph_nodes` (keyword/ILIKE
retrieval verified — see `INGEST_MANIFEST.md`). Find the existing knowledge-retrieval path (look in
`lib/answer-engine.js`, `lib/search.js`, `lib/knowledge-intake.js`, and any `searchKnowledgeGraph`/
RAG function) and route a `knowledge` decision to it, so "what does my CV say about X" / "search my
books for Y" returns a cited answer from his own content instead of a web search or a generic reply.
`memory`/`web`/`chat` should route to the EXISTING memory-recall / search-waterfall / chat paths
(reuse them — don't rebuild).

## Owns (disjoint) / Do NOT touch
- OWN: `lib/orchestrator.js`, `lib/domain-arbiter.js`, `lib/capability-registry.js`, `tests/build156_*`
- DO NOT TOUCH: `INGEST_MANIFEST.md`, `m8_knowledge_sources`/`m8_graph_nodes` **data** (the parallel
  CV-ingest session owns ingestion; you only READ via the retrieval function).

## Hard constraints
- Privacy wall ABSOLUTE (money DATA never enters an LLM/log; classifier sees message + masked digits only).
- Free-LLM default. Vercel **12-function cap is FULL** — no new `api/*.js`. Confirm-before-write.
- Node ABSENT → ship a **PS-5.1 mirror** (`tests/build156_lookup.test.ps1`) + a live phone test.
- **Must NOT regress** wallet/fleet/the ~170 working paths. The deterministic keyword lanes still run
  FIRST; only previously-unrouted lookup turns change. Default-OFF until the corpus + live test pass.

## Test
- Extend the corpus mirror: assert the `memory/web/knowledge/chat` rows in `tests/routing_corpus.jsonl`
  route correctly with the flag ON, AND every wallet/fleet/tasks/notes row is UNCHANGED (no regression).
- Zero money mis-routes remains the hard gate.

## Parallel-session rules
1. You are in your worktree (Step 0). `git fetch`; **check `origin/main` FIRST**.
2. `git add` your OWN files only (never `-A`). 3. End with `reports/build-156-done.json` → commit →
   push the BRANCH. 4. **No push to `main` without Muhammad's explicit OK.**
