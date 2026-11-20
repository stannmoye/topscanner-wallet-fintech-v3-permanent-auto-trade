import mysql from "mysql2/promise";
import { assertWorkerSchemaContracts } from "./worker-schema-contracts.mjs";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is required");
const url = new URL(raw);
if (!["mysql:", "mariadb:"].includes(url.protocol)) throw new Error("DATABASE_URL must use mysql:// or mariadb://");
if (url.protocol === "mariadb:") url.protocol = "mysql:";
url.searchParams.set("timezone", "Z");
const db = await mysql.createConnection(url.toString());

async function hasColumn(table, column) {
  const [rows] = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1",
    [table, column],
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (!(await hasColumn(table, column))) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added ${table}.${column}`);
  }
}

try {
  await db.query(`CREATE TABLE IF NOT EXISTS mining_schema_migrations (
    migrationKey VARCHAR(120) NOT NULL PRIMARY KEY,
    detailsJson LONGTEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`);

  await addColumn("mining_economics_versions", "tokenName", "VARCHAR(64) NOT NULL DEFAULT 'CoinKi'");
  await addColumn("mining_economics_versions", "tokenSymbol", "VARCHAR(16) NOT NULL DEFAULT 'CKI'");
  await addColumn("mining_economics_versions", "defaultContractDurationMonths", "INT NOT NULL DEFAULT 24");
  await addColumn("mining_economics_versions", "calculationModel", "VARCHAR(32) NOT NULL DEFAULT 'package_daily'");
  await addColumn("mining_economics_versions", "difficultyBaselineThs", "DECIMAL(30,12) NOT NULL DEFAULT 100");
  await addColumn("mining_economics_versions", "ckiPerThsPerDay", "DECIMAL(36,18) NOT NULL DEFAULT 0");
  await addColumn("mining_economics_versions", "packagePurchasesEnabled", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn("mining_economics_versions", "boostRewardCkiPerDay", "DECIMAL(36,18) NOT NULL DEFAULT 0");
  await addColumn("mining_economics_versions", "boostActivationBonusCki", "DECIMAL(36,18) NOT NULL DEFAULT 0");
  await addColumn("mining_economics_versions", "globalHashPowerThs", "DECIMAL(30,12) NOT NULL DEFAULT 0");
  await addColumn("mining_economics_versions", "miningSpeedMultiplier", "DECIMAL(18,8) NOT NULL DEFAULT 1");
  await addColumn("mining_economics_versions", "tokenIconUrl", "VARCHAR(1024) NULL");
  await addColumn("mining_economics_versions", "tokenRateSource", "VARCHAR(16) NOT NULL DEFAULT 'fixed'");
  await addColumn("mining_economics_versions", "tokenExternalSymbol", "VARCHAR(64) NULL");
  await addColumn("mining_economics_versions", "tokenRateProvider", "VARCHAR(64) NULL");
  await db.query(`UPDATE mining_economics_versions SET globalHashPowerThs=67 WHERE globalHashPowerThs=0`);
  await db.query(`UPDATE mining_economics_versions SET miningSpeedMultiplier=1 WHERE miningSpeedMultiplier IS NULL OR miningSpeedMultiplier<=0`);
  await db.query(`UPDATE mining_economics_versions SET tokenRateSource='fixed' WHERE tokenRateSource IS NULL OR tokenRateSource NOT IN ('fixed','live')`);

  await addColumn("mining_packages", "displayOrder", "INT NOT NULL DEFAULT 0");
  await addColumn("mining_package_versions", "displayName", "VARCHAR(120) NULL");
  await addColumn("mining_package_versions", "durationMonths", "INT NULL");
  await addColumn("mining_package_versions", "expectedDailyRewardCki", "DECIMAL(36,18) NULL");

  await addColumn("mining_customer_packages", "packageNameSnapshot", "VARCHAR(120) NULL");
  await addColumn("mining_customer_packages", "durationMonthsSnapshot", "INT NULL");
  await addColumn("mining_customer_packages", "expectedDailyRewardCkiSnapshot", "DECIMAL(36,18) NULL");
  await addColumn("mining_customer_packages", "calculationModelSnapshot", "VARCHAR(32) NOT NULL DEFAULT 'legacy_boost_daily'");
  await addColumn("mining_customer_packages", "ckiPerThsPerDaySnapshot", "DECIMAL(36,18) NULL");
  await addColumn("mining_customer_packages", "adminPaused", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn("mining_customer_packages", "adminPausedAt", "DATETIME(3) NULL");
  await addColumn("mining_customer_packages", "adminPausedBy", "INT NULL");
  await addColumn("mining_customer_packages", "adminStoppedAt", "DATETIME(3) NULL");
  await addColumn("mining_customer_packages", "adminExtendedSeconds", "BIGINT NOT NULL DEFAULT 0");
  await addColumn("mining_boost_activations", "customerPackageId", "INT NULL");

  const [engineIndex] = await db.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='mining_customer_packages' AND index_name='idx_mining_customer_packages_engine' LIMIT 1",
  );
  if (!engineIndex.length) {
    await db.query("CREATE INDEX idx_mining_customer_packages_engine ON mining_customer_packages (userId,status,adminPaused,expiresAt)");
    console.log("Added index mining_customer_packages.idx_mining_customer_packages_engine");
  }

  await addColumn("mining_reward_events", "expectedDailyRewardCki", "DECIMAL(36,18) NULL");
  await addColumn("mining_reward_events", "rewardAmountUsd", "DECIMAL(36,18) NOT NULL DEFAULT 0");
  await addColumn("mining_reward_events", "calculationModel", "VARCHAR(32) NOT NULL DEFAULT 'package_daily'");

  await db.query(`CREATE TABLE IF NOT EXISTS mining_package_purchase_claims (
    userId INT NOT NULL,
    packageId INT NOT NULL,
    firstPurchaseId INT NULL,
    firstQuoteId INT NULL,
    claimedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (userId,packageId),
    UNIQUE KEY uq_mining_package_claim_purchase (firstPurchaseId),
    UNIQUE KEY uq_mining_package_claim_quote (firstQuoteId),
    INDEX idx_mining_package_claim_package (packageId,claimedAt)
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS mining_reward_package_allocations (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rewardEventId INT NOT NULL,
    userId INT NOT NULL,
    customerPackageId INT NOT NULL,
    packageId INT NOT NULL,
    packageVersionId INT NOT NULL,
    intervalStart DATETIME(3) NOT NULL,
    intervalEnd DATETIME(3) NOT NULL,
    expectedDailyRewardCkiSnapshot DECIMAL(36,18) NULL,
    rewardAmountCki DECIMAL(36,18) NOT NULL,
    tokenUnitsPerUsdSnapshot DECIMAL(36,18) NOT NULL,
    rewardAmountUsdSnapshot DECIMAL(36,18) NOT NULL,
    calculationModel VARCHAR(32) NOT NULL,
    calculationSegmentsJson LONGTEXT NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_mining_reward_allocation_event_package (rewardEventId,customerPackageId),
    UNIQUE KEY uq_mining_reward_allocation_contract_interval (userId,customerPackageId,intervalStart,intervalEnd),
    INDEX idx_mining_reward_allocation_contract (customerPackageId,intervalEnd),
    INDEX idx_mining_reward_allocation_package (packageId,packageVersionId,intervalEnd)
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS mining_engine_activity (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    customerPackageId INT NOT NULL,
    packageId INT NOT NULL,
    packageVersionId INT NOT NULL,
    intervalStart DATETIME(3) NOT NULL,
    intervalEnd DATETIME(3) NOT NULL,
    baseThsSnapshot DECIMAL(30,12) NOT NULL,
    boostThsSnapshot DECIMAL(30,12) NOT NULL DEFAULT 0,
    eligibleSeconds DECIMAL(12,3) NOT NULL,
    economicsVersion INT NOT NULL,
    settlementStatus VARCHAR(32) NOT NULL DEFAULT 'awaiting_settlement',
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_mining_engine_activity_package_interval (customerPackageId,intervalStart,intervalEnd),
    INDEX idx_mining_engine_activity_user_date (userId,intervalEnd),
    INDEX idx_mining_engine_activity_settlement (settlementStatus,intervalEnd)
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS mining_pending_boost_rewards (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    rewardEventId INT NOT NULL,
    rewardDay DATE NOT NULL,
    amountCki DECIMAL(36,18) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    settledAt DATETIME(3) NULL,
    settlementReference VARCHAR(120) NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_pending_boost_reward_event (rewardEventId),
    UNIQUE KEY uq_pending_boost_settlement_reference (settlementReference),
    INDEX idx_pending_boost_day_status (rewardDay,status,userId)
  ) ENGINE=InnoDB`);
  await db.query(`ALTER TABLE mining_pending_boost_rewards MODIFY COLUMN rewardEventId INT NULL`);

  await db.query(`CREATE TABLE IF NOT EXISTS mining_bulk_operations (
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
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS mining_bulk_operation_items (
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
  ) ENGINE=InnoDB`);

  await db.query(`UPDATE mining_package_versions SET displayName=(SELECT name FROM mining_packages p WHERE p.id=mining_package_versions.packageId) WHERE displayName IS NULL`);
  await db.query(`UPDATE mining_customer_packages cp JOIN mining_packages p ON p.id=cp.packageId JOIN mining_package_versions v ON v.id=cp.packageVersionId SET cp.packageNameSnapshot=COALESCE(v.displayName,p.name) WHERE cp.packageNameSnapshot IS NULL`);
  await db.query(`UPDATE mining_customer_packages cp JOIN mining_package_versions v ON v.id=cp.packageVersionId SET cp.durationMonthsSnapshot=COALESCE(v.durationMonths,ROUND(v.expirySeconds/2629800)) WHERE cp.durationMonthsSnapshot IS NULL AND (v.durationMonths IS NOT NULL OR v.expirySeconds IS NOT NULL)`);
  await db.query(`UPDATE mining_package_versions SET durationMonths=24 WHERE durationMonths IS NULL`);
  await db.query(`UPDATE mining_customer_packages SET durationMonthsSnapshot=24 WHERE durationMonthsSnapshot IS NULL`);
  await db.query(`UPDATE mining_economics_versions SET tokenName='CoinKi' WHERE tokenName IS NULL OR tokenName=''`);
  await db.query(`UPDATE mining_economics_versions SET tokenSymbol='CKI' WHERE tokenSymbol IS NULL OR tokenSymbol=''`);
  await db.query(`UPDATE mining_customer_packages cp JOIN mining_packages p ON p.id=cp.packageId JOIN mining_package_versions v ON v.id=p.currentVersionId SET cp.expectedDailyRewardCkiSnapshot=v.expectedDailyRewardCki, cp.calculationModelSnapshot='package_daily' WHERE cp.expectedDailyRewardCkiSnapshot IS NULL AND v.expectedDailyRewardCki IS NOT NULL`);

  const verified = await assertWorkerSchemaContracts(db, ["mining_pending_boost_rewards"]);
  console.log(JSON.stringify({
    status: "ok",
    message: "Current mining schema is ready",
    verifiedWorkerTableContracts: verified.checkedTables,
  }));
} finally {
  await db.end();
}
