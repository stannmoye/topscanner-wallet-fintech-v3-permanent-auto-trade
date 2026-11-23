import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import { findCountry, flagFor } from "@shared/country-options";
import {
  defaultLendingDisbursementConditions,
  disbursementConditionLabel,
  interestPlusCapitalMinor,
  lendingAuctionStatusFor,
  lendingBiddableFor,
  lendingNextRequiredBps,
  lendingRegionOf,
  lendingRemainingSecondsFor,
  LENDING_CONDITION_STATUSES,
  LENDING_CONDITION_TYPES,
  LENDING_LOAN_TYPES,
  LENDING_OUTCOMES,
  LENDING_REPAYMENT_FREQUENCIES,
  LENDING_RISK_GRADES,
  LENDING_SECTORS,
  LENDING_STAGES,
  LENDING_TERRITORY_BANDS,
  monthlyInterestMinor,
  yearlyInterestMinor,
  type DisbursementCondition,
  type DisbursementConditionStatus,
  type DisbursementConditionType,
  type LenderReserve,
  type LendingLoan,
  type LendingOutcome,
  type LendingRiskGrade,
  type LendingTerritoryBand,
  type LoanSector,
  type LoanStage,
  type LoanType,
  type RepaymentFrequency,
} from "@shared/lending-catalogue";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for administrator-published Lending loans and
 * lender reserves (kept outside Drizzle, matching the green-energy template).
 *
 * The DESK is two-sided: an administrator publishes LOAN opportunities (with the
 * principal, the starting interest, the minimum and maximum tenure a lender will
 * give, the repayment frequency, the platform fee, the risk grade, security and
 * the conditions a winner must meet) and POSTS how much each LENDER has reserved
 * for borrowers. The live borrower auction itself lives in the desk layer
 * (server/lending.ts). Nothing is invented: a loan's economics are the
 * administrator's, and a reserve is the administrator's statement of a lender's
 * capacity.
 */
export const LENDING_LOANS_TABLE = "lending_loans";
export const LENDING_RESERVES_TABLE = "lending_reserves";

const CREATE_LOANS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lending_loans (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  loanId VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  borrower VARCHAR(160) NOT NULL,
  loanType VARCHAR(32) NOT NULL,
  sector VARCHAR(24) NOT NULL,
  territory VARCHAR(120) NOT NULL,
  territoryBand VARCHAR(16) NOT NULL,
  countryCode VARCHAR(2) NOT NULL,
  country VARCHAR(120) NOT NULL,
  flag VARCHAR(24) NULL,
  purpose VARCHAR(300) NULL,
  description TEXT NOT NULL,
  principalMinor BIGINT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  startingInterestBps INT NULL,
  minimumTenureMonths INT NULL,
  maximumTenureMonths INT NULL,
  repaymentFrequency VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
  platformFeeBps INT NULL,
  riskGrade VARCHAR(16) NULL,
  collateral VARCHAR(300) NULL,
  highlightsJson TEXT NULL,
  conditionsJson TEXT NULL,
  stage VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  auctionOpensAt DATETIME(3) NULL,
  auctionClosesAt DATETIME(3) NULL,
  reserveId VARCHAR(80) NULL,
  winnerLabel VARCHAR(80) NULL,
  source VARCHAR(160) NULL,
  sourceUrl VARCHAR(300) NULL,
  asOf VARCHAR(24) NOT NULL,
  committedMinor BIGINT NOT NULL DEFAULT 0,
  outcome VARCHAR(16) NULL,
  outcomeRecordedAt DATETIME NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY lending_loans_id_idx (loanId),
  KEY lending_loans_enabled_idx (enabled, stage),
  KEY lending_loans_type_idx (loanType),
  KEY lending_loans_region_idx (countryCode)
) ENGINE=InnoDB`;

const CREATE_RESERVES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lending_reserves (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reserveId VARCHAR(80) NOT NULL,
  lender VARCHAR(160) NOT NULL,
  capacityMinor BIGINT NOT NULL,
  availableMinor BIGINT NOT NULL,
  allocatedMinor BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  countryCode VARCHAR(2) NOT NULL,
  country VARCHAR(120) NOT NULL,
  flag VARCHAR(24) NULL,
  territory VARCHAR(120) NULL,
  minimumTicketMinor BIGINT NULL,
  maximumTicketMinor BIGINT NULL,
  minimumTenureMonths INT NULL,
  maximumTenureMonths INT NULL,
  startingInterestBps INT NULL,
  loanTypesJson TEXT NULL,
  note VARCHAR(300) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  source VARCHAR(160) NULL,
  asOf VARCHAR(24) NOT NULL,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY lending_reserves_id_idx (reserveId),
  KEY lending_reserves_enabled_idx (enabled, countryCode)
) ENGINE=InnoDB`;

const DEFAULT_SOURCE = "Arbitrade lending desk — administrator published";
const MAX_MINOR = 100_000_000_000;
const MAX_BPS = 100_000;

export type AdminLendingLoanRow = {
  id: number;
  loanId: string;
  title: string;
  borrower: string;
  loanType: LoanType;
  sector: LoanSector;
  territory: string;
  territoryBand: LendingTerritoryBand;
  countryCode: string;
  country: string;
  flag: string;
  purpose: string | null;
  description: string;
  principalMinor: number | null;
  currency: string;
  startingInterestBps: number | null;
  minimumTenureMonths: number | null;
  maximumTenureMonths: number | null;
  repaymentFrequency: RepaymentFrequency;
  platformFeeBps: number | null;
  riskGrade: LendingRiskGrade | null;
  collateral: string | null;
  highlights: string[];
  conditions: DisbursementCondition[];
  stage: LoanStage;
  auctionOpensAt: string | null;
  auctionClosesAt: string | null;
  reserveId: string | null;
  winnerLabel: string | null;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  committedMinor: number;
  outcome: LendingOutcome | null;
  outcomeRecordedAt: string | null;
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

/** A disbursement condition as submitted by an administrator (label/status defaulted server-side). */
export type AdminLendingConditionInput = {
  type: DisbursementConditionType;
  label?: string | null;
  required?: boolean;
  status?: DisbursementConditionStatus | null;
  detail?: string | null;
  metAt?: string | null;
};

export type AdminLendingLoanInput = {
  title: string;
  borrower: string;
  loanType: LoanType;
  sector: LoanSector;
  countryCode: string;
  territory?: string | null;
  territoryBand?: LendingTerritoryBand | null;
  purpose?: string | null;
  description: string;
  principalMinor?: number | null;
  currency?: string | null;
  startingInterestBps?: number | null;
  minimumTenureMonths?: number | null;
  maximumTenureMonths?: number | null;
  repaymentFrequency?: RepaymentFrequency | null;
  platformFeeBps?: number | null;
  riskGrade?: LendingRiskGrade | null;
  collateral?: string | null;
  highlights?: string[] | null;
  conditions?: AdminLendingConditionInput[] | null;
  stage: LoanStage;
  auctionOpensAt?: string | null;
  auctionClosesAt?: string | null;
  reserveId?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  asOf?: string | null;
  reason?: string | null;
};

export type AdminLenderReserveRow = {
  id: number;
  reserveId: string;
  lender: string;
  capacityMinor: number;
  availableMinor: number;
  allocatedMinor: number;
  currency: string;
  countryCode: string;
  country: string;
  flag: string;
  territory: string | null;
  minimumTicketMinor: number | null;
  maximumTicketMinor: number | null;
  minimumTenureMonths: number | null;
  maximumTenureMonths: number | null;
  startingInterestBps: number | null;
  loanTypes: LoanType[];
  note: string | null;
  enabled: boolean;
  source: string;
  asOf: string;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLenderReserveInput = {
  lender: string;
  capacityMinor: number;
  currency?: string | null;
  countryCode: string;
  territory?: string | null;
  minimumTicketMinor?: number | null;
  maximumTicketMinor?: number | null;
  minimumTenureMonths?: number | null;
  maximumTenureMonths?: number | null;
  startingInterestBps?: number | null;
  loanTypes?: LoanType[] | null;
  note?: string | null;
  enabled?: boolean;
  source?: string | null;
  asOf?: string | null;
  reason?: string | null;
};

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const pool = mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 });
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); await pool.end(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive loans and reserves tables exist (memoized). */
export function ensureLendingSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_LOANS_TABLE_SQL);
        await conn.query(CREATE_RESERVES_TABLE_SQL);
      });
    } catch (error) {
      schemaReady = null;
      console.error("[Lending] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
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

function parseStringArray(raw: unknown, max: number): string[] {
  if (Array.isArray(raw)) return raw.map((item) => text(item, max)).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    return Array.isArray(parsed) ? parsed.map((item) => text(item, max)).filter(Boolean) : [];
  } catch { return []; }
}

function optionalMinor(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_MINOR) throw new Error(`Enter a valid ${label} up to 1,000,000,000`);
  return number;
}

function optionalInteger(value: unknown, label: string, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) throw new Error(`Enter a valid ${label} up to ${max.toLocaleString("en-US")}`);
  return number;
}

function optionalBps(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0 || number > MAX_BPS) throw new Error(`Enter a valid ${label} in basis points (0 — ${MAX_BPS})`);
  return number;
}

/** Parse the stored disbursement-condition set, falling back to the standard four. */
function parseConditions(raw: unknown): DisbursementCondition[] {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(list) || !list.length) return defaultLendingDisbursementConditions();
    const parsed = list
      .filter((item: any) => (LENDING_CONDITION_TYPES as readonly string[]).includes(String(item?.type)))
      .map((item: any) => ({
        type: item.type as DisbursementConditionType,
        label: text(item.label, 90) || disbursementConditionLabel(item.type),
        required: item.required !== false,
        status: (LENDING_CONDITION_STATUSES as readonly string[]).includes(String(item.status))
          ? (item.status as DisbursementConditionStatus) : ("PENDING" as const),
        detail: item.detail ? text(item.detail, 240) : null,
        metAt: item.metAt ? text(item.metAt, 40) : null,
      }));
    return parsed.length ? parsed : defaultLendingDisbursementConditions();
  } catch { return defaultLendingDisbursementConditions(); }
}

function parseLoanTypes(raw: unknown): LoanType[] {
  return parseStringArray(raw, 32).filter((value): value is LoanType => (LENDING_LOAN_TYPES as readonly string[]).includes(value));
}

/** Normalise an ISO datetime string (accepts a date or datetime), or null. */
function optionalIsoDateTime(value: unknown, label: string): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) throw new Error(`Enter the ${label} as a date and time`);
  return new Date(at).toISOString();
}

/**
 * Validate an administrator's loan. Fails closed: an unknown loan type, sector
 * or stage, a bad country, a negative amount, an out-of-range interest, a tenure
 * range that runs backwards, or a close time before its open time all throw
 * before anything is written.
 */
function normalizeLendingLoanInput(input: AdminLendingLoanInput) {
  const title = text(input.title, 200);
  if (title.length < 3) throw new Error("Enter a loan title of at least 3 characters");
  const borrower = text(input.borrower, 160);
  if (borrower.length < 2) throw new Error("Enter the borrower or applicant the loan is published for");
  if (!(LENDING_LOAN_TYPES as readonly string[]).includes(input.loanType)) throw new Error("Select a valid loan type");
  if (!(LENDING_SECTORS as readonly string[]).includes(input.sector)) throw new Error("Select a valid loan sector");
  const country = findCountry(input.countryCode);
  if (!country) throw new Error("Select a supported country for this loan");
  const description = text(input.description, 2000);
  if (description.length < 8) throw new Error("Describe the loan in at least 8 characters");
  if (!(LENDING_STAGES as readonly string[]).includes(input.stage)) throw new Error("Select a valid loan stage");

  const riskGrade = input.riskGrade === null || input.riskGrade === undefined || (input.riskGrade as string) === "" ? null : input.riskGrade;
  if (riskGrade !== null && !(LENDING_RISK_GRADES as readonly string[]).includes(riskGrade)) throw new Error("Select a valid risk grade");

  const territoryBand: LendingTerritoryBand = input.territoryBand && (LENDING_TERRITORY_BANDS as readonly string[]).includes(input.territoryBand)
    ? input.territoryBand : "NATIONAL";
  const territory = text(input.territory, 120) || country.name;

  const principalMinor = optionalMinor(input.principalMinor, "loan amount");
  const currency = (text(input.currency, 12) || "USD").toUpperCase();
  const startingInterestBps = optionalBps(input.startingInterestBps, "starting interest rate");
  const platformFeeBps = optionalBps(input.platformFeeBps, "platform fee");
  const minimumTenureMonths = optionalInteger(input.minimumTenureMonths, "minimum tenure in months", 600);
  const maximumTenureMonths = optionalInteger(input.maximumTenureMonths, "maximum tenure in months", 600);
  if (minimumTenureMonths !== null && maximumTenureMonths !== null && maximumTenureMonths < minimumTenureMonths) {
    throw new Error("The maximum tenure cannot be shorter than the minimum tenure");
  }

  const repaymentFrequency: RepaymentFrequency = input.repaymentFrequency && (LENDING_REPAYMENT_FREQUENCIES as readonly string[]).includes(input.repaymentFrequency)
    ? input.repaymentFrequency : "MONTHLY";

  const auctionOpensAt = optionalIsoDateTime(input.auctionOpensAt, "bidding open time");
  const auctionClosesAt = optionalIsoDateTime(input.auctionClosesAt, "countdown end time");
  if (auctionOpensAt && auctionClosesAt && Date.parse(auctionClosesAt) <= Date.parse(auctionOpensAt)) {
    throw new Error("The countdown end time must be after the bidding open time");
  }

  const highlights = (Array.isArray(input.highlights) ? input.highlights : [])
    .map((item) => text(item, 200)).filter(Boolean).slice(0, 12);

  const rawConditions = Array.isArray(input.conditions) ? input.conditions : [];
  const conditions: DisbursementCondition[] = rawConditions.length
    ? rawConditions
        .filter((condition) => (LENDING_CONDITION_TYPES as readonly string[]).includes(String(condition?.type)))
        .map((condition) => ({
          type: condition.type as DisbursementConditionType,
          label: text(condition.label, 90) || disbursementConditionLabel(condition.type),
          required: condition.required !== false,
          status: (LENDING_CONDITION_STATUSES as readonly string[]).includes(String(condition.status)) ? (condition.status as DisbursementConditionStatus) : ("PENDING" as const),
          detail: condition.detail ? text(condition.detail, 240) : null,
          metAt: condition.metAt ? text(condition.metAt, 40) : null,
        }))
    : defaultLendingDisbursementConditions();
  if (!conditions.length) throw new Error("Provide at least one valid disbursement condition");

  const asOf = text(input.asOf, 24) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Enter the as-of date as YYYY-MM-DD");

  return {
    title, borrower, loanType: input.loanType, sector: input.sector,
    country, territory, territoryBand,
    purpose: text(input.purpose, 300) || null,
    description,
    principalMinor, currency, startingInterestBps,
    minimumTenureMonths, maximumTenureMonths, repaymentFrequency,
    platformFeeBps, riskGrade,
    collateral: text(input.collateral, 300) || null,
    highlights, conditions,
    stage: input.stage,
    auctionOpensAt, auctionClosesAt,
    reserveId: text(input.reserveId, 80) || null,
    source: text(input.source, 160) || DEFAULT_SOURCE,
    sourceUrl: text(input.sourceUrl, 300) || null,
    asOf,
  };
}

function normalizeLenderReserveInput(input: AdminLenderReserveInput) {
  const lender = text(input.lender, 160);
  if (lender.length < 2) throw new Error("Enter the lender the reserve belongs to");
  const capacityMinor = optionalMinor(input.capacityMinor, "reserved capacity");
  if (!capacityMinor || capacityMinor <= 0) throw new Error("Enter the lender's reserved capacity");
  const country = findCountry(input.countryCode);
  if (!country) throw new Error("Select a supported country for this reserve");
  const currency = (text(input.currency, 12) || "USD").toUpperCase();

  const minimumTicketMinor = optionalMinor(input.minimumTicketMinor, "minimum ticket");
  const maximumTicketMinor = optionalMinor(input.maximumTicketMinor, "maximum ticket");
  if (minimumTicketMinor !== null && maximumTicketMinor !== null && maximumTicketMinor < minimumTicketMinor) {
    throw new Error("The maximum ticket cannot be smaller than the minimum ticket");
  }
  const minimumTenureMonths = optionalInteger(input.minimumTenureMonths, "minimum tenure in months", 600);
  const maximumTenureMonths = optionalInteger(input.maximumTenureMonths, "maximum tenure in months", 600);
  if (minimumTenureMonths !== null && maximumTenureMonths !== null && maximumTenureMonths < minimumTenureMonths) {
    throw new Error("The maximum tenure cannot be shorter than the minimum tenure");
  }
  const startingInterestBps = optionalBps(input.startingInterestBps, "lowest acceptable interest");
  const loanTypes = (Array.isArray(input.loanTypes) ? input.loanTypes : [])
    .filter((value): value is LoanType => (LENDING_LOAN_TYPES as readonly string[]).includes(String(value)));
  const asOf = text(input.asOf, 24) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Enter the as-of date as YYYY-MM-DD");

  return {
    lender, capacityMinor, currency, country,
    territory: text(input.territory, 120) || null,
    minimumTicketMinor, maximumTicketMinor,
    minimumTenureMonths, maximumTenureMonths, startingInterestBps,
    loanTypes,
    note: text(input.note, 300) || null,
    enabled: input.enabled !== false,
    source: text(input.source, 160) || DEFAULT_SOURCE,
    asOf,
  };
}

function rowToLoan(row: any): AdminLendingLoanRow {
  return {
    id: Number(row.id),
    loanId: String(row.loanId),
    title: String(row.title),
    borrower: String(row.borrower),
    loanType: (LENDING_LOAN_TYPES as readonly string[]).includes(String(row.loanType)) ? (row.loanType as LoanType) : "PERSONAL",
    sector: (LENDING_SECTORS as readonly string[]).includes(String(row.sector)) ? (row.sector as LoanSector) : "OTHER",
    territory: String(row.territory || ""),
    territoryBand: (LENDING_TERRITORY_BANDS as readonly string[]).includes(String(row.territoryBand)) ? (row.territoryBand as LendingTerritoryBand) : "NATIONAL",
    countryCode: String(row.countryCode),
    country: String(row.country || ""),
    flag: String(row.flag || ""),
    purpose: row.purpose ? String(row.purpose) : null,
    description: String(row.description || ""),
    principalMinor: row.principalMinor === null || row.principalMinor === undefined ? null : Number(row.principalMinor),
    currency: String(row.currency || "USD"),
    startingInterestBps: row.startingInterestBps === null || row.startingInterestBps === undefined ? null : Number(row.startingInterestBps),
    minimumTenureMonths: row.minimumTenureMonths === null || row.minimumTenureMonths === undefined ? null : Number(row.minimumTenureMonths),
    maximumTenureMonths: row.maximumTenureMonths === null || row.maximumTenureMonths === undefined ? null : Number(row.maximumTenureMonths),
    repaymentFrequency: (LENDING_REPAYMENT_FREQUENCIES as readonly string[]).includes(String(row.repaymentFrequency)) ? (row.repaymentFrequency as RepaymentFrequency) : "MONTHLY",
    platformFeeBps: row.platformFeeBps === null || row.platformFeeBps === undefined ? null : Number(row.platformFeeBps),
    riskGrade: (LENDING_RISK_GRADES as readonly string[]).includes(String(row.riskGrade)) ? (row.riskGrade as LendingRiskGrade) : null,
    collateral: row.collateral ? String(row.collateral) : null,
    highlights: parseStringArray(row.highlightsJson, 200),
    conditions: parseConditions(row.conditionsJson),
    stage: (LENDING_STAGES as readonly string[]).includes(String(row.stage)) ? (row.stage as LoanStage) : "DRAFT",
    auctionOpensAt: row.auctionOpensAt ? new Date(row.auctionOpensAt).toISOString() : null,
    auctionClosesAt: row.auctionClosesAt ? new Date(row.auctionClosesAt).toISOString() : null,
    reserveId: row.reserveId ? String(row.reserveId) : null,
    winnerLabel: row.winnerLabel ? String(row.winnerLabel) : null,
    source: String(row.source || DEFAULT_SOURCE),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
    asOf: String(row.asOf || ""),
    committedMinor: Number(row.committedMinor || 0),
    outcome: (LENDING_OUTCOMES as readonly string[]).includes(String(row.outcome)) ? (row.outcome as LendingOutcome) : null,
    outcomeRecordedAt: row.outcomeRecordedAt ? new Date(row.outcomeRecordedAt).toISOString() : null,
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function rowToReserve(row: any): AdminLenderReserveRow {
  return {
    id: Number(row.id),
    reserveId: String(row.reserveId),
    lender: String(row.lender),
    capacityMinor: Number(row.capacityMinor || 0),
    availableMinor: Number(row.availableMinor || 0),
    allocatedMinor: Number(row.allocatedMinor || 0),
    currency: String(row.currency || "USD"),
    countryCode: String(row.countryCode),
    country: String(row.country || ""),
    flag: String(row.flag || ""),
    territory: row.territory ? String(row.territory) : null,
    minimumTicketMinor: row.minimumTicketMinor === null || row.minimumTicketMinor === undefined ? null : Number(row.minimumTicketMinor),
    maximumTicketMinor: row.maximumTicketMinor === null || row.maximumTicketMinor === undefined ? null : Number(row.maximumTicketMinor),
    minimumTenureMonths: row.minimumTenureMonths === null || row.minimumTenureMonths === undefined ? null : Number(row.minimumTenureMonths),
    maximumTenureMonths: row.maximumTenureMonths === null || row.maximumTenureMonths === undefined ? null : Number(row.maximumTenureMonths),
    startingInterestBps: row.startingInterestBps === null || row.startingInterestBps === undefined ? null : Number(row.startingInterestBps),
    loanTypes: parseLoanTypes(row.loanTypesJson),
    note: row.note ? String(row.note) : null,
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    source: String(row.source || DEFAULT_SOURCE),
    asOf: String(row.asOf || ""),
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Project an administrator loan into the shared customer-facing shape. The live
 * auction fields (top bid, leading borrower, the viewer's own bid) start empty
 * here and are overlaid by the desk layer from the live bid set.
 */
export function loanRowToOpportunity(row: AdminLendingLoanRow, now: number = Date.now()): LendingLoan {
  const principal = row.principalMinor;
  const leadingBps = row.startingInterestBps;
  const tenure = row.maximumTenureMonths ?? row.minimumTenureMonths;
  const auctionStatus = lendingAuctionStatusFor({ stage: row.stage, auctionOpensAt: row.auctionOpensAt, auctionClosesAt: row.auctionClosesAt, now });
  return {
    id: row.loanId,
    title: row.title,
    borrower: row.borrower,
    loanType: row.loanType,
    sector: row.sector,
    purpose: row.purpose || row.description,
    territory: row.territory,
    territoryBand: row.territoryBand,
    region: lendingRegionOf(row.countryCode),
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    description: row.description,
    principalMinor: principal,
    currency: row.currency,
    startingInterestBps: row.startingInterestBps,
    minimumTenureMonths: row.minimumTenureMonths,
    maximumTenureMonths: row.maximumTenureMonths,
    repaymentFrequency: row.repaymentFrequency,
    monthlyInterestMinor: monthlyInterestMinor(principal, leadingBps),
    yearlyInterestMinor: yearlyInterestMinor(principal, leadingBps),
    interestPlusCapitalMinor: interestPlusCapitalMinor(principal, leadingBps, tenure),
    platformFeeBps: row.platformFeeBps,
    riskGrade: row.riskGrade,
    collateral: row.collateral,
    highlights: row.highlights,
    stage: row.stage,
    auctionOpensAt: row.auctionOpensAt,
    auctionClosesAt: row.auctionClosesAt,
    auctionStatus,
    remainingSeconds: lendingRemainingSecondsFor(row.auctionClosesAt, now),
    bidCount: 0,
    topBidBps: null,
    leadingBorrower: null,
    viewerIsLeading: false,
    viewerBidId: null,
    viewerNextRequiredBps: lendingNextRequiredBps(null, row.startingInterestBps),
    conditions: row.conditions,
    winnerLabel: row.winnerLabel,
    source: row.source,
    sourceUrl: row.sourceUrl,
    asOf: row.asOf,
    verified: true,
    biddable: lendingBiddableFor({ stage: row.stage, auctionOpensAt: row.auctionOpensAt, auctionClosesAt: row.auctionClosesAt, enabled: row.enabled, now }),
    verificationStatus: "VERIFIED",
  };
}

/** Project an administrator reserve into the shared customer-facing shape. */
export function reserveRowToReserve(row: AdminLenderReserveRow): LenderReserve {
  return {
    id: row.reserveId,
    lender: row.lender,
    capacityMinor: row.capacityMinor,
    availableMinor: row.availableMinor,
    allocatedMinor: row.allocatedMinor,
    currency: row.currency,
    region: lendingRegionOf(row.countryCode),
    territory: row.territory || row.country,
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    minimumTicketMinor: row.minimumTicketMinor,
    maximumTicketMinor: row.maximumTicketMinor,
    minimumTenureMonths: row.minimumTenureMonths,
    maximumTenureMonths: row.maximumTenureMonths,
    startingInterestBps: row.startingInterestBps,
    loanTypes: row.loanTypes,
    note: row.note,
    enabled: row.enabled,
    source: row.source,
    asOf: row.asOf,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function recordAudit(conn: Db, actorUserId: number, action: string, entityType: string, entityId: string, reason: string | null | undefined, metadata: unknown) {
  await conn.execute(
    `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
    [actorUserId, action, entityType, entityId, text(reason, 500) || null, `${entityType}:${entityId}`, JSON.stringify(metadata ?? {})],
  );
}

async function uniqueId(conn: Db, table: string, column: string, base: string): Promise<string> {
  const root = base.slice(0, 72) || `admin-lending-${crypto.randomBytes(3).toString("hex")}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [rows] = await conn.query<any[]>(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`, [candidate]);
    if (!rows.length) return candidate;
  }
  return `admin-lending-${crypto.randomBytes(6).toString("hex")}`;
}

/* ------------------------------------------------------------------ *
 * Loans
 * ------------------------------------------------------------------ */

export async function listAdminLendingLoans(): Promise<AdminLendingLoanRow[]> {
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToLoan);
  });
}

export async function listEnabledAdminLendingLoans(): Promise<LendingLoan[]> {
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => loanRowToOpportunity(rowToLoan(row)));
  });
}

export async function findAdminLendingLoan(loanId: string): Promise<AdminLendingLoanRow | null> {
  const id = text(loanId, 80);
  if (!id) return null;
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rows.length ? rowToLoan(rows[0]) : null;
  });
}

export async function findEnabledAdminLendingLoan(loanId: string): Promise<LendingLoan | null> {
  const id = text(loanId, 80);
  if (!id) return null;
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? loanRowToOpportunity(rowToLoan(rows[0])) : null;
  });
}

const LOAN_INSERT_COLUMNS =
  "loanId,title,borrower,loanType,sector,territory,territoryBand,countryCode,country,flag,purpose,description,principalMinor,currency,startingInterestBps,minimumTenureMonths,maximumTenureMonths,repaymentFrequency,platformFeeBps,riskGrade,collateral,highlightsJson,conditionsJson,stage,auctionOpensAt,auctionClosesAt,reserveId,source,sourceUrl,asOf,enabled,createdByUserId,updatedByUserId";

function loanInsertValues(normalized: ReturnType<typeof normalizeLendingLoanInput>, actor: number) {
  return [
    normalized.title, normalized.borrower, normalized.loanType, normalized.sector,
    normalized.territory, normalized.territoryBand, normalized.country.code, normalized.country.name, flagFor(normalized.country.code),
    normalized.purpose, normalized.description, normalized.principalMinor, normalized.currency, normalized.startingInterestBps,
    normalized.minimumTenureMonths, normalized.maximumTenureMonths, normalized.repaymentFrequency,
    normalized.platformFeeBps, normalized.riskGrade, normalized.collateral,
    JSON.stringify(normalized.highlights), JSON.stringify(normalized.conditions),
    normalized.stage, normalized.auctionOpensAt, normalized.auctionClosesAt, normalized.reserveId,
    normalized.source, normalized.sourceUrl, normalized.asOf, 1, actor, actor,
  ];
}

export async function createAdminLendingLoan(adminUserId: number, input: AdminLendingLoanInput): Promise<AdminLendingLoanRow> {
  const normalized = normalizeLendingLoanInput(input);
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const base = `loan-${slugify(normalized.title) || "opportunity"}-${crypto.randomBytes(2).toString("hex")}`;
    const loanId = await uniqueId(conn, LENDING_LOANS_TABLE, "loanId", base);
    await conn.execute(
      `INSERT INTO ${LENDING_LOANS_TABLE} (${LOAN_INSERT_COLUMNS}) VALUES (${Array(33).fill("?").join(",")})`,
      [loanId, ...loanInsertValues(normalized, adminUserId)],
    );
    await recordAudit(conn, adminUserId, "lending_loan_created", "lending_loan", loanId, input.reason, {
      loanId, loanType: normalized.loanType, countryCode: normalized.country.code, stage: normalized.stage,
      principalMinor: normalized.principalMinor, startingInterestBps: normalized.startingInterestBps,
      auctionOpensAt: normalized.auctionOpensAt, auctionClosesAt: normalized.auctionClosesAt,
      conditions: normalized.conditions.length,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [loanId]);
    return rowToLoan(rows[0]);
  });
}

export async function updateAdminLendingLoan(adminUserId: number, loanId: string, input: AdminLendingLoanInput): Promise<AdminLendingLoanRow> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  const normalized = normalizeLendingLoanInput(input);
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT loanId FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This loan no longer exists on the desk");
    await conn.execute(
      `UPDATE ${LENDING_LOANS_TABLE}
        SET title=?,borrower=?,loanType=?,sector=?,territory=?,territoryBand=?,countryCode=?,country=?,flag=?,purpose=?,description=?,
            principalMinor=?,currency=?,startingInterestBps=?,minimumTenureMonths=?,maximumTenureMonths=?,repaymentFrequency=?,platformFeeBps=?,riskGrade=?,
            collateral=?,highlightsJson=?,conditionsJson=?,stage=?,auctionOpensAt=?,auctionClosesAt=?,reserveId=?,source=?,sourceUrl=?,asOf=?,
            updatedByUserId=?,updatedAt=NOW(3)
       WHERE loanId=?`,
      [
        normalized.title, normalized.borrower, normalized.loanType, normalized.sector,
        normalized.territory, normalized.territoryBand, normalized.country.code, normalized.country.name, flagFor(normalized.country.code),
        normalized.purpose, normalized.description, normalized.principalMinor, normalized.currency, normalized.startingInterestBps,
        normalized.minimumTenureMonths, normalized.maximumTenureMonths, normalized.repaymentFrequency,
        normalized.platformFeeBps, normalized.riskGrade, normalized.collateral,
        JSON.stringify(normalized.highlights), JSON.stringify(normalized.conditions),
        normalized.stage, normalized.auctionOpensAt, normalized.auctionClosesAt, normalized.reserveId,
        normalized.source, normalized.sourceUrl, normalized.asOf, adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "lending_loan_updated", "lending_loan", id, input.reason, {
      loanId: id, stage: normalized.stage, principalMinor: normalized.principalMinor, startingInterestBps: normalized.startingInterestBps,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rowToLoan(rows[0]);
  });
}

export async function setAdminLendingLoanEnabled(adminUserId: number, loanId: string, enabled: boolean): Promise<AdminLendingLoanRow> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${LENDING_LOANS_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE loanId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This loan no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "lending_loan_enabled" : "lending_loan_disabled", "lending_loan", id, null, { loanId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rowToLoan(rows[0]);
  });
}

export async function setAdminLendingLoanStage(adminUserId: number, loanId: string, stage: LoanStage, reason?: string | null): Promise<AdminLendingLoanRow> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  if (!(LENDING_STAGES as readonly string[]).includes(stage)) throw new Error("Select a valid loan stage");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT loanId FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This loan no longer exists on the desk");
    await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET stage=?, updatedByUserId=?, updatedAt=NOW(3) WHERE loanId=?`, [stage, adminUserId, id]);
    await recordAudit(conn, adminUserId, "lending_loan_stage_changed", "lending_loan", id, reason, { loanId: id, stage });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rowToLoan(rows[0]);
  });
}

/**
 * Set (or clear) the administrator-controlled auction window: when the next
 * auction OPENS and when its countdown ENDS. Passing nulls clears the window so
 * the auction shows as "opens soon" until the administrator schedules it.
 */
export async function setAdminLendingLoanSchedule(
  adminUserId: number,
  loanId: string,
  input: { auctionOpensAt?: string | null; auctionClosesAt?: string | null; stage?: LoanStage | null; reason?: string | null },
): Promise<AdminLendingLoanRow> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  const opens = optionalIsoDateTime(input.auctionOpensAt, "bidding open time");
  const closes = optionalIsoDateTime(input.auctionClosesAt, "countdown end time");
  if (opens && closes && Date.parse(closes) <= Date.parse(opens)) throw new Error("The countdown end time must be after the bidding open time");
  if (input.stage !== undefined && input.stage !== null && !(LENDING_STAGES as readonly string[]).includes(input.stage)) throw new Error("Select a valid loan stage");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT loanId,stage FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This loan no longer exists on the desk");
    const stage = input.stage ?? (existing[0].stage as LoanStage);
    await conn.execute(
      `UPDATE ${LENDING_LOANS_TABLE} SET auctionOpensAt=?, auctionClosesAt=?, stage=?, updatedByUserId=?, updatedAt=NOW(3) WHERE loanId=?`,
      [opens, closes, stage, adminUserId, id],
    );
    await recordAudit(conn, adminUserId, "lending_loan_schedule_set", "lending_loan", id, input.reason, { loanId: id, auctionOpensAt: opens, auctionClosesAt: closes, stage });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rowToLoan(rows[0]);
  });
}

/** Replace the disbursement-condition set a winning borrower must satisfy. */
export async function setAdminLendingConditions(
  adminUserId: number,
  loanId: string,
  conditions: AdminLendingConditionInput[],
  reason?: string | null,
): Promise<AdminLendingLoanRow> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  if (!Array.isArray(conditions) || !conditions.length) throw new Error("Provide at least one disbursement condition");
  const normalized = conditions
    .filter((condition) => (LENDING_CONDITION_TYPES as readonly string[]).includes(String(condition?.type)))
    .map((condition) => ({
      type: condition.type as DisbursementConditionType,
      label: text(condition.label, 90) || disbursementConditionLabel(condition.type),
      required: condition.required !== false,
      status: (LENDING_CONDITION_STATUSES as readonly string[]).includes(String(condition.status)) ? (condition.status as DisbursementConditionStatus) : ("PENDING" as const),
      detail: condition.detail ? text(condition.detail, 240) : null,
      metAt: condition.metAt ? text(condition.metAt, 40) : null,
    }));
  if (!normalized.length) throw new Error("Provide at least one valid disbursement condition");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT loanId FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This loan no longer exists on the desk");
    await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET conditionsJson=?, updatedByUserId=?, updatedAt=NOW(3) WHERE loanId=?`, [JSON.stringify(normalized), adminUserId, id]);
    await recordAudit(conn, adminUserId, "lending_conditions_set", "lending_loan", id, reason, { loanId: id, conditions: normalized.map((condition) => condition.type) });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rowToLoan(rows[0]);
  });
}

/** Mark one disbursement condition MET or WAIVED. History is append-only. */
export async function meetAdminLendingCondition(
  adminUserId: number,
  loanId: string,
  type: DisbursementConditionType,
  status: DisbursementConditionStatus = "MET",
  reason?: string | null,
): Promise<AdminLendingLoanRow> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  if (!(LENDING_CONDITION_TYPES as readonly string[]).includes(type)) throw new Error("Select a valid disbursement condition");
  if (!(LENDING_CONDITION_STATUSES as readonly string[]).includes(status)) throw new Error("Select a valid condition status");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1 FOR UPDATE`, [id]);
    if (!rows.length) throw new Error("This loan no longer exists on the desk");
    const conditions = parseConditions(rows[0].conditionsJson);
    const target = conditions.find((condition) => condition.type === type);
    if (!target) throw new Error("This loan does not carry that condition");
    const metAt = status === "MET" ? new Date().toISOString() : null;
    const updated = conditions.map((condition) => (condition.type === type ? { ...condition, status, metAt } : condition));
    await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET conditionsJson=?, updatedByUserId=?, updatedAt=NOW(3) WHERE loanId=?`, [JSON.stringify(updated), adminUserId, id]);
    await recordAudit(conn, adminUserId, "lending_condition_met", "lending_loan", id, reason, { loanId: id, condition: type, status, metAt });
    const [after] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1`, [id]);
    return rowToLoan(after[0]);
  });
}

/** Stamp the recorded outcome on a loan. Called inside the settlement transaction. */
export async function applyLendingLoanOutcome(conn: Db, loanId: string, outcome: LendingOutcome): Promise<void> {
  await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET outcome=?, outcomeRecordedAt=NOW(), updatedAt=NOW(3) WHERE loanId=?`, [outcome, loanId]);
}

/**
 * Record the auction resolution on a loan: the stage, the winner and the winning
 * interest. Only ever called from the desk layer's resolution transaction (the
 * bid table lock and this update share one transaction).
 */
export async function markLendingLoanAllocated(
  conn: Db,
  loanId: string,
  input: { winnerLabel: string | null; topBidBps: number | null; committedMinor: number; stage: LoanStage },
): Promise<void> {
  await conn.execute(
    `UPDATE ${LENDING_LOANS_TABLE} SET stage=?, winnerLabel=?, committedMinor=?, updatedAt=NOW(3) WHERE loanId=?`,
    [input.stage, input.winnerLabel, input.committedMinor, loanId],
  );
}

export async function deleteAdminLendingLoan(adminUserId: number, loanId: string): Promise<{ loanId: string; deleted: boolean }> {
  const id = text(loanId, 80);
  if (!id) throw new Error("A valid loan id is required");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${LENDING_LOANS_TABLE} WHERE loanId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "lending_loan_deleted", "lending_loan", id, null, { loanId: id });
    return { loanId: id, deleted };
  });
}

/* ------------------------------------------------------------------ *
 * Lender reserves
 * ------------------------------------------------------------------ */

export async function listAdminLenderReserves(): Promise<AdminLenderReserveRow[]> {
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_RESERVES_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToReserve);
  });
}

export async function listEnabledAdminLenderReserves(): Promise<LenderReserve[]> {
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_RESERVES_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => reserveRowToReserve(rowToReserve(row)));
  });
}

export async function findAdminLenderReserve(reserveId: string): Promise<AdminLenderReserveRow | null> {
  const id = text(reserveId, 80);
  if (!id) return null;
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_RESERVES_TABLE} WHERE reserveId=? LIMIT 1`, [id]);
    return rows.length ? rowToReserve(rows[0]) : null;
  });
}

const RESERVE_INSERT_COLUMNS =
  "reserveId,lender,capacityMinor,availableMinor,allocatedMinor,currency,countryCode,country,flag,territory,minimumTicketMinor,maximumTicketMinor,minimumTenureMonths,maximumTenureMonths,startingInterestBps,loanTypesJson,note,enabled,source,asOf,createdByUserId,updatedByUserId";

export async function createAdminLenderReserve(adminUserId: number, input: AdminLenderReserveInput): Promise<AdminLenderReserveRow> {
  const normalized = normalizeLenderReserveInput(input);
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const base = `reserve-${slugify(normalized.lender) || "lender"}-${crypto.randomBytes(2).toString("hex")}`;
    const reserveId = await uniqueId(conn, LENDING_RESERVES_TABLE, "reserveId", base);
    await conn.execute(
      `INSERT INTO ${LENDING_RESERVES_TABLE} (${RESERVE_INSERT_COLUMNS}) VALUES (${Array(22).fill("?").join(",")})`,
      [
        reserveId, normalized.lender, normalized.capacityMinor, normalized.capacityMinor, 0, normalized.currency,
        normalized.country.code, normalized.country.name, flagFor(normalized.country.code), normalized.territory,
        normalized.minimumTicketMinor, normalized.maximumTicketMinor, normalized.minimumTenureMonths, normalized.maximumTenureMonths,
        normalized.startingInterestBps, JSON.stringify(normalized.loanTypes), normalized.note, normalized.enabled ? 1 : 0,
        normalized.source, normalized.asOf, adminUserId, adminUserId,
      ],
    );
    await recordAudit(conn, adminUserId, "lending_reserve_created", "lending_reserve", reserveId, input.reason, {
      reserveId, lender: normalized.lender, capacityMinor: normalized.capacityMinor, countryCode: normalized.country.code,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_RESERVES_TABLE} WHERE reserveId=? LIMIT 1`, [reserveId]);
    return rowToReserve(rows[0]);
  });
}

export async function updateAdminLenderReserve(adminUserId: number, reserveId: string, input: AdminLenderReserveInput): Promise<AdminLenderReserveRow> {
  const id = text(reserveId, 80);
  if (!id) throw new Error("A valid reserve id is required");
  const normalized = normalizeLenderReserveInput(input);
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT reserveId, allocatedMinor FROM ${LENDING_RESERVES_TABLE} WHERE reserveId=? LIMIT 1`, [id]);
    if (!rows.length) throw new Error("This reserve no longer exists on the desk");
    const allocated = Number(rows[0].allocatedMinor || 0);
    if (normalized.capacityMinor < allocated) throw new Error("The reserved capacity cannot be set below what is already allocated");
    await conn.execute(
      `UPDATE ${LENDING_RESERVES_TABLE}
        SET lender=?,capacityMinor=?,availableMinor=?,currency=?,countryCode=?,country=?,flag=?,territory=?,minimumTicketMinor=?,maximumTicketMinor=?,
            minimumTenureMonths=?,maximumTenureMonths=?,startingInterestBps=?,loanTypesJson=?,note=?,enabled=?,source=?,asOf=?,updatedByUserId=?,updatedAt=NOW(3)
       WHERE reserveId=?`,
      [
        normalized.lender, normalized.capacityMinor, Math.max(0, normalized.capacityMinor - allocated), normalized.currency,
        normalized.country.code, normalized.country.name, flagFor(normalized.country.code), normalized.territory,
        normalized.minimumTicketMinor, normalized.maximumTicketMinor, normalized.minimumTenureMonths, normalized.maximumTenureMonths,
        normalized.startingInterestBps, JSON.stringify(normalized.loanTypes), normalized.note, normalized.enabled ? 1 : 0,
        normalized.source, normalized.asOf, adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "lending_reserve_updated", "lending_reserve", id, input.reason, { reserveId: id, capacityMinor: normalized.capacityMinor });
    const [after] = await conn.query<any[]>(`SELECT * FROM ${LENDING_RESERVES_TABLE} WHERE reserveId=? LIMIT 1`, [id]);
    return rowToReserve(after[0]);
  });
}

export async function setAdminLenderReserveEnabled(adminUserId: number, reserveId: string, enabled: boolean): Promise<AdminLenderReserveRow> {
  const id = text(reserveId, 80);
  if (!id) throw new Error("A valid reserve id is required");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${LENDING_RESERVES_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE reserveId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This reserve no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "lending_reserve_enabled" : "lending_reserve_disabled", "lending_reserve", id, null, { reserveId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_RESERVES_TABLE} WHERE reserveId=? LIMIT 1`, [id]);
    return rowToReserve(rows[0]);
  });
}

export async function deleteAdminLenderReserve(adminUserId: number, reserveId: string): Promise<{ reserveId: string; deleted: boolean }> {
  const id = text(reserveId, 80);
  if (!id) throw new Error("A valid reserve id is required");
  await ensureLendingSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${LENDING_RESERVES_TABLE} WHERE reserveId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "lending_reserve_deleted", "lending_reserve", id, null, { reserveId: id });
    return { reserveId: id, deleted };
  });
}
