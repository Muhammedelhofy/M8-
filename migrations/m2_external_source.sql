-- ============================================================================
-- M8 · Build-15 (S8) — M2 seed pack: 'external' provenance
-- (Supabase / Postgres — ltqpoupferwituusxwal · apply in the SQL editor)
-- ============================================================================
-- Adds 'external' to the source CHECK on graph nodes + edges so curated
-- literature seeds (data/seed-packs/collatz-v1.json, inserted via
-- /api/seed-pack) carry honest provenance. Adopted team round 3 (Q1).
--
-- PROVENANCE CONTRACT after this migration:
--   source='code'       — deterministic write-time facts (authoritative)
--   source='extraction' — Gemini-extracted (confidence-discounted)
--   source='external'   — curated literature seeds (cited, curation-verified;
--                         the ONLY other honest origin of a 'theorem' node
--                         besides lean_verified — recall labels them LITERATURE)
--
-- Idempotent: drop-if-exists + re-add. Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.m8_graph_nodes
  drop constraint if exists m8_graph_nodes_source_check;
alter table public.m8_graph_nodes
  add constraint m8_graph_nodes_source_check
  check (source in ('code', 'extraction', 'external'));

alter table public.m8_graph_edges
  drop constraint if exists m8_graph_edges_source_check;
alter table public.m8_graph_edges
  add constraint m8_graph_edges_source_check
  check (source in ('code', 'extraction', 'external'));
