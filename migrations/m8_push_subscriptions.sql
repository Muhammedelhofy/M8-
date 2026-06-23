-- Web Push reminders (assistant-architecture build #4). Idempotent.
-- One row per browser/device push subscription; the due-task cron sends to all.
create table if not exists public.m8_push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Per-task "already pinged" marker so the */15 cron never re-notifies the same task.
alter table public.m8_tasks add column if not exists reminded_at timestamptz;
