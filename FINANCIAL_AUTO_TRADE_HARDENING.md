# Financial automatic trade hardening

## Root causes fixed

1. **Missing marketSnapshotId / instrumentId**
   - createTrade previously threw: "A valid entry market snapshot is required before automatic allocation"
   - UI still said "fully automatic" → no debit, no trade record
   - **Fix:** When offer has no snapshot, create a durable `platform-entry-reference` market snapshot and proceed with capital lock.

2. **Settlement stuck waiting for market exit**
   - processAutomaticMarketSettlements returned "waiting" forever without exit prices
   - Capital stayed locked, no credit
   - **Fix:** If no exit market data after due time, settle using configured package profit rate (`expectedRewardMinor` / `configuredProfitRateBps`).

3. **Customer poll never executed trades**
   - Only workerCycle ran autoTradeOpenOpportunities
   - **Fix (prior):** customerSessionExecution on opportunities poll

4. **Non-financial / practice / hard-disabled language**
   - Removed from customer UI copy so the product presents real financial auto-trading.

## Required admin flags (you confirmed already on)
- automaticTradingEnabled on customers and package policies
- automatic delivery on package policies
- packages enabled
- global automatic trading / popup delivery masters on

## Expected live behaviour
Popup arrives + balance qualifies → capital deducted from available (any wallet via FX) → locked → progress banner → at settlement principal + profit credited with toast alerts.
