-- Build-85b: Entity Timeline
-- Adds a `summary` column to m8_entity_mentions so each session mention carries a
-- 1-sentence Gemini-generated description of what was said about the entity.
-- Nullable — existing rows keep NULL; no backfill needed.
-- Idempotent. Apply once.

ALTER TABLE public.m8_entity_mentions
  ADD COLUMN IF NOT EXISTS summary text;

COMMENT ON COLUMN public.m8_entity_mentions.summary IS
  'Build-85b: 1-sentence Gemini summary of what was said about this entity in this session turn. Generated fire-and-forget; NULL on old rows.';
