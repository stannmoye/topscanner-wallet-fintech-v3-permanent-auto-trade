-- Mining catalogue reconciliation and engine controls.
--
-- Adds the administrator-controlled global mining speed multiplier and the
-- per-customer entitlement controls (pause / resume / stop / extend) used by
-- the customer-portal mining packages. All statements are idempotent: the
-- migration adapter resolves ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS against information_schema before executing, so re-running is safe on
-- both MariaDB and MySQL 8.

ALTER TABLE mining_economics_versions
  ADD COLUMN IF NOT EXISTS miningSpeedMultiplier DECIMAL(18,8) NOT NULL DEFAULT 1;

ALTER TABLE mining_customer_packages
  ADD COLUMN IF NOT EXISTS adminPaused TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adminPausedAt DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS adminPausedBy INT NULL,
  ADD COLUMN IF NOT EXISTS adminStoppedAt DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS adminExtendedSeconds BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_mining_customer_packages_engine ON mining_customer_packages (userId, status, adminPaused, expiresAt);
