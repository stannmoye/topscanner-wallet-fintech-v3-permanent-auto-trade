import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import { flagFor, findCountry } from "@shared/country-options";
import type {
  CompanyCountdown,
  CompanyStatus,
  CooperateDeptCompany,
  DistressSeverity,
  DistressSignal,
} from "@shared/cooperate-dept-catalogue";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for administrator-published Cooperate Dept
 * companies (kept outside Drizzle, matching the treasuryBondInstruments /
 * stakeEarn pattern). Rows created here are merged into the customer desk
 * beside the live public-register companies, so an admin-authored record
 * inherits the same commitment path, ledger and idempotency guarantees.
 */
export const COOPERATE_DEPT_COMPANIES_TABLE = "cooperate_dept_companies";

const CREATE_COMPANIES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS cooperate_dept_companies (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  companyId VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  legalName VARCHAR(200) NULL,
  countryCode VARCHAR(2) NOT NULL,
  country VARCHAR(80) NOT NULL,
  flag VARCHAR(16) NOT NULL,
  city VARCHAR(80) NULL,
  state VARCHAR(80) NULL,
  region VARCHAR(80) NULL,
  foundedYear INT NULL,
  foundedMonth INT NULL,
  foundersJson TEXT NULL,
  keyPeopleJson TEXT NULL,
  companyType VARCHAR(80) NOT NULL,
  sectorsJson TEXT NULL,
  regulator VARCHAR(160) NULL,
  problem TEXT NOT NULL,
  staffCount INT NULL,
  staffRange VARCHAR(80) NULL,
  financialStatus VARCHAR(120) NOT NULL,
  netWorthNote TEXT NULL,
  regulatorStatus VARCHAR(120) NULL,
  companyStatus VARCHAR(24) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  countdownLabel VARCHAR(120) NULL,
  countdownDate VARCHAR(24) NULL,
  countdownDirection VARCHAR(8) NULL,
  ownershipOpportunity VARCHAR(160) NOT NULL,
  capitalAskMinor BIGINT NULL,
  sourceUrl VARCHAR(300) NULL,
  summary TEXT NULL,
  highlightsJson TEXT NULL,
  identityJson TEXT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY cooperate_dept_companies_id_idx (companyId),
  KEY cooperate_dept_companies_enabled_idx (enabled, severity)
) ENGINE=InnoDB`;

export const COMPANY_STATUSES: readonly CompanyStatus[] = [
  "INSOLVENT", "WINDING_UP", "DISTRESSED", "DISSOLVED", "SEEKING_ACQUIRER", "STARTUP",
];

export const DISTRESS_SEVERITIES: readonly DistressSeverity[] = [
  "CRITICAL", "HIGH", "ELEVATED", "WATCH",
];

export const OWNERSHIP_BASIS_OPTIONS = ["SHARES", "FULL_OWNERSHIP", "ASSET_PURCHASE"] as const;
export type OwnershipBasis = (typeof OWNERSHIP_BASIS_OPTIONS)[number];

export type AdminCooperateDeptCompanyRow = {
  id: number;
  companyId: string;
  name: string;
  legalName: string;
  countryCode: string;
  country: string;
  flag: string;
  city: string;
  state: string;
  region: string;
  foundedYear: number | null;
  foundedMonth: number | null;
  founders: string[];
  keyPeople: string[];
  companyType: string;
  sectors: string[];
  regulator: string;
  problem: string;
  staffCount: number | null;
  staffRange: string;
  financialStatus: string;
  netWorthNote: string;
  regulatorStatus: string;
  status: CompanyStatus;
  severity: DistressSeverity;
  countdownLabel: string;
  countdownDate: string | null;
  countdownDirection: "until" | "since" | null;
  ownershipOpportunity: string;
  capitalAskMinor: number | null;
  sourceUrl: string | null;
  summary: string;
  highlights: string[];
  identity: { lei?: string | null; registrationNumber?: string | null; ticker?: string | null; cik?: string | null };
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCooperateDeptCompanyInput = {
  name: string;
  legalName?: string | null;
  countryCode: string;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  foundedYear?: number | null;
  foundedMonth?: number | null;
  founders?: string[] | null;
  keyPeople?: string[] | null;
  companyType: string;
  sectors?: string[] | null;
  regulator?: string | null;
  problem: string;
  staffCount?: number | null;
  staffRange?: string | null;
  financialStatus: string;
  netWorthNote?: string | null;
  regulatorStatus?: string | null;
  status: CompanyStatus;
  severity: DistressSeverity;
  countdownLabel?: string | null;
  countdownDate?: string | null;
  countdownDirection?: "until" | "since" | null;
  ownershipOpportunity: string;
  capitalAskMinor?: number | null;
  sourceUrl?: string | null;
  summary?: string | null;
  highlights?: string[] | null;
  registrationNumber?: string | null;
  lei?: string | null;
  ticker?: string | null;
  cik?: string | null;
  reason?: string | null;
};

const DEFAULT_SOURCE = "Arbitrade desk — administrator published";
const NET_WORTH_NOTE =
  "No free public register publishes a private company's net worth. Enterprise value, debt and shareholder equity must be requested from the desk administrator and verified against audited accounts before any commitment.";

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const pool = mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 });
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); await pool.end(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive companies table exists (memoized). */
export function ensureCooperateDeptCompaniesSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_COMPANIES_TABLE_SQL);
      });
    } catch (error) {
      schemaReady = null;
      console.error("[CooperateDeptCompanies] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
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

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => text(item, 120)).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 120)).filter(Boolean) : [];
  } catch { return []; }
}

function parseIdentity(raw: unknown): AdminCooperateDeptCompanyRow["identity"] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    if (!parsed || typeof parsed !== "object") return {};
    const out: AdminCooperateDeptCompanyRow["identity"] = {};
    if (parsed.lei) out.lei = text(parsed.lei, 24);
    if (parsed.registrationNumber) out.registrationNumber = text(parsed.registrationNumber, 40);
    if (parsed.ticker) out.ticker = text(parsed.ticker, 12);
    if (parsed.cik) out.cik = text(parsed.cik, 12);
    return out;
  } catch { return {}; }
}

/**
 * Validate and normalize the administrator's submitted fields. Fails closed:
 * an unknown country, an out-of-range year, a missing mandatory field or an
 * inconsistent countdown throws before anything is written.
 */
function normalizeInput(input: AdminCooperateDeptCompanyInput) {
  const name = text(input.name, 160);
  if (name.length < 3) throw new Error("Enter a company name of at least 3 characters");

  const country = findCountry(input.countryCode);
  if (!country) throw new Error("Select a supported country for this company");

  if (!(COMPANY_STATUSES as readonly string[]).includes(input.status)) throw new Error("Select a valid company status");
  if (!(DISTRESS_SEVERITIES as readonly string[]).includes(input.severity)) throw new Error("Select a valid distress severity");

  const companyType = text(input.companyType, 80);
  if (companyType.length < 2) throw new Error("Enter a company type of at least 2 characters");

  const problem = text(input.problem, 2000);
  if (problem.length < 8) throw new Error("Describe the company's problem in at least 8 characters");

  const financialStatus = text(input.financialStatus, 120);
  if (financialStatus.length < 2) throw new Error("Enter the current financial status");

  const ownershipOpportunity = text(input.ownershipOpportunity, 160);
  if (ownershipOpportunity.length < 3) throw new Error("Describe what an investor can take (at least 3 characters)");

  const foundedYear = input.foundedYear === null || input.foundedYear === undefined ? null : Number(input.foundedYear);
  if (foundedYear !== null && (!Number.isInteger(foundedYear) || foundedYear < 1500 || foundedYear > 2100)) {
    throw new Error("Enter a founded year between 1500 and 2100");
  }
  const foundedMonth = input.foundedMonth === null || input.foundedMonth === undefined ? null : Number(input.foundedMonth);
  if (foundedMonth !== null && (!Number.isInteger(foundedMonth) || foundedMonth < 1 || foundedMonth > 12)) {
    throw new Error("Enter a founded month between 1 and 12");
  }
  if (foundedMonth !== null && foundedYear === null) throw new Error("Provide the founded year when a founded month is set");

  const staffCount = input.staffCount === null || input.staffCount === undefined ? null : Number(input.staffCount);
  if (staffCount !== null && (!Number.isInteger(staffCount) || staffCount < 0 || staffCount > 5_000_000)) {
    throw new Error("Enter a staff count of 0 or more");
  }

  const capitalAskMinor = input.capitalAskMinor === null || input.capitalAskMinor === undefined ? null : Number(input.capitalAskMinor);
  if (capitalAskMinor !== null && (!Number.isSafeInteger(capitalAskMinor) || capitalAskMinor < 0 || capitalAskMinor > 100_000_000_000)) {
    throw new Error("Enter a capital requirement up to 1,000,000,000 in the settlement currency");
  }

  const countdownDirection = input.countdownDirection === null || input.countdownDirection === undefined ? null : input.countdownDirection;
  if (countdownDirection !== null && countdownDirection !== "until" && countdownDirection !== "since") {
    throw new Error("Select a valid countdown direction");
  }
  const rawCountdownDate = text(input.countdownDate, 24);
  if (countdownDirection && !/^\d{4}-\d{2}-\d{2}$/.test(rawCountdownDate)) {
    throw new Error("Enter the countdown date as YYYY-MM-DD");
  }
  if (!countdownDirection && rawCountdownDate) throw new Error("Select a countdown direction when a countdown date is set");
  const countdownDate = countdownDirection ? rawCountdownDate : null;

  const founders = (Array.isArray(input.founders) ? input.founders : [])
    .map((person) => text(person, 120)).filter(Boolean).slice(0, 6);
  const keyPeople = (Array.isArray(input.keyPeople) ? input.keyPeople : [])
    .map((person) => text(person, 120)).filter(Boolean).slice(0, 6);
  const sectors = (Array.isArray(input.sectors) ? input.sectors : [])
    .map((sector) => text(sector, 80)).filter(Boolean).slice(0, 8);
  const highlights = (Array.isArray(input.highlights) ? input.highlights : [])
    .map((item) => text(item, 160)).filter(Boolean).slice(0, 8);

  const summary = text(input.summary, 2000)
    || `${name} is a ${country.name} company published on the Arbitrade Cooperate Dept desk as ${input.status.toLowerCase().replace(/_/g, " ")}.`;
  const netWorthNote = text(input.netWorthNote, 1000) || NET_WORTH_NOTE;

  return {
    name,
    legalName: text(input.legalName, 200) || name,
    country,
    city: text(input.city, 80) || null,
    state: text(input.state, 80) || null,
    region: text(input.region, 80) || null,
    foundedYear,
    foundedMonth,
    founders,
    keyPeople,
    companyType,
    sectors,
    regulator: text(input.regulator, 160) || `${country.name} public register`,
    problem,
    staffCount,
    staffRange: text(input.staffRange, 80) || null,
    financialStatus,
    netWorthNote,
    regulatorStatus: text(input.regulatorStatus, 120) || null,
    status: input.status,
    severity: input.severity,
    countdownLabel: text(input.countdownLabel, 120) || null,
    countdownDate,
    countdownDirection,
    ownershipOpportunity,
    capitalAskMinor,
    sourceUrl: text(input.sourceUrl, 300) || null,
    summary,
    highlights,
    identity: {
      registrationNumber: text(input.registrationNumber, 40) || null,
      lei: text(input.lei, 24) || null,
      ticker: text(input.ticker, 12) || null,
      cik: text(input.cik, 12) || null,
    },
  };
}

function rowToRecord(row: any): AdminCooperateDeptCompanyRow {
  const direction = row.countdownDirection === "until" || row.countdownDirection === "since" ? row.countdownDirection : null;
  return {
    id: Number(row.id),
    companyId: String(row.companyId),
    name: String(row.name),
    legalName: String(row.legalName || row.name),
    countryCode: String(row.countryCode),
    country: String(row.country),
    flag: String(row.flag || flagFor(String(row.countryCode))),
    city: String(row.city || ""),
    state: String(row.state || ""),
    region: String(row.region || ""),
    foundedYear: row.foundedYear === null || row.foundedYear === undefined ? null : Number(row.foundedYear),
    foundedMonth: row.foundedMonth === null || row.foundedMonth === undefined ? null : Number(row.foundedMonth),
    founders: parseStringArray(row.foundersJson),
    keyPeople: parseStringArray(row.keyPeopleJson),
    companyType: String(row.companyType),
    sectors: parseStringArray(row.sectorsJson),
    regulator: String(row.regulator || ""),
    problem: String(row.problem || ""),
    staffCount: row.staffCount === null || row.staffCount === undefined ? null : Number(row.staffCount),
    staffRange: String(row.staffRange || ""),
    financialStatus: String(row.financialStatus || ""),
    netWorthNote: String(row.netWorthNote || NET_WORTH_NOTE),
    regulatorStatus: String(row.regulatorStatus || ""),
    status: row.companyStatus as CompanyStatus,
    severity: row.severity as DistressSeverity,
    countdownLabel: String(row.countdownLabel || ""),
    countdownDate: row.countdownDate ? String(row.countdownDate) : null,
    countdownDirection: direction,
    ownershipOpportunity: String(row.ownershipOpportunity || ""),
    capitalAskMinor: row.capitalAskMinor === null || row.capitalAskMinor === undefined ? null : Number(row.capitalAskMinor),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
    summary: String(row.summary || ""),
    highlights: parseStringArray(row.highlightsJson),
    identity: parseIdentity(row.identityJson),
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Project an administrator row into the shared customer-facing company shape.
 * The single distress signal, countdown and highlights are all built from the
 * administrator's own declared fields — nothing is invented here.
 */
export function adminRowToCompany(row: AdminCooperateDeptCompanyRow): CooperateDeptCompany {
  const signal: DistressSignal = {
    code: `admin_${row.status.toLowerCase()}`,
    label: row.regulatorStatus || row.status.replace(/_/g, " "),
    severity: row.severity,
    detail: row.problem,
    date: row.countdownDate,
    source: DEFAULT_SOURCE,
  };
  const countdown: CompanyCountdown | null = row.countdownDate && row.countdownDirection
    ? {
        label: row.countdownLabel || (row.countdownDirection === "until" ? "Key date" : "Declared"),
        direction: row.countdownDirection,
        targetDate: row.countdownDate,
        source: DEFAULT_SOURCE,
      }
    : null;
  const highlights = row.highlights.length
    ? row.highlights
    : [
        row.financialStatus,
        row.staffCount !== null ? `${row.staffCount.toLocaleString()} staff` : row.staffRange || "Staff not published",
        row.regulator || "Regulator not published",
      ].filter(Boolean);

  return {
    id: row.companyId,
    name: row.name,
    legalName: row.legalName,
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    city: row.city || null,
    state: row.state || null,
    region: row.region || null,
    foundedYear: row.foundedYear,
    foundedMonth: row.foundedMonth,
    founderNames: row.founders,
    keyPeople: row.keyPeople,
    companyType: row.companyType,
    sectors: row.sectors,
    regulator: row.regulator || null,
    problem: row.problem,
    staffCount: row.staffCount,
    staffRange: row.staffRange || null,
    financialStatus: row.financialStatus,
    netWorthNote: row.netWorthNote,
    regulatorStatus: row.regulatorStatus || null,
    status: row.status,
    severity: row.severity,
    signals: [signal],
    countdown,
    ownershipOpportunity: row.ownershipOpportunity,
    capitalAskMinor: row.capitalAskMinor,
    source: DEFAULT_SOURCE,
    sourceUrl: row.sourceUrl,
    asOf: row.updatedAt.slice(0, 10),
    summary: row.summary,
    highlights,
    identity: row.identity,
    verified: true,
  };
}

async function recordAudit(conn: Db, actorUserId: number, action: string, companyId: string, reason: string | null | undefined, metadata: unknown) {
  await conn.execute(
    `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
    [actorUserId, action, "cooperate_dept_company", companyId, text(reason, 500) || null, `cooperate-dept-company:${companyId}`, JSON.stringify(metadata ?? {})],
  );
}

async function uniqueCompanyId(conn: Db, base: string): Promise<string> {
  const root = base.slice(0, 72) || `admin-${crypto.randomBytes(3).toString("hex")}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [rows] = await conn.query<any[]>(`SELECT 1 FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=? LIMIT 1`, [candidate]);
    if (!rows.length) return candidate;
  }
  return `admin-${crypto.randomBytes(6).toString("hex")}`;
}

/** All administrator-published companies, newest first, for the admin console. */
export async function listAdminCooperateDeptCompanies(): Promise<AdminCooperateDeptCompanyRow[]> {
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${COOPERATE_DEPT_COMPANIES_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToRecord);
  });
}

/** Enabled administrator companies projected for the customer desk. */
export async function listEnabledAdminCooperateDeptCompanies(): Promise<CooperateDeptCompany[]> {
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => adminRowToCompany(rowToRecord(row)));
  });
}

/** Resolve a single enabled administrator company for a commitment, or null. */
export async function findEnabledAdminCooperateDeptCompany(companyId: string): Promise<CooperateDeptCompany | null> {
  const id = text(companyId, 80);
  if (!id) return null;
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? adminRowToCompany(rowToRecord(rows[0])) : null;
  });
}

/** Create an administrator-published company. Enabled on submit. */
export async function createAdminCooperateDeptCompany(adminUserId: number, input: AdminCooperateDeptCompanyInput): Promise<AdminCooperateDeptCompanyRow> {
  const normalized = normalizeInput(input);
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const base = `admin-${normalized.country.code.toLowerCase()}-${slugify(normalized.name) || "company"}`;
    const companyId = await uniqueCompanyId(conn, base);
    const flag = flagFor(normalized.country.code);
    await conn.execute(
      `INSERT INTO ${COOPERATE_DEPT_COMPANIES_TABLE}
        (companyId,name,legalName,countryCode,country,flag,city,state,region,foundedYear,foundedMonth,foundersJson,keyPeopleJson,companyType,sectorsJson,regulator,problem,staffCount,staffRange,financialStatus,netWorthNote,regulatorStatus,companyStatus,severity,countdownLabel,countdownDate,countdownDirection,ownershipOpportunity,capitalAskMinor,sourceUrl,summary,highlightsJson,identityJson,enabled,createdByUserId,updatedByUserId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        companyId, normalized.name, normalized.legalName, normalized.country.code, normalized.country.name, flag,
        normalized.city, normalized.state, normalized.region, normalized.foundedYear, normalized.foundedMonth,
        JSON.stringify(normalized.founders), JSON.stringify(normalized.keyPeople), normalized.companyType,
        JSON.stringify(normalized.sectors), normalized.regulator, normalized.problem, normalized.staffCount, normalized.staffRange,
        normalized.financialStatus, normalized.netWorthNote, normalized.regulatorStatus, normalized.status, normalized.severity,
        normalized.countdownLabel, normalized.countdownDate, normalized.countdownDirection, normalized.ownershipOpportunity,
        normalized.capitalAskMinor, normalized.sourceUrl, normalized.summary, JSON.stringify(normalized.highlights),
        JSON.stringify(normalized.identity), adminUserId, adminUserId,
      ],
    );
    await recordAudit(conn, adminUserId, "cooperate_dept_company_created", companyId, input.reason, {
      companyId, countryCode: normalized.country.code, status: normalized.status, severity: normalized.severity,
      capitalAskMinor: normalized.capitalAskMinor, countdownDate: normalized.countdownDate,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=? LIMIT 1`, [companyId]);
    return rowToRecord(rows[0]);
  });
}

/** Update an existing administrator company; the country flag is re-derived. */
export async function updateAdminCooperateDeptCompany(adminUserId: number, companyId: string, input: AdminCooperateDeptCompanyInput): Promise<AdminCooperateDeptCompanyRow> {
  const id = text(companyId, 80);
  if (!id) throw new Error("A valid company id is required");
  const normalized = normalizeInput(input);
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT companyId FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This company no longer exists on the desk");
    const flag = flagFor(normalized.country.code);
    await conn.execute(
      `UPDATE ${COOPERATE_DEPT_COMPANIES_TABLE}
        SET name=?,legalName=?,countryCode=?,country=?,flag=?,city=?,state=?,region=?,foundedYear=?,foundedMonth=?,foundersJson=?,keyPeopleJson=?,companyType=?,sectorsJson=?,regulator=?,problem=?,staffCount=?,staffRange=?,financialStatus=?,netWorthNote=?,regulatorStatus=?,companyStatus=?,severity=?,countdownLabel=?,countdownDate=?,countdownDirection=?,ownershipOpportunity=?,capitalAskMinor=?,sourceUrl=?,summary=?,highlightsJson=?,identityJson=?,updatedByUserId=?,updatedAt=NOW(3)
       WHERE companyId=?`,
      [
        normalized.name, normalized.legalName, normalized.country.code, normalized.country.name, flag,
        normalized.city, normalized.state, normalized.region, normalized.foundedYear, normalized.foundedMonth,
        JSON.stringify(normalized.founders), JSON.stringify(normalized.keyPeople), normalized.companyType,
        JSON.stringify(normalized.sectors), normalized.regulator, normalized.problem, normalized.staffCount, normalized.staffRange,
        normalized.financialStatus, normalized.netWorthNote, normalized.regulatorStatus, normalized.status, normalized.severity,
        normalized.countdownLabel, normalized.countdownDate, normalized.countdownDirection, normalized.ownershipOpportunity,
        normalized.capitalAskMinor, normalized.sourceUrl, normalized.summary, JSON.stringify(normalized.highlights),
        JSON.stringify(normalized.identity), adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "cooperate_dept_company_updated", id, input.reason, {
      companyId: id, countryCode: normalized.country.code, status: normalized.status, severity: normalized.severity,
      capitalAskMinor: normalized.capitalAskMinor, countdownDate: normalized.countdownDate,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=? LIMIT 1`, [id]);
    return rowToRecord(rows[0]);
  });
}

/** Enable or disable a company. Disabled companies leave the customer desk. */
export async function setAdminCooperateDeptCompanyEnabled(adminUserId: number, companyId: string, enabled: boolean): Promise<AdminCooperateDeptCompanyRow> {
  const id = text(companyId, 80);
  if (!id) throw new Error("A valid company id is required");
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${COOPERATE_DEPT_COMPANIES_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE companyId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This company no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "cooperate_dept_company_enabled" : "cooperate_dept_company_disabled", id, null, { companyId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=? LIMIT 1`, [id]);
    return rowToRecord(rows[0]);
  });
}

/** Permanently remove an administrator company. */
export async function deleteAdminCooperateDeptCompany(adminUserId: number, companyId: string): Promise<{ companyId: string; deleted: boolean }> {
  const id = text(companyId, 80);
  if (!id) throw new Error("A valid company id is required");
  await ensureCooperateDeptCompaniesSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${COOPERATE_DEPT_COMPANIES_TABLE} WHERE companyId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "cooperate_dept_company_deleted", id, null, { companyId: id });
    return { companyId: id, deleted };
  });
}
