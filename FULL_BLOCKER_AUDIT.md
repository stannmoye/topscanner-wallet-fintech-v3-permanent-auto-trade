# Full application blocker audit — automatic debit / credit

## Critical blockers fixed in this pass

| # | Blocker | Effect | Fix |
|---|---------|--------|-----|
| 1 | `createTrade` required real `marketSnapshotId` + `instrumentId` | Debit refused; UI still showed automatic | Platform entry-reference snapshot created and allocation continues |
| 2 | Settlement used `exit.id` even when exit was null | Runtime crash on configured-rate settle | Reference uses `exitMarketSnapshotId\|\|"cfg"` |
| 3 | Settlement waited forever for market exit | Capital stayed locked | Configured profit rate settlement |
| 4 | Credit posting only treated `recorded_market_snapshot` as automatic | Configured-rate settles never credited | Accept `configured_profit_rate` |
| 5 | Customer opportunities poll never ran auto-trade | Popup without debit | `customerSessionExecution: true` |
| 6 | Blank `executionStatus` treated as ineligible | Newly delivered events skipped | Default blank → `READY` |

## Intentional remaining gates (admin/config — not bugs)

These still block by design when misconfigured:

1. **`automaticTradingEnabled`** on package policy must be true  
2. **`hasConfiguredTradingOfferPolicy`** — rate/duration ranges must be valid integers  
3. **Package fee policy** must exist for the package  
4. **Account status** must be `active`  
5. **`allocationsPaused`** global control must be off  
6. **`requirePreviousSettlement`** / **`blockUntilSettled`** — if on, only one open trade at a time; next debit waits for full credit  
7. **`maxConcurrentActiveTrades`** package limit  
8. **Daily quota** / **daily reward cap**  
9. **Insufficient combined balance** (cross-wallet FX)  
10. Settlement/credit workers must be running (`processAutomaticMarketSettlements` + `processConfirmedTradeCredits` in server heartbeat)

## Lifecycle that must run

```
Popup DELIVERED + READY
  → customer opportunities poll (or worker cycle)
  → autoTradeOpenOpportunities
  → createTrade (debit available → locked)
  → trade status=confirmed, settlementStatus=pending
  → after settlesAt/settlementReviewAt:
       processAutomaticMarketSettlements
       → settlementStatus=confirmed_awaiting_credit
  → after creditAt:
       processConfirmedTradeCredits
       → available += principal + net profit, locked -= principal
```

## Verification checklist after deploy

1. New popup appears for funded customer  
2. Available balance decreases within ~3s (toast −amount)  
3. `trade_positions` row exists, `status=confirmed`  
4. Wallet card shows Locked amount  
5. After duration, settlement job confirms result  
6. Credit job restores available + profit (toast +amount)  

If step 2 fails: check package `automaticTradingEnabled`, fee policy, quotas, and server logs for createTrade errors.  
If step 2 works but 5–6 fail: confirm heartbeat workers are running in `server/_core/index.ts`.
