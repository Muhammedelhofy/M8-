-- M8 Command Center v1 — Command Ledger schema (Decision 2026-0617-CC)
-- STAGED: apply in the Supabase SQL editor with explicit OK (prod write).
-- Tables use the m8_cc_* prefix to avoid colliding with the existing m8_* research/loop
-- tables in the shared BOLT project. Cycle + max-depth guards live in CODE (lib/command-center.js),
-- not here. The Priority Engine is deterministic in code; SQL only stores state.

-- ── projects ────────────────────────────────────────────────────────────────
create table if not exists m8_cc_projects (
  id          bigserial primary key,
  title       text not null,
  track       text not null check (track in ('A_ops','B_research','infra')),
  state       text not null default 'planned'
              check (state in ('planned','active','blocked','waiting','review','done')),
  reason      text,                              -- required-by-convention when state is blocked/waiting
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── tasks ───────────────────────────────────────────────────────────────────
-- Score inputs are small fixed integer scales set by Muhammad. strategic_value is a
-- HUMAN JUDGMENT enum (1/3/5 = low/med/high), never computed — narrated as a judgment.
create table if not exists m8_cc_tasks (
  id              bigserial primary key,
  project_id      bigint references m8_cc_projects(id) on delete cascade,
  title           text not null,
  state           text not null default 'planned'
                  check (state in ('planned','active','blocked','waiting','review','done')),
  reason          text,
  deps            bigint[] not null default '{}',          -- DAG edges (this task depends on these ids)
  impact          int  not null default 3 check (impact          between 1 and 5),
  urgency         int  not null default 3 check (urgency         between 1 and 5),
  risk            int  not null default 3 check (risk            between 1 and 5),
  strategic_value int  not null default 3 check (strategic_value in (1,3,5)),  -- human judgment
  effort          int  not null default 3 check (effort          between 1 and 5),
  origin          text not null default 'human' check (origin in ('human','m8_proposed')),
  gate_status     text,                                    -- e.g. 'L6 gate' if a hard gate blocks it
  conflicts_with  bigint[] not null default '{}',          -- human-noted mutual exclusivity
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists m8_cc_tasks_project on m8_cc_tasks(project_id);
create index if not exists m8_cc_tasks_state   on m8_cc_tasks(state);

-- ── decisions (first-class, append-only, substantive rationale required) ──────
create table if not exists m8_cc_decisions (
  id              bigserial primary key,
  decided_on      date not null default current_date,
  title           text not null,
  proposal        text,
  critiques       jsonb not null default '{}'::jsonb,      -- {gpt,grok,gemini,manus,claude}
  resolution      text,
  rationale       text not null check (length(btrim(rationale)) >= 12),  -- no "feels right"
  related_task_id bigint references m8_cc_tasks(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- touch updated_at on change
create or replace function m8_cc_touch() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists m8_cc_projects_touch on m8_cc_projects;
create trigger m8_cc_projects_touch before update on m8_cc_projects
  for each row execute function m8_cc_touch();
drop trigger if exists m8_cc_tasks_touch on m8_cc_tasks;
create trigger m8_cc_tasks_touch before update on m8_cc_tasks
  for each row execute function m8_cc_touch();
