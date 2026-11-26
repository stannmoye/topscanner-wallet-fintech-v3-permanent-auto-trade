-- Tender Bid — Stage 5: administrator corrections and source health.
--
-- Adds the per-tender override marker used by the Tender corrections menu.
-- `overridesJson` maps each administrator-overridden `tenders` field to the
-- source-derived value captured when it was first overridden. Ingestion reads
-- the keys and leaves those fields untouched, so an administrator override
-- survives re-ingestion; the map also lets the administrator revert a field to
-- its source value (the captured value is restored and the key removed).
--
-- Idempotent and additive, so it is safe to replay.
ALTER TABLE `tenders`
  ADD COLUMN IF NOT EXISTS `overridesJson` json NULL;
