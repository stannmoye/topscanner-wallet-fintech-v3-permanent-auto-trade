import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import { flagFor, findCountry } from "@shared/country-options";
import type { TreasuryBondCategory, TreasuryBondInstrument } from "./treasuryBondProvider";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for administrator-published treasury-bond
 * instruments (kept outside Drizzle, matching the stakeEarn / treasuryBonds
 * pattern). Rows created here are merged into the customer desk beside the live
 * public-data instruments, so an admin-authored bond inherits the same purchase
 * path, ledger and idempotency guarantees.
 */
export const TREASURY_BOND_INSTRUMENTS_TABLE = "treasury_bond_instruments";

const CREATE_INSTRUMENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS treasury_bond_instruments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  instrumentId VARCHAR(80) NOT NULL,
  countryCode VARCHAR(2) NOT NULL,
  country VARCHAR(80) NOT NULL,
  flag VARCHAR(16) NOT NULL,
  issuer VARCHAR(120) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(24) NOT NULL,
  tenorLabel VARCHAR(40) NOT NULL,
  tenorYears DECIMAL(8,4) NOT NULL,
  couponRateBps INT NOT NULL,
  couponFrequency VARCHAR(32) NOT NULL,
  nativeCurrency VARCHAR(12) NOT NULL,
  minInvestmentMinor BIGINT NOT NULL,
  creditQuality VARCHAR(48) NULL,
  riskLabel VARCHAR(80) NULL,
  paymentMethod VARCHAR(64) NULL,
  summary TEXT NULL,
  highlightsJson TEXT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY treasury_bond_instruments_id_idx (instrumentId),
  KEY treasury_bond_instruments_enabled_idx (enabled, category)
) ENGINE=InnoDB`;

export const TREASURY_INSTRUMENT_CATEGORIES = [
  "BILL", "NOTE", "BOND", "TIPS", "FRN", "BENCHMARK", "SOVEREIGN",
] as const;

export type AdminTreasuryInstrumentRow = {
  id: number;
  instrumentId: string;
  countryCode: string;
  country: string;
  flag: string;
  issuer: string;
  name: string;
  category: TreasuryBondCategory;
  tenorLabel: string;
  tenorYears: number;
  couponRateBps: number;
  couponRatePct: number;
  couponFrequency: string;
  nativeCurrency: string;
  minInvestmentMinor: number;
  creditQuality: string;
  riskLabel: string;
  paymentMethod: string;
  summary: string;
  highlights: string[];
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTreasuryInstrumentInput = {
  name: string;
  issuer: string;
  countryCode: string;
  category: TreasuryBondCategory;
  tenorYears: number;
  tenorLabel?: string | null;
  couponRatePct: number;
  couponFrequency?: string | null;
  nativeCurrency?: string | null;
  minInvestmentMinor: number;
  creditQuality?: string | null;
  riskLabel?: string | null;
  paymentMethod?: string | null;
  summary?: string | null;
  highlights?: string[] | null;
  reason?: string | null;
};

const DEFAULT_CURRENCY = "USD";

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const conn = await getSharedMysqlPool().getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive instruments table exists (memoized). */
export function ensureTreasuryBondInstrumentsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_INSTRUMENTS_TABLE_SQL);
      });
    } catch (error) {
      schemaReady = null;
      console.error("[TreasuryBondInstruments] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function tenorLabelFor(years: number): string {
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} months`;
  if (Number.isInteger(years)) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} years`;
}

function parseHighlights(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => text(item, 160)).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 160)).filter(Boolean) : [];
  } catch { return []; }
}

/**
 * Validate and normalize the administrator's submitted fields. Fails closed:
 * an unknown country, an out-of-range rate/tenor or a missing mandatory field
 * throws before anything is written.
 */
function normalizeInput(input: AdminTreasuryInstrumentInput) {
  const name = text(input.name, 120);
  if (name.length < 3) throw new Error("Enter an instrument name of at least 3 characters");
  const issuer = text(input.issuer, 120);
  if (issuer.length < 2) throw new Error("Enter an issuer of at least 2 characters");

  const country = findCountry(input.countryCode);
  if (!country) throw new Error("Select a supported country for this instrument");

  if (!(TREASURY_INSTRUMENT_CATEGORIES as readonly string[]).includes(input.category)) throw new Error("Select a valid instrument category");

  const tenorYears = Number(input.tenorYears);
  if (!Number.isFinite(tenorYears) || tenorYears <= 0 || tenorYears > 60) throw new Error("Enter a tenor between 0 and 60 years");

  const couponRatePct = Number(input.couponRatePct);
  if (!Number.isFinite(couponRatePct) || couponRatePct < 0 || couponRatePct > 100) throw new Error("Enter an interest rate between 0% and 100%");

  const minInvestmentMinor = Number(input.minInvestmentMinor);
  if (!Number.isSafeInteger(minInvestmentMinor) || minInvestmentMinor < 100 || minInvestmentMinor > 100_000_000) {
    throw new Error("Enter a minimum purchase between 1 and 1,000,000 in the settlement currency");
  }

  const nativeCurrency = (text(input.nativeCurrency, 12) || country.currency || DEFAULT_CURRENCY).toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(nativeCurrency)) throw new Error("Enter a valid native currency code");

  const tenorLabel = text(input.tenorLabel, 40) || tenorLabelFor(tenorYears);
  const couponFrequency = text(input.couponFrequency, 32) || "Annual";
  const creditQuality = text(input.creditQuality, 48) || "Investment grade";
  const riskLabel = text(input.riskLabel, 80) || "Low credit risk";
  const paymentMethod = text(input.paymentMethod, 64) || "Wallet balance";
  const couponRateBps = Math.round(couponRatePct * 100);
  const summary = text(input.summary, 2000) || `${name} is a ${tenorLabel} ${input.category.toLowerCase()} issued by ${issuer} (${country.name}) and published for customers on the Arbitrade treasury-bond desk.`;
  const highlights = (Array.isArray(input.highlights) ? input.highlights : [])
    .map((item) => text(item, 160))
    .filter(Boolean)
    .slice(0, 8);

  return { name, issuer, country, category: input.category, tenorYears, tenorLabel, couponRateBps, couponFrequency, nativeCurrency, minInvestmentMinor, creditQuality, riskLabel, paymentMethod, summary, highlights };
}

function rowToRecord(row: any): AdminTreasuryInstrumentRow {
  return {
    id: Number(row.id),
    instrumentId: String(row.instrumentId),
    countryCode: String(row.countryCode),
    country: String(row.country),
    flag: String(row.flag || flagFor(String(row.countryCode))),
    issuer: String(row.issuer),
    name: String(row.name),
    category: row.category as TreasuryBondCategory,
    tenorLabel: String(row.tenorLabel),
    tenorYears: Number(row.tenorYears),
    couponRateBps: Number(row.couponRateBps),
    couponRatePct: Number(row.couponRateBps) / 100,
    couponFrequency: String(row.couponFrequency || "Annual"),
    nativeCurrency: String(row.nativeCurrency || DEFAULT_CURRENCY),
    minInvestmentMinor: Number(row.minInvestmentMinor),
    creditQuality: String(row.creditQuality || "Investment grade"),
    riskLabel: String(row.riskLabel || "Low credit risk"),
    paymentMethod: String(row.paymentMethod || "Wallet balance"),
    summary: String(row.summary || ""),
    highlights: parseHighlights(row.highlightsJson),
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Project an administrator row into the shared customer-facing instrument shape. */
export function adminRowToInstrument(row: AdminTreasuryInstrumentRow): TreasuryBondInstrument {
  return {
    id: row.instrumentId,
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    issuer: row.issuer,
    name: row.name,
    category: row.category,
    tenorLabel: row.tenorLabel,
    tenorYears: row.tenorYears,
    couponRatePct: row.couponRatePct,
    couponFrequency: row.couponFrequency,
    nativeCurrency: row.nativeCurrency,
    minInvestmentMinor: row.minInvestmentMinor,
    creditQuality: row.creditQuality,
    riskLabel: row.riskLabel,
    paymentMethod: row.paymentMethod,
    source: "Arbitrade desk — administrator published",
    sourceSeries: `admin:${row.instrumentId}`,
    asOf: row.updatedAt,
    summary: row.summary,
    highlights: row.highlights,
    history: [],
  };
}

async function recordAudit(conn: Db, actorUserId: number, action: string, instrumentId: string, reason: string | null | undefined, metadata: unknown) {
  await conn.execute(
    `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
    [actorUserId, action, "treasury_bond_instrument", instrumentId, text(reason, 500) || null, `treasury-instrument:${instrumentId}`, JSON.stringify(metadata ?? {})],
  );
}

async function uniqueInstrumentId(conn: Db, base: string): Promise<string> {
  const root = base.slice(0, 72) || `admin-${crypto.randomBytes(3).toString("hex")}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [rows] = await conn.query<any[]>(`SELECT 1 FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=? LIMIT 1`, [candidate]);
    if (!rows.length) return candidate;
  }
  return `admin-${crypto.randomBytes(6).toString("hex")}`;
}

/** All administrator-published instruments, newest first, for the admin console. */
export async function listAdminTreasuryBondInstruments(): Promise<AdminTreasuryInstrumentRow[]> {
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToRecord);
  });
}

/** Enabled administrator instruments projected for the customer desk. */
export async function listEnabledAdminTreasuryBondInstruments(): Promise<TreasuryBondInstrument[]> {
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => adminRowToInstrument(rowToRecord(row)));
  });
}

/** Resolve a single enabled administrator instrument for a purchase, or null. */
export async function findEnabledAdminTreasuryBondInstrument(instrumentId: string): Promise<TreasuryBondInstrument | null> {
  const id = text(instrumentId, 80);
  if (!id) return null;
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? adminRowToInstrument(rowToRecord(rows[0])) : null;
  });
}

/** Create an administrator-published instrument. Enabled on submit. */
export async function createAdminTreasuryBondInstrument(adminUserId: number, input: AdminTreasuryInstrumentInput): Promise<AdminTreasuryInstrumentRow> {
  const normalized = normalizeInput(input);
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const base = `admin-${normalized.country.code.toLowerCase()}-${slugify(normalized.name) || "instrument"}`;
    const instrumentId = await uniqueInstrumentId(conn, base);
    const flag = flagFor(normalized.country.code);
    await conn.execute(
      `INSERT INTO ${TREASURY_BOND_INSTRUMENTS_TABLE}
        (instrumentId,countryCode,country,flag,issuer,name,category,tenorLabel,tenorYears,couponRateBps,couponFrequency,nativeCurrency,minInvestmentMinor,creditQuality,riskLabel,paymentMethod,summary,highlightsJson,enabled,createdByUserId,updatedByUserId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        instrumentId, normalized.country.code, normalized.country.name, flag, normalized.issuer, normalized.name,
        normalized.category, normalized.tenorLabel, normalized.tenorYears, normalized.couponRateBps,
        normalized.couponFrequency, normalized.nativeCurrency, normalized.minInvestmentMinor, normalized.creditQuality,
        normalized.riskLabel, normalized.paymentMethod, normalized.summary, JSON.stringify(normalized.highlights),
        adminUserId, adminUserId,
      ],
    );
    await recordAudit(conn, adminUserId, "treasury_instrument_created", instrumentId, input.reason, {
      instrumentId, countryCode: normalized.country.code, category: normalized.category,
      couponRatePct: normalized.couponRateBps / 100, tenorYears: normalized.tenorYears, minInvestmentMinor: normalized.minInvestmentMinor,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=? LIMIT 1`, [instrumentId]);
    return rowToRecord(rows[0]);
  });
}

/** Update an existing administrator instrument; the country flag is re-derived. */
export async function updateAdminTreasuryBondInstrument(adminUserId: number, instrumentId: string, input: AdminTreasuryInstrumentInput): Promise<AdminTreasuryInstrumentRow> {
  const id = text(instrumentId, 80);
  if (!id) throw new Error("A valid instrument id is required");
  const normalized = normalizeInput(input);
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT instrumentId FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This instrument no longer exists on the desk");
    const flag = flagFor(normalized.country.code);
    await conn.execute(
      `UPDATE ${TREASURY_BOND_INSTRUMENTS_TABLE}
        SET countryCode=?,country=?,flag=?,issuer=?,name=?,category=?,tenorLabel=?,tenorYears=?,couponRateBps=?,couponFrequency=?,nativeCurrency=?,minInvestmentMinor=?,creditQuality=?,riskLabel=?,paymentMethod=?,summary=?,highlightsJson=?,updatedByUserId=?,updatedAt=NOW(3)
       WHERE instrumentId=?`,
      [
        normalized.country.code, normalized.country.name, flag, normalized.issuer, normalized.name, normalized.category,
        normalized.tenorLabel, normalized.tenorYears, normalized.couponRateBps, normalized.couponFrequency,
        normalized.nativeCurrency, normalized.minInvestmentMinor, normalized.creditQuality, normalized.riskLabel,
        normalized.paymentMethod, normalized.summary, JSON.stringify(normalized.highlights), adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "treasury_instrument_updated", id, input.reason, {
      instrumentId: id, countryCode: normalized.country.code, category: normalized.category,
      couponRatePct: normalized.couponRateBps / 100, tenorYears: normalized.tenorYears, minInvestmentMinor: normalized.minInvestmentMinor,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=? LIMIT 1`, [id]);
    return rowToRecord(rows[0]);
  });
}

/** Enable or disable an instrument. Disabled instruments leave the customer desk. */
export async function setAdminTreasuryBondInstrumentEnabled(adminUserId: number, instrumentId: string, enabled: boolean): Promise<AdminTreasuryInstrumentRow> {
  const id = text(instrumentId, 80);
  if (!id) throw new Error("A valid instrument id is required");
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${TREASURY_BOND_INSTRUMENTS_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE instrumentId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This instrument no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "treasury_instrument_enabled" : "treasury_instrument_disabled", id, null, { instrumentId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=? LIMIT 1`, [id]);
    return rowToRecord(rows[0]);
  });
}

/** Permanently remove an administrator instrument. */
export async function deleteAdminTreasuryBondInstrument(adminUserId: number, instrumentId: string): Promise<{ instrumentId: string; deleted: boolean }> {
  const id = text(instrumentId, 80);
  if (!id) throw new Error("A valid instrument id is required");
  await ensureTreasuryBondInstrumentsSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${TREASURY_BOND_INSTRUMENTS_TABLE} WHERE instrumentId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "treasury_instrument_deleted", id, null, { instrumentId: id });
    return { instrumentId: id, deleted };
  });
}
