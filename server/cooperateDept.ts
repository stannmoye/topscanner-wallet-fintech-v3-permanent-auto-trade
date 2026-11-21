import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  compareCooperateDeptCompanies,
  findCooperateDeptCompany,
  getCooperateDeptCatalogue,
  type CooperateDeptCompany,
} from "@shared/cooperate-dept-catalogue";
import {
  findEnabledAdminCooperateDeptCompany,
  listEnabledAdminCooperateDeptCompanies,
  type OwnershipBasis,
} from "./cooperateDeptCompanies";

type Db = mysql.PoolConnection;

/** Additive, self-hosted storage for Cooperate Dept commitments (outside Drizzle). */
export const COOPERATE_DEPT_POSITIONS_TABLE = "cooperate_dept_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS cooperate_dept_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  companyId VARCHAR(80) NOT NULL,
  companyName VARCHAR(200) NOT NULL,
  country VARCHAR(80) NULL,
  countryCode VARCHAR(8) NULL,
  severity VARCHAR(16) NULL,
  companyStatus VARCHAR(24) NULL,
  ownershipBasis VARCHAR(24) NOT NULL,
  amountMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  targetDate VARCHAR(24) NULL,
  dataSource VARCHAR(160) NULL,
  dataAsOf VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY cooperate_dept_positions_code_idx (positionCode),
  KEY cooperate_dept_positions_user_idx (userId, status)
) ENGINE=InnoDB`;

const SETTLEMENT_CURRENCY = "USD";
const MAX_COMMITMENT_MINOR = 100_000_000; // $1,000,000 ceiling per commitment

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
export function ensureCooperateDeptSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_POSITIONS_TABLE_SQL);
      });
    } catch (error) {
      schemaReady = null;
      console.error("[CooperateDept] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `cooperate-dept:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Read one customer's stored Cooperate Dept commitments and wallet balances.
 * Storage is strictly best-effort: a database hiccup must never hide the live
 * company catalogue, so failures degrade to an empty store plus a warning.
 */
async function readCooperateDeptStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
  try {
    await ensureCooperateDeptSchema();
    return await withConnection(async (conn) => {
      const [positions] = await conn.query<any[]>(
        `SELECT id, positionCode, companyId, companyName, country, countryCode, severity, companyStatus,
                ownershipBasis, amountMinor, currency, targetDate, dataSource, dataAsOf, status, openedAt, ledgerReference
         FROM cooperate_dept_positions WHERE userId=? ORDER BY openedAt DESC`,
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
      return { positions, balances, warning: null };
    });
  } catch (error) {
    console.error("[CooperateDept] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    return {
      positions: [],
      balances: [],
      warning: "Your saved commitments and wallet balance could not be loaded right now. The live catalogue below is unaffected.",
    };
  }
}

/**
 * Read administrator-published companies for the customer desk. Best-effort:
 * a database hiccup must never hide the live public-register catalogue.
 */
async function readAdminCompanies(): Promise<CooperateDeptCompany[]> {
  try {
    return await listEnabledAdminCooperateDeptCompanies();
  } catch (error) {
    console.error("[CooperateDept] Failed to read administrator companies:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Assemble the Cooperate Dept desk for one customer: the live company catalogue
 * plus administrator-published companies, that customer's own commitments,
 * wallet balances and a derived summary. The catalogue read and the storage
 * read run independently so a failure in either one still returns the rest.
 */
export async function getCooperateDeptDashboard(userId: number) {
  const [catalogue, store, adminCompanies] = await Promise.all([
    getCooperateDeptCatalogue(),
    readCooperateDeptStore(userId),
    readAdminCompanies(),
  ]);

  const companies = [...adminCompanies, ...catalogue.companies].sort(compareCooperateDeptCompanies);
  const sources = adminCompanies.length
    ? [...catalogue.sources, {
        name: "Arbitrade desk — administrator published",
        url: "",
        country: "XX",
        role: "companies" as const,
        status: "ok" as const,
        detail: `${adminCompanies.length} administrator-published compan${adminCompanies.length === 1 ? "y" : "ies"}`,
      }]
    : catalogue.sources;

  const positions = store.positions;
  const balances = store.balances;
  const active = positions.filter((p) => p.status === "ACTIVE");
  const committedMinor = active.reduce((sum, p) => sum + Number(p.amountMinor || 0), 0);
  const countries = new Set(active.map((p) => String(p.country || "")).filter(Boolean)).size;
  const critical = companies.filter((company) => company.severity === "CRITICAL").length;
  const imminent = companies.filter((company) => {
    if (!company.countdown || company.countdown.direction !== "until") return false;
    const target = Date.parse(company.countdown.targetDate);
    if (!Number.isFinite(target)) return false;
    return target - Date.now() <= 90 * 86400000;
  }).length;
  const summary = {
    committedMinor,
    activeCommitments: active.length,
    completedCommitments: positions.filter((p) => p.status !== "ACTIVE").length,
    countries,
    criticalCompanies: critical,
    imminentLitigation: imminent,
  };
  const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
  return {
    companies,
    positions,
    balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    availableMinor: Number(usd?.availableMinor || 0),
    summary,
    sources,
    fetchedAt: catalogue.fetchedAt,
    degraded: catalogue.degraded,
    storeWarning: store.warning,
  };
}

/**
 * Resolve the company for a commitment. Administrator-published companies are
 * checked first so a manually created record never depends on the public data
 * providers; a lookup failure there falls through to the live catalogue.
 */
async function resolveCompanyForCommitment(companyId: string): Promise<CooperateDeptCompany | null> {
  try {
    const admin = await findEnabledAdminCooperateDeptCompany(companyId);
    if (admin) return admin;
  } catch (error) {
    console.error("[CooperateDept] Failed to resolve administrator company:", error instanceof Error ? error.message : "UnknownError");
  }
  return findCooperateDeptCompany(companyId);
}

/**
 * Reserve a commitment against a company from the customer's USD wallet.
 * Debits the existing wallet ledger, locks the amount as a commitment, and
 * records one position plus a durable notice. Idempotent per request key; the
 * company's published data is re-read server-side so a client cannot dictate
 * severity, ownership basis or the recorded source.
 */
export async function commitCooperateDeptInterest(
  userId: number,
  input: { companyId: string; amountMinor: number; ownershipBasis: OwnershipBasis; idempotencyKey: string },
) {
  await ensureCooperateDeptSchema();
  const company = await resolveCompanyForCommitment(String(input.companyId || ""));
  if (!company) throw new Error("This company is not currently published on the Cooperate Dept desk. Refresh and try again.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid commitment amount");
  if (input.amountMinor > MAX_COMMITMENT_MINOR) throw new Error("This amount exceeds the per-commitment ceiling for the Cooperate Dept desk");
  if (!["SHARES", "FULL_OWNERSHIP", "ASSET_PURCHASE"].includes(input.ownershipBasis)) throw new Error("Select a valid ownership basis");

  const key = idempotencyKey(input.idempotencyKey, userId);
  const targetDate = company.countdown?.targetDate || null;

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
        throw new Error(`Insufficient available ${SETTLEMENT_CURRENCY} balance for this commitment`);
      }

      const now = new Date();
      const positionCode = `CD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `cooperate-dept-commitment:${positionCode}`;

      await conn.execute(
        `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "cooperate_dept_commitment", reference],
      );
      await conn.execute(
        `UPDATE customer_balances SET availableMinor=availableMinor-?, lockedMinor=lockedMinor+?, updatedAt=NOW() WHERE id=?`,
        [input.amountMinor, input.amountMinor, balance.id],
      );
      await conn.execute(
        `INSERT INTO cooperate_dept_positions
          (positionCode,userId,companyId,companyName,country,countryCode,severity,companyStatus,ownershipBasis,amountMinor,currency,targetDate,dataSource,dataAsOf,status,openedAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, company.id, company.name, company.country, company.countryCode,
          company.severity, company.status, input.ownershipBasis, input.amountMinor, SETTLEMENT_CURRENCY,
          targetDate, company.source, company.asOf, reference,
        ],
      );
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Cooperate Dept commitment recorded",
          `A ${input.ownershipBasis === "FULL_OWNERSHIP" ? "full-ownership" : input.ownershipBasis === "SHARES" ? "share" : "asset-purchase"} commitment of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} was reserved against ${company.name} through the wallet ledger. The desk administrator will contact you to progress due diligence.`,
          `u${userId}:cooperate-dept:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        companyId: company.id,
        companyName: company.name,
        country: company.country,
        countryCode: company.countryCode,
        severity: company.severity,
        companyStatus: company.status,
        ownershipBasis: input.ownershipBasis,
        amountMinor: input.amountMinor,
        currency: SETTLEMENT_CURRENCY,
        targetDate,
        status: "ACTIVE",
        openedAt: now.toISOString(),
        ledgerReference: reference,
      };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [userId, key, "cooperate-dept.commit", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
