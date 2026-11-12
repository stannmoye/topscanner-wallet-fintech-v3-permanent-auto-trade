-- Permanent automatic financial execution.
-- Neutralizes migration 0098 and fail-closed allocation holds.

UPDATE `opportunity_package_policies`
SET
  `automaticTradingEnabled` = 1,
  `enabled` = IF(`enabled` IS NULL, 1, `enabled`),
  `automaticDelivery` = IF(`automaticDelivery` IS NULL, 1, `automaticDelivery`),
  `minimumPayoutRateBps` = COALESCE(`minimumPayoutRateBps`, 100),
  `maximumPayoutRateBps` = COALESCE(`maximumPayoutRateBps`, GREATEST(COALESCE(`minimumPayoutRateBps`, 100), 500)),
  `minimumTradeDurationSeconds` = COALESCE(`minimumTradeDurationSeconds`, 60),
  `maximumTradeDurationSeconds` = COALESCE(`maximumTradeDurationSeconds`, GREATEST(COALESCE(`minimumTradeDurationSeconds`, 60), 3600));

UPDATE `app_settings`
SET `settingValue` = JSON_SET(
  COALESCE(`settingValue`, JSON_OBJECT()),
  '$.requirePreviousSettlement', false,
  '$.informationalPopupDeliveryEnabled', true,
  '$.tierPolicyMasterEnabled', true
)
WHERE `settingKey` = 'trade.globalControls';

INSERT INTO `app_settings` (`settingKey`, `settingValue`, `updatedBy`)
SELECT 'trade.globalControls',
  JSON_OBJECT(
    'tierPolicyMasterEnabled', true,
    'informationalPopupDeliveryEnabled', true,
    'companyRotationEnabled', true,
    'randomizedTimingEnabled', true,
    'burstDeliveryEnabled', true,
    'requirePreviousSettlement', false,
    'policyVersion', 1,
    'updatedBy', NULL,
    'updatedAt', NULL
  ),
  NULL
WHERE NOT EXISTS (SELECT 1 FROM `app_settings` WHERE `settingKey` = 'trade.globalControls');

INSERT INTO `app_settings` (`settingKey`, `settingValue`, `updatedBy`)
VALUES (
  'trading.allocations.paused',
  '{"allocationsPaused":false,"reason":"Permanent automatic trading — pause control disabled by migration 0112.","updatedAt":null,"updatedBy":null}',
  NULL
)
ON DUPLICATE KEY UPDATE
  `settingValue` = '{"allocationsPaused":false,"reason":"Permanent automatic trading — pause control disabled by migration 0112.","updatedAt":null,"updatedBy":null}';

INSERT INTO `trading_package_fee_policy_versions`
  (`packageId`, `version`, `feeRateBps`, `roundingMode`, `effectiveAt`, `changedBy`, `changedAt`, `reason`, `source`)
SELECT
  p.`id`,
  1,
  1500,
  'half_up',
  UTC_TIMESTAMP(3),
  'migration:0112',
  UTC_TIMESTAMP(3),
  'Default package fee policy seeded by permanent automatic financial execution migration 0112.',
  'permanent_automatic_financial_execution_0112'
FROM `packages` p
WHERE NOT EXISTS (
  SELECT 1 FROM `trading_package_fee_policy_versions` v WHERE v.`packageId` = p.`id`
);

INSERT IGNORE INTO `v5_audit_events`
  (`actorUserId`, `action`, `entityType`, `entityId`, `reason`, `reference`, `metadataJson`)
VALUES (
  NULL,
  'permanent_automatic_financial_execution',
  'trade_package_policy',
  'global',
  'Migration 0112 permanently enables automatic trading for all packages, resumes allocations, disables previous-settlement blocking, seeds default fee policies, and fills missing rate/duration ranges.',
  'migration-0112-permanent-automatic-financial-execution',
  JSON_OBJECT('migration', '0112_permanent_automatic_financial_execution', 'supersedes', '0098_disable_automatic_financial_execution')
);
