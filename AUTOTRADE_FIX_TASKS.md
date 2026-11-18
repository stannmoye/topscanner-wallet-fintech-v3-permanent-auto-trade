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
| 6 | Fix other errors found (e.g. UNION-collation 500) | `[ ]` | — |
| 7 | Verify all workers flow with no conflicts | `[ ]` | — |

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

### Task 6 — Other errors — PENDING

Known live error: `adminOperations.opportunityDeliveryRecords` returns tRPC
`-32603` `"Illegal mix of collations for operation 'UNION'"`. Fix pending.

---

### Task 7 — Worker / conflict verification — PENDING

Confirm every registered worker cycle runs with no conflicts after Tasks 3 and 6.
