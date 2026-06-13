-- ============================================================================
-- M8 · Build-18 — M4-manual Lemma-DAG Scaffolding   (Supabase / Postgres — ltqpoupferwituusxwal)
-- ============================================================================
-- Working-state ledger for a HUMAN-architected proof scaffold. The human supplies
-- a lemma DAG in plain English; M8 formalizes + machine-checks the LEAVES via the
-- Lean lane (/check) and scaffolds the parents as honest `sorry`. The DAG KNOWLEDGE
-- (verified leaf = theorem node, stated lemma/target = conjecture node, the shape =
-- depends_on edges) lives in m8_graph_nodes / m8_graph_edges; this table holds ONLY
-- the per-scaffold working state for the render packet — SEPARATE on purpose, the
-- m8_review_queue precedent (the recall substrate + the gate stay clean).
--
--   Writer:  lib/lemma-dag.js -> persistScaffold()        (orchestrator STORE, after a scaffold run)
--   Reader:  lib/lemma-dag.js -> fetchScaffold() / buildLemmaDAGContext()  (chat lane)
--   Access:  SUPABASE_SERVICE_KEY only (server-side) — RLS enabled, no policies,
--            same posture as m8_review_queue / m8_graph_nodes.
--
-- HONESTY (BUILD_18_SPEC §0.1, load-bearing): the only progress this table records
-- is leaves_verified / leaf_count. There is NO "% proven" column, and the `status`
-- CHECK constraint has NO 'proven' value — the schema itself refuses to record the
-- target conjecture as proven. A sorried parent is UNPROVEN; the target stays an
-- open conjecture at every leaf-count. A target becomes proven only if a FULL
-- assembled proof type-checks with 0 sorry (M4-full / v1.1 — out of Build-18 scope).
--
-- Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

create table if not exists public.m8_lemma_scaffold (
  id                    bigint generated always as identity primary key,
  target                text not null,                      -- prose target statement (the human's conjecture)
  target_norm           text not null unique,               -- normLabel(target) = dedup key
  lemmas                jsonb not null default '[]'::jsonb,  -- [{idx,name,prose,deps,is_leaf,lean_status,node_id,code,namespaces}]
  leaf_count            int not null default 0,              -- total leaves in the DAG
  leaves_verified       int not null default 0,              -- leaves with lean_verified (display: "k/m leaves")
  parents_sorried       int not null default 0,              -- non-leaf lemmas held as honest scaffold
  gate_qualifying_leaf  boolean not null default false,      -- a §0.4 qualifying leaf verified (induction + >=2 Mathlib namespaces)
  gate_shortcut_rejected boolean not null default false,     -- its invalid-shortcut probe failed /check (structure is necessary)
  status                text not null default 'open'
                          check (status in ('open','leaves_done','target_stated')),  -- NOTE: no 'proven', by design
  metadata              jsonb not null default '{}'::jsonb,  -- gen/lean versions, namespaces seen, gate detail
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists m8_lemma_scaffold_status_idx on public.m8_lemma_scaffold (status);

-- RLS — server-only access (service role bypasses; anon key blocked)
alter table public.m8_lemma_scaffold enable row level security;
