-- Build-20: Stateful fleet alerting (ALERTING_SPEC.md §4)
-- One row per (condition, driver_key). History lives in metadata.history[].
-- Apply in Supabase SQL editor.

create table if not exists public.fleet_alerts (
  id              bigint generated always as identity primary key,
  condition       text not null,
  driver_key      text not null,
  driver_name     text not null default '',
  state           text not null default 'raised'
                    check (state in ('raised','acknowledged','in_progress','resolved','re_raised','snoozed')),
  severity        int  not null default 2,
  metric_value    numeric,
  raise_value     numeric,
  threshold       numeric,
  consecutive_clear int not null default 0,
  times_raised    int  not null default 1,
  suppression_until timestamptz,
  first_raised_at timestamptz not null default now(),
  last_checked_at timestamptz,
  acked_at        timestamptz,
  resolved_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  unique (condition, driver_key)
);

alter table public.fleet_alerts enable row level security;

create policy "service role full access" on public.fleet_alerts
  for all using (true) with check (true);

comment on table public.fleet_alerts is 'Build-20 stateful alerting. Condition #1: cash_gap. See ALERTING_SPEC.md.';
