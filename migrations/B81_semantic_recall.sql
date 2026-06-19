-- Build-81: Semantic Recall via pgvector
-- Enables cosine-similarity search on m8_conversations so "Ahmed needs attention"
-- matches "driver on warning" even without shared keywords.
--
-- Run order: apply this AFTER all prior migrations.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE throughout).

-- 1. Enable pgvector (already enabled on most Supabase projects)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column (768 dims = Gemini text-embedding-004)
ALTER TABLE m8_conversations
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 3. HNSW index for fast approximate cosine search (pgvector >= 0.5.0)
--    ef_construction=64 is a good default for this table size.
CREATE INDEX IF NOT EXISTS m8_conversations_embedding_hnsw_idx
  ON m8_conversations USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. match_memories: RPC called by lib/memory.js semanticRecall()
--    Returns rows whose embedding is within (1 - match_threshold) cosine distance
--    of the query vector. Excludes the current session's OWN raw turns (profile/
--    operational facts from the current session ARE included — see Build-80 fix).
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding   vector(768),
  current_session   text    DEFAULT '',
  match_threshold   float   DEFAULT 0.70,
  match_count       int     DEFAULT 6,
  min_trust         int     DEFAULT 3
)
RETURNS TABLE (
  id           uuid,
  session_id   text,
  role         text,
  content      text,
  importance   int,
  memory_type  text,
  created_at   timestamptz,
  similarity   float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id, session_id, role, content, importance, memory_type, created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM m8_conversations
  WHERE
    is_current = true
    AND trust_level >= min_trust
    AND embedding IS NOT NULL
    -- exclude raw turns from the current session (they're already in history)
    AND NOT (session_id = current_session AND role IN ('user', 'assistant'))
    AND 1 - (embedding <=> query_embedding) >= match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
