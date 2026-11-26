-- Tender Bid — Stage 1 schema and source registry.
--
-- Creates the tables that back the Tender Bid desk and seeds the tender-source
-- registry (the 23 national sources plus the supranational/private aggregator
-- feeds). Sources are seeded disabled; an administrator enables a source before
-- the ingestion worker polls it, so nothing is fetched until it is deliberately
-- turned on.
--
-- Idempotent and additive, so it is safe to replay.
CREATE TABLE IF NOT EXISTS `tender_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(64) NOT NULL,
  `label` varchar(160) NOT NULL,
  `countryCode` varchar(8) NOT NULL DEFAULT '',
  `kind` enum('government','private') NOT NULL,
  `adapter` varchar(64) NOT NULL,
  `configJson` json NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `expectedIntervalMs` int NOT NULL DEFAULT 3600000,
  `lastSyncAt` timestamp NULL DEFAULT NULL,
  `lastStatus` varchar(32) NULL,
  `lastError` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tender_sources_key_uq` (`key`),
  KEY `tender_sources_country_idx` (`countryCode`),
  KEY `tender_sources_enabled_idx` (`enabled`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tenders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sourceId` int NOT NULL,
  `externalId` varchar(191) NOT NULL,
  `dedupeGroup` varchar(64) NULL,
  `countryCode` varchar(8) NOT NULL,
  `title` varchar(500) NOT NULL,
  `buyer` varchar(300) NULL,
  `buyerType` varchar(80) NULL,
  `industry` varchar(120) NULL,
  `tenderType` varchar(80) NULL,
  `procedure` varchar(120) NULL,
  `contractAmountMinor` bigint NULL,
  `contractCurrency` varchar(12) NULL,
  `contractAmountUsdMinor` bigint NULL,
  `fxSnapshotId` int NULL,
  `qualificationPctBps` int NULL,
  `qualificationAmountUsdMinor` bigint NULL,
  `qualificationOverridden` boolean NOT NULL DEFAULT false,
  `bidOpenAt` timestamp NULL DEFAULT NULL,
  `bidCloseAt` timestamp NULL DEFAULT NULL,
  `payoutAt` timestamp NULL DEFAULT NULL,
  `publishedAt` timestamp NULL DEFAULT NULL,
  `summary` varchar(1000) NULL,
  `descriptionText` longtext NULL,
  `documentsJson` json NULL,
  `sourceUrl` varchar(768) NOT NULL,
  `status` enum('upcoming','open','closing','closed','awarded') NOT NULL DEFAULT 'upcoming',
  `lastSyncedAt` timestamp NULL DEFAULT NULL,
  `rawJson` longtext NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenders_source_external_uq` (`sourceId`, `externalId`),
  KEY `tenders_country_status_idx` (`countryCode`, `status`),
  KEY `tenders_status_close_idx` (`status`, `bidCloseAt`),
  KEY `tenders_dedupe_idx` (`dedupeGroup`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tender_field_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenderId` int NOT NULL,
  `adminUserId` int NOT NULL,
  `field` varchar(64) NOT NULL,
  `oldValue` text NULL,
  `newValue` text NULL,
  `note` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tender_field_history_tender_created_idx` (`tenderId`, `createdAt`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tender_bids` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenderId` int NOT NULL,
  `userId` int NOT NULL,
  `status` enum('placed','charge_pending','charged','won','lost','cancelled') NOT NULL DEFAULT 'placed',
  `qualificationAmountUsdMinor` bigint NOT NULL,
  `chargeAmountUsdMinor` bigint NULL,
  `chargeLedgerId` int NULL,
  `idempotencyKey` varchar(160) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tender_bids_user_tender_uq` (`userId`, `tenderId`),
  UNIQUE KEY `tender_bids_idempotency_uq` (`idempotencyKey`),
  KEY `tender_bids_tender_status_idx` (`tenderId`, `status`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tender_bid_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bidId` int NOT NULL,
  `type` varchar(48) NOT NULL,
  `payloadJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tender_bid_events_bid_created_idx` (`bidId`, `createdAt`)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Seed the tender-source registry. Descriptive fields are refreshed on replay,
-- but `enabled`, `configJson`, and the health columns are never overwritten, so an
-- administrator's enable/disable choice and any recorded sync health survive.
INSERT INTO `tender_sources` (`key`, `label`, `countryCode`, `kind`, `adapter`) VALUES
  ('sam_gov', 'SAM.gov Get Opportunities (United States)', 'US', 'government', 'sam_gov'),
  ('uk_find_a_tender', 'Find a Tender (United Kingdom)', 'GB', 'government', 'find_a_tender'),
  ('canada_buys', 'CanadaBuys (Canada)', 'CA', 'government', 'canada_buys'),
  ('de_oeffentlichevergabe', 'oeffentlichevergabe.de (Germany)', 'DE', 'government', 'oeffentlichevergabe'),
  ('fr_boamp', 'BOAMP / PLACE (France)', 'FR', 'government', 'boamp'),
  ('nl_tenderned', 'TenderNed (Netherlands)', 'NL', 'government', 'tenderned'),
  ('be_enotification', 'e-Notification (Belgium)', 'BE', 'government', 'enotification'),
  ('es_placsp', 'Plataforma de Contratacion del Sector Publico (Spain)', 'ES', 'government', 'placsp'),
  ('it_anac', 'ANAC / contratti pubblici (Italy)', 'IT', 'government', 'anac'),
  ('pl_ezamowienia', 'e-Zamowienia (Poland)', 'PL', 'government', 'ezamowienia'),
  ('dk_udbud', 'udbud.dk (Denmark)', 'DK', 'government', 'udbud'),
  ('fi_hilma', 'HILMA (Finland)', 'FI', 'government', 'hilma'),
  ('ie_etenders', 'eTenders (Ireland)', 'IE', 'government', 'etenders'),
  ('no_doffin', 'Doffin (Norway)', 'NO', 'government', 'doffin'),
  ('ch_simap', 'simap.ch (Switzerland)', 'CH', 'government', 'simap'),
  ('au_austender', 'AusTender (Australia)', 'AU', 'government', 'austender'),
  ('in_cppp', 'CPPP / eProcure (India)', 'IN', 'government', 'cppp'),
  ('ng_nocopo', 'NOCOPO / BPP (Nigeria)', 'NG', 'government', 'nocopo'),
  ('ke_ppip', 'PPIP / e-GP (Kenya)', 'KE', 'government', 'ppip'),
  ('za_etenders', 'eTenders National Treasury (South Africa)', 'ZA', 'government', 'za_etenders'),
  ('gh_ghaneps', 'GHANEPS (Ghana)', 'GH', 'government', 'ghaneps'),
  ('ae_etimad', 'Etimad / aggregator (United Arab Emirates)', 'AE', 'private', 'etimad'),
  ('sa_etimad', 'Etimad / aggregator (Saudi Arabia)', 'SA', 'private', 'etimad'),
  ('eu_ted', 'EU TED (Europe)', '', 'private', 'ted'),
  ('world_bank', 'World Bank procurement (supranational)', '', 'private', 'world_bank'),
  ('ungm', 'UNGM (United Nations)', '', 'private', 'ungm'),
  ('afdb', 'African Development Bank (supranational)', '', 'private', 'afdb'),
  ('adb', 'Asian Development Bank (supranational)', '', 'private', 'adb')
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `countryCode` = VALUES(`countryCode`),
  `kind` = VALUES(`kind`),
  `adapter` = VALUES(`adapter`);
