import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import {
  ECONOMICS_BOUNDS,
  TERM_DAY_CHOICES,
  addMonthsToIsoDate,
  assignDeskEconomics,
  economicsScatterFactor,
  normalizeEconomicsOverride,
  usdMinorToCurrencyMinor,
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
  const conn = await getSharedMysqlPool().getConnection();
  try { return await fn(conn); } finally { conn.release(); }
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

/** The one-off shifts applied on top of a bulk field patch. */
export type DeskEconomicsBulkOptions = {
  /** One USD amount applied to every selected opportunity, converted into each row's currency. */
  amountUsdMinor?: number;
  /** Whole calendar months added to every selected opportunity's funding-close date. */
  extendCloseMonths?: number;
  /** Whole calendar months added to every selected opportunity's payout (maturity) date. */
  extendMaturityMonths?: number;
  /**
   * A relative interest change in basis points applied to each opportunity's
   * current rate (e.g. +200 = +2%). Because each row starts from its own rate the
   * results differ naturally, so the whole selection moves without becoming
   * identical. Clamped to the published profit bounds.
   */
  adjustProfitBps?: number;
  /**
   * A scatter span as a percentage (0–50). When set, each opportunity's amount,
   * interest, fee and term are nudged by a deterministic per-row factor in
   * `[1 − span, 1 + span]`, so a bulk edit lands varied rather than uniform. The
   * amounts are re-quantised to a nice local step and the rates/term to their
   * published steps.
   */
  variancePct?: number;
  /** Seed for the scatter draw; omit for fresh variety on every call. */
  seed?: string;
};

/** Snap a scattered rate onto its published step and clamp it to the published bounds. */
function clampStepBps(value: number, lo: number, hi: number, step: number): number {
  const snapped = Math.round((Number(value) || 0) / step) * step;
  return Math.max(lo, Math.min(hi, snapped));
}

/** Snap a scattered term (days) onto the nearest published term choice inside the bounds. */
function snapTermDays(value: number): number {
  const bounds = ECONOMICS_BOUNDS;
  const clamped = Math.max(bounds.termMinDays, Math.min(bounds.termMaxDays, Math.round(Number(value) || 0)));
  let best = TERM_DAY_CHOICES[0] ?? bounds.termMinDays;
  for (const choice of TERM_DAY_CHOICES) {
    if (Math.abs(choice - clamped) < Math.abs(best - clamped)) best = choice;
  }
  return best;
}

/**
 * Apply one administrator edit to many opportunities in a single action — the
 * bulk editor behind the admin Desk Economics console. Every field in `patch` is
 * applied verbatim (in each opportunity's own units); the optional
 * `amountUsdMinor` is converted into each opportunity's presentation currency,
 * and the optional month counts shift the stored close / payout dates by whole
 * calendar months without drifting the day. Each touched row is written as
 * `ADMIN` so the auto-assignment can never overwrite the human decision. Rows
 * with nothing to change are returned untouched.
 */
export async function setDeskEconomicsBulkOverride(
  desk: DeskKey,
  instrumentIds: string[],
  patch: EconomicsOverrideInput,
  options: DeskEconomicsBulkOptions = {},
  adminUserId: number | null = null,
): Promise<DeskEconomics[]> {
  const ids = [...new Set(instrumentIds.map((id) => String(id).trim()).filter(Boolean))];
  const results: DeskEconomics[] = [];
  const bounds = ECONOMICS_BOUNDS;
  const amountUsdMinor = Number(options.amountUsdMinor);
  const extendCloseMonths = Number(options.extendCloseMonths);
  const extendMaturityMonths = Number(options.extendMaturityMonths);
  const adjustProfitBps = Number(options.adjustProfitBps);
  const variancePct = Number(options.variancePct);
  const scatterOn = Number.isFinite(variancePct) && variancePct > 0;
  // One seed for the whole call: every row draws its own factor, so the scatter is
  // varied row-to-row yet reproducible within the call when the caller passes one.
  const seed = String(options.seed || "").trim() || `scatter-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  for (const id of ids) {
    const current = await getOrAssignDeskEconomics(desk, id);
    const next: EconomicsOverrideInput = { ...patch };
    const factor = scatterOn ? economicsScatterFactor(desk, id, seed, variancePct) : 1;

    if (Number.isFinite(amountUsdMinor) && amountUsdMinor > 0) {
      const sizedUsd = scatterOn ? Math.max(1, Math.round(amountUsdMinor * factor)) : amountUsdMinor;
      next.fundingTargetMinor = usdMinorToCurrencyMinor(sizedUsd, current.currency);
    }
    // Relative interest change: each row keeps its own base and simply moves, so a
    // "+1% across the board" lands on different absolute rates.
    if (Number.isFinite(adjustProfitBps) && adjustProfitBps !== 0) {
      const base = Number(next.profitBps ?? current.profitBps);
      next.profitBps = Math.min(bounds.profitMaxBps, Math.max(bounds.profitMinBps, Math.round(base + adjustProfitBps)));
    }
    // Scatter the explicit values (opt-in) so a bulk edit does not read as uniform.
    if (scatterOn) {
      if (next.profitBps !== undefined) {
        next.profitBps = clampStepBps(next.profitBps * factor, bounds.profitMinBps, bounds.profitMaxBps, bounds.profitStepBps);
      }
      if (next.platformFeeBps !== undefined) {
        next.platformFeeBps = clampStepBps(next.platformFeeBps * factor, bounds.platformFeeMinBps, bounds.platformFeeMaxBps, bounds.platformFeeStepBps);
      }
      if (next.termDays !== undefined) {
        next.termDays = snapTermDays(next.termDays * factor);
      }
    }
    if (Number.isFinite(extendCloseMonths) && extendCloseMonths > 0) {
      next.closeDate = addMonthsToIsoDate(current.closeDate, extendCloseMonths);
    }
    if (Number.isFinite(extendMaturityMonths) && extendMaturityMonths > 0) {
      next.maturityDate = addMonthsToIsoDate(current.maturityDate, extendMaturityMonths);
    }
    if (!Object.keys(next).length) { results.push(current); continue; }
    results.push(await setDeskEconomicsOverride(desk, id, next, adminUserId));
  }
  return results;
}

/**
 * Re-derive a fresh AUTO profile for many opportunities at once — the console's
 * "make them different again" action. It re-rolls the deterministic assignment
 * from a fresh salt so every selected offer gets new, still-realistic numbers
 * (some alike, some different), while an opportunity an administrator has already
 * overridden is left untouched unless `includeAdmin` is explicitly set — a
 * re-roll never silently discards a human decision.
 */
export async function reassignDeskEconomicsBulk(
  desk: DeskKey,
  instrumentIds: string[],
  options: { salt?: string; includeAdmin?: boolean } = {},
): Promise<DeskEconomics[]> {
  const ids = [...new Set(instrumentIds.map((id) => String(id).trim()).filter(Boolean))];
  const baseSalt = String(options.salt || "").trim() || `reroll-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const results: DeskEconomics[] = [];
  for (const id of ids) {
    const existing = await getOrAssignDeskEconomics(desk, id);
    if (existing.source === "ADMIN" && !options.includeAdmin) { results.push(existing); continue; }
    const derived = assignDeskEconomics({ desk, instrumentId: id, salt: `${baseSalt}:${id}` });
    const row = await setDeskEconomicsOverride(desk, id, derived, null);
    results.push({ ...row, source: "AUTO" });
  }
  return results;
}
