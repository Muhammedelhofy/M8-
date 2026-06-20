-- Build-83b: Semantic search on the Knowledge Graph
-- Adds a named HNSW index (cosine) on m8_graph_nodes.embedding and a
-- match_kg_nodes RPC used by searchKnowledgeGraph() in knowledge-intake.js.
--
-- NOTE: the embedding extensions.vector(768) column and a base HNSW index
-- were created in memory_graph.sql. This migration is additive + idempotent.
--
-- Run order: apply after memory_graph.sql and m8_graph_nodes_provenance.sql.

-- 1. Ensure pgvector is enabled (no-op if already present)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Named HNSW index for the KG semantic search path
--    (memory_graph.sql creates m8_graph_nodes_embedding_idx; this index is
--    an explicit Build-83b marker and uses cosine ops — same underlying column)
CREATE INDEX IF NOT EXISTS m8_graph_nodes_emb_b83b_hnsw_idx
  ON public.m8_graph_nodes
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. match_kg_nodes: lightweight RPC for searchKnowledgeGraph()
--    Returns only the fields the search formatter needs (label, content, kind).
--    Threshold default 0.65 matches the caller's semantic-first cutoff.
CREATE OR REPLACE FUNCTION match_kg_nodes(
  query_embedding  extensions.vector(768),
  match_threshold  float  DEFAULT 0.65,
  match_count      int    DEFAULT 6
)
RETURNS TABLE (
  id         bigint,
  kind       text,
  label      text,
  content    text,
  similarity float
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    n.id,
    n.kind,
    n.label,
    n.content,
    (1 - (n.embedding <=> query_embedding))::float AS similarity
  FROM public.m8_graph_nodes n
  WHERE
    n.embedding IS NOT NULL
    AND (1 - (n.embedding <=> query_embedding)) >= match_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;
