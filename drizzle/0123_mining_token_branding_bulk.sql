-- Mining coin identity/branding, live rate source and bulk CKI operations.
--
-- The administrator can rename the mining coin, change its icon and choose
-- between the fixed internal conversion reference and a live market feed. The
-- internal ledger asset code stays CKI so renaming is display-only and never
-- changes wallet, ledger or reward maths. Bulk credit/debit-all operations are
-- recorded so a mass adjustment is auditable, idempotent and reviewable.
--
-- All statements are idempotent: the migration adapter resolves
-- ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS against
-- information_schema before executing, so re-running is safe on both MariaDB
-- and MySQL 8.

ALTER TABLE mining_economics_versions
  ADD COLUMN IF NOT EXISTS tokenIconUrl VARCHAR(1024) NULL,
  ADD COLUMN IF NOT EXISTS tokenRateSource VARCHAR(16) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS tokenExternalSymbol VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS tokenRateProvider VARCHAR(64) NULL;

CREATE TABLE IF NOT EXISTS mining_bulk_operations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  adminId INT NOT NULL,
  direction VARCHAR(8) NOT NULL,
  assetCode VARCHAR(12) NOT NULL,
  amount DECIMAL(36,18) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  idempotencyKey VARCHAR(200) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  totalTargets INT NOT NULL DEFAULT 0,
  postedCount INT NOT NULL DEFAULT 0,
  skippedCount INT NOT NULL DEFAULT 0,
  failedCount INT NOT NULL DEFAULT 0,
  summaryJson LONGTEXT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completedAt DATETIME(3) NULL,
  UNIQUE KEY uq_mining_bulk_operation_key (idempotencyKey),
  INDEX idx_mining_bulk_operations_created (createdAt)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mining_bulk_operation_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operationId INT NOT NULL,
  userId INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  ledgerTransactionId INT NULL,
  referenceCode VARCHAR(120) NULL,
  detail VARCHAR(500) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_mining_bulk_operation_items_op (operationId, status),
  INDEX idx_mining_bulk_operation_items_user (userId, createdAt)
) ENGINE=InnoDB;
