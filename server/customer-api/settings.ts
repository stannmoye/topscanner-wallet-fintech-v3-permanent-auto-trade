import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { customerApiSettings, v5AuditEvents } from "../../drizzle/schema";
import { READ_SCOPES, type ApiScope } from "./scopes";

/**
 * Customer API v1 — per-customer access policy.
 *
 * A missing row is the platform default: access enabled, global rate limit and
 * the full read-scope ceiling. Administrators may disable access or narrow the
 * ceiling; the gateway and key creation both honour the resolved policy.
 */

export const PLATFORM_DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

/** Raised when an administrator supplies an invalid per-customer policy. */
export class ApiAccessPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiAccessPolicyError";
  }
}

export interface ResolvedApiAccess {
  apiEnabled: boolean;
  defaultRateLimitPerMinute: number;
  /** The scopes any key for this customer may hold (never widens beyond read scopes). */
  allowedScopes: ApiScope[];
}

export interface CustomerApiSettingsView {
  userId: number;
  apiEnabled: boolean;
  defaultRateLimitPerMinute: number | null;
  allowedScopes: string[] | null;
  updatedBy: number | null;
  updatedAt: string | null;
}

/** Narrow any stored/requested scope list to the issuable read scopes. */
export function narrowToReadScopes(input: unknown): ApiScope[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(READ_SCOPES);
  return input.filter((scope): scope is ApiScope => typeof scope === "string" && allowed.has(scope));
}

/** Resolve the effective policy for a customer, applying platform defaults. */
export async function resolveApiAccess(userId: number): Promise<ResolvedApiAccess> {
  const settings = await getCustomerApiSettings(userId);
  const ceiling = settings?.allowedScopes && settings.allowedScopes.length > 0 ? settings.allowedScopes : [...READ_SCOPES];
  return {
    apiEnabled: settings ? settings.apiEnabled : true,
    defaultRateLimitPerMinute: settings?.defaultRateLimitPerMinute && settings.defaultRateLimitPerMinute > 0
      ? settings.defaultRateLimitPerMinute
      : PLATFORM_DEFAULT_RATE_LIMIT_PER_MINUTE,
    allowedScopes: narrowToReadScopes(ceiling),
  };
}

/** Read a customer's explicit policy row, or null when only defaults apply. */
export async function getCustomerApiSettings(userId: number): Promise<CustomerApiSettingsView | null> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available.");
  const row = (await db.select().from(customerApiSettings).where(eq(customerApiSettings.userId, userId)).limit(1))[0];
  if (!row) return null;
  return {
    userId: row.userId,
    apiEnabled: row.apiEnabled,
    defaultRateLimitPerMinute: row.defaultRateLimitPerMinute ?? null,
    allowedScopes: Array.isArray(row.allowedScopes) ? (row.allowedScopes as string[]) : null,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  };
}

export interface UpdateCustomerApiSettingsInput {
  apiEnabled?: boolean;
  defaultRateLimitPerMinute?: number | null;
  allowedScopes?: string[] | null;
  reason: string;
}

/**
 * Create or update a customer's API access policy, recording an audit event.
 * `allowedScopes: null` restores the full read ceiling; an explicit array is
 * narrowed to the issuable read scopes so a ceiling can never grant more than
 * the platform allows.
 */
export async function updateCustomerApiSettings(adminId: number, userId: number, input: UpdateCustomerApiSettingsInput): Promise<CustomerApiSettingsView> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available.");
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5 || reason.length > 500) throw new ApiAccessPolicyError("Provide an audit reason of 5–500 characters.");

  const allowedScopes = input.allowedScopes == null ? null : narrowToReadScopes(input.allowedScopes);
  if (allowedScopes !== null && allowedScopes.length === 0) {
    throw new ApiAccessPolicyError("The scope ceiling must list at least one scope, or be left empty for the full read ceiling.");
  }
  const defaultRateLimitPerMinute = input.defaultRateLimitPerMinute == null
    ? null
    : Math.max(1, Math.min(100_000, Math.trunc(input.defaultRateLimitPerMinute)));

  const current = await getCustomerApiSettings(userId);
  const now = new Date();
  if (current) {
    await db.update(customerApiSettings).set({
      apiEnabled: input.apiEnabled ?? current.apiEnabled,
      defaultRateLimitPerMinute: input.defaultRateLimitPerMinute === undefined ? current.defaultRateLimitPerMinute : defaultRateLimitPerMinute,
      allowedScopes: input.allowedScopes === undefined ? current.allowedScopes : allowedScopes,
      updatedBy: adminId,
      updatedAt: now,
    }).where(eq(customerApiSettings.userId, userId));
  } else {
    await db.insert(customerApiSettings).values({
      userId,
      apiEnabled: input.apiEnabled ?? true,
      defaultRateLimitPerMinute,
      allowedScopes,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.insert(v5AuditEvents).values({
    actorUserId: adminId,
    action: current ? "customer_api.settings_updated" : "customer_api.settings_created",
    entityType: "customer_api_settings",
    entityId: String(userId),
    reason,
    reference: `customer-api-settings:${userId}`,
    metadataJson: JSON.stringify({ old: current, next: { apiEnabled: input.apiEnabled ?? current?.apiEnabled ?? true, defaultRateLimitPerMinute, allowedScopes } }),
  });

  const saved = await getCustomerApiSettings(userId);
  if (!saved) throw new ApiAccessPolicyError("The policy was written but could not be read back.");
  return saved;
}
