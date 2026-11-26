import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeCompatibleMigrationSql } from "./mysql-compatible-migration-sql.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The Privacy Centre tables live outside the canonical Drizzle journal, so the
 * startup path must create and verify them additively. This mirrors the
 * `site_analytics_events`/analytics-schema bridge: the customer and admin
 * privacy menus read these tables directly and return HTTP 500 if they are
 * absent on a deployed host.
 */
export const PRIVACY_CENTER_TABLES = [
  "privacy_policy_versions",
  "privacy_requests",
  "privacy_request_events",
  "privacy_audit_events",
];

export const PRIVACY_CENTER_REQUIRED_COLUMNS = {
  privacy_policy_versions: [
    "id", "versionLabel", "title", "summary", "controllerName", "controllerAddress",
    "privacyContact", "applicableJurisdiction", "sectionsJson", "htmlContent", "status",
    "effectiveAt", "publishedAt", "publishedBy", "createdBy", "createdAt", "updatedAt",
  ],
  privacy_requests: [
    "id", "requestReference", "idempotencyKey", "userId", "requestType", "subject",
    "details", "status", "assignedAdminId", "reviewedBy", "reviewedAt", "createdAt", "updatedAt",
  ],
  privacy_request_events: [
    "id", "requestId", "actorType", "actorUserId", "eventType", "previousStatus",
    "newStatus", "customerMessage", "internalNote", "createdAt",
  ],
  privacy_audit_events: [
    "id", "actorUserId", "action", "entityType", "entityId", "metadataJson", "createdAt",
  ],
};

// Ordered so the versioned notice table and the htmlContent column are applied
// after the request/event/audit tables are present.
const PRIVACY_MIGRATION_FILES = [
  "drizzle/0062_privacy_center.sql",
  "drizzle/0063_privacy_notice_html.sql",
];

const quote = "`";

async function readTableColumns(db) {
  const placeholders = PRIVACY_CENTER_TABLES.map(() => "?").join(",");
  const [rows] = await db.query(
    "SELECT table_name AS tableName, column_name AS columnName FROM information_schema.columns " +
      "WHERE table_schema=DATABASE() AND table_name IN (" + placeholders + ")",
    PRIVACY_CENTER_TABLES,
  );
  const columns = new Map();
  for (const row of rows) {
    const table = String(row.tableName ?? row.TABLE_NAME ?? "");
    const column = String(row.columnName ?? row.COLUMN_NAME ?? "");
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(column);
  }
  return columns;
}

function findMissingColumns(columns) {
  const missing = [];
  for (const table of PRIVACY_CENTER_TABLES) {
    const present = columns.get(table) ?? new Set();
    for (const column of PRIVACY_CENTER_REQUIRED_COLUMNS[table]) {
      if (!present.has(column)) missing.push(table + "." + column);
    }
  }
  return missing;
}

/**
 * Idempotently create and verify the additive Privacy Centre tables.
 * Safe to replay: the SQL only ever creates a missing table or adds a missing
 * column, and the notice seed is guarded by WHERE NOT EXISTS.
 */
export async function ensurePrivacyCenterSchema(db, { required = false } = {}) {
  let columns = await readTableColumns(db);
  const missingBefore = findMissingColumns(columns);
  let repaired = false;

  if (missingBefore.length) {
    for (const relativePath of PRIVACY_MIGRATION_FILES) {
      const sql = await readFile(resolve(root, relativePath), "utf8");
      await executeCompatibleMigrationSql(db, sql);
    }
    repaired = true;
    columns = await readTableColumns(db);
  }

  const missingAfter = findMissingColumns(columns);
  if (missingAfter.length) {
    if (required) {
      throw new Error(
        "Privacy Centre schema verification failed: missing " +
          missingAfter.map((entry) => quote + entry.replace(".", quote + ".") + quote).join(", "),
      );
    }
    return { present: false, repaired };
  }

  return { present: true, repaired };
}
