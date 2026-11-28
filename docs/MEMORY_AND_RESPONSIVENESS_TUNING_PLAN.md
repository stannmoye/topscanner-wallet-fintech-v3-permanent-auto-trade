# Memory & Responsiveness Tuning Plan (Staged)

Status: **in progress** · Branch: `main` · Owner: platform

This document is the resumable handoff for the memory-and-responsiveness tuning
programme. Each stage is committed and pushed to `main` separately, so work can
continue from the last completed stage even if the session is interrupted.

Read this file together with `AGENTS.md`, `progress.md`, `BUILD_SOURCE.json` and
`docs/REPOSITORY_GUIDE.md`. Behaviour contracts in
`docs/TRADING_SYSTEM_SPECIFICATION.md` are unchanged by this programme: every
change below is a non-functional performance/resource change (connection
reuse, cache bounds, poll cadence, allocation avoidance). No money logic, no
ledger behaviour, no timing semantics are altered.

## Why

The application intermittently exhausts process heap and container RAM and is
occasionally unresponsive under load, even though `scripts/memory-limit.mjs`
already sizes the V8 heap to the detected cgroup limit and the supervisor
already records OOM evidence. The remaining causes are operational hot paths
that allocate/tear down resources per call and client polls that keep running
while a tab is hidden. These are addressed below without changing any product
behaviour.

## Findings (evidence)

1. **Per-call MySQL pool churn — highest impact.**
   ~26 modules define a `withConnection()` helper that calls
   `mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 })`,
   runs one statement, then `await pool.end()` — on *every* call.
   Files include `server/lending.ts`, `server/lendingDossiers.ts`,
   `server/agroInvestments.ts`, `server/agroInvestmentDossiers.ts`,
   `server/litigationFunds.ts`, `server/litigationFundDossiers.ts`,
   `server/greenEnergy.ts`, `server/greenEnergyDossiers.ts`,
   `server/carbonCredits.ts`, `server/carbonCreditDossiers.ts`,
   `server/musicRoyalties.ts`, `server/musicRoyaltyDossiers.ts`,
   `server/ipRoyalties.ts`, `server/ipRoyaltiesDossiers.ts`,
   `server/treasuryBonds.ts`, `server/treasuryBondInstruments.ts`,
   `server/cooperateDept.ts`, `server/cooperateDeptCompanies.ts`,
   `server/deskEconomics.ts`, `server/mining-store.ts`, `server/stakeEarn.ts`,
   `server/transactionConsole.ts`, `server/opportunityLifecycle.ts`,
   `server/opportunityDeliveryDiagnostics.ts`, plus the mining/desk workers.
   Each call opens a fresh TCP connection (+ TLS when configured), allocates a
   new pool/connection object graph and MySQL packet buffers, then discards it.
   Under the customer/admin poll cadences and the 30-second trading worker this
   is continuous allocation → GC pressure, latency, and memory churn.

2. **Client query cache has no defaults.** `client/src/main.tsx` constructs
   `new QueryClient()` with no `defaultOptions`, so TanStack Query uses
   `staleTime: 0`, `refetchOnWindowFocus: true`, `retry: 3` and a 5-minute
   `gcTime`. With ~40 menu components, navigating re-fetches everything and the
   cache retains every payload for five minutes.

3. **Polling is not consistently visibility-aware.** Several menus pass a raw
   numeric `refetchInterval` (e.g. `AdminMining.tsx`, `AdminTicketDeskView.tsx`,
   `AdminDeviceOversight.tsx`, the carbon/green/music/IP/agro/litigation/lending
   admin desks, several `AdminOperationsPages.tsx` queries, `AdminDeskEconomics.tsx`,
   `CustomerMining.tsx`, `CustomerExchangeScanner.tsx`,
   `CustomerAuthenticatorSettings.tsx`, `CustomerTradingEligibility.tsx`,
   `AdminOpportunityTemplates.tsx`). Hidden tabs therefore keep polling,
   driving unnecessary server work and memory churn. The shared policy already
   exists in `client/src/visibility-aware-polling.ts`.

4. **Company catalogue hot-path allocations.**
   `server/modules/company-catalogue-reference.ts`:
   `getCompanyReferenceSummary()` walks all 1,811 records ~9 times per call
   (eight `.filter()` passes plus a `reduce` that allocates a Map), and
   `countCompanyReferences()` allocates 1,811 response objects just to take
   `.length`. `searchCompanyReferences` and `findCompanyReferencesBySymbol`
   scan the full array and spread each record.

5. **Resident caches are bounded but never shed under pressure.** The memory
   watchdog in `server/_core/index.ts` records an incident at ≥90% heap/RAM but
   does not release recoverable memory. `tradingFxRateCache` (bounded to 256) and
   similar maps can be dropped safely when the process is under pressure.

## Stages

- [x] **Stage 0 — Investigation & plan (this document).** Commit + push. Anchor
      so the programme is resumable.
- [x] **Stage 1 — Client responsiveness & cache bounds.**
      `client/src/main.tsx`: gave the `QueryClient` explicit `defaultOptions`
      (`staleTime: 5_000`, `gcTime: 2 * 60_000`, `refetchOnWindowFocus: false`)
      so navigating between the ~40 menus no longer re-fetches everything and
      the cache no longer retains every payload for five minutes. Routed every
      remaining raw numeric `refetchInterval` (124 sites across 29 components)
      through `visibilityAwareRefetchInterval` so hidden tabs stop polling and
      failures back off exponentially. The `visibilitychange`
      refetch-on-visible wiring is intact (covered by
      `client/src/visibility-aware-polling.test.ts`).
- [x] **Stage 2 — Shared MySQL pool.**
      Added a lazy, bounded **shared** pool in `server/_core/mysql.ts`
      (`getSharedMysqlPool()` / `closeSharedMysqlPool()`, default limit 8,
      overridable via `DB_SHARED_POOL_CONNECTION_LIMIT`). Switched all 24
      `withConnection()` / `withMiningConnection()` helpers to reuse it and
      release the connection only (no per-call `createPool`/`pool.end`). Wired
      `closeSharedMysqlPool()` into graceful shutdown after the main pool.
      Updated `server/opportunity-lifecycle-summary.contract.test.ts` to assert
      one shared pool, no per-read `end`, and one release.
- [ ] **Stage 3 — Catalogue & hot-path allocation.**
      Single-pass, memoised `getCompanyReferenceSummary()`; allocation-free
      counting; avoid per-record spreads on count paths.
- [ ] **Stage 4 — Memory-pressure shedding & worker jitter.**
      On the existing watchdog trip, release recoverable caches and (when
      exposed) request a GC; add small jitter to periodic worker intervals to
      avoid synchronised bursts.
- [ ] **Stage 5 — Validation & report.**
      `pnpm check`, `pnpm test`, production `pnpm build`, and a final tuning
      report committed to this file.

## Acceptance

- `pnpm check` (tsc) passes.
- `pnpm test` (vitest) passes — no reduced coverage of existing contracts.
- `pnpm build` succeeds.
- No change to financial/ledger behaviour, timings, or product semantics.

## Progress log

- **Stage 0** — investigation documented; plan committed (`9eb7188`).
- **Stage 1** — `QueryClient` defaults bounded; 124 raw `refetchInterval`
  sites in 29 client components routed through `visibilityAwareRefetchInterval`.
  `pnpm check` green; `visibility-aware-polling.test.ts` and
  `refresh-balance-invalidation.test.ts` green (14 tests).
- **Stage 2** — shared bounded MySQL pool added; all 24 per-call pool
  implementations converted to reuse it; graceful shutdown closes it.
  `pnpm check` green; full `pnpm test` green (1993 passed, 42 skipped, 0
  failed).
