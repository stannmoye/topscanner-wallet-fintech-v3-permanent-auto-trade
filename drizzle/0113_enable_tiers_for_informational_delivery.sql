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
SET
  policy.`minimumPayoutRateBps` = 200,
  policy.`maximumPayoutRateBps` = 300
WHERE policy.`minimumPayoutRateBps` IS NULL
   OR policy.`maximumPayoutRateBps` IS NULL
   OR policy.`minimumPayoutRateBps` < 1
   OR policy.`maximumPayoutRateBps` < policy.`minimumPayoutRateBps`
   OR policy.`maximumPayoutRateBps` > 5000;
--> statement-breakpoint
UPDATE `opportunity_package_policies` policy
JOIN `packages` package
  ON LOWER(policy.`packageName`) = LOWER(package.`name`)
SET
  policy.`minimumTradeDurationSeconds` = 300,
  policy.`maximumTradeDurationSeconds` = 900
WHERE policy.`minimumTradeDurationSeconds` IS NULL
   OR policy.`maximumTradeDurationSeconds` IS NULL
   OR policy.`minimumTradeDurationSeconds` < 10
   OR policy.`maximumTradeDurationSeconds` < policy.`minimumTradeDurationSeconds`
   OR policy.`maximumTradeDurationSeconds` > 86400;
--> statement-breakpoint
UPDATE `opportunity_package_policies` policy
JOIN `packages` package
  ON LOWER(policy.`packageName`) = LOWER(package.`name`)
SET
  policy.`enabled` = 1,
  policy.`automaticDelivery` = 1,
  policy.`automaticTradingEnabled` = 0,
  policy.`dailyPopupTarget` = CASE
    WHEN policy.`dailyPopupTarget` > 0 THEN policy.`dailyPopupTarget`
    ELSE GREATEST(1, package.`opportunitiesPerDay`)
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
