-- Tender Bid — weekly ingestion cadence.
--
-- The ingestion worker now polls each enabled source once a week instead of
-- hourly, so tender fetching no longer runs continuously. This migration moves
-- the `tender_sources.expectedIntervalMs` default to seven days and lifts every
-- source still on the previous one-hour default to the weekly cadence, leaving
-- any source an administrator has given a custom interval untouched.
--
-- Replaying only re-asserts the same default and is a no-op on rows already at
-- the weekly cadence.
ALTER TABLE `tender_sources` MODIFY COLUMN `expectedIntervalMs` int NOT NULL DEFAULT 604800000;
--> statement-breakpoint
UPDATE `tender_sources` SET `expectedIntervalMs` = 604800000 WHERE `expectedIntervalMs` = 3600000;
