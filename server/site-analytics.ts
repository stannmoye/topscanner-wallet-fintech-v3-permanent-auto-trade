import { sql } from "drizzle-orm";
import { getDb, getRawDbPool } from "./db";

/** Cookie name that carries the first-party, anonymous visitor key. */
export const VISITOR_COOKIE = "arb_visitor";

export type AnalyticsEventType = "visit" | "login" | "signup";

export type RecordAnalyticsEventInput = {
  eventType: AnalyticsEventType;
  visitorKey?: string | null;
  userId?: number | null;
  countryCode?: string | null;
  source?: string | null;
  path?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  at?: Date;
};

export type VisitorAnalyticsTotals = {
  visits: number;
  uniqueVisitors: number;
  logins: number;
  uniqueLogins: number;
  signups: number;
  uniqueSignups: number;
};

export type VisitorAnalyticsDayRow = VisitorAnalyticsTotals & { eventDate: string };

export type VisitorAnalyticsCountryRow = {
  countryCode: string | null;
  visits: number;
  uniqueVisitors: number;
  logins: number;
  signups: number;
};

export type VisitorAnalyticsReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  range: { days: number; startDate: string; endDate: string };
  totals: VisitorAnalyticsTotals;
  today: VisitorAnalyticsTotals;
  yesterday: VisitorAnalyticsTotals;
  daily: VisitorAnalyticsDayRow[];
  countries: VisitorAnalyticsCountryRow[];
};

const EMPTY_TOTALS: VisitorAnalyticsTotals = {
  visits: 0,
  uniqueVisitors: 0,
  logins: 0,
  uniqueLogins: 0,
  signups: 0,
  uniqueSignups: 0,
};

const MAX_RANGE_DAYS = 180;
const MAX_COUNTRIES = 50;
const MAX_COOKIE_KEY_LENGTH = 64;

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey: string, delta: number): string {
  const date = new Date(dateKey + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + delta);
  return utcDateKey(date);
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Normalise an arbitrary visitor key to the stored column shape, or null. */
export function normalizeVisitorKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_COOKIE_KEY_LENGTH) return null;
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR";
}

/** Additive first-party analytics table; it lives outside the Drizzle schema. */
export const SITE_ANALYTICS_TABLE = "site_analytics_events";

const CREATE_ANALYTICS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS site_analytics_events (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  eventType VARCHAR(16) NOT NULL,
  eventDate VARCHAR(10) NOT NULL,
  visitorKey VARCHAR(64) NULL,
  userId INT NULL,
  countryCode VARCHAR(8) NULL,
  source VARCHAR(24) NULL,
  path VARCHAR(255) NULL,
  userAgent VARCHAR(255) NULL,
  ipAddress VARCHAR(128) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX site_analytics_event_date_type_idx (eventDate, eventType),
  INDEX site_analytics_country_date_idx (countryCode, eventDate),
  INDEX site_analytics_visitor_date_idx (visitorKey, eventDate),
  INDEX site_analytics_user_type_idx (userId, eventType)
) ENGINE=InnoDB`;

/**
 * Create the additive first-party analytics table when it is missing. Managed
 * hosts start the application directly from `dist/index.js`, which does not run
 * the external schema-repair startup wrapper, so the server must guarantee its
 * own analytics storage. Deliberately never throws: a missing table only means
 * the administrator dashboard reports that storage is unavailable.
 */
export async function ensureVisitorAnalyticsSchema(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const pool = await getRawDbPool();
    if (!pool) return;
    const [tables] = await pool.query<any[]>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
      [SITE_ANALYTICS_TABLE],
    );
    if (tables.length) return;
    await pool.query(CREATE_ANALYTICS_TABLE_SQL);
    console.log("[Analytics] Created site_analytics_events for the administrator dashboard.");
  } catch (error) {
    console.error("[Analytics] Failed to ensure analytics schema:", error instanceof Error ? error.name : "UnknownError");
  }
}

function totalsFromRow(row: Record<string, unknown> | undefined): VisitorAnalyticsTotals {
  if (!row) return { ...EMPTY_TOTALS };
  return {
    visits: toNumber(row.visits),
    uniqueVisitors: toNumber(row.uniqueVisitors),
    logins: toNumber(row.logins),
    uniqueLogins: toNumber(row.uniqueLogins),
    signups: toNumber(row.signups),
    uniqueSignups: toNumber(row.uniqueSignups),
  };
}

const TOTALS_SELECT = sql`
  SUM(CASE WHEN eventType='visit' THEN 1 ELSE 0 END) AS visits,
  COUNT(DISTINCT CASE WHEN eventType='visit' THEN visitorKey END) AS uniqueVisitors,
  SUM(CASE WHEN eventType='login' THEN 1 ELSE 0 END) AS logins,
  COUNT(DISTINCT CASE WHEN eventType='login' THEN userId END) AS uniqueLogins,
  SUM(CASE WHEN eventType='signup' THEN 1 ELSE 0 END) AS signups,
  COUNT(DISTINCT CASE WHEN eventType='signup' THEN userId END) AS uniqueSignups`;

/**
 * Persist one analytics event. Deliberately never throws: analytics must never
 * break authentication, registration or a page load, and it must fail quietly
 * when the additive table has not been installed on this host yet.
 */
export async function recordAnalyticsEvent(input: RecordAnalyticsEventInput): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const db = await getDb();
    if (!db) return;
    const at = input.at instanceof Date && !Number.isNaN(input.at.getTime()) ? input.at : new Date();
    const visitorKey = normalizeVisitorKey(input.visitorKey ?? null);
    // Format the UTC timestamp explicitly so the stored DATETIME(3) value never
    // drifts with the pool's timezone handling.
    const createdAt = at.toISOString().slice(0, 23).replace("T", " ");
    await db.execute(sql`INSERT INTO site_analytics_events
      (eventType,eventDate,visitorKey,userId,countryCode,source,path,userAgent,ipAddress,createdAt)
      VALUES (${input.eventType},${utcDateKey(at)},${visitorKey},${input.userId ?? null},${input.countryCode ?? null},${input.source ?? null},${input.path ? input.path.slice(0, 255) : null},${input.userAgent ? input.userAgent.slice(0, 255) : null},${input.ipAddress ?? null},${createdAt})`);
  } catch (error) {
    if (isMissingTableError(error)) return;
    console.error("[Analytics] Failed to record event:", error instanceof Error ? error.name : "UnknownError");
  }
}

async function aggregateRange(startDate: string, endDate: string): Promise<{ totals: VisitorAnalyticsTotals; daily: VisitorAnalyticsDayRow[] }> {
  const db = await getDb();
  if (!db) return { totals: { ...EMPTY_TOTALS }, daily: [] };
  const totalsResult = await db.execute(sql`SELECT ${TOTALS_SELECT} FROM site_analytics_events WHERE eventDate BETWEEN ${startDate} AND ${endDate}`);
  const totalsRows = ((totalsResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
  const dailyResult = await db.execute(sql`SELECT eventDate, ${TOTALS_SELECT} FROM site_analytics_events WHERE eventDate BETWEEN ${startDate} AND ${endDate} GROUP BY eventDate ORDER BY eventDate ASC`);
  const dailyRows = ((dailyResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
  return {
    totals: totalsFromRow(totalsRows[0]),
    daily: dailyRows.map((row) => ({ eventDate: String(row.eventDate ?? ""), ...totalsFromRow(row) })),
  };
}

async function aggregateCountries(startDate: string, endDate: string, limit: number): Promise<VisitorAnalyticsCountryRow[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`SELECT countryCode,
      SUM(CASE WHEN eventType='visit' THEN 1 ELSE 0 END) AS visits,
      COUNT(DISTINCT CASE WHEN eventType='visit' THEN visitorKey END) AS uniqueVisitors,
      SUM(CASE WHEN eventType='login' THEN 1 ELSE 0 END) AS logins,
      SUM(CASE WHEN eventType='signup' THEN 1 ELSE 0 END) AS signups
    FROM site_analytics_events
    WHERE eventDate BETWEEN ${startDate} AND ${endDate}
    GROUP BY countryCode
    ORDER BY visits DESC, logins DESC
    LIMIT ${sql.raw(String(limit))}`);
  const rows = ((result as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
  return rows.map((row) => ({
    countryCode: row.countryCode ? String(row.countryCode) : null,
    visits: toNumber(row.visits),
    uniqueVisitors: toNumber(row.uniqueVisitors),
    logins: toNumber(row.logins),
    signups: toNumber(row.signups),
  }));
}

/** Build the full administrator performance report for the trailing `days` window. */
export async function getVisitorAnalyticsReport(days: number, countryLimit = 12): Promise<VisitorAnalyticsReport> {
  const safeDays = Number.isFinite(days) ? Math.min(MAX_RANGE_DAYS, Math.max(1, Math.trunc(days))) : 30;
  const safeCountryLimit = Number.isFinite(countryLimit) ? Math.min(MAX_COUNTRIES, Math.max(1, Math.trunc(countryLimit))) : 12;
  const endDate = utcDateKey(new Date());
  const startDate = addUtcDays(endDate, -(safeDays - 1));
  const yesterday = addUtcDays(endDate, -1);
  const base: VisitorAnalyticsReport = {
    sourceAvailable: true,
    generatedAt: new Date().toISOString(),
    range: { days: safeDays, startDate, endDate },
    totals: { ...EMPTY_TOTALS },
    today: { ...EMPTY_TOTALS },
    yesterday: { ...EMPTY_TOTALS },
    daily: [],
    countries: [],
  };
  try {
    const window = await aggregateRange(startDate, endDate);
    const recent = await aggregateRange(yesterday, endDate);
    const countries = await aggregateCountries(startDate, endDate, safeCountryLimit);
    const recentByDate = new Map(recent.daily.map((row) => [row.eventDate, row]));
    return {
      ...base,
      totals: window.totals,
      daily: window.daily,
      today: recentByDate.get(endDate) ? { ...recentByDate.get(endDate)! } : { ...EMPTY_TOTALS },
      yesterday: recentByDate.get(yesterday) ? { ...recentByDate.get(yesterday)! } : { ...EMPTY_TOTALS },
      countries,
    };
  } catch (error) {
    if (isMissingTableError(error)) return { ...base, sourceAvailable: false };
    console.error("[Analytics] Failed to build visitor analytics report:", error instanceof Error ? error.name : "UnknownError");
    return { ...base, sourceAvailable: false };
  }
}
