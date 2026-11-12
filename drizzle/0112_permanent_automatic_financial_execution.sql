-- Permanent automatic financial execution.
-- Neutralizes migration 0098 and fail-closed allocation holds.
-- All INSERT column lists match NOT NULL schema requirements.

-- 1) Force automatic trading ON and fill missing rate/duration ranges.
UPDATE `opportunity_package_policies`
SET
  `automaticTradingEnabled` = 1,
  `enabled` = COALESCE(`enabled`, 1),
  `automaticDelivery` = COALESCE(`automaticDelivery`, 1),
  `minimumPayoutRateBps` = COALESCE(`minimumPayoutRateBps`, 100),
  `maximumPayoutRateBps` = COALESCE(`maximumPayoutRateBps`, GREATEST(COALESCE(`minimumPayoutRateBps`, 100), 500)),
  `minimumTradeDurationSeconds` = COALESCE(`minimumTradeDurationSeconds`, 60),
  `maximumTradeDurationSeconds` = COALESCE(`maximumTradeDurationSeconds`, GREATEST(COALESCE(`minimumTradeDurationSeconds`, 60), 3600));

-- 2) Global controls: previous-settlement OFF; delivery masters ON when row exists.
UPDATE `app_settings`
SET `settingValue` = JSON_OBJECT(
  'tierPolicyMasterEnabled', true,
  'informationalPopupDeliveryEnabled', true,
  'companyRotationEnabled', true,
  'randomizedTimingEnabled', true,
  'burstDeliveryEnabled', true,
  'requirePreviousSettlement', false,
  'policyVersion', 1,
  'updatedBy', NULL,
  'updatedAt', NULL
)
WHERE `settingKey` = 'trade.globalControls';

-- 3) Seed global controls when missing.
INSERT INTO `app_settings` (`settingKey`, `settingValue`, `updatedBy`)
SELECT
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
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `app_settings` WHERE `settingKey` = 'trade.globalControls');

-- 4) Allocations always resumed.
INSERT INTO `app_settings` (`settingKey`, `settingValue`, `updatedBy`)
VALUES (
  'trading.allocations.paused',
  '{"allocationsPaused":false,"reason":"Permanent automatic trading — pause control disabled by migration 0112.","updatedAt":null,"updatedBy":null}',
  NULL
)
ON DUPLICATE KEY UPDATE
  `settingValue` = VALUES(`settingValue`);

-- 5) Seed default fee policy for every package that has none.
-- Required columns: packageId, version, feeRateBps, roundingMode, effectiveAt,
-- changedBy, reason, source (changedAt has DEFAULT).
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
  'Default package fee policy seeded by migration 0112 so automatic allocation is never blocked by a missing fee row.',
  'migration_0112_default_fee'
FROM `packages` p
WHERE NOT EXISTS (
  SELECT 1 FROM `trading_package_fee_policy_versions` v WHERE v.`packageId` = p.`id`
);

-- 6) Audit trail (optional; columns match nullable actorUserId).
INSERT INTO `v5_audit_events`
  (`actorUserId`, `action`, `entityType`, `entityId`, `reason`, `reference`, `metadataJson`)
SELECT
  NULL,
  'permanent_automatic_financial_execution',
  'trade_package_policy',
  'global',
  'Migration 0112 permanently enables automatic trading for all packages, resumes allocations, disables previous-settlement blocking, seeds default fee policies, and fills missing rate/duration ranges.',
  'migration-0112-permanent-automatic-financial-execution',
  JSON_OBJECT(
    'migration', '0112_permanent_automatic_financial_execution',
    'supersedes', '0098_disable_automatic_financial_execution'
  )
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `v5_audit_events`
  WHERE `reference` = 'migration-0112-permanent-automatic-financial-execution'
);
