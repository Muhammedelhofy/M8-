# Parallel Session — D · ENRICH ASK-MY-DOCS (career corpus)
**Model: Sonnet · Effort: HIGH** (bounded data work; NOT the router)
**Branch:** `feat/askmydocs-enrich` off `origin/main`
**Runs in PARALLEL with B-159 (router) — disjoint files (DB/ingest vs orchestrator).**

## STEP 0 — create your ISOLATED worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/askmydocs-enrich ../../M8-enrich origin/main
```
`cd ../../M8-enrich`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout.

## Why
"Ask my docs" is now live: B-156 opened the knowledge lane, B-158b added free 768-dim embeddings
(semantic search), and the graph holds his CV (source 37) + 3 vault notes (sources 34–36, nodes
247–279). Make it a REAL job-hunt tool by ingesting the rest of his career material so M8 can answer
"what are my target companies / my Careem wins / my pitch / interview prep / who's in my network".

## The job
1. **Scan his Obsidian vault** `C:\Users\m7ofy\OneDrive\Documents\Muhammad-OS\` for CAREER / job-hunt
   notes NOT yet ingested — achievements, target companies, interview prep, networking/contacts,
   skills, project write-ups, application pitches. (Sources 34–36 already cover career-positioning,
   job-search-strategy, bolt-fleet-intelligence — don't duplicate; check `INGEST_MANIFEST.md`.)
2. **Ingest** the new ones into `m8_knowledge_sources` (ids continue from 37) + `m8_graph_nodes`
   (ids from 279) following the prior ingest pattern (query the existing rows to match columns,
   `source_class`, node `kind/label/note`). Gemini-FREE raw-text chunks.
3. **Embeddings:** `populateGraph()` now auto-embeds on insert (B-158b) via `embedText()`
   (gemini-embedding-001, free, 768-dim). Confirm new nodes get vectors; if any are null, run the
   B-158b `backfillKnowledgeEmbeddings` path. Reuse — do NOT add a new embed path.

## PRIVACY WALL (hard)
RAG chunks reach an LLM at answer time. **Ingest career/professional content ONLY.** SKIP anything
financial (balances, salary, runway, wallet) and purely personal/family notes. When unsure, skip and
note it in the manifest. (The prior run excluded Money & Runway.md + a salary figure — keep that bar.)

## Owns / Do NOT touch
- OWN: the new `m8_knowledge_sources` / `m8_graph_nodes` rows (DB), `INGEST_MANIFEST.md` (update),
  `tests/askmydocs-enrich-verify.ps1` (new).
- **DO NOT TOUCH** `lib/orchestrator.js`, `lib/domain-arbiter.js`, `lib/capability-registry.js`,
  `lib/wallet.js` (B-159 owns those). `lib/knowledge-intake.js` — read/reuse only; flag if you must edit.

## Constraints + test
- Free-LLM default; Vercel **12-fn cap FULL** (no new `api/*.js` — reuse `api/knowledge?fn=`).
- Node ABSENT → `tests/askmydocs-enrich-verify.ps1` PS-5.1 mirror: assert the new source + node ids
  exist, embeddings present, and a semantic query ("target companies", "Careem", "interview") surfaces
  the new nodes. Live test: "what does M8 know about my <topic>" after merge.
- Finish: `reports/askmydocs-enrich-done.json` → commit → push the BRANCH. **No push to `main` without OK.**
