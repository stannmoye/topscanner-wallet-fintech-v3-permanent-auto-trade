import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, getRawDbPool } from "./db";

/**
 * Application incident log.
 *
 * Persists why the application crashed (uncaught errors, unhandled rejections,
 * startup/boot failures, unexpected exits, out-of-memory terminations and
 * repeated background-worker failures) so the cause is still visible *after* the
 * process has restarted. Rows survive a restart because they are written to the
 * database, not only to stdout/stderr.
 *
 * The table is additive and lives outside the Drizzle schema, mirroring the
 * first-party `sign_in_activity_events` and `site_analytics_events` tables. It is
 * created lazily by {@link ensureIncidentLogSchema} and every write helper never
 * throws, because recording an incident must never become a second fault.
 */

/** How long incident records are retained before they are cleared automatically. */
export const INCIDENT_RETENTION_DAYS = 90;

/** Additive incident table; it lives outside the Drizzle schema. */
export const INCIDENT_LOG_TABLE = "application_incident_events";

/** Stable identifier for the current process boot, used to separate restart sessions. */
export const INCIDENT_BOOT_ID = process.env.ARBITRADE_BOOT_ID?.trim() || randomUUID();

/** When the current process began executing. */
export const INCIDENT_PROCESS_STARTED_AT = new Date();

export type IncidentSeverity = "info" | "warning" | "error" | "fatal";
export type IncidentCategory =
  | "uncaught_exception"
  | "unhandled_rejection"
  | "startup_failure"
  | "unexpected_exit"
  | "resource_exhaustion"
  | "worker_failure"
  | "http_server_error";
export type IncidentProcessRole = "application" | "supervisor" | "system";

export type RecordIncidentInput = {
  severity: IncidentSeverity;
  category: IncidentCategory;
  message: string;
  processRole?: IncidentProcessRole;
  eventCode?: string | null;
  stack?: string | null;
  context?: Record<string, unknown> | null;
  appVersion?: string | null;
  sourceRevision?: string | null;
  instanceId?: string | null;
  bootId?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  occurredAt?: Date;
};

export type IncidentEntry = {
  id: number;
  severity: string;
  category: string;
  processRole: string;
  eventCode: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  appVersion: string | null;
  sourceRevision: string | null;
  instanceId: string | null;
  bootId: string | null;
  exitCode: number | null;
  signal: string | null;
  occurredAt: string;
  isCurrentBoot: boolean;
};

export type IncidentBootSummary = {
  bootId: string | null;
  firstAt: string | null;
  lastAt: string;
  incidents: number;
  fatal: number;
  error: number;
  isCurrent: boolean;
};

export type IncidentSummary = {
  total: number;
  fatal: number;
  error: number;
  warning: number;
  info: number;
  last24h: number;
  last7d: number;
  categories: Record<string, number>;
};

export type IncidentReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  retentionDays: number;
  currentBootId: string;
  currentBootStartedAt: string;
  summary: IncidentSummary;
  boots: IncidentBootSummary[];
  incidents: IncidentEntry[];
};

export type IncidentPurgeResult = { deleted: number; retentionDays: number; cutoff: string };

export type IncidentDeleteResult = { deleted: number };

const EMPTY_SUMMARY: IncidentSummary = {
  total: 0, fatal: 0, error: 0, warning: 0, info: 0, last24h: 0, last7d: 0, categories: {},
};

const MAX_LIST = 500;
const DEFAULT_LIST = 150;
const MAX_RECENT = 400;

const CREATE_INCIDENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS application_incident_events (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  severity VARCHAR(16) NOT NULL,
  category VARCHAR(32) NOT NULL,
  processRole VARCHAR(16) NOT NULL DEFAULT 'application',
  eventCode VARCHAR(64) NULL,
  message VARCHAR(1000) NOT NULL,
  stack TEXT NULL,
  contextJson TEXT NULL,
  appVersion VARCHAR(32) NULL,
  sourceRevision VARCHAR(64) NULL,
  instanceId VARCHAR(64) NULL,
  bootId VARCHAR(64) NULL,
  exitCode INT NULL,
  signal VARCHAR(32) NULL,
  occurredAt DATETIME(3) NOT NULL,
  occurredDate VARCHAR(10) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX incident_created_idx (createdAt),
  INDEX incident_occurred_idx (occurredAt),
  INDEX incident_category_idx (category, occurredAt),
  INDEX incident_severity_idx (severity, occurredAt),
  INDEX incident_boot_idx (bootId)
) ENGINE=InnoDB`;

function utcStamp(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR";
}

/** Redact credentials and collapse whitespace before anything is persisted or shown. */
export function sanitizeIncidentText(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[credentials-redacted]@")
    .replace(/\b(password|passwd|secret|token|authorization|api[_-]?key|credential)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[credential-redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeEventCode(value: unknown): string | null {
  const code = String(value ?? "").replace(/[^A-Z0-9_]/gi, "").slice(0, 64);
  return code || null;
}

function parseContext(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Create the additive incident table when it is missing. Managed hosts start the
 * application directly from `dist/index.js`, which does not run the external
 * schema-repair startup wrapper, so the server must guarantee its own storage.
 * Deliberately never throws: a missing table only means the console reports that
 * incident storage is unavailable.
 */
export async function ensureIncidentLogSchema(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const pool = await getRawDbPool();
    if (!pool) return;
    const [tables] = await pool.query<any[]>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
      [INCIDENT_LOG_TABLE],
    );
    if (tables.length) return;
    await pool.query(CREATE_INCIDENT_TABLE_SQL);
    console.log("[IncidentLog] Created application_incident_events for the administrator console.");
  } catch (error) {
    console.error("[IncidentLog] Failed to ensure schema:", error instanceof Error ? error.name : "UnknownError");
  }
}

/**
 * Persist one incident row. Deliberately never throws: recording a crash must
 * never become a second fault, and it fails quietly when the additive table has
 * not been installed on this host yet.
 */
export async function recordIncident(input: RecordIncidentInput): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const db = await getDb();
    if (!db) return;
    const at = input.occurredAt instanceof Date && !Number.isNaN(input.occurredAt.getTime()) ? input.occurredAt : new Date();
    const message = sanitizeIncidentText(input.message || "Incident without a message", 1000) || "Incident without a message";
    const stack = input.stack ? sanitizeIncidentText(input.stack, 8000) : null;
    const contextJson = input.context ? sanitizeIncidentText(safeStringify(input.context), 4000) : null;
    await db.execute(sql`INSERT INTO application_incident_events
      (severity,category,processRole,eventCode,message,stack,contextJson,appVersion,sourceRevision,instanceId,bootId,exitCode,signal,occurredAt,occurredDate)
      VALUES (${input.severity},${input.category},${input.processRole ?? "application"},${safeEventCode(input.eventCode)},${message},${stack},${contextJson},${input.appVersion ?? null},${input.sourceRevision ?? null},${input.instanceId ?? null},${input.bootId ?? INCIDENT_BOOT_ID},${input.exitCode ?? null},${input.signal ? sanitizeIncidentText(input.signal, 32) : null},${utcStamp(at)},${utcDateKey(at)})`);
  } catch (error) {
    if (isMissingTableError(error)) return;
    console.error("[IncidentLog] Failed to record incident:", error instanceof Error ? error.name : "UnknownError");
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toEntry(row: Record<string, unknown>): IncidentEntry {
  const bootId = row.bootId == null ? null : String(row.bootId);
  return {
    id: toNumber(row.id),
    severity: String(row.severity ?? ""),
    category: String(row.category ?? ""),
    processRole: String(row.processRole ?? "application"),
    eventCode: row.eventCode == null ? null : String(row.eventCode),
    message: String(row.message ?? ""),
    stack: row.stack == null ? null : String(row.stack),
    context: parseContext(row.contextJson),
    appVersion: row.appVersion == null ? null : String(row.appVersion),
    sourceRevision: row.sourceRevision == null ? null : String(row.sourceRevision),
    instanceId: row.instanceId == null ? null : String(row.instanceId),
    bootId,
    exitCode: row.exitCode == null ? null : toNumber(row.exitCode),
    signal: row.signal == null ? null : String(row.signal),
    occurredAt: row.occurredAt == null ? "" : String(row.occurredAt),
    isCurrentBoot: bootId === INCIDENT_BOOT_ID,
  };
}

/** Read a bounded, filtered list of incident rows, newest first. */
export async function listIncidents(filters: { limit?: number; category?: IncidentCategory; severity?: IncidentSeverity } = {}): Promise<IncidentEntry[]> {
  const limit = Number.isFinite(filters.limit) ? Math.min(MAX_LIST, Math.max(1, Math.trunc(filters.limit as number))) : DEFAULT_LIST;
  try {
    if (!process.env.DATABASE_URL) return [];
    const db = await getDb();
    if (!db) return [];
    const conditions = [sql`1=1`];
    if (filters.category) conditions.push(sql`category=${filters.category}`);
    if (filters.severity) conditions.push(sql`severity=${filters.severity}`);
    const where = sql.join(conditions, sql` AND `);
    const result = await db.execute(sql`SELECT
        id,severity,category,processRole,eventCode,message,stack,contextJson,appVersion,sourceRevision,instanceId,bootId,exitCode,signal,
        DATE_FORMAT(occurredAt,'%Y-%m-%dT%H:%i:%s.000Z') AS occurredAt
      FROM application_incident_events
      WHERE ${where}
      ORDER BY occurredAt DESC, id DESC
      LIMIT ${limit}`);
    const rows = ((result as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    return rows.map(toEntry);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    console.error("[IncidentLog] Failed to list incidents:", error instanceof Error ? error.name : "UnknownError");
    return [];
  }
}

/** Aggregate incident counts for the summary blocks used across the console. */
export async function getIncidentSummary(): Promise<IncidentSummary> {
  try {
    if (!process.env.DATABASE_URL) return { ...EMPTY_SUMMARY };
    const db = await getDb();
    if (!db) return { ...EMPTY_SUMMARY };
    const last24hCutoff = utcStamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const last7dCutoff = utcStamp(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const result = await db.execute(sql`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN severity='fatal' THEN 1 ELSE 0 END) AS fatal,
        SUM(CASE WHEN severity='error' THEN 1 ELSE 0 END) AS error,
        SUM(CASE WHEN severity='warning' THEN 1 ELSE 0 END) AS warning,
        SUM(CASE WHEN severity='info' THEN 1 ELSE 0 END) AS info,
        SUM(CASE WHEN occurredAt >= ${last24hCutoff} THEN 1 ELSE 0 END) AS last24h,
        SUM(CASE WHEN occurredAt >= ${last7dCutoff} THEN 1 ELSE 0 END) AS last7d
      FROM application_incident_events`);
    const rows = ((result as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return { ...EMPTY_SUMMARY };
    const categoryResult = await db.execute(sql`SELECT category, COUNT(*) AS count FROM application_incident_events GROUP BY category`);
    const categoryRows = ((categoryResult as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    const categories: Record<string, number> = {};
    for (const item of categoryRows) categories[String(item.category ?? "unknown")] = toNumber(item.count);
    return {
      total: toNumber(row.total),
      fatal: toNumber(row.fatal),
      error: toNumber(row.error),
      warning: toNumber(row.warning),
      info: toNumber(row.info),
      last24h: toNumber(row.last24h),
      last7d: toNumber(row.last7d),
      categories,
    };
  } catch (error) {
    if (isMissingTableError(error)) return { ...EMPTY_SUMMARY };
    console.error("[IncidentLog] Failed to summarize incidents:", error instanceof Error ? error.name : "UnknownError");
    return { ...EMPTY_SUMMARY };
  }
}

/**
 * Build the administrator incident report: a count summary, a restart/past-boot
 * grouping so crashes that happened before the current boot are obvious, and the
 * most recent incidents with their sanitized message, stack and context.
 */
export async function getIncidentReport(limit: number = DEFAULT_LIST): Promise<IncidentReport> {
  const safeLimit = Number.isFinite(limit) ? Math.min(MAX_LIST, Math.max(1, Math.trunc(limit))) : DEFAULT_LIST;
  const now = new Date();
  const base: IncidentReport = {
    sourceAvailable: true,
    generatedAt: now.toISOString(),
    retentionDays: INCIDENT_RETENTION_DAYS,
    currentBootId: INCIDENT_BOOT_ID,
    currentBootStartedAt: INCIDENT_PROCESS_STARTED_AT.toISOString(),
    summary: { ...EMPTY_SUMMARY },
    boots: [],
    incidents: [],
  };
  try {
    if (!process.env.DATABASE_URL) return { ...base, sourceAvailable: false };
    const db = await getDb();
    if (!db) return { ...base, sourceAvailable: false };
    const summary = await getIncidentSummary();
    const recent = await listIncidents({ limit: Math.max(safeLimit, MAX_RECENT) });
    const bootMap = new Map<string, IncidentBootSummary>();
    for (const incident of recent) {
      const key = incident.bootId ?? "__unattributed__";
      const existing = bootMap.get(key);
      if (existing) {
        existing.incidents += 1;
        if (incident.severity === "fatal") existing.fatal += 1;
        if (incident.severity === "error") existing.error += 1;
        if (!existing.firstAt) existing.firstAt = incident.occurredAt;
      } else {
        bootMap.set(key, {
          bootId: incident.bootId,
          firstAt: incident.occurredAt,
          lastAt: incident.occurredAt,
          incidents: 1,
          fatal: incident.severity === "fatal" ? 1 : 0,
          error: incident.severity === "error" ? 1 : 0,
          isCurrent: incident.isCurrentBoot,
        });
      }
    }
    const boots = [...bootMap.values()].slice(0, 8);
    return {
      ...base,
      summary,
      boots,
      incidents: recent.slice(0, safeLimit),
    };
  } catch (error) {
    if (isMissingTableError(error)) return { ...base, sourceAvailable: false };
    console.error("[IncidentLog] Failed to build report:", error instanceof Error ? error.name : "UnknownError");
    return { ...base, sourceAvailable: false };
  }
}

/**
 * Delete one incident row by id so an administrator can remove a specific crash
 * report by hand — for example the record that explains a crash they have
 * already diagnosed, especially the fatal entry that caused the restart. Never
 * throws: a failed delete must never become a second fault.
 */
export async function deleteIncident(id: number): Promise<IncidentDeleteResult> {
  const incidentId = Number.isFinite(id) ? Math.trunc(id) : NaN;
  if (!Number.isFinite(incidentId) || incidentId <= 0) return { deleted: 0 };
  try {
    if (!process.env.DATABASE_URL) return { deleted: 0 };
    const pool = await getRawDbPool();
    if (!pool) return { deleted: 0 };
    const [result] = await pool.query<any>("DELETE FROM application_incident_events WHERE id = ?", [incidentId]);
    return { deleted: Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0) };
  } catch (error) {
    if (isMissingTableError(error)) return { deleted: 0 };
    console.error("[IncidentLog] Failed to delete incident:", error instanceof Error ? error.name : "UnknownError");
    return { deleted: 0 };
  }
}

/**
 * Delete every incident row for one restart session when a boot id is supplied,
 * or the whole retained history otherwise. Powers the administrator "delete all"
 * action so crash residue can be cleared manually. Never throws.
 */
export async function clearIncidents(options: { bootId?: string } = {}): Promise<IncidentDeleteResult> {
  try {
    if (!process.env.DATABASE_URL) return { deleted: 0 };
    const pool = await getRawDbPool();
    if (!pool) return { deleted: 0 };
    const bootId = options.bootId?.trim();
    const [result] = bootId
      ? await pool.query<any>("DELETE FROM application_incident_events WHERE bootId = ?", [bootId])
      : await pool.query<any>("DELETE FROM application_incident_events");
    return { deleted: Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0) };
  } catch (error) {
    if (isMissingTableError(error)) return { deleted: 0 };
    console.error("[IncidentLog] Failed to clear incidents:", error instanceof Error ? error.name : "UnknownError");
    return { deleted: 0 };
  }
}

/**
 * Delete incident rows older than the retention window so the table stays
 * bounded. Runs at boot and on a schedule. Never throws.
 */
export async function purgeIncidentLog(olderThanDays: number = INCIDENT_RETENTION_DAYS): Promise<IncidentPurgeResult> {
  const retentionDays = Number.isFinite(olderThanDays) ? Math.max(1, Math.trunc(olderThanDays)) : INCIDENT_RETENTION_DAYS;
  const cutoff = utcStamp(new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000));
  try {
    if (!process.env.DATABASE_URL) return { deleted: 0, retentionDays, cutoff };
    const pool = await getRawDbPool();
    if (!pool) return { deleted: 0, retentionDays, cutoff };
    const [result] = await pool.query<any>("DELETE FROM application_incident_events WHERE occurredAt < ?", [cutoff]);
    return { deleted: Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0), retentionDays, cutoff };
  } catch (error) {
    if (isMissingTableError(error)) return { deleted: 0, retentionDays, cutoff };
    console.error("[IncidentLog] Failed to purge expired incidents:", error instanceof Error ? error.name : "UnknownError");
    return { deleted: 0, retentionDays, cutoff };
  }
}
