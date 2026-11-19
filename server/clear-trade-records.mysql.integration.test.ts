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
let scopeCustomerA = 0;
let scopeCustomerB = 0;
let systemBatchId = "";
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

async function insertOffer(suffix: string, createdAt: Date, userId: number = customerId) {
  const result: any = await query(
    "INSERT INTO opportunity_offers (assignedUserId,symbol,venueFrom,venueTo,currency,minimumMinor,expectedRewardBps,durationSeconds,opensAt,closesAt,rewardAt,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [userId, "CLEAR", "fixture-a", "fixture-b", "USD", 1000, 500, 3600, createdAt, createdAt, createdAt, "closed", createdAt],
  );
  return Number(result.insertId);
}

async function insertTradePosition(offerId: number, confirmedAt: Date, userId: number = customerId) {
  await query(
    "INSERT INTO trade_positions (userId,offerId,currency,principalMinor,expectedRewardMinor,settlesAt,confirmedAt) VALUES (?,?,?,?,?,?,?)",
    [userId, offerId, "USD", 1000, 50, confirmedAt, confirmedAt],
  );
}

async function insertNotification(title: string, createdAt: Date, userId: number = customerId) {
  await query("INSERT INTO customer_notifications (userId,title,body,category,createdAt) VALUES (?,?,?,?,?)", [userId, title, `${title} body`, "trade", createdAt]);
}

// targetUserId null models a broadcast campaign (no single owner); a concrete id
// models a campaign aimed at one customer. The delivery row always names a customer.
async function insertCampaign(suffix: string, createdAt: Date, targetUserId: number | null = null) {
  const result: any = await query(
    "INSERT INTO notification_campaigns (createdBy,eventKey,title,body,category,priority,status,targetUserId,createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
    [adminId, `${token}-${suffix}`, `Campaign ${suffix}`, `Campaign ${suffix} body`, "trade", "normal", "published", targetUserId, createdAt],
  );
  const id = Number(result.insertId);
  campaignIds.push(id);
  await query("INSERT INTO notification_campaign_deliveries (campaignId,userId,status,createdAt) VALUES (?,?,?,?)", [id, targetUserId ?? customerId, "delivered", createdAt]);
  return id;
}

// A system-level generation batch carries no customer id, so a per-customer clear
// must never delete it (only an all-customer clear may).
async function insertSystemBatch(suffix: string) {
  const id = `${token}-${suffix}`.slice(0, 64);
  await query("INSERT INTO opportunity_generation_batches (id,status,batchSize,createdAt) VALUES (?,?,?,?)", [id, "completed", 5, recentAt]);
  return id;
}

async function snapshotProtectedData(userId: number = customerId) {
  return {
    balances: await query("SELECT currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor FROM customer_balances WHERE userId=? ORDER BY id", [userId]),
    ledger: await query("SELECT currency,amountMinor,entryType,reference,withdrawable FROM balance_ledger WHERE userId=? ORDER BY id", [userId]),
    account: await query("SELECT name,email,role FROM users WHERE id=?", [userId]),
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
// Table and column names here are internal test constants, not user input.
const countFor = async (table: string, column: string, userId: number) => Number((await query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=?`, [userId]))[0].count);

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

    // Dedicated pair of customers for per-customer scope verification, each with
    // their own offers, trades, notifications and a customer-targeted campaign.
    const scopeAResult: any = await query("INSERT INTO users (openId,name,email,loginMethod,role) VALUES (?,?,?,?,?)", [`${token}-scope-a`, "Clear Scope A", `${token}-scope-a@example.invalid`, "integration", "user"]);
    scopeCustomerA = Number(scopeAResult.insertId);
    const scopeBResult: any = await query("INSERT INTO users (openId,name,email,loginMethod,role) VALUES (?,?,?,?,?)", [`${token}-scope-b`, "Clear Scope B", `${token}-scope-b@example.invalid`, "integration", "user"]);
    scopeCustomerB = Number(scopeBResult.insertId);
    for (const id of [scopeCustomerA, scopeCustomerB]) {
      await query("INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,?,?,?,?)", [id, "USD", 50000 + id, 0, 0, 0]);
      await query("INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,?)", [id, "USD", 50000 + id, "integration_fixture", `${token}-ledger-${id}`, 1]);
    }
    const scopeOfferA = await insertOffer("scope-a", recentAt, scopeCustomerA);
    const scopeOfferB = await insertOffer("scope-b", recentAt, scopeCustomerB);
    await insertTradePosition(scopeOfferA, recentAt, scopeCustomerA);
    await insertTradePosition(scopeOfferB, recentAt, scopeCustomerB);
    await insertNotification("Scope A notification", recentAt, scopeCustomerA);
    await insertNotification("Scope B notification", recentAt, scopeCustomerB);
    await insertCampaign("scope-a", recentAt, scopeCustomerA);
    await insertCampaign("scope-b", recentAt, scopeCustomerB);
    systemBatchId = await insertSystemBatch("batch");

    adminCaller = appRouter.createCaller({ user: { id: adminId, role: "admin" } } as any as never);
    customerCaller = appRouter.createCaller({ user: { id: customerId, role: "user" } } as any as never);
  });

  afterAll(async () => {
    if (connection) {
      const customerIds = [customerId, scopeCustomerA, scopeCustomerB];
      const list = customerIds.map(() => "?").join(",");
      await query(`DELETE FROM opportunity_offers WHERE assignedUserId IN (${list})`, customerIds);
      await query(`DELETE FROM trade_positions WHERE userId IN (${list})`, customerIds);
      await query(`DELETE FROM customer_notifications WHERE userId IN (${list})`, customerIds);
      if (campaignIds.length) await query(`DELETE FROM notification_campaign_deliveries WHERE campaignId IN (${campaignIds.map(() => "?").join(",")})`, campaignIds);
      await query(`DELETE FROM notification_campaigns WHERE createdBy=?`, [adminId]);
      if (systemBatchId) await query(`DELETE FROM opportunity_generation_batches WHERE id=?`, [systemBatchId]);
      await query(`DELETE FROM balance_ledger WHERE userId IN (${list})`, customerIds);
      await query(`DELETE FROM customer_balances WHERE userId IN (${list})`, customerIds);
      await query(`DELETE FROM v5_audit_events WHERE actorUserId=? OR entityType='trade_records_clear'`, [adminId]);
      await query(`DELETE FROM users WHERE id IN (${[adminId, ...customerIds].map(() => "?").join(",")})`, [adminId, ...customerIds]);
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
    const globalPreview = await adminCaller.adminOperations.clearTradePreview({ from: null, to: null, categories: allCategories });
    const globalByTable = new Map(globalPreview.map((row) => [row.table, row.records]));
    // A global preview always includes the main customer's own records.
    expect(globalByTable.get("opportunity_offers")).toBeGreaterThanOrEqual(2);

    // A per-customer preview scopes every table (including trade sub-selects) to one customer.
    const scopedA = new Map((await adminCaller.adminOperations.clearTradePreview({ from: null, to: null, categories: allCategories, userId: scopeCustomerA })).map((row) => [row.table, row.records]));
    expect(scopedA.get("opportunity_offers")).toBe(1);
    expect(scopedA.get("trade_positions")).toBe(1);
    expect(scopedA.get("customer_notifications")).toBe(1);
    expect(scopedA.get("notification_campaigns")).toBe(1);
    expect(scopedA.get("notification_campaign_deliveries")).toBe(1);
    // System-level tables cannot be attributed to one customer, so they are excluded.
    expect(scopedA.get("opportunity_generation_batches")).toBe(0);

    expect(await snapshotProtectedData()).toEqual(before);
  });

  it("clears records for one customer only, leaving other customers and system records intact", async () => {
    const beforeA = await snapshotProtectedData(scopeCustomerA);
    const beforeB = await snapshotProtectedData(scopeCustomerB);
    const operationId = crypto.randomUUID();
    const summary = await adminCaller.adminOperations.clearTrade({ from: null, to: null, categories: allCategories, userId: scopeCustomerA, operationId });
    expect(summary.userId).toBe(scopeCustomerA);
    expect(summary.totalDeleted).toBeGreaterThan(0);

    // Every scoped table for the target customer is emptied.
    expect(await countFor("opportunity_offers", "assignedUserId", scopeCustomerA)).toBe(0);
    expect(await countFor("trade_positions", "userId", scopeCustomerA)).toBe(0);
    expect(await countFor("customer_notifications", "userId", scopeCustomerA)).toBe(0);
    expect(await countFor("notification_campaigns", "targetUserId", scopeCustomerA)).toBe(0);
    expect(await countFor("notification_campaign_deliveries", "userId", scopeCustomerA)).toBe(0);

    // The other customer's matching records are all retained.
    expect(await countFor("opportunity_offers", "assignedUserId", scopeCustomerB)).toBe(1);
    expect(await countFor("trade_positions", "userId", scopeCustomerB)).toBe(1);
    expect(await countFor("customer_notifications", "userId", scopeCustomerB)).toBe(1);
    expect(await countFor("notification_campaigns", "targetUserId", scopeCustomerB)).toBe(1);
    expect(await countFor("notification_campaign_deliveries", "userId", scopeCustomerB)).toBe(1);

    // A system-level generation batch carries no customer id and must survive.
    expect(Number((await query("SELECT COUNT(*) AS count FROM opportunity_generation_batches WHERE id=?", [systemBatchId]))[0].count)).toBe(1);

    // Balances, ledger and account data are preserved for both customers.
    expect(await snapshotProtectedData(scopeCustomerA)).toEqual(beforeA);
    expect(await snapshotProtectedData(scopeCustomerB)).toEqual(beforeB);

    // A single audit row records the customer-scoped run.
    const audit = await query("SELECT entityId,reason FROM v5_audit_events WHERE reference=?", [`trade-records-clear:${operationId}`]);
    expect(audit.length).toBe(1);
    expect(String(audit[0].entityId)).toBe(`customer:${scopeCustomerA}`);
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
