-- Build-67: add failing_probes JSONB column to m8_loop_runs
-- Enables gate-miss diagnosis from Supabase alone (no local results file needed).
-- Each entry: { probe_id, check_label, reply_excerpt } for every probe that failed.
ALTER TABLE m8_loop_runs
  ADD COLUMN IF NOT EXISTS failing_probes jsonb NOT NULL DEFAULT '[]'::jsonb;
