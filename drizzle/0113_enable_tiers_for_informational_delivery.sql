-- Restore the administrator's package ON state and informational delivery.
-- This migration deliberately disables automatic financial execution for every tier.
-- It does not reserve, debit, lock, or settle customer funds.
--> statement-breakpoint
ALTER TABLE `opportunity_package_policies`
  ALTER COLUMN `automaticTradingEnabled` SET DEFAULT 0;
--> statement-breakpoint
UPDATE `packages`
SET `enabled` = 1
WHERE `enabled` <> 1 OR `enabled` IS NULL;
--> statement-breakpoint
INSERT INTO `opportunity_package_policies` (
  `packageName`, `minimumPayoutRateBps`, `maximumPayoutRateBps`,
  `minimumTradeDurationSeconds`, `maximumTradeDurationSeconds`,
  `dailyPopupTarget`, `enabled`, `automaticDelivery`,
  `automaticTradingEnabled`, `policyVersion`, `updatedBy`
)
SELECT
  package.`name`, 200, 300, 300, 900,
  GREATEST(1, package.`opportunitiesPerDay`), 1, 1, 0, 1, NULL
FROM `packages` package
LEFT JOIN `opportunity_package_policies` existing
  ON LOWER(existing.`packageName`) = LOWER(package.`name`)
WHERE existing.`id` IS NULL;
--> statement-breakpoint
UPDATE `opportunity_package_policies` policy
JOIN `packages` package
  ON LOWER(policy.`packageName`) = LOWER(package.`name`)
JOIN (
  SELECT
    `id`,
    `minimumPayoutRateBps` AS `savedMinimumPayoutRateBps`,
    `maximumPayoutRateBps` AS `savedMaximumPayoutRateBps`,
    `minimumTradeDurationSeconds` AS `savedMinimumTradeDurationSeconds`,
    `maximumTradeDurationSeconds` AS `savedMaximumTradeDurationSeconds`
  FROM `opportunity_package_policies`
) saved ON saved.`id` = policy.`id`
SET
  policy.`enabled` = 1,
  policy.`automaticDelivery` = 1,
  policy.`automaticTradingEnabled` = 0,
  policy.`dailyPopupTarget` = CASE
    WHEN policy.`dailyPopupTarget` > 0 THEN policy.`dailyPopupTarget`
    ELSE GREATEST(1, package.`opportunitiesPerDay`)
  END,
  policy.`minimumPayoutRateBps` = CASE
    WHEN saved.`savedMinimumPayoutRateBps` BETWEEN 1 AND 5000
     AND saved.`savedMaximumPayoutRateBps` BETWEEN saved.`savedMinimumPayoutRateBps` AND 5000
    THEN saved.`savedMinimumPayoutRateBps` ELSE 200
  END,
  policy.`maximumPayoutRateBps` = CASE
    WHEN saved.`savedMinimumPayoutRateBps` BETWEEN 1 AND 5000
     AND saved.`savedMaximumPayoutRateBps` BETWEEN saved.`savedMinimumPayoutRateBps` AND 5000
    THEN saved.`savedMaximumPayoutRateBps` ELSE 300
  END,
  policy.`minimumTradeDurationSeconds` = CASE
    WHEN saved.`savedMinimumTradeDurationSeconds` BETWEEN 10 AND 86400
     AND saved.`savedMaximumTradeDurationSeconds` BETWEEN saved.`savedMinimumTradeDurationSeconds` AND 86400
    THEN saved.`savedMinimumTradeDurationSeconds` ELSE 300
  END,
  policy.`maximumTradeDurationSeconds` = CASE
    WHEN saved.`savedMinimumTradeDurationSeconds` BETWEEN 10 AND 86400
     AND saved.`savedMaximumTradeDurationSeconds` BETWEEN saved.`savedMinimumTradeDurationSeconds` AND 86400
    THEN saved.`savedMaximumTradeDurationSeconds` ELSE 900
  END,
  policy.`policyVersion` = GREATEST(COALESCE(policy.`policyVersion`, 0), 1) + 1,
  policy.`updatedAt` = UTC_TIMESTAMP(3);
--> statement-breakpoint
INSERT IGNORE INTO `v5_audit_events`
  (`actorUserId`, `action`, `entityType`, `entityId`, `reason`, `reference`, `metadataJson`)
VALUES
  (NULL, 'trading_tiers_enabled_for_informational_delivery', 'trading_package_policy', 'all',
   'Forward migration 0113 enables all package tiers and informational delivery while explicitly disabling automatic financial execution.',
   'migration-0113-enable-informational-tier-delivery',
   JSON_OBJECT('migration', '0113_enable_tiers_for_informational_delivery',
     'packagesEnabled', true, 'informationalDeliveryEnabled', true,
     'automaticTradingEnabled', false));
