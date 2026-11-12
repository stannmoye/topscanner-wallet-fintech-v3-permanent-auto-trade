-- Permanent: enable automatic financial execution for every package policy.
-- Supersedes migration 0113 which forced automaticTradingEnabled = 0 while
-- enabling informational delivery only.

UPDATE `packages`
SET `enabled` = 1
WHERE `enabled` = 0 OR `enabled` IS NULL;

UPDATE `opportunity_package_policies`
SET
  `enabled` = 1,
  `automaticDelivery` = 1,
  `automaticTradingEnabled` = 1,
  `minimumPayoutRateBps` = COALESCE(`minimumPayoutRateBps`, 200),
  `maximumPayoutRateBps` = COALESCE(`maximumPayoutRateBps`, GREATEST(COALESCE(`minimumPayoutRateBps`, 200), 300)),
  `minimumTradeDurationSeconds` = COALESCE(`minimumTradeDurationSeconds`, 300),
  `maximumTradeDurationSeconds` = COALESCE(`maximumTradeDurationSeconds`, GREATEST(COALESCE(`minimumTradeDurationSeconds`, 300), 900)),
  `policyVersion` = GREATEST(COALESCE(`policyVersion`, 0), 1) + 1,
  `updatedAt` = UTC_TIMESTAMP(3);

INSERT INTO `app_settings` (`settingKey`, `settingValue`, `updatedBy`)
VALUES (
  'trading.allocations.paused',
  '{"allocationsPaused":false,"reason":"Migration 0114: automatic financial execution enabled; allocations resumed.","updatedAt":null,"updatedBy":null}',
  NULL
)
ON DUPLICATE KEY UPDATE
  `settingValue` = VALUES(`settingValue`);

INSERT INTO `app_settings` (`settingKey`, `settingValue`, `updatedBy`)
VALUES (
  'trade.globalControls',
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
)
ON DUPLICATE KEY UPDATE
  `settingValue` = VALUES(`settingValue`);

-- Seed fee policy rows when missing (all NOT NULL columns required)
INSERT INTO `trading_package_fee_policy_versions`
  (`packageId`, `version`, `feeRateBps`, `roundingMode`, `effectiveAt`, `changedBy`, `changedAt`, `reason`, `source`)
SELECT
  p.`id`, 1, 1500, 'half_up', UTC_TIMESTAMP(3),
  'migration:0114', UTC_TIMESTAMP(3),
  'Default fee policy so automatic allocation is never blocked by a missing fee row.',
  'migration_0114_default_fee'
FROM `packages` p
WHERE NOT EXISTS (
  SELECT 1 FROM `trading_package_fee_policy_versions` v WHERE v.`packageId` = p.`id`
);

INSERT INTO `v5_audit_events`
  (`actorUserId`, `action`, `entityType`, `entityId`, `reason`, `reference`, `metadataJson`)
SELECT
  NULL,
  'automatic_financial_execution_enabled_all_packages',
  'trading_package_policy',
  'all',
  'Migration 0114 enables automaticTradingEnabled for all package policies and resumes allocations. Supersedes 0113 informational-only mode.',
  'migration-0114-enable-automatic-financial-execution',
  JSON_OBJECT(
    'migration', '0114_enable_automatic_financial_execution_all_packages',
    'supersedes', '0113_enable_tiers_for_informational_delivery',
    'automaticTradingEnabled', true
  )
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `v5_audit_events`
  WHERE `reference` = 'migration-0114-enable-automatic-financial-execution'
);
