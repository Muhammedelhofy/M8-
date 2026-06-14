-- Build-30: Provenance Tagging on m8_conversations
-- Design: PROVENANCE_TAGGING_DESIGN.md (Team Round 4 consensus, action item #4)
--
-- Replaces the content-regex LOOP_TRIAGE_CONTAMINATION filter with permanent
-- metadata: every row is tagged with WHERE it came from (source_type) and HOW
-- MUCH to trust it at recall (trust_level). Default recall excludes anything
-- below trust_level 3 -- this is what keeps Odysseus/battery-run rows (od_,
-- battery_, l5_, eval_ session prefixes) out of Muhammad's real memory.
--
-- Idempotent. Safe to run on the live table -- existing rows default to
-- user_session / trust_level 4 (conservative: no recall degradation for
-- anything not explicitly backfilled below).

ALTER TABLE m8_conversations
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'user_session'
    CHECK (source_type IN ('user_session','eval_probe','cron_session','summary')),
  ADD COLUMN IF NOT EXISTS trust_level INTEGER DEFAULT 4
    CHECK (trust_level BETWEEN 1 AND 4);

-- Backfill existing eval/battery/loop probe rows (od_, battery_, l5_, eval_
-- session-id prefixes) -- these are the rows that caused the Build-26
-- contamination bug (confabulated triage verdicts recalled as real memory).
UPDATE m8_conversations
SET source_type = 'eval_probe', trust_level = 1
WHERE session_id ~* '^(l5_|eval_|od_|battery_)';

-- Backfill existing summary rows.
UPDATE m8_conversations
SET source_type = 'summary', trust_level = 3
WHERE role = 'summary';
