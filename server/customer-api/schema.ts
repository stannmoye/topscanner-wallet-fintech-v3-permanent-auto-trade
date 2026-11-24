import { getRawDbPool } from "../db";

/**
 * Customer API v1 — additive schema self-provisioning.
 *
 * The five `api_*` tables and `customer_api_settings` are additive and
 * independent of the Drizzle journal, so they are not created by the guarded
 * main-migration runner that the production start command executes. Mirroring
 * the pattern used by the other additive feature desks (for example
 * `ensureLendingDeskSchema`), this memoized helper issues the same idempotent
 * `CREATE TABLE IF NOT EXISTS` DDL that the tracked portal migration applies, so
 * the API-key surface works on a host that only runs the main migrations.
 */

const CREATE_CUSTOMER_API_SCHEMA_SQL = [
  // drizzle/0120_customer_api_v1.sql
  `CREATE TABLE IF NOT EXISTS \`api_keys\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`userId\` int NOT NULL,
    \`name\` varchar(64) NOT NULL,
    \`keyPrefix\` varchar(40) NOT NULL,
    \`secretHash\` char(64) NOT NULL,
    \`scopes\` json NOT NULL,
    \`environment\` enum('live','test') NOT NULL DEFAULT 'live',
    \`ipAllowlist\` json NULL,
    \`rateLimitPerMinute\` int NULL,
    \`status\` enum('active','revoked') NOT NULL DEFAULT 'active',
    \`lastUsedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`revokedAt\` timestamp NULL,
    \`revokedReason\` varchar(255) NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`api_keys_prefix_unique\` (\`keyPrefix\`),
    KEY \`api_keys_user_status_idx\` (\`userId\`, \`status\`)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`api_webhook_endpoints\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`userId\` int NOT NULL,
    \`url\` varchar(512) NOT NULL,
    \`secretEncrypted\` varchar(512) NOT NULL,
    \`subscribedEvents\` json NOT NULL,
    \`description\` varchar(128) NULL,
    \`status\` enum('active','paused','disabled') NOT NULL DEFAULT 'active',
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`api_webhook_endpoints_user_status_idx\` (\`userId\`, \`status\`)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`api_webhook_deliveries\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`endpointId\` int NOT NULL,
    \`eventId\` varchar(36) NOT NULL,
    \`eventType\` varchar(64) NOT NULL,
    \`payload\` json NOT NULL,
    \`status\` enum('pending','delivered','failed','dead') NOT NULL DEFAULT 'pending',
    \`attempts\` int NOT NULL DEFAULT 0,
    \`lastAttemptAt\` timestamp NULL,
    \`responseStatus\` int NULL,
    \`nextAttemptAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`api_webhook_deliveries_endpoint_event_unique\` (\`endpointId\`, \`eventId\`),
    KEY \`api_webhook_deliveries_retry_idx\` (\`status\`, \`nextAttemptAt\`)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`api_idempotency_keys\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`apiKeyId\` int NOT NULL,
    \`idemKey\` varchar(160) NOT NULL,
    \`requestHash\` char(64) NOT NULL,
    \`response\` json NULL,
    \`status\` enum('in_progress','completed') NOT NULL DEFAULT 'in_progress',
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`expiresAt\` timestamp NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`api_idempotency_keys_key_unique\` (\`apiKeyId\`, \`idemKey\`),
    KEY \`api_idempotency_keys_expiry_idx\` (\`expiresAt\`)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`api_request_log\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`apiKeyId\` int NULL,
    \`requestId\` varchar(36) NOT NULL,
    \`method\` varchar(8) NOT NULL,
    \`path\` varchar(255) NOT NULL,
    \`status\` int NOT NULL,
    \`latencyMs\` int NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`api_request_log_key_created_idx\` (\`apiKeyId\`, \`createdAt\`),
    KEY \`api_request_log_request_idx\` (\`requestId\`)
  ) ENGINE=InnoDB`,
  // drizzle/0121_customer_api_settings.sql
  `CREATE TABLE IF NOT EXISTS \`customer_api_settings\` (
    \`userId\` int NOT NULL,
    \`apiEnabled\` boolean NOT NULL DEFAULT true,
    \`defaultRateLimitPerMinute\` int NULL,
    \`allowedScopes\` json NULL,
    \`updatedBy\` int NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`userId\`)
  ) ENGINE=InnoDB`,
];

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive Customer API tables exist (memoized). */
export function ensureCustomerApiSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      const pool = await getRawDbPool();
      if (!pool) return;
      for (const statement of CREATE_CUSTOMER_API_SCHEMA_SQL) {
        await pool.query(statement);
      }
      console.log("[CustomerApi] Ensured API keys and access-policy schema.");
    } catch (error) {
      // Allow a later caller to retry rather than memoizing a transient failure.
      schemaReady = null;
      console.error("[CustomerApi] Failed to ensure API schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}
