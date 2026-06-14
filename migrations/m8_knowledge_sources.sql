-- ============================================================================
-- M8 · Build-27 — Knowledge Acquisition Pipeline: source documents table
-- (Supabase / Postgres — ltqpoupferwituusxwal · apply in the SQL editor)
-- ============================================================================
-- Stage 1 of the pipeline: store raw ingested documents before extraction.
-- Each row = one document Muhammad provides (paper, abstract, paste, URL content).
-- Extraction writes candidate nodes to m8_graph_nodes (via the Stage 2-3 API).
--
-- HONESTY CONTRACT:
--   source_class is set by Muhammad at ingest time — M8 never infers it silently.
--   'established' | 'speculative' | 'fringe' — all nodes derived from this doc
--   inherit the same source_class; they are never upgraded at extraction.
--
-- Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

create table if not exists public.m8_knowledge_sources (
  id            bigint generated always as identity primary key,
  title         text not null,
  source_url    text,
  raw_text      text not null,
  word_count    integer,
  source_class  text not null check (source_class in ('established','speculative','fringe')),
  notes         text,
  pending_nodes jsonb not null default '[]'::jsonb,  -- low/medium candidates awaiting approval
  ingested_at   timestamptz not null default now()
);

create index if not exists m8_knowledge_sources_class_idx
  on public.m8_knowledge_sources (source_class);

alter table public.m8_knowledge_sources enable row level security;
-- No permissive policies: service role bypasses RLS; anon key is blocked.
