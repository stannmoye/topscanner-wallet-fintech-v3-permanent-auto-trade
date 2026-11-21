export const SITE_ANALYTICS_TABLE = "site_analytics_events";

const REQUIRED_COLUMNS = [
  "id",
  "eventType",
  "eventDate",
  "visitorKey",
  "userId",
  "countryCode",
  "source",
  "path",
  "userAgent",
  "ipAddress",
  "createdAt",
];

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS site_analytics_events (
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
 * Idempotently create and verify the additive first-party analytics table.
 * Safe to replay: it only ever creates the table or adds a missing column.
 */
export async function ensureVisitorAnalyticsSchema(db, { required = false } = {}) {
  const [tables] = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
    [SITE_ANALYTICS_TABLE],
  );
  let repaired = false;
  if (!tables.length) {
    await db.query(CREATE_TABLE_SQL);
    repaired = true;
  }

  const [columns] = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?",
    [SITE_ANALYTICS_TABLE],
  );
  const present = new Set(columns.map((row) => String(row.column_name ?? row.COLUMN_NAME ?? "")));
  const missing = REQUIRED_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) {
    if (required) {
      throw new Error("Analytics schema verification failed: site_analytics_events is missing columns " + missing.join(", "));
    }
    return { present: false, repaired };
  }
  return { present: true, repaired };
}
