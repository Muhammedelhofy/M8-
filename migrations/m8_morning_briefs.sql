-- Build-68: Track-A Morning Fleet Brief
-- One persisted brief per calendar date (Riyadh). The cron upserts on `date`
-- so a re-run the same morning overwrites rather than duplicates. brief_json
-- holds the full 3-section object; summary_text is the human-readable rendering
-- so a reader (or M8 chat) can show it without re-deriving anything.
create table if not exists m8_morning_briefs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  date         date unique,
  brief_json   jsonb,
  summary_text text
);

create index if not exists m8_morning_briefs_date_idx on m8_morning_briefs (date desc);
