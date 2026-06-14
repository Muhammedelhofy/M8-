-- ============================================================================
-- M8 · Build-27 — Knowledge Acquisition Pipeline: extend m8_graph_nodes
-- (Supabase / Postgres — ltqpoupferwituusxwal · apply AFTER m8_knowledge_sources.sql)
-- ============================================================================
-- Adds three things:
--   1. New kind values ('claim', 'entity', 'document') for ingested knowledge nodes
--   2. Provenance + classification columns (source_class, source_doc_id,
--      extraction_confidence, mastery_state) on m8_graph_nodes
--   3. Backfill: existing 'external' source nodes get source_class='established'
--
-- HONESTY CONTRACT:
--   mastery_state advances forward only (ingested → compared → tested →
--   lean_stated → lean_verified). lean_verified is STILL the only path to
--   kind='theorem' — ingestion never creates theorem nodes.
--   source_class IS NOT UPGRADEABLE via ingestion — only Lean verification can
--   change the epistemic status of a claim.
--
-- Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

-- 1) Extend kind CHECK to include ingested-knowledge node types ---------------
alter table public.m8_graph_nodes
  drop constraint if exists m8_graph_nodes_kind_check;
alter table public.m8_graph_nodes
  add constraint m8_graph_nodes_kind_check
  check (kind in (
    'conjecture','theorem','evidence','counterexample',
    'failed_attempt','technique','sequence','research_thread',
    'claim','entity','document'
  ));

-- 2) New provenance + classification columns ----------------------------------
alter table public.m8_graph_nodes
  add column if not exists source_class text
    check (source_class in ('established','speculative','fringe')),
  add column if not exists source_doc_id bigint
    references public.m8_knowledge_sources(id) on delete set null,
  add column if not exists extraction_confidence text
    check (extraction_confidence in ('high','medium','low')),
  add column if not exists mastery_state text default 'ingested'
    check (mastery_state in ('ingested','compared','tested','lean_stated','lean_verified'));

-- 3) Indexes ------------------------------------------------------------------
create index if not exists m8_graph_nodes_source_class_idx
  on public.m8_graph_nodes (source_class);
create index if not exists m8_graph_nodes_source_doc_idx
  on public.m8_graph_nodes (source_doc_id);
create index if not exists m8_graph_nodes_mastery_idx
  on public.m8_graph_nodes (mastery_state);

-- 4) Backfill: existing curated literature seeds → source_class='established' -
-- The 19 M2 Collatz seeds were inserted with source='external'; they are all
-- peer-reviewed / curation-verified results and should be 'established'.
update public.m8_graph_nodes
set source_class = 'established'
where source = 'external'
  and source_class is null;
