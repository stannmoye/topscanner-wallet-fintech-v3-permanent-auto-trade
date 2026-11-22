import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import { findCountry, flagFor, type CountryOption } from "@shared/country-options";
import {
  IP_RIGHT_TYPES,
  IP_ROYALTY_BASES,
  IP_ROYALTY_CADENCES,
  IP_ROYALTY_DOSSIER_STATUSES,
  IP_ROYALTY_RISK_GRADES,
  compareIpRights,
  expectedAnnualDistMinor,
  remainingDaysFor,
  weightedFunderMultipleBps,
  type IpRight,
  type IpRightType,
  type IpRoyaltyBasis,
  type IpRoyaltyCadence,
  type IpRoyaltyDossierStatus,
  type IpRoyaltyOutcome,
  type IpRoyaltyPaymentHistory,
  type IpRoyaltyPortfolio,
  type IpRoyaltyRiskGrade,
  type IpRoyaltyScenario,
} from "@shared/ip-royalties-catalogue";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for administrator-published IP-royalty dossiers
 * and right portfolios (kept outside Drizzle, matching the
 * litigationFundDossiers / cooperateDept template).
 *
 * The DISCOVERY layer (shared/ip-royalties-catalogue.ts) surfaces real, cited
 * public IP registers; public registers publish ownership, not royalty
 * economics, so discovery contributes no fundable rights. A DOSSIER is the
 * administrator's reviewed, sourced economics for one IP right and is the only
 * thing a customer can fund. Nothing here is invented: an administrator must
 * supply the royalty basis, the term, the modelled distribution scenarios and a
 * source URL with an as-of date.
 */
export const IP_ROYALTY_DOSSIERS_TABLE = "ip_royalty_dossiers";
export const IP_ROYALTY_PORTFOLIOS_TABLE = "ip_royalty_portfolios";

const CREATE_DOSSIERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ip_royalty_dossiers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dossierId VARCHAR(80) NOT NULL,
  rightName VARCHAR(200) NOT NULL,
  rightType VARCHAR(24) NOT NULL,
  licensor VARCHAR(160) NOT NULL,
  licenseeSummary VARCHAR(200) NULL,
  assetClass VARCHAR(120) NULL,
  countryCode VARCHAR(2) NOT NULL,
  country VARCHAR(80) NOT NULL,
  jurisdiction VARCHAR(120) NOT NULL,
  royaltyBasis VARCHAR(24) NOT NULL,
  royaltyRateBps INT NULL,
  perUnitMinor BIGINT NULL,
  cadence VARCHAR(16) NOT NULL,
  termMonths INT NULL,
  minimumGuaranteeMinor BIGINT NULL,
  licenseeCount INT NULL,
  topLicenseeConcentrationBps INT NULL,
  paymentHistoryJson TEXT NULL,
  riskGrade VARCHAR(16) NULL,
  capitalAtRiskMinor BIGINT NULL,
  expectedAnnualDistributionMinor BIGINT NULL,
  expectedMultipleBps INT NULL,
  expectedDurationMonths INT NULL,
  fundingAskMinor BIGINT NULL,
  fundingDeadline VARCHAR(24) NULL,
  dossierStatus VARCHAR(24) NOT NULL DEFAULT 'FUNDING',
  problem TEXT NOT NULL,
  highlightsJson TEXT NULL,
  scenariosJson TEXT NULL,
  source VARCHAR(160) NULL,
  sourceUrl VARCHAR(300) NULL,
  asOf VARCHAR(24) NOT NULL,
  committedMinor BIGINT NOT NULL DEFAULT 0,
  distributedMinor BIGINT NOT NULL DEFAULT 0,
  outcome VARCHAR(24) NULL,
  outcomeRecordedAt DATETIME NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ip_royalty_dossiers_id_idx (dossierId),
  KEY ip_royalty_dossiers_enabled_idx (enabled, dossierStatus)
) ENGINE=InnoDB`;

const CREATE_PORTFOLIOS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ip_royalty_portfolios (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  portfolioId VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  rightType VARCHAR(24) NOT NULL,
  jurisdiction VARCHAR(120) NOT NULL,
  riskGrade VARCHAR(16) NOT NULL,
  targetMinor BIGINT NOT NULL,
  unitPriceMinor BIGINT NOT NULL,
  unitCount INT NOT NULL,
  rightIdsJson TEXT NULL,
  allocationBpsJson TEXT NULL,
  expectedMultipleBps INT NOT NULL,
  expectedDurationMonths INT NULL,
  expectedAnnualDistributionMinor BIGINT NULL,
  summary TEXT NULL,
  source VARCHAR(160) NULL,
  sourceUrl VARCHAR(300) NULL,
  asOf VARCHAR(24) NOT NULL,
  committedMinor BIGINT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ip_royalty_portfolios_id_idx (portfolioId),
  KEY ip_royalty_portfolios_enabled_idx (enabled)
) ENGINE=InnoDB`;

const DEFAULT_SOURCE = "Arbitrade IP royalties desk — administrator published";
const MAX_MINOR = 100_000_000_000;

export type AdminIpRoyaltyDossierRow = {
  id: number;
  dossierId: string;
  rightName: string;
  rightType: IpRightType;
  licensor: string;
  licenseeSummary: string | null;
  assetClass: string | null;
  countryCode: string;
  country: string;
  flag: string;
  jurisdiction: string;
  royaltyBasis: IpRoyaltyBasis;
  royaltyRateBps: number | null;
  perUnitMinor: number | null;
  cadence: IpRoyaltyCadence;
  termMonths: number | null;
  minimumGuaranteeMinor: number | null;
  licenseeCount: number | null;
  topLicenseeConcentrationBps: number | null;
  paymentHistory: IpRoyaltyPaymentHistory | null;
  riskGrade: IpRoyaltyRiskGrade | null;
  capitalAtRiskMinor: number | null;
  expectedAnnualDistributionMinor: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  fundingAskMinor: number | null;
  fundingDeadline: string | null;
  status: IpRoyaltyDossierStatus;
  problem: string;
  highlights: string[];
  scenarios: IpRoyaltyScenario[];
  source: string;
  sourceUrl: string | null;
  asOf: string;
  committedMinor: number;
  distributedMinor: number;
  outcome: IpRoyaltyOutcome | null;
  outcomeRecordedAt: string | null;
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminIpRoyaltyPortfolioRow = {
  id: number;
  portfolioId: string;
  name: string;
  rightType: IpRightType;
  jurisdiction: string;
  riskGrade: IpRoyaltyRiskGrade;
  targetMinor: number;
  unitPriceMinor: number;
  unitCount: number;
  rightIds: string[];
  allocationBpsByRight: Record<string, number>;
  expectedMultipleBps: number;
  expectedDurationMonths: number | null;
  expectedAnnualDistributionMinor: number | null;
  summary: string;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  committedMinor: number;
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminIpRoyaltyScenarioInput = {
  label: string;
  probabilityBps: number;
  expectedAnnualDistributionMinor: number;
  durationMonths: number;
  funderMultipleBps: number;
};

export type AdminIpRoyaltyDossierInput = {
  rightName: string;
  rightType: IpRightType;
  licensor: string;
  licenseeSummary?: string | null;
  assetClass?: string | null;
  countryCode: string;
  jurisdiction?: string | null;
  royaltyBasis: IpRoyaltyBasis;
  royaltyRateBps?: number | null;
  perUnitMinor?: number | null;
  cadence: IpRoyaltyCadence;
  termMonths?: number | null;
  minimumGuaranteeMinor?: number | null;
  licenseeCount?: number | null;
  topLicenseeConcentrationBps?: number | null;
  paymentHistory?: IpRoyaltyPaymentHistory | null;
  riskGrade?: IpRoyaltyRiskGrade | null;
  capitalAtRiskMinor?: number | null;
  expectedAnnualDistributionMinor?: number | null;
  expectedMultipleBps?: number | null;
  expectedDurationMonths?: number | null;
  fundingAskMinor?: number | null;
  fundingDeadline?: string | null;
  status?: IpRoyaltyDossierStatus;
  problem: string;
  highlights?: string[];
  scenarios?: AdminIpRoyaltyScenarioInput[];
  source?: string | null;
  sourceUrl?: string | null;
  asOf: string;
};

export type AdminIpRoyaltyPortfolioInput = {
  name: string;
  rightType: IpRightType;
  jurisdiction: string;
  riskGrade: IpRoyaltyRiskGrade;
  targetMinor: number;
  unitPriceMinor: number;
  unitCount: number;
  rightIds: string[];
  allocationBpsByRight?: Record<string, number>;
  expectedMultipleBps: number;
  expectedDurationMonths?: number | null;
  expectedAnnualDistributionMinor?: number | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  asOf: string;
};

/* --------------------------- low-level helpers --------------------------- */

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const pool = mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 });
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); await pool.end(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive dossier and portfolio tables exist (memoized). */
export function ensureIpRoyaltiesDossierSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_DOSSIERS_TABLE_SQL);
        await conn.query(CREATE_PORTFOLIOS_TABLE_SQL);
      });
    } catch (error) {
      schemaReady = null;
      console.error("[IpRoyaltiesDossiers] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function nullableText(value: unknown, max: number): string | null {
  const trimmed = text(value, max);
  return trimmed ? trimmed : null;
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function parseStringArray(raw: unknown, max: number): string[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean).slice(0, max);
  } catch { return []; }
}

function parseScenarios(raw: unknown): IpRoyaltyScenario[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      label: text(item?.label, 60),
      probabilityBps: Math.round(Number(item?.probabilityBps) || 0),
      expectedAnnualDistributionMinor: Math.max(0, Math.round(Number(item?.expectedAnnualDistributionMinor) || 0)),
      durationMonths: Math.max(0, Math.round(Number(item?.durationMonths) || 0)),
      funderMultipleBps: Math.max(0, Math.round(Number(item?.funderMultipleBps) || 0)),
    })).filter((scenario) => scenario.label);
  } catch { return []; }
}

function parsePaymentHistory(raw: unknown): IpRoyaltyPaymentHistory | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      onTimeBps: Math.max(0, Math.min(10_000, Math.round(Number((parsed as any).onTimeBps) || 0))),
      averageCollectionDays: Math.max(0, Math.round(Number((parsed as any).averageCollectionDays) || 0)),
      periodsObserved: Math.max(0, Math.round(Number((parsed as any).periodsObserved) || 0)),
    };
  } catch { return null; }
}

function parseAllocation(raw: unknown): Record<string, number> {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const numeric = Math.round(Number(value) || 0);
      if (numeric > 0) out[String(key)] = numeric;
    }
    return out;
  } catch { return {}; }
}

async function recordAudit(conn: Db, actorUserId: number, action: string, entityType: string, entityId: string, reason: string | null | undefined, metadata: unknown) {
  await conn.execute(
    `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
    [actorUserId, action, entityType, entityId, nullableText(reason, 500), `${entityType}:${entityId}`, JSON.stringify(metadata ?? {})],
  );
}

async function uniqueId(conn: Db, table: string, column: string, base: string): Promise<string> {
  const root = base.slice(0, 72) || `admin-${crypto.randomBytes(3).toString("hex")}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [rows] = await conn.query<any[]>(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`, [candidate]);
    if (!rows.length) return candidate;
  }
  return `admin-${crypto.randomBytes(6).toString("hex")}`;
}

/* --------------------------- dossier input --------------------------- */

function normalizeDossierInput(input: AdminIpRoyaltyDossierInput) {
  const rightName = text(input.rightName, 200);
  if (!rightName) throw new Error("A right name is required");
  if (!IP_RIGHT_TYPES.includes(input.rightType)) throw new Error("Select a valid IP right type");
  const licensor = text(input.licensor, 160);
  if (!licensor) throw new Error("The licensor (rights owner) is required");
  const country: CountryOption | null = findCountry(input.countryCode);
  if (!country) throw new Error("Select a valid country for this right");
  if (!IP_ROYALTY_BASES.includes(input.royaltyBasis)) throw new Error("Select a valid royalty basis");
  if (!IP_ROYALTY_CADENCES.includes(input.cadence)) throw new Error("Select a valid distribution cadence");
  const status: IpRoyaltyDossierStatus = input.status && IP_ROYALTY_DOSSIER_STATUSES.includes(input.status) ? input.status : "FUNDING";
  const riskGrade = input.riskGrade && IP_ROYALTY_RISK_GRADES.includes(input.riskGrade) ? input.riskGrade : null;
  const problem = text(input.problem, 4_000);
  if (!problem) throw new Error("A synopsis of the right and its royalty stream is required");
  const asOf = text(input.asOf, 24);
  if (!asOf) throw new Error("An as-of date is required");

  const scenarios = (input.scenarios || []).map((scenario) => ({
    label: text(scenario.label, 60),
    probabilityBps: Math.max(0, Math.min(10_000, Math.round(Number(scenario.probabilityBps) || 0))),
    expectedAnnualDistributionMinor: Math.max(0, Math.min(MAX_MINOR, Math.round(Number(scenario.expectedAnnualDistributionMinor) || 0))),
    durationMonths: Math.max(0, Math.min(600, Math.round(Number(scenario.durationMonths) || 0))),
    funderMultipleBps: Math.max(0, Math.min(100_000, Math.round(Number(scenario.funderMultipleBps) || 0))),
  })).filter((scenario) => scenario.label);
  if (scenarios.length) {
    const total = scenarios.reduce((sum, scenario) => sum + scenario.probabilityBps, 0);
    if (total !== 10_000) throw new Error("The modelled scenarios must have probabilities that sum to 100%");
  }

  const royaltyRateBps = intOrNull(input.royaltyRateBps, 0, 10_000);
  const perUnitMinor = intOrNull(input.perUnitMinor, 0, MAX_MINOR);

  return {
    rightName,
    rightType: input.rightType,
    licensor,
    licenseeSummary: nullableText(input.licenseeSummary, 200),
    assetClass: nullableText(input.assetClass, 120),
    country,
    jurisdiction: text(input.jurisdiction, 120) || country.name,
    royaltyBasis: input.royaltyBasis,
    royaltyRateBps,
    perUnitMinor,
    cadence: input.cadence,
    termMonths: intOrNull(input.termMonths, 0, 600),
    minimumGuaranteeMinor: intOrNull(input.minimumGuaranteeMinor, 0, MAX_MINOR),
    licenseeCount: intOrNull(input.licenseeCount, 0, 100_000),
    topLicenseeConcentrationBps: intOrNull(input.topLicenseeConcentrationBps, 0, 10_000),
    paymentHistory: input.paymentHistory ? parsePaymentHistory(input.paymentHistory) : null,
    riskGrade,
    capitalAtRiskMinor: intOrNull(input.capitalAtRiskMinor, 0, MAX_MINOR),
    expectedAnnualDistributionMinor: intOrNull(input.expectedAnnualDistributionMinor, 0, MAX_MINOR),
    expectedMultipleBps: intOrNull(input.expectedMultipleBps, 0, 100_000),
    expectedDurationMonths: intOrNull(input.expectedDurationMonths, 0, 600),
    fundingAskMinor: intOrNull(input.fundingAskMinor, 0, MAX_MINOR),
    fundingDeadline: nullableText(input.fundingDeadline, 24),
    status,
    problem,
    highlights: (input.highlights || []).map((item) => text(item, 300)).filter(Boolean).slice(0, 12),
    scenarios,
    source: nullableText(input.source, 160) || DEFAULT_SOURCE,
    sourceUrl: nullableText(input.sourceUrl, 300),
    asOf,
  };
}

/* --------------------------- dossier row mapping --------------------------- */

function rowToDossier(row: any): AdminIpRoyaltyDossierRow {
  return {
    id: Number(row.id),
    dossierId: String(row.dossierId),
    rightName: String(row.rightName),
    rightType: row.rightType,
    licensor: String(row.licensor),
    licenseeSummary: row.licenseeSummary === null || row.licenseeSummary === undefined ? null : String(row.licenseeSummary),
    assetClass: row.assetClass === null || row.assetClass === undefined ? null : String(row.assetClass),
    countryCode: String(row.countryCode),
    country: String(row.country),
    flag: flagFor(String(row.countryCode)),
    jurisdiction: String(row.jurisdiction || ""),
    royaltyBasis: row.royaltyBasis,
    royaltyRateBps: row.royaltyRateBps === null || row.royaltyRateBps === undefined ? null : Number(row.royaltyRateBps),
    perUnitMinor: row.perUnitMinor === null || row.perUnitMinor === undefined ? null : Number(row.perUnitMinor),
    cadence: row.cadence,
    termMonths: row.termMonths === null || row.termMonths === undefined ? null : Number(row.termMonths),
    minimumGuaranteeMinor: row.minimumGuaranteeMinor === null || row.minimumGuaranteeMinor === undefined ? null : Number(row.minimumGuaranteeMinor),
    licenseeCount: row.licenseeCount === null || row.licenseeCount === undefined ? null : Number(row.licenseeCount),
    topLicenseeConcentrationBps: row.topLicenseeConcentrationBps === null || row.topLicenseeConcentrationBps === undefined ? null : Number(row.topLicenseeConcentrationBps),
    paymentHistory: parsePaymentHistory(row.paymentHistoryJson),
    riskGrade: row.riskGrade ?? null,
    capitalAtRiskMinor: row.capitalAtRiskMinor === null || row.capitalAtRiskMinor === undefined ? null : Number(row.capitalAtRiskMinor),
    expectedAnnualDistributionMinor: row.expectedAnnualDistributionMinor === null || row.expectedAnnualDistributionMinor === undefined ? null : Number(row.expectedAnnualDistributionMinor),
    expectedMultipleBps: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? null : Number(row.expectedMultipleBps),
    expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? null : Number(row.expectedDurationMonths),
    fundingAskMinor: row.fundingAskMinor === null || row.fundingAskMinor === undefined ? null : Number(row.fundingAskMinor),
    fundingDeadline: row.fundingDeadline === null || row.fundingDeadline === undefined ? null : String(row.fundingDeadline),
    status: row.dossierStatus,
    problem: String(row.problem || ""),
    highlights: parseStringArray(row.highlightsJson, 12),
    scenarios: parseScenarios(row.scenariosJson),
    source: String(row.source || DEFAULT_SOURCE),
    sourceUrl: row.sourceUrl === null || row.sourceUrl === undefined ? null : String(row.sourceUrl),
    asOf: String(row.asOf || ""),
    committedMinor: Number(row.committedMinor || 0),
    distributedMinor: Number(row.distributedMinor || 0),
    outcome: row.outcome ?? null,
    outcomeRecordedAt: row.outcomeRecordedAt ? new Date(row.outcomeRecordedAt).toISOString() : null,
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Project an administrator dossier into the shared customer-facing right shape. */
export function dossierRowToRight(row: AdminIpRoyaltyDossierRow): IpRight {
  const fundable = row.status === "FUNDING"
    && Boolean(row.fundingAskMinor && row.fundingAskMinor > 0)
    && row.scenarios.length > 0
    && row.outcome === null;
  const fundedBps = row.fundingAskMinor && row.fundingAskMinor > 0
    ? Math.min(10_000, Math.round((row.committedMinor * 10_000) / row.fundingAskMinor)) : 0;
  return {
    id: row.dossierId,
    rightName: row.rightName,
    rightType: row.rightType,
    licensor: row.licensor,
    licenseeSummary: row.licenseeSummary,
    assetClass: row.assetClass,
    jurisdiction: row.jurisdiction,
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    royaltyBasis: row.royaltyBasis,
    royaltyRateBps: row.royaltyRateBps,
    perUnitMinor: row.perUnitMinor,
    cadence: row.cadence,
    termMonths: row.termMonths,
    minimumGuaranteeMinor: row.minimumGuaranteeMinor,
    licenseeCount: row.licenseeCount,
    topLicenseeConcentrationBps: row.topLicenseeConcentrationBps,
    paymentHistory: row.paymentHistory,
    riskGrade: row.riskGrade,
    capitalAtRiskMinor: row.capitalAtRiskMinor,
    expectedAnnualDistributionMinor: row.expectedAnnualDistributionMinor ?? expectedAnnualDistMinor(row.scenarios),
    expectedMultipleBps: row.expectedMultipleBps ?? weightedFunderMultipleBps(row.scenarios),
    expectedDurationMonths: row.expectedDurationMonths,
    fundingAskMinor: row.fundingAskMinor,
    fundingDeadline: row.fundingDeadline,
    remainingDays: remainingDaysFor(row.fundingDeadline),
    committedMinor: row.committedMinor,
    fundedBps,
    status: row.status,
    fundable,
    problem: row.problem,
    highlights: row.highlights,
    scenarios: row.scenarios,
    source: row.source,
    sourceUrl: row.sourceUrl,
    asOf: row.asOf,
  };
}

/* --------------------------- dossier CRUD --------------------------- */

const DOSSIER_INSERT_COLUMNS =
  "dossierId,rightName,rightType,licensor,licenseeSummary,assetClass,countryCode,country,jurisdiction,royaltyBasis,royaltyRateBps,perUnitMinor,cadence,termMonths,minimumGuaranteeMinor,licenseeCount,topLicenseeConcentrationBps,paymentHistoryJson,riskGrade,capitalAtRiskMinor,expectedAnnualDistributionMinor,expectedMultipleBps,expectedDurationMonths,fundingAskMinor,fundingDeadline,dossierStatus,problem,highlightsJson,scenariosJson,source,sourceUrl,asOf,enabled,createdByUserId,updatedByUserId";

function dossierInsertValues(normalized: ReturnType<typeof normalizeDossierInput>, actor: number) {
  return [
    normalized.rightName, normalized.rightType, normalized.licensor, normalized.licenseeSummary, normalized.assetClass,
    normalized.country.code, normalized.country.name, normalized.jurisdiction, normalized.royaltyBasis,
    normalized.royaltyRateBps, normalized.perUnitMinor, normalized.cadence, normalized.termMonths,
    normalized.minimumGuaranteeMinor, normalized.licenseeCount, normalized.topLicenseeConcentrationBps,
    normalized.paymentHistory ? JSON.stringify(normalized.paymentHistory) : null, normalized.riskGrade,
    normalized.capitalAtRiskMinor, normalized.expectedAnnualDistributionMinor, normalized.expectedMultipleBps,
    normalized.expectedDurationMonths, normalized.fundingAskMinor, normalized.fundingDeadline, normalized.status,
    normalized.problem, JSON.stringify(normalized.highlights), JSON.stringify(normalized.scenarios),
    normalized.source, normalized.sourceUrl, normalized.asOf, 1, actor, actor,
  ];
}

/** All administrator dossiers, newest first, for the admin console. */
export async function listAdminIpRoyaltyDossiers(): Promise<AdminIpRoyaltyDossierRow[]> {
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToDossier);
  });
}

/** Enabled dossiers projected for the customer desk, catalogue-sorted. */
export async function listEnabledAdminIpRoyaltyDossiers(): Promise<IpRight[]> {
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => dossierRowToRight(rowToDossier(row))).sort(compareIpRights);
  });
}

/** Full administrator dossier row by id. */
export async function findAdminIpRoyaltyDossier(dossierId: string): Promise<AdminIpRoyaltyDossierRow | null> {
  const id = text(dossierId, 80);
  if (!id) return null;
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rows.length ? rowToDossier(rows[0]) : null;
  });
}

/** Resolve a single enabled dossier for a customer commitment, or null. */
export async function findEnabledAdminIpRoyaltyDossier(dossierId: string): Promise<IpRight | null> {
  const id = text(dossierId, 80);
  if (!id) return null;
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? dossierRowToRight(rowToDossier(rows[0])) : null;
  });
}

/** Create an administrator dossier. Enabled on submit. */
export async function createAdminIpRoyaltyDossier(adminUserId: number, input: AdminIpRoyaltyDossierInput): Promise<AdminIpRoyaltyDossierRow> {
  const normalized = normalizeDossierInput(input);
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const base = `admin-${slugify(normalized.rightName) || "right"}-${crypto.randomBytes(2).toString("hex")}`;
    const dossierId = await uniqueId(conn, IP_ROYALTY_DOSSIERS_TABLE, "dossierId", base);
    await conn.execute(
      `INSERT INTO ${IP_ROYALTY_DOSSIERS_TABLE} (${DOSSIER_INSERT_COLUMNS}) VALUES (${Array(35).fill("?").join(",")})`,
      [dossierId, ...dossierInsertValues(normalized, adminUserId)],
    );
    await recordAudit(conn, adminUserId, "ip_royalty_dossier_created", "ip_royalty_dossier", dossierId, null, { rightName: normalized.rightName, status: normalized.status });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [dossierId]);
    return rowToDossier(rows[0]);
  });
}

/** Update an administrator dossier by id. */
export async function updateAdminIpRoyaltyDossier(adminUserId: number, dossierId: string, input: AdminIpRoyaltyDossierInput): Promise<AdminIpRoyaltyDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  const normalized = normalizeDossierInput(input);
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT dossierId, outcome FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This dossier no longer exists");
    if (existing[0].outcome) throw new Error("A resolved dossier can no longer be edited");
    await conn.execute(
      `UPDATE ${IP_ROYALTY_DOSSIERS_TABLE} SET rightName=?,rightType=?,licensor=?,licenseeSummary=?,assetClass=?,countryCode=?,country=?,jurisdiction=?,royaltyBasis=?,royaltyRateBps=?,perUnitMinor=?,cadence=?,termMonths=?,minimumGuaranteeMinor=?,licenseeCount=?,topLicenseeConcentrationBps=?,paymentHistoryJson=?,riskGrade=?,capitalAtRiskMinor=?,expectedAnnualDistributionMinor=?,expectedMultipleBps=?,expectedDurationMonths=?,fundingAskMinor=?,fundingDeadline=?,dossierStatus=?,problem=?,highlightsJson=?,scenariosJson=?,source=?,sourceUrl=?,asOf=?,updatedByUserId=? WHERE dossierId=?`,
      [
        normalized.rightName, normalized.rightType, normalized.licensor, normalized.licenseeSummary, normalized.assetClass,
        normalized.country.code, normalized.country.name, normalized.jurisdiction, normalized.royaltyBasis,
        normalized.royaltyRateBps, normalized.perUnitMinor, normalized.cadence, normalized.termMonths,
        normalized.minimumGuaranteeMinor, normalized.licenseeCount, normalized.topLicenseeConcentrationBps,
        normalized.paymentHistory ? JSON.stringify(normalized.paymentHistory) : null, normalized.riskGrade,
        normalized.capitalAtRiskMinor, normalized.expectedAnnualDistributionMinor, normalized.expectedMultipleBps,
        normalized.expectedDurationMonths, normalized.fundingAskMinor, normalized.fundingDeadline, normalized.status,
        normalized.problem, JSON.stringify(normalized.highlights), JSON.stringify(normalized.scenarios),
        normalized.source, normalized.sourceUrl, normalized.asOf, adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "ip_royalty_dossier_updated", "ip_royalty_dossier", id, null, { rightName: normalized.rightName });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Enable/disable a dossier's presence on the customer desk. */
export async function setAdminIpRoyaltyDossierEnabled(adminUserId: number, dossierId: string, enabled: boolean): Promise<AdminIpRoyaltyDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.execute<any>(`UPDATE ${IP_ROYALTY_DOSSIERS_TABLE} SET enabled=?, updatedByUserId=? WHERE dossierId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (Number(result.affectedRows || 0) !== 1) throw new Error("This dossier no longer exists");
    await recordAudit(conn, adminUserId, "ip_royalty_dossier_enabled_changed", "ip_royalty_dossier", id, null, { enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Change a dossier's lifecycle status. */
export async function setAdminIpRoyaltyDossierStatus(adminUserId: number, dossierId: string, status: IpRoyaltyDossierStatus, reason?: string | null): Promise<AdminIpRoyaltyDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  if (!IP_ROYALTY_DOSSIER_STATUSES.includes(status)) throw new Error("Select a valid dossier status");
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.execute<any>(`UPDATE ${IP_ROYALTY_DOSSIERS_TABLE} SET dossierStatus=?, updatedByUserId=? WHERE dossierId=?`, [status, adminUserId, id]);
    if (Number(result.affectedRows || 0) !== 1) throw new Error("This dossier no longer exists");
    await recordAudit(conn, adminUserId, "ip_royalty_dossier_status_changed", "ip_royalty_dossier", id, reason, { status });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Delete a dossier that has never been funded. */
export async function deleteAdminIpRoyaltyDossier(adminUserId: number, dossierId: string): Promise<{ dossierId: string; deleted: boolean }> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT committedMinor FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    if (!existing.length) return { dossierId: id, deleted: false };
    if (Number(existing[0].committedMinor || 0) > 0) throw new Error("A dossier with funded positions cannot be deleted; withdraw it instead");
    await conn.execute(`DELETE FROM ${IP_ROYALTY_DOSSIERS_TABLE} WHERE dossierId=?`, [id]);
    await recordAudit(conn, adminUserId, "ip_royalty_dossier_deleted", "ip_royalty_dossier", id, null, {});
    return { dossierId: id, deleted: true };
  });
}

/** Increment the distributed total on a dossier inside a distribution transaction. */
export async function applyIpRoyaltyDistribution(conn: Db, dossierId: string, amountMinor: number): Promise<void> {
  await conn.execute(
    `UPDATE ${IP_ROYALTY_DOSSIERS_TABLE} SET distributedMinor=distributedMinor+?, updatedAt=NOW(3) WHERE dossierId=?`,
    [Math.max(0, Math.round(amountMinor)), dossierId],
  );
}

/** Record a dossier's final outcome inside a settlement transaction. */
export async function applyIpRoyaltyOutcome(conn: Db, dossierId: string, outcome: IpRoyaltyOutcome): Promise<void> {
  await conn.execute(
    `UPDATE ${IP_ROYALTY_DOSSIERS_TABLE} SET outcome=?, outcomeRecordedAt=NOW(), dossierStatus='COMPLETED', updatedAt=NOW(3) WHERE dossierId=?`,
    [outcome, dossierId],
  );
}

/* --------------------------- portfolio input --------------------------- */

function normalizePortfolioInput(input: AdminIpRoyaltyPortfolioInput) {
  const name = text(input.name, 160);
  if (!name) throw new Error("A portfolio name is required");
  if (!IP_RIGHT_TYPES.includes(input.rightType)) throw new Error("Select a valid IP right type");
  const jurisdiction = text(input.jurisdiction, 120);
  if (!jurisdiction) throw new Error("A jurisdiction is required");
  if (!IP_ROYALTY_RISK_GRADES.includes(input.riskGrade)) throw new Error("Select a valid risk grade");
  const targetMinor = Math.round(Number(input.targetMinor) || 0);
  if (targetMinor <= 0 || targetMinor > MAX_MINOR) throw new Error("Enter a valid funding target");
  const unitPriceMinor = Math.round(Number(input.unitPriceMinor) || 0);
  if (unitPriceMinor <= 0 || unitPriceMinor > MAX_MINOR) throw new Error("Enter a valid unit price");
  const unitCount = Math.round(Number(input.unitCount) || 0);
  if (unitCount <= 0 || unitCount > 1_000_000) throw new Error("Enter a valid unit count");
  const expectedMultipleBps = intOrNull(input.expectedMultipleBps, 0, 100_000) ?? 0;
  const asOf = text(input.asOf, 24);
  if (!asOf) throw new Error("An as-of date is required");

  const rightIds = (input.rightIds || []).map((id) => text(id, 80)).filter(Boolean).slice(0, 50);
  if (!rightIds.length) throw new Error("A portfolio must reference at least one right");
  const rawAllocation = input.allocationBpsByRight || {};
  const allocationBpsByRight: Record<string, number> = {};
  for (const id of rightIds) {
    const weight = Math.round(Number(rawAllocation[id]) || 0);
    if (weight <= 0) throw new Error("Every right in a portfolio needs a positive allocation weight");
    allocationBpsByRight[id] = weight;
  }
  const allocationTotal = Object.values(allocationBpsByRight).reduce((sum, value) => sum + value, 0);
  if (allocationTotal !== 10_000) throw new Error("Portfolio allocation weights must sum to 100%");

  return {
    name, rightType: input.rightType, jurisdiction, riskGrade: input.riskGrade,
    targetMinor, unitPriceMinor, unitCount, rightIds, allocationBpsByRight,
    expectedMultipleBps, expectedDurationMonths: intOrNull(input.expectedDurationMonths, 0, 600),
    expectedAnnualDistributionMinor: intOrNull(input.expectedAnnualDistributionMinor, 0, MAX_MINOR),
    summary: text(input.summary, 2_000),
    source: nullableText(input.source, 160) || DEFAULT_SOURCE,
    sourceUrl: nullableText(input.sourceUrl, 300),
    asOf,
  };
}

function rowToPortfolio(row: any): AdminIpRoyaltyPortfolioRow {
  return {
    id: Number(row.id),
    portfolioId: String(row.portfolioId),
    name: String(row.name),
    rightType: row.rightType,
    jurisdiction: String(row.jurisdiction || ""),
    riskGrade: row.riskGrade,
    targetMinor: Number(row.targetMinor || 0),
    unitPriceMinor: Number(row.unitPriceMinor || 0),
    unitCount: Number(row.unitCount || 0),
    rightIds: parseStringArray(row.rightIdsJson, 50),
    allocationBpsByRight: parseAllocation(row.allocationBpsJson),
    expectedMultipleBps: Number(row.expectedMultipleBps || 0),
    expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? null : Number(row.expectedDurationMonths),
    expectedAnnualDistributionMinor: row.expectedAnnualDistributionMinor === null || row.expectedAnnualDistributionMinor === undefined ? null : Number(row.expectedAnnualDistributionMinor),
    summary: String(row.summary || ""),
    source: String(row.source || DEFAULT_SOURCE),
    sourceUrl: row.sourceUrl === null || row.sourceUrl === undefined ? null : String(row.sourceUrl),
    asOf: String(row.asOf || ""),
    committedMinor: Number(row.committedMinor || 0),
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Project an administrator portfolio into the shared customer-facing shape. */
export function portfolioRowToPortfolio(row: AdminIpRoyaltyPortfolioRow): IpRoyaltyPortfolio {
  const fundedBps = row.targetMinor > 0 ? Math.min(10_000, Math.round((row.committedMinor * 10_000) / row.targetMinor)) : 0;
  return {
    id: row.portfolioId,
    name: row.name,
    rightType: row.rightType,
    jurisdiction: row.jurisdiction,
    riskGrade: row.riskGrade,
    targetMinor: row.targetMinor,
    unitPriceMinor: row.unitPriceMinor,
    unitCount: row.unitCount,
    rightIds: row.rightIds,
    allocationBpsByRight: row.allocationBpsByRight,
    expectedMultipleBps: row.expectedMultipleBps,
    expectedDurationMonths: row.expectedDurationMonths,
    expectedAnnualDistributionMinor: row.expectedAnnualDistributionMinor,
    summary: row.summary,
    committedMinor: row.committedMinor,
    fundedBps,
    fundingDeadline: null,
    remainingDays: null,
    source: row.source,
    sourceUrl: row.sourceUrl,
    asOf: row.asOf,
    enabled: row.enabled,
  };
}

/* --------------------------- portfolio CRUD --------------------------- */

const PORTFOLIO_INSERT_COLUMNS =
  "portfolioId,name,rightType,jurisdiction,riskGrade,targetMinor,unitPriceMinor,unitCount,rightIdsJson,allocationBpsJson,expectedMultipleBps,expectedDurationMonths,expectedAnnualDistributionMinor,summary,source,sourceUrl,asOf,enabled,createdByUserId,updatedByUserId";

function portfolioInsertValues(normalized: ReturnType<typeof normalizePortfolioInput>, actor: number) {
  return [
    normalized.name, normalized.rightType, normalized.jurisdiction, normalized.riskGrade, normalized.targetMinor,
    normalized.unitPriceMinor, normalized.unitCount, JSON.stringify(normalized.rightIds), JSON.stringify(normalized.allocationBpsByRight),
    normalized.expectedMultipleBps, normalized.expectedDurationMonths, normalized.expectedAnnualDistributionMinor,
    normalized.summary, normalized.source, normalized.sourceUrl, normalized.asOf, 1, actor, actor,
  ];
}

export async function listAdminIpRoyaltyPortfolios(): Promise<AdminIpRoyaltyPortfolioRow[]> {
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToPortfolio);
  });
}

export async function listEnabledAdminIpRoyaltyPortfolios(): Promise<IpRoyaltyPortfolio[]> {
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => portfolioRowToPortfolio(rowToPortfolio(row)));
  });
}

export async function findEnabledAdminIpRoyaltyPortfolio(portfolioId: string): Promise<IpRoyaltyPortfolio | null> {
  const id = text(portfolioId, 80);
  if (!id) return null;
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE portfolioId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? portfolioRowToPortfolio(rowToPortfolio(rows[0])) : null;
  });
}

export async function createAdminIpRoyaltyPortfolio(adminUserId: number, input: AdminIpRoyaltyPortfolioInput): Promise<AdminIpRoyaltyPortfolioRow> {
  const normalized = normalizePortfolioInput(input);
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const base = `admin-${slugify(normalized.name) || "portfolio"}-${crypto.randomBytes(2).toString("hex")}`;
    const portfolioId = await uniqueId(conn, IP_ROYALTY_PORTFOLIOS_TABLE, "portfolioId", base);
    await conn.execute(
      `INSERT INTO ${IP_ROYALTY_PORTFOLIOS_TABLE} (${PORTFOLIO_INSERT_COLUMNS}) VALUES (${Array(20).fill("?").join(",")})`,
      [portfolioId, ...portfolioInsertValues(normalized, adminUserId)],
    );
    await recordAudit(conn, adminUserId, "ip_royalty_portfolio_created", "ip_royalty_portfolio", portfolioId, null, { name: normalized.name });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE portfolioId=? LIMIT 1`, [portfolioId]);
    return rowToPortfolio(rows[0]);
  });
}

export async function updateAdminIpRoyaltyPortfolio(adminUserId: number, portfolioId: string, input: AdminIpRoyaltyPortfolioInput): Promise<AdminIpRoyaltyPortfolioRow> {
  const id = text(portfolioId, 80);
  if (!id) throw new Error("A valid portfolio id is required");
  const normalized = normalizePortfolioInput(input);
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.execute<any>(
      `UPDATE ${IP_ROYALTY_PORTFOLIOS_TABLE} SET name=?,rightType=?,jurisdiction=?,riskGrade=?,targetMinor=?,unitPriceMinor=?,unitCount=?,rightIdsJson=?,allocationBpsJson=?,expectedMultipleBps=?,expectedDurationMonths=?,expectedAnnualDistributionMinor=?,summary=?,source=?,sourceUrl=?,asOf=?,updatedByUserId=? WHERE portfolioId=?`,
      [
        normalized.name, normalized.rightType, normalized.jurisdiction, normalized.riskGrade, normalized.targetMinor,
        normalized.unitPriceMinor, normalized.unitCount, JSON.stringify(normalized.rightIds), JSON.stringify(normalized.allocationBpsByRight),
        normalized.expectedMultipleBps, normalized.expectedDurationMonths, normalized.expectedAnnualDistributionMinor,
        normalized.summary, normalized.source, normalized.sourceUrl, normalized.asOf, adminUserId, id,
      ],
    );
    if (Number(result.affectedRows || 0) !== 1) throw new Error("This portfolio no longer exists");
    await recordAudit(conn, adminUserId, "ip_royalty_portfolio_updated", "ip_royalty_portfolio", id, null, { name: normalized.name });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE portfolioId=? LIMIT 1`, [id]);
    return rowToPortfolio(rows[0]);
  });
}

export async function setAdminIpRoyaltyPortfolioEnabled(adminUserId: number, portfolioId: string, enabled: boolean): Promise<AdminIpRoyaltyPortfolioRow> {
  const id = text(portfolioId, 80);
  if (!id) throw new Error("A valid portfolio id is required");
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.execute<any>(`UPDATE ${IP_ROYALTY_PORTFOLIOS_TABLE} SET enabled=?, updatedByUserId=? WHERE portfolioId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (Number(result.affectedRows || 0) !== 1) throw new Error("This portfolio no longer exists");
    await recordAudit(conn, adminUserId, "ip_royalty_portfolio_enabled_changed", "ip_royalty_portfolio", id, null, { enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE portfolioId=? LIMIT 1`, [id]);
    return rowToPortfolio(rows[0]);
  });
}

export async function deleteAdminIpRoyaltyPortfolio(adminUserId: number, portfolioId: string): Promise<{ portfolioId: string; deleted: boolean }> {
  const id = text(portfolioId, 80);
  if (!id) throw new Error("A valid portfolio id is required");
  await ensureIpRoyaltiesDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT committedMinor FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE portfolioId=? LIMIT 1`, [id]);
    if (!existing.length) return { portfolioId: id, deleted: false };
    if (Number(existing[0].committedMinor || 0) > 0) throw new Error("A portfolio with funded positions cannot be deleted; disable it instead");
    await conn.execute(`DELETE FROM ${IP_ROYALTY_PORTFOLIOS_TABLE} WHERE portfolioId=?`, [id]);
    await recordAudit(conn, adminUserId, "ip_royalty_portfolio_deleted", "ip_royalty_portfolio", id, null, {});
    return { portfolioId: id, deleted: true };
  });
}
