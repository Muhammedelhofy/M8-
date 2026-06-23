-- m8_tasks: work/personal category (assistant-architecture build #1)
-- Additive + reversible. Existing rows backfill to 'personal'.
-- Idempotent: safe to re-run.
alter table public.m8_tasks
  add column if not exists category text not null default 'personal';

-- Constrain to the two supported buckets (the app validates too).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'm8_tasks_category_chk') then
    alter table public.m8_tasks
      add constraint m8_tasks_category_chk check (category in ('work','personal'));
  end if;
end $$;
