-- ============================================================================
-- M8 · Build-42 — Kernel/Leap decomposition (D3) — source-row staging column
-- (Supabase / Postgres — ltqpoupferwituusxwal · apply AFTER m8_epistemic_axis.sql)
-- ============================================================================
-- The kernel/leap split is HUMAN-GATED: at ingest of a speculative document a
-- Gemini pass PROPOSES a decomposition {kernel, leap}; the proposal is STAGED here
-- (not written to the graph) until Muhammad approves it. On approval the leap is
-- written speculative, and the kernel is either linked to an existing established
-- node (deterministic cosine >= 0.82) or minted (speculative by default, established
-- only on an explicit approval flag) — see BUILD_42_SPEC.md §2.
--
-- No other schema change: the decomposition edge reuses 'derived_from' (already in
-- m8_graph_edges.rel) + the existing jsonb metadata column (Build-10), tagged
-- metadata.decomposition = 'leap_of_kernel'. D2's edge-ban (Build-41) explicitly
-- allows derived_from, so this is consistent.
--
-- Idempotent.
-- ----------------------------------------------------------------------------

alter table public.m8_knowledge_sources
  add column if not exists pending_decomposition jsonb;
