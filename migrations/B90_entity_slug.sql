-- migrations/B90_entity_slug.sql
-- Build-90: Entity canonicalization.
--   slug — canonical key used to collapse transliteration / spelling variants
--          ("Ahmad" / "أحمد" / "احمد" / "Ahmed") onto a single m8_entities row,
--          so the knowledge graph stops fragmenting and mention_count stays whole.
--
-- The application computes the real (consonant-skeleton) slug in lib/entity-slug.js
-- and matches by recomputing slugs from names, so this SQL backfill only needs to
-- set a non-null placeholder for pre-existing rows; the app overwrites it with the
-- proper slug the next time each entity is seen.
-- Idempotent: safe to re-apply.

ALTER TABLE m8_entities ADD COLUMN IF NOT EXISTS slug text;
CREATE INDEX IF NOT EXISTS m8_entities_slug_idx ON m8_entities(slug);
UPDATE m8_entities SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g')) WHERE slug IS NULL;
