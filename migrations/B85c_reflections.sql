-- migrations/B85c_reflections.sql
-- Build-85c: Self-Reflection Loop.
-- One row per reflected turn (general + knowledge lanes only). Written
-- fire-and-forget by lib/reflector.js logReflection() — never blocks the answer.
-- Idempotent so it is safe to re-apply.

CREATE TABLE IF NOT EXISTS m8_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  question text,
  relevance_score int,
  overclaim_flag boolean,
  missed_source_flag boolean,
  was_rewritten boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS m8_reflections_session_id_idx ON m8_reflections(session_id);
