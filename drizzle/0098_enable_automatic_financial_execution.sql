-- Automatic financial execution is enabled for qualifying customers through the audited internal ledger.
-- Preserve each package's delivery policy and explicitly enable only the execution switch.
-- External-market execution is not claimed.
UPDATE `opportunity_package_policies`
SET `automaticTradingEnabled` = 1
WHERE `automaticTradingEnabled` = 0;
