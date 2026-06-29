# Parallel Session — CV INGEST (ask-my-docs continuation)
**Model: Sonnet · Effort: HIGH** (bounded data work)
**Branch:** `feat/cv-ingest` off `origin/main`
**This file IS your kickoff prompt — self-contained.**

---

## STEP 0 — create your ISOLATED worktree FIRST (mandatory; do not skip)
Parallel sessions in the SAME folder share one git HEAD and **clobber each other**. Run in your OWN
`git worktree`. From the `M8` repo, before anything else:
```bash
git fetch origin
git worktree add -b feat/cv-ingest ../../M8-cv origin/main
```
Then `cd ../../M8-cv` and do ALL work there. Verify `git rev-parse --abbrev-ref HEAD` = `feat/cv-ingest`.
NEVER work in the shared `Bolt/M8` checkout alongside another live session.

## Who you are
The **ask-my-docs ingest** session for **M8** (repo `Muhammedelhofy/M8-`). M8 has a working RAG/
knowledge layer; a prior session ingested Muhammad's vault notes but his CV was a placeholder. Now
ingest his **real CV** so "what does my CV say about X" returns quantified, cited answers.

## The source
`C:\Users\m7ofy\OneDrive\Desktop\Mohamed_ElHofy_CV_Updated.pdf` — read it with the Read tool (it
extracts PDF text; no Gemini/OCR needed).

## Owns (disjoint) / Do NOT touch
- OWN: the new DB rows in `m8_knowledge_sources` + `m8_graph_nodes`; `INGEST_MANIFEST.md` (update);
  `tests/cv-ingest-verify.ps1` (new).
- DO NOT TOUCH: `lib/orchestrator.js`, `lib/domain-arbiter.js`, `lib/capability-registry.js` — the
  parallel B-156 session owns the router and will wire the `knowledge` lane that retrieves your nodes.

## Approach (match the prior ingest exactly)
1. **Learn the existing shape FIRST:** read `INGEST_MANIFEST.md` and query the BOLT Supabase
   (`ltqpoupferwituusxwal`) `m8_knowledge_sources` (the prior run used IDs 34–36) and `m8_graph_nodes`
   (IDs 247–261) to copy the exact columns, `source_class`, and node `kind`/`label`/`note` conventions.
2. **Gemini-FREE:** insert raw text chunks directly via SQL — no extraction pipeline. **Embeddings
   DEFERRED** (the engine has no free embedding path yet); rely on the verified keyword/ILIKE retrieval.
3. **Insert:** one new `m8_knowledge_sources` row for the CV + concept nodes in `m8_graph_nodes` for
   the quantified achievements, roles, employers, skills, and metrics in the CV (the things a recruiter
   would ask about). Use slugged labels like the prior nodes (e.g. `careem-supply-manager`).
4. **PRIVACY WALL:** RAG chunks DO reach an LLM at answer time. **Exclude any current-salary / pay
   figure** (the prior run excluded "6k") and any personal financial balances. Keep market benchmarks,
   titles, achievements, metrics. Note anything skipped in the manifest.
5. **Smoke test:** `tests/cv-ingest-verify.ps1` — assert the new source + node IDs exist and a keyword
   query ("Careem", "supply", "ops") surfaces CV nodes. Node ABSENT on host → PS-5.1 only.

## Deliverables
Updated `INGEST_MANIFEST.md` (new source id, node ids, what was skipped for privacy) +
`reports/cv-ingest-done.json` ({status, source_id, node_ids, skipped, smoke_test}).

## Parallel-session rules
1. You are in your worktree (Step 0). `git fetch`; **check `origin/main` FIRST**.
2. `git add` your OWN files only (never `-A`). 3. End with `reports/cv-ingest-done.json` → commit →
   push the BRANCH. 4. **No push to `main` without Muhammad's OK.** No new `api/*.js` (12-fn cap full).
