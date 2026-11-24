import { and, count, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, apiRequestLog, apiWebhookDeliveries, customerApiSettings, users, v5AuditEvents } from "../../drizzle/schema";
import { ApiKeyError, createApiKey, revokeApiKey, updateApiKey, type PublicApiKey } from "./keys";
import type { ApiScope } from "./scopes";

/**
 * Customer API v1 — administrator operations.
 *
 * Staff-facing management of customer API keys, per-customer access policy and
 * the read-only request/delivery audit. Every mutation records an audit event
 * with the acting administrator and the supplied reason. No money logic lives
 * here — administrators still cannot move funds through this surface.
 */

const MAX_PAGE_SIZE = 100;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function recordAudit(adminId: number, action: string, entityId: string, reason: string, metadata?: unknown): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(v5AuditEvents).values({
      actorUserId: adminId,
      action,
      entityType: "customer_api_key",
      entityId,
      reason: reason.slice(0, 500),
      reference: `customer-api-key:${entityId}`,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    });
  } catch {
    // Audit is best-effort; it must not fail the administrative action.
  }
}

export interface AdminApiKeyRow extends PublicApiKey {
  userId: number;
  customerName: string | null;
  customerEmail: string | null;
  /** The customer's resolved API access policy (true unless explicitly disabled). */
  apiEnabled: boolean;
}

export interface ListAdminApiKeysParams {
  query?: string;
  status?: "active" | "revoked";
  userId?: number;
  page?: number;
  pageSize?: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Search every customer's API keys with their owning-customer context. */
export async function listAdminApiKeys(params: ListAdminApiKeysParams = {}): Promise<PagedResult<AdminApiKeyRow>> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const page = clampInt(params.page, 1, 1, 10_000);
  const pageSize = clampInt(params.pageSize, 25, 1, MAX_PAGE_SIZE);

  const filters = [];
  if (params.status) filters.push(eq(apiKeys.status, params.status));
  if (params.userId) filters.push(eq(apiKeys.userId, params.userId));
  const query = params.query?.trim();
  if (query) {
    const match = `%${query}%`;
    const condition = or(like(apiKeys.name, match), like(apiKeys.keyPrefix, match), like(users.email, match), like(users.name, match));
    if (condition) filters.push(condition);
  }
  const where = filters.length ? and(...filters) : undefined;

  const totalRow = await db.select({ value: count() }).from(apiKeys).innerJoin(users, eq(apiKeys.userId, users.id)).where(where);
  const total = Number(totalRow[0]?.value ?? 0);

  const rows = await db.select({ key: apiKeys, customerName: users.name, customerEmail: users.email })
    .from(apiKeys).innerJoin(users, eq(apiKeys.userId, users.id))
    .where(where).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
    .limit(pageSize).offset((page - 1) * pageSize);

  const userIds = Array.from(new Set(rows.map((row) => row.key.userId)));
  const settingsRows = userIds.length
    ? await db.select({ userId: customerApiSettings.userId, apiEnabled: customerApiSettings.apiEnabled }).from(customerApiSettings).where(inArray(customerApiSettings.userId, userIds))
    : [];
  const enabledByUser = new Map(settingsRows.map((row) => [row.userId, row.apiEnabled]));

  const items: AdminApiKeyRow[] = rows.map((row) => ({
    id: row.key.id,
    userId: row.key.userId,
    name: row.key.name,
    keyPrefix: row.key.keyPrefix,
    scopes: Array.isArray(row.key.scopes) ? (row.key.scopes as ApiScope[]) : [],
    environment: row.key.environment,
    status: row.key.status,
    rateLimitPerMinute: row.key.rateLimitPerMinute ?? null,
    ipAllowlist: Array.isArray(row.key.ipAllowlist) ? (row.key.ipAllowlist as string[]) : null,
    lastUsedAt: toIso(row.key.lastUsedAt),
    createdAt: toIso(row.key.createdAt) ?? new Date(0).toISOString(),
    revokedAt: toIso(row.key.revokedAt),
    customerName: row.customerName ?? null,
    customerEmail: row.customerEmail ?? null,
    apiEnabled: enabledByUser.get(row.key.userId) ?? true,
  }));

  return { items, total, page, pageSize };
}

export interface AdminCreateApiKeyInput {
  userId: number;
  name: unknown;
  scopes: unknown;
  environment?: unknown;
  ipAllowlist?: unknown;
  rateLimitPerMinute?: unknown;
  reason: string;
}

/** Create a key on behalf of a customer. The plaintext key is returned once. */
export async function createAdminApiKey(adminId: number, input: AdminCreateApiKeyInput): Promise<{ issued: { key: string; prefix: string }; record: PublicApiKey }> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5 || reason.length > 500) throw new ApiKeyError("Provide an audit reason of 5–500 characters.");
  const result = await createApiKey(input.userId, {
    name: input.name,
    scopes: input.scopes,
    environment: input.environment,
    ipAllowlist: input.ipAllowlist,
    rateLimitPerMinute: input.rateLimitPerMinute,
  });
  await recordAudit(adminId, "customer_api.key_created", String(result.record.id), reason, {
    userId: input.userId,
    keyPrefix: result.record.keyPrefix,
    scopes: result.record.scopes,
  });
  return result;
}

export interface AdminUpdateApiKeyInput {
  keyId: number;
  name?: unknown;
  scopes?: unknown;
  ipAllowlist?: unknown;
  rateLimitPerMinute?: unknown;
  status?: "active" | "revoked";
  reason: string;
}

/** Update a key's label, scopes, limits or status. Records an audit event. */
export async function updateAdminApiKey(adminId: number, input: AdminUpdateApiKeyInput): Promise<PublicApiKey> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5 || reason.length > 500) throw new ApiKeyError("Provide an audit reason of 5–500 characters.");
  const record = await updateApiKey(input.keyId, {
    name: input.name,
    scopes: input.scopes,
    ipAllowlist: input.ipAllowlist,
    rateLimitPerMinute: input.rateLimitPerMinute,
    status: input.status,
  });
  if (!record) throw new ApiKeyError("API key not found.");
  await recordAudit(adminId, "customer_api.key_updated", String(record.id), reason, {
    keyPrefix: record.keyPrefix,
    status: record.status,
    scopes: record.scopes,
  });
  return record;
}

/** Revoke any customer's key. Returns false when the key does not exist. */
export async function revokeAdminApiKey(adminId: number, keyId: number, reason: string): Promise<boolean> {
  const trimmed = String(reason ?? "").trim();
  if (trimmed.length < 5 || trimmed.length > 500) throw new ApiKeyError("Provide an audit reason of 5–500 characters.");
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const current = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1))[0];
  if (!current) return false;
  await revokeApiKey(current.userId, keyId, trimmed);
  await recordAudit(adminId, "customer_api.key_revoked", String(keyId), trimmed, { userId: current.userId, keyPrefix: current.keyPrefix });
  return true;
}

export interface AdminApiRequestRow {
  id: number;
  apiKeyId: number | null;
  keyPrefix: string | null;
  userId: number | null;
  requestId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  createdAt: string | null;
}

export interface ListAdminApiRequestsParams {
  apiKeyId?: number;
  userId?: number;
  page?: number;
  pageSize?: number;
}

/** Read-only view of the API request audit, newest first. */
export async function listAdminApiRequests(params: ListAdminApiRequestsParams = {}): Promise<PagedResult<AdminApiRequestRow>> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const page = clampInt(params.page, 1, 1, 10_000);
  const pageSize = clampInt(params.pageSize, 50, 1, MAX_PAGE_SIZE);

  const filters = [];
  if (params.apiKeyId) filters.push(eq(apiRequestLog.apiKeyId, params.apiKeyId));
  if (params.userId) filters.push(eq(apiKeys.userId, params.userId));
  const where = filters.length ? and(...filters) : undefined;

  const totalRow = await db.select({ value: count() }).from(apiRequestLog).leftJoin(apiKeys, eq(apiRequestLog.apiKeyId, apiKeys.id)).where(where);
  const total = Number(totalRow[0]?.value ?? 0);

  const rows = await db.select({ log: apiRequestLog, keyPrefix: apiKeys.keyPrefix, userId: apiKeys.userId })
    .from(apiRequestLog).leftJoin(apiKeys, eq(apiRequestLog.apiKeyId, apiKeys.id))
    .where(where).orderBy(desc(apiRequestLog.createdAt), desc(apiRequestLog.id))
    .limit(pageSize).offset((page - 1) * pageSize);

  return {
    items: rows.map((row) => ({
      id: row.log.id,
      apiKeyId: row.log.apiKeyId ?? null,
      keyPrefix: row.keyPrefix ?? null,
      userId: row.userId ?? null,
      requestId: row.log.requestId,
      method: row.log.method,
      path: row.log.path,
      status: row.log.status,
      latencyMs: row.log.latencyMs,
      createdAt: toIso(row.log.createdAt),
    })),
    total,
    page,
    pageSize,
  };
}

export interface AdminWebhookDeliveryRow {
  id: number;
  endpointId: number;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastAttemptAt: string | null;
  createdAt: string | null;
}

/** Read-only view of webhook delivery attempts (populated once webhooks ship). */
export async function listAdminApiWebhookDeliveries(params: { page?: number; pageSize?: number } = {}): Promise<PagedResult<AdminWebhookDeliveryRow>> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const page = clampInt(params.page, 1, 1, 10_000);
  const pageSize = clampInt(params.pageSize, 50, 1, MAX_PAGE_SIZE);

  const totalRow = await db.select({ value: count() }).from(apiWebhookDeliveries);
  const total = Number(totalRow[0]?.value ?? 0);
  const rows = await db.select().from(apiWebhookDeliveries)
    .orderBy(desc(apiWebhookDeliveries.createdAt), desc(apiWebhookDeliveries.id))
    .limit(pageSize).offset((page - 1) * pageSize);

  return {
    items: rows.map((row) => ({
      id: row.id,
      endpointId: row.endpointId,
      eventId: row.eventId,
      eventType: row.eventType,
      status: row.status,
      attempts: row.attempts,
      responseStatus: row.responseStatus ?? null,
      lastAttemptAt: toIso(row.lastAttemptAt),
      createdAt: toIso(row.createdAt),
    })),
    total,
    page,
    pageSize,
  };
}

export interface AdminApiOverview {
  totalKeys: number;
  activeKeys: number;
  revokedKeys: number;
  requests24h: number;
  failedDeliveries: number;
  disabledCustomers: number;
}

/** Aggregate counters for the admin API-access dashboard. */
export async function getAdminApiOverview(): Promise<AdminApiOverview> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalRow] = await db.select({ value: count() }).from(apiKeys);
  const [activeRow] = await db.select({ value: count() }).from(apiKeys).where(eq(apiKeys.status, "active"));
  const [revokedRow] = await db.select({ value: count() }).from(apiKeys).where(eq(apiKeys.status, "revoked"));
  const [requestsRow] = await db.select({ value: count() }).from(apiRequestLog).where(gte(apiRequestLog.createdAt, since));
  const [failedRow] = await db.select({ value: count() }).from(apiWebhookDeliveries).where(inArray(apiWebhookDeliveries.status, ["failed", "dead"]));
  const [disabledRow] = await db.select({ value: count() }).from(customerApiSettings).where(eq(customerApiSettings.apiEnabled, false));
  return {
    totalKeys: Number(totalRow?.value ?? 0),
    activeKeys: Number(activeRow?.value ?? 0),
    revokedKeys: Number(revokedRow?.value ?? 0),
    requests24h: Number(requestsRow?.value ?? 0),
    failedDeliveries: Number(failedRow?.value ?? 0),
    disabledCustomers: Number(disabledRow?.value ?? 0),
  };
}

export interface AdminCustomerOption {
  id: number;
  name: string | null;
  email: string | null;
}

/** Customer picker for the admin API panel (excludes staff accounts). */
export async function listAdminApiCustomerOptions(params: { query?: string } = {}): Promise<AdminCustomerOption[]> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const query = params.query?.trim();
  const filters = [sql`${users.role} <> 'admin'`];
  if (query) {
    const match = `%${query}%`;
    const condition = or(like(users.email, match), like(users.name, match));
    if (condition) filters.push(condition);
  }
  const rows = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(and(...filters)).orderBy(desc(users.createdAt)).limit(25);
  return rows.map((row) => ({ id: row.id, name: row.name ?? null, email: row.email ?? null }));
}
