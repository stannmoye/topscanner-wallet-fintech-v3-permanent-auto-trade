-- Settle immediately at trade completion / pop-up close.
--
-- The former global settlement-review delay (and the per-package minimum and
-- maximum settlement-delay floors) held the customer's principal locked for a
-- fixed 15 minutes after the scheduled trade completion, so settlement finished
-- long after the trade completed and the pop-up closed. Remove that forced delay
-- so the settlement-review and wallet-credit instants coincide with trade
-- completion. Existing trades keep their saved deadlines; only future
-- allocations and future policy reads use the immediate-settlement values.
UPDATE `app_settings`
  SET `settingValue` = '0', `updatedAt` = CURRENT_TIMESTAMP
  WHERE `settingKey` = 'trade.settlementDelaySeconds'
    AND `settingValue` <> '0';

UPDATE `opportunity_package_policies`
  SET `minSettlementDelaySeconds` = 0,
      `maxSettlementDelaySeconds` = 0
  WHERE `minSettlementDelaySeconds` <> 0
     OR `maxSettlementDelaySeconds` <> 0;
