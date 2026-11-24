import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys } from "../../drizzle/schema";
import { normalizeStoredScopes, validateIssuableScopes, type ApiScope } from "./scopes";
import { narrowToReadScopes, resolveApiAccess } from "./settings";

/**
 * Customer API v1 — API-key generation, storage and authentication.
 *
 * Key format: `ak_<env>_<keyId>_<secret>` where `keyId` is 16 hex chars and
 * `secret` is 64 hex chars (32 random bytes). Only the public prefix
 * (`ak_<env>_<keyId>`) is stored in the clear and indexed; the secret half is
 * stored solely as a SHA-256 hash and is shown to the customer exactly once.
 */

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

const KEY_ID_BYTES = 8;
const SECRET_BYTES = 32;
const KEY_PATTERN = /^ak_(live|test)_([0-9a-f]{16})_([0-9a-f]{64})$/;
const MAX_RATE_LIMIT_PER_MINUTE = 100_000;

export type ApiKeyEnvironment = "live" | "test";

/** The key material returned to the caller exactly once, at creation. */
export interface IssuedApiKey {
  /** The full secret key. Never stored, never retrievable again. */
  key: string;
  prefix: string;
}

/** Safe public projection of a stored key (never includes the secret). */
export interface PublicApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  environment: ApiKeyEnvironment;
  status: "active" | "revoked";
  rateLimitPerMinute: number | null;
  ipAllowlist: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Resolved authentication context for an incoming API request. */
export interface AuthenticatedApiKey {
  id: number;
  userId: number;
  name: string;
  scopes: ApiScope[];
  environment: ApiKeyEnvironment;
  rateLimitPerMinute: number;
}

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export function hashApiSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Parse a presented key into its public prefix and secret halves. */
export function parseApiKey(raw: string): { environment: ApiKeyEnvironment; keyId: string; prefix: string; secret: string } | null {
  const match = KEY_PATTERN.exec(typeof raw === "string" ? raw.trim() : "");
  if (!match) return null;
  const environment = match[1] as ApiKeyEnvironment;
  const keyId = match[2];
  return { environment, keyId, prefix: `ak_${environment}_${keyId}`, secret: match[3] };
}

/** Generate fresh key material. The secret is returned once and never stored. */
export function generateApiKey(environment: ApiKeyEnvironment = "live"): IssuedApiKey {
  const keyId = crypto.randomBytes(KEY_ID_BYTES).toString("hex");
  const secret = crypto.randomBytes(SECRET_BYTES).toString("hex");
  const prefix = `ak_${environment}_${keyId}`;
  return { key: `${prefix}_${secret}`, prefix };
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeIpAllowlist(input: unknown): string[] | null {
  if (input == null) return null;
  if (!Array.isArray(input)) throw new ApiKeyError("IP allowlist must be a list of addresses.");
  if (input.length === 0) return null;
  const entries = input.map((value) => String(value).trim()).filter(Boolean);
  for (const entry of entries) {
    if (!/^[0-9a-fA-F.:]+(\/\d{1,3})?$/.test(entry)) {
      throw new ApiKeyError(`Invalid IP allowlist entry: ${entry}`);
    }
  }
  return Array.from(new Set(entries));
}

function normalizeRateLimit(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > MAX_RATE_LIMIT_PER_MINUTE) {
    throw new ApiKeyError(`Rate limit must be an integer between 1 and ${MAX_RATE_LIMIT_PER_MINUTE}.`);
  }
  return input;
}

function validateName(input: unknown): string {
  const name = typeof input === "string" ? input.trim() : "";
  if (name.length < 2 || name.length > 64) throw new ApiKeyError("Key name must be between 2 and 64 characters.");
  return name;
}

export interface CreateApiKeyInput {
  name: unknown;
  scopes: unknown;
  environment?: unknown;
  ipAllowlist?: unknown;
  rateLimitPerMinute?: unknown;
}

/**
 * Create a new API key for a customer. The plaintext key is returned once; only
 * its hash is persisted. Never grants a scope the caller did not select, and
 * refuses phase-2 write scopes in v1.
 */
export async function createApiKey(userId: number, input: CreateApiKeyInput): Promise<{ issued: IssuedApiKey; record: PublicApiKey }> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const name = validateName(input.name);
  const requested = validateIssuableScopes(input.scopes);
  const environment: ApiKeyEnvironment = input.environment === "test" ? "test" : "live";
  const ipAllowlist = normalizeIpAllowlist(input.ipAllowlist);
  const rateLimitPerMinute = normalizeRateLimit(input.rateLimitPerMinute);

  // A key can never hold a scope beyond the account's configured ceiling.
  const access = await resolveApiAccess(userId);
  const ceiling = new Set<string>(access.allowedScopes);
  const scopes = requested.filter((scope) => ceiling.has(scope));
  if (scopes.length !== requested.length) {
    const blocked = requested.filter((scope) => !ceiling.has(scope));
    throw new ApiKeyError(`These scopes exceed the ceiling configured for this account: ${blocked.join(", ")}.`);
  }

  // Retry on the (astronomically unlikely) prefix collision against the unique index.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const issued = generateApiKey(environment);
    const parsed = parseApiKey(issued.key);
    if (!parsed) throw new ApiKeyError("Key generation produced an invalid key.");
    const secretHash = hashApiSecret(parsed.secret);
    try {
      const result = await db.insert(apiKeys).values({
        userId,
        name,
        keyPrefix: issued.prefix,
        secretHash,
        scopes,
        environment,
        ipAllowlist,
        rateLimitPerMinute,
        status: "active",
      });
      const id = Number((result as unknown as { insertId?: number }).insertId);
      const row = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1))[0];
      if (!row) throw new ApiKeyError("Key was created but could not be read back.");
      return { issued, record: toPublicApiKey(row) };
    } catch (error) {
      if (isDuplicateKeyError(error)) continue;
      throw error;
    }
  }
  throw new ApiKeyError("Could not allocate a unique key prefix. Please retry.");
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "ER_DUP_ENTRY" || code === 1062;
}

function toPublicApiKey(row: typeof apiKeys.$inferSelect): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: normalizeStoredScopes(row.scopes as unknown),
    environment: row.environment,
    status: row.status,
    rateLimitPerMinute: row.rateLimitPerMinute ?? null,
    ipAllowlist: Array.isArray(row.ipAllowlist) ? (row.ipAllowlist as string[]) : null,
    lastUsedAt: toIsoString(row.lastUsedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
    revokedAt: toIsoString(row.revokedAt),
  };
}

/** List a customer's keys (public projection only). */
export async function listApiKeys(userId: number): Promise<PublicApiKey[]> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  return rows.map(toPublicApiKey);
}

/** Revoke one of the customer's own keys. Returns false when it is not theirs. */
export async function revokeApiKey(userId: number, keyId: number, reason: string | null = null): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const existing = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId))).limit(1))[0];
  if (!existing) return false;
  if (existing.status === "revoked") return true;
  await db.update(apiKeys)
    .set({ status: "revoked", revokedAt: new Date(), revokedReason: reason ? reason.slice(0, 255) : null })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
  return true;
}

export interface UpdateApiKeyInput {
  name?: unknown;
  scopes?: unknown;
  ipAllowlist?: unknown;
  rateLimitPerMinute?: unknown;
  status?: "active" | "revoked";
}

/**
 * Update a stored key's label, scopes, limits or status by id. Returns null when
 * the key does not exist. Any new scope list is validated and clamped to the
 * owning account's ceiling, so an edit can never widen access beyond policy.
 */
export async function updateApiKey(keyId: number, input: UpdateApiKeyInput): Promise<PublicApiKey | null> {
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const existing = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1))[0];
  if (!existing) return null;

  const patch: Partial<typeof apiKeys.$inferInsert> = {};

  if (input.name !== undefined) patch.name = validateName(input.name);
  if (input.ipAllowlist !== undefined) patch.ipAllowlist = normalizeIpAllowlist(input.ipAllowlist);
  if (input.rateLimitPerMinute !== undefined) patch.rateLimitPerMinute = normalizeRateLimit(input.rateLimitPerMinute);
  if (input.scopes !== undefined) {
    const requested = validateIssuableScopes(input.scopes);
    const access = await resolveApiAccess(existing.userId);
    const ceiling = new Set<string>(access.allowedScopes);
    const blocked = requested.filter((scope) => !ceiling.has(scope));
    if (blocked.length > 0) {
      throw new ApiKeyError(`These scopes exceed the ceiling configured for this account: ${blocked.join(", ")}.`);
    }
    patch.scopes = requested;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "revoked") throw new ApiKeyError("Status must be active or revoked.");
    patch.status = input.status;
    patch.revokedAt = input.status === "revoked" ? (existing.revokedAt ?? new Date()) : null;
  }

  if (Object.keys(patch).length === 0) return toPublicApiKey(existing);

  await db.update(apiKeys).set(patch).where(eq(apiKeys.id, keyId));
  const row = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1))[0];
  return row ? toPublicApiKey(row) : null;
}

function ipMatchesAllowlist(ip: string | undefined, allowlist: string[] | null): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!ip) return false;
  const normalized = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
  return allowlist.some((entry) => ipMatchesEntry(normalized, entry));
}

function ipMatchesEntry(ip: string, entry: string): boolean {
  if (entry.includes("/")) {
    const [network, bitsRaw] = entry.split("/");
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits)) return false;
    const ipv4 = (value: string) => value.split(".").map((part) => Number(part));
    const a = ipv4(ip);
    const b = ipv4(network);
    if (a.length !== 4 || b.length !== 4 || bits < 0 || bits > 32 || a.some((part) => !Number.isInteger(part)) || b.some((part) => !Number.isInteger(part))) return false;
    const toInt = (parts: number[]) => parts.reduce((acc, part) => ((acc << 8) | (part & 0xff)) >>> 0, 0);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (toInt(a) & mask) === (toInt(b) & mask);
  }
  return ip === entry;
}

export interface AuthenticateOptions {
  ip?: string;
  /** Skip the last-used bookkeeping (used by tests and dry runs). */
  skipTouch?: boolean;
}

/**
 * Authenticate a presented key. Returns null for a missing, malformed, unknown
 * or revoked key. Compares the secret hash with a constant-time comparison.
 */
export async function authenticateApiKey(rawKey: unknown, options: AuthenticateOptions = {}): Promise<AuthenticatedApiKey | null> {
  const parsed = parseApiKey(typeof rawKey === "string" ? rawKey : "");
  if (!parsed) return null;
  const db = await getDb();
  if (!db) throw new ApiKeyError("Database is not available.");
  const row = (await db.select().from(apiKeys).where(and(eq(apiKeys.keyPrefix, parsed.prefix), eq(apiKeys.status, "active"))).limit(1))[0];
  if (!row) return null;

  const expected = Buffer.from(row.secretHash, "hex");
  const actual = Buffer.from(hashApiSecret(parsed.secret), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  const allowlist = Array.isArray(row.ipAllowlist) ? (row.ipAllowlist as string[]) : null;
  if (!ipMatchesAllowlist(options.ip, allowlist)) return null;

  // Honour the account's access policy: a disabled customer cannot authenticate,
  // and neither key scopes nor key rate limits may exceed the account ceiling.
  const access = await resolveApiAccess(row.userId);
  if (!access.apiEnabled) return null;
  const ceiling = new Set<string>(access.allowedScopes);

  if (!options.skipTouch) {
    void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => undefined);
  }

  const scopes = narrowToReadScopes(row.scopes).filter((scope) => ceiling.has(scope));
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    scopes,
    environment: row.environment,
    rateLimitPerMinute: row.rateLimitPerMinute && row.rateLimitPerMinute > 0 ? row.rateLimitPerMinute : access.defaultRateLimitPerMinute,
  };
}
