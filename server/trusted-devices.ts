import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { deviceAccessEvents, trustedDevices, users } from "../drizzle/schema";

export type DeviceStatus = "trusted" | "pending" | "blocked";
export type DeviceActorRole = "customer" | "admin" | "system";

export type DeviceInput = {
  deviceKey?: string;
  deviceName?: string;
  deviceType?: string;
  platform?: string;
  browser?: string;
};

export type DeviceContext = {
  deviceKey: string;
  deviceName: string;
  deviceType: string;
  platform: string;
  browser: string;
  userAgent?: string;
  ipAddress?: string;
  countryCode?: string;
};

const DEVICE_KEY_SOURCE_MIN = 8;

/** The pseudo device ID never embeds a hardware address: browsers do not expose MACs. */
export function deriveDeviceKey(userId: number, rawFingerprint: string | undefined, userAgent: string | undefined): string {
  const fingerprint = typeof rawFingerprint === "string" ? rawFingerprint.trim() : "";
  const source = fingerprint.length >= DEVICE_KEY_SOURCE_MIN ? fingerprint : `user-agent:${userAgent || "unknown"}`;
  return crypto.createHash("sha256").update(`${userId}:${source}`).digest("hex");
}

/** Best-effort user-agent interpretation. The client may override the name entirely. */
export function describeUserAgent(userAgent: string | undefined): { deviceType: string; platform: string; browser: string } {
  const ua = (userAgent || "").toLowerCase();
  const deviceType = /ipad|tablet|playbook|silk/.test(ua)
    ? "tablet"
    : /mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)
      ? "mobile"
      : ua
        ? "desktop"
        : "unknown";
  let platform = "Unknown";
  if (/windows nt 10/.test(ua)) platform = "Windows 10/11";
  else if (/windows/.test(ua)) platform = "Windows";
  else if (/iphone|ipad|ipod/.test(ua)) platform = "iOS";
  else if (/android/.test(ua)) platform = "Android";
  else if (/mac os x|macintosh/.test(ua)) platform = "macOS";
  else if (/cros/.test(ua)) platform = "ChromeOS";
  else if (/linux/.test(ua)) platform = "Linux";
  let browser = "Browser";
  if (/edg\//.test(ua)) browser = "Microsoft Edge";
  else if (/opr\/|opera/.test(ua)) browser = "Opera";
  else if (/chrome\//.test(ua) && !/chromium/.test(ua)) browser = "Chrome";
  else if (/firefox\//.test(ua)) browser = "Firefox";
  else if (/safari\//.test(ua)) browser = "Safari";
  return { deviceType, platform, browser };
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Build the canonical device identity for a request. The client fingerprint is
 * preferred; it is combined with the account so two customers on the same
 * physical device never share a registry row.
 */
export function buildDeviceContext(
  userId: number,
  device: DeviceInput | undefined,
  request: { userAgent?: string; ipAddress?: string; countryCode?: string },
): DeviceContext {
  const userAgent = clampText(request.userAgent, 1000);
  const described = describeUserAgent(userAgent);
  const deviceKey = deriveDeviceKey(userId, device?.deviceKey, userAgent);
  const providedName = clampText(device?.deviceName, 120);
  const providedType = clampText(device?.deviceType, 32);
  const providedPlatform = clampText(device?.platform, 64);
  const providedBrowser = clampText(device?.browser, 64);
  return {
    deviceKey,
    deviceName: providedName || `${providedBrowser || described.browser} on ${providedPlatform || described.platform}`,
    deviceType: providedType || described.deviceType,
    platform: providedPlatform || described.platform,
    browser: providedBrowser || described.browser,
    userAgent,
    ipAddress: clampText(request.ipAddress, 128),
    countryCode: clampText(request.countryCode, 8),
  };
}

export async function isDeviceBlocked(userId: number, deviceKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db
    .select({ status: trustedDevices.status })
    .from(trustedDevices)
    .where(and(eq(trustedDevices.userId, userId), eq(trustedDevices.deviceKey, deviceKey)))
    .limit(1);
  return rows[0]?.status === "blocked";
}

export async function findDeviceByKey(userId: number, deviceKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db
    .select()
    .from(trustedDevices)
    .where(and(eq(trustedDevices.userId, userId), eq(trustedDevices.deviceKey, deviceKey)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Register or refresh a device after a successful sign-in. Returns the device
 * row and whether this was the first time the account used it.
 */
export async function recordDeviceLogin(
  userId: number,
  context: DeviceContext,
): Promise<{ id: number; deviceKey: string; isNew: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const existing = await findDeviceByKey(userId, context.deviceKey);
  if (existing) {
    await db
      .update(trustedDevices)
      .set({
        lastSeenAt: new Date(),
        lastIpAddress: context.ipAddress ?? existing.lastIpAddress,
        userAgent: context.userAgent ?? existing.userAgent,
        deviceType: context.deviceType,
        platform: context.platform,
        browser: context.browser,
        ...(existing.deviceName === "Unknown device" ? { deviceName: context.deviceName } : {}),
        ...(context.countryCode ? { countryCode: context.countryCode } : {}),
        loginCount: sql`${trustedDevices.loginCount} + 1`,
      })
      .where(eq(trustedDevices.id, existing.id));
    return { id: existing.id, deviceKey: context.deviceKey, isNew: false };
  }
  const result = await db.insert(trustedDevices).values({
    userId,
    deviceKey: context.deviceKey,
    deviceName: context.deviceName,
    deviceType: context.deviceType,
    platform: context.platform,
    browser: context.browser,
    userAgent: context.userAgent,
    firstIpAddress: context.ipAddress,
    lastIpAddress: context.ipAddress,
    countryCode: context.countryCode,
    status: "trusted",
    loginCount: 1,
  });
  return { id: Number(result[0].insertId), deviceKey: context.deviceKey, isNew: true };
}

export async function logDeviceEvent(
  userId: number,
  input: {
    deviceKey?: string | null;
    deviceName?: string | null;
    action: string;
    actorRole?: DeviceActorRole;
    actorId?: number | null;
    detail?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(deviceAccessEvents).values({
    userId,
    deviceKey: input.deviceKey ? clampText(input.deviceKey, 96) ?? null : null,
    deviceName: input.deviceName ? clampText(input.deviceName, 120) ?? null : null,
    action: clampText(input.action, 40) ?? "event",
    actorRole: input.actorRole ?? "customer",
    actorId: input.actorId ?? null,
    detail: clampText(input.detail, 500) ?? null,
    ipAddress: input.ipAddress ? clampText(input.ipAddress, 128) ?? null : null,
    userAgent: input.userAgent ? clampText(input.userAgent, 1000) ?? null : null,
  });
}

/** Audit logging must never block an authoritative security action. */
export async function safeLogDeviceEvent(userId: number, input: Parameters<typeof logDeviceEvent>[1]): Promise<void> {
  try {
    await logDeviceEvent(userId, input);
  } catch (error) {
    console.error("[TrustedDevices] Audit event failed:", error instanceof Error ? error.name : "UnknownError");
  }
}

export async function listTrustedDevices(userId: number, currentDeviceKey?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db
    .select()
    .from(trustedDevices)
    .where(eq(trustedDevices.userId, userId))
    .orderBy(desc(trustedDevices.lastSeenAt));
  const devices = rows.map((row) => ({
    ...row,
    isCurrent: Boolean(currentDeviceKey && row.deviceKey === currentDeviceKey),
    deviceIdShort: row.deviceKey.slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join("-") ?? row.deviceKey,
  }));
  const summary = {
    total: devices.length,
    trusted: devices.filter((device) => device.status === "trusted").length,
    blocked: devices.filter((device) => device.status === "blocked").length,
    pending: devices.filter((device) => device.status === "pending").length,
  };
  return { devices, summary };
}

export async function renameDevice(userId: number, id: number, deviceName: string, actorRole: DeviceActorRole): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const name = clampText(deviceName, 120);
  if (!name) throw new Error("Device name is required");
  const target = await getOwnedDevice(userId, id);
  await db.update(trustedDevices).set({ deviceName: name }).where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId)));
  await safeLogDeviceEvent(userId, {
    deviceKey: target.deviceKey,
    deviceName: name,
    action: "renamed",
    actorRole,
    detail: `Device renamed to "${name}"`,
  });
}

export async function getOwnedDevice(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db
    .select()
    .from(trustedDevices)
    .where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId)))
    .limit(1);
  const device = rows[0];
  if (!device) throw new Error("Device not found");
  return device;
}

/**
 * Block a device. Every session token that carries this device's key is rejected
 * on the next request (see createContext), so blocking expires the device's live
 * sessions and prevents it from signing in again until it is restored.
 */
export async function blockDevice(
  userId: number,
  id: number,
  input: { reason: string; actorRole: DeviceActorRole; actorId?: number | null; ipAddress?: string | null; userAgent?: string | null },
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const target = await getOwnedDevice(userId, id);
  const reason = clampText(input.reason, 255) ?? "Blocked by account owner";
  await db
    .update(trustedDevices)
    .set({ status: "blocked", blockedBy: input.actorRole === "admin" ? "admin" : "customer", blockedReason: reason, blockedAt: new Date() })
    .where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId)));
  await safeLogDeviceEvent(userId, {
    deviceKey: target.deviceKey,
    deviceName: target.deviceName,
    action: "blocked",
    actorRole: input.actorRole,
    actorId: input.actorId ?? null,
    detail: reason,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
  return { ...target, status: "blocked" as DeviceStatus, blockedReason: reason };
}

/** Restore a blocked device. Used by the admin device-oversight queue. */
export async function restoreDevice(
  userId: number,
  id: number,
  input: { note?: string; actorRole: DeviceActorRole; actorId?: number | null },
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const target = await getOwnedDevice(userId, id);
  await db
    .update(trustedDevices)
    .set({ status: "trusted", blockedBy: null, blockedReason: null, blockedAt: null, restoredAt: new Date() })
    .where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId)));
  await safeLogDeviceEvent(userId, {
    deviceKey: target.deviceKey,
    deviceName: target.deviceName,
    action: "restored",
    actorRole: input.actorRole,
    actorId: input.actorId ?? null,
    detail: clampText(input.note, 500) ?? "Device restored",
  });
  return { ...target, status: "trusted" as DeviceStatus };
}

export async function listDeviceEvents(userId: number, limit = 40) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const capped = Math.min(Math.max(Math.trunc(limit) || 40, 1), 100);
  return db
    .select()
    .from(deviceAccessEvents)
    .where(eq(deviceAccessEvents.userId, userId))
    .orderBy(desc(deviceAccessEvents.createdAt))
    .limit(capped);
}

// ---------------------------------------------------------------------------
// Admin oversight
// ---------------------------------------------------------------------------

export async function listBlockedDevicesForAdmin() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db
    .select({
      id: trustedDevices.id,
      userId: trustedDevices.userId,
      deviceKey: trustedDevices.deviceKey,
      deviceName: trustedDevices.deviceName,
      deviceType: trustedDevices.deviceType,
      platform: trustedDevices.platform,
      browser: trustedDevices.browser,
      lastIpAddress: trustedDevices.lastIpAddress,
      countryCode: trustedDevices.countryCode,
      status: trustedDevices.status,
      blockedBy: trustedDevices.blockedBy,
      blockedReason: trustedDevices.blockedReason,
      blockedAt: trustedDevices.blockedAt,
      lastSeenAt: trustedDevices.lastSeenAt,
      loginCount: trustedDevices.loginCount,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(trustedDevices)
    .leftJoin(users, eq(users.id, trustedDevices.userId))
    .where(eq(trustedDevices.status, "blocked"))
    .orderBy(desc(trustedDevices.blockedAt));
  return rows;
}

export async function listDevicesForAdmin(limit = 200) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const capped = Math.min(Math.max(Math.trunc(limit) || 200, 1), 500);
  return db
    .select({
      id: trustedDevices.id,
      userId: trustedDevices.userId,
      deviceKey: trustedDevices.deviceKey,
      deviceName: trustedDevices.deviceName,
      deviceType: trustedDevices.deviceType,
      platform: trustedDevices.platform,
      browser: trustedDevices.browser,
      lastIpAddress: trustedDevices.lastIpAddress,
      status: trustedDevices.status,
      blockedBy: trustedDevices.blockedBy,
      blockedReason: trustedDevices.blockedReason,
      blockedAt: trustedDevices.blockedAt,
      lastSeenAt: trustedDevices.lastSeenAt,
      loginCount: trustedDevices.loginCount,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(trustedDevices)
    .leftJoin(users, eq(users.id, trustedDevices.userId))
    .orderBy(desc(trustedDevices.lastSeenAt))
    .limit(capped);
}

export async function getDeviceOversightSummary() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const totals = await db
    .select({
      total: sql<number>`COUNT(*)`,
      blocked: sql<number>`COALESCE(SUM(CASE WHEN ${trustedDevices.status} = 'blocked' THEN 1 ELSE 0 END), 0)`,
      pending: sql<number>`COALESCE(SUM(CASE WHEN ${trustedDevices.status} = 'pending' THEN 1 ELSE 0 END), 0)`,
      trusted: sql<number>`COALESCE(SUM(CASE WHEN ${trustedDevices.status} = 'trusted' THEN 1 ELSE 0 END), 0)`,
    })
    .from(trustedDevices);
  const blockedCustomers = await db
    .select({ userId: trustedDevices.userId })
    .from(trustedDevices)
    .where(eq(trustedDevices.status, "blocked"))
    .groupBy(trustedDevices.userId);
  const row = totals[0];
  return {
    total: Number(row?.total ?? 0),
    blocked: Number(row?.blocked ?? 0),
    pending: Number(row?.pending ?? 0),
    trusted: Number(row?.trusted ?? 0),
    customersWithBlockedDevices: blockedCustomers.length,
  };
}

export async function getDevicesForAdminByIds(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  if (!ids.length) return [];
  return db.select().from(trustedDevices).where(inArray(trustedDevices.id, ids));
}

export async function adminRestoreDevice(adminId: number, id: number, note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(trustedDevices).where(eq(trustedDevices.id, id)).limit(1);
  const device = rows[0];
  if (!device) throw new Error("Device not found");
  await db
    .update(trustedDevices)
    .set({ status: "trusted", blockedBy: null, blockedReason: null, blockedAt: null, restoredAt: new Date() })
    .where(eq(trustedDevices.id, id));
  await safeLogDeviceEvent(device.userId, {
    deviceKey: device.deviceKey,
    deviceName: device.deviceName,
    action: "restored",
    actorRole: "admin",
    actorId: adminId,
    detail: clampText(note, 500) ?? "Restored by administrator",
  });
  return { ...device, status: "trusted" as DeviceStatus };
}
