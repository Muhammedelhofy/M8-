# Parallel Session — STREAM 3 · CORPUS + HYGIENE  (optional 3rd stream)
**Model: Sonnet · Effort: HIGH** (bounded)
**Branch:** `feat/routing-corpus` off `origin/main`
**This file IS your kickoff prompt — it is self-contained.**

---

## Who you are
You are the **Corpus + Hygiene** session for **M8**, Muhammad's personal AI assistant
(repo `Muhammedelhofy/M8-`, this `M8/` folder, own git; prod auto-deploys on push to `main` —
**never push `main` without Muhammad's explicit OK**).

## Why you exist
Stream 1 is broadening the router to all domains. It **cannot** be validated by live shadow — only
**7 real rows exist (all from 06-25)**. It needs a **seeded corpus** instead. That's your #1
deliverable, and **Stream 1 depends on it** — produce it FIRST.

## YOU OWN these files (no other session touches them)
- **NEW** `tests/routing_corpus.jsonl`
- repo hygiene: the untracked `BUILD_GEN_EXTRACT_SPEC.md`, `PHASE1_TEAM_REVIEW.md`
- an **AUDIT-ONLY** memory report (new doc)

## DO NOT TOUCH (other streams own these)
- `lib/orchestrator.js`, `lib/domain-arbiter.js`  → Stream 1
- `scripts/ingest-*`, `lib/knowledge-intake.js`, the RAG content  → Stream 2

## Deliverable 1 — `tests/routing_corpus.jsonl` (PRIORITY)
- One JSON object per line:
  `{ "message", "history"?, "expect_domain", "expect_action"?, "expect_subject"?, "expect_ask"? }`
- Cover **ALL domains** (`wallet/fleet/tasks/notes/memory/docs/web/chat`), with **Arabic + typos**,
  **owner/Sara/household** subjects, and the **wallet⇄fleet near-misses** that used to break.
- **Use NATURAL phrasings** (the router sees real text). The 7 real rows are redaction artifacts —
  de-redact them into natural seeds:
  - "breakdown of my spend in june" → wallet
  - "how are my drivers" → fleet
  - "tell me sara's june spend" → wallet (subject = Sara)
  - "giv eme break down of sara spend in just" (typos for "june") → wallet
  - "give me break down" (after a wallet answer) → wallet (anaphora)
  - "i want to see the amounts in sar" (after a wallet answer) → wallet (anaphora)
- Add **regression rows** for the known historical bugs:
  - "my spend" → wallet, subject = **owner** (NOT household total)
  - "what's the breakdown?" right after M8 said an amount → wallet (don't forget its own number)
  - "make me rich" → must NOT loop into the fleet "which driver?" trap
- Aim ~60–100 lines. Quality > quantity; every row must have a defensible single correct route.

## Deliverable 2 — repo hygiene
- Decide commit-or-archive for untracked `BUILD_GEN_EXTRACT_SPEC.md` and `PHASE1_TEAM_REVIEW.md`.
  **Do NOT delete** — move to an `archive/` or `docs/` path, or commit in place. Flag anything that
  looks like an unfinished spec Muhammad may still want.

## Deliverable 3 — memory AUDIT (read-only; DO NOT delete)
- Query the memory table; list stale-looking rows (transient weather/price/score/daily-snapshot).
- **DO NOT delete anything** — the ~215 Collatz/Lean research facts are kept on purpose. Output a
  report (`MEMORY_AUDIT.md`); Muhammad decides what, if anything, to prune.

## STEP 0 — create your ISOLATED worktree FIRST (mandatory; do not skip)
Parallel sessions in the SAME folder share one git HEAD and **clobber each other**. Run in your
OWN `git worktree`. From the `M8` repo, before anything else:
```bash
git fetch origin
git worktree add -b feat/routing-corpus ../../M8-corpus origin/main
```
Then `cd ../../M8-corpus` and do ALL your work there. Verify with `git rev-parse --abbrev-ref HEAD`
(must say `feat/routing-corpus`). NEVER work in the shared `Bolt/M8` checkout alongside a live session.

## Parallel-session rules (your doctrine)
1. You are in your OWN worktree (Step 0). `git fetch` and **check `origin/main` FIRST**.
2. You are already on `feat/routing-corpus` (created in Step 0) off `origin/main`.
3. `git add` **your OWN files only** — NEVER `git add -A`.
4. Finish with `reports/corpus-done.json` (`{status, corpus_lines, hygiene, memory_audit, notes}`)
   → commit → **push the branch** (not `main`).
5. **Never push `main` without Muhammad's OK.** No `api/*.js` (Vercel cap is full). No orchestrator edits.
