import mysql from "mysql2/promise";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureLendingSchema,
  listEnabledAdminLenderReserves,
  listEnabledAdminLendingLoans,
  seedExampleLendingDesk,
  setAdminLendingLoanSchedule,
} from "./lendingDossiers";

/**
 * Regression guard for the example-auction seed against a real MySQL/MariaDB.
 *
 * The seed (and every admin write to a loan's schedule) binds `auctionOpensAt`
 * and `auctionClosesAt`, which are DATETIME columns. Binding a raw ISO-8601
 * string such as `2026-11-23T16:54:39.596Z` is rejected by strict MySQL with
 * "Incorrect datetime value" (ERROR 1292), which silently aborted the whole
 * seed and left the customer desk empty. This suite exercises the real write
 * paths so the ISO→DATETIME conversion can never regress unnoticed.
 *
 * Skipped unless LENDING_TEST_DATABASE_URL points at a throwaway MySQL database.
 */
const databaseUrl = process.env.LENDING_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe("Lending seed against real MySQL/MariaDB", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LENDING_TEST_DATABASE_URL is required for this integration suite");
    const pool = mysql.createPool(databaseUrl);
    // The seed records an audit event once rows are written.
    await pool.query(`CREATE TABLE IF NOT EXISTS v5_audit_events (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actorUserId INT NULL,
      action VARCHAR(80) NOT NULL,
      entityType VARCHAR(64) NOT NULL,
      entityId VARCHAR(160) NOT NULL,
      reason VARCHAR(500) NULL,
      reference VARCHAR(200) NULL,
      metadataJson TEXT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    await pool.query("DROP TABLE IF EXISTS lending_loans, lending_reserves, lending_bids, lending_positions");
    await pool.end();
  });

  it("seeds the six example auctions and four reserves from a clean database", async () => {
    await ensureLendingSchema();
    const result = await seedExampleLendingDesk(null);
    expect(result.loans).toBe(6);
    expect(result.reserves).toBe(4);

    const loans = await listEnabledAdminLendingLoans();
    const reserves = await listEnabledAdminLenderReserves();
    expect(loans).toHaveLength(6);
    expect(reserves).toHaveLength(4);
    // The DATETIME round-trips back to an ISO string, not a truncated value.
    expect(loans[0].auctionOpensAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(loans[0].auctionClosesAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("re-seeds idempotently without duplicating or erroring", async () => {
    await seedExampleLendingDesk(null);
    expect(await listEnabledAdminLendingLoans()).toHaveLength(6);
    expect(await listEnabledAdminLenderReserves()).toHaveLength(4);
  });

  it("persists an administrator's auction window through the schedule writer", async () => {
    const opens = new Date(Date.now() - 3_600_000).toISOString();
    const closes = new Date(Date.now() + 7_200_000).toISOString();
    const updated = await setAdminLendingLoanSchedule(1, "example-home-improvement-personal-us", {
      auctionOpensAt: opens,
      auctionClosesAt: closes,
    });
    expect(updated.auctionOpensAt).toBe(opens);
    expect(updated.auctionClosesAt).toBe(closes);
  });
});
