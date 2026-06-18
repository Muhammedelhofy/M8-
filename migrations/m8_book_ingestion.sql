-- ============================================================================
-- M8 · Book Ingestion — add metadata column to m8_knowledge_sources
-- Supports multi-chapter book ingestion with provenance per chapter.
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.m8_knowledge_sources
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.m8_knowledge_sources.metadata is
  'Arbitrary provenance metadata. For books: {book_title, author, year, chapter_index, chapter_title, total_chapters}';

create index if not exists m8_knowledge_sources_metadata_idx
  on public.m8_knowledge_sources using gin (metadata);
