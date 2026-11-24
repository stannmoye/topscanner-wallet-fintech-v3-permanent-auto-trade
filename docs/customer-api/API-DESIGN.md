# Arbitrade Customer API v1 — Design

Status: proposal · Base path: `/api/v1` · Auth: scoped API keys (Bearer) · Transport: HTTPS + JSON
Scope of this document: phase 1 (read) + signed webhooks, with phase 2 (guarded write) listed for planning.

Grounded in the existing application:
- Customer procedures: [`server/routers.ts` → `customer.*`](file:///workspace/repo/server/routers.ts#L835-L1318)
- Wallet/ledger/payout shapes: [`server/db.ts`](file:///workspace/repo/server/db.ts#L1506-L1523), [payout history](file:///workspace/repo/server/db.ts#L1932-L1945)
- Existing contract rules to preserve: [API_CONTRACTS.md](file:///workspace/repo/docs/development/arbitrade-integration/API_CONTRACTS.md)
- Planned customer UI: [`CustomerApiAccessPanel.css`](file:///workspace/repo/client/src/components/CustomerApiAccessPanel.css)

## 1. Why REST + webhooks

| Option | Verdict |
|---|---|
| **REST `/v1` + OpenAPI + webhooks** | **Chosen.** Works from any language, generates SDKs/docs, maps 1:1 to the resource-shaped programs, and fronts the existing server-authoritative core without new business logic. |
| GraphQL | Rejected for v1. Schema/operations overhead for a small, well-defined resource set; harder to rate-limit and audit per field. |
| Exposing tRPC | Rejected. TypeScript-only and cookie-session bound — unusable from a customer's server or a non-JS stack. |
| gRPC | Rejected. Browser/SDK friction far outweighs the benefit for external customers. |

The API is a **stateless translation layer** over the existing `customer.*` service functions. It adds: API-key auth, scope authorization, rate limiting, idempotency, pagination, and webhook emission. It must not introduce new money logic.

## 2. Authentication and environments

- Header: `Authorization: Bearer ak_live_<keyId>_<secret>` (also accepted: `X-API-Key`).
- Key id is public and indexable; the **secret is shown once** at creation and stored only as a hash.
- Two environments: `live` (`ak_live_`) and `test` (`ak_test_`). Test keys hit a sandbox dataset and never touch real balances.
- Scopes are granted per key (least privilege). Only `GET`/read scopes are issuable in phase 1.
- Optional per-key **IP allowlist**; optional per-key **rate limit** override.
- Keys are never tied to a browser session and never grant admin procedures.

Key format:

```
ak_live_9f3c1a7b2d4e6f80   Qm4t...  (40+ char secret, base62)
└ public prefix (indexed)   └ secret (hashed at rest)
```

## 3. Scope catalogue

| Scope | Grants | Phase |
|---|---|---|
| `wallets:read` | balances, per-currency wallets, FX rates | 1 |
| `ledger:read` | wallet ledger history | 1 |
| `trading:read` | trades + opportunity history | 1 |
| `positions:read` | all investment-module positions (stake, treasury, cooperate-dept, litigation-funds, ip-royalties, music-royalties, agro-investment, carbon-credit, green-energy, lending, mining) | 1 |
| `payouts:read` | payout requests | 1 |
| `kyc:read` | KYC status (no document contents) | 1 |
| `notifications:read` | notification history | 1 |
| `support:read` | tickets + messages | 1 |
| `support:write` | create ticket, reply | 2 |
| `payouts:write` | request/cancel payout | 2 |
| `positions:write` | module purchases/bids (narrowed per module at issue time) | 2 |

Design rule: one read scope per program family so a customer can grant exactly what an integration needs.

## 4. Endpoint reference (v1)

Base URL: `https://<your-domain>/api/v1`

### Phase 1 — read

| Method | Path | Scope | Maps to | Notes |
|---|---|---|---|---|
| GET | `/me` | (auth only) | `auth.me` | account id, name, email, role, package name |
| GET | `/wallets` | `wallets:read` | `customer.balances` | balances + `summary` (USD) |
| GET | `/wallets/{currency}` | `wallets:read` | `customer.balances` | single wallet |
| GET | `/fx/rates` | `wallets:read` | `customer.balances` (`summary.conversions`) | enabled currencies + live USD rates |
| GET | `/ledger` | `ledger:read` | `customer.walletLedger` | cursor paged |
| GET | `/trades` | `trading:read` | `customer.trades` | cursor paged |
| GET | `/opportunities` | `trading:read` | `customer.opportunities` | **read-only snapshot**; must not consume delivery or trigger execution |
| GET | `/positions/{module}` | `positions:read` | `customer.{stakeEarn,treasuryBonds,cooperateDept,litigationFunds,ipRoyalties,musicRoyalties,agroInvestment,carbonCredit,greenEnergy,lending,mining,}` | `module` ∈ `stake,treasury,cooperate-dept,litigation-funds,ip-royalties,music-royalties,agro-investment,carbon-credit,green-energy,lending,mining` |
| GET | `/payouts` | `payouts:read` | `customer.payoutRequests` | cursor paged |
| GET | `/payouts/{id}` | `payouts:read` | `customer.payoutRequests` | |
| GET | `/kyc` | `kyc:read` | `customer.kycCenter` | status/stages only |
| GET | `/notifications` | `notifications:read` | `customer.notificationHistory` | cursor paged |
| GET | `/tickets` | `support:read` | `customer.tickets` | |
| GET | `/tickets/{id}` | `support:read` | `customer.ticketMessages` | |
| GET | `/tickets/{id}/messages` | `support:read` | `customer.ticketMessages` | |

### Phase 2 — write (planning only, not issued in v1)

| Method | Path | Scope | Maps to |
|---|---|---|---|
| POST | `/payouts` | `payouts:write` | `customer.requestPayout` |
| POST | `/payouts/{id}/cancel` | `payouts:write` | `customer.cancelPayoutRequest` |
| POST | `/stake/positions` | `positions:write` | `customer.stakeEarn.allocate` |
| POST | `/treasury/purchases` | `positions:write` | `customer.treasuryBonds.purchase` |
| POST | `/cooperate-dept/purchases` | `positions:write` | `customer.cooperateDept.purchase` |
| POST | `/litigation-funds/purchases` | `positions:write` | `customer.litigationFunds.purchase` |
| POST | `/ip-royalties/purchases` | `positions:write` | `customer.ipRoyalties.purchase` |
| POST | `/music-royalties/purchases` | `positions:write` | `customer.musicRoyalties.purchase` |
| POST | `/agro-investment/purchases` | `positions:write` | `customer.agroInvestment.purchase` |
| POST | `/carbon-credit/purchases` | `positions:write` | `customer.carbonCredit.purchase` |
| POST | `/green-energy/purchases` | `positions:write` | `customer.greenEnergy.purchase` |
| POST | `/lending/bids` | `positions:write` | `customer.lending.placeBid` |
| POST | `/mining/purchases` | `positions:write` | `customer.mining.purchasePackage` |
| POST | `/mining/boosts` | `positions:write` | `customer.mining.activateBoost` |
| POST | `/mining/swaps` | `positions:write` | `customer.mining.confirmSwap` |
| POST | `/tickets` | `support:write` | `customer.createTicket` |
| POST | `/tickets/{id}/replies` | `support:write` | `customer.replyTicket` |

Never exposed on any key: `adminOperations.*`, `companyCatalogueReference.*`, popup acknowledgements, settlement, or any procedure that lets the client choose package / payout rate / duration / company (per API_CONTRACTS.md).

## 5. Data shapes

### Wallet summary — `GET /wallets`

```json
{
  "balances": [
    { "currency": "USD", "availableMinor": 1250000, "lockedMinor": 0,
      "promotionalMinor": 0, "earnedMinor": 0, "pendingWithdrawalMinor": 0,
      "updatedAt": "2026-11-24T09:00:00.000Z" }
  ],
  "currencies": [
    { "code": "USD", "name": "US Dollar", "symbol": "$", "scale": 2, "assetType": "fiat" }
  ],
  "summary": {
    "availableUsd": 12500, "lockedUsd": 0, "withdrawingUsd": 0,
    "promotionalUsd": 0, "earnedUsd": 0, "totalUsd": 12500,
    "ratesUnavailable": false,
    "conversions": [
      { "from": "EUR", "to": "USD", "rate": "1.08", "provider": "frankfurter-ecb",
        "updatedAt": "2026-11-24T08:59:00.000Z" }
    ]
  }
}
```

All money is **integer minor units** (USD scale 2 → `1250000` = $12,500.00). `ratesUnavailable: true` means at least one funded wallet could not be priced — treat as **unknown, not zero**.

### Ledger entry — `GET /ledger`

```json
{ "id": 8123, "currency": "USD", "amountMinor": 25000, "entryType": "admin_credit",
  "createdAt": "2026-11-24T08:00:00.000Z" }
```

### Payout — `GET /payouts`

```json
{ "id": 442, "requestReference": "PO-...", "currency": "USD", "amountMinor": 50000,
  "destinationType": "bank_transfer", "destinationDetails": "•••• 4321", "status": "processing",
  "externalReference": null, "resolutionNote": null, "resolvedAt": null,
  "createdAt": "2026-11-24T08:10:00.000Z", "updatedAt": "2026-11-24T08:12:00.000Z" }
```

`destinationDetails` is masked; full details are never returned.

### Opportunity (read-only) — `GET /opportunities`

Returns the customer-visible projection only (package/terms/internal fields stripped, same as the portal). **A read must not consume delivery, allocate capital, or post ledger entries.**

## 6. Cross-cutting behaviour

- **Pagination**: cursor-based. Query `?cursor=<opaque>&limit=<1..100>`; response `{ "items": [...], "nextCursor": "..." | null }`.
- **Idempotency** (phase 2 writes): require `Idempotency-Key` header (8–160 chars). Same key + same body → replay original response; same key + different body → `409 already used for a different request`. Mirrors the existing `adminWalletAdjustmentIdempotency` pattern.
- **Rate limits**: default 120 req/min per key; `429` with `Retry-After`. Per-key override supported.
- **Errors** (RFC 9457 `application/problem+json`):

```json
{ "type": "https://docs.arbitrade.example/errors/insufficient-scope",
  "title": "Missing scope", "status": 403, "detail": "This key lacks positions:read",
  "instance": "/api/v1/positions/mining" }
```

| Status | Meaning |
|---|---|
| 401 | missing/invalid/revoked key |
| 403 | authenticated but scope missing |
| 404 | not found, or not owned by this key's customer |
| 409 | idempotency conflict |
| 422 | validation failure |
| 429 | rate limit |
| 503 | upstream (DB/provider) unavailable — retry |

- **Correlation**: every response carries `X-Request-Id`; log it with the API key id for audit.

## 7. Webhooks (phase 1)

Signed, at-least-once delivery to customer-registered HTTPS endpoints.

| Event | Fires when | Payload anchors |
|---|---|---|
| `wallet.ledger.posted` | any committed ledger entry | ledger entry id, currency, amountMinor, entryType |
| `trade.settled` | a trade reaches settlement | trade reference, currency, principal + reward minor |
| `opportunity.delivered` | an offer is dispatched to the customer | event id, symbol, expiresAt |
| `payout.updated` | payout status changes | payout id, status, externalReference |
| `mining.reward` | a mining reward posts | package ref, amountMinor, asset |

Delivery contract:
- Headers: `X-Arbitrade-Event`, `X-Arbitrade-Delivery`, `X-Arbitrade-Timestamp`, `X-Arbitrade-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<raw_body>")>`.
- Verify signature + reject stale timestamps (replay protection); respond `2xx` within 5s.
- Retries: exponential backoff, up to 8 attempts, then dead-letter; delivery history is queryable per endpoint.
- Webhooks are **notifications, not the source of truth** — reconcile via the read endpoints.

## 8. API-key / scope data model

See [`api-keys.schema.sql`](./api-keys.schema.sql). Summary:

- `api_keys` — id, user_id, name, key_prefix, secret_hash, scopes (JSON), environment, ip_allowlist (JSON), rate_limit_per_minute, status (`active`/`revoked`), last_used_at, created_at, revoked_at, revoked_reason.
- `api_webhook_endpoints` — id, user_id, url, secret (encrypted), subscribed_events (JSON), status, created_at.
- `api_webhook_deliveries` — id, endpoint_id, event_id, event_type, payload (JSON), status, attempts, response_status, next_attempt_at.
- `api_idempotency_keys` — key, api_key_id, request_hash, response (JSON), expires_at (unique per key).
- `api_request_log` — id, api_key_id, method, path, status, latency_ms, request_id, created_at.

## 9. Guardrails

- **Server-authoritative**: clients never choose package, rate, duration, company, or allocation.
- **Money**: integer minor units + integer basis points; no float math.
- **Isolation**: every query is scoped to the key's owning customer; cross-customer access returns `404`.
- **Secrets**: only hashes at rest; secrets shown once; webhook secrets encrypted.
- **Fail closed**: missing/stale FX or malformed config → reject, never guess.
- **Audit**: all key management and every request logged.
- **Scope registry**: scopes are server-validated against a fixed allowlist; unknown scopes are rejected at key creation.

## 10. Rollout

1. Read-only v1 + webhooks + API Access panel (keys, scopes, revocation, docs).
2. Publish OpenAPI + hosted docs; generate SDKs.
3. Add guarded write scopes module-by-module (start with `payouts:write`, then trading/mining).
4. Add test environment + sandbox data.

## 11. Open questions for the owner

- Public docs URL and branding (e.g. `developers.arbitrade.example`)?
- Rate-limit tiers by package (Starter/Pro/…) or flat?
- Should `test` keys exist in v1, or live-only first?
- Which module is the pilot for phase-2 writes?
