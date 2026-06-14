-- ============================================================================
-- M8 · Build-19 — L5 Autonomous Loop run ledger   (Supabase / Postgres — ltqpoupferwituusxwal)
-- ============================================================================
-- One row PER DAY of the unattended exploration loop. Phase A (/api/cron-explore)
-- creates the row (observe -> hypothesize/test -> cluster/queue); Phase B
-- (/api/cron-verify) and the Odysseus attestation (/api/loop-attest) UPDATE it.
-- The promotion gate is a deterministic query over these rows (no LLM, no judge):
-- 3 consecutive run_status='ok' rows each with m3_gate_pass AND survivors_persisted
-- >= 1 AND a fresh clean Odysseus attestation. ANY degraded/failed run or ANY
-- regression resets consecutive_clean.
--
--   Writer:  lib/loop.js -> runObservePhase() / runVerifyPhase() / recordAttestation()
--   Readers: lib/loop.js -> evaluatePromotionGate() (gate), recomputeGateAndMaybeAlert()
--   Access:  SUPABASE_SERVICE_KEY only (server-side) — RLS enabled, no policies,
--            same posture as m8_review_queue / m8_lemma_scaffold.
--
-- HONESTY (BUILD_19_SPEC §0.2, load-bearing): `promoted` certifies the LOOP is
-- STABLE — it is NEVER a claim that a conjecture is proven or novel. The
-- run_status CHECK has NO value that could read as "proven"; survivors persist
-- through lib/conjecture-gen.js with their existing "machine-generated, tested to
-- N" framing, untouched.
--
-- Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

create table if not exists public.m8_loop_runs (
  id                  bigint generated always as identity primary key,
  run_date            date not null unique,             -- idempotency key (double-fire updates, never duplicates)
  seed                bigint,                            -- SEED_BASE + dayIndex — recorded => the run is replayable
  bound               bigint,                            -- M3 test bound used this run
  m1_census_nodes     int not null default 0,            -- optional observe-leg node count
  m3_mined            int not null default 0,            -- cohort size mined
  m3_gate_pass        boolean not null default false,    -- gate-v2 Wilson lower bound > 0
  survivors_persisted int not null default 0,            -- notebook (<= 5)
  new_survivors       int not null default 0,            -- non-duplicate queue rows added (backoff signal)
  m4_target_id        bigint,                            -- the human-architected m8_lemma_scaffold id re-checked, if any
  m4_attempted        boolean not null default false,
  lean_ready          boolean not null default false,    -- /health at verify time
  m4_leaves_verified  int not null default 0,            -- "k" in "k/m leaves"
  m4_leaf_total       int not null default 0,            -- "m" in "k/m leaves"
  odysseus_run_id     bigint,                            -- latest fresh attestation (FK -> m8_odysseus_runs.id)
  run_status          text not null default 'ok'
                        check (run_status in ('ok','degraded','failed')),  -- NOTE: no 'proven', by design
  consecutive_clean   int not null default 0,            -- recomputed each run; resets on degraded/failed or any regression
  promoted            boolean not null default false,    -- the LOOP is stable (NOT a conjecture claim)
  needs_attention     text,                              -- e.g. 'slice_exhausted', 'repeated_failure'
  metadata            jsonb not null default '{}'::jsonb,-- loop/gen/novelty versions, per-leg timings, leg errors
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists m8_loop_runs_date_idx   on public.m8_loop_runs (run_date desc);
create index if not exists m8_loop_runs_status_idx  on public.m8_loop_runs (run_status);

-- RLS — server-only access (service role bypasses; anon key blocked)
alter table public.m8_loop_runs enable row level security;
