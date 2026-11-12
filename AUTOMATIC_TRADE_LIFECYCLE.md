# Automatic Trade Lifecycle (Debit → Trade → Credit)

## Product behaviour

Once a popup opportunity arrives and the customer has **sufficient combined spendable balance across all wallets**:

1. **No customer action is required** — no click, no confirm button.
2. The server automatically **debits / locks** the required capital from available balance into the trade.
3. The live UI shows **Capital locked into trade from available balance** with principal amount, expected profit, and a progress bar.
4. When the trade reaches settlement, the server automatically **credits principal + net profit** back to the same wallet currency.
5. The UI and notifications show **Principal and profit credited to wallet** with the breakdown.

If balance is insufficient, the popup states that clearly and no capital is moved.

## Mathematics module

`server/modules/automatic-trade-lifecycle-math.ts`

- `calculateAutomaticTradeDebit` — capital to lock + expected profit/credit totals
- `calculateAutomaticTradeCredit` — principal + profit (prefers realized net when available)
- `calculateAutomaticTradeCycle` — full cycle helper
- `automaticTradeStageLabel` — human labels for lifecycle stages

Stages: `evaluating_balance` → `capital_locking` → `capital_locked` → `trade_live` → `settlement_processing` → `principal_and_profit_credited` → `completed`

## Integration points

- **`createTrade` (server/db.ts)**  
  On every successful automatic allocation, computes debit side and returns  
  `debitTransitionText`, `expectedProfitMinor`, `expectedCreditMinor`, `lifecycleStage`.

- **Settlement credit posting (server/db.ts)**  
  Computes credit side and returns  
  `creditTransitionText`, `totalCreditedMinor`, `lifecycleStage`.

- **Notifications**  
  Allocation notices: capital locked language.  
  Settlement notices: principal and profit credited language.

- **Client `CustomerTradeProgress`**  
  Live: LOCKED / LIVE with capital locked text, principal, expected profit, progress, “fully automatic · no action required”.  
  Complete: CREDITED with full P&L breakdown.

- **Client opportunity popup**  
  Qualifying: shows “Fully automatic. Capital is locked… no action required.”  
  Execute button replaced with disabled “Capital locking automatically”.  
  Insufficient: clear shortfall message, no capital moved.

## Existing platform guarantees preserved

- Multi-wallet + FX funding plan (`planCrossWalletFunding`)
- Integer minor-unit ledger
- Idempotent allocation and settlement
- Daily reward caps, package policies, quiet hours, delivery quotas
- Auditable lifecycle events and settlement evidence path

