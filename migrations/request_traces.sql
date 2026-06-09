-- ============================================================================
-- M8 · request_traces   (Supabase / Postgres — project ltqpoupferwituusxwal)
-- ============================================================================
-- Per-request observability: one row per /api/chat request, so "M8 gave a weird
-- answer" and silent failures become inspectable instead of guesswork.
--
--   Writer:  lib/memory.js  -> logTrace()      (called from lib/orchestrator.js:403)
--   Reader:  api/traces.js  -> GET /api/traces
--   Access:  SUPABASE_SERVICE_KEY (server-side) for BOTH writer and reader.
--
-- Columns mirror the insert in logTrace() exactly, so no insert can silently
-- fail on a type mismatch. Idempotent: safe to run more than once.
-- ----------------------------------------------------------------------------

-- 1) Table -------------------------------------------------------------------
create table if not exists public.request_traces (
  id              bigint generated always as identity primary key,
  session_id      text,
  intent          text,
  provider        text,
  recovered       boolean,        -- recovered via a fallback provider?
  search_fired    boolean,        -- did web search run this turn?
  search_results  integer,        -- # results returned
  memory_rows     integer,        -- # memory rows injected
  playbooks       text,           -- comma-joined domains, e.g. 'ops,finance' (or null)
  latency_ms      integer,        -- end-to-end request time
  ok              boolean,        -- false = served the fallback response
  error           text,           -- error / fallback reason (<=300 chars)
  created_at      timestamptz not null default now()
);

-- 2) Indexes -----------------------------------------------------------------
-- Global "recent 40, newest first"   (GET /api/traces, no filter)
create index if not exists request_traces_created_at_idx
  on public.request_traces (created_at desc);

-- Per-session view                    (GET /api/traces?session=<id>)
create index if not exists request_traces_session_created_idx
  on public.request_traces (session_id, created_at desc);

-- ── Per-phase latency columns (#3 latency instrumentation, 2026-06-08) ────────
-- Break the total latency_ms into the awaited stages of one /api/chat request.
-- Idempotent; run before deploying the timing code (else logTrace inserts fail
-- silently). Residual (latency_ms - sum of phases) ≈ cold start + overhead.
alter table public.request_traces add column if not exists memory_ms  integer;  -- recallMemory()
alter table public.request_traces add column if not exists fleet_ms   integer;  -- buildFleetContext()
alter table public.request_traces add column if not exists router_ms  integer;  -- decideAction() knowledge router
alter table public.request_traces add column if not exists search_ms  integer;  -- Tavily search
alter table public.request_traces add column if not exists llm_ms     integer;  -- main generate() (explain step)
alter table public.request_traces add column if not exists summary_ms integer;  -- summarizeSession()

-- ── L4 tool-decision column (Build-4, 2026-06-10) ────────────────────────────
-- Which truth-tool handled the turn: fleet | state | compute | search |
-- open_problem | build_state | answer. Lets the Build-5 eval and /api/traces
-- show the tool-selection mix. Idempotent. RUN THIS FIRST, then uncomment the
-- `tool_decision: toolDecision` line in lib/memory.js logTrace() + the two
-- orchestrator call sites — adding the field to the insert BEFORE the column
-- exists makes the whole insert fail silently and kills ALL tracing.
alter table public.request_traces add column if not exists tool_decision text;

-- ============================================================================
-- 3) OPTIONAL HARDENING  —  run this ONE line only AFTER you've confirmed that
--    /api/traces populates (tableError: null + rows appear).
-- ----------------------------------------------------------------------------
-- Traces are server-only. Both writer and reader use the service role, which
-- BYPASSES row-level security — so enabling RLS with no policies blocks the
-- public anon key from ever reading traces while the app keeps working.
-- Reversible:  alter table public.request_traces disable row level security;
--
-- alter table public.request_traces enable row level security;
