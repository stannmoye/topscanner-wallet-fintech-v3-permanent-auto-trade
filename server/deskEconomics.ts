import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  assignDeskEconomics,
  normalizeEconomicsOverride,
  currencyByCode,
  type DeskEconomics,
  type DeskKey,
  type EconomicsOverrideInput,
} from "@shared/investment-economics";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for each desk opportunity's auto-assigned
 * economics (kept outside Drizzle, matching the litigation / agro / IP royalty
 * template).
 *
 * When an opportunity is first served on a desk its economics are derived
 * deterministically from its stable id and persisted here as an `AUTO` row.
 * Because the derivation is stable, a re-read returns the same numbers; because
 * it is persisted, an administrator can override any value, and an `ADMIN` row
 * is never re-derived. A missing or unavailable table degrades to pure in-memory
 * derivation so a desk never goes blank.
 */
export const DESK_ECONOMICS_TABLE = "desk_investment_economics";

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS desk_investment_economics (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  desk VARCHAR(24) NOT NULL,
  instrumentId VARCHAR(160) NOT NULL,
  currency VARCHAR(12) NOT NULL,
  currencyScale INT NOT NULL DEFAULT 2,
  ticketMinMinor BIGINT NOT NULL,
  fundingTargetMinor BIGINT NOT NULL,
  profitBps INT NOT NULL,
  termDays INT NOT NULL,
  closeWindowDays INT NOT NULL DEFAULT 7,
  closeDate VARCHAR(24) NOT NULL,
  maturityDate VARCHAR(24) NOT NULL,
  platformFeeBps INT NOT NULL,
  settlementDelayDays INT NULL,
  source VARCHAR(12) NOT NULL DEFAULT 'AUTO',
  assignedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updatedByUserId INT NULL,
  UNIQUE KEY desk_investment_economics_id_idx (desk, instrumentId),
  KEY desk_investment_economics_desk_idx (desk, source)
) ENGINE=InnoDB`;

async function withConnection<T>(fn: (conn: Db) => Promise<T>): Promise<T> {
  const pool = mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 });
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); await pool.end(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive economics table exists (memoized). */
export function ensureDeskEconomicsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    if (!process.env.DATABASE_URL) return;
    await withConnection(async (conn) => { await conn.query(CREATE_TABLE_SQL); });
  })().catch((error) => {
    schemaReady = null;
    console.error("[DeskEconomics] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
  });
  return schemaReady;
}

function rowToEconomics(row: any): DeskEconomics {
  const currency = currencyByCode(String(row.currency)) ?? { code: "USD", scale: 2, symbol: "$", usdPerUnit: 1, weight: 60 };
  return {
    desk: String(row.desk) as DeskKey,
    instrumentId: String(row.instrumentId),
    currency: currency.code,
    currencyScale: Number(row.currencyScale ?? currency.scale ?? 2),
    currencySymbol: currency.symbol,
    ticketMinMinor: Number(row.ticketMinMinor || 0),
    fundingTargetMinor: Number(row.fundingTargetMinor || 0),
    profitBps: Number(row.profitBps || 0),
    termDays: Number(row.termDays || 0),
    closeWindowDays: Number(row.closeWindowDays || 0),
    closeDate: String(row.closeDate || ""),
    maturityDate: String(row.maturityDate || ""),
    platformFeeBps: Number(row.platformFeeBps || 0),
    settlementDelayDays: row.settlementDelayDays === null || row.settlementDelayDays === undefined ? null : Number(row.settlementDelayDays),
    source: row.source === "ADMIN" ? "ADMIN" : "AUTO",
    assignedAt: row.assignedAt ? new Date(row.assignedAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  };
}

/**
 * Return one opportunity's economics, assigning and persisting them on first
 * sight. Fails soft: if the store is unavailable the derived values are still
 * returned (just not persisted).
 */
export async function getOrAssignDeskEconomics(desk: DeskKey, instrumentId: string): Promise<DeskEconomics> {
  const map = await getDeskEconomicsMap(desk, [instrumentId]);
  return map.get(instrumentId) ?? assignDeskEconomics({ desk, instrumentId });
}

/**
 * Return the economics for a batch of opportunities, assigning and persisting the
 * missing ones in one pass. Never throws for storage problems: a broken store
 * yields freshly derived in-memory values so every desk still renders.
 */
export async function getDeskEconomicsMap(desk: DeskKey, instrumentIds: string[]): Promise<Map<string, DeskEconomics>> {
  const ids = [...new Set(instrumentIds.map((id) => String(id)).filter(Boolean))];
  const map = new Map<string, DeskEconomics>();
  if (!ids.length) return map;

  let persisted = new Map<string, DeskEconomics>();
  try {
    await ensureDeskEconomicsSchema();
    if (process.env.DATABASE_URL) {
      const placeholders = ids.map(() => "?").join(",");
      const rows = await withConnection(async (conn) => {
        const [result] = await conn.query<any[]>(
          `SELECT * FROM ${DESK_ECONOMICS_TABLE} WHERE desk=? AND instrumentId IN (${placeholders})`,
          [desk, ...ids],
        );
        return result;
      });
      persisted = new Map(rows.map((row) => [String(row.instrumentId), rowToEconomics(row)]));
    }
  } catch (error) {
    console.error("[DeskEconomics] Failed to read economics:", error instanceof Error ? error.message : "UnknownError");
  }

  const missing: DeskEconomics[] = [];
  for (const id of ids) {
    const existing = persisted.get(id);
    if (existing) { map.set(id, existing); continue; }
    const assigned = assignDeskEconomics({ desk, instrumentId: id });
    map.set(id, assigned);
    missing.push(assigned);
  }

  if (missing.length && process.env.DATABASE_URL) {
    try {
      const values = missing.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const params: any[] = [];
      for (const item of missing) {
        params.push(
          item.desk, item.instrumentId, item.currency, item.currencyScale, item.ticketMinMinor,
          item.fundingTargetMinor, item.profitBps, item.termDays, item.closeWindowDays, item.closeDate,
          item.maturityDate, item.platformFeeBps, item.settlementDelayDays, item.source, item.assignedAt,
        );
      }
      await withConnection(async (conn) => {
        await conn.query(
          `INSERT IGNORE INTO ${DESK_ECONOMICS_TABLE}
            (desk,instrumentId,currency,currencyScale,ticketMinMinor,fundingTargetMinor,profitBps,termDays,closeWindowDays,closeDate,maturityDate,platformFeeBps,settlementDelayDays,source,assignedAt)
           VALUES ${values}`,
          params,
        );
      });
    } catch (error) {
      // Persistence is best-effort; the derived values already satisfy the request.
      console.error("[DeskEconomics] Failed to persist assignments:", error instanceof Error ? error.message : "UnknownError");
    }
  }

  return map;
}

/** Every stored economic profile on one desk (or the whole platform), for the admin console. */
export async function listDeskEconomics(desk?: DeskKey): Promise<DeskEconomics[]> {
  try {
    await ensureDeskEconomicsSchema();
    if (!process.env.DATABASE_URL) return [];
    const rows = await withConnection(async (conn) => {
      const [result] = desk
        ? await conn.query<any[]>(`SELECT * FROM ${DESK_ECONOMICS_TABLE} WHERE desk=? ORDER BY updatedAt DESC LIMIT 2000`, [desk])
        : await conn.query<any[]>(`SELECT * FROM ${DESK_ECONOMICS_TABLE} ORDER BY updatedAt DESC LIMIT 2000`);
      return result;
    });
    return rows.map(rowToEconomics);
  } catch (error) {
    console.error("[DeskEconomics] Failed to list economics:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Write an administrator override for one opportunity. The row is created if it
 * does not exist, then patched; it is always marked `ADMIN` so the auto-assignment
 * never overwrites a human decision. Returns the stored profile.
 */
export async function setDeskEconomicsOverride(
  desk: DeskKey,
  instrumentId: string,
  patch: EconomicsOverrideInput,
  adminUserId: number | null = null,
): Promise<DeskEconomics> {
  const clean = normalizeEconomicsOverride(patch);
  const current = await getOrAssignDeskEconomics(desk, instrumentId);
  const next: DeskEconomics = {
    ...current,
    ...clean,
    desk,
    instrumentId,
    source: "ADMIN",
    updatedAt: new Date().toISOString(),
  };

  if (process.env.DATABASE_URL) {
    try {
      await ensureDeskEconomicsSchema();
      await withConnection(async (conn) => {
        await conn.execute(
          `INSERT INTO ${DESK_ECONOMICS_TABLE}
            (desk,instrumentId,currency,currencyScale,ticketMinMinor,fundingTargetMinor,profitBps,termDays,closeWindowDays,closeDate,maturityDate,platformFeeBps,settlementDelayDays,source,assignedAt,updatedByUserId)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             currency=VALUES(currency), currencyScale=VALUES(currencyScale), ticketMinMinor=VALUES(ticketMinMinor),
             fundingTargetMinor=VALUES(fundingTargetMinor), profitBps=VALUES(profitBps), termDays=VALUES(termDays),
             closeWindowDays=VALUES(closeWindowDays), closeDate=VALUES(closeDate), maturityDate=VALUES(maturityDate),
             platformFeeBps=VALUES(platformFeeBps), settlementDelayDays=VALUES(settlementDelayDays),
             source=VALUES(source), updatedByUserId=VALUES(updatedByUserId), updatedAt=NOW(3)`,
          [
            next.desk, next.instrumentId, next.currency, next.currencyScale, next.ticketMinMinor,
            next.fundingTargetMinor, next.profitBps, next.termDays, next.closeWindowDays, next.closeDate,
            next.maturityDate, next.platformFeeBps, next.settlementDelayDays, next.source, next.assignedAt, adminUserId,
          ],
        );
      });
    } catch (error) {
      console.error("[DeskEconomics] Failed to persist override:", error instanceof Error ? error.message : "UnknownError");
    }
  }

  return next;
}

/** Re-derive (and re-persist) an AUTO row from a fresh salt, leaving ADMIN rows untouched. */
export async function reassignDeskEconomics(desk: DeskKey, instrumentId: string, salt: string): Promise<DeskEconomics> {
  const derived = assignDeskEconomics({ desk, instrumentId, salt });
  const existing = await getOrAssignDeskEconomics(desk, instrumentId);
  if (existing.source === "ADMIN") return existing;
  return setDeskEconomicsOverride(desk, instrumentId, derived, null).then((row) => ({ ...row, source: "AUTO" }));
}
