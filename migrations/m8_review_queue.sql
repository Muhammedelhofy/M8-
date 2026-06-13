-- ============================================================================
-- M8 · Build-17 — M3.1 Survivor Review Queue   (Supabase / Postgres — ltqpoupferwituusxwal)
-- ============================================================================
-- A dedicated triage store for M3 conjecture-generator SURVIVORS. The generator
-- mines ~120 candidates/run and ~20 survive, but the notebook ledger keeps only
-- the top 5 (spam guard) — the rest were discarded. This table captures ALL
-- non-vacuous survivors so a human can cluster + triage them (the "human-review
-- queue" rung, NORTH_STAR M3.1). It is SEPARATE from m8_research_notes and
-- m8_graph_nodes on purpose: the ledger of record and the recall substrate stay
-- clean, and the gate / survival / persistence cap are all untouched.
--
--   Writer:  lib/review-queue.js -> upsertQueueItems()  (orchestrator STORE, after an M3 run)
--   Reader:  lib/review-queue.js -> fetchQueue() / buildReviewQueueContext()  (chat lane)
--   Triage:  lib/review-queue.js -> setReviewState()    (orchestrator STORE, staged in the lane)
--   Access:  SUPABASE_SERVICE_KEY only (server-side) — RLS enabled, no policies,
--            same posture as m8_research_notes / m8_graph_nodes.
--
-- HONESTY: review_state is the HUMAN's triage verdict; ordering/grouping in the
-- reader is structural (template family + coverage) ONLY — never a truth/novelty/
-- quality ranking. No score column exists, by design (BUILD_17_SPEC §0.1).
--
-- Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

create table if not exists public.m8_review_queue (
  id            bigint generated always as identity primary key,
  statement     text not null unique,             -- canonical claim = dedup key (statementFor, incl. bound)
  template      text not null,                     -- cluster key (structural family)
  ctype         text not null,                     -- 'A' | 'B'
  features      jsonb not null default '[]'::jsonb,-- the M1 feature pair (display/grouping)
  tested_to     bigint,                            -- bound N (DISPLAY only — never a sort key)
  train_bound   bigint,
  seed          bigint,                            -- run seed (first seen)
  known_match   text,                              -- seed-pack id if the FORM is known, else null
  observed      double precision,                  -- Type B observed value (display only)
  review_state  text not null default 'new'
                  check (review_state in ('new','kept','dismissed','reviewed')),
  reviewed_at   timestamptz,
  seen_count    int not null default 1,            -- bumped when the same statement re-appears
  metadata      jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists m8_review_queue_template_idx on public.m8_review_queue (template);
create index if not exists m8_review_queue_state_idx    on public.m8_review_queue (review_state);

-- RLS — server-only access (service role bypasses; anon key blocked)
alter table public.m8_review_queue enable row level security;
