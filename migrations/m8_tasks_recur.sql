-- m8_tasks: recurring tasks (assistant-architecture follow-up). Idempotent.
-- recur = null (one-off) | 'daily' | 'weekly' | 'monthly'. When a recurring task
-- is completed, the next occurrence is created (see api/tasks.js + orchestrator).
alter table public.m8_tasks add column if not exists recur text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'm8_tasks_recur_chk') then
    alter table public.m8_tasks add constraint m8_tasks_recur_chk
      check (recur is null or recur in ('daily','weekly','monthly'));
  end if;
end $$;
