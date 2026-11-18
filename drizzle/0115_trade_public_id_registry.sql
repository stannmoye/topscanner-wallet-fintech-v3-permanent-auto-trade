-- Add customer-facing references without changing internal numeric trade IDs.
CREATE TABLE IF NOT EXISTS `trade_public_ids` (
  `publicId` varchar(17) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`publicId`)
);

ALTER TABLE `opportunity_popup_events`
  ADD COLUMN IF NOT EXISTS `publicTradeId` varchar(17) NULL;

ALTER TABLE `trade_positions`
  ADD COLUMN IF NOT EXISTS `publicTradeId` varchar(17) NULL;

-- Deterministic, collision-free references for historical trades. New IDs use
-- cryptographic random generation in the application.
UPDATE `trade_positions`
SET `publicTradeId` = CONCAT(
  'TX-',
  SUBSTRING(LPAD(UPPER(HEX(`id`)), 12, '0'), 1, 4), '-',
  SUBSTRING(LPAD(UPPER(HEX(`id`)), 12, '0'), 5, 4), '-',
  SUBSTRING(LPAD(UPPER(HEX(`id`)), 12, '0'), 9, 4)
)
WHERE `publicTradeId` IS NULL;

-- A popup that already became a trade inherits that trade's public reference.
UPDATE `opportunity_popup_events` AS popup
INNER JOIN `trade_positions` AS trade ON trade.`id` = popup.`tradeId`
SET popup.`publicTradeId` = trade.`publicTradeId`
WHERE popup.`publicTradeId` IS NULL;

-- Remaining retained popup events use a disjoint numeric range for backfill.
UPDATE `opportunity_popup_events`
SET `publicTradeId` = CONCAT(
  'TX-',
  SUBSTRING(LPAD(UPPER(HEX(`id` + 4294967296)), 12, '0'), 1, 4), '-',
  SUBSTRING(LPAD(UPPER(HEX(`id` + 4294967296)), 12, '0'), 5, 4), '-',
  SUBSTRING(LPAD(UPPER(HEX(`id` + 4294967296)), 12, '0'), 9, 4)
)
WHERE `publicTradeId` IS NULL;

INSERT IGNORE INTO `trade_public_ids` (`publicId`)
SELECT `publicTradeId` FROM `trade_positions` WHERE `publicTradeId` IS NOT NULL;

INSERT IGNORE INTO `trade_public_ids` (`publicId`)
SELECT `publicTradeId` FROM `opportunity_popup_events` WHERE `publicTradeId` IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `opportunity_popup_public_trade_id_uq`
  ON `opportunity_popup_events` (`publicTradeId`);

CREATE UNIQUE INDEX IF NOT EXISTS `trade_positions_public_trade_id_uq`
  ON `trade_positions` (`publicTradeId`);
