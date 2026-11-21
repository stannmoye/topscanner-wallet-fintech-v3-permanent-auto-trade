import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  findTreasuryBondInstrument,
  getTreasuryBondCatalogue,
  projectTreasuryBondProfit,
  type TreasuryBondInstrument,
} from "./treasuryBondProvider";

type Db = mysql.PoolConnection;

/** Additive, self-hosted storage for treasury-bond positions (outside Drizzle). */
export const TREASURY_BOND_POSITIONS_TABLE = "treasury_bond_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS treasury_bond_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  instrumentId VARCHAR(80) NOT NULL,
  instrumentName VARCHAR(200) NOT NULL,
  issuer VARCHAR(200) NULL,
  country VARCHAR(80) NULL,
  countryCode VARCHAR(8) NULL,
  category VARCHAR(24) NULL,
  couponRateBps INT NOT NULL,
  tenorYears DECIMAL(8,4) NULL,
  tenureDays INT NULL,
  principalMinor BIGINT NOT NULL,
  expectedProfitMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  dataSource VARCHAR(140) NULL,
  dataAsOf VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  maturityAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY treasury_bond_positions_code_idx (positionCode),
  KEY treasury_bond_positions_user_idx (userId, status)
) ENGINE=InnoDB`;

const SETTLEMENT_CURRENCY = "USD";
const MAX_PURCHASE_MINOR = 100_000_000; // $1,000,000 ceiling per purchase

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const pool = mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 });
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); await pool.end(); }
}

let schemaReady: Promise<void> | null = null;

/**
 * Create the additive positions table when it is missing. Managed hosts start
 * from `dist/index.js` without the external schema wrapper, so the server
 * guarantees its own storage. Deliberately memoized and idempotent.
 */
export function ensureTreasuryBondSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_POSITIONS_TABLE_SQL);
      });
    } catch (error) {
      // Allow a later attempt to retry if the first one raced a cold database.
      schemaReady = null;
      console.error("[TreasuryBonds] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `treasury-bond:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function rateBps(ratePct: number) {
  return Math.max(0, Math.round(ratePct * 100));
}

function tenureDays(instrument: TreasuryBondInstrument) {
  return Math.max(1, Math.round(instrument.tenorYears * 365));
}

/**
 * Assemble the treasury-bond desk for one customer: the live instrument
 * catalogue, that customer's own positions, wallet balances and a derived
 * summary. Positions are read from storage; instruments are read from the live
 * public data sources.
 */
export async function getTreasuryBondDashboard(userId: number) {
  await ensureTreasuryBondSchema();
  const catalogue = await getTreasuryBondCatalogue();
  return withConnection(async (conn) => {
    const [positions] = await conn.query<any[]>(
      `SELECT id, positionCode, instrumentId, instrumentName, issuer, country, countryCode, category,
              couponRateBps, tenorYears, tenureDays, principalMinor, expectedProfitMinor, currency,
              dataSource, dataAsOf, status, openedAt, maturityAt, ledgerReference
       FROM treasury_bond_positions WHERE userId=? ORDER BY openedAt DESC`,
      [userId],
    );
    const [balances] = await conn.query<any[]>(
      `SELECT c.code currency, c.symbol, c.scale, c.name currencyName,
              COALESCE(b.availableMinor,0) availableMinor, COALESCE(b.lockedMinor,0) lockedMinor,
              COALESCE(b.promotionalMinor,0) promotionalMinor, COALESCE(b.earnedMinor,0) earnedMinor
       FROM currency_registry c LEFT JOIN customer_balances b ON b.currency=c.code AND b.userId=?
       WHERE c.enabled=true ORDER BY c.id`,
      [userId],
    );
    const active = positions.filter((p) => p.status === "ACTIVE");
    const investedMinor = active.reduce((sum, p) => sum + Number(p.principalMinor || 0), 0);
    const expectedProfitMinor = active.reduce((sum, p) => sum + Number(p.expectedProfitMinor || 0), 0);
    const countries = new Set(active.map((p) => String(p.country || ""))).size;
    const rates = active.map((p) => Number(p.couponRateBps || 0)).filter((value) => value > 0);
    const summary = {
      investedMinor,
      expectedProfitMinor,
      activePositions: active.length,
      completedPositions: positions.filter((p) => p.status !== "ACTIVE").length,
      countries,
      averageRatePct: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length)) / 100 : 0,
    };
    const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
    return {
      instruments: catalogue.instruments,
      positions,
      balances,
      settlementCurrency: SETTLEMENT_CURRENCY,
      availableMinor: Number(usd?.availableMinor || 0),
      summary,
      sources: catalogue.sources,
      fetchedAt: catalogue.fetchedAt,
      degraded: catalogue.degraded,
    };
  });
}

/**
 * Purchase a treasury bond from the customer's USD wallet. Debits the existing
 * wallet ledger, locks the principal, and records one position plus a durable
 * notice. Idempotent per request key; the instrument's published rate is
 * re-read server-side so a client cannot dictate the coupon.
 */
export async function purchaseTreasuryBond(
  userId: number,
  input: { instrumentId: string; amountMinor: number; idempotencyKey: string },
) {
  await ensureTreasuryBondSchema();
  const instrument = await findTreasuryBondInstrument(String(input.instrumentId || ""));
  if (!instrument) throw new Error("This treasury bond is not currently published on the desk. Refresh and try again.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid purchase amount");
  if (input.amountMinor < instrument.minInvestmentMinor) {
    throw new Error(`The minimum purchase for ${instrument.name} is ${instrument.minInvestmentMinor} minor units (${(instrument.minInvestmentMinor / 100).toLocaleString()} ${SETTLEMENT_CURRENCY}).`);
  }
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the treasury-bond desk");

  const key = idempotencyKey(input.idempotencyKey, userId);
  const couponBps = rateBps(instrument.couponRatePct);
  const expectedProfitMinor = projectTreasuryBondProfit(input.amountMinor, instrument.couponRatePct, instrument.tenorYears);
  const days = tenureDays(instrument);

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(
        `SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`,
        [userId, key],
      );
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [balanceRows] = await conn.query<any[]>(
        `SELECT * FROM customer_balances WHERE userId=? AND currency=? FOR UPDATE`,
        [userId, SETTLEMENT_CURRENCY],
      );
      const balance = balanceRows[0];
      if (!balance || Number(balance.availableMinor) < input.amountMinor) {
        throw new Error(`Insufficient available ${SETTLEMENT_CURRENCY} balance for this purchase`);
      }

      const now = new Date();
      const maturity = new Date(now.getTime() + days * 86400000);
      const positionCode = `TB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `treasury-bond-purchase:${positionCode}`;

      await conn.execute(
        `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "treasury_bond_purchase", reference],
      );
      await conn.execute(
        `UPDATE customer_balances SET availableMinor=availableMinor-?, lockedMinor=lockedMinor+?, updatedAt=NOW() WHERE id=?`,
        [input.amountMinor, input.amountMinor, balance.id],
      );
      await conn.execute(
        `INSERT INTO treasury_bond_positions
          (positionCode,userId,instrumentId,instrumentName,issuer,country,countryCode,category,couponRateBps,tenorYears,tenureDays,principalMinor,expectedProfitMinor,currency,dataSource,dataAsOf,status,openedAt,maturityAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?, ?)`,
        [
          positionCode, userId, instrument.id, instrument.name, instrument.issuer, instrument.country,
          instrument.countryCode, instrument.category, couponBps, instrument.tenorYears, days,
          input.amountMinor, expectedProfitMinor, SETTLEMENT_CURRENCY, instrument.source, instrument.asOf,
          maturity, reference,
        ],
      );
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Treasury bond purchase confirmed",
          `${instrument.name} was purchased and ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} principal were reserved through the wallet ledger. Expected profit at maturity: ${expectedProfitMinor} minor units.`,
          `u${userId}:treasury-bond:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        country: instrument.country,
        countryCode: instrument.countryCode,
        category: instrument.category,
        couponRatePct: instrument.couponRatePct,
        couponRateBps: couponBps,
        tenorYears: instrument.tenorYears,
        principalMinor: input.amountMinor,
        expectedProfitMinor,
        currency: SETTLEMENT_CURRENCY,
        status: "ACTIVE",
        maturityAt: maturity.toISOString(),
        ledgerReference: reference,
      };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [userId, key, "treasury-bond.purchase", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
