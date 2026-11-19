-- Withdrawals are unrestricted for every customer account.
--
-- The per-customer `withdrawalsEnabled` flag is no longer an eligibility gate:
-- the server lets any existing customer account request a payout at any time,
-- and no administrator control can re-disable it. This migration makes the
-- stored database state match that behaviour by enabling the column default and
-- bringing every existing customer row to the enabled state.
--
-- Idempotent and additive, so it is safe to replay.

ALTER TABLE `customer_controls`
  MODIFY COLUMN `withdrawalsEnabled` tinyint(1) NOT NULL DEFAULT 1;

UPDATE `customer_controls` SET `withdrawalsEnabled` = 1 WHERE `withdrawalsEnabled` = 0;
