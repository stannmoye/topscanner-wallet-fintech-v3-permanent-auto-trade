-- Customer API v1 — per-customer access policy.
--
-- One row per customer that has an explicit policy. A missing row means the
-- platform default: API access enabled, the global rate limit, and the full
-- read-scope ceiling. Administrators use this to disable a customer's API
-- access or narrow the scopes their keys may hold.
--
-- Idempotent and additive, so it is safe to replay.
CREATE TABLE IF NOT EXISTS `customer_api_settings` (
  `userId` int NOT NULL,
  `apiEnabled` boolean NOT NULL DEFAULT true,
  `defaultRateLimitPerMinute` int NULL,
  `allowedScopes` json NULL,
  `updatedBy` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`)
) ENGINE=InnoDB;
