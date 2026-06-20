-- migrations/B85e_memory_consolidation.sql
-- Build-85e: Memory Consolidation.
--   merged_into          — soft-merge pointer: a near-duplicate fact points at the
--                          canonical row it was folded into (reversible, no delete).
--   contradiction_flag   — set on the LOWER-confidence row of a contradicting pair.
--   contradiction_reason — one-line explanation from the gemini-2.5-flash checker.
-- recallMemory() filters `merged_into IS NULL` so merged dupes are never recalled.
-- Idempotent: safe to re-apply.

ALTER TABLE m8_conversations
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES m8_conversations(id),
  ADD COLUMN IF NOT EXISTS contradiction_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contradiction_reason text;

CREATE INDEX IF NOT EXISTS m8_conversations_merged_into_idx
  ON m8_conversations(merged_into) WHERE merged_into IS NOT NULL;
