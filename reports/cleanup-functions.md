# M8 Serverless Function Consolidation — 30 → 10

**Date:** 2026-06-21
**Branch:** `chore/consolidate-functions` (off `main` @ `97f5a13` / B109)
**Goal:** Get under the Vercel **Hobby 12-function cap** so M8 can deploy again, with **zero feature loss** and **no production deploy** until explicitly approved.

## Problem
M8 had **30** `api/*.js` files. Vercel counts each as one Serverless Function; Hobby caps at 12. Every deploy since failed: *"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan."* Live site was frozen at the last good deploy (B102). B109 (memory-graph vocab; DB migration already applied) was committed to `main` but could never ship for the same reason — it now rides along on the first successful deploy.

## Result: **10 functions** (2 slots of headroom)

```
chat.js  chat-stream.js  cron-summarize.js  cron-explore.js  cron-verify.js
morning-brief.js   knowledge.js   files.js   export.js   ops.js
```

The 4 crons + `chat`/`chat-stream` stay as their own entry points (crons were **not** merged). 12 live endpoints were folded into 4 routers; 12 dead endpoints deleted.

## Deleted — 12 dead endpoints (confirmed zero runtime callers)
Every reference was the file's own doc-comment or a test/doc/report — no `fetch`, no lib/cron/orchestrator call, no frontend call.

| Deleted | Feature status (why zero loss) |
|---|---|
| `convert`, `pdf-to-text` | Document conversion fully served by `upload-file` (its own `convertBuffer`). |
| `knowledge-extract`, `knowledge-ingest`, `knowledge-decompose` | Old 2-step pipeline; superseded by `ingest-full` (Build-101). |
| `ingest-book` | Book-ingest logic lives in `lib/knowledge-intake.js`; chat drives it directly. |
| `seed-pack` | Seeding logic stays in `lib/seed-pack.js` (`seedKnownMatch`); seeds already in the graph. |
| `graph-relabel` | One-time relabel tool; never wired to a caller. |
| `traces`, `summary-health`, `memory-health` | Manual diagnostics; trace/health DATA still written by `lib/`. |
| `nudge-history` | `lib/nudge-logger.js` (`getNudgeHistory`/`getNudgeSummary`) stays; brief still summarizes nudges. |

## Merged — 12 live endpoints into 4 routers
**Mechanism (lowest-risk):** each handler body was relocated **verbatim** to `lib/handlers/<name>.js` (only its `require("../lib/X")` paths adjusted to `require("../X")`). A thin router in `api/` dispatches on `?fn=`. **No business logic changed.** `lib/` files are not counted as functions, so the handlers add nothing to the count.

| Router | Folds in (verbatim handlers) | maxDuration |
|---|---|---|
| `api/knowledge.js` | ingest-full, ingest-extract-existing, knowledge-inventory, memory-consolidate, platform-sync | 180 |
| `api/files.js` | presign, upload-file *(+ in-file `bodyParser: 20mb`)* | 300 |
| `api/export.js` | deck, fleet-export | 30 |
| `api/ops.js` | health, loop-attest, notify-prefs | 30 |

**3 back-door functions resolved & preserved:** `loop-attest` (nightly local grader POSTs, CRON_SECRET bearer), `notify-prefs` (unsubscribe link in brief emails, returns HTML), `platform-sync` (Build-97 Uber-CSV preview, x-m8-token). All live; all kept.

## URL preservation — zero frontend edits
`vercel.json` rewrites map every original path to its router, preserving method, body, headers, and query params. Callers we cannot edit (the email unsubscribe links, the nightly grader, the orchestrator's `<!--M8-DOWNLOAD-->` fleet-export marker, `js/app.js`) keep using the exact same URLs:

```
/api/ingest-full → /api/knowledge?fn=ingest-full      /api/presign      → /api/files?fn=presign
/api/ingest-extract-existing → …?fn=extract-existing   /api/upload-file  → /api/files?fn=upload
/api/knowledge-inventory → …?fn=inventory              /api/deck         → /api/export?fn=deck
/api/memory-consolidate → …?fn=memory-consolidate      /api/fleet-export → /api/export?fn=fleet
/api/platform-sync → …?fn=platform-sync                /api/health       → /api/ops?fn=health
                                                       /api/loop-attest  → /api/ops?fn=loop-attest
                                                       /api/notify-prefs → /api/ops?fn=notify-prefs
```
The original identity catch-all `/api/(.*) → /api/$1` is kept last. `functions` block trimmed to the 10 real files. **4 crons unchanged.**

## Tests
- **PowerShell mirror** (`tests/consolidate-functions-verify.ps1`): **126 passed / 0 failed** — 10 functions, dead files gone, 12 handlers relocated + export a function + no stale `../lib/` require, every router dispatches every `fn`, vercel.json valid + references only real files + 12 rewrites + 4 crons, frontend call sites resolve. (Host has no Node — PS mirror + the Vercel preview build are the test stack.)
- **Static review:** no runtime file calls a deleted endpoint; all relocated requires resolve to existing `lib/` modules.

## Vercel PREVIEW build — _PENDING (filled after branch push)_
> The preview is an isolated deployment (own URL; does **not** touch production or run crons). A green build proves ≤12 functions + no import errors. Smoke tests to run on the preview URL: `chat`, `/api/health`, a knowledge route, and the two rewritten back-door URLs (`POST /api/loop-attest`, `GET /api/notify-prefs`) — these confirm the rewrite query-param dispatch works.

## Go / No-Go deploy checklist (production = merge → `main`)
- [ ] Preview build is **green** (proves ≤12 + imports OK).
- [ ] Preview smoke: chat replies; `/api/health` returns provider JSON (proves ops router + rewrite); a knowledge route responds; `notify-prefs` returns its HTML page; `loop-attest` accepts a POST.
- [ ] On **explicit "deploy"**: merge `chore/consolidate-functions` → `main`.
- [ ] After deploy: `GET /api/health` shows the new commit SHA.
- [ ] Confirm the 4 crons still listed in Vercel; next morning brief fires.

## Rollback
Production is untouched until merge. If anything regresses post-deploy, revert the merge commit on `main` (or redeploy the prior good deployment in Vercel) — the live site returns to B102 behavior. The worktree branch can be rebuilt from this report.
