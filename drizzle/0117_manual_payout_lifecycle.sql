-- Manual customer payout requests.
--
-- A customer submits a withdrawal request (an amount plus either BTC/ETH/USDT
-- wallet details or USD/EUR/GBP bank details). The request lands in an initial
-- review state and an administrator records the final outcome. This workflow
-- never calls an external payment or custody provider.
--
-- Lifecycle vocabulary:
--   confirming | processing -> submitted, awaiting administrator review
--   completed  | declined    -> administrator decision
--   cancelled                 -> customer cancellation
--
-- This file both creates the table on hosts that never applied the original
-- creation migration and migrates any existing table from the original
-- ('pending','paid','rejected','cancelled') vocabulary onto the lifecycle
-- vocabulary. It never drops a table, column or row.
CREATE TABLE IF NOT EXISTS `payout_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `requestReference` varchar(72) NOT NULL,
  `idempotencyKey` varchar(180) NOT NULL,
  `currency` varchar(12) NOT NULL,
  `amountMinor` bigint NOT NULL,
  `destinationType` enum('bank_transfer','crypto_transfer') NOT NULL,
  `destinationDetails` text NOT NULL,
  `status` enum('confirming','processing','completed','declined','cancelled') NOT NULL DEFAULT 'processing',
  `externalReference` varchar(160) NULL,
  `resolutionNote` varchar(1000) NULL,
  `resolvedBy` int NULL,
  `resolvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payout_requests_reference_unique` (`requestReference`),
  UNIQUE KEY `payout_requests_idempotency_unique` (`idempotencyKey`),
  UNIQUE KEY `payout_requests_external_reference_unique` (`externalReference`),
  KEY `payout_requests_user_created_idx` (`userId`,`createdAt`,`id`),
  KEY `payout_requests_status_created_idx` (`status`,`createdAt`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Widen the status enum so historical rows can be backfilled before the
-- lifecycle enum is reapplied. Harmless on a freshly created table.
ALTER TABLE `payout_requests` MODIFY COLUMN `status` ENUM('pending','paid','rejected','cancelled','confirming','processing','completed','declined') NOT NULL DEFAULT 'processing';

UPDATE `payout_requests` SET `status` = 'confirming' WHERE `status` = 'pending' AND `currency` IN ('BTC','ETH','USDT');
UPDATE `payout_requests` SET `status` = 'processing' WHERE `status` = 'pending';
UPDATE `payout_requests` SET `status` = 'completed' WHERE `status` = 'paid';
UPDATE `payout_requests` SET `status` = 'declined' WHERE `status` = 'rejected';

-- Reapply the canonical lifecycle enum now that no historical value remains.
ALTER TABLE `payout_requests` MODIFY COLUMN `status` ENUM('confirming','processing','completed','declined','cancelled') NOT NULL DEFAULT 'processing';
