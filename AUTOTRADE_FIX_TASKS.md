# Auto-Trade / Opportunity-Delivery Fix — Task Ledger

This file is the shared hand-off note for the trade & opportunity-delivery
corrections requested by the owner. **Read this before starting any of these
tasks** so nothing is done twice, even if the exact same prompt is reused.

Rules followed for every task:

- Finish **one task at a time**, run `pnpm test`, `pnpm check`, `pnpm build`.
- Commit that single task and `git push origin main`.
- Then update this ledger with the commit SHA and mark the task done.

## Production context

- Customer portal: `https://stan.prod.page/customer`
- Customer login: `info@wisebond.org` / `Great@129ADMIN2` (userId 2)
- Admin login: `admin@wisebond.org` / `Great@129ADMIN` (userId 1)
- Repo: `stannmoye/topscanner-wallet-fintech-v3-permanent-auto-trade` (branch `main`)

## Task status

Legend: `[x]` done & pushed · `[~]` verified already-correct (no change needed) · `[ ]` pending

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Pop-up must not close before its mapped trade completes | `[x]` | `bec6a0d` |
| 2 | Pop-up timing auto-generated within admin min/max (rotation) | `[~]` | — |
| 3 | Settlement must be immediate at trade completion / pop-up close | `[x]` | `be53741` |
| 4 | Profit % randomly generated within min/max | `[~]` | — |
| 5 | Trade amount randomly generated within min/max | `[~]` | — |
| 6 | Fix other errors found (e.g. UNION-collation 500) | `[x]` | `d0232f7` |
| 7 | Verify all workers flow with no conflicts | `[~]` | — |

---

### Task 1 — Pop-up closing before the trade completes — DONE (`bec6a0d`)

Root cause: in `server/db.ts` `createTrade`, the mapped trade computed its
completion as `settlesAt = allocationTime + effectiveDurationSeconds`. When a
worker allocated the trade a few seconds after the pop-up was delivered, the
trade completed **after** the pop-up's `closesAt` (which is
`opensAt + duration + completionDisplaySeconds`), so the pop-up closed before
its own trade finished.

Fix: the trade's completion instant is now anchored to the delivered pop-up's
immutable `opportunity_offers.rewardAt` instant
(`settlesAt = max(offer.rewardAt, allocationTime)`), with a fallback to
`allocationTime + duration` only for legacy offers that have no `rewardAt`.
The pop-up therefore always closes at or after the trade it delivered settles.

Tests updated to assert the new anchor:
- `server/trading-popup-policy.contract.test.ts`
- `server/trading-customer-popup-rendering.contract.test.ts`

Checks: `pnpm test` (1321 passed / 31 skipped), `pnpm check`, `pnpm build` all green.

---

### Task 2 — Pop-up timing follows admin min/max rotation — VERIFIED OK

Verified against live production data: generated opportunities used **varied**
durations across the configured range (e.g. 127, 756, 847, 1008, 1320, 1401,
1672, 2119, 3514 s), produced by `selectOpportunityGenerationTerms` →
`chooseInclusiveInteger(minTradeDurationSeconds, maxTradeDurationSeconds)` using
`node:crypto.randomInt`. No code change needed. Re-verify after deploy if the
owner still reports a constant duration.

---

### Task 3 — Immediate settlement (remove the forced delay) — DONE (`be53741`)

Root cause found: `server/db.ts` `createTrade` sets
`settlementReviewAt = settlesAt + settlementDelaySeconds` and
`creditAt = settlementReviewAt + creditDelaySeconds`. Production had
`trade.settlementDelaySeconds = 900` and every package policy
`minSettlementDelaySeconds = maxSettlementDelaySeconds = 900`, forcing a fixed
**15-minute** delay. Live evidence: trade 41 `settlesAt` 08:00:25 →
`settlementReviewAt`/`creditAt` 08:15:25.

Fix implemented:
- Default the settlement-review delay to `0` and relax the hard 900 s minimum to
  `0` in: `getTradeSettlementPolicy` repair logic + bounds and
  `setTradeSettlementPolicy` (`server/db.ts`), `server/routers.ts`
  (`updateSettings`, `updatePackagePolicies`),
  `server/modules/advanced-auto-trading.ts`,
  `server/modules/package-opportunity-policy.ts` defaults, `drizzle/schema.ts`
  defaults, and `client/src/trading-settings-client-contracts.ts`.
- Admin UI now allows 0: `client/src/components/AdminOperationsPages.tsx`
  (global settlement-minutes input), `AdminTierPolicyFields.tsx`,
  `TradingDeliveryPolicyEditor.tsx`. The client save guard in `client/src/App.tsx`
  no longer blocks a sub-900 delay.
- Forward-only migration `drizzle/0116_immediate_trade_settlement.sql` zeroes
  existing `app_settings.trade.settlementDelaySeconds` and every
  `opportunity_package_policies.min/maxSettlementDelaySeconds`; registered in
  `drizzle/meta/_journal.json` (idx 85).
- The formulas `settlementReviewAt = settlesAt + settlementDelaySeconds` and
  `creditAt = settlementReviewAt + creditDelaySeconds` are unchanged; with a zero
  delay they coincide with trade completion. Existing trade snapshots keep their
  saved deadlines.

Tests/docs updated: `server/trading-global-timing-policy.contract.test.ts`,
`server/trading-policy-validation.test.ts`,
`server/trading-admin-delivery-policy.contract.test.ts`,
`client/src/trading-delivery-policy-client-contracts.test.ts`,
`client/src/trading-delivery-policy-explanations.contract.test.ts`,
`client/src/trade-settings-ownership.ts`,
`docs/TRADING_SYSTEM_SPECIFICATION.md`,
`docs/TRADING_POPUP_ADMIN_CONFIGURATION_MANUAL.md`.

Checks: `pnpm test` (1321 passed / 31 skipped), `pnpm check`, `pnpm build` all green.

---

### Task 4 — Random profit % within min/max — VERIFIED OK

Live production offers showed varied rates: 202–299 bps across 32 offers.
Produced by `chooseInclusiveInteger(minimumPayoutRateBps, maximumPayoutRateBps)`
in `server/modules/opportunity-generation-template.ts`. No code change needed.

---

### Task 5 — Random trade amount within min/max — VERIFIED OK

Live production data showed varied amounts (e.g. 92480, 92618, 133946, 181228,
186309 minor units), produced by `chooseSecureTradeAmount` →
`node:crypto.randomInt` over the intersection of the offer and package range
(`server/modules/package-trade-allocation.ts`). No code change needed.

---

### Task 6 — Other errors — DONE (`d0232f7`)

Live error fixed: `adminOperations.opportunityDeliveryRecords` returned tRPC
`-32603` `"Illegal mix of collations for operation 'UNION'"`.

Root cause: in `server/opportunityDeliveryDiagnostics.ts` the `record_rows`
CTE does a `UNION ALL` between rows from `opportunity_generation_assignments`
and `opportunity_popup_events`. Both tables are `utf8mb4_unicode_ci`, but
`opportunity_offers` was created in `drizzle/0003_jittery_marvel_boy.sql`
**without an explicit charset/collation**, so its columns (e.g.
`companyDisplayName`, `companyReferenceId`) inherited the database default.
The UNION therefore combined columns with different `utf8mb4` collations,
which MySQL rejects.

Fix: pin `COLLATE utf8mb4_unicode_ci` on the cross-table string expressions in
both UNION branches (`packageName`, `companyReferenceId`, and the
`COALESCE(p.companyDisplayName,o.companyDisplayName)` result), mirroring the
established repair in `drizzle/0102_opportunity_delivery_retry_lifecycle.sql`
line 15. Integer joins and same-table string comparisons in the rest of the
module were audited and need no change. A regression contract test was added to
`server/opportunity-delivery-diagnostics.test.ts`.

Checks: `pnpm test` (1322 passed / 31 skipped, 171 files), `pnpm check`,
`pnpm build` all green.

---

### Task 7 — Worker / conflict verification — VERIFIED OK

All 13 worker keys in `WORKER_HEALTH_REGISTRY` (`server/_core/workerHealth.ts`)
are actually started, so none is orphaned:

- `server/_core/index.ts`: `trading-tier-qualification` (5 s),
  `notification-campaigns` (30 s), `mining-rewards` (30 s),
  `mining-price-feeds` (5 min), `popup-retention` (60 min + once at startup),
  `settlement-reconciliation`, `automatic-market-settlement`,
  `settlement-credit-posting`, `trading-opportunities` (all inside the 30 s
  trade cycle), and `market-data-refresh`.
- `server/_core/heartbeat.ts`: `local-scheduled-jobs`.
- `server/emailQueue.ts`: `email-outbox`, `daily-digests`.

No conflict exists between cycles:

- `runMonitoredWorkerCycle` (workerHealth.ts:35,135–136) keeps an
  `inFlightCycles` map keyed by worker key and returns the running promise
  instead of starting a second copy, so overlapping timer ticks of the same
  worker (and the two `ensureMarketDrivenOpportunities` call sites) are
  centrally de-duplicated.
- The trade cycle runs in the correct order for this fix set:
  `reconcileAllDueTradesAwaitingConfirmation` →
  `processAutomaticMarketSettlements` → `processConfirmedTradeCredits` →
  `runAutoTradeCycle` + delivery, so existing trades settle/credit before new
  opportunities are generated.
- Settlement and credit transitions are row-locked and conditional
  (`assertExactlyOneAffectedRow`), so two workers can never double-settle or
  double-credit one trade.
- `ensureMarketDrivenOpportunities` (`server/marketSync.ts`) is read-only and
  idempotent (it only closes already-expired open offers), so calling it from
  both the trade cycle and the market refresh cannot conflict.
- No hidden settlement delay remains: `trade.creditDelaySeconds` already
  defaults to `0` (db.ts:450/514), so with Task 3's delay the deadlines are
  `settlementReviewAt = creditAt = settlesAt`.
- Randomizers re-confirmed wired to admin bounds via `node:crypto.randomInt`:
  duration/payout in `selectOpportunityGenerationTerms`
  (opportunity-generation-template.ts:169–170, called at db.ts:3514) and trade
  amount in `chooseSecureTradeAmount` (db.ts:4027).

No code change required. `pnpm test` (1322 passed / 31 skipped) includes the
worker-health and trade-credit-posting contract tests.
