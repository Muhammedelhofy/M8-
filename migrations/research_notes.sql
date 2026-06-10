-- ============================================================================
-- M8 · m8_research_notes   (Supabase / Postgres — project ltqpoupferwituusxwal)
-- ============================================================================
-- THE RESEARCH NOTEBOOK (persistent research memory). One row per entry in a
-- line of inquiry, so M8 stops restarting from zero every session and accumulates
-- an honest ledger of where a problem actually stands — the substrate L5 needs.
--
-- This EXTENDS the memory spine (same project, same supersession model as
-- m8_conversations: is_current / superseded_at), but lives in its own table
-- because a research ledger has a genuinely different shape (thread + kind +
-- status) than conversation memory — and so notebook entries never flood
-- recallMemory().
--
--   Writer:  lib/notebook.js -> persistNote()          (from lib/orchestrator.js STORE phase)
--   Reader:  lib/notebook.js -> buildNotebookContext()  (deterministic packet; the LLM only narrates it)
--   Access:  SUPABASE_SERVICE_KEY (server-side) for BOTH writer and reader.
--
-- DETERMINISTIC-FIRST / HONESTY: this is a ledger of recorded facts and dead
-- ends, NOT a hallucination surface. Code owns what is written and read; the LLM
-- never invents a finding, and never upgrades a recorded conjecture into a proof.
--
-- Columns mirror the insert in persistNote() exactly, so no insert can silently
-- fail on a type mismatch. Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

-- 1) Table -------------------------------------------------------------------
create table if not exists public.m8_research_notes (
  id            bigint generated always as identity primary key,
  thread        text not null,                 -- slug of the line of inquiry, e.g. 'collatz-stopping-time'
  title         text,                          -- human-readable thread title (denormalized; latest non-empty wins for display)
  kind          text not null,                 -- conjecture | evidence | counterexample | dead_end | status | next_step | note
  content       text not null,                 -- the statement / finding (<=2000 chars)
  stance        text,                          -- for kind='evidence': 'for' | 'against' (else null)
  status        text,                          -- for kind='status': open | supported | refuted | resolved | parked
  session_id    text,                          -- which session recorded it (attribution / audit)
  importance    integer default 3,             -- 1..5
  is_current    boolean default true,          -- supersession: a singleton kind (status/next_step) flips the prior row false
  superseded_at timestamptz,                    -- when is_current went false
  metadata      jsonb default '{}'::jsonb,     -- e.g. { source, refs:[], computed_to:'1e9' }
  created_at    timestamptz not null default now()
);

-- 2) Indexes -----------------------------------------------------------------
-- Per-thread ledger, oldest first (buildNotebookContext thread view)
create index if not exists m8_research_notes_thread_created_idx
  on public.m8_research_notes (thread, created_at asc);

-- "Current entries, newest first" (the overview / thread list)
create index if not exists m8_research_notes_current_idx
  on public.m8_research_notes (is_current, created_at desc);

-- Filter by kind (e.g. "what dead ends have we hit")
create index if not exists m8_research_notes_kind_idx
  on public.m8_research_notes (kind);

-- ============================================================================
-- 3) OPTIONAL HARDENING — run this ONE line only AFTER you've confirmed the
--    notebook reads/writes work (a read packet renders, a write persists a row).
-- ----------------------------------------------------------------------------
-- The notebook is server-only (both writer and reader use the service role,
-- which BYPASSES row-level security) — so enabling RLS with no policies blocks
-- the public anon key from ever reading the ledger while the app keeps working.
-- Reversible:  alter table public.m8_research_notes disable row level security;
--
-- alter table public.m8_research_notes enable row level security;
