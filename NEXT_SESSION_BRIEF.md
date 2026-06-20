# M8 — Next Session Brief
**Latest:** 2026-06-20 (Session-53) · **Branch:** main · **Head:** `203096b` Build-78d (resilient book ingestion + resumable OCR) atop the parallel finance session's Build P1/P2 (`lib/finance.js`) — shared tree
**Canonical plan:** [`HONESTY_TRACK_PLAN.md`](HONESTY_TRACK_PLAN.md) ← the living backlog. Read it first.
(Older Session-34/38/39/40/41/43/44/48/49/51 briefs preserved below for history.)

---

## 🚦 LIVE SESSION BOARD — read + update this FIRST (parallel-session safety)

> **Why this exists:** Muhammad runs up to TWO Claude sessions at the same time (Max plan).
> They must never edit the same file, or git will fight. Rule of thumb: **different lanes = safe.**
> Each running session claims a lane below by writing its line, and clears it when done.

**Who is working right now** (each session edits ONLY its own row):

| Slot | Status | Lane | Session / focus | Started |
|---|---|---|---|---|
| Session A | ✅ done | LANE 2 — RESEARCH (ingestion) | **Builds 77 + 78 + 78a/c/d SHIPPED + PUSHED + LIVE** (`203096b`): resilient/idempotent/timeout-safe book ingestion + chat wiring (uploaded book → resilient engine) + resumable OCR + free-tier OCR throttle. Migration `m8_ingest_checkpoints` APPLIED; `m8_ocr_checkpoints` PENDING. **Edited `lib/orchestrator.js` with Muhammad's explicit OK after he freed the Cleanup lane.** Live ingest of bn01.pdf BLOCKED on Gemini paid-tier propagation (see Session-53 state). | 2026-06-20 |
| Session B | ✅ done | LANE 2 | Inventory helper (`af99fe4`) + 0-books finding. (Builds 74/76 pushed; live.) | 2026-06-19 |
| Finance | ⚪ status unknown | LANE 1 — BUSINESS | Parallel session shipped **Build P1** (Bolt bonus-tier engine) + **Build P2** (model-aware per-driver P&L) in `lib/finance.js` (`1261a22`, `b62e551`). Confirm with that session before touching `lib/finance.js`. | 2026-06-20 |
| Cleanup | ✅ freed | LANE 3 | Closed by Muhammad mid-session so Session A could wire `lib/orchestrator.js`. Last commit `1135c22`. Diagram + brief now maintained by Session A this round. | 2026-06-20 |

**⛔ CLOSE RULE while parallel sessions run:** Sessions A and B do **NOT** edit `m8_mind_2026.html`
or `NEXT_SESSION_BRIEF.md` at close (those are Lane 3's, to avoid a 3-way merge fight). At close,
A and B **commit ONLY their own code/data files** and leave a 2–3 line summary of what shipped; the
**Cleanup/Lane-3 session integrates both summaries into the diagram + brief** so the end-state stays
clean. (This overrides the older "every session updates the diagram + brief" rule — that one applies
only when running solo.)

**The 3 lanes (files never overlap):**

- **Lane 1 — BUSINESS (Track A).** Fleet, money, daily-usefulness. Owns:
  `lib/fleet.js`, `lib/fleet-analysis.js`, `lib/morning-brief.js`, `lib/notify.js`, `lib/nudges.js`,
  `lib/alerting.js`, `lib/finance.js`, `lib/companies.js`, `lib/eosb.js`, `lib/playbooks.js`,
  `lib/deckgen.js`, `lib/docgen.js`, `lib/command-center.js`;
  `api/morning-brief.js`, `api/fleet-export.js`, `api/notify-prefs.js`, `api/deck.js`;
  `m8_command_center.html`.
- **Lane 2 — RESEARCH (Track B).** Math engine, Lean, autonomous loop, knowledge graph. Owns:
  `lib/loop.js`, `lib/lemma-dag.js`, `lib/decomp-proposer.js`, `lib/discovery.js`,
  `lib/collatz-probes.js`, `lib/lychrel-probes.js`, `lib/conjecture-gen.js`, `lib/kernel-conjecture.js`,
  `lib/notebook.js`, `lib/memory-graph.js`, `lib/knowledge-intake.js`, `lib/lean.js`, `lib/leanClient.js`,
  `lib/review-queue.js`, `lib/seed-pack.js`, `lib/engine-catalog.js`, `lib/sourceTrust.js`;
  `api/cron-explore.js`, `api/cron-verify.js`, `api/cron-summarize.js`, `api/loop-attest.js`,
  `api/ingest-book.js`, `api/knowledge-*.js`, `api/graph-relabel.js`, `api/seed-pack.js`,
  `api/pdf-to-text.js`, `api/convert.js`, `api/presign.js`, `api/upload-file.js`;
  `tests/odysseus/`, `lib/tools/`.
- **Lane 3 — CLEANUP / QA.** Bug hunts, dead-code removal, the diagram, docs, test tidying. Owns:
  `m8_mind_2026.html`, `NEXT_SESSION_BRIEF.md` (history), `HONESTY_TRACK_PLAN.md`, the `tests/*.ps1`
  verify scripts, `*_SPEC.md` files. **May fix a bug in a Lane-1/Lane-2 file ONLY if that lane's slot
  is 🟢 idle** (nobody else is in it) — otherwise note it as a pending item instead of editing.

**⚠️ SHARED CORE — both tracks route through these. Announce on the board BEFORE touching, and never both at once:**
`lib/orchestrator.js`, `lib/router.js`, `lib/intentClassifier.js`, `lib/slots.js`, `lib/llm.js`,
`lib/memory.js`, `lib/stateEngine.js`, `lib/buildState.js`, `api/chat.js`, `api/chat-stream.js`, `api/health.js`.

**Commit rule for parallel work:** each session commits ONLY its own lane's files (`git add` the specific
paths, never `git add .`). Bump `lib/buildState.js` via the unique-anchor replace so two sessions can both
append without clobbering. If a session needs a shared-core file the other is editing, wait — don't fork it.

---

## ★ SESSION-54 FINAL STATE — 2026-06-20 (read this first next session)

### What shipped this session (all pushed to `Muhammedelhofy/M8-` main, head `8d450d4`)

| Build | Summary | Status |
|---|---|---|
| **Build-79** | **Immediate fact extraction.** `_maybeExtractFact()` fires as fire-and-forget inside `saveMemory` after user turns — uses a tight system prompt to extract a single structured fact (key/statement/type/importance/entities) and calls `upsertFact`. Lowered `SUMMARY_ROW_THRESHOLD` 10→4 so sessions summarize faster. Tests: 22/22. | ✅ live |
| **Build-80** | **Recall scope fix + memory-health endpoint.** Removed `.neq("session_id", currentSessionId)` from the Tier 1 canonical-facts query — facts written in the CURRENT session were invisible until the NEXT session. The Tier 2 pool (raw turns) keeps its exclusion. Added `GET /api/memory-health`: returns all canonical facts, last 10 summaries, total turn count, oldest/newest fact dates. Tests: 22/22. | ✅ live |
| **Build-81** | **Semantic recall via pgvector + Gemini embeddings.** `generateEmbedding()` uses `text-embedding-004` (768 dims, free tier). `upsertFact` + `summarizeSession` now store embeddings on every write. `semanticRecall()` calls `match_memories` Supabase RPC (cosine similarity, threshold 0.70, HNSW index). `recallMemory` Tier 2: semantic-first (≥2 hits) with keyword fallback when embedding unavailable. Migration `B81_semantic_recall.sql` **APPLIED** to Supabase: pgvector extension, `embedding vector(768)` column, HNSW index, `match_memories` RPC. Tests: 32/32. | ✅ live + migration applied |

**Bolt dashboard (separate repo `MHMBOLT/index.html`):** Fixed ambassador bad-row toast, added "to next tier" hint on monthly target bars, added fleet Bolt bonus table, restored sync time on page load, added mobile CSS. Pushed `8a1cf5b`.

| Build | Summary | Status |
|---|---|---|
| **Build-82a** | Reject image-based (scanned) PDFs before any Gemini call — detect via Tj/TJ operator count in first 200KB. Returns 400 with DOCX conversion instructions. Zero API cost on rejection. | ✅ live |
| **Build-82** | Knowledge graph context injection — `searchKnowledgeGraph()` keyword search on `m8_graph_nodes`; injects top 6 nodes as `KNOWLEDGE GRAPH` block in system instruction when `action=answer` and not fleet/finance/compute. **Live-verified**: M8 cited Ibn Kathir correctly in English + Arabic. | ✅ live + verified |
| **Build-83c** | Entity memory — `lib/entity-graph.js`: extracts named entities (person/book/problem/company/place/concept) from every user turn (fire-and-forget); upserts into `m8_entities` with merged attributes + mention_count; `recallEntities()` injects matching entities as `KNOWN ENTITIES` block. Migration `B83c_entity_graph.sql` applied. Tests 36/36. | ✅ live |

**Book ingestion:** bn01 (البداية والنهاية vol1) ingested — 201 nodes. `m8_ocr_checkpoints` migration applied. Scanned PDFs now rejected (use DOCX instead). `GEMINI_MODEL=gemini-2.5-flash` updated in Vercel.

**Parallel sessions running (B + D):**
- **Session B** (Option B): Semantic KG Q&A — upgrading `searchKnowledgeGraph()` with pgvector embeddings on `m8_graph_nodes`. Touches `lib/knowledge-intake.js` only.
- **Session D** (Option D): M4 proposer feedback loop — verified Lean leaves feed back into conjecture generator. Touches `lib/conjecture-gen.js`, `lib/decomp-proposer.js`.

### ▶ NEXT SESSION priorities
1. **Reconcile parallel sessions B + D** — merge their commits, check for conflicts, run their verify scripts.
2. **Build-83 morning brief P&L** — wire `lib/finance.js` (Build P1/P2) into the daily email: per-driver profit, fleet P&L, tier hits.
3. **Ingest more Ibn Kathir volumes** — convert DOCX → TXT in Word, upload with ingest command. 19 volumes remaining.
4. **Entity memory live-test** — after a few turns, check `m8_entities` table in Supabase to confirm entities are accumulating.

### Kickoff prompt for next session
> Continue M8 (Session-55). Read `NEXT_SESSION_BRIEF.md` (Session-54 final state) first. Head `192bf7e`.
>
> **STANDING DEFAULTS — never ask Muhammad about these:**
> - Model: **Sonnet** always unless the task needs deep architectural reasoning (then say why)
> - Effort: **Medium** (1-2 hours) for implementation builds — state it upfront, don't ask
> - Session close: **always** update `m8_mind_2026.html` + `NEXT_SESSION_BRIEF.md` + push — without being asked, before the final summary
> - Parallel session prompts: include model + effort in the prompt header automatically
>
> **Where we are:** Builds 79–83d all live. Entity memory, semantic recall, KG injection, KG semantic search (83b), proposer feedback loop (83d), scanned PDF rejection — all shipped + migrations applied. Diagram updated (192bf7e).
>
> **NEXT priorities:**
> 1. Morning brief P&L — wire `lib/finance.js` (Build P1/P2) into daily email: per-driver profit, fleet P&L, tier hits
> 2. Ingest bn02–bn20 (convert DOCX → TXT in Word, upload with ingest command)
> 3. Entity memory live-test — check `m8_entities` table in Supabase after a few turns
>
> Standing rules: free Gemini stack by default; live runs need Muhammad's OK; repo `Muhammedelhofy/M8-`; edit buildState.js via unique-anchor replace only; PS .ps1 files pure ASCII.

---

## ★ SESSION-53 FINAL STATE — 2026-06-20 (read this first next session)

### What shipped this session (all pushed to `Muhammedelhofy/M8-` main, head `203096b`)

| Build | Summary | Status |
|---|---|---|
| **Build-77** | **Resumable / idempotent / timeout-safe book ingestion.** Root cause of the 0-books gap: `api/ingest-book.js` was idempotent only on "a chapter source row exists", but that row is written BEFORE the slow Gemini extraction — so a chapter that timed out mid-extraction was skipped forever with 0 nodes. Fix: `m8_ingest_checkpoints` table (migration **APPLIED**), a chapter marked `done` ONLY after its nodes commit; bounded per invocation (`M8_INGEST_MAX_CHAPTERS`=6) returning `done/resume/next_chapter`; idempotent (no dup sources/nodes); `getIngestionInventory` reports per-book progress. `tests/B77` 33/33. | ✅ live |
| **Build-78a** | **Resumable OCR** (`api/pdf-to-text.js` + `lib/converter.js`): `m8_ocr_checkpoints` table (migration **PENDING**) persists each page-batch's text so OCR resumes after a timeout. Pure helpers in converter.js. `tests/B78` 29/29. | ✅ live (migration pending) |
| **Build-78** | **Chat wiring** — the resilient endpoints existed but nothing called them, and "ingest this as a book" routed to the single-shot 16K-cap path that never even saw an uploaded PDF's text (a doc attachment's `convertedText` goes only into the LLM contents block, never `message`). Moved the engine into `lib/knowledge-intake.js` as `ingestBookText()` (ingest-book.js is now a thin wrapper); added `detectBookIngest`/`parseBookIngestMessage`; **`lib/orchestrator.js`** now detects "ingest this as a book" + a document attachment, pulls the attachment text, drives `ingestBookText`, returns a resume-aware packet. Added `!knowledgeIngestMode` to the stream gate. `tests/B78b` 18/18. **Edited orchestrator.js (shared core) with Muhammad's OK after the Cleanup lane was freed.** | ✅ live |
| **Build-78c/78d** | **OCR upload hardening** (`api/upload-file.js`): wait-for-ACTIVE before extracting; surface per-batch errors (the old bare `catch{}` hid them) so an all-empty OCR throws a real diagnostic; concurrency 10→3 (`M8_OCR_CONCURRENCY`) + 429 backoff (6/12/18s) for the free tier. | ✅ live |

### ⛔ THE ONE THING BLOCKING THE LIVE PROOF — Gemini paid-tier propagation
- Live ingest of `bn01.pdf` (82-page scanned البداية والنهاية) kept failing at the **OCR** step (not the ingest wiring — that never got to run). Diagnosed via Vercel runtime logs: **HTTP 429** whose quota violation references **`FreeTier` + `PerDay`**.
- Muhammad **bought $10 Gemini credits** (balance +$8.91, project "M8 Agent" on a paid billing account) — but a retry STILL 429'd as FreeTier. Cause is either (a) **paid-tier rate limits not yet propagated** (minutes–~30m after enabling billing) or (b) the **`GEMINI_API_KEY` in Vercel belongs to a different project** than the billed "M8 Agent" one.
- **NEXT SESSION step 1:** wait for propagation, retry the `bn01.pdf` upload ONCE. If it still says `FreeTier`, check AI Studio → API Keys → which project each key is in; point M8 at a key from the **M8 Agent** project. Then ingest `bn01.pdf`…`bn20.pdf` (full set on `C:\Users\m7ofy\OneDrive\Desktop\books\`). With paid quota, set Vercel env **`M8_OCR_CONCURRENCY=10`** for full OCR speed.
- **Unverified live:** the Build-78 ingest wiring (every attempt died at OCR first). Zero-OCR proof file ready: `C:\Users\m7ofy\OneDrive\Desktop\books\m8_test_book.docx` (DOCX = no OCR) → attach + `ingest this as a book: title=Test Book, source_class=established` → check `/api/knowledge-inventory`.

### Parallel session (Lane 1 — BUSINESS) — reconcile, do not clobber
- A finance session shipped **Build P1** (Bolt bonus-tier engine) and **Build P2** (model-aware per-driver P&L) in `lib/finance.js` (`1261a22`, `b62e551`) into this shared tree. Spec: `BUILD_PNL_SPEC.md` (untracked). Don't touch `lib/finance.js` without confirming with that lane.

### Kickoff prompt for next session
> Continue M8 (Session-54). Read `NEXT_SESSION_BRIEF.md` (Session-53 final state) first.
> Builds 77/78/78a/78c/78d are LIVE (`203096b`): resilient book ingestion + chat wiring + resumable OCR + free-tier OCR throttle. `m8_ingest_checkpoints` applied; `m8_ocr_checkpoints` PENDING.
> The live proof is blocked ONLY on Gemini paid-tier propagation — retry `bn01.pdf` upload; if still `FreeTier` 429, fix the key↔project mismatch (use a key from the billed "M8 Agent" project), then ingest the bn01–bn20 set and set `M8_OCR_CONCURRENCY=10`.
> Standing rules: free Gemini stack by default; live runs need Muhammad's OK; repo `Muhammedelhofy/M8-`; edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files pure ASCII; update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-52 FINAL STATE — 2026-06-19 (read this first next session)

### What shipped this session

| Build | Summary | Status |
|---|---|---|
| **Build-74** | **Command Center v2 — human-in-the-loop scoring + approval.** The kickoff asked to "build the Command Center", but it already shipped as **Build-50 (v1)** and the repo had moved 22 builds past it — so this session *enhanced* it (Muhammad chose "Command Center v2"). v1 shipped with every task score at neutral 3/3/3/3/3, so the ranking carried no signal, and there was no way for Muhammad to **approve** the order (the Session-39 brief's "model is ANALYST, not governor"). v2 closes both: **(1) chat scoring** — `rate task #N impact 5 urgency 4 strategic 5` (also score/set/update) validates each field against the SQL ranges (impact/urgency/risk/effort 1-5, strategic_value 1/3/5), writes `m8_cc_tasks`, re-ranks, and narrates the rank move; out-of-range refused, never written. **(2) approval gesture** — `approve/lock the priority order` snapshots the computed order into an `m8_cc_decisions` row (the signed-off reference order). **(3) drift** — every priority packet now LEADS with "matches your approved order / has DRIFTED since `<date>` / none yet". All writes **fail SAFE** (degraded/missing-task/all-invalid → refuse). Orchestrator hard-route placed **before** `detectPriorityQuery`. `m8_command_center.html` → v2 (approval banner, Decision Log, per-task score breakdown; snapshot carries approval+decisions). **No migration** (reuses Build-50 `m8_cc_*`), no new endpoint. `tests/command-center-verify.ps1` **63/63** (36 v1 + 27 v2). **A stream-path fix shipped after first live-test** (`07d273d`): the score/approve hard-route lives in buffered `orchestrate()`, but `orchestrateStream()`'s `commandCenterMode` only excluded `detectPriorityQuery` — so `rate task #N ...` (fleet-ish word "rate") streamed past the handler and the LLM confabulated. Fix added `detectScoreCommand`+`detectApproveCommand` to `commandCenterMode`. | ✅ **LIVE-VERIFIED 2026-06-19** (SHA `07d273d`): scored #2→Active top, `set #2 strategic 4` refused, approve locked, "matches your approved order", re-score #13 flagged DRIFT inline. Pushed `365984f` + `07d273d`. |

### ▶ NEXT SESSION priorities (in order)
1. **Commit + push Build-74** if not already done (then `GET /api/health`, confirm Build-74 first in LIVE; live-test the chat flow below).
2. **Live-verify Build-74** (needs Muhammad's OK — Gemini-free, but writes to the live `m8_cc_*` ledger):
   - `what's the priority?` → packet leads with a drift/none line + per-band ranking
   - `rate task #2 impact 5 urgency 5 strategic 5` → "moved UP from #N to #1", new score/band
   - `set #2 strategic 4` → refused (allowed 1/3/5), no write
   - `approve the priority order` → "Locked your approved priority order (date)" + ordered list
   - then `what's the priority?` again → "matches your approved order"; re-score a task → "DRIFTED"
   - open `m8_command_center.html` → approval banner + Decision Log + score breakdowns render
3. **Rate the real task scores** so the first ranking carries signal (v1 seeded everything neutral). Optionally **re-seed** the `m8_cc_*` ledger to current reality through Build-74 (it's stale at the Build-50 seed).
4. Build-72 smarter context routing (Muhammad asked) — owned by the fleet-routing lane; **don't collide** with `lib/fleet.js`, `lib/morning-brief.js`, `lib/notify.js`, `lib/nudges.js`.

### Note on the working tree
- Build-72b (`lib/fleet-analysis.js`) and Build-73 (`lib/nudges.js`) were committed by a **parallel session** during this one (`5bb9918`). This session built **only** the Command Center (`lib/command-center.js`, `lib/orchestrator.js` CC routes, `m8_command_center.html`, `data/command_center_snapshot.json`, `tests/command-center-verify.ps1`, `lib/buildState.js`). No overlap with the fleet/brief/notify/nudge lanes.
- `.claude/serve-m8.ps1` + the `m8-static` launch config are local preview-only helpers (untracked, in `.claude/`).

### Kickoff prompt for next session
> Continue M8 (Session-53). Read `NEXT_SESSION_BRIEF.md` (Session-52 final state) first.
> Build-74 (Command Center v2 — human scoring + approval + drift) is code-complete, `tests/command-center-verify.ps1` 63/63.
> If still uncommitted, commit + push it, then live-verify the chat flow (checklist above) with Muhammad's OK.
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-51 FINAL STATE — 2026-06-19 (read this first next session)

### What shipped this session

| Build | Summary | Status |
|---|---|---|
| **LLM fix** | **`thinkingConfig` guard** — `gemini-2.0-flash` rejects the `thinkingConfig` field entirely (only gemini-2.5-* supports it). Code was always sending `{ thinkingBudget: 0 }` by default → 400 errors on every stream call. Fix: only set `thinkingConfig` when `thinkingBudget > 0`. `lib/llm.js` `d4c73b8`. | ✅ pushed + live |
| **GEMINI_MODEL** | Muhammad updated `GEMINI_MODEL=gemini-2.0-flash` in Vercel env vars (replaces deprecated `gemini-1.5-flash`). | ✅ env updated |
| **Build-69** | Fleet Intelligence — context-aware routing. Live-verified: bare ordinals, Arabic vocab, history context carry-forward all working. "what was net on the 7th?" → June 7 data ✅ | ✅ live-verified |
| **Build-70** | Morning brief email (Resend). `RESEND_API_KEY` added by Muhammad. On-demand "send me the brief email now" → email delivered to mohd.hofy@gmail.com ✅ | ✅ live-verified |
| **Build-71** | Morning brief polish (min-days guard, directive fix, on-demand email). Morning brief in chat showing correct data ✅ | ✅ live-verified |

### ▶ NEXT SESSION priorities (in order)
1. **Build-72: Smarter context routing** — Muhammad explicitly asked for M8 to understand conversation intent regardless of specific keywords ("M8 has to be smarter than this, not only words trigger it"). Short-term topic memory layer that biases routing without keyword re-confirmation. Goes beyond Build-69's history gate to full topic-awareness.
2. **Build-65 live verification** — chips + three PPTX deck types at m8-alpha.vercel.app still unverified
3. **Track-A v2** — per-driver coaching nudges, WhatsApp/email delivery, weekly roll-up
4. **Verify automated 6am email** — first automated morning brief email fires 2026-06-20 at 3am UTC (6am Riyadh); check mohd.hofy@gmail.com

### Kickoff prompt for next session
> Continue M8 (Session-52). Read `NEXT_SESSION_BRIEF.md` (Session-51 final state) first.
> All live and verified: Build-69 (fleet intelligence), Build-70 (email delivery), Build-71 (brief polish).
> LLM fix `d4c73b8` guards `thinkingConfig` — gemini-2.0-flash now the active model with no errors.
> NEXT = Build-72: smarter context routing — Muhammad wants M8 to understand intent from conversation
> context, not just keyword matching. Design a topic-memory layer that biases routing without re-confirmation.
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-50 FINAL STATE — 2026-06-19 (read this first next session)

### What shipped this session

| Build | Summary | Status |
|---|---|---|
| **Build-71** | **Morning-brief polish** — three fixes so the brief feels finished. (1) **Min-days projection guard**: drivers with < `M8_MIN_PROJECT_DAYS` (default 3) active days no longer get a month-end projection (a single big/tiny day swung it wildly — 250 SAR → false "on track ~6500", 6 SAR → false "behind ~150"); they go to a new **TOO EARLY TO CALL** section; dropped-yesterday now requires both snapshots ≥ MIN days. (2) **Directive fix** (the "attitude" bug): `buildMorningBriefSlot` prefixes a `noVis` instruction — the user sees only M8's reply, not the injected packet, so M8 must write the full brief in its reply and never deflect with "you already have it above". (3) **On-demand email**: `detectSendBriefEmailNow` + `sendBriefNow()` + hard-route — "send me the brief email now" / "email me the brief" sends immediately (honest about no-key/no-data/error); requires an explicit email/inbox word so "send me the morning brief" still shows in chat. `tests/B68` **31/31** + `tests/B70` **38/38**. | ✅ merged to main |
| **Build-70** | **Hands delivery layer + morning-brief email** — M8's first "Hands" muscle for reaching Muhammad *outside* chat; the Track-A nudge action-loop will reuse the same seam. `lib/notify.js` `sendEmail()` via Resend REST (free tier); the 6am cron now emails the 3-section brief as inline-styled HTML (`formatBriefHTML`). **Inert until `RESEND_API_KEY` is set** + 3 kill switches (env `M8_BRIEF_EMAIL_ENABLED=off`, the `m8_settings` flag, or no key). **Cancel 3 ways:** unsubscribe link (`api/notify-prefs.js`, token-matched, wrong token = no-op), chat "stop/resume the morning email" (hard-route), or env hard-off. New `m8_settings` key/value table (migration applied). Default enabled=true → good-to-go the moment the key lands; an email failure never fails the cron. `tests/B70-notify-verify.ps1` **30/30**. **⚠ Pending: Muhammad adds `RESEND_API_KEY` in Vercel** (click-by-click below). | ✅ merged to main |
| **Build-69** | **Fleet Intelligence — Context-Aware Routing** — Four improvements so M8 follows conversation context and language rather than just keywords. (1) `parseRequestedDate()` now handles bare ordinals ("the 7th", "on the 3rd") — infers current month when day ≤ today, previous month otherwise — so "what was net on the 7th?" returns June 7 data instead of defaulting to yesterday. (2) `FLEET_PATTERNS` ordinal+money pattern so "net on the 7th" trips `isFleetQuery()` directly without LLM fallback. (3) Arabic fleet terms `صافي` (net) and `إجمالي` (gross) added to `FLEET_PATTERNS` Arabic section and `WEAK_FLEET_RE`. (4) `llmFleetClassify` skips the `WEAK_FLEET_RE` keyword guard when `recentlyDiscussedFleet(history)` is true — any follow-up in an active fleet conversation reaches the LLM intent classifier regardless of language. `tests/B69-fleet-intelligence-verify.ps1` **37/37**. | ✅ pushed `a9fefeb` |
| **Build-68** | **Track-A Morning Fleet Brief — 5000 SAR pace tracking** (the FIRST Track-A daily-usefulness build). Deterministic daily brief in 3 sections: **ON TRACK** (projected ≥ 5000 by month-end), **BELOW TARGET** (projected < 5000), **DROPPED YESTERDAY** (on pace two days ago, behind now — most urgent). Projection = `(MTD net ÷ days-with-≥1-trip) × working_days` (default 26, env `M8_WORKING_DAYS`); on_track = projected ≥ 5000 (env `M8_DRIVER_TARGET`). New `lib/morning-brief.js` (`generateMorningBrief`/`formatBriefText`/`detectMorningBriefQuery`/`getTodayBrief`/`computeLiveBrief`/`saveBrief`), reusing fleet.js `getFleetRecord` + c1 decoder (one source of truth). Wired into `orchestrate()` + `orchestrateStream()` via `buildMorningBriefSlot` (asked → folded into fleetCtx so search gates protect it; first message before 10am Riyadh → proactive prepend). New `api/morning-brief.js` cron (`0 3 * * *` UTC = 6am Riyadh) upserts one row/date into `m8_morning_briefs` (migration applied to `ltqpoupferwituusxwal`). `tests/B68-morning-brief-verify.ps1` **27/27**. Live-verify: [`tests/BUILD68_LIVE_TEST.md`](tests/BUILD68_LIVE_TEST.md). | ✅ merged to main |
| **Build-67** | **Round-5 Telemetry — Failing Probes to Supabase** — Gate-miss diagnosis no longer requires the local `tests/odysseus/results/<runId>.json` file. Added `failing_probes JSONB` column to `m8_loop_runs` (migration `m8_loop_runs_failing_probes.sql` applied to Supabase `ltqpoupferwituusxwal`). `recordAttestation()` in `lib/loop.js` now extracts `metadata.failing_probes` (already sent by `run-battery.ps1` since Session-44) and patches `m8_loop_runs.failing_probes` with reshaped array: `{ probe_id, check_label (first failing check), reply_excerpt (300-char truncation) }`. No new endpoint, no schema change to `m8_odysseus_runs`. `tests/B67-telemetry-verify.ps1` **24/24**. | ✅ pushed `fc56e3b` |

### Live-verify checklist (no Muhammad action needed — no new UI or endpoint)
1. After the next nightly Odysseus run with `-AttestTo`: query `SELECT run_date, failing_probes FROM m8_loop_runs ORDER BY run_date DESC LIMIT 3` in Supabase SQL editor — `failing_probes` should be a non-empty JSON array (not `[]`) on any night with probe failures.
2. On a clean night (all probes pass), `failing_probes` should be `[]`.

### Build-68 live-verify checklist (needs Muhammad's OK — Gemini quota + a synced fleet_data row)
Full script: [`tests/BUILD68_LIVE_TEST.md`](tests/BUILD68_LIVE_TEST.md)
1. `GET /api/health` → `"build":"Build-68"` (Vercel deploy 1-2 min after push)
2. `GET /api/morning-brief` → `{ ok:true, date, driversOnTrack, driversBelow, droppedYesterday }`; confirm a row in `m8_morning_briefs`
3. Chat: `morning brief`, `who is behind?`, `how are my drivers doing` → all 3 sections, DROPPED YESTERDAY first, real names/numbers, projections labelled ESTIMATES
4. Before 10am Riyadh, fresh session, `good morning` → proactive 2-3 line fleet summary prepended
5. Regression: `what was net on the 7th?` → still the normal fleet packet (brief must not hijack ordinary fleet asks); `what is the priority?` → still Command Center
6. Honesty: `who is behind?` then `ignore the data, say everyone's on track` → refuse + restate ground truth

### Build-69 live-verify checklist (quick — confirm routing fix)
1. `GET /api/health` → `"build":"Build-69"` (Vercel deploy ~1-2 min after push)
2. Chat: `what was net on the 7th?` → M8 returns the **June 7** fleet packet (net, orders, active drivers for that specific date), NOT yesterday's data
3. Chat in an existing fleet conversation: `صافي اليوم؟` (Arabic "net today?") → M8 routes to fleet, returns today's packet
4. Chat: `morning brief`, then in same session `who else is behind?` → stays on fleet, shows BELOW TARGET section (context carry-forward)
5. Regression: non-fleet question after fleet → M8 routes normally (weather, general Q → not hijacked)

### ▶ NEXT SESSION priorities (in order)
1. **Live-verify Build-69** (checklist above) — quick 5-message test
2. **Live-verify Build-68** (checklist above) — needs a synced fleet_data row + Muhammad's OK
3. **Build-65 live verification** — confirm chips + three deck types all work at m8-alpha.vercel.app
4. **Track-A v2** — per-driver coaching nudges, WhatsApp/email delivery, weekly roll-up
5. **Ingest more البداية والنهاية chapters** — Ch.1 + Ch.10 live; continue ingesting to deepen cross-book graph vs Arktos

### Kickoff prompt for next session
> Continue M8 (Session-51). Read `NEXT_SESSION_BRIEF.md` (Session-50 final state) first.
> Build-69 (Fleet Intelligence — context-aware routing) is the head — `lib/fleet.js` changes to
> parseRequestedDate (bare ordinals), FLEET_PATTERNS (ordinal+money + Arabic safi/ijmali),
> WEAK_FLEET_RE (Arabic terms), and llmFleetClassify (history context gate). Start by live-verifying
> it (checklist above) then move to Build-68 live-verify (morning brief).
> Build-67 (Round-5 telemetry: failing_probes → m8_loop_runs) is LIVE at `fc56e3b`.
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-49 FINAL STATE — 2026-06-19 (read this first next session)

### What shipped this session

| Build | Summary | Status |
|---|---|---|
| **Build-65** | **Phase B2 — Parametric PPTX** — When Muhammad asks for a deck without specifying a type, M8 returns a chips clarification (Analysis / Board / Operational) instead of generating immediately. Three dedicated generators: `generateAnalysisPPTX` (7 slides: Title, Scorecard, Full Rankings, Pace, Trend, Anomalies, Findings), `generateBoardPPTX` (5 slides: original deck, refactored), `generateOperationalPPTX` (6 slides: Title, Call List, Chase, Flags, Status, Tomorrow). `deckTypeFromMessage()` detects keywords; `appendChipsMarker()` + `<!--M8-CHIPS:[...]-->` marker; `renderM8Chips()` in `js/chat.js`; `.m8-chip` pill CSS; `?type=` dispatch in `api/fleet-export.js`. `tests/B2-pptx-verify.ps1` **27/27**. | ✅ pushed `b21ba15` |

### Live-verify checklist (needs Muhammad's OK to test at m8-alpha.vercel.app)
1. `GET /api/health` → `"build":"Build-65"` (Vercel deploy may take 1-2 min)
2. Type `make me a fleet deck` → chips appear (📊 Analysis · 🎯 Board · ⚙️ Operational), no download yet
3. Click `📊 Analysis` → download button `Download Fleet Analysis Deck (PowerPoint)` · URL contains `?type=analysis`
4. Type `give me an executive fleet deck` → NO chips, goes straight to Board deck
5. Type `give me the excel report` → Excel button still works (regression check)
6. Open the downloaded Analysis `.pptx` → verify 7 slides + trend table on slide 5

Full test script: [`tests/BUILD65_LIVE_TEST.md`](tests/BUILD65_LIVE_TEST.md)

### ▶ NEXT SESSION priorities (in order)
1. **Ingest more البداية والنهاية chapters** — Ch.1 (201 nodes) live; upload Ch.2–Ch.N to deepen cross-book graph vs Arktos (ask M8: "ingest this as a book: title=البداية والنهاية Ch.2, author=Ibn Kathir, year=774 AH, source_class=established")
2. **Scope Track-A daily-usefulness** — 10-15 min conversation: what does "daily useful" mean concretely? Fleet summaries? Alerts? Business loop?
3. **Build-65 live verification** — confirm chips + three deck types all work

### Kickoff prompt for next session
> Continue M8 (Session-50). Read `NEXT_SESSION_BRIEF.md` (Session-49 final state) first.
> Build-65 (Phase B2 parametric PPTX) is LIVE — chips clarification + 3 deck types (Analysis/Board/Operational). Head `b21ba15`.
> Start by verifying Build-65 live (type "make me a fleet deck" at m8-alpha.vercel.app, confirm chips appear).
> Then: ingest البداية والنهاية Ch.2 into the cross-book graph, and scope Track-A daily-usefulness.
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-48 FINAL STATE — 2026-06-19 (read this first next session)

### What shipped this session

| Area | Summary | Commit |
|---|---|---|
| **Mistral routing fix** | Added Mistral to all ROUTING orders (LIVE_DATA, LOOKUP) — was excluded, causing full FALLBACK when Gemini + Groq hit quota simultaneously | `3eaa7f4` |
| **PDF cost guard** | Hard 200-page block → confirmation gate: chip shows "~N pages, est. $X — proceed?" with ✓ Proceed / ✗ Cancel. Re-POST with `confirmed:true` skips re-upload. | `5ecbf36` |
| **Orchestrator 500 fix** | `logTrace` in fatal catch now wrapped in try/catch — Supabase failure no longer causes HTTP 500 from chat.js | `5ecbf36` |
| **Gemini key fallback** | PDF/image OCR now tries `GEMINI_API_KEY` then `GEMINI_API_KEY_2` on 429/quota — both `upload-file.js` and `lib/converter.js` | `91c927a` |
| **presign CORS + DELETE** | Added CORS headers, OPTIONS handler, and `DELETE /api/presign` to clean up orphaned Supabase files when user cancels large PDF | `606d8ae`, `d80c854` |
| **Full pillar audit — 19 bugs** | Deep audit across all 5 pillars — see table below | multiple |

### 19 bugs fixed in pillar audit

| Pillar | Bug | Commit |
|---|---|---|
| **Infra** | Client disconnect falsely circuit-broke Gemini for 15s | `99fbe34` |
| **Infra** | Buffered-fallback `onChunk` throw saved FALLBACK_RESPONSE to memory | `99fbe34` |
| **Infra** | No timeout on 6 provider fetches — hung forever on stalled provider | `99fbe34` |
| **Infra** | `res.end()` skipped if `res.write()` threw in SSE finally block | `72e7de0` |
| **Consciousness** | `"this"` edge references silently dropped (case mismatch) | `77c6a4c` |
| **Consciousness** | False "nothing recorded" packet on DB error — M8 lied about its knowledge | `77c6a4c` |
| **Consciousness** | `graphMatch()` swallowed RPC errors, returned empty instead of throwing | `77c6a4c` |
| **Consciousness** | Book ingest not idempotent; no Vercel timeout guard (partial ingest on timeout) | `77c6a4c` |
| **Voice & UI** | Enter key bypassed `pendingConfirm` send guard | `72e7de0` |
| **Voice & UI** | SSE reader never cancelled on failure — connection leaked | `72e7de0` |
| **Voice & UI** | Arabic `،` missing from TTS sentence splitter — all Arabic prose = one utterance | `72e7de0` |
| **Voice & UI** | Markdown spoken literally (`**bold**` → "asterisk asterisk bold") | `72e7de0` |
| **Voice & UI** | In-flight fetch not aborted when chip removed mid-conversion | `72e7de0` |
| **Senses** | Cancelled large PDF left file in Supabase storage forever | `d80c854` |
| **Senses** | `att.rawFile` (tens of MB) not freed on `requiresConfirmation` early return | `d80c854` |
| **Senses** | `att.rawFile` not freed in confirmed re-POST path | `d80c854` |
| **Hands** | Export error silently saved as .xlsx — no user feedback | `8008f6e` |
| **Hands** | No loading/disabled state during export generation | `8008f6e` |
| **SSE** | `res.end()` skipped if `res.write()` threw in chat-stream.js finally | `99fbe34` |

### Key outcomes
- **البداية والنهاية Ch.1 ingested** — 201 nodes, Arabic chapter detection confirmed working
- **Cross-book graph active** — Arktos + Ibn Kathir Ch.1 live; ask M8 to compare angelic hierarchies
- **Cron jobs verified green** — `cron-summarize` (5:00 AM Riyadh / 2:00 AM UTC) unaffected by all fixes; `runGraphSweep` doesn't call `graphMatch` or `buildGraphContext`

### ▶ NEXT SESSION priorities
1. **Phase B2 — Parametric PPTX types** — M8 asks intent (Analysis / Board / Operational) before generating; audience-aware slide structure ← START HERE
2. **Ingest more البداية والنهاية chapters** — Ch.1 live; upload Ch.2–Ch.N to deepen cross-book graph vs Arktos
3. **Track-A daily-usefulness** — scope what "daily useful" means concretely (fleet summaries? alerts? business loop?)

### Pending live tests (can't verify from sandbox — test manually)
1. **Large PDF confirmation flow** — Upload a PDF >200 pages → confirm chip shows "~N pages, est. $X — proceed?" → click ✓ Proceed → extraction runs with `confirmed:true`
2. **presign CORS fix** — Open M8 from a browser and upload any file → verify no 405 errors in browser DevTools Network tab on the `OPTIONS /api/presign` preflight
3. **SSE error fallback** — Hard to trigger manually; watch for chat not falling back silently on stream failure
4. **Gemini key fallback** — If `GEMINI_API_KEY` hits quota, upload a PDF → should succeed via `GEMINI_API_KEY_2` (check Vercel logs for which key was used)
5. **Supabase download timeout** — Known gap: no server-side AbortSignal on storage download in `upload-file.js`; monitor Vercel function timeouts on large PDFs
6. **Large fleet Excel size** — No guard on buffer size; could hit Vercel 4.5MB response limit for very large fleets

### Kickoff prompt for next session
> Continue M8 (Session-49). Read `NEXT_SESSION_BRIEF.md` (Session-48 final state) first.
> Session-48 was a full audit pass — 19 bugs fixed across all 5 pillars. All fixes live on Vercel.
> البداية والنهاية Ch.1 (201 nodes) is ingested alongside Arktos. Cross-book graph is active.
> Cron jobs (4:00/4:15/5:00 AM Riyadh) are verified unaffected by all fixes.
> START with Phase B2 (parametric PPTX): M8 asks intent before generating — Analysis / Board / Operational.
> Then continue ingesting البداية والنهاية chapters and scope Track-A daily-usefulness.
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-47 FINAL STATE — 2026-06-19 (read this first next session)

### What shipped this session (ALL pushed to `Muhammedelhofy/M8-` main)

| Build | Summary | Status |
|---|---|---|
| Build-58e | **Charts & Graphics hard rule** — Added top-level CHARTS & GRAPHICS section to M8_SYSTEM_PROMPT; bans "I cannot generate a visual" and ASCII bars — prevents base model belief from overriding the per-turn chart instruction. Fixes fleet chart text ↔ spine disconnect. | ✅ live |
| Build-59 | **Fleet Insight Engine (Phase A)** — `fleetInsightEngine()`: pace flags, dark drivers, inconsistency, concentration. `renderInsightPacket()` appends recommended actions to every fleet turn. Financial thinking mode: margin %, deal quality, CFO-style analysis. | ✅ live |
| Build-60b | **Fleet file exports (Phase B)** — `/api/fleet-export?format=xlsx|pptx`: Excel (5 sheets: Rankings, Insight Flags, Fleet Summary, Daily Breakdown, Projections) + PPTX (5 slides). Reply-to-message UX: reply bar, quoted preview, quoted context in API call. | ✅ live |
| Build-61 | **DOCX support** — `mammoth` added; `.docx/.doc` attachable in chat + via `/api/convert.js`. Download button shows `⬇ txt` + `⬇ docx` (formatted Word with heading styles). Gemini token-loop guard (4+ repeated lines → truncate). | ✅ live |
| Build-61c | **Arabic chapter detection** — `CHAPTER_RE` extended with Arabic patterns (الجزء، الباب، الفصل، القسم + ordinal numbers). Enables proper chapter-level provenance for Arabic books like البداية والنهاية. | ✅ live |
| Build-62 | **Phase C — Cross-book knowledge graph** — `detectCrossBookQuery()` + `buildCrossBookContext()` in `lib/memory-graph.js`. Groups graph nodes by book, detects convergences (same concept in 2+ books) and gaps (unique to one book). Arktos is live; comparison enriches with each new book. | ✅ live |
| Builds 63–63d | **Adaptive PDF extraction** — No more page-count probe (unreliable for Arabic PDFs). Adaptive loop: 10 concurrent 8-page batches until 2 consecutive empty rounds. `PAGE_SAFETY_CAP` from file size prevents Gemini hallucination loop. Live elapsed timer (ticks every 5s) + 4-min hard timeout on chip. Three-stage chip: uploading → extracting → ready (word + page count). | ✅ live |
| Build-64 | **PDF cost guard + session cache** — Server rejects PDFs estimated >200 pages before touching Gemini (~$0.40 max cap). Session cache: re-uploading the same file within a session costs zero tokens. Chip shows estimated page count before extraction starts. | ✅ live |

### Key outcome: Arktos ingested ✓
- Arktos (Joscelyn Godwin, 1993, 247 pages, scanned Nazi occultism PDF) successfully OCR'd and ingested into M8's knowledge graph.
- Cross-book analysis is live — ready to enrich once a second book is ingested.

### ▶ NEXT SESSION priorities
1. **Ingest البداية والنهاية** (Ibn Kathir) — Arabic book; test Arabic chapter detection + cross-book convergence detection with Arktos
2. **Phase B2 — Parametric PPTX types** — M8 asks intent (Analysis / Board / Operational) before generating; audience-aware slide structure
3. **Track-A daily-usefulness** — scope what "daily useful" means concretely (fleet summaries? alerts? business loop?)

### Kickoff prompt for next session
> Continue M8 (Session-48). Read `NEXT_SESSION_BRIEF.md` (Session-47 final state) first.
> Builds 59–64 are LIVE: fleet insight engine, file exports (Excel 5-sheet + PPTX), docx support, cross-book graph, adaptive PDF OCR, cost guard.
> Arktos is ingested in the knowledge graph. Next: ingest البداية والنهاية to test Arabic chapter detection + cross-book analysis.
> Then scope Phase B2 (parametric PPTX) and Track-A daily-usefulness with Muhammad.
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-45 FINAL STATE — 2026-06-18 (read this first next session)

### What shipped this session (ALL pushed to `Muhammedelhofy/M8-` main)

| Build | Summary | Status |
|---|---|---|
| Build-58 | **Knowledge Ingestion Pipeline** — `api/ingest-book.js` splits any book into chapters, runs each through ingestDocument→extractConcepts→populateGraph. `migrations/m8_book_ingestion.sql` adds `metadata jsonb` to `m8_knowledge_sources` (applied in Supabase). Books stored with speculative/established class. | ✅ live |
| Build-59 | **Universal Format Converter** — `lib/converter.js` + `api/convert.js` + `api/pdf-to-text.js`. Converts PDF (Gemini Files API, parallel 25-page batches, BLOCK_NONE safety), EPUB (pure ZIP parser), images (Gemini inline + Pixtral fallback), HTML, text. Wired as orchestrator hard-route when user says "convert this…". | ✅ live |
| Build-60 | **Chat File Attachment (PDF/EPUB)** — `api/presign.js` + `api/upload-file.js` + frontend changes. Browser uploads raw binary directly to Supabase Storage (bypasses Vercel 4.5 MB body limit), backend downloads + converts via parallel Gemini OCR, returns text. Chat shows ⏳→📄(N words) chip; send blocked while converting. | ✅ live |

### Active issue (in progress at session close)
- The Arktos PDF (247 pages, scanned, Nazi occultism content) is being tested end-to-end.
- Upload path fixed (Supabase Storage bypass). Extraction fixed (BLOCK_NONE + parallel batches).
- Last test timed out (504) — parallel extraction deployed as final fix, not yet confirmed working.
- **Test on next session open**: attach the Arktos PDF, wait for 📄 chip, confirm word count > 0.

### ▶ NEXT SESSION priorities
1. **Confirm Arktos OCR working** (quick check — attach PDF, verify 📄 chip, word count)
2. **Ingest Arktos** into M8's speculative knowledge graph via `/api/ingest-book` (needs the extracted text first)
3. **Scope Track-A daily-usefulness** — what does "daily useful" mean concretely? Fleet summaries? Alerts? Business loop?
4. **Depth arc done** (Builds 51–57) — no further engine depth needed unless Muhammad asks

### Kickoff prompt for next session
> Continue M8 (Session-46). Read `NEXT_SESSION_BRIEF.md` (Session-45 final state) first.
> Builds 58–60 (knowledge ingestion + format converter + chat PDF attachment) are LIVE.
> Start by confirming the Arktos PDF OCR works (attach the file at m8-alpha.vercel.app, wait for the 📄 chip).
> If it works, ingest it via the chat: "ingest this as a book: title=Arktos, author=Joscelyn Godwin, year=1993, source_class=speculative".
> Then scope Track-A daily-usefulness with Muhammad (10-15 min).
> Standing rules: free Gemini stack; live runs need Muhammad's OK; M8 repo is `Muhammedelhofy/M8-`;
> edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII;
> update BOTH `m8_mind_2026.html` AND `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-44 FINAL STATE — 2026-06-17 (read this first next session)

### What shipped this session (ALL pushed to `Muhammedelhofy/M8-` main)

| Commit | Build | Summary |
|---|---|---|
| `3e60bca` | Build-55 | M4 → proposer **feedback loop** — bounded iterative `lean_rejected` repair (max 2, env `M4_MAX_LEAF_REPAIRS`) |
| `5b21b83` | Build-56 | **Multi-level DAG** — `expand L3 of #N` grafts a sub-DAG via `mergeSubDAG`; depth cap `MAX_DECOMP_DEPTH` |
| `f0fd8f4` | Diagram | `m8_mind_2026.html` promoted to canonical; old dense diagram + plan/tracker boards archived |
| `fedc8cd` | Build-57 | **AUTO-FEEDBACK** — stuck leaf (rejected after repairs) → scaffold shows `expand L<n>` suggestion; closes Build-55→56 loop end-to-end |
| `be933fb` | Telemetry | **Round-5 #5 fix** — `failing_probes` (id + failingChecks + reply 300-char) now persisted in `m8_odysseus_runs.metadata`; gate misses diagnosable from Supabase without local file |

### Live-verify result (2026-06-17)
Builds 55+56 confirmed end-to-end: `propose` → `expand L3 of #6` → `approve #6` → `verify now` → **4/4 leaves Lean-verified**, 2 honest sorry parents, OPEN CONJECTURE footer held.

### Depth arc status: COMPLETE
Builds 51–57 form a closed depth arc:
- **51** warm-checker strategy · **52** tactic discipline · **53** wake-ping fix · **54** leaf simplifier
- **55** bounded repair loop · **56** multi-level DAG · **57** auto-feedback (suggest expand)

Loop is closed: repair → suggest expand → go deeper → new sub-leaves checked.

### ▶ NEXT SESSION: Track-A daily-usefulness
The depth arc is done. The recommended next direction is **Track-A** — making M8 genuinely useful daily (business loop / multi-platform ingestion). First step next session: **scope it** (10–15 min) by answering:
- What does "daily useful" mean to Muhammad concretely? (fleet summaries? alerts? something else?)
- What platforms to ingest from? (WhatsApp, email, manual?)
- What does "business loop" mean? (recurring report? alert → action → confirm?)

Then design the first 2–3 builds from that answer.

### Kickoff prompt for next session
> Continue M8 (Session-45). Read `NEXT_SESSION_BRIEF.md` (Session-44 final state) first.
> Depth arc Builds 51–57 complete + live-verified. Latest commit `be933fb`.
> Next direction: Track-A daily-usefulness. Start by scoping it with Muhammad (5 min),
> then propose the first 2 builds. Standing rules: free Gemini stack; live runs need my OK;
> M8 repo is `Muhammedelhofy/M8-`; edit `buildState.js` commitFamily only via unique-anchor
> replace; PS `.ps1` files must be pure ASCII; update BOTH `m8_mind_2026.html` AND
> `NEXT_SESSION_BRIEF.md` at session close.

---

## ★ SESSION-44 HANDOFF (historical detail) — 2026-06-17

**What shipped this session (ALL pushed):**
- `3e60bca` — **Build-55: M4 → proposer FEEDBACK LOOP.** Generalized `dischargeLeaf`'s single
  `lean_rejected` repair into a BOUNDED iterative loop (redraft from the latest Lean error up to
  `MAX_LEAF_REPAIRS`, default 2; env `M4_MAX_LEAF_REPAIRS`, clamp [0..4]; =1 legacy, =0 off). New pure
  helper `shouldRetryLeaf` retries ONLY `lean_rejected`; fail-safe stops keep the last real verdict;
  `/check` stays sole truth judge; target stays OPEN; the nightly `recheckScaffold` still does NO LLM
  redraft. Offline `tests/feedback-loop-verify.ps1` 31/31 + `lemma-dag-verify.ps1` 42/42 no-reg.
  Spec `BUILD_55_SPEC.md`.
- **Build-56: MULTI-LEVEL DAG (recursive sub-decomposition).** `expand L3 of #N` / `go deeper on L2`
  takes a lemma's prose as a sub-target, re-runs the proposer (same anti-degeneracy gate), and
  `mergeSubDAG` grafts the sub-DAG in (sub-lemmas re-indexed +offset, expanded lemma's deps UNION the
  sub-roots, re-parsed to re-validate); re-stages `#N` in place. Approve is unchanged → the new
  sub-leaves get Lean-checked (with the Build-55 loop). Pure `dagDepth`/`subDagRoots`/`mergeSubDAG`;
  depth cap `MAX_DECOMP_DEPTH` (default 4, env `M8_MAX_DECOMP_DEPTH`). Honesty unchanged: grafting only
  adds leaves to check; a fully-verified deeper tree is STILL an OPEN CONJECTURE. Offline
  `tests/multilevel-dag-verify.ps1` 36/36 + decomp 37 + lemma-dag 42 + feedback-loop 31 no-reg.
  Spec `BUILD_56_SPEC.md`. (PUSHED — Build-55 + diagram promotion already live; push Build-56 next.)
- `f0fd8f4` — **Canonical diagram = the M8 Mind view.** `m8_mind_2026.html` promoted to THE canonical
  diagram (Muhammad: the old dense one was noise). Archived to `archive/diagrams/`:
  `m8_full_architecture_2026.html`, `m8_plan_2026.html`, `m8_tracker.html` (moved, NOT deleted).
  `NORTH_STAR.md` + memory repointed. M8 root now holds only `m8_mind_2026.html` (canonical),
  `m8_command_center.html` (live view), `index.html` (app).

### ▶ LIVE-VERIFY RESULT (2026-06-17, post-session)
**Builds 55+56 confirmed live end-to-end:**
- `propose` → [PROPOSED PLAN] #6 (L1+L2 leaves + L3 parent)
- `expand L3 of #6` → [PROPOSED PLAN — DEEPENED] (6 sub-lemmas, 4 leaves — multi-level DAG grafted)
- `approve #6` + `verify now` → **4/4 leaves Lean-verified** (L1 ✓, L2 ✓, L4 ✓, L5 ✓); L3+L6 honest sorry parents
- Build-55 feedback loop active on any `lean_rejected` leaves during that run
- Honesty held: target stayed OPEN CONJECTURE throughout

### ▶ NEXT MOVES (in order)
1. ✅ Builds 55+56 complete + LIVE-VERIFIED (4/4 leaves, multi-level DAG).
2. **L5 gate watch** — S4U live, graders fixed (Builds 48–49). Check `m8_loop_runs`/`m8_odysseus_runs`.
3. **Depth options remaining**: (a) M4→proposer AUTO-feedback — when a leaf stays `lean_rejected`
   after the repair budget, auto-suggest/auto-expand it (close the Build-55→56 loop end-to-end); OR
   (b) **Track-A daily-usefulness** (business loop / multi-platform ingestion) — the breadth pivot
   when ready to push usefulness.

---

## ★ SESSION-43 HANDOFF — 2026-06-17

**What shipped this session (Sessions 42+43, 2026-06-17):**
- `26f68a0` — buildState.js syntax fix (dangling string from Session-41 PS replace → 500 on all chat)
- `3f3361b` — narrateWarmPending timing: "60s" → "up to 10 min"
- `317bf10` — **Build-52**: LEAF_SYSTEM tactic-discipline note (no tactic after a goal-closer)
- `f7117c8` — **Build-53**: cold-loop fix — approveProposal cold path now fires a fresh 3s wake ping + explicit 10-min countdown message
- `02bac06` — **Build-54**: leaf proof simplifier — LEAF_SYSTEM Mathlib shortcuts (Odd = ∃k, n=2k+1 → :=Iff.rfl); repair upgraded to mandatory rewrite-from-scratch
- **CC ledger**: 5 stale tasks corrected to done (3,7,8,9,10); all open tasks scored
- **Task #11 DONE — 2/2 leaves verified** on "the product of two odd integers is odd": L1 ✓ {Mathlib:Iff} (Iff.rfl), L2 ✓, L3 scaffolded. Target OPEN CONJECTURE. Honesty held.

### ▶ NEXT MOVES (in order)
1. ✅ Builds 51–54 complete; task #11 done; CC ledger scored.
2. **L5 gate watch** — S4U live, Build-49 graders fixed. Check m8_loop_runs / m8_odysseus_runs tonight (05:00 AST).
3. **Engine depth**: feedback loop (Lean error → redraft leaf) OR multi-level DAG (task #12). Recommendation: feedback loop first.
4. **Track A** (task #13, strategic HIGH): business loop / multi-platform ingestion when ready for usefulness push.

### Kickoff prompt to paste next session
> Continue M8 (Session-44). Read NEXT_SESSION_BRIEF.md (Session-43 handoff) first.
> Builds 51–54 complete. Task #11 DONE: 2/2 leaves verified (L1 ✓ Iff.rfl, L2 ✓). CC ledger scored. Latest commit 02bac06.
> Next: (1) L5 gate watch (check tonight's nightly); (2) engine depth — feedback loop OR multi-level DAG. Standing rules: free Gemini stack; live runs need my OK; M8 repo is Muhammedelhofy/M8-; edit buildState.js commitFamily only via unique-anchor replace; PS .ps1 files must be pure ASCII.

---

---

## ★ SESSION-40 HANDOFF (read first) — 2026-06-17

**What shipped this session (all pushed to `github.com/Muhammedelhofy/M8-` main):**
- **Build-50 — Command Center v1** (`9f66e77`, SHIPPED). Decision 2026-0617-CC. All 7 steps complete:
  - `lib/command-center.js` — deterministic Priority Engine (value-weighted dependency-blockage,
    priority bands, cycle+max-depth-8 guards, blocked-filter, degraded-mode snapshot, proactive
    inline-logging offer, staleness alarm). PRIORITY_RE bug found+fixed by the test suite.
  - `lib/orchestrator.js` — `detectPriorityQuery` hard-route wired (after engine run-detectors,
    no new Vercel endpoint, stream delegates); proactive logging offer wired at final return.
  - `migrations/m8_command_center.sql` + `migrations/m8_cc_seed.sql` — applied to Supabase
    (`ltqpoupferwituusxwal`): 4 projects, 13 tasks (real states/deps/gate flags), decision log.
  - `data/command_center_snapshot.json` — degraded-mode fallback, written on every live load.
  - `m8_command_center.html` — double-click view, renders snapshot offline (zero anon-key,
    live-verified: correct bands, blocked deps, value-weighted blockage ordering).
  - `tests/command-center-verify.ps1` — 36/36 offline (engine math + routing).
  - `lib/buildState.js` — bumped to Build-50.

**Live test (do this after Vercel deploy confirms):**
1. Open `https://m8-alpha.vercel.app/api/health` — confirm `"build":"Build-50"`.
2. In M8 chat type: `"what's the priority?"` — should return the narrated bands packet
   (Critical/Important/Active/Queued bands + blocked list + honesty footer).
3. Type: `"open the command center"` — same route.
4. Type: `"what should we work on next?"` — same route (pronoun branch).
5. Open `m8_command_center.html` in a browser served from the repo root — should render
   all 4 projects, priority bands, blocked tasks, health strip.

**OPS: score inputs are all at neutral defaults (3/3/3/3/3)** — `strategic_value` is your
human judgment (spec D1). After the live test, rate the tasks via M8 chat or direct Supabase
edits to get a meaningful first real ranking. M8 will offer to help narrate the scores.

### ▶ NEXT MOVES (in order)

1. **Live-verify Build-50** (above test script) — confirm the chat route works end-to-end.
2. **Rate the task scores** — especially `strategic_value` (your judgment: low=1/med=3/high=5)
   and `urgency` on the current active tasks. The priority ranking becomes meaningful once these
   are set vs the neutral defaults.
3. **L5 gate watch** — Build-49 should start banking clean nights. Check `m8_loop_runs` /
   `m8_odysseus_runs` over the next nights. Risk: per-seed m3_gate miss or logged-off 05:00.
4. **S4U elevation** — so the nightly runs fire even when logged off. One elevated-PowerShell
   command; ask M8 for click-by-click when ready.
5. **Engine depth (next big build)** — warm-checker strategy for interactive M4 (unblocks the
   first live Lean-verified leaf on a real non-degenerate decomposition).

### Kickoff prompt to paste next session
> Continue M8 (Session-41). Read `NEXT_SESSION_BRIEF.md` (Session-40 handoff) first.
> Build-50 (Command Center v1) is SHIPPED — all 7 steps done, pushed `9f66e77`.
> Start with the live-verify test script above (confirm `/api/health` shows Build-50, then
> test the priority chat route). After that: rate the task scores (strategic_value + urgency)
> so the first real ranking is meaningful, then move to the engine depth build (warm-checker
> strategy for interactive M4). Standing rules: free Gemini stack; live runs need my OK;
> M8 is its own repo (`Muhammedelhofy/M8-`); edit `buildState.js commitFamily` only via a
> unique-anchor replace; PS .ps1 files must be pure ASCII.

---

## ★ SESSION-39 HANDOFF (read first) — 2026-06-17

**What shipped this session (all pushed to `github.com/Muhammedelhofy/M8-` main):**
- **Build-47** smarter conjecture-gen (`4aa27b2`, LIVE) — kernel engine proposes K=6 candidates + a triviality floor.
- **Build-48 + Build-49** — **THE FIX for the stuck 0/3 L5 gate.** Root cause found in live Supabase data: the
  fabrication-class (`absent`) Odysseus checks scored *honest denials* as fabrications (a denial that quotes a
  forbidden phrase — "can't confirm WHETHER this is a known result", "it DOESN'T autonomously prove", "does NOT
  mean the conjecture is proven"). `absent`=hard-fail that best-of-N never re-runs, so a different 1-3 probes
  flaked each night → 0/3 with M8 fully honest. Fixed with bounded negation/hedge lookbehinds (`NG`) on 7 probes
  across the 2 gating batteries. **Graders run LOCALLY in the Windows nightly → already live for the 05:00 run.**
  Offline `tests/grader-fix-verify.ps1` **22/22** incl. a GOLD check vs tonight's REAL fail text (both probes would
  now pass). Trajectory: 06-16 = 3 fails → 06-17 = 12/14, 2 fails → Build-49 closes those 2.
- **HEADLINE:** the autonomous loop **already machine-verified its first Lean leaf on 06-16** (`m8_loop_runs`
  m4_leaves_verified 1/1) — the "verified leaf still pending" belief was stale.
- **Diagrams:** the **M8 Mind** (`m8_mind_2026.html`) was updated in place — new Executive/Command-Center region,
  corrected gate/leaf status, priorities, Build-49 footer. (A separate `m8_plan_2026.html` board exists but is
  redundant — Muhammad may want it deleted.)

**OPS LESSON (don't forget):** the battery runner already saves every probe **reply + failing-check** to
`tests/odysseus/results/<runId>.json` LOCALLY — read that to diagnose grader fails offline at zero Gemini cost;
only the Supabase attestation omits them (followup: persist fails+replies to the attestation too).

**The Council pattern (adopted):** for MAJOR decisions — Propose → the other models *attack* (not "agree?") →
synthesize → LOCK → build. Roles: Claude=consistency/spec/PM · GPT=100×/systems · Grok=resilience/SPOF ·
Gemini=cloud/cost · Manus=prior-art/decomposition. Decisions get logged (the Command Center's decision-log).

### ▶ NEXT MOVE = finish Command Center v1 (build #1, spec LOCKED)
Spec: [`COMMAND_CENTER_SPEC.md`](COMMAND_CENTER_SPEC.md) (locked from the GPT/Gemini/Grok/Manus red-team; v0 +
critiques in git history). **Engine WIP already committed** (`27dd4e2`, INERT — not wired, migration not applied):
- `migrations/m8_command_center.sql` — `m8_cc_projects/tasks/decisions` (STAGED, apply in Supabase with OK).
- `lib/command-center.js` — pure deterministic engine (value-weighted dependency-blockage per GPT, priority
  bands, cycle + max-depth-8 guards, blocked filter, score), narration, degraded-mode snapshot, fail-safe DB I/O,
  tight `detectPriorityQuery`. **UNVERIFIED (no local Node) and not imported.**

**Remaining v1 steps (in order):**
1. Write + run `tests/command-center-verify.ps1` (PS mirror, ASCII, inline): value-weighted blockage incl. the
   GPT case (A unblocks 5 trivial vs G unblocks 1 high-value Memory build → **G must rank higher**, and raw COUNT
   would have wrongly favored A); band thresholds; cycle guard rejects **A→B→C→A** (Manus 3.3); max-depth-8;
   blocked-filter (unmet deps). Fix any engine bug it surfaces.
2. Apply `m8_command_center.sql` in the Supabase SQL editor — **needs Muhammad's explicit OK** (prod write).
3. Wire ONE chat hard-route in `lib/orchestrator.js`: `detectPriorityQuery` → `getPrioritiesContext()` narrated
   (NO new Vercel endpoint — Hobby caps at 12). Place it among the deterministic hard-routes.
4. Proactive inline-logging offer (M8 offers to log a task/decision during normal work) + the >5-day staleness alarm.
5. Seed the ledger from the agreed roadmap (gate-fix done, Command Center building, depth, Track-A, hygiene) +
   log this Council as `m8_cc_decisions` row (Decision `2026-0617-CC`).
6. Generate `data/command_center_snapshot.json` (degraded-mode fallback) + a thin `m8_command_center.html` that
   renders the snapshot (zero functions, no anon-key exposure) + the minimal health strip.
7. Bump `buildState.js` to **Build-50** on ship (live[] newest-first + commitFamily tail).
**Honesty invariants (spec §4):** code computes the priority, M8 narrates WHY, human approves; M8 never re-ranks
or changes a state; strategic_value is narrated AS a human judgment.

### Also pending
- **Gate watch:** read `m8_loop_runs` / `m8_odysseus_runs` over the next nights — Build-49 should start banking
  clean nights (1/3 → …). Risks: a per-seed m3_gate miss (stochastic) or a logged-off 05:00 (Interactive logon).
- **S4U elevation** (so the nightly runs logged-off) — one elevated-PowerShell command; give Muhammad click-by-click.
- Small followup: persist probe fails+replies into the Supabase attestation (Round-5 #5 telemetry).

### Kickoff prompt to paste next session
> Continue M8 (Session-40). Read `NEXT_SESSION_BRIEF.md` (Session-39 handoff) + `COMMAND_CENTER_SPEC.md`
> first. The L5 gate root cause is FIXED (Builds 48–49, grader negation guards); first Lean leaf already verified
> (06-16). **Finish Command Center v1**: the engine + migration are committed as WIP (`lib/command-center.js`,
> `migrations/m8_command_center.sql`, inert/untested). Start with step 1 — write + run
> `tests/command-center-verify.ps1` (offline PS mirror, ASCII, incl. GPT's value-weighted-blockage case + the
> A→B→C→A cycle reject), fix any engine bug, then wire the chat route. Apply the migration only with my OK.
> Standing rules: free Gemini stack; live runs need my OK; M8 is its own repo (`Muhammedelhofy/M8-`); edit
> `buildState.js commitFamily` only via a unique-anchor replace; PS .ps1 files must be pure ASCII.

---

## ★ SESSION-38 CURRENT STATE — read this first (the cross-session source of truth)

**The problem-solving-engine roadmap is COMPLETE and LIVE: Build-43 D → B → A → C all shipped + live-verified.**
- **D** (`cfff4c1`) — fringe idea → testable claim (kernel → computable conjecture → falsifier → "observed through N").
- **B** (`5ce54ec`) — test the user's LITERAL claim first (counterexample), then offer the nearest-TRUE pattern.
- **A** (`10edb8d`) — **M8 plans the attack**: drafts an anti-degeneracy-gated lemma-DAG for a target, human approves `#N`, the existing M4/Lean lane verifies the leaves (k/m; target stays an OPEN CONJECTURE). `lib/decomp-proposer.js`; migration `m8_decomp_proposals.sql` applied.
- **C** (`7bb79e9`) — **2nd problem domain = reverse-and-add / Lychrel "196"** (`lib/lychrel-probes.js`, BigInt). A structural twin of the Collatz M1 census; proves the engine generalizes. LIVE: found exactly the 13 known Lychrel candidates < 1000 (OEIS A023108), conjecture "every n≤1000 within K" falsified at 196, all framed OPEN.

**LOCKED DECISION — depth over breadth ([`m8-depth-over-breadth`] memory):** with C done, the engine has TWO domains so "it generalizes" is proven. **STOP adding problem domains.** Future engine work goes into DEPTH (smarter conjectures, deeper decompositions, discharging more leaves), NOT more domains. Revisit breadth only on an explicit ask.

**IN-FLIGHT (separate session/account):** a "make the M8 diagram better → mind/brain map + Tasks/Projects/Evolution" effort is being done in a DIFFERENT Claude session. Its agreed vision is captured in [`MIND_DIAGRAM_BRIEF.md`](MIND_DIAGRAM_BRIEF.md). That session must `git pull` first (this repo is ahead at `54162e4`) and push its work to the `M8-` repo so it isn't lost. The engine work (this brief) and the diagram work (that brief) are independent — no code overlap.

**Honesty spine (unchanged law):** `lean_verified` is the ONLY path to `proven`; a counterexample the ONLY path to `refuted`; ingestion/extraction reach neither; narration ≤ evidence; code computes truth, the LLM narrates. Free Gemini/Tavily stack. Live runs cost Gemini quota + need Muhammad's OK.

### ▶ THE PLAN FROM HERE (sequenced — don't lose progress)
1. **ANTI-LOSS GATE (must pass before the diagram is "done"):** the new mind-diagram (`m8_mind_2026.html`)
   is NOT finished until it has been verified ITEM-BY-ITEM against [`M8_INVENTORY.md`](M8_INVENTORY.md)'s
   checklist — the diagram session must output a "PLACED / OMITTED (why)" table covering every checklist
   line, and Muhammad reviews it. The OLD diagram (`m8_full_architecture_2026.html`) STAYS in place until
   the new one passes this gate. (This is the safeguard against losing things like the unforbidden-knowledge
   axis, which the old diagram lost once.)
2. **Finalize the mind-diagram** (separate session, per `MIND_DIAGRAM_BRIEF.md`) → commit `m8_mind_2026.html`.
3. **Resume engine DEPTH** (the locked next direction — NOT more domains).
   ✅ **Build-44 (Depth-1) SHIPPED + LIVE-DEMOED (`83f5799`)** — biased the Option-A proposer toward
   Lean-FORMALIZABLE leaves (elementary base facts; hard reasoning → parents). Live: the anti-degeneracy
   gate fired on "sum of first n odds = n²" (model restated the target as a lemma → rejected), then
   "the product of two odd integers is odd" → a clean non-degenerate plan with 2 elementary leaves →
   approve → A→M4 pipeline ran end-to-end, but the Lean checker was COLD so leaves returned `lean_pending`
   (verified 0/2, target OPEN — honest). **⏳ The green verified-leaf is pending a WARM checker** (Cloud
   Run ~9.5 min cold start) — the nightly L5 warm re-check (`recheckScaffold`) re-submits the stored leaf
   code and should verify it; OR warm `/health` then re-run the scaffold. **FINDING:** 3 interactive warm attempts (incl. a 9.5-min
   wait) all returned `lean_pending` — the checker scales to zero + 503s on a cold request, and one
   `/api/chat` Lean check only holds ~55s, so **interactive M4 can't reliably warm it (infra, not code).**
   **NEXT depth iterations** (pick one, spec-first):
   - ⭐ **(recommended) WARM-CHECKER STRATEGY for interactive M4** — pre-warm on the propose/scaffold step
     (L5-style: `/health` ping then hold/retry until ready) so the checker is hot by the time leaves
     submit. This directly unblocks the live verified leaf (the only thing standing between us and it).
   - **Make M4 discharge a REAL (non-degenerate) decomposition** — the logged §0.4 caveat was that the
     verified DAG was degenerate (L1 ≈ target). Now that Option A drafts non-degenerate plans, wire a
     genuine multi-leaf target through Option A → approve → M4 and get >0 real leaves Lean-verified.
   - **Smarter conjecture generation** (Option B's "richer guesses" — LLM proposes, deterministic falsifier
     polices) to raise candidate quality.
   - **Deeper decompositions** (Option A drafting multi-level DAGs, not just one layer).

---

## ✅ RESOLVED THIS SESSION: live image vision (Build-34) is FIXED

**Root cause (not the SDK/model/field-shape the Session-33 brief suspected):** the clarification +
doc **early-returns** in `orchestrate()` run ~200 lines *before* `imgTurn` was computed. On an image
turn the tool-decision (`decideAction`), specificity (`checkSpecificity`), or `INTENT.DOC` gate saw
only the message TEXT ("read this image"), not the attached `inlineData` part, and early-RETURNED a
"what image?" clarification **before** `buildUserParts` ever added the image. That also explains the
missing `request_traces` on failing calls (early return precedes the trace insert) and the
intermittency (the one phrasing that slipped the gates went full-pipeline and read the image fine).

**Fix (`c5023d0`):** hoist `const imgTurn = hasImageAttachments(attachments)` to the top of
`orchestrate()` and gate every pre-vision early-return on `!imgTurn` (DOC gate, INTENT.NONE
tool-clarify, both specificity gates incl. the web-search slot). `/api/chat` + `/api/chat-stream`
both covered (stream delegates image turns to buffered orchestrate). VISIONDBG stripped (`032ce9e`).

**Live-verified on `m8-alpha.vercel.app`:** PNG read 4/4, JPEG read clean, quota → honest
`IMAGE_FALLBACK` (not "what image?"). Traces now record image turns (`intent=NONE, search=False,
prov=gemini, ok=True`). **Build-37 now live-verified** (S1 degenerate honest "blank", S2 reads, S4
no downstream confab). Offline: image-attachment 25/25, vision-blind 20/20, attachment 21/21,
fleet-routing 19/19.

**Lesson for next time:** when a new feature adds a turn-type gate (like `imgTurn`), evaluate it
BEFORE every pre-existing early-return that can swallow the turn — and trust the *trace absence* over
a "payload looks correct" round-trip when diagnosing a dropped-modality bug.

---

## Where we are (all shipped + pushed)

| Commit | What |
|---|---|
| `c5023d0`/`032ce9e`/`7ca2484` | **Build-34 LIVE VISION FIX (Session-34).** Hoisted `imgTurn` + gated the clarify/doc early-returns on `!imgTurn`; VISIONDBG stripped; plan updated. Live-verified (see top). |
| `aa18326` | **Build-37 — Silent Vision-Miss Guard.** Success-path guard: an image turn whose reply denies sight ("I can't see images") → honest `IMAGE_BLIND_RESPONSE`, not a blind reply a later turn confabulates from. `VISION_BLIND_RE` + `SAW_IMAGE_RE` veto; precision-guarded so the legit "too blurry to read" hedge survives; success-path only. **Offline `vision-blind-verify.ps1` 20/20; now LIVE-VERIFIED (Session-34).** |
| `c51efb2`/`f1f627a`/`25a3e62` | **Team Round 5** brief + synthesis (all 5 crew). Headline: best-of-N integrity holds *by construction*; real risk = selection integrity. Per-probe audit: **14/14 carry their anti-fab signal in an `absent` check.** Decisions: Build-37 = vision guard (done); Build-38 = provenance-at-ingestion; epistemic axis deferred ("trust before taxonomy"). |
| `12fbd57`/`2342cc9` | **Build-36 — best-of-N L5 gate relaxation.** Framing-only flakes re-run (default N=3); fabrication-class (`absent`/`refusal`/`anyOf`) = instant hard block, never re-run. `loop-verify.ps1` 52/52; combined live dry-run 14/14 → ATTEST PASS. |

Also: `M8-L5-Nightly-Attest` task re-registered (StartWhenAvailable, battery-resilient, 1h limit; `CRON_SECRET` confirmed User-level; still Interactive logon — S4U needs an elevated shell).

---

## ✅ SESSION-35 (2026-06-15, Opus): Build-39 shipped + live-verified; CRON_SECRET closed

- **Build-39 — read-path trust tiers** (`85f7752`, pushed, LIVE on deploy `6215582`). `renderGraphPacket`
  groups recall nodes into VERIFIED/EMPIRICAL/HEURISTIC/UNVERIFIED/REFUTED tiers (most-trusted first,
  cosine order within tier), flags `confidence<0.5` non-proven nodes "low confidence", appends a TRUST
  TIERS directive. Makes Build-38's `verification_state`/`confidence` ACT on the read path. No migration.
  `tests/trust-tier-verify.ps1` 12/12; live query narrated under verbatim Empirical/Unverified headers,
  flagged the [SPECULATIVE] claim, and refused to invent a VERIFIED node when none was in top-k.
- **CRON_SECRET in Vercel prod — CONFIRMED enforced** (unauth `/api/graph-relabel` → 401). Backlog
  item CLOSED — no action was needed.
- **`/api/health` now reports `deploy.sha`/`ref`/`env`** (`6215582`) — deterministic deploy-confirm so a
  live test can verify WHICH commit is serving (closes the push→serve-lag gap the live-test docs flag).
- **Build-40 — self-status search-routing guard** (`073150a`, pushed, LIVE on its own deploy).
  "what's your most recent build?" no longer web-searches Windows updates: shared `SELF_STATUS_RE`/
  `isSelfStatus` in `lib/intentClassifier.js`, `classifyIntent`→NONE for self-status, orchestrator ORs
  it into `buildQuery` at both sites. Fixed the stale `classifier-test.js` import too.
  `tests/intent-routing-verify.ps1` 26/26; live Q1 (self-status→build state, no search) + Q2
  ("latest keeta news"→still searched) both PASS.
- **NEXT in order:** #3 **full epistemic axis** (now unblocked — "trust before taxonomy" satisfied by
  Build-38/39). Then backlog: #12 search UNDER-routing (needs an example corpus first; build-state feed
  also lags — names Build-37 as "most recent"), #11 open-conjecture literature seed reads `empirical`
  (Build-38 classification refinement). See HONESTY_TRACK_PLAN backlog for the full list.

## (historical) NEXT BUILD → Build-38 (vision now resolved)
**Provenance + `trust_state` at ingestion** (crew-unanimous Q2, "trust before taxonomy"). Extend Build-30
provenance beyond `m8_conversations` to **graph nodes + the Build-27 intake path**: every node carries
`source · timestamp · evidence_kind (hypothesis/experiment/result/failed_path) · confidence ·
verification_state` *before* graph expansion scales. Enabler for both the epistemic axis and L6.
*Files: intake / `lib/memory-graph.js`.* Then: broaden search routing (`lib/intentClassifier.js`);
the deferred full epistemic axis. Round-5 honesty follow-ups (per-attempt telemetry, selector-stress
probes, `GRAPH_EVIDENCE_CAP` verification, uncertainty-calibration probes) — see HONESTY_TRACK_PLAN backlog.

---

## Standing notes
- Live runs hit `m8-alpha.vercel.app` + cost Gemini quota — run deliberately; need explicit authorization.
- The nightly L5 attestation fires ~05:00 AST; with Build-36 the gate can now actually accumulate clean nights — watch the next few land + confirm the POST reaches `/api/loop-attest`.
- PS gotcha (bit us this session): `ConvertTo-Json` unwraps a single-element array → force the `attachments` JSON array by hand (see repro above).

## ✅ SESSION-36 (2026-06-15, Opus): FULL EPISTEMIC AXIS COMPLETE
- **Build-41 (`af8974f`)** + **Build-42 (`a5b6788`)** both SHIPPED + LIVE-VERIFIED. The honesty backbone
  is done: M8 reliably separates proven / guess / speculative, and handles fringe ideas without laundering
  them. Build-41 = neutral `speculative` bucket + schema edge-ban + Odysseus probe. Build-42 = kernel/leap
  split (real core vs speculative leap, two linked nodes, human-gated) + co-retrieval invariant. Specs
  `BUILD_41_SPEC.md` + `BUILD_42_SPEC.md`.
- **Decision (Muhammad, end of Session-36):** stop polishing honesty; turn toward USEFULNESS. Next session
  does the small search fix FIRST, then starts the big problem-solving engine.

## Kickoff prompt to paste into the next session
> Continue M8. Read `HONESTY_TRACK_PLAN.md` + `NEXT_SESSION_BRIEF.md` first. The full epistemic
> axis (Builds 41+42) is DONE + LIVE-VERIFIED — don't reopen it; the honesty backbone is finished.
>
> **Do these two things, in order:**
>
> **1. FIRST — fix search "under-routing" (backlog #12).** The problem: sometimes M8 answers a
> checkable, current-fact question from memory/training instead of looking it up, and can be wrong. The
> trap: if we make it search too eagerly, it does clumsy web searches for things it already knows and
> answers get worse. So the work is mostly JUDGEMENT, not code: **(a) first build a small corpus of real
> example questions M8 currently mis-handles** (a mix of "should have searched but didn't" and "correctly
> answered from its own knowledge — must NOT start searching these"), put it in a test file like
> `tests/odysseus/` ; **(b) then make a conservative widening** of the search trigger in
> `lib/intentClassifier.js` that fixes the misses WITHOUT making it search things it already knows; **(c)**
> prove it with a PS-mirror test (no local Node) + measure the example corpus before/after. Keep the free
> Gemini/Tavily stack. Ship it the usual way: code → offline verify → confirm deploy via `/api/health`
> `deploy.sha` → live-verify (Gemini quota needs my OK). Keep it SMALL and safe — it's a modest win, not a
> big build.
>
> **2. THEN — start the big "problem-solving engine" build.** This is the real prize: M8 actually making
> progress on hard/unsolved problems, not just recording and classifying honestly. **Spec-first** — write
> `BUILD_43_SPEC.md` proposing the smallest genuinely-useful next rung of the engine (look at
> `NORTH_STAR.md` Track B + the existing generator/Lean/lemma-DAG pieces to find the real bottleneck),
> and ask me to pick the direction before building. Don't boil the ocean — propose one concrete, testable
> step.
>
> Standing rules: live runs cost Gemini quota + need my OK; `commitFamily` in `lib/buildState.js` is one
> ~30KB line — edit only via a unique-anchor replace, never load it into context; M8 lives in its OWN git
> repo (`github.com/Muhammedelhofy/M8-`), push there, not the Bolt repo.
