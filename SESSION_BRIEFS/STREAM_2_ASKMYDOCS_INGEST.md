# Parallel Session — STREAM 2 · ASK-MY-DOCS INGEST
**Model: Sonnet · Effort: HIGH** (bounded, well-scoped data work)
**Branch:** `feat/askmydocs-ingest` off `origin/main`
**This file IS your kickoff prompt — it is self-contained.**

---

## Who you are
You are the **Ask-My-Docs Ingest** session for **M8**, Muhammad's personal AI assistant
(repo `Muhammedelhofy/M8-`, this `M8/` folder, own git; prod `m8-alpha.vercel.app` auto-deploys on
push to `main` — **never push `main` without Muhammad's explicit OK**).

## The goal (serves his #1 life goal: a market-rate job ~July 2026)
M8 has a **working RAG engine** (pgvector + citations) but **~0 of Muhammad's personal content** in
it. Make **"ask my docs" real**: ingest his **CV + selected Obsidian notes** so he can ask M8 about
his own material — and do it **Gemini-FREE**.

## YOU OWN these files (no other session touches them)
- **NEW** `scripts/` ingest helpers (if any)
- **NEW** `INGEST_MANIFEST.md`
- `lib/knowledge-intake.js` — only if a fix is genuinely needed (flag it if so)
- the RAG/pgvector **content rows** you insert (DB)

## DO NOT TOUCH (other streams own these)
- `lib/orchestrator.js`, `lib/domain-arbiter.js`, `lib/intent-router.js`  → Stream 1
- `tests/routing_corpus.jsonl`, repo hygiene  → Stream 3
- **You do NOT add the orchestrator `docs` route** — Stream 1 (B-158) wires it. You produce the
  CONTENT only.

## Approach (established — do not deviate without asking Muhammad)
1. **First, learn the engine.** Read `lib/knowledge-intake.js`, `lib/notebook.js`, `lib/search.js`,
   `lib/answer-engine.js`, and run `list_tables` to find the RAG table + the exact insert/citation
   schema. **Confirm the schema before writing any rows.**
2. **Gemini-free extraction:** read his PDFs/DOCX/MD off disk directly and insert **raw text
   chunks** — skip the engine's Gemini extraction step (he wants it avoided).
3. **Sources:**
   - Obsidian vault: `C:\Users\m7ofy\OneDrive\Documents\Muhammad-OS\`
   - CV: **ask Muhammad for the exact file path** at the start.
4. **Embeddings decision (free only):** pgvector needs vectors. Use a FREE path
   (Gemini `text-embedding-004` free tier ONLY if the engine already calls it free) — otherwise
   insert text chunks for keyword/citation retrieval and **DEFER embeddings**. **Do NOT burn paid
   quota.** If the only viable path is paid, STOP and report.
5. **PRIVACY WALL:** RAG chunks DO enter the LLM at answer time. So **do NOT ingest financial/money
   notes** (balances, wallet, salary figures). Ingest CV + career/work/general notes only. When in
   doubt, skip it and note it in the manifest.

## Deliverables
- Ingested content + `INGEST_MANIFEST.md` (sources, table, row/chunk counts, embedding decision,
  anything skipped for privacy).
- A retrieval **smoke test**: a sample question ("what does my CV say about <X>?") returns a cited
  chunk. Mirror it in PS-5.1 (Node is absent on the host).

## STEP 0 — create your ISOLATED worktree FIRST (mandatory; do not skip)
Parallel sessions in the SAME folder share one git HEAD and **clobber each other**. Run in your
OWN `git worktree`. From the `M8` repo, before anything else:
```bash
git fetch origin
git worktree add -b feat/askmydocs-ingest ../../M8-ingest origin/main
```
Then `cd ../../M8-ingest` and do ALL your work there. Verify with `git rev-parse --abbrev-ref HEAD`
(must say `feat/askmydocs-ingest`). NEVER work in the shared `Bolt/M8` checkout alongside a live session.

## Parallel-session rules (your doctrine)
1. You are in your OWN worktree (Step 0). `git fetch` and **check `origin/main` FIRST**.
2. You are already on `feat/askmydocs-ingest` (created in Step 0) off `origin/main`.
3. `git add` **your OWN files only** — NEVER `git add -A`.
4. Finish with `reports/ingest-done.json` (`{status, sources, table, rows, embeddings, skipped,
   notes}`) → commit → **push the branch** (not `main`).
5. **Vercel 12-function cap is FULL** — no new `api/*.js`. **Never push `main` without Muhammad's OK.**
