import { sql } from "drizzle-orm";
import { getDb, getRawDbPool } from "./db";

/**
 * Sign-in activity log.
 *
 * Every successful customer and administrator sign-in (and every customer
 * registration) is recorded here so the administrator console can show all
 * sign-in activity for all customers. The log is deliberately short-lived:
 * records older than {@link SIGN_IN_ACTIVITY_RETENTION_DAYS} are automatically
 * cleared by {@link purgeSignInActivity}, which removes the rows entirely so no
 * residual data is left behind in the system.
 *
 * The table is additive and lives outside the Drizzle schema, mirroring the
 * first-party `site_analytics_events` table. It is created lazily and the record
 * helper never throws, because sign-in activity must never break authentication.
 */

/** How long sign-in activity is retained before it is automatically cleared. */
export const SIGN_IN_ACTIVITY_RETENTION_DAYS = 7;

/** Additive sign-in activity table; it lives outside the Drizzle schema. */
export const SIGN_IN_ACTIVITY_TABLE = "sign_in_activity_events";

/** The kinds of sign-in activity that are recorded. */
export type SignInActivityEventType = "login" | "signup";

export type RecordSignInActivityInput = {
  userId?: number | null;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  eventType: SignInActivityEventType;
  source?: string | null;
  deviceName?: string | null;
  deviceKey?: string | null;
  countryCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  at?: Date;
};

export type SignInActivityEntry = {
  id: number;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  eventType: string;
  source: string | null;
  deviceName: string | null;
  countryCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type SignInActivitySummary = {
  total: number;
  logins: number;
  signups: number;
  distinctCustomers: number;
  today: number;
  last24h: number;
};

export type SignInActivityReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  retentionDays: number;
  windowStart: string;
  summary: SignInActivitySummary;
  entries: SignInActivityEntry[];
};

export type SignInActivityPurgeResult = {
  deleted: number;
  retentionDays: number;
  cutoff: string;
};

const EMPTY_SUMMARY: SignInActivitySummary = {
  total: 0,
  logins: 0,
  signups: 0,
  distinctCustomers: 0,
  today: 0,
  last24h: 0,
};

const MAX_ENTRIES = 500;
const DEFAULT_ENTRIES = 200;

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Format a UTC timestamp explicitly so the stored/compared DATETIME(3) never drifts with the pool timezone. */
function utcStamp(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR";
}

const CREATE_SIGN_IN_ACTIVITY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sign_in_activity_events (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId INT NULL,
  userName VARCHAR(255) NULL,
  userEmail VARCHAR(255) NULL,
  userRole VARCHAR(16) NULL,
  eventType VARCHAR(16) NOT NULL,
  source VARCHAR(16) NULL,
  deviceName VARCHAR(120) NULL,
  deviceKey VARCHAR(64) NULL,
  countryCode VARCHAR(8) NULL,
  ipAddress VARCHAR(128) NULL,
  userAgent VARCHAR(255) NULL,
  eventDate VARCHAR(10) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX sign_in_activity_created_idx (createdAt),
  INDEX sign_in_activity_user_created_idx (userId, createdAt),
  INDEX sign_in_activity_event_date_idx (eventDate)
) ENGINE=InnoDB`;

/**
 * Create the additive sign-in activity table when it is missing. Managed hosts
 * start the application directly from `dist/index.js`, which does not run the
 * external schema-repair startup wrapper, so the server must guarantee its own
 * storage. Deliberately never throws: a missing table only means the
 * administrator console reports that storage is unavailable.
 */
export async function ensureSignInActivitySchema(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const pool = await getRawDbPool();
    if (!pool) return;
    const [tables] = await pool.query<any[]>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
      [SIGN_IN_ACTIVITY_TABLE],
    );
    if (tables.length) return;
    await pool.query(CREATE_SIGN_IN_ACTIVITY_TABLE_SQL);
    console.log("[SignInActivity] Created sign_in_activity_events for the administrator console.");
  } catch (error) {
    console.error("[SignInActivity] Failed to ensure schema:", error instanceof Error ? error.name : "UnknownError");
  }
}

/**
 * Persist one sign-in activity row. Deliberately never throws: recording a
 * sign-in must never break authentication, and it fails quietly when the
 * additive table has not been installed on this host yet.
 */
export async function recordSignInActivity(input: RecordSignInActivityInput): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const db = await getDb();
    if (!db) return;
    const at = input.at instanceof Date && !Number.isNaN(input.at.getTime()) ? input.at : new Date();
    const createdAt = utcStamp(at);
    await db.execute(sql`INSERT INTO sign_in_activity_events
      (userId,userName,userEmail,userRole,eventType,source,deviceName,deviceKey,countryCode,ipAddress,userAgent,eventDate,createdAt)
      VALUES (${input.userId ?? null},${input.userName ? input.userName.slice(0, 255) : null},${input.userEmail ? input.userEmail.slice(0, 255) : null},${input.userRole ?? null},${input.eventType},${input.source ?? null},${input.deviceName ? input.deviceName.slice(0, 120) : null},${input.deviceKey ? input.deviceKey.slice(0, 64) : null},${input.countryCode ?? null},${input.ipAddress ?? null},${input.userAgent ? input.userAgent.slice(0, 255) : null},${utcDateKey(at)},${createdAt})`);
  } catch (error) {
    if (isMissingTableError(error)) return;
    console.error("[SignInActivity] Failed to record event:", error instanceof Error ? error.name : "UnknownError");
  }
}

/**
 * Delete every sign-in activity row older than the retention window so the
 * system stays free of stale sign-in logs and residue. Runs automatically on a
 * fixed schedule and once at boot. Never throws: a purge failure is logged and
 * retried on the next cycle.
 */
export async function purgeSignInActivity(olderThanDays: number = SIGN_IN_ACTIVITY_RETENTION_DAYS): Promise<SignInActivityPurgeResult> {
  const retentionDays = Number.isFinite(olderThanDays) ? Math.max(1, Math.trunc(olderThanDays)) : SIGN_IN_ACTIVITY_RETENTION_DAYS;
  const cutoff = utcStamp(new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000));
  try {
    if (!process.env.DATABASE_URL) return { deleted: 0, retentionDays, cutoff };
    const pool = await getRawDbPool();
    if (!pool) return { deleted: 0, retentionDays, cutoff };
    const [result] = await pool.query<any>("DELETE FROM sign_in_activity_events WHERE createdAt < ?", [cutoff]);
    return { deleted: Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0), retentionDays, cutoff };
  } catch (error) {
    if (isMissingTableError(error)) return { deleted: 0, retentionDays, cutoff };
    console.error("[SignInActivity] Failed to purge expired sign-in activity:", error instanceof Error ? error.name : "UnknownError");
    return { deleted: 0, retentionDays, cutoff };
  }
}

function toEntry(row: Record<string, unknown>): SignInActivityEntry {
  return {
    id: toNumber(row.id),
    userId: row.userId == null ? null : toNumber(row.userId),
    userName: row.userName == null ? null : String(row.userName),
    userEmail: row.userEmail == null ? null : String(row.userEmail),
    userRole: row.userRole == null ? null : String(row.userRole),
    eventType: String(row.eventType ?? ""),
    source: row.source == null ? null : String(row.source),
    deviceName: row.deviceName == null ? null : String(row.deviceName),
    countryCode: row.countryCode == null ? null : String(row.countryCode),
    ipAddress: row.ipAddress == null ? null : String(row.ipAddress),
    userAgent: row.userAgent == null ? null : String(row.userAgent),
    createdAt: row.createdAt == null ? "" : String(row.createdAt),
  };
}

function summaryFromRow(row: Record<string, unknown> | undefined): SignInActivitySummary {
  if (!row) return { ...EMPTY_SUMMARY };
  return {
    total: toNumber(row.total),
    logins: toNumber(row.logins),
    signups: toNumber(row.signups),
    distinctCustomers: toNumber(row.distinctCustomers),
    today: toNumber(row.today),
    last24h: toNumber(row.last24h),
  };
}

/**
 * Build the customer's own sign-in activity report for the trailing retention
 * window: a count summary plus their most recent sign-ins, newest first. This
 * never returns another customer's data.
 */
export async function getCustomerSignInActivity(userId: number, limit: number = DEFAULT_ENTRIES): Promise<SignInActivityReport> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    const now = new Date();
    return {
      sourceAvailable: true,
      generatedAt: now.toISOString(),
      retentionDays: SIGN_IN_ACTIVITY_RETENTION_DAYS,
      windowStart: utcStamp(new Date(now.getTime() - SIGN_IN_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
      summary: { ...EMPTY_SUMMARY },
      entries: [],
    };
  }
  const safeLimit = Number.isFinite(limit) ? Math.min(MAX_ENTRIES, Math.max(1, Math.trunc(limit))) : DEFAULT_ENTRIES;
  const now = new Date();
  const windowStart = utcStamp(new Date(now.getTime() - SIGN_IN_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  const last24hCutoff = utcStamp(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const base: SignInActivityReport = {
    sourceAvailable: true,
    generatedAt: now.toISOString(),
    retentionDays: SIGN_IN_ACTIVITY_RETENTION_DAYS,
    windowStart,
    summary: { ...EMPTY_SUMMARY },
    entries: [],
  };
  try {
    const db = await getDb();
    if (!db) return { ...base, sourceAvailable: false };
    const summaryResult = await db.execute(sql`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN eventType='login' THEN 1 ELSE 0 END) AS logins,
        SUM(CASE WHEN eventType='signup' THEN 1 ELSE 0 END) AS signups,
        COUNT(DISTINCT userId) AS distinctCustomers,
        SUM(CASE WHEN eventDate=${utcDateKey(now)} THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN createdAt >= ${last24hCutoff} THEN 1 ELSE 0 END) AS last24h
      FROM sign_in_activity_events
      WHERE userId=${userId} AND createdAt >= ${windowStart}`);
    const summaryRows = ((summaryResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    const entriesResult = await db.execute(sql`SELECT
        id,userId,userName,userEmail,userRole,eventType,source,deviceName,countryCode,ipAddress,userAgent,
        DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.000Z') AS createdAt
      FROM sign_in_activity_events
      WHERE userId=${userId} AND createdAt >= ${windowStart}
      ORDER BY createdAt DESC, id DESC
      LIMIT ${safeLimit}`);
    const entryRows = ((entriesResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    return {
      ...base,
      summary: summaryFromRow(summaryRows[0]),
      entries: entryRows.map(toEntry),
    };
  } catch (error) {
    if (isMissingTableError(error)) return { ...base, sourceAvailable: false };
    console.error("[SignInActivity] Failed to build customer report:", error instanceof Error ? error.name : "UnknownError");
    return { ...base, sourceAvailable: false };
  }
}

/**
 * Build the administrator sign-in activity report for the trailing retention
 * window: a count summary plus the most recent entries, newest first.
 */
export async function getSignInActivityReport(limit: number = DEFAULT_ENTRIES): Promise<SignInActivityReport> {
  const safeLimit = Number.isFinite(limit) ? Math.min(MAX_ENTRIES, Math.max(1, Math.trunc(limit))) : DEFAULT_ENTRIES;
  const now = new Date();
  const windowStart = utcStamp(new Date(now.getTime() - SIGN_IN_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  const last24hCutoff = utcStamp(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const base: SignInActivityReport = {
    sourceAvailable: true,
    generatedAt: now.toISOString(),
    retentionDays: SIGN_IN_ACTIVITY_RETENTION_DAYS,
    windowStart,
    summary: { ...EMPTY_SUMMARY },
    entries: [],
  };
  try {
    const db = await getDb();
    if (!db) return { ...base, sourceAvailable: false };
    const summaryResult = await db.execute(sql`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN eventType='login' THEN 1 ELSE 0 END) AS logins,
        SUM(CASE WHEN eventType='signup' THEN 1 ELSE 0 END) AS signups,
        COUNT(DISTINCT CASE WHEN source='customer' THEN userId END) AS distinctCustomers,
        SUM(CASE WHEN eventDate=${utcDateKey(now)} THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN createdAt >= ${last24hCutoff} THEN 1 ELSE 0 END) AS last24h
      FROM sign_in_activity_events
      WHERE createdAt >= ${windowStart}`);
    const summaryRows = ((summaryResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    const entriesResult = await db.execute(sql`SELECT
        id,userId,userName,userEmail,userRole,eventType,source,deviceName,countryCode,ipAddress,userAgent,
        DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.000Z') AS createdAt
      FROM sign_in_activity_events
      WHERE createdAt >= ${windowStart}
      ORDER BY createdAt DESC, id DESC
      LIMIT ${safeLimit}`);
    const entryRows = ((entriesResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    return {
      ...base,
      summary: summaryFromRow(summaryRows[0]),
      entries: entryRows.map(toEntry),
    };
  } catch (error) {
    if (isMissingTableError(error)) return { ...base, sourceAvailable: false };
    console.error("[SignInActivity] Failed to build report:", error instanceof Error ? error.name : "UnknownError");
    return { ...base, sourceAvailable: false };
  }
}
