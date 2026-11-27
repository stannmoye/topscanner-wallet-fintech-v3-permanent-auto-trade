import mysql from "mysql2/promise";

/**
 * Supervisor-side incident recording.
 *
 * The startup wrapper (`start-with-diagnostics.mjs`) runs the migration phases
 * and then the application server as child processes. When a phase fails or the
 * server exits before it is asked to shut down, the application process may not
 * have had a chance to record anything itself (for example an out-of-memory kill
 * or a migration that aborts before the app boots). This module lets the wrapper
 * persist those supervisor-observed incidents to the same additive
 * `application_incident_events` table the application uses, so a crash is still
 * explained after the platform restarts everything.
 *
 * It is deliberately self-contained and never throws: recording an incident must
 * never become a second fault, and the wrapper must keep working on any host.
 */

export const INCIDENT_LOG_TABLE = "application_incident_events";

export const CREATE_INCIDENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS application_incident_events (
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

/** Redact credentials and collapse whitespace before anything is persisted. */
export function sanitizeIncidentText(value, limit = 1000) {
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

function utcStamp(date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function safeEventCode(value) {
  const code = String(value ?? "").replace(/[^A-Z0-9_]/gi, "").slice(0, 64);
  return code || null;
}

function isMissingTableError(error) {
  const code = String(error?.code ?? "");
  return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR";
}

/** Idempotently create the additive incident table. Never throws. */
export async function ensureIncidentLogSchema(db) {
  const [tables] = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
    [INCIDENT_LOG_TABLE],
  );
  if (tables.length) return { repaired: false };
  await db.query(CREATE_INCIDENT_TABLE_SQL);
  return { repaired: true };
}

/**
 * Build a lazily-connected incident writer. The connection is opened on first
 * use and reused; a failed connection is reset so the next record can retry.
 */
export function createIncidentWriter({ bootId, appVersion = null, sourceRevision = null, logger = () => {} } = {}) {
  let connectionPromise = null;
  let schemaReady = false;
  const resolvedBootId = bootId || process.env.ARBITRADE_BOOT_ID || null;

  const connect = async () => {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is required");
    const url = new URL(raw);
    if (!["mysql:", "mariadb:"].includes(url.protocol)) throw new Error("DATABASE_URL must use mysql:// or mariadb://");
    if (url.protocol === "mariadb:") url.protocol = "mysql:";
    url.searchParams.set("timezone", "Z");
    return mysql.createConnection(url.toString());
  };

  return {
    async record(input) {
      try {
        if (!connectionPromise) connectionPromise = connect();
        const db = await connectionPromise;
        if (!schemaReady) {
          await ensureIncidentLogSchema(db);
          schemaReady = true;
        }
        const at = input.occurredAt instanceof Date && !Number.isNaN(input.occurredAt.getTime()) ? input.occurredAt : new Date();
        const message = sanitizeIncidentText(input.message || "Incident without a message", 1000) || "Incident without a message";
        const stack = input.stack ? sanitizeIncidentText(input.stack, 8000) : null;
        const contextJson = input.context ? sanitizeIncidentText(JSON.stringify(input.context), 4000) : null;
        await db.execute(
          `INSERT INTO ${INCIDENT_LOG_TABLE}
            (severity,category,processRole,eventCode,message,stack,contextJson,appVersion,sourceRevision,instanceId,bootId,exitCode,signal,occurredAt,occurredDate)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            input.severity,
            input.category,
            input.processRole ?? "supervisor",
            safeEventCode(input.eventCode),
            message,
            stack,
            contextJson,
            input.appVersion ?? appVersion,
            input.sourceRevision ?? sourceRevision,
            input.instanceId ?? null,
            input.bootId ?? resolvedBootId,
            input.exitCode ?? null,
            input.signal ? sanitizeIncidentText(input.signal, 32) : null,
            utcStamp(at),
            utcDateKey(at),
          ],
        );
      } catch (error) {
        connectionPromise = null;
        schemaReady = false;
        if (!isMissingTableError(error)) logger(error);
      }
    },
    async close() {
      if (!connectionPromise) return;
      const pending = connectionPromise;
      connectionPromise = null;
      try {
        const db = await pending;
        await db.end();
      } catch {
        /* The connection is already unusable; nothing left to close. */
      }
    },
  };
}
