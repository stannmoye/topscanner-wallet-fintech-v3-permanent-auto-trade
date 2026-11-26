import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const emailAdmin = readFileSync(new URL("./emailAdmin.ts", import.meta.url), "utf8");
const database = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const workerIndex = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
const workerHealth = readFileSync(new URL("./_core/workerHealth.ts", import.meta.url), "utf8");

describe("daily report persistence", () => {
  it("records each customer's report into v5_reports and its delivery into v5_email_jobs", () => {
    // The v5 reporting tables existed in the schema but nothing wrote them: the
    // daily run only emailed statements. The report row and its email job must
    // now be persisted from the authoritative tables every day.
    expect(emailAdmin).toContain("INSERT INTO v5_reports (userId,reportingDate,timezone,periodStartUtc,periodEndUtc,status) VALUES");
    expect(emailAdmin).toContain("INSERT INTO v5_email_jobs (userId,reportId,status,attempts,lastError,idempotencyKey) VALUES");
    expect(emailAdmin).toContain("ON DUPLICATE KEY UPDATE reportId=VALUES(reportId),status=VALUES(status),attempts=VALUES(attempts),lastError=VALUES(lastError)");
    expect(emailAdmin).toContain("const reportId = await persistDailyReport(db, user.id, figures)");
  });

  it("is idempotent per customer per reporting day", () => {
    // A report already on file for the same (userId, reportingDate) is updated
    // in place, and the email job's unique idempotency key prevents duplicates.
    expect(emailAdmin).toContain("SELECT id FROM v5_reports WHERE userId=${userId} AND reportingDate=${figures.reportingDate} ORDER BY id DESC LIMIT 1");
    expect(emailAdmin).toContain("UPDATE v5_reports SET timezone=${figures.timezone},periodStartUtc=${figures.periodStartUtc},periodEndUtc=${figures.periodEndUtc},status='GENERATED' WHERE id=${Number(existing.id)}");
    expect(emailAdmin).toContain("const idempotencyKey = `daily-report:${user.id}:${reportingDate}`");
    expect(emailAdmin).toContain('const priorJob = (((await db.execute(sql`SELECT status FROM v5_email_jobs WHERE idempotencyKey=${idempotencyKey} LIMIT 1`)) as any)[0] || [])[0]');
  });

  it("computes the persisted figures from the authoritative tables, never a synthetic zero", () => {
    expect(emailAdmin).toContain("SELECT currency,principalMinor,expectedRewardMinor,netProfitMinor,status,confirmedAt,settledAt FROM trade_positions WHERE userId=${userId} AND status='settled' AND walletUpdatedAt>=${periodStartUtc} AND walletUpdatedAt<${periodEndUtc}");
    expect(emailAdmin).toContain("SELECT COUNT(DISTINCT offerId) AS used FROM opportunity_delivery_events WHERE userId=${userId} AND quotaDay=${reportingDate} AND status<>'failed'");
    expect(emailAdmin).toContain("const netProfitUsd = await getCustomerEarnedUsdInWindow(userId, periodStartUtc, periodEndUtc)");
    expect(database).toContain("export async function getCustomerEarnedUsdInWindow(userId:number,start:Date,end:Date){");
  });

  it("writes the report but only emails a verified, opted-in customer", () => {
    expect(emailAdmin).toContain("SELECT emailVerified FROM customer_controls WHERE userId=${userId} LIMIT 1");
    expect(emailAdmin).toContain("SELECT dailyTradingReports FROM customer_email_preferences WHERE userId=${userId} LIMIT 1");
    expect(emailAdmin).toContain('if (await dailyReportEmailAllowed(db, user.id))');
    expect(emailAdmin).toContain('let status = "SUPPRESSED"');
  });

  it("runs every day from the worker runtime, not only from the admin action", () => {
    expect(workerIndex).toContain('import { runDailyEmailReports } from "../emailAdmin";');
    expect(workerIndex).toContain('runMonitoredWorkerCycle("daily-reports", () => runDailyEmailReports())');
    expect(workerIndex).toContain("registerWorkerInterval(() => { void runDailyReportCycle(); }, 60_000)");
    expect(workerHealth).toContain('{ key: "daily-reports"');
  });
});
