-- ============================================================================
-- M8 · Build-19 — Odysseus attestation ledger (L5 regression check)
-- ============================================================================
-- One row per live Odysseus battery run used as the L5 regression gate. Written
-- by run-battery.ps1 -AttestTo via POST /api/loop-attest. The L5 probe set =
-- battery-l5.json (the autonomy family) + battery-m3-armed.json (generation /
-- novelty / survivor / scaffold lanes); the honesty-core groups of battery.json
-- are a recommended additional manual run. A "regression" is a deterministic diff
-- vs the FROZEN tests/odysseus/baseline-L5.json: any probe true in baseline and
-- false now. `pass` = (failed == 0 AND regressions == []).
--
--   Writer:  lib/loop.js -> recordAttestation()  (via /api/loop-attest)
--   Reader:  lib/loop.js -> fetchLatestAttestation() / evaluatePromotionGate()
--   Access:  SUPABASE_SERVICE_KEY only — RLS enabled, no policies.
--
-- HONESTY: deterministic regex graders only (battery discipline) — NO LLM judge
-- anywhere in the gate. The baseline is frozen and bumped only deliberately (an
-- auto-refresh would let a regression silently become the new normal).
--
-- Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

create table if not exists public.m8_odysseus_runs (
  id            bigint generated always as identity primary key,
  run_at        timestamptz not null default now(),
  baseline_ref  text,                                  -- e.g. 'baseline-L5.json@<sha>'
  total         int not null default 0,
  passed        int not null default 0,
  failed        int not null default 0,
  regressions   jsonb not null default '[]'::jsonb,    -- [{probeId, baseline:true, now:false}] — empty => clean
  pass          boolean not null default false,        -- failed==0 AND regressions==[]
  metadata      jsonb not null default '{}'::jsonb     -- probe sources, session prefix, base url
);

create index if not exists m8_odysseus_runs_at_idx on public.m8_odysseus_runs (run_at desc);

-- RLS — server-only access (service role bypasses; anon key blocked)
alter table public.m8_odysseus_runs enable row level security;
