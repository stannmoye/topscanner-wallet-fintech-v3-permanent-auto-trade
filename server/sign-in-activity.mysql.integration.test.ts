import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SIGN_IN_ACTIVITY_RETENTION_DAYS,
  SIGN_IN_ACTIVITY_TABLE,
  ensureSignInActivitySchema,
  getSignInActivityReport,
  purgeSignInActivity,
  recordSignInActivity,
} from "./sign-in-activity";

const databaseUrl = process.env.SIGN_IN_ACTIVITY_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

/** A disposable MySQL/MariaDB URL is required; the suite is skipped otherwise. */
integrationDescribe("sign-in activity retention against disposable MySQL/MariaDB", () => {
  const pool = databaseUrl ? mysql.createPool(databaseUrl) : null;
  const day = 24 * 60 * 60 * 1000;
  const fixtureEmails: string[] = [];

  async function countByEmail(email: string): Promise<number> {
    if (!pool) throw new Error("Missing sign-in activity test database pool");
    const [rows] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS count FROM ${SIGN_IN_ACTIVITY_TABLE} WHERE userEmail=?`,
      [email],
    );
    return Number(rows[0]?.count ?? 0);
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("SIGN_IN_ACTIVITY_TEST_DATABASE_URL is required for the sign-in activity integration suite");
    // The module reads DATABASE_URL; point it at the disposable test database
    // before the pool is lazily initialised.
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl;
    await ensureSignInActivitySchema();
    await pool!.query(`DELETE FROM ${SIGN_IN_ACTIVITY_TABLE}`);
  });

  afterAll(async () => {
    if (!pool) return;
    if (fixtureEmails.length) {
      await pool.query(`DELETE FROM ${SIGN_IN_ACTIVITY_TABLE} WHERE userEmail IN (${fixtureEmails.map(() => "?").join(",")})`, fixtureEmails);
    }
    await pool.end();
  });

  it("records every sign-in, reports only the last seven days and clears older residue", async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    const recentEmail = `recent-${marker}@example.test`;
    const freshEmail = `fresh-${marker}@example.test`;
    const staleEmail = `stale-${marker}@example.test`;
    const adminEmail = `admin-${marker}@example.test`;
    fixtureEmails.push(recentEmail, freshEmail, staleEmail, adminEmail);

    // Two customer sign-ins and one administrator sign-in inside the window,
    // plus one stale record older than the retention window.
    await recordSignInActivity({ userId: 900000 + 1, userName: "Recent Customer", userEmail: recentEmail, userRole: "user", eventType: "login", source: "customer", deviceName: "Chrome", countryCode: "US", ipAddress: "10.0.0.1", at: new Date(now - day) });
    await recordSignInActivity({ userId: 900000 + 2, userName: "Fresh Customer", userEmail: freshEmail, userRole: "user", eventType: "signup", source: "customer", at: new Date(now) });
    await recordSignInActivity({ userId: 900000 + 4, userName: "Admin User", userEmail: adminEmail, userRole: "admin", eventType: "login", source: "admin", at: new Date(now - 2 * day) });
    await recordSignInActivity({ userId: 900000 + 3, userName: "Stale Customer", userEmail: staleEmail, userRole: "user", eventType: "login", source: "customer", at: new Date(now - (SIGN_IN_ACTIVITY_RETENTION_DAYS + 2) * day) });

    // All four rows are physically present before the purge runs.
    expect(await countByEmail(recentEmail)).toBe(1);
    expect(await countByEmail(staleEmail)).toBe(1);

    const before = await getSignInActivityReport(500);
    expect(before.sourceAvailable).toBe(true);
    expect(before.retentionDays).toBe(SIGN_IN_ACTIVITY_RETENTION_DAYS);
    const beforeEmails = before.entries.map((entry) => entry.userEmail);
    // The report never shows the stale record, even before the purge runs.
    expect(beforeEmails).toContain(recentEmail);
    expect(beforeEmails).toContain(adminEmail);
    expect(beforeEmails).not.toContain(staleEmail);
    expect(before.summary.distinctCustomers).toBeGreaterThanOrEqual(2);

    // The automatic retention sweep permanently deletes the stale row.
    const purged = await purgeSignInActivity();
    expect(purged.retentionDays).toBe(SIGN_IN_ACTIVITY_RETENTION_DAYS);
    expect(purged.deleted).toBeGreaterThanOrEqual(1);
    expect(await countByEmail(staleEmail)).toBe(0);
    expect(await countByEmail(recentEmail)).toBe(1);
    expect(await countByEmail(freshEmail)).toBe(1);
    expect(await countByEmail(adminEmail)).toBe(1);

    // A second purge removes nothing because the residue is already gone.
    const secondPurge = await purgeSignInActivity();
    expect(secondPurge.deleted).toBe(0);
  });
});
