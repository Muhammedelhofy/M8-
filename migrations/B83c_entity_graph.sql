-- Build-83c: Entity Memory — cross-session entity + relationship tracking
--
-- WHY: M8 extracts facts ("5000 SAR target") but doesn't track THINGS across
-- sessions. This table makes M8 remember WHO and WHAT: "Ali is a driver, model S,
-- improving 3 weeks." "Collatz is an unsolved problem we've worked on since session 12."
-- "البداية والنهاية is a 20-volume book, vol1 ingested."
--
-- Idempotent. Apply once.

CREATE TABLE IF NOT EXISTS public.m8_entities (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  entity_type   text        NOT NULL,   -- person | book | problem | place | concept | company
  summary       text,                   -- rolling best description
  attributes    jsonb       NOT NULL DEFAULT '{}',  -- key-value facts
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  mention_count int         NOT NULL DEFAULT 1,
  UNIQUE (name, entity_type)
);

CREATE TABLE IF NOT EXISTS public.m8_entity_mentions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid        NOT NULL REFERENCES public.m8_entities(id) ON DELETE CASCADE,
  session_id  text        NOT NULL,
  context     text,                     -- what was said about this entity this turn
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS m8_entities_name_idx
  ON public.m8_entities (lower(name));

CREATE INDEX IF NOT EXISTS m8_entities_type_idx
  ON public.m8_entities (entity_type);

CREATE INDEX IF NOT EXISTS m8_entity_mentions_entity_idx
  ON public.m8_entity_mentions (entity_id);

CREATE INDEX IF NOT EXISTS m8_entity_mentions_session_idx
  ON public.m8_entity_mentions (session_id);

COMMENT ON TABLE public.m8_entities IS
  'Build-83c: one row per tracked entity (person/book/problem/etc). attributes JSONB holds rolling key-value facts. mention_count + last_seen updated on each encounter.';

COMMENT ON TABLE public.m8_entity_mentions IS
  'Build-83c: one row per session-turn where an entity was mentioned, with the context snippet.';
