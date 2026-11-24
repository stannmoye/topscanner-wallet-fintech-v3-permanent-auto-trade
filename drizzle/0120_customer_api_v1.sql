-- Customer API v1 — access governance schema.
--
-- Backs the versioned public REST surface at /api/v1 (scoped API keys, signed
-- webhooks, idempotency and request audit). These tables govern access only and
-- never hold money: every amount an API caller reads comes from the existing
-- wallet / ledger / trade tables, so there is no second financial source of
-- truth.
--
-- The plaintext key secret is never stored — only a SHA-256 hash — and is shown
-- to the customer exactly once at creation. Webhook signing secrets are stored
-- encrypted. Column names are camelCase to match the Drizzle schema.
--
-- Idempotent and additive, so it is safe to replay.
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `name` varchar(64) NOT NULL,
  `keyPrefix` varchar(40) NOT NULL,
  `secretHash` char(64) NOT NULL,
  `scopes` json NOT NULL,
  `environment` enum('live','test') NOT NULL DEFAULT 'live',
  `ipAllowlist` json NULL,
  `rateLimitPerMinute` int NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `lastUsedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revokedAt` timestamp NULL,
  `revokedReason` varchar(255) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_keys_prefix_unique` (`keyPrefix`),
  KEY `api_keys_user_status_idx` (`userId`, `status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `api_webhook_endpoints` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `url` varchar(512) NOT NULL,
  `secretEncrypted` varchar(512) NOT NULL,
  `subscribedEvents` json NOT NULL,
  `description` varchar(128) NULL,
  `status` enum('active','paused','disabled') NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `api_webhook_endpoints_user_status_idx` (`userId`, `status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `api_webhook_deliveries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `endpointId` int NOT NULL,
  `eventId` varchar(36) NOT NULL,
  `eventType` varchar(64) NOT NULL,
  `payload` json NOT NULL,
  `status` enum('pending','delivered','failed','dead') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `lastAttemptAt` timestamp NULL,
  `responseStatus` int NULL,
  `nextAttemptAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_webhook_deliveries_endpoint_event_unique` (`endpointId`, `eventId`),
  KEY `api_webhook_deliveries_retry_idx` (`status`, `nextAttemptAt`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `api_idempotency_keys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `apiKeyId` int NOT NULL,
  `idemKey` varchar(160) NOT NULL,
  `requestHash` char(64) NOT NULL,
  `response` json NULL,
  `status` enum('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_idempotency_keys_key_unique` (`apiKeyId`, `idemKey`),
  KEY `api_idempotency_keys_expiry_idx` (`expiresAt`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `api_request_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `apiKeyId` int NULL,
  `requestId` varchar(36) NOT NULL,
  `method` varchar(8) NOT NULL,
  `path` varchar(255) NOT NULL,
  `status` int NOT NULL,
  `latencyMs` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `api_request_log_key_created_idx` (`apiKeyId`, `createdAt`),
  KEY `api_request_log_request_idx` (`requestId`)
) ENGINE=InnoDB;
