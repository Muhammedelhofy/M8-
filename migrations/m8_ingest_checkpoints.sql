-- ============================================================================
-- M8 · Build-77 — Resumable / idempotent book ingestion checkpoints
--
-- WHY: a full book is ingested chapter-by-chapter through the Gemini extraction
-- pipeline. On Vercel the function is killed at the wall-clock limit, so a large
-- book never finishes in one invocation and (pre-Build-77) the partial work was
-- effectively lost: the old idempotency check keyed off "a chapter source row
-- exists", but that row is written BEFORE extraction runs — so a chapter that
-- died mid-extraction was skipped forever on re-run with zero graph nodes.
--
-- This table records progress at chapter granularity. A chapter is marked 'done'
-- ONLY after its nodes are committed to the graph, so a re-ingest skips truly
-- finished chapters and resumes the rest. Idempotent: safe to run more than once.
-- DO NOT auto-apply — Muhammad applies this live.
-- ============================================================================

create table if not exists public.m8_ingest_checkpoints (
  id             bigint generated always as identity primary key,
  book_title     text        not null,
  chapter_index  int         not null,
  chapter_title  text,
  source_id      bigint,                              -- m8_knowledge_sources.id for this chapter
  status         text        not null default 'pending',  -- 'pending' | 'done'
  nodes_added    int         not null default 0,
  nodes_pending  int         not null default 0,
  total_chapters int,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (book_title, chapter_index)
);

comment on table public.m8_ingest_checkpoints is
  'Build-77: per-(book_title, chapter_index) ingestion progress. status=done means the chapter''s nodes are committed to m8_graph_nodes; a re-ingest skips done chapters and resumes pending ones.';

create index if not exists m8_ingest_checkpoints_book_idx
  on public.m8_ingest_checkpoints (book_title);
