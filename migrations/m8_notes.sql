-- m8_notes: general note store (assistant-architecture build #2)
-- A SEPARATE typed store from m8_tasks — notes never appear in the Tasks tab.
-- Captured via chat ("note:" / "remember …" / confirm-gated free-form) and recalled
-- deterministically (code-templated, no LLM). Idempotent: safe to re-run.
create table if not exists public.m8_notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  source text not null default 'chat',   -- 'chat' | 'migrated' | …
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists m8_notes_created_idx on public.m8_notes (created_at desc) where archived = false;
