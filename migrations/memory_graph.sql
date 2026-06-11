-- ============================================================================
-- M8 · Build-10 — Research Memory Graph   (Supabase / Postgres — ltqpoupferwituusxwal)
-- ============================================================================
-- THE GRAPH LAYER over the research notebook: typed nodes + typed edges +
-- pgvector embeddings, so every conjecture, verified theorem, dead end and
-- technique becomes a CONNECTED, SEMANTICALLY SEARCHABLE fact instead of a flat
-- ledger row. This is the compounding substrate the North Star needs.
--
--   Writer:  lib/memory-graph.js -> ingestNote()   (from lib/notebook.js persistNote — write-time, deterministic)
--            lib/memory-graph.js -> runGraphSweep() (nightly via /api/cron-summarize — backfill + Gemini extraction)
--   Reader:  lib/memory-graph.js -> graphMatch() / fetchNeighbors()  (Session-2 chat retrieval)
--   Access:  SUPABASE_SERVICE_KEY only (server-side) — RLS enabled, no policies,
--            same posture as m8_research_notes.
--
-- HONESTY SPINE: every node and edge carries source ('code' | 'extraction') and
-- note_id provenance. Code-owned facts are authoritative; extraction facts are
-- confidence-discounted and schema-validated before insert. lean_verified is the
-- ONLY path to a 'theorem' node.
--
-- Idempotent: safe to run more than once. See BUILD_10_SPEC.md for the design.
-- ----------------------------------------------------------------------------

-- 0) pgvector --------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- 1) Sweep cursor on the notebook (additive — existing table untouched otherwise)
alter table public.m8_research_notes
  add column if not exists graph_processed_at timestamptz;

-- 2) Nodes -------------------------------------------------------------------
create table if not exists public.m8_graph_nodes (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in
                    ('conjecture','theorem','evidence','counterexample',
                     'failed_attempt','technique','sequence','research_thread')),
  label           text not null,                    -- short display name (<=200 chars)
  norm_label      text not null,                    -- slug of label — dedup key
  content         text,                             -- full statement / finding
  thread          text,                             -- notebook thread slug (anchor)
  status          text,                             -- e.g. lean_verified | lean_stated
  source          text not null default 'code' check (source in ('code','extraction')),
  note_id         bigint,                           -- provenance -> m8_research_notes.id
  session_id      text,
  embedding       extensions.vector(768),           -- gemini-embedding-001 @768, L2-normalized
  embedding_model text,
  enriched_at     timestamptz,                      -- Gemini extraction sweep completed
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (kind, norm_label)                         -- idempotent upsert; exact-dup merge
);

-- 3) Edges -------------------------------------------------------------------
create table if not exists public.m8_graph_edges (
  id          bigint generated always as identity primary key,
  src_id      bigint not null references public.m8_graph_nodes(id) on delete cascade,
  dst_id      bigint not null references public.m8_graph_nodes(id) on delete cascade,
  rel         text not null check (rel in
                ('supports','contradicts','generalizes','depends_on',
                 'formalizes','derived_from')),
  source      text not null default 'code' check (source in ('code','extraction')),
  note_id     bigint,                               -- provenance
  confidence  real not null default 1,              -- code=1.0, extraction=0.7
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (src_id, dst_id, rel)
);

-- 4) Indexes -------------------------------------------------------------------
create index if not exists m8_graph_nodes_thread_idx on public.m8_graph_nodes (thread);
create index if not exists m8_graph_nodes_kind_idx   on public.m8_graph_nodes (kind);
create index if not exists m8_graph_nodes_note_idx   on public.m8_graph_nodes (note_id);
create index if not exists m8_graph_edges_src_idx    on public.m8_graph_edges (src_id);
create index if not exists m8_graph_edges_dst_idx    on public.m8_graph_edges (dst_id);
-- HNSW cosine index (fine on an empty/small table; builds incrementally)
create index if not exists m8_graph_nodes_embedding_idx
  on public.m8_graph_nodes using hnsw (embedding extensions.vector_cosine_ops);

-- 5) Cosine match RPC ----------------------------------------------------------
-- supabase-js cannot express vector operators in .select(), so retrieval goes
-- through this function: top-k nodes by cosine similarity to a query embedding.
create or replace function public.m8_graph_match(
  query_embedding extensions.vector(768),
  match_count     int   default 8,
  min_similarity  float default 0.25
)
returns table (
  id bigint, kind text, label text, content text, thread text,
  status text, source text, note_id bigint, similarity float
)
language sql stable
set search_path = public, extensions
as $$
  select n.id, n.kind, n.label, n.content, n.thread,
         n.status, n.source, n.note_id,
         (1 - (n.embedding <=> query_embedding))::float as similarity
  from public.m8_graph_nodes n
  where n.embedding is not null
    and (1 - (n.embedding <=> query_embedding)) >= min_similarity
  order by n.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;

-- 6) RLS — server-only access (service role bypasses; anon key blocked) --------
alter table public.m8_graph_nodes enable row level security;
alter table public.m8_graph_edges enable row level security;
