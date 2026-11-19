# Automatic financial execution — enforced behaviour

> **Status: historical migration note, corrected for the current code.**
> Migration `drizzle/0112_permanent_automatic_financial_execution.sql` was written on the
> assumption that automatic debit/credit should "never fail closed". The code has since
> been hardened (64-item audit remediation) so that **allocation gates fail closed** while
> automatic financial execution stays available for genuinely eligible customers. This file
> now describes the behaviour that the running server actually enforces. Where this file and
> the code disagree, **the code is authoritative**; `docs/TRADING_SYSTEM_SPECIFICATION.md`
> is the canonical requirements source.

## Deploy (historical)

Migration `0112` is already applied on production. It seeded default data (resumed
allocation flag, a default fee policy per package, ON global masters, OFF
previous-settlement) so the platform would not start from an empty policy. It does **not**
disable any runtime gate — the runtime reads and enforces the saved values listed below.

## What the running server enforces today

### Automatic financial execution
- A single audited administrator switch, `automaticFinancialExecutionEnabled`, persisted in
  `app_settings` with the other global Trade controls, an audit trail and a policy version.
- **Defaults ON** (matches the historical behaviour) and is editable at any time from the
  admin **Trade Settings → Global Trade Controls** screen. The last saved value reloads after
  refresh, logout/login and server restart.
- **Fails closed**: if the global control policy cannot be read or is malformed, automatic
  execution is treated as OFF and no wallet is touched.
- `createTrade` (`server/db.ts`) rejects an automatic allocation with
  "Automatic trade allocation is disabled by the administrator" **before** any wallet work
  when the switch is OFF.

### Allocation gates — fail closed, never silently bypassed
An allocation now requires an **active automatically-assigned tier** (`auto-tier:` activation
key). `automaticTradingEnabled` on the tier no longer filters eligibility, but the tier must
have a **complete saved offer policy**; a tier without one is not eligible. There is **no
fallback to every subscription**. Each blocked case is persisted as a clear, auditable
opportunity reason:

| Gate | Enforced value | Blocked state |
|------|----------------|---------------|
| Eligible tier present | complete saved offer policy on an active `auto-tier` subscription | `NO_ELIGIBLE_TIER` |
| Daily opportunity entitlement | per-subscription daily quota (snapshot else package quota) | `DAILY_OPPORTUNITY_QUOTA_EXHAUSTED` |
| Tier active investments | `maxActiveInvestments` when `> 0` (0 = no tier-specific cap) | `TIER_ACTIVE_INVESTMENT_LIMIT_REACHED` |
| Concurrent active trades | `maxConcurrentActiveTrades` (>= 1) | `CONCURRENT_ACTIVE_TRADE_LIMIT_REACHED` |
| Daily successful trades | `maxSuccessfulTradesPerDay` when `> 0` (0 = no extra cap). This is the **single opportunity-generation cap**: once a package's customer-wide UTC-day settled-trade ceiling is reached, the package is dropped from popup generation and delivery, so **no further opportunity is created or shown** for it (and every other gate below still applies). | `DAILY_SUCCESSFUL_TRADE_LIMIT_REACHED` (no popup/opportunity is created; the allocation gate keeps the same code as a safety net) |
| Daily reward ceiling | per-tier `maxDailyRewardMinor` counted from realized net profit (when `> 0`) | blocked review/reservation |
| Previous settlement | global `requirePreviousSettlement` (default ON) | blocked while an earlier trade is unsettled |
| Package fee policy | a saved fee policy must exist for the selected package | blocked until an admin configures one |
| Live FX rate | a current rate for every currency used in a conversion | `FX_RATE_UNAVAILABLE` ("Rate unavailable, try again") |

- **`trading.allocations.paused` is honoured.** A pause blocks **new** allocations only; it
  never blocks settlement, confirmed credit/debit posting or reconciliation of existing
  trades. A malformed pause record fails closed.
- **Missing fee policy is not defaulted at runtime.** `0112` seeded a 1500 bps policy for
  packages that had none at the time, so those packages already have a saved policy; any
  package without one is blocked until an administrator saves a policy. The platform fee
  itself is unchanged (the owner kept it).

### Live exchange rates (no stored rate drives a calculation)
- Every conversion fetches a **live** rate (Frankfurter → open.er-api for fiat, CoinGecko
  for crypto); `currencyRegistry.usdRate` is stored as an audit snapshot only and is never
  the input to a calculation.
- Concurrent callers share one in-flight fetch; a result may be reused for at most 5 seconds.
- Inverse rates use exact decimal math at 12 decimals, never `1/x` floats.
- A missing/stale live rate → no conversion, no debit; the customer sees "Rate unavailable,
  try again." Fiat freshness follows the ECB publication schedule (weekends/holidays); crypto
  stays strict (minutes).

### Wallet funding order
- Source wallets are funded in the **administrator-configured priority list** (default: USD
  first, then the other currencies alphabetically). A malformed saved order fails closed
  (no debit). Wallet row locking stays in a separate fixed currency order to avoid deadlocks.

### Settlement — no losses, credit exactly as configured
- For automatic pop-up trades, settlement credits **principal + the configured return that
  was fixed at allocation**. It uses only data stored at allocation and never a market price
  or external API, so a network outage cannot change the result (this replaces the old
  market-snapshot result path).
- A startup catch-up and a periodic sweep credit every due, uncredited trade **exactly once**,
  surviving reboots, network loss and duplicate workers, using the existing row locks and
  idempotency guards. On-time and late credit are identical; due time still follows the admin
  timing settings.
- Admin manual settlement is unchanged.

### Preservation of the protected area
Row locks, ledger entries, idempotency keys and reconciliation are unchanged. Every wallet
movement (hold, release, debit, FX conversion, credit, fee) remains a durable internal ledger
entry linked to the opportunity, the trade and the source FX snapshot, and balances must
always reconcile to the ledger.

## Features that remain (unchanged by this correction)
- Insufficient balance shows deposit guidance instead of silently missing the trade.
- Green `+ credit` / red `− debit` transition toasts with optional tones.
- Stuck settlements remain available for administrator manual credit and do not freeze the
  next trade when `requirePreviousSettlement` is OFF.
