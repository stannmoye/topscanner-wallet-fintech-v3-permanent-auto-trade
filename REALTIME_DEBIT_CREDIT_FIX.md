# Real-time wallet debit / credit fix

## Problem
Popup showed "locking $1000" but available balance did not decrease because automatic
allocation only ran on the background worker cycle, not when the customer viewed the popup.

## Fix
1. Customer `opportunities` poll now passes `customerSessionExecution: true`.
2. `listCustomerOpportunities` runs `autoTradeOpenOpportunities` on customer session
   (idempotent with the worker — cannot double-debit).
3. `createTrade` still moves `availableMinor → lockedMinor` and writes `trade_reservation`.
4. Client balance ribbon refreshes every 2s and shows fade-away −/+ deltas on each wallet.
5. Fade-away toasts fire on auto-trade debit and settlement credit.
6. Wallet cards show **Locked** amount when capital is in an active trade.

## Requirements for debit to occur
- Customer has sufficient **combined** spendable balance (any wallets via FX plan)
- Package policy has `automaticTradingEnabled: true`
- Global allocations are not paused
- Account status is active

## Visible behaviour
- Available balance decreases immediately (e.g. USD $3,600 → $2,600)
- Toast: `−1,000.00 USD deducted · capital locked into trade …` (fades ~5s)
- Wallet card shows Locked amount
- On settlement: available increases by principal + profit with credit toast
