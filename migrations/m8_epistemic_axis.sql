-- ============================================================================
-- M8 · Build-41 — Full epistemic axis (D1: collapse to ONE neutral bucket)
-- (Supabase / Postgres — ltqpoupferwituusxwal · apply AFTER m8_knowledge_nodes_columns.sql)
-- ============================================================================
-- Team round (2026-06-13, synthesized — see [[epistemic-classification-axis]]):
-- collapse the three intake buckets 'established | speculative | fringe' to the
-- TWO canonical buckets 'established | speculative'. "fringe" was rejected 4/5 as
-- pejorative; the serious-vs-crackpot judgment it implied is exactly the
-- non-deterministic vibe-call the doctrine forbids. The Wolfram-vs-Vortex
-- difference will live in the KERNEL node's solidity (Build-42), not a label.
--
-- HONESTY: this is strictly a DE-ESCALATION. Both buckets already render under the
-- SAME hardcoded recall warning (renderGraphPacket, Build-28), so no node loses a
-- flag — it only trades a more-pejorative label for a neutral one. No node gains
-- trust. verification_state / confidence (Build-38) are untouched.
--
-- D2 (schema edge-ban) and D4 (Odysseus probe + generator-purity test) need NO
-- migration — D2 is pure code in addEdge(), D4 is tests + a battery entry.
--
-- One-way data edit (Muhammad APPROVED, Session-36). Idempotent: re-running is a
-- no-op once no 'fringe' rows remain and the constraints already permit only the
-- two buckets.
-- ----------------------------------------------------------------------------

-- §A — migrate live 'fringe' rows → 'speculative', THEN tighten both constraints.
-- Order matters: rewrite the data first so the new CHECK can't reject an old row.

-- A1) graph nodes (ingested claim/entity nodes carry source_class)
update public.m8_graph_nodes
set source_class = 'speculative'
where source_class = 'fringe';

alter table public.m8_graph_nodes
  drop constraint if exists m8_graph_nodes_source_class_check;
alter table public.m8_graph_nodes
  add constraint m8_graph_nodes_source_class_check
  check (source_class in ('established','speculative'));

-- A2) source documents (the intake table)
update public.m8_knowledge_sources
set source_class = 'speculative'
where source_class = 'fringe';

alter table public.m8_knowledge_sources
  drop constraint if exists m8_knowledge_sources_source_class_check;
alter table public.m8_knowledge_sources
  add constraint m8_knowledge_sources_source_class_check
  check (source_class in ('established','speculative'));
