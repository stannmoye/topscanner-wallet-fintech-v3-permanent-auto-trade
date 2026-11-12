# Permanent automatic trading unlock

Hard blockers removed so real-time debit/credit always run for funded active customers.

## Deploy
1. Deploy this tree
2. Apply migration `drizzle/0112_permanent_automatic_financial_execution.sql`
3. Restart API (heartbeat workers)

## Changes
- automaticTradingEnabled no longer required for allocation; migration forces ON
- Rate/duration defaults; never fail closed
- allocations.paused always treated as resumed
- requirePreviousSettlement never blocks
- Concurrent/daily/reward caps are soft quota only
- Missing fee policy uses 1500 bps default
- Insufficient balance shows deposit guidance toast
- Green + credit / red − debit fade toasts with optional tones

Stuck settlements remain available for admin manual credit and do not freeze the next trade.
