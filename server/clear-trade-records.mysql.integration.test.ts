import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import { appRouter } from "./routers";
import { closeDbPool, getDb } from "./db";

type SqlConnection = Awaited<ReturnType<typeof mysql.createConnection>>;
const rawDatabaseUrl = process.env.DATABASE_URL ?? "";
const enabled = rawDatabaseUrl.length > 0 && process.env.RUN_CLEAR_TRADE_DB_INTEGRATION === "1";
const token = `cleartrade-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const DAY_MS = 86_400_000;
let connection: SqlConnection | null = null;
let adminId = 0;
let customerId = 0;
let customerCaller: ReturnType<typeof appRouter.createCaller>;
let adminCaller: ReturnType<typeof appRouter.createCaller>;
const campaignIds: number[] = [];

function disposableUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol === "mariadb:") url.protocol = "mysql:";
  if (url.protocol !== "mysql:" || !new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) throw new Error("Clear Trade integration requires a loopback MySQL/MariaDB URL.");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/(test|testing|integration|disposable)/i.test(database)) throw new Error("Clear Trade integration requires a disposable database name.");
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database };
}

async function query<T = any>(sql: string, values: any[] = []) {
  if (!connection) throw new Error("Clear Trade integration database is not ready.");
  const [rows] = await connection.query<T[]>(sql, values);
  return rows;
}

const recentAt = new Date(Date.now() - 3_600_000);
const oldAt = new Date(Date.now() - 30 * DAY_MS);
const windowFrom = new Date(Date.now() - DAY_MS).toISOString();
const windowTo = new Date(Date.now() + 60_000).toISOString();
const allCategories = { tradeHistory: true, opportunityRecords: true, customerNotifications: true, notificationCampaigns: true };

async function insertOffer(suffix: string, createdAt: Date) {
  const result: any = await query(
    "INSERT INTO opportunity_offers (assignedUserId,symbol,venueFrom,venueTo,currency,minimumMinor,expectedRewardBps,durationSeconds,opensAt,closesAt,rewardAt,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [customerId, "CLEAR", "fixture-a", "fixture-b", "USD", 1000, 500, 3600, createdAt, createdAt, createdAt, "closed", createdAt],
  );
  return Number(result.insertId);
}

async function insertTradePosition(offerId: number, confirmedAt: Date) {
  await query(
    "INSERT INTO trade_positions (userId,offerId,currency,principalMinor,expectedRewardMinor,settlesAt,confirmedAt) VALUES (?,?,?,?,?,?,?)",
    [customerId, offerId, "USD", 1000, 50, confirmedAt, confirmedAt],
  );
}

async function insertNotification(title: string, createdAt: Date) {
  await query("INSERT INTO customer_notifications (userId,title,body,category,createdAt) VALUES (?,?,?,?,?)", [customerId, title, `${title} body`, "trade", createdAt]);
}

async function insertCampaign(suffix: string, createdAt: Date) {
  const result: any = await query(
    "INSERT INTO notification_campaigns (createdBy,eventKey,title,body,category,priority,status,createdAt) VALUES (?,?,?,?,?,?,?,?)",
    [adminId, `${token}-${suffix}`, `Campaign ${suffix}`, `Campaign ${suffix} body`, "trade", "normal", "published", createdAt],
  );
  const id = Number(result.insertId);
  campaignIds.push(id);
  await query("INSERT INTO notification_campaign_deliveries (campaignId,userId,status,createdAt) VALUES (?,?,?,?)", [id, customerId, "delivered", createdAt]);
  return id;
}

async function snapshotProtectedData() {
  return {
    balances: await query("SELECT currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor FROM customer_balances WHERE userId=? ORDER BY id", [customerId]),
    ledger: await query("SELECT currency,amountMinor,entryType,reference,withdrawable FROM balance_ledger WHERE userId=? ORDER BY id", [customerId]),
    account: await query("SELECT name,email,role FROM users WHERE id=?", [customerId]),
  };
}

const cutoff = new Date(Date.now() - 10 * DAY_MS);
const countRecentOffers = async () => Number((await query("SELECT COUNT(*) AS count FROM opportunity_offers WHERE assignedUserId=? AND createdAt>=?", [customerId, cutoff]))[0].count);
const countOldOffers = async () => Number((await query("SELECT COUNT(*) AS count FROM opportunity_offers WHERE assignedUserId=? AND createdAt<?", [customerId, cutoff]))[0].count);
const countRecentTrades = async () => Number((await query("SELECT COUNT(*) AS count FROM trade_positions WHERE userId=? AND confirmedAt>=?", [customerId, cutoff]))[0].count);
const countOldTrades = async () => Number((await query("SELECT COUNT(*) AS count FROM trade_positions WHERE userId=? AND confirmedAt<?", [customerId, cutoff]))[0].count);
const countRecentNotifications = async () => Number((await query("SELECT COUNT(*) AS count FROM customer_notifications WHERE userId=? AND createdAt>=?", [customerId, cutoff]))[0].count);
const countOldNotifications = async () => Number((await query("SELECT COUNT(*) AS count FROM customer_notifications WHERE userId=? AND createdAt<?", [customerId, cutoff]))[0].count);
const countRecentCampaigns = async () => Number((await query("SELECT COUNT(*) AS count FROM notification_campaigns WHERE createdBy=? AND createdAt>=?", [adminId, cutoff]))[0].count);
const countOldCampaigns = async () => Number((await query("SELECT COUNT(*) AS count FROM notification_campaigns WHERE createdBy=? AND createdAt<?", [adminId, cutoff]))[0].count);

describe.skipIf(!enabled)("Clear Trade records against disposable MySQL/MariaDB", () => {
  beforeAll(async () => {
    connection = await mysql.createConnection({ ...disposableUrl(rawDatabaseUrl), timezone: "Z" });
    const db = await getDb();
    if (!db) throw new Error("Database pool could not be opened.");
    const adminResult: any = await query("INSERT INTO users (openId,name,email,loginMethod,role) VALUES (?,?,?,?,?)", [`${token}-admin`, "Clear Trade Admin", `${token}-admin@example.invalid`, "integration", "admin"]);
    adminId = Number(adminResult.insertId);
    const customerResult: any = await query("INSERT INTO users (openId,name,email,loginMethod,role) VALUES (?,?,?,?,?)", [`${token}-customer`, "Clear Trade Customer", `${token}-customer@example.invalid`, "integration", "user"]);
    customerId = Number(customerResult.insertId);
    await query("INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,?,?,?,?)", [customerId, "USD", 99999, 12, 3, 4]);
    await query("INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,?)", [customerId, "USD", 99999, "integration_fixture", `${token}-ledger`, 1]);
    const recentOffer = await insertOffer("recent", recentAt);
    const oldOffer = await insertOffer("old", oldAt);
    await insertTradePosition(recentOffer, recentAt);
    await insertTradePosition(oldOffer, oldAt);
    await insertNotification("Recent notification", recentAt);
    await insertNotification("Old notification", oldAt);
    await insertCampaign("recent", recentAt);
    await insertCampaign("old", oldAt);
    adminCaller = appRouter.createCaller({ user: { id: adminId, role: "admin" } } as any as never);
    customerCaller = appRouter.createCaller({ user: { id: customerId, role: "user" } } as any as never);
  });

  afterAll(async () => {
    if (connection) {
      const placeholder = "?";
      await query(`DELETE FROM opportunity_offers WHERE assignedUserId=${placeholder}`, [customerId]);
      await query(`DELETE FROM trade_positions WHERE userId=${placeholder}`, [customerId]);
      await query(`DELETE FROM customer_notifications WHERE userId=${placeholder}`, [customerId]);
      if (campaignIds.length) await query(`DELETE FROM notification_campaign_deliveries WHERE campaignId IN (${campaignIds.map(() => "?").join(",")})`, campaignIds);
      await query(`DELETE FROM notification_campaigns WHERE createdBy=${placeholder}`, [adminId]);
      await query(`DELETE FROM balance_ledger WHERE userId=${placeholder}`, [customerId]);
      await query(`DELETE FROM customer_balances WHERE userId=${placeholder}`, [customerId]);
      await query(`DELETE FROM v5_audit_events WHERE actorUserId=${placeholder} OR entityType='trade_records_clear'`, [adminId]);
      await query(`DELETE FROM users WHERE id IN (${placeholder},${placeholder})`, [adminId, customerId]);
      await connection.end();
      connection = null;
    }
    await closeDbPool();
  });

  it("requires an administrator and validates the clear input", async () => {
    await expect(customerCaller.adminOperations.clearTrade({ from: null, to: null, categories: allCategories, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminCaller.adminOperations.clearTrade({ from: windowTo, to: windowFrom, categories: allCategories, operationId: crypto.randomUUID() })).rejects.toThrow();
    await expect(adminCaller.adminOperations.clearTrade({ from: null, to: null, categories: { tradeHistory: false, opportunityRecords: false, customerNotifications: false, notificationCampaigns: false }, operationId: crypto.randomUUID() })).rejects.toThrow();
  });

  it("previews the records that a clear would remove without mutating anything", async () => {
    const before = await snapshotProtectedData();
    const preview = await adminCaller.adminOperations.clearTradePreview({ from: null, to: null, categories: allCategories });
    const byTable = new Map(preview.map((row) => [row.table, row.records]));
    expect(byTable.get("opportunity_offers")).toBe(2);
    expect(byTable.get("trade_positions")).toBe(2);
    expect(byTable.get("customer_notifications")).toBe(2);
    expect(byTable.get("notification_campaigns")).toBe(2);
    expect(byTable.get("notification_campaign_deliveries")).toBe(2);
    expect(await snapshotProtectedData()).toEqual(before);
  });

  it("clears only in-window records and never touches balances, ledger or customer data", async () => {
    const before = await snapshotProtectedData();
    const operationId = crypto.randomUUID();
    const summary = await adminCaller.adminOperations.clearTrade({ from: windowFrom, to: windowTo, categories: allCategories, operationId });
    expect(summary.totalDeleted).toBeGreaterThan(0);
    expect(summary.from).toBe(new Date(windowFrom).toISOString());
    expect(summary.to).toBe(new Date(windowTo).toISOString());
    expect(summary.idempotentReplay).toBeFalsy();

    // Recent rows disappear, older rows outside the window are retained.
    expect(await countRecentOffers()).toBe(0);
    expect(await countOldOffers()).toBe(1);
    expect(await countRecentTrades()).toBe(0);
    expect(await countOldTrades()).toBe(1);
    expect(await countRecentNotifications()).toBe(0);
    expect(await countOldNotifications()).toBe(1);
    expect(await countRecentCampaigns()).toBe(0);
    expect(await countOldCampaigns()).toBe(1);

    expect(await snapshotProtectedData()).toEqual(before);
    expect(Number((await query("SELECT COUNT(*) AS count FROM v5_audit_events WHERE reference=?", [`trade-records-clear:${operationId}`]))[0].count)).toBe(1);

    const replay = await adminCaller.adminOperations.clearTrade({ from: windowFrom, to: windowTo, categories: allCategories, operationId });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.totalDeleted).toBe(summary.totalDeleted);
    expect(await countOldOffers()).toBe(1);
  });

  it("clears everything in the selected groups when no window is given", async () => {
    const operationId = crypto.randomUUID();
    const summary = await adminCaller.adminOperations.clearTrade({ from: null, to: null, categories: allCategories, operationId });
    expect(summary.from).toBeNull();
    expect(summary.to).toBeNull();
    expect(await countOldOffers()).toBe(0);
    expect(await countOldTrades()).toBe(0);
    expect(await countOldNotifications()).toBe(0);
    expect(await countOldCampaigns()).toBe(0);
    expect(Number((await query("SELECT COUNT(*) AS count FROM v5_audit_events WHERE reference=?", [`trade-records-clear:${operationId}`]))[0].count)).toBe(1);
  });
});
