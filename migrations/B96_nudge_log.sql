-- Build-96: Driver Nudge Logging.
-- One row per driver nudge DRAFTED by M8 (Track-A nudges are draft-only — M8
-- never messages a driver directly; Muhammad sends on WhatsApp). This is the
-- audit trail of what tone went to whom, when, and why — read back by the
-- /api/nudge-history endpoint and summarized into the morning brief.
-- Written by lib/nudge-logger.js logNudge() fire-and-forget (failures are silent;
-- a logging hiccup must never block or change the drafted messages).

CREATE TABLE IF NOT EXISTS m8_nudge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_name text NOT NULL,
  tone_bucket text NOT NULL,   -- welcome | urgent | awareness | keepItUp | appreciation | reEngage
  message_preview text,        -- first 120 chars of the nudge text drafted
  trigger_reason text,         -- e.g. 'below target pace', 'dropped below pace yesterday'
  driver_net_sar numeric,      -- driver's current MTD net (SAR) when the nudge fired
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS m8_nudge_log_driver_idx ON m8_nudge_log(driver_name);
CREATE INDEX IF NOT EXISTS m8_nudge_log_created_idx ON m8_nudge_log(created_at DESC);
