-- ============================================================================
-- M8 · B109 — Graph vocabulary: Track-A (operations) node + edge kinds
-- ============================================================================
-- Widens the m8_graph_nodes.kind and m8_graph_edges.rel CHECK constraints so the
-- existing Research Memory Graph (Build-10) can ALSO hold operations knowledge
-- (projects, decisions, people, companies, questions, sources, ...).
--
-- PURELY ADDITIVE + SAFE:
--   * every existing value stays valid — no rows change, nothing is deleted
--   * embeddings / m8_graph_match / edges / neighbor-walks are unaffected
--   * idempotent — safe to run more than once
--
-- ORDER OF OPERATIONS (important):
--   1. Apply THIS migration first (Supabase SQL editor -> paste -> Run).
--   2. THEN deploy the matching lib/memory-graph.js change.
-- If the JS were deployed before this migration, new-kind inserts would simply
-- fail the old CHECK and be dropped fail-safe (inert, never harmful).
-- ----------------------------------------------------------------------------

-- 1) NODES: widen `kind` -----------------------------------------------------
-- Drop the existing single-column CHECK on `kind` by introspection (its
-- auto-generated name is m8_graph_nodes_kind_check, but we find it by column so
-- this works regardless of how it was named).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'm8_graph_nodes'
      AND con.contype = 'c'
      AND con.conkey  = ARRAY[(SELECT attnum FROM pg_attribute
                               WHERE attrelid = rel.oid AND attname = 'kind')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.m8_graph_nodes DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.m8_graph_nodes
  ADD CONSTRAINT m8_graph_nodes_kind_check CHECK (kind IN (
    -- existing in the live DB (Build-10 + later builds: claim/entity/document)
    'conjecture','theorem','evidence','counterexample',
    'failed_attempt','technique','sequence','research_thread',
    'claim','entity','document',
    -- Track A — operations + general (B109)
    'fact','concept','project','person','company','decision','question','source'
  ));

-- 2) EDGES: widen `rel` ------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'm8_graph_edges'
      AND con.contype = 'c'
      AND con.conkey  = ARRAY[(SELECT attnum FROM pg_attribute
                               WHERE attrelid = rel.oid AND attname = 'rel')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.m8_graph_edges DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.m8_graph_edges
  ADD CONSTRAINT m8_graph_edges_rel_check CHECK (rel IN (
    -- original Build-10
    'supports','contradicts','generalizes','depends_on','formalizes','derived_from',
    -- B109 — operations + general
    'related_to','tested_by','belongs_to','caused_by'
  ));

-- 3) VERIFY (optional — run these to confirm the widened lists) ---------------
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.m8_graph_nodes'::regclass AND contype = 'c' AND conname = 'm8_graph_nodes_kind_check';
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.m8_graph_edges'::regclass AND contype = 'c' AND conname = 'm8_graph_edges_rel_check';
