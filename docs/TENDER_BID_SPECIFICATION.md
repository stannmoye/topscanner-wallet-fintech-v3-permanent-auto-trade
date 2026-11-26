# Tender Bid — Build Specification

Status: **Draft for owner approval (Stage 0)**
Owner decisions locked: official open APIs + portal scraping; 23 countries (list below); bid/qualification
amount = an administrator-configured **percentage of the contract value**, clamped to **$1,000–$600,000**,
overridable per tender; the administrative charge is the same configured amount.

This document is the build plan. Each stage below is delivered and pushed to `main` independently.
It is a plan and a requirements record, not a claim that any source is live. All amounts, percentages,
ranges, wallet order, and enable flags are administrator-configured, persisted, validated, and audited —
nothing is hard-coded. Every figure shown to a customer traces to a durable source record and an FX
snapshot; when a source or rate is missing or invalid the feature fails closed.

---

## 1. Purpose

Give customers a real, verifiable **Tender Bid** desk. The platform ingests public and private-sector
tenders from national government procurement portals and commercial tender sources across 23 countries,
normalises them into one schema, and displays each tender with the information needed to decide whether
to bid. A customer can place a bid; the administrator is notified, reviews it, and may deduct the
administrative charge from the customer's wallet. If the customer's balance does not cover the
qualification amount, the customer is prompted to deposit.

The desk replaces the placeholder customer section currently keyed `tender-bid` (renamed from
`token-launch`).

### 1.1 Non-goals

- Not a bid-submission bridge to the issuing authority. Bidding here is an internal platform workflow
  (record the customer's intent, notify the administrator, apply the configured charge). We do not
  submit anything to the source portal.
- Not a guarantee of award. A "win" is recorded only when the administrator records an award outcome.
- No synthetic or demo tenders. Every displayed tender must carry a real source record and a source URL.

---

## 2. Owner decisions (locked)

| Decision | Value |
| --- | --- |
| Source strategy | Official open APIs/OCDS where they exist; scrape national portals that have none |
| Country coverage | The 23 countries in §4 |
| Contract value inclusion range | $100,000 – $250,000,000 (USD equivalent) |
| Qualification / bid amount | Administrator-configured **percent of contract value**, clamped to **$1,000 – $600,000** |
| Administrative charge | The same configured amount as the qualification amount |
| Charge application | **Manual** by the administrator (no automatic debit on bid) |
| Insufficient balance | Prompt the customer to deposit before the bid can proceed |
| Plan record | This document, committed as Stage 0 |

---

## 3. Data sources

Two classes of source:

- **Government** — national/official procurement portals. Some publish a documented API/OCDS feed;
  the rest are HTML/PDF portals that must be scraped.
- **Private** — commercial tender aggregators and development-bank portals (World Bank, UNGM, AfDB,
  ADB) that already consolidate many countries and expose APIs or structured feeds.

Adapters live behind one interface (§6), so a source can be an API, an open-data file, or a scraper
without changing the rest of the system. Scrapers are treated as inherently fragile: they carry a
health/last-success status and degrade gracefully (a dead scraper never zeroes or fabricates tender
data; it simply stops refreshing and is flagged).

### 3.1 Source attribution and legal

- Every tender stores its `sourceUrl` and source name, shown to the customer.
- Each adapter respects the source's robots/ToS and documented rate limits, and identifies the platform
  in its user agent.
- API keys (SAM.gov, any commercial aggregator) are secrets, read from environment/secret storage,
  never committed.

---

## 4. Country coverage (23)

| # | Country | Primary source | Access method |
| --- | --- | --- | --- |
| 1 | United States | SAM.gov Get Opportunities | Official API (key) |
| 2 | United Kingdom | Find a Tender (+ Contracts Finder) | Official OCDS API |
| 3 | Canada | CanadaBuys | Official open-data file |
| 4 | Germany | oeffentlichevergabe.de | Official API |
| 5 | France | BOAMP / PLACE | Open data |
| 6 | Netherlands | TenderNed | Open data / OCDS |
| 7 | Belgium | e-Notification | OCDS |
| 8 | Spain | Plataforma de Contratación del Sector Público | Open data |
| 9 | Italy | ANAC / contratti pubblici | Open data |
| 10 | Poland | e-Zamówienia | Open data |
| 11 | Denmark | udbud.dk | Official |
| 12 | Finland | HILMA | Official |
| 13 | Ireland | eTenders | Open data |
| 14 | Norway | Doffin | Open data |
| 15 | Switzerland | simap.ch | Portal feed |
| 16 | Australia | AusTender | Official open data |
| 17 | India | CPPP / eProcure | Scrape |
| 18 | Nigeria | NOCOPO / BPP | Scrape |
| 19 | Kenya | PPIP / e-GP | Scrape (structured) |
| 20 | South Africa | eTenders (National Treasury) | Scrape (structured) |
| 21 | Ghana | GHANEPS | Scrape |
| 22 | United Arab Emirates | Etimad / aggregator | Scrape / aggregator API |
| 23 | Saudi Arabia | Etimad / aggregator | Scrape / aggregator API |

Supranational feeds (**EU TED, World Bank, UNGM, AfDB, ADB**) are used as additional sources: they
cover many of these countries and provide a resilient fallback for above-threshold and development
contracts. The exact adapter build order is set in §11 (Stage 2 and Stage 6).

---

## 5. Domain model (new tables)

Drizzle tables + a guarded migration (idempotent, journaled). All money is integer minor units.

**`tender_sources`**
- `id`, `key` (unique, e.g. `sam_gov`), `label`, `countryCode`, `kind` enum(`government`,`private`),
  `adapter`, `configJson`, `enabled`, `expectedIntervalMs`, `lastSyncAt`, `lastStatus`, `lastError`,
  `createdAt`, `updatedAt`.

**`tenders`**
- `id`, `sourceId` → `tender_sources.id`, `externalId`, `countryCode`
- `title`, `buyer` (authority), `buyerType`, `industry`, `tenderType`, `procedure`
- `contractAmountMinor`, `contractCurrency`, `contractAmountUsdMinor`, `fxSnapshotId`
- `qualificationPctBps`, `qualificationAmountUsdMinor`, `qualificationOverridden`
- `bidOpenAt`, `bidCloseAt` (expiry), `payoutAt` (expected payment), `publishedAt`
- `summary`, `descriptionText`, `documentsJson`, `sourceUrl`, `status` enum(`upcoming`,`open`,`closing`,`closed`,`awarded`)
- `lastSyncedAt`, `rawJson`, `createdAt`, `updatedAt`
- unique(`sourceId`,`externalId`)

**`tender_field_history`** (admin corrections audit)
- `id`, `tenderId`, `adminUserId`, `field`, `oldValue`, `newValue`, `note`, `createdAt`.

**`tender_bids`**
- `id`, `tenderId`, `userId`, `status` enum(`placed`,`charge_pending`,`charged`,`won`,`lost`,`cancelled`),
  `qualificationAmountUsdMinor` (snapshot), `chargeAmountUsdMinor`, `chargeLedgerId`, `idempotencyKey`
  (unique), `createdAt`, `updatedAt`, unique(`userId`,`tenderId`).

**`tender_bid_events`** (audit trail)
- `id`, `bidId`, `type`, `payloadJson`, `createdAt`.

Reused existing infrastructure:
- **Notifications** — `createNotification(...)` (per admin, as in `notifyAdminsOfPayoutRequest`) and the
  customer `customerNotifications` surface. New categories `tender` (customer) reused from the existing
  event taxonomy where possible.
- **Ledger** — the administrative charge is posted through the existing **classified manual adjustment**
  path (`balance_ledger`, `admin_manual_deposit_credit` / debit with classification + reversal), never a
  bespoke un-audited write.
- **Email** — `v5_email_jobs` for durable notification email.

---

## 6. Provider interface & ingestion

```ts
export interface TenderProvider {
  key: string;                       // "sam_gov"
  countryCode: string;               // "US"
  kind: "government" | "private";
  fetch(params: { since?: Date; cursor?: string }): Promise<RawTenderPage>;
}

export type NormalizedTender = {
  externalId: string;
  countryCode: string;
  title: string;
  buyer: string | null;
  industry: string | null;
  tenderType: string | null;
  procedure: string | null;
  contractAmountMinor: number | null;
  contractCurrency: string | null;
  bidOpenAt: string | null;
  bidCloseAt: string | null;
  payoutAt: string | null;
  publishedAt: string | null;
  summary: string | null;
  descriptionText: string | null;
  documents: { label: string; url: string }[];
  sourceUrl: string;
  raw: unknown;
};
```

**Ingestion worker** (`tender-ingest`), registered in `WORKER_HEALTH_REGISTRY` like `daily-reports`:
1. For each enabled source on its interval, call the adapter (paginated, rate-limited, retrying).
2. Normalise (CPV/NAICS/category → canonical industry; currency kept with its code).
3. Convert contract value to USD using a **fresh FX snapshot**; if the rate is missing/stale, keep the
   tender but mark the USD value unavailable (never guess) and exclude it from range filtering.
4. Upsert by `(sourceId, externalId)`; never overwrite an administrator override.
5. Refresh `status` from the dates; set `sourceUrl`/`rawJson`; record `lastSyncAt`/health.

**Deduplication** — same external id from the same source updates in place; the same tender seen via
two sources (e.g. a UK notice also on TED) is kept as two source records but grouped by a
`dedupeGroup` hash for the customer view so it is shown once with all source links.

---

## 7. Fee model

- Each tender in range ($100k–$250M USD) gets a **qualification amount** =
  `contractValueUsd × admin_configured_pct`, **clamped to $1,000–$600,000**.
- The percentage is an administrator setting (e.g. per-package or global), stored with the tender once
  computed (`qualificationPctBps`) and overridable per tender.
- The **administrative charge** equals the qualification amount. It is deducted **manually** by the
  administrator; the ledger entry is classified and audited, and reversible with a compensating entry.
- A customer qualifies to bid when their **available balance (all wallets, USD equivalent, fresh FX)**
  is at least the qualification amount. If not, the bid screen prompts a deposit.

---

## 8. Customer experience

On the **Tender Bid** desk (`tender-bid`):
- A filterable list (country, industry, tender type, status, closing soon, contract-value band) with
  cards showing: contract amount (USD), qualification amount, bidding opens, bidding expires, expected
  payout date, status, source badge (government/private).
- A per-tender detail view/pop-up for the full record: description (long text scrolls in the pop-up),
  buyer, industry, procedure, all dates, documents/source links, attribution, and the bid panel.
- The **bid panel** shows the qualification amount, the customer's eligible balance, and either a
  **Bid** button (when qualified) or a **deposit prompt** (when short), linking to the existing funding
  flow.
- After a bid: a status chip (`Placed → Charge pending → Charged → Won/Lost`), driven by
  `tender_bids.status`, plus notifications.
- Every figure is labelled as a **configured/contractual** value; nothing implies an external-market
  execution or a guaranteed award.

---

## 9. Bidding flow & notifications

1. Customer clicks **Bid** on a tender with status `open` and a valid qualification amount.
2. Server (fail-closed, idempotent on `idempotencyKey`):
   - re-checks the tender is open and the amount is current;
   - computes the customer's eligible balance (all wallets, USD equivalent, fresh FX);
   - if insufficient → returns `insufficient_balance` with the amount required (client shows deposit
     prompt); no bid is recorded;
   - if sufficient → inserts `tender_bids` (`placed`), writes a `tender_bid_events` row.
3. **Admin notification** — `notifyAdminsOfTenderBid(...)` mirrors `notifyAdminsOfPayoutRequest`:
   `createNotification` to every administrator + a durable ticket/email, with the customer, tender,
   and qualification amount. `href` → the new admin Tender Bids queue.
4. Administrator reviews the bid in the **Tender Bids** admin queue and either:
   - **Applies the charge** — posts a classified manual debit of the configured amount from the
     customer's wallet (existing ledger path), sets bid `charged`, records `chargeLedgerId`; or
   - **Declines** — sets bid `cancelled` with a reason (no ledger movement).
5. A bid that is charged but whose tender closes without award is marked `lost`; an administrator can
   record `won`. Any reversal is a compensating ledger entry; historical entries are never edited.

---

## 10. Admin experience

- **Tender Bids queue** — every bid with customer, tender, qualification amount, balance at bid time,
  status, and the **Apply charge** / **Decline** / **Record outcome** actions (all audited).
- **Tender corrections menu** — a dedicated administrator menu to edit any tender field (title, buyer,
  industry, type, amounts, dates, description, status, links) and submit. Each change writes a
  `tender_field_history` row (old → new, admin, note) and takes effect on the customer side
  immediately; administrator overrides survive re-ingestion. Source-derived fields can be reverted to
  the source value.
- **Sources health** — enable/disable each source, see `lastSyncAt`/`lastStatus`/`lastError`, and a
  per-source tender count.

---

## 11. Staged delivery

| Stage | Scope | Done when |
| --- | --- | --- |
| **0** | This specification committed to `main`. | Doc merged. |
| **1** | Schema + guarded migration + `TenderProvider` interface + normalised model + source registry + admin seed of the 23 countries/sources. Contract tests. | Migration is idempotent; registry lists the 23 countries; tests pass; `pnpm check`/`build` green. |
| **2** | Adapters for the first cohort (US SAM.gov, UK Find a Tender, CanadaBuys, Germany, EU TED, World Bank) + ingestion worker + dedupe/upsert + FX + health. | Worker ingests real tenders; dedupe proven; health recorded; nothing fabricated. |
| **3** | Customer **Tender Bid** desk: list, filters, detail pop-up, timing/status, attribution, replacing the placeholder. | Desk renders only real ingested tenders; long descriptions open in the pop-up. |
| **4** | Bidding: bid button, qualification/balance check, deposit prompt, admin notification, admin charge/decline workflow with classified audited ledger entries. | A bid notifies admins; charge posts a classified ledger entry; insufficient balance prompts deposit and records no bid. |
| **5** | Admin corrections menu (any field, audit history, revert to source) + bid queue + source health. | Edits persist with history and reflect on the customer side; overrides survive re-ingestion. |
| **6** | Remaining country adapters up to 23 + hardening: retries/backoff, rate limits, retention, timezones/i18n, load, monitoring, tests. | All 23 countries represented; `pnpm check`/`test`/`build` green. |

Every stage: `pnpm run check`, targeted contract tests, full `pnpm test`, `pnpm build`, then update
`progress.md` and push to `main`.

---

## 12. Guardrails (must hold at every stage)

- **Real data only.** No synthetic or seeded tenders in any environment that customers can see.
- **Fail closed.** Missing/stale/invalid FX or configuration ⇒ no USD figure, no qualification, no bid.
- **Admin-configured + audited.** Percentages, ranges, enable flags, and overrides come from the admin
  portal, are persisted with the tender, and are audited. Nothing hard-coded.
- **Idempotent bids.** Retries/concurrent clicks cannot create duplicate bids or charges.
- **Ledger discipline.** Charges/reversals are classified internal-ledger entries; history is immutable.
- **Attribution.** Every tender shows its source; scrapers respect robots/ToS and rate limits.
- **Labelling.** Qualification/charge amounts are configured/contractual values, not market execution.

---

## 13. Open items

- The exact per-country source for UAE/Saudi Arabia (native Etimad scrape vs. an aggregator API) is
  confirmed in Stage 2/6.
- Whether India/Nigeria/Kenya/South Africa/Ghana scraping is run in-process or via an isolated
  scraper service is decided in Stage 2 once the first scraper is built.
- Administrator-charge ledger classification string to be finalised with the existing manual-adjustment
  taxonomy in Stage 4.
