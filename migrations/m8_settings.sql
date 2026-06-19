-- Build-70: generic key/value settings store.
-- First use: morning-brief email preferences
--   key='morning_brief_email', value={ enabled, recipient, unsubscribe_token }.
-- Reusable for any future M8 preference (notification channels, toggles, etc.).
create table if not exists m8_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
