# Parallel Session — C · ASK-MY-DOCS EMBEDDINGS (semantic retrieval)
**Model: Sonnet · Effort: HIGH** (bounded; knowledge layer, NOT the router)
**Branch:** `feat/knowledge-embeddings` off `origin/main`
**Runs in PARALLEL with B-157 + B. Start AFTER B-156 merges** (so you inherit B-156's knowledge lane).

## STEP 0 — create your ISOLATED worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/knowledge-embeddings ../../M8-emb origin/main
```
`cd ../../M8-emb`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout.

## The gap
The ask-my-docs ingest (CV `m8_knowledge_sources` id=37 + nodes 262–279; vault notes ids 34–36 + nodes
247–261) landed with **embeddings DEFERRED** — retrieval is keyword/ILIKE only, so "what does my CV say
about leadership" misses unless the word "leadership" is literally present. **Your job: add FREE
embeddings + semantic (vector) retrieval** so his CV/notes answer by MEANING.

## What to build
1. **Confirm the infra:** `m8_graph_nodes` already has an embedding column + HNSW index (verify exact
   column name + dim via the BOLT Supabase `ltqpoupferwituusxwal`). Read `lib/knowledge-intake.js` for
   the current ingest + retrieval (keyword ILIKE) path.
2. **FREE embedding provider:** generate vectors with **Gemini `text-embedding-004` (free tier)**.
   Confirm it's free + the dim matches the column. **If the only path is paid, STOP and report** — do
   not burn paid quota.
3. **Backfill** embeddings for the already-ingested nodes (sources 34–37, nodes 247–279) and embed on
   future ingest.
4. **Retrieval:** add vector (cosine `<=>` / HNSW) search to the knowledge retrieval, **as a hybrid**
   with the existing keyword path — keep the keyword fallback working so it degrades safely and B-156's
   knowledge lane keeps its current behaviour. **Backward-compatible signature** (B-156 calls this).

## Owns / Do NOT touch
- OWN: `lib/knowledge-intake.js` (embedding gen + hybrid retrieval), the embedding column backfill (DB),
  `tests/knowledge-embeddings.test.ps1`.
- **DO NOT TOUCH `lib/orchestrator.js`** (B-156 owns the knowledge LANE; you improve the retrieval it
  calls). Branch off the post-B-156 `main` so you build on B-156's lane, and keep the retrieval function
  signature stable so the lane keeps working.

## Constraints + test
- Privacy: knowledge nodes are CV/notes (recruiter-facing; salary already excluded). Do NOT ingest/embed
  any financial/wallet data. Free-LLM default; Vercel **12-fn cap FULL** (no new `api/*.js`).
- Node ABSENT → `tests/knowledge-embeddings.test.ps1` PS-5.1 mirror: assert a semantic query surfaces the
  right CV node WITHOUT the exact keyword (e.g. "management experience" → the Careem team-lead node), and
  that keyword fallback still returns its prior hits. Live test "what does my CV say about X" after B-156
  + this merge.
- Finish: `reports/knowledge-embeddings-done.json` → commit → push the BRANCH. **No push to `main` without OK.**
