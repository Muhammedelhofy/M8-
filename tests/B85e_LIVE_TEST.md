# Build-85e — Memory Consolidation · LIVE TEST

Live URL: https://m8-alpha.vercel.app
Run the migration first (Supabase SQL editor): `migrations/B85e_memory_consolidation.sql`
(adds `merged_into`, `contradiction_flag`, `contradiction_reason` to `m8_conversations`).

**What it does:** a consolidation pass over the fact store (`m8_conversations`,
memory_type profile/operational). Near-duplicate facts (Jaccard ≥ 0.6 on their
text) are soft-merged into a canonical row via `merged_into` (+ `is_current=false`),
so recall only ever sees one copy. Candidate fact pairs (same `memory_key`) are
sent to gemini-2.5-flash — fire-and-forget, ≤ 50 pairs/run — and a contradicting
pair gets its lower-confidence row flagged (`contradiction_flag` + reason).
Nothing is ever hard-deleted; the merge is reversible.

---

## A) Trigger the consolidation endpoint

1. `GET https://m8-alpha.vercel.app/api/memory-consolidate`
   - Expect JSON: `{ consolidated, kept, contradictions, ran_at }`.
   - `consolidated` = duplicate rows folded this run; `kept` = canonical facts
     remaining; `contradictions` = candidate pairs dispatched for checking.
   - Safe to call repeatedly — already-merged rows are skipped (`merged_into IS NULL`).

2. The read-only Build-80 endpoint is UNCHANGED and on its own path:
   `GET /api/memory-health` still just REPORTS facts/summaries (never writes).

---

## B) Verify recall skips merged duplicates

3. In Supabase, confirm a soft-merged row: `SELECT id, content, merged_into,
   is_current FROM m8_conversations WHERE merged_into IS NOT NULL;`
   - Each such row points at its canonical `id` and has `is_current=false`.

4. Ask M8 a question whose answer depends on a consolidated fact (e.g. fleet size,
   a stated preference). The answer should still surface the fact — via the
   canonical row only, never a stale duplicate.
   - Under the hood `recallMemory()` now filters `merged_into IS NULL` on both
     the Tier-1 fact query and the Tier-2 keyword pool.

---

## C) Contradiction flags (fire-and-forget)

5. If two facts share a `memory_key` with incompatible values (e.g. a net target
   of 5000 vs 4000), after a consolidation run check:
   `SELECT content, contradiction_flag, contradiction_reason FROM m8_conversations
   WHERE contradiction_flag = true;`
   - The LOWER-confidence row (lower trust_level, then lower importance) is the
     one flagged, with a one-line reason. Flagging is best-effort and may land a
     few seconds after the endpoint returns (the Gemini checks are async).

---

## Offline verifier
`powershell -File tests/B85e-memory-consolidation-verify.ps1` → 43/43 (pure-logic
mirror of jaccard/grouping/pairing + static wiring + migration assertions).
