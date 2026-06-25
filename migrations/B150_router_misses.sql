-- Build-150: Router Miss Logger.
-- One row per message that fell through every deterministic parser and hit the
-- Phase-0 capability-decline safety net (capabilityFallback in orchestrator.js).
-- These are unhandled phrasings Muhammad can later use to teach M8 new routes.
--
-- PRIVACY: only the REDACTED form of the message is stored (digits, currency
-- codes/symbols, and money-domain nouns stripped before insert). No raw amounts,
-- balances, or PII are persisted. Written by lib/miss-logger.js logMiss()
-- fire-and-forget (a logging hiccup must never block or alter the reply).

CREATE TABLE IF NOT EXISTS m8_router_misses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL    DEFAULT now(),
  message_redacted text        NOT NULL,   -- phrasing with digits/currency/money nouns stripped
  lane             text,                   -- "money" | "task" | "note" | "unknown"
  reason           text                    -- e.g. "phase0_safety_net"
);

CREATE INDEX IF NOT EXISTS m8_router_misses_created_idx
  ON m8_router_misses(created_at DESC);
