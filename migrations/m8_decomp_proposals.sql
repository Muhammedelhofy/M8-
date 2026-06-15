-- M8 Build-43 Option A — Human-Gated Decomposition Proposer staging table.
-- A DRAFT lemma-DAG proposal (M8-drafted, anti-degeneracy-gated) is STAGED here as
-- a [PROPOSED PLAN]; nothing is written to the research graph until a human runs
-- "approve decomposition #N", which hands dag_text to the existing M4 scaffold lane.
-- Mirrors Build-42's pending_decomposition discipline: staged data, never evidence.
-- Idempotent; safe to re-run. Apply in the Supabase SQL editor (manual paste).

create table if not exists public.m8_decomp_proposals (
  id          bigint generated always as identity primary key,
  target      text not null,
  target_norm text not null,
  dag_text    text not null,                 -- exact M4-manual format, fed verbatim to scaffoldProof
  dag         jsonb not null,                -- parsed { lemmas, leaves, target }
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists m8_decomp_proposals_status_idx on public.m8_decomp_proposals (status, created_at desc);
