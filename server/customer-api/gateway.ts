import express, { type Express, type Request, type RequestHandler, type Response, type Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  getCustomerBalanceSummary,
  getCustomerTicket,
  getDb,
  getUserById,
  listCustomerNotificationPage,
  listCustomerOpportunities,
  listCustomerPayoutRequests,
  listCustomerTickets,
  listCustomerWalletLedger,
  listTicketMessages,
  listTrades,
} from "../db";
import { apiRequestLog, payoutRequests } from "../../drizzle/schema";
import { getCenter } from "../kyc";
import { stripCustomerFeedInternalObjects } from "../modules/customer-feed-payload";
import { getStakeDashboard } from "../stakeEarn";
import { getTreasuryBondDashboard } from "../treasuryBonds";
import { getCooperateDeptDashboard } from "../cooperateDept";
import { getLitigationFundsDashboard } from "../litigationFunds";
import { getIpRoyaltiesDashboard } from "../ipRoyalties";
import { getMusicRoyaltiesDashboard } from "../musicRoyalties";
import { getAgroInvestmentDashboard } from "../agroInvestments";
import { getCarbonInvestmentDashboard } from "../carbonCredits";
import { getGreenEnergyInvestmentDashboard } from "../greenEnergy";
import { getLendingDesk } from "../lending";
import { getCustomerMiningDashboard } from "../mining";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey, ApiKeyError, type AuthenticatedApiKey } from "./keys";
import { hasScope, ApiScopeError, type ApiScope, SCOPE_DESCRIPTIONS } from "./scopes";
import { ensureCustomerApiSchema } from "./schema";
import { getLocalSessionFromRequest } from "../_core/localAuth";

/**
 * Customer API v1 — the read gateway.
 *
 * A stateless translation layer over the existing server-authoritative customer
 * service functions. It adds API-key auth, scope authorization, rate limiting,
 * RFC 9457 errors, correlation ids and audit logging — and no money logic. Every
 * read is scoped to the key's owning customer; a cross-customer id yields 404.
 */

const API_BASE_PATH = "/api/v1";
const PROBLEM_TYPE_BASE = "https://docs.arbitrade.example/errors";
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Internal fields stripped from any customer-facing feed value. Mirrors the
 * customer tRPC projections so the API never leaks admin-managed policy objects.
 */
const INTERNAL_CUSTOMER_FIELDS = [
  "packageName",
  "packageId",
  "packageSubscriptionId",
  "activationKey",
  "packageTermsVersion",
  "termsSnapshotJson",
  "qualifyingBalanceUsdMinor",
  "packageMinimumTradeMinor",
  "packageMaximumTradeMinor",
  "packageQuota",
] as const;

interface RateBucket {
  hits: number[];
}

const rateBuckets = new Map<number, RateBucket>();

type AuthedResponse = Response & { locals: { apiKey?: AuthenticatedApiKey; requestId?: string } };

function sendProblem(res: Response, status: number, code: string, title: string, detail: string): void {
  res.status(status).type("application/problem+json").json({
    type: `${PROBLEM_TYPE_BASE}/${code}`,
    title,
    status,
    detail,
    instance: res.req.originalUrl,
  });
}

function toSafeCustomerObject<T>(value: T): T {
  const stripped = stripCustomerFeedInternalObjects(value);
  if (!stripped || typeof stripped !== "object" || Array.isArray(stripped)) return stripped;
  const safe: Record<string, unknown> = { ...(stripped as Record<string, unknown>) };
  for (const field of INTERNAL_CUSTOMER_FIELDS) delete safe[field];
  return safe as T;
}

function maskDestinationDetails(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text.length <= 4) return "••••";
  return `•••• ${text.slice(-4)}`;
}

function toPublicPayout(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(row.id),
    requestReference: row.requestReference,
    currency: row.currency,
    amountMinor: Number(row.amountMinor),
    destinationType: row.destinationType,
    destinationDetails: maskDestinationDetails(row.destinationDetails),
    status: row.status,
    externalReference: row.externalReference ?? null,
    resolutionNote: row.resolutionNote ?? null,
    resolvedAt: row.resolvedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function readBoundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isSafeInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function consumeRateLimit(keyId: number, limit: number): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const existing = rateBuckets.get(keyId);
  const hits = existing ? existing.hits.filter((stamp) => stamp > windowStart) : [];
  if (hits.length >= limit) {
    rateBuckets.set(keyId, { hits });
    return false;
  }
  hits.push(now);
  rateBuckets.set(keyId, { hits });
  if (rateBuckets.size > 5_000) {
    for (const [id, bucket] of rateBuckets) {
      if (!bucket.hits.some((stamp) => stamp > windowStart)) rateBuckets.delete(id);
    }
  }
  return true;
}

function readPresentedKey(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  const apiKeyHeader = req.headers["x-api-key"];
  const value = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Correlation id + best-effort request audit for every /api/v1 call. */
const correlationAndAudit: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  (res as AuthedResponse).locals.requestId = requestId;
  res.set("X-Request-Id", requestId);
  const startedAt = Date.now();
  res.on("finish", () => {
    const apiKey = (res as AuthedResponse).locals.apiKey;
    void recordRequestLog({
      apiKeyId: apiKey ? apiKey.id : null,
      requestId,
      method: req.method,
      path: req.path.slice(0, 255),
      status: res.statusCode,
      latencyMs: Date.now() - startedAt,
    });
  });
  next();
};

async function recordRequestLog(entry: { apiKeyId: number | null; requestId: string; method: string; path: string; status: number; latencyMs: number }): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(apiRequestLog).values({
      apiKeyId: entry.apiKeyId,
      requestId: entry.requestId,
      method: entry.method.slice(0, 8),
      path: entry.path,
      status: entry.status,
      latencyMs: Math.max(0, entry.latencyMs),
    });
  } catch {
    // Audit logging is best-effort and must never affect the response.
  }
}

/** Authenticate the presented key, enforce the per-key rate limit, resolve context. */
const requireApiKey: RequestHandler = async (req, res, next) => {
  await ensureCustomerApiSchema();
  const presented = readPresentedKey(req);
  if (!presented) {
    sendProblem(res, 401, "unauthorized", "Authentication required", "Provide a key as 'Authorization: Bearer ak_...' or the 'X-API-Key' header.");
    return;
  }
  let auth: AuthenticatedApiKey | null;
  try {
    auth = await authenticateApiKey(presented, { ip: req.ip });
  } catch {
    sendProblem(res, 503, "upstream-unavailable", "Service unavailable", "The authentication store is unavailable. Retry shortly.");
    return;
  }
  if (!auth) {
    sendProblem(res, 401, "invalid-key", "Invalid API key", "The key is missing, malformed, revoked, or not permitted from this address.");
    return;
  }
  (res as AuthedResponse).locals.apiKey = auth;
  if (!consumeRateLimit(auth.id, auth.rateLimitPerMinute)) {
    res.set("Retry-After", "60");
    sendProblem(res, 429, "rate-limited", "Rate limit exceeded", `This key is limited to ${auth.rateLimitPerMinute} requests per minute.`);
    return;
  }
  next();
};

function requireScope(scope: ApiScope): RequestHandler {
  return (_req, res, next) => {
    const auth = (res as AuthedResponse).locals.apiKey;
    if (!auth || !hasScope(auth.scopes, scope)) {
      sendProblem(res, 403, "insufficient-scope", "Missing scope", `This key lacks the ${scope} scope.`);
      return;
    }
    next();
  };
}

function currentKey(res: Response): AuthenticatedApiKey {
  const auth = (res as AuthedResponse).locals.apiKey;
  if (!auth) throw new Error("API key context is missing.");
  return auth;
}

/** Wrap an async handler so a failure maps to a 503 problem document. */
function readHandler(handler: (req: Request, res: Response, auth: AuthenticatedApiKey) => Promise<void>): RequestHandler {
  return (req, res) => {
    const auth = currentKey(res);
    handler(req, res, auth).catch((error) => {
      if (res.headersSent) return;
      console.error("[CustomerApi] read handler failed", error instanceof Error ? error.name : "UnknownError");
      sendProblem(res, 503, "upstream-unavailable", "Service unavailable", "The request could not be completed. Retry shortly.");
    });
  };
}

const POSITION_MODULES: Record<string, (userId: number) => Promise<unknown>> = {
  "stake": getStakeDashboard,
  "treasury": getTreasuryBondDashboard,
  "cooperate-dept": getCooperateDeptDashboard,
  "litigation-funds": getLitigationFundsDashboard,
  "ip-royalties": getIpRoyaltiesDashboard,
  "music-royalties": getMusicRoyaltiesDashboard,
  "agro-investment": getAgroInvestmentDashboard,
  "carbon-credit": getCarbonInvestmentDashboard,
  "green-energy": getGreenEnergyInvestmentDashboard,
  "lending": getLendingDesk,
  "mining": getCustomerMiningDashboard,
};

function buildV1Router(): Router {
  const router = express.Router();
  router.use(correlationAndAudit);
  router.use(requireApiKey);

  router.get("/me", readHandler(async (_req, res, auth) => {
    const user = await getUserById(auth.userId);
    if (!user) {
      sendProblem(res, 401, "invalid-key", "Invalid API key", "The key owner no longer exists.");
      return;
    }
    res.json({
      id: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
      role: user.role,
      packageName: user.packageName ?? null,
    });
  }));

  router.get("/scopes", readHandler(async (_req, res, auth) => {
    res.json({
      granted: auth.scopes,
      available: Object.entries(SCOPE_DESCRIPTIONS).map(([scope, description]) => ({ scope, description })),
    });
  }));

  router.get("/wallets", requireScope("wallets:read"), readHandler(async (_req, res, auth) => {
    res.json(await getCustomerBalanceSummary(auth.userId));
  }));

  router.get("/wallets/:currency", requireScope("wallets:read"), readHandler(async (req, res, auth) => {
    const summary = await getCustomerBalanceSummary(auth.userId);
    const code = String(req.params.currency).toUpperCase();
    const balance = summary.balances.find((row) => String(row.currency).toUpperCase() === code);
    const currency = summary.currencies.find((row) => String(row.code).toUpperCase() === code);
    if (!balance || !currency) {
      sendProblem(res, 404, "not-found", "Wallet not found", `No ${code} wallet is enabled for this account.`);
      return;
    }
    res.json({ balance, currency });
  }));

  router.get("/fx/rates", requireScope("wallets:read"), readHandler(async (_req, res, auth) => {
    const summary = await getCustomerBalanceSummary(auth.userId);
    res.json({
      currencies: summary.currencies,
      conversions: summary.summary.conversions,
      ratesUnavailable: summary.summary.ratesUnavailable,
    });
  }));

  router.get("/ledger", requireScope("ledger:read"), readHandler(async (req, res, auth) => {
    const limit = readBoundedInt(req.query.limit, 50, 1, 100);
    const items = await listCustomerWalletLedger(auth.userId, limit);
    res.json({ items, nextCursor: null });
  }));

  router.get("/trades", requireScope("trading:read"), readHandler(async (_req, res, auth) => {
    const items = (await listTrades(auth.userId)).map((row) => toSafeCustomerObject(row));
    res.json({ items, nextCursor: null });
  }));

  router.get("/opportunities", requireScope("trading:read"), readHandler(async (_req, res, auth) => {
    // Read-only snapshot: never consume a delivery or trigger execution.
    const result = await listCustomerOpportunities(auth.userId, { consumeDelivery: false });
    res.json({
      offers: (result.offers ?? []).map((row) => toSafeCustomerObject(row)),
      missed: (result.missed ?? []).map((row) => toSafeCustomerObject(row)),
      delivery: toSafeCustomerObject(result.delivery),
    });
  }));

  router.get("/positions/:module", requireScope("positions:read"), readHandler(async (req, res, auth) => {
    const moduleKey = String(req.params.module);
    const load = POSITION_MODULES[moduleKey];
    if (!load) {
      sendProblem(res, 404, "not-found", "Unknown module", `No investment desk named '${moduleKey}'.`);
      return;
    }
    res.json({ module: moduleKey, data: toSafeCustomerObject(await load(auth.userId)) });
  }));

  router.get("/payouts", requireScope("payouts:read"), readHandler(async (req, res, auth) => {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const pageSize = readBoundedInt(req.query.pageSize, 50, 1, 100);
    const page = await listCustomerPayoutRequests(auth.userId, { cursor, pageSize });
    res.json({
      items: page.items.map((row) => toPublicPayout(row as unknown as Record<string, unknown>)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }));

  router.get("/payouts/:id", requireScope("payouts:read"), readHandler(async (req, res, auth) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      sendProblem(res, 404, "not-found", "Payout not found", "No payout matches that id.");
      return;
    }
    const db = await getDb();
    if (!db) {
      sendProblem(res, 503, "upstream-unavailable", "Service unavailable", "The database is unavailable. Retry shortly.");
      return;
    }
    const row = (await db.select().from(payoutRequests).where(and(eq(payoutRequests.id, id), eq(payoutRequests.userId, auth.userId))).limit(1))[0];
    if (!row) {
      sendProblem(res, 404, "not-found", "Payout not found", "No payout matches that id.");
      return;
    }
    res.json(toPublicPayout(row as unknown as Record<string, unknown>));
  }));

  router.get("/kyc", requireScope("kyc:read"), readHandler(async (_req, res, auth) => {
    res.json(await getCenter(auth.userId));
  }));

  router.get("/notifications", requireScope("notifications:read"), readHandler(async (req, res, auth) => {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = readBoundedInt(req.query.limit, 50, 1, 100);
    res.json(await listCustomerNotificationPage(auth.userId, cursor, limit));
  }));

  router.get("/tickets", requireScope("support:read"), readHandler(async (_req, res, auth) => {
    res.json({ items: await listCustomerTickets(auth.userId) });
  }));

  router.get("/tickets/:id", requireScope("support:read"), readHandler(async (req, res, auth) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      sendProblem(res, 404, "not-found", "Ticket not found", "No ticket matches that id.");
      return;
    }
    const ticket = await getCustomerTicket(auth.userId, id);
    if (!ticket) {
      sendProblem(res, 404, "not-found", "Ticket not found", "No ticket matches that id.");
      return;
    }
    res.json(ticket);
  }));

  router.get("/tickets/:id/messages", requireScope("support:read"), readHandler(async (req, res, auth) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      sendProblem(res, 404, "not-found", "Ticket not found", "No ticket matches that id.");
      return;
    }
    if (!(await getCustomerTicket(auth.userId, id))) {
      sendProblem(res, 404, "not-found", "Ticket not found", "No ticket matches that id.");
      return;
    }
    res.json({ items: await listTicketMessages(id) });
  }));

  return router;
}

/** Resolve the signed-in portal customer for the key-management routes. */
async function resolvePortalCustomer(req: Request): Promise<{ id: number } | null> {
  const session = getLocalSessionFromRequest(req);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || Number(user.authVersion ?? 0) !== Number(session.authVersion ?? 0) || user.loginMethod === "closed") return null;
  return { id: user.id };
}

function buildManagementRouter(): Router {
  const router = express.Router();

  const requireCustomer: RequestHandler = (req, res, next) => {
    void ensureCustomerApiSchema()
      .then(() => resolvePortalCustomer(req))
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        res.locals.customerId = user.id;
        next();
      })
      .catch(() => res.status(503).json({ error: "Authentication store unavailable" }));
  };

  router.get("/", requireCustomer, (req, res) => {
    const customerId = Number(res.locals.customerId);
    listApiKeys(customerId)
      .then((keys) => res.json({ keys, availableScopes: Object.entries(SCOPE_DESCRIPTIONS).map(([scope, description]) => ({ scope, description })) }))
      .catch(() => res.status(503).json({ error: "Could not load API keys." }));
  });

  router.post("/", requireCustomer, (req, res) => {
    const customerId = Number(res.locals.customerId);
    createApiKey(customerId, {
      name: req.body?.name,
      scopes: req.body?.scopes,
      environment: req.body?.environment,
      ipAllowlist: req.body?.ipAllowlist,
      rateLimitPerMinute: req.body?.rateLimitPerMinute,
    })
      .then(({ issued, record }) => res.status(201).json({ key: issued.key, record }))
      .catch((error) => {
        if (error instanceof ApiKeyError || error instanceof ApiScopeError) {
          return res.status(422).json({ error: error.message });
        }
        console.error("[CustomerApi] key creation failed", error instanceof Error ? error.name : "UnknownError");
        return res.status(503).json({ error: "Could not create the API key. Retry shortly." });
      });
  });

  router.post("/:id/revoke", requireCustomer, (req, res) => {
    const customerId = Number(res.locals.customerId);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: "API key not found" });
    revokeApiKey(customerId, id, typeof req.body?.reason === "string" ? req.body.reason : null)
      .then((ok) => (ok ? res.json({ success: true }) : res.status(404).json({ error: "API key not found" })))
      .catch(() => res.status(503).json({ error: "Could not revoke the API key." }));
  });

  return router;
}

/** Register the versioned read API and the customer key-management routes. */
export function registerCustomerApiRoutes(app: Express): void {
  app.use(API_BASE_PATH, buildV1Router());
  app.use("/api/customer/api-keys", buildManagementRouter());
}
