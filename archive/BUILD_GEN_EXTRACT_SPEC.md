# Session Brief: General Extraction Mode
## Build: B-gen-extract
## Model: Claude Sonnet 4.6 · Effort: HIGH
## Date: 2026-06-22
## Branch: feat/general-extraction (worktree: m8-gen-extract)

---

## Context

M8's knowledge graph currently has 0 book nodes because the extraction prompt is
hardcoded as a "precise mathematical knowledge extractor". Any non-math content
(Islamic history, general knowledge, biography) correctly returns 0 candidates.

The paid GEMINI_API_KEY is now confirmed working (Test Book DOCX ingested cleanly
2026-06-22 with the M8 Agent paid key — no quota errors).

The ingest pipeline is proven end-to-end (Build-RAG, 2026-06-22):
- Resumable chapter-by-chapter via `m8_ingest_checkpoints`
- Quota detection via `extractConceptsWithStatus()` (already in main)
- `ingestBookText({ title, author, year, text, cls, notes, maxChapters })` at line 812
  of `lib/knowledge-intake.js` — `cls` = source_class flows through correctly
- `extractConcepts(source_id)` at line 151 — uses hardcoded `EXTRACTION_SYSTEM`,
  does NOT accept a mode param — this is the ONLY thing blocking real nodes

---

## Goal

Add a `general` extraction mode alongside the existing `math` mode so that:
1. Islamic history books (البداية والنهاية, bn01-bn20.pdf text) yield real knowledge nodes
2. Any DOCX / pasted text with `source_class=established` gets meaningful extraction
3. The existing math extraction path is preserved (Collatz snippets still work)
4. User can optionally specify `extraction_mode=math` in the ingest command to force math mode

---

## What to Build

### 1. New `GENERAL_EXTRACTION_SYSTEM` prompt (knowledge-intake.js, after line ~100)

Add a second system prompt for general/historical/Islamic content:

```js
const GENERAL_EXTRACTION_SYSTEM = `You are a precise knowledge extractor.
Extract key facts, claims, events, people, places, dates, and concepts from the text.

For each item return a JSON object:
  label   — short identifier, 3-7 words, snake_case
  content — the specific claim or fact, 1-3 sentences, precise and self-contained
  type    — one of: fact | event | person | concept | place | date | ruling

Rules:
1. Only extract explicitly stated information — no inference or interpretation.
2. Each item must be self-contained and independently verifiable.
3. Skip vague, subjective, or purely narrative sentences.
4. For Islamic/historical content: prioritise events, dates, scholarly rulings,
   hadith citations, Quranic references, and named individuals.
5. Return ONLY a valid JSON array. No markdown, no prose.

Output: [{"label":"...","content":"...","type":"..."},...]`;
```

### 2. Update `extractConcepts(source_id, mode = 'general')` (line 151)

Add optional `mode` parameter. Pick system prompt based on mode:

```js
async function extractConcepts(source_id, mode = 'general') {
  const systemInstruction = mode === 'math'
    ? EXTRACTION_SYSTEM          // existing math prompt
    : GENERAL_EXTRACTION_SYSTEM; // new general prompt
  // ... rest of function unchanged, just swap systemInstruction
}
```

### 3. Update `extractConceptsWithStatus(source_id, mode = 'general')` (Build-RAG addition)

Same pattern — add `mode` param, pass it to the Gemini call. Already in main from Build-RAG.

### 4. Update `ingestBookText` to pass mode (line 865)

`ingestBookText` has `cls` (source_class). Derive mode from it:

```js
// Inside ingestBookText, before the chapter loop
const extractionMode = (cls === 'mathematical') ? 'math' : 'general';

// Then on line 865, pass mode:
const candidates = await extractConcepts(source_id, extractionMode);
// or extractConceptsWithStatus(source_id, extractionMode) if using the Build-RAG path
```

### 5. Book command parser: accept optional `extraction_mode=math` (line 912 area)

In `parseBookIngestCommand()` (the function at ~line 912 that parses
`title=X, author=Y, source_class=established`), add:

```js
const extractionModeRaw = grab("extraction_mode") || grab("mode");
const extraction_mode = (extractionModeRaw || '').toLowerCase() === 'math' ? 'math' : 'general';
return { title, author, year, source_class, extraction_mode };
```

Then in `handleBookIngestCommand()` (the function that calls `ingestBookText`),
pass `extraction_mode` through:
```js
await ingestBookText({ ..., cls: source_class, extraction_mode });
```
And update `ingestBookText` signature to accept `extraction_mode` directly
(overrides the cls-derived default if provided).

### 6. Update `parseExtractionOutput` to handle the `type` field (line 120)

The general prompt returns `{ label, content, type }`. The math prompt only returns
`{ label, content }`. `parseExtractionOutput` should accept either shape:
- If `type` field is present, store it (or ignore it if schema has no column — acceptable)
- The key fields `label` + `content` are the same in both shapes

Check whether `m8_knowledge_nodes` has a `node_type` or `type` column. If it does,
map `type` → `node_type`. If not, just drop the field — no schema change needed.

---

## Files to OWN

```
lib/knowledge-intake.js          — ALL changes above live here
tests/B-gen-extract-verify.ps1   — PS 5.1 mirror (see test criteria below)
reports/gen-extract-done.json    — build report
```

## Files NOT to touch

```
orchestrator.js
loop.js
entity-graph.js
memory-graph.js
conjecture-*.js
lib/handlers/ingest-full.js
lib/handlers/ingest-extract-existing.js
lib/handlers/knowledge-inventory.js
lib/handlers/upload-file.js
api/knowledge.js
```

---

## Test Criteria (PS 5.1 mirror, no DB, no network)

Write `tests/B-gen-extract-verify.ps1` mirroring the pure logic:

1. **mode selection**: `cls=mathematical` → mode=`math`; `cls=established` → mode=`general`; `cls=speculative` → mode=`general`
2. **prompt selection**: mode=`math` → returns EXTRACTION_SYSTEM; mode=`general` → returns GENERAL_EXTRACTION_SYSTEM; default (no mode) → general
3. **parseExtractionOutput with type field**: `{"label":"x","content":"y","type":"event"}` → parsed correctly; `type` missing → still parses label+content
4. **parseExtractionOutput without type field**: existing math output shape still parses
5. **extraction_mode param in book command parser**: `"title=Test Book, source_class=established, extraction_mode=math"` → `extraction_mode='math'`; no extraction_mode in string → defaults to `'general'`
6. **extractConceptsWithStatus quota path**: still works with mode param (existing Build-RAG tests must still pass)
7. **ingestBookText mode derivation**: cls=`established` → general mode; cls=`mathematical` (if added as valid class) → math mode

Target: all green, no fails.

---

## Existing tests to NOT break

Run `tests/B-rag-content-verify.ps1` — must stay 52/52 green.

---

## Live-verify procedure (AFTER deploy — only with Muhammad's OK)

1. In M8 chat, say: `ingest this as a book: title=البداية والنهاية Vol1, source_class=established`
   and attach a small excerpt (paste text, not the full PDF yet — stay under 500 words for first test)
2. Expected: M8 replies with chapter count > 0 AND nodes > 0 (non-math content now extracts)
3. Check `GET /api/knowledge?fn=inventory` — nodes_in_books should be > 0
4. Check `GET /api/knowledge?fn=status` — summary should show book count + node count

---

## Schema check (do before coding)

Run this in Supabase SQL editor to check if `type` column exists on nodes table:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'm8_knowledge_nodes'
ORDER BY ordinal_position;
```
If `node_type` or `type` column exists → map it. If not → drop the field from output
(no schema migration needed, keep this build schema-free).

---

## Deploy rule

NO deploy to Vercel without Muhammad's explicit "deploy it". Ship to branch only.

---

## Reporting block (REQUIRED — run at end of session)

```powershell
# After all tests pass, commit + write report:
git add lib/knowledge-intake.js tests/B-gen-extract-verify.ps1 reports/gen-extract-done.json
git commit -m "Build gen-extract: general extraction mode for non-math content"
git push origin feat/general-extraction
```

Write `reports/gen-extract-done.json`:
```json
{
  "build": "gen-extract",
  "branch": "feat/general-extraction",
  "date": "TODAY",
  "status": "code-complete / branch-only / NOT deployed",
  "test_results": { "file": "tests/B-gen-extract-verify.ps1", "pass": X, "fail": 0 },
  "changes": ["lib/knowledge-intake.js — GENERAL_EXTRACTION_SYSTEM + mode routing"],
  "live_verify_pending": true,
  "schema_change": false
}
```

---

## Summary for session start

The ONLY change needed to get nodes from Islamic history books is:
1. Add `GENERAL_EXTRACTION_SYSTEM` prompt (~20 lines)
2. Add `mode` param to `extractConcepts` + `extractConceptsWithStatus` (~5 lines each)
3. Derive mode from `cls` in `ingestBookText` (~3 lines)
4. Parse optional `extraction_mode=math` in book command parser (~5 lines)

This is a small, focused build. No schema changes. No new endpoints. No orchestrator edits.
The existing math extraction for Collatz snippets keeps working unchanged.
