import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import { flagFor, findCountry } from "@shared/country-options";
import {
  expectedValueMinor,
  remainingDaysFor,
  defaultMilestones,
  classifyCaseClass,
  classifyPartyKind,
  claimValueBandFromMinor,
  LITIGATION_STAGES,
  LITIGATION_MERIT_GRADES,
  LITIGATION_RISK_GRADES,
  LITIGATION_DOSSIER_STATUSES,
  LITIGATION_OUTCOMES,
  LITIGATION_CASE_CLASSES,
  LITIGATION_VALUE_BANDS,
  type LitigationCase,
  type LitigationBundle,
  type LitigationMeritGrade,
  type LitigationRiskGrade,
  type LitigationStage,
  type LitigationDossierStatus,
  type LitigationOutcome,
  type LitigationMilestone,
  type LitigationScenario,
  type LitigationCaseClass,
  type LitigationValueBand,
} from "@shared/litigation-funds-catalogue";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for administrator-published Litigation Funds
 * dossiers and case bundles (kept outside Drizzle, matching the
 * cooperateDeptCompanies / treasuryBondInstruments template).
 *
 * The DISCOVERY layer (shared/litigation-funds-catalogue.ts) surfaces real,
 * cited public court filings; those are candidate claims with no economics. A
 * DOSSIER is the administrator's reviewed, sourced economics for one case and
 * is the only thing a customer can fund. Nothing here is invented: an
 * administrator must supply the merit, damages, multiple and the three outcome
 * scenarios, each traceable to a source URL and an as-of date.
 */
export const LITIGATION_DOSSIERS_TABLE = "litigation_fund_dossiers";
export const LITIGATION_BUNDLES_TABLE = "litigation_fund_bundles";

const CREATE_DOSSIERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS litigation_fund_dossiers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dossierId VARCHAR(80) NOT NULL,
  caseName VARCHAR(200) NOT NULL,
  claimant VARCHAR(160) NOT NULL,
  defendant VARCHAR(160) NOT NULL,
  claimType VARCHAR(120) NOT NULL,
  countryCode VARCHAR(2) NOT NULL,
  jurisdiction VARCHAR(120) NOT NULL,
  court VARCHAR(160) NOT NULL,
  counsel VARCHAR(160) NULL,
  meritGrade VARCHAR(2) NULL,
  riskGrade VARCHAR(16) NULL,
  estimatedDamagesMinor BIGINT NULL,
  capitalAtRiskMinor BIGINT NULL,
  expectedMultipleBps INT NULL,
  expectedDurationMonths INT NULL,
  fundingAskMinor BIGINT NULL,
  fundingDeadline VARCHAR(24) NULL,
  stage VARCHAR(24) NOT NULL,
  dossierStatus VARCHAR(24) NOT NULL DEFAULT 'FUNDING',
  caseClass VARCHAR(32) NULL,
  causeOfAction VARCHAR(160) NULL,
  caseNumber VARCHAR(80) NULL,
  filedAt VARCHAR(24) NULL,
  courtDetail VARCHAR(160) NULL,
  claimValueBand VARCHAR(16) NULL,
  problem TEXT NOT NULL,
  highlightsJson TEXT NULL,
  scenariosJson TEXT NULL,
  milestonesJson TEXT NULL,
  bundleId VARCHAR(80) NULL,
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
  UNIQUE KEY litigation_fund_dossiers_id_idx (dossierId),
  KEY litigation_fund_dossiers_enabled_idx (enabled, dossierStatus)
) ENGINE=InnoDB`;

const CREATE_BUNDLES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS litigation_fund_bundles (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bundleId VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  claimType VARCHAR(120) NOT NULL,
  jurisdiction VARCHAR(120) NOT NULL,
  riskGrade VARCHAR(16) NOT NULL,
  targetMinor BIGINT NOT NULL,
  unitPriceMinor BIGINT NOT NULL,
  unitCount INT NOT NULL,
  caseIdsJson TEXT NULL,
  allocationBpsJson TEXT NULL,
  expectedMultipleBps INT NOT NULL,
  expectedDurationMonths INT NULL,
  summary TEXT NULL,
  source VARCHAR(160) NULL,
  asOf VARCHAR(24) NOT NULL,
  committedMinor BIGINT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdByUserId INT NULL,
  updatedByUserId INT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY litigation_fund_bundles_id_idx (bundleId),
  KEY litigation_fund_bundles_enabled_idx (enabled)
) ENGINE=InnoDB`;

const DEFAULT_SOURCE = "Arbitrade litigation desk — administrator published";
const MAX_MINOR = 100_000_000_000; // 1,000,000,000 in the settlement currency

/**
 * Case-classification columns added after the first release. `ADD COLUMN IF NOT
 * EXISTS` is not portable across MySQL/MariaDB versions, so each statement is
 * attempted and tolerated (the column already existing is the expected outcome).
 */
const ADD_DOSSIERS_COLUMNS_SQL = [
  "ALTER TABLE litigation_fund_dossiers ADD COLUMN caseClass VARCHAR(32) NULL",
  "ALTER TABLE litigation_fund_dossiers ADD COLUMN causeOfAction VARCHAR(160) NULL",
  "ALTER TABLE litigation_fund_dossiers ADD COLUMN caseNumber VARCHAR(80) NULL",
  "ALTER TABLE litigation_fund_dossiers ADD COLUMN filedAt VARCHAR(24) NULL",
  "ALTER TABLE litigation_fund_dossiers ADD COLUMN courtDetail VARCHAR(160) NULL",
  "ALTER TABLE litigation_fund_dossiers ADD COLUMN claimValueBand VARCHAR(16) NULL",
];

export type AdminLitigationDossierRow = {
  id: number;
  dossierId: string;
  caseName: string;
  claimant: string;
  defendant: string;
  claimType: string;
  countryCode: string;
  country: string;
  flag: string;
  jurisdiction: string;
  court: string;
  counsel: string | null;
  meritGrade: LitigationMeritGrade | null;
  riskGrade: LitigationRiskGrade | null;
  estimatedDamagesMinor: number | null;
  capitalAtRiskMinor: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  fundingAskMinor: number | null;
  fundingDeadline: string | null;
  stage: LitigationStage;
  status: LitigationDossierStatus;
  /** Administrator-set classification: what kind of dispute this is. */
  caseClass: LitigationCaseClass;
  causeOfAction: string | null;
  caseNumber: string | null;
  filedAt: string | null;
  courtDetail: string | null;
  claimValueBand: LitigationValueBand | null;
  problem: string;
  highlights: string[];
  scenarios: LitigationScenario[];
  milestones: LitigationMilestone[];
  bundleId: string | null;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  committedMinor: number;
  outcome: LitigationOutcome | null;
  outcomeRecordedAt: string | null;
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLitigationBundleRow = {
  id: number;
  bundleId: string;
  name: string;
  claimType: string;
  jurisdiction: string;
  riskGrade: LitigationRiskGrade;
  targetMinor: number;
  unitPriceMinor: number;
  unitCount: number;
  caseIds: string[];
  allocationBpsByCase: Record<string, number>;
  expectedMultipleBps: number;
  expectedDurationMonths: number | null;
  summary: string;
  source: string;
  asOf: string;
  committedMinor: number;
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLitigationScenarioInput = {
  outcome: LitigationOutcome;
  label?: string;
  probabilityBps: number;
  grossRecoveryMinor: number;
  durationMonths: number;
  funderMultipleBps: number;
};

export type AdminLitigationDossierInput = {
  caseName: string;
  claimant: string;
  defendant: string;
  claimType: string;
  countryCode: string;
  court: string;
  counsel?: string | null;
  meritGrade?: LitigationMeritGrade | null;
  riskGrade?: LitigationRiskGrade | null;
  estimatedDamagesMinor?: number | null;
  capitalAtRiskMinor?: number | null;
  expectedMultipleBps?: number | null;
  expectedDurationMonths?: number | null;
  fundingAskMinor?: number | null;
  fundingDeadline?: string | null;
  stage: LitigationStage;
  status: LitigationDossierStatus;
  /** What kind of dispute this is; drives the customer case-class filter and badge. */
  caseClass?: LitigationCaseClass | null;
  causeOfAction?: string | null;
  caseNumber?: string | null;
  filedAt?: string | null;
  courtDetail?: string | null;
  /** Coarse claim-value band; derived from estimated damages when omitted. */
  claimValueBand?: LitigationValueBand | null;
  problem: string;
  highlights?: string[] | null;
  scenarios?: AdminLitigationScenarioInput[] | null;
  milestones?: LitigationMilestone[] | null;
  bundleId?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  asOf?: string | null;
  reason?: string | null;
};

export type AdminLitigationBundleInput = {
  name: string;
  claimType: string;
  jurisdiction: string;
  riskGrade: LitigationRiskGrade;
  targetMinor: number;
  unitPriceMinor: number;
  unitCount: number;
  caseIds?: string[] | null;
  allocationBpsByCase?: Record<string, number> | null;
  expectedMultipleBps: number;
  expectedDurationMonths?: number | null;
  summary?: string | null;
  source?: string | null;
  asOf?: string | null;
  reason?: string | null;
};

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const conn = await getSharedMysqlPool().getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive dossiers + bundles tables exist (memoized). */
export function ensureLitigationFundDossierSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_DOSSIERS_TABLE_SQL);
        await conn.query(CREATE_BUNDLES_TABLE_SQL);
        for (const statement of ADD_DOSSIERS_COLUMNS_SQL) {
          try { await conn.query(statement); } catch { /* column already exists */ }
        }
      });
    } catch (error) {
      schemaReady = null;
      console.error("[LitigationFundDossiers] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
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

function parseScenarios(raw: unknown): LitigationScenario[] {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(list)) return [];
    return list.map((item: any) => ({
      outcome: item.outcome,
      label: text(item.label, 80) || String(item.outcome || ""),
      probabilityBps: Math.round(Number(item.probabilityBps) || 0),
      grossRecoveryMinor: Math.round(Number(item.grossRecoveryMinor) || 0),
      durationMonths: Math.round(Number(item.durationMonths) || 0),
      funderMultipleBps: Math.round(Number(item.funderMultipleBps) || 0),
    })).filter((item) => (LITIGATION_OUTCOMES as readonly string[]).includes(item.outcome));
  } catch { return []; }
}

function parseMilestones(raw: unknown): LitigationMilestone[] {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(list)) return [];
    return list
      .filter((item: any) => (LITIGATION_STAGES as readonly string[]).includes(String(item?.stage)))
      .map((item: any) => ({
        stage: item.stage as LitigationStage,
        label: text(item.label, 60) || String(item.stage),
        releaseBps: Math.round(Number(item.releaseBps) || 0),
        status: item.status === "REACHED" ? "REACHED" : "PENDING",
        reachedAt: item.reachedAt ? text(item.reachedAt, 40) : null,
      }));
  } catch { return []; }
}

/**
 * Validate the administrator's dossier. Fails closed: a bad country, a
 * non-A–E merit grade, negative economics, an unfundable-but-inconsistent
 * target, or scenarios whose probabilities do not sum to exactly 100% all throw
 * before anything is written. Economics are only accepted when cited.
 */
function normalizeDossierInput(input: AdminLitigationDossierInput) {
  const caseName = text(input.caseName, 200);
  if (caseName.length < 3) throw new Error("Enter a case name of at least 3 characters");
  const claimant = text(input.claimant, 160);
  if (claimant.length < 2) throw new Error("Enter the claimant or class of claimants");
  const defendant = text(input.defendant, 160);
  if (defendant.length < 2) throw new Error("Enter the defendant");
  const claimType = text(input.claimType, 120);
  if (claimType.length < 2) throw new Error("Enter the claim type");

  const country = findCountry(input.countryCode);
  if (!country) throw new Error("Select a supported jurisdiction country for this claim");

  const court = text(input.court, 160);
  if (court.length < 2) throw new Error("Enter the court or tribunal");

  if (!(LITIGATION_STAGES as readonly string[]).includes(input.stage)) throw new Error("Select a valid case stage");
  if (!(LITIGATION_DOSSIER_STATUSES as readonly string[]).includes(input.status)) throw new Error("Select a valid dossier status");

  const meritGrade = input.meritGrade === null || input.meritGrade === undefined || (input.meritGrade as string) === ""
    ? null : input.meritGrade;
  if (meritGrade !== null && !(LITIGATION_MERIT_GRADES as readonly string[]).includes(meritGrade)) throw new Error("Select a merit grade from A to E");
  const riskGrade = input.riskGrade === null || input.riskGrade === undefined || (input.riskGrade as string) === ""
    ? null : input.riskGrade;
  if (riskGrade !== null && !(LITIGATION_RISK_GRADES as readonly string[]).includes(riskGrade)) throw new Error("Select a valid risk grade");

  const problem = text(input.problem, 2000);
  if (problem.length < 8) throw new Error("Describe the claim and problem in at least 8 characters");

  const estimatedDamagesMinor = optionalMinor(input.estimatedDamagesMinor, "estimated damages");
  const capitalAtRiskMinor = optionalMinor(input.capitalAtRiskMinor, "capital at risk");
  const fundingAskMinor = optionalMinor(input.fundingAskMinor, "funding target");

  const rawMultiple = input.expectedMultipleBps === null || input.expectedMultipleBps === undefined ? null : Math.round(Number(input.expectedMultipleBps));
  if (rawMultiple !== null && (!Number.isFinite(rawMultiple) || rawMultiple < 0 || rawMultiple > 1_000_000)) throw new Error("Enter an expected multiple up to 100.00x");
  const rawDuration = input.expectedDurationMonths === null || input.expectedDurationMonths === undefined ? null : Math.round(Number(input.expectedDurationMonths));
  if (rawDuration !== null && (!Number.isFinite(rawDuration) || rawDuration < 0 || rawDuration > 600)) throw new Error("Enter an expected duration up to 600 months");

  const fundingDeadline = text(input.fundingDeadline, 24) || null;
  if (fundingDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(fundingDeadline)) throw new Error("Enter the funding deadline as YYYY-MM-DD");

  // Classification: an administrator may set the case class explicitly, or it is
  // inferred best-effort from the claim wording. Insolvency is one class among
  // many — a dossier that is a bankruptcy estate must say so.
  const rawCaseClass = input.caseClass === null || input.caseClass === undefined || (input.caseClass as string) === "" ? null : input.caseClass;
  if (rawCaseClass !== null && !(LITIGATION_CASE_CLASSES as readonly string[]).includes(rawCaseClass)) throw new Error("Select a valid case class");
  const caseClass: LitigationCaseClass = rawCaseClass ?? classifyCaseClass({ claimType, caseName, detail: problem });

  const causeOfAction = text(input.causeOfAction, 160) || null;
  const caseNumber = text(input.caseNumber, 80) || null;
  const courtDetail = text(input.courtDetail, 160) || null;
  const filedAt = text(input.filedAt, 24) || null;
  if (filedAt && !/^\d{4}-\d{2}-\d{2}$/.test(filedAt)) throw new Error("Enter the filing date as YYYY-MM-DD");

  const rawBand = input.claimValueBand === null || input.claimValueBand === undefined || (input.claimValueBand as string) === "" ? null : input.claimValueBand;
  if (rawBand !== null && !(LITIGATION_VALUE_BANDS as readonly string[]).includes(rawBand)) throw new Error("Select a valid claim-value band");
  const claimValueBand: LitigationValueBand | null = rawBand ?? claimValueBandFromMinor(estimatedDamagesMinor);

  const highlights = (Array.isArray(input.highlights) ? input.highlights : [])
    .map((item) => text(item, 160)).filter(Boolean).slice(0, 8);

  // Outcome scenarios: either none (not modelled — cannot invest) or a full,
  // complete set of exactly the three outcomes summing to 10,000 basis points.
  const rawScenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  let scenarios: LitigationScenario[] = [];
  if (rawScenarios.length) {
    const seen = new Set<string>();
    scenarios = rawScenarios.map((scenario) => {
      const outcome = String(scenario?.outcome || "").toUpperCase() as LitigationOutcome;
      if (!(LITIGATION_OUTCOMES as readonly string[]).includes(outcome)) throw new Error("Each scenario must be a SETTLE, WIN or LOSE outcome");
      if (seen.has(outcome)) throw new Error(`The ${outcome} scenario is duplicated`);
      seen.add(outcome);
      const probabilityBps = Math.round(Number(scenario.probabilityBps));
      if (!Number.isFinite(probabilityBps) || probabilityBps < 0 || probabilityBps > 10_000) throw new Error("Each scenario probability must be between 0% and 100%");
      const grossRecoveryMinor = Math.round(Number(scenario.grossRecoveryMinor));
      if (!Number.isSafeInteger(grossRecoveryMinor) || grossRecoveryMinor < 0 || grossRecoveryMinor > MAX_MINOR) throw new Error("Enter a valid gross recovery for each scenario");
      const durationMonths = Math.round(Number(scenario.durationMonths));
      if (!Number.isFinite(durationMonths) || durationMonths < 0 || durationMonths > 600) throw new Error("Enter a valid duration for each scenario");
      const funderMultipleBps = Math.round(Number(scenario.funderMultipleBps));
      if (!Number.isFinite(funderMultipleBps) || funderMultipleBps < 0 || funderMultipleBps > 1_000_000) throw new Error("Enter a valid funder multiple for each scenario");
      return { outcome, label: text(scenario.label, 80) || outcome, probabilityBps, grossRecoveryMinor, durationMonths, funderMultipleBps };
    });
    for (const outcome of LITIGATION_OUTCOMES) {
      if (!seen.has(outcome)) throw new Error(`Provide the ${outcome} scenario so the three modelled outcomes are complete`);
    }
    const total = scenarios.reduce((sum, scenario) => sum + scenario.probabilityBps, 0);
    if (total !== 10_000) throw new Error("Scenario probabilities must sum to exactly 100%");
    if (!fundingAskMinor) throw new Error("Set a funding target before publishing outcome scenarios");
  }
  const rawMilestones = Array.isArray(input.milestones) ? input.milestones : [];
  let milestones: LitigationMilestone[];
  if (rawMilestones.length) {
    milestones = rawMilestones
      .filter((milestone) => (LITIGATION_STAGES as readonly string[]).includes(milestone?.stage))
      .map((milestone) => ({
        stage: milestone.stage as LitigationStage,
        label: text(milestone.label, 60) || String(milestone.stage),
        releaseBps: Math.round(Number(milestone.releaseBps) || 0),
        status: milestone.status === "REACHED" ? ("REACHED" as const) : ("PENDING" as const),
        reachedAt: milestone.reachedAt ? text(milestone.reachedAt, 40) : null,
      }));
    if (!milestones.length) throw new Error("Provide at least one valid milestone stage");
    const releaseTotal = milestones.reduce((sum, milestone) => sum + milestone.releaseBps, 0);
    if (releaseTotal !== 10_000) throw new Error("Milestone release weights must sum to exactly 100% of escrow");
  } else {
    milestones = defaultMilestones();
  }

  const asOf = text(input.asOf, 24) || new Date().toISOString().slice(0, 10);
  const sourceUrl = text(input.sourceUrl, 300) || null;
  // Economics must be cited. A modelled dossier without a source URL is refused.
  if (scenarios.length && !sourceUrl) throw new Error("A modelled dossier must cite its source URL so the economics can be verified");

  return {
    caseName, claimant, defendant, claimType,
    country,
    court,
    counsel: text(input.counsel, 160) || null,
    meritGrade, riskGrade,
    estimatedDamagesMinor, capitalAtRiskMinor,
    expectedMultipleBps: rawMultiple, expectedDurationMonths: rawDuration,
    fundingAskMinor, fundingDeadline,
    stage: input.stage, status: input.status,
    caseClass, causeOfAction, caseNumber, filedAt, courtDetail, claimValueBand,
    problem,
    highlights,
    scenarios,
    milestones,
    bundleId: text(input.bundleId, 80) || null,
    source: text(input.source, 160) || DEFAULT_SOURCE,
    sourceUrl,
    asOf,
  };
}

function normalizeBundleInput(input: AdminLitigationBundleInput) {
  const name = text(input.name, 160);
  if (name.length < 3) throw new Error("Enter a bundle name of at least 3 characters");
  const claimType = text(input.claimType, 120);
  if (claimType.length < 2) throw new Error("Enter the bundle claim type");
  const jurisdiction = text(input.jurisdiction, 120);
  if (jurisdiction.length < 2) throw new Error("Enter the bundle jurisdiction");
  if (!(LITIGATION_RISK_GRADES as readonly string[]).includes(input.riskGrade)) throw new Error("Select a valid risk grade");

  const targetMinor = optionalMinor(input.targetMinor, "bundle target");
  if (!targetMinor) throw new Error("Enter a bundle funding target");
  const unitPriceMinor = optionalMinor(input.unitPriceMinor, "unit price");
  if (!unitPriceMinor) throw new Error("Enter a unit price");
  const unitCount = Math.round(Number(input.unitCount));
  if (!Number.isInteger(unitCount) || unitCount < 1 || unitCount > 1_000_000) throw new Error("Enter between 1 and 1,000,000 bundled units");
  if (unitPriceMinor * unitCount > MAX_MINOR) throw new Error("Unit price × units exceeds the 1,000,000,000 ceiling");

  const caseIds = (Array.isArray(input.caseIds) ? input.caseIds : []).map((id) => text(id, 80)).filter(Boolean).slice(0, 50);
  const allocationBpsByCase: Record<string, number> = {};
  if (input.allocationBpsByCase && typeof input.allocationBpsByCase === "object") {
    for (const [key, value] of Object.entries(input.allocationBpsByCase)) {
      const id = text(key, 80);
      const bps = Math.round(Number(value) || 0);
      if (id && bps > 0) allocationBpsByCase[id] = bps;
    }
  }
  if (caseIds.length) {
    const caseWeightTotal = caseIds.reduce((sum, id) => sum + (allocationBpsByCase[id] || 0), 0);
    if (caseWeightTotal !== 10_000) throw new Error("Per-case allocation weights must sum to exactly 100% of the bundle");
  }

  const expectedMultipleBps = Math.round(Number(input.expectedMultipleBps));
  if (!Number.isFinite(expectedMultipleBps) || expectedMultipleBps < 0 || expectedMultipleBps > 1_000_000) throw new Error("Enter an expected multiple up to 100.00x");
  const expectedDurationMonths = input.expectedDurationMonths === null || input.expectedDurationMonths === undefined
    ? null : Math.round(Number(input.expectedDurationMonths));
  if (expectedDurationMonths !== null && (!Number.isFinite(expectedDurationMonths) || expectedDurationMonths < 0 || expectedDurationMonths > 600)) throw new Error("Enter an expected duration up to 600 months");

  return {
    name, claimType, jurisdiction,
    riskGrade: input.riskGrade,
    targetMinor, unitPriceMinor, unitCount,
    caseIds, allocationBpsByCase,
    expectedMultipleBps, expectedDurationMonths,
    summary: text(input.summary, 2000) || `${name} pools ${caseIds.length || 0} claims and pays funders a pro-rata share of realised recoveries.`,
    source: text(input.source, 160) || DEFAULT_SOURCE,
    asOf: text(input.asOf, 24) || new Date().toISOString().slice(0, 10),
  };
}

function rowToDossier(row: any): AdminLitigationDossierRow {
  const status = (LITIGATION_DOSSIER_STATUSES as readonly string[]).includes(String(row.dossierStatus))
    ? (row.dossierStatus as LitigationDossierStatus) : "FUNDING";
  const stage = (LITIGATION_STAGES as readonly string[]).includes(String(row.stage))
    ? (row.stage as LitigationStage) : "FILED";
  return {
    id: Number(row.id),
    dossierId: String(row.dossierId),
    caseName: String(row.caseName),
    claimant: String(row.claimant),
    defendant: String(row.defendant),
    claimType: String(row.claimType),
    countryCode: String(row.countryCode),
    country: String(row.country || ""),
    flag: String(row.flag || flagFor(String(row.countryCode))),
    jurisdiction: String(row.jurisdiction || row.country || ""),
    court: String(row.court || ""),
    counsel: row.counsel ? String(row.counsel) : null,
    meritGrade: (LITIGATION_MERIT_GRADES as readonly string[]).includes(String(row.meritGrade)) ? (row.meritGrade as LitigationMeritGrade) : null,
    riskGrade: (LITIGATION_RISK_GRADES as readonly string[]).includes(String(row.riskGrade)) ? (row.riskGrade as LitigationRiskGrade) : null,
    estimatedDamagesMinor: row.estimatedDamagesMinor === null || row.estimatedDamagesMinor === undefined ? null : Number(row.estimatedDamagesMinor),
    capitalAtRiskMinor: row.capitalAtRiskMinor === null || row.capitalAtRiskMinor === undefined ? null : Number(row.capitalAtRiskMinor),
    expectedMultipleBps: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? null : Number(row.expectedMultipleBps),
    expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? null : Number(row.expectedDurationMonths),
    fundingAskMinor: row.fundingAskMinor === null || row.fundingAskMinor === undefined ? null : Number(row.fundingAskMinor),
    fundingDeadline: row.fundingDeadline ? String(row.fundingDeadline) : null,
    stage,
    status,
    caseClass: (LITIGATION_CASE_CLASSES as readonly string[]).includes(String(row.caseClass))
      ? (row.caseClass as LitigationCaseClass)
      : classifyCaseClass({ claimType: String(row.claimType || ""), caseName: String(row.caseName || ""), detail: String(row.problem || "") }),
    causeOfAction: row.causeOfAction ? String(row.causeOfAction) : null,
    caseNumber: row.caseNumber ? String(row.caseNumber) : null,
    filedAt: row.filedAt ? String(row.filedAt) : null,
    courtDetail: row.courtDetail ? String(row.courtDetail) : null,
    claimValueBand: (LITIGATION_VALUE_BANDS as readonly string[]).includes(String(row.claimValueBand))
      ? (row.claimValueBand as LitigationValueBand)
      : null,
    problem: String(row.problem || ""),
    highlights: parseStringArray(row.highlightsJson, 160),
    scenarios: parseScenarios(row.scenariosJson),
    milestones: parseMilestones(row.milestonesJson),
    bundleId: row.bundleId ? String(row.bundleId) : null,
    source: String(row.source || DEFAULT_SOURCE),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
    asOf: String(row.asOf || ""),
    committedMinor: Number(row.committedMinor || 0),
    outcome: (LITIGATION_OUTCOMES as readonly string[]).includes(String(row.outcome)) ? (row.outcome as LitigationOutcome) : null,
    outcomeRecordedAt: row.outcomeRecordedAt ? new Date(row.outcomeRecordedAt).toISOString() : null,
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function rowToBundle(row: any): AdminLitigationBundleRow {
  let allocation: Record<string, number> = {};
  try {
    const parsed = JSON.parse(String(row.allocationBpsJson || "{}"));
    if (parsed && typeof parsed === "object") {
      allocation = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [String(key), Math.round(Number(value) || 0)]));
    }
  } catch { allocation = {}; }
  return {
    id: Number(row.id),
    bundleId: String(row.bundleId),
    name: String(row.name),
    claimType: String(row.claimType),
    jurisdiction: String(row.jurisdiction),
    riskGrade: (LITIGATION_RISK_GRADES as readonly string[]).includes(String(row.riskGrade)) ? (row.riskGrade as LitigationRiskGrade) : "BALANCED",
    targetMinor: Number(row.targetMinor || 0),
    unitPriceMinor: Number(row.unitPriceMinor || 0),
    unitCount: Number(row.unitCount || 0),
    caseIds: parseStringArray(row.caseIdsJson, 80),
    allocationBpsByCase: allocation,
    expectedMultipleBps: Number(row.expectedMultipleBps || 0),
    expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? null : Number(row.expectedDurationMonths),
    summary: String(row.summary || ""),
    source: String(row.source || DEFAULT_SOURCE),
    asOf: String(row.asOf || ""),
    committedMinor: Number(row.committedMinor || 0),
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Project an administrator dossier into the shared customer-facing case shape. */
export function dossierRowToCase(row: AdminLitigationDossierRow): LitigationCase {
  const fundable = row.status === "FUNDING" && Boolean(row.fundingAskMinor && row.fundingAskMinor > 0) && row.scenarios.length > 0;
  const fundedBps = row.fundingAskMinor && row.fundingAskMinor > 0
    ? Math.min(10_000, Math.round((row.committedMinor * 10_000) / row.fundingAskMinor)) : 0;
  return {
    id: row.dossierId,
    caseName: row.caseName,
    claimant: row.claimant,
    defendant: row.defendant,
    claimType: row.claimType,
    jurisdiction: row.jurisdiction,
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    court: row.court,
    counsel: row.counsel,
    caseClass: row.caseClass,
    claimantKind: classifyPartyKind(row.claimant),
    defendantKind: classifyPartyKind(row.defendant),
    causeOfAction: row.causeOfAction,
    caseNumber: row.caseNumber,
    filedAt: row.filedAt,
    courtDetail: row.courtDetail,
    claimValueBand: row.claimValueBand ?? claimValueBandFromMinor(row.estimatedDamagesMinor),
    listedParties: [],
    meritGrade: row.meritGrade,
    estimatedDamagesMinor: row.estimatedDamagesMinor,
    capitalAtRiskMinor: row.capitalAtRiskMinor,
    expectedMultipleBps: row.expectedMultipleBps,
    expectedDurationMonths: row.expectedDurationMonths,
    fundingAskMinor: row.fundingAskMinor,
    committedMinor: row.committedMinor,
    fundedBps,
    stage: row.stage,
    status: row.status,
    problem: row.problem,
    scenarios: row.scenarios,
    expectedValueMinor: expectedValueMinor(row.scenarios),
    fundingDeadline: row.fundingDeadline,
    remainingDays: remainingDaysFor(row.fundingDeadline),
    milestones: row.milestones,
    bundleId: row.bundleId,
    source: row.source,
    sourceUrl: row.sourceUrl,
    asOf: row.asOf,
    verified: true,
    fundable,
    highlights: row.highlights,
  };
}

/** Project an administrator bundle into the shared customer-facing bundle shape. */
export function bundleRowToBundle(row: AdminLitigationBundleRow): LitigationBundle {
  return {
    id: row.bundleId,
    name: row.name,
    claimType: row.claimType,
    jurisdiction: row.jurisdiction,
    riskGrade: row.riskGrade,
    targetMinor: row.targetMinor,
    committedMinor: row.committedMinor,
    unitPriceMinor: row.unitPriceMinor,
    unitCount: row.unitCount,
    caseIds: row.caseIds,
    allocationBpsByCase: row.allocationBpsByCase,
    expectedMultipleBps: row.expectedMultipleBps,
    expectedDurationMonths: row.expectedDurationMonths,
    summary: row.summary,
    enabled: row.enabled,
    source: row.source,
    asOf: row.asOf,
  };
}

async function recordAudit(conn: Db, actorUserId: number, action: string, entityType: string, entityId: string, reason: string | null | undefined, metadata: unknown) {
  await conn.execute(
    `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
    [actorUserId, action, entityType, entityId, text(reason, 500) || null, `${entityType}:${entityId}`, JSON.stringify(metadata ?? {})],
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

/* ------------------------------------------------------------------ *
 * Dossiers
 * ------------------------------------------------------------------ */

/** All administrator dossiers, newest first, for the admin console. */
export async function listAdminLitigationDossiers(): Promise<AdminLitigationDossierRow[]> {
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToDossier);
  });
}

/** Enabled dossiers projected for the customer desk. */
export async function listEnabledAdminLitigationDossiers(): Promise<LitigationCase[]> {
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => dossierRowToCase(rowToDossier(row)));
  });
}

/** Full administrator dossier row by id (used by outcome recording). */
export async function findAdminLitigationDossier(dossierId: string): Promise<AdminLitigationDossierRow | null> {
  const id = text(dossierId, 80);
  if (!id) return null;
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rows.length ? rowToDossier(rows[0]) : null;
  });
}

/** Resolve a single enabled dossier for a customer commitment, or null. */
export async function findEnabledAdminLitigationDossier(dossierId: string): Promise<LitigationCase | null> {
  const id = text(dossierId, 80);
  if (!id) return null;
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? dossierRowToCase(rowToDossier(rows[0])) : null;
  });
}

const DOSSIER_INSERT_COLUMNS =
  "dossierId,caseName,claimant,defendant,claimType,countryCode,country,jurisdiction,court,counsel,caseClass,causeOfAction,caseNumber,filedAt,courtDetail,claimValueBand,meritGrade,riskGrade,estimatedDamagesMinor,capitalAtRiskMinor,expectedMultipleBps,expectedDurationMonths,fundingAskMinor,fundingDeadline,stage,dossierStatus,problem,highlightsJson,scenariosJson,milestonesJson,bundleId,source,sourceUrl,asOf,enabled,createdByUserId,updatedByUserId";

function dossierInsertValues(normalized: ReturnType<typeof normalizeDossierInput>, actor: number) {
  const jurisdiction = normalized.country.name;
  return [
    normalized.caseName, normalized.claimant, normalized.defendant, normalized.claimType,
    normalized.country.code, normalized.country.name, jurisdiction, normalized.court, normalized.counsel,
    normalized.caseClass, normalized.causeOfAction, normalized.caseNumber, normalized.filedAt, normalized.courtDetail, normalized.claimValueBand,
    normalized.meritGrade, normalized.riskGrade, normalized.estimatedDamagesMinor, normalized.capitalAtRiskMinor,
    normalized.expectedMultipleBps, normalized.expectedDurationMonths, normalized.fundingAskMinor, normalized.fundingDeadline,
    normalized.stage, normalized.status, normalized.problem, JSON.stringify(normalized.highlights),
    JSON.stringify(normalized.scenarios), JSON.stringify(normalized.milestones), normalized.bundleId,
    normalized.source, normalized.sourceUrl, normalized.asOf, 1, actor, actor,
  ];
}

/** Create an administrator dossier. Enabled on submit. */
export async function createAdminLitigationDossier(adminUserId: number, input: AdminLitigationDossierInput): Promise<AdminLitigationDossierRow> {
  const normalized = normalizeDossierInput(input);
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const base = `admin-${slugify(normalized.caseName) || "case"}-${crypto.randomBytes(2).toString("hex")}`;
    const dossierId = await uniqueId(conn, LITIGATION_DOSSIERS_TABLE, "dossierId", base);
    await conn.execute(
      `INSERT INTO ${LITIGATION_DOSSIERS_TABLE} (${DOSSIER_INSERT_COLUMNS}) VALUES (${Array(37).fill("?").join(",")})`,
      [dossierId, ...dossierInsertValues(normalized, adminUserId)],
    );
    await recordAudit(conn, adminUserId, "litigation_dossier_created", "litigation_fund_dossier", dossierId, input.reason, {
      dossierId, countryCode: normalized.country.code, status: normalized.status, stage: normalized.stage,
      fundingAskMinor: normalized.fundingAskMinor, scenarios: normalized.scenarios.length,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [dossierId]);
    return rowToDossier(rows[0]);
  });
}

/** Update an existing administrator dossier; the country flag/jurisdiction are re-derived. */
export async function updateAdminLitigationDossier(adminUserId: number, dossierId: string, input: AdminLitigationDossierInput): Promise<AdminLitigationDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  const normalized = normalizeDossierInput(input);
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT dossierId FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This dossier no longer exists on the desk");
    await conn.execute(
      `UPDATE ${LITIGATION_DOSSIERS_TABLE}
        SET caseName=?,claimant=?,defendant=?,claimType=?,countryCode=?,country=?,jurisdiction=?,court=?,counsel=?,
            caseClass=?,causeOfAction=?,caseNumber=?,filedAt=?,courtDetail=?,claimValueBand=?,meritGrade=?,riskGrade=?,
            estimatedDamagesMinor=?,capitalAtRiskMinor=?,expectedMultipleBps=?,expectedDurationMonths=?,fundingAskMinor=?,fundingDeadline=?,
            stage=?,dossierStatus=?,problem=?,highlightsJson=?,scenariosJson=?,milestonesJson=?,bundleId=?,source=?,sourceUrl=?,asOf=?,
            updatedByUserId=?,updatedAt=NOW(3)
       WHERE dossierId=?`,
      [
        normalized.caseName, normalized.claimant, normalized.defendant, normalized.claimType,
        normalized.country.code, normalized.country.name, normalized.country.name, normalized.court, normalized.counsel,
        normalized.caseClass, normalized.causeOfAction, normalized.caseNumber, normalized.filedAt, normalized.courtDetail, normalized.claimValueBand,
        normalized.meritGrade, normalized.riskGrade, normalized.estimatedDamagesMinor, normalized.capitalAtRiskMinor,
        normalized.expectedMultipleBps, normalized.expectedDurationMonths, normalized.fundingAskMinor, normalized.fundingDeadline,
        normalized.stage, normalized.status, normalized.problem, JSON.stringify(normalized.highlights),
        JSON.stringify(normalized.scenarios), JSON.stringify(normalized.milestones), normalized.bundleId,
        normalized.source, normalized.sourceUrl, normalized.asOf, adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "litigation_dossier_updated", "litigation_fund_dossier", id, input.reason, {
      dossierId: id, countryCode: normalized.country.code, status: normalized.status, stage: normalized.stage,
      fundingAskMinor: normalized.fundingAskMinor, scenarios: normalized.scenarios.length,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Enable or disable a dossier. Disabled dossiers leave the customer desk. */
export async function setAdminLitigationDossierEnabled(adminUserId: number, dossierId: string, enabled: boolean): Promise<AdminLitigationDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${LITIGATION_DOSSIERS_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE dossierId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This dossier no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "litigation_dossier_enabled" : "litigation_dossier_disabled", "litigation_fund_dossier", id, null, { dossierId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Move the dossier through its lifecycle (FUNDING → ESCROW → ACTIVE → RESOLVED/WITHDRAWN). */
export async function setAdminLitigationDossierStatus(adminUserId: number, dossierId: string, status: LitigationDossierStatus, reason?: string | null): Promise<AdminLitigationDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  if (!(LITIGATION_DOSSIER_STATUSES as readonly string[]).includes(status)) throw new Error("Select a valid dossier status");
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT dossierId FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This dossier no longer exists on the desk");
    await conn.execute(`UPDATE ${LITIGATION_DOSSIERS_TABLE} SET dossierStatus=?, updatedByUserId=?, updatedAt=NOW(3) WHERE dossierId=?`, [status, adminUserId, id]);
    await recordAudit(conn, adminUserId, "litigation_dossier_status_changed", "litigation_fund_dossier", id, reason, { dossierId: id, status });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/**
 * Mark one escrow milestone (Filed → Discovery → … → Distribution) as reached.
 * The release weight is administrator-configured, not derived here. Once a
 * milestone is reached it is never reverted — history is append-only.
 */
export async function reachAdminLitigationMilestone(adminUserId: number, dossierId: string, stage: LitigationStage, reason?: string | null): Promise<AdminLitigationDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  if (!(LITIGATION_STAGES as readonly string[]).includes(stage)) throw new Error("Select a valid milestone stage");
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1 FOR UPDATE`, [id]);
    if (!rows.length) throw new Error("This dossier no longer exists on the desk");
    const record = rowToDossier(rows[0]);
    const milestones = record.milestones.length ? record.milestones : defaultMilestones();
    const target = milestones.find((milestone) => milestone.stage === stage);
    if (!target) throw new Error("This dossier does not model that milestone");
    if (target.status === "REACHED") throw new Error("That milestone has already been reached");
    const reachedAt = new Date().toISOString();
    const updated = milestones.map((milestone) => (milestone.stage === stage ? { ...milestone, status: "REACHED" as const, reachedAt } : milestone));
    await conn.execute(`UPDATE ${LITIGATION_DOSSIERS_TABLE} SET milestonesJson=?, updatedByUserId=?, updatedAt=NOW(3) WHERE dossierId=?`, [JSON.stringify(updated), adminUserId, id]);
    await recordAudit(conn, adminUserId, "litigation_milestone_reached", "litigation_fund_dossier", id, reason, { dossierId: id, stage, releaseBps: target.releaseBps, reachedAt });
    const [after] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(after[0]);
  });
}

/** Stamp the recorded outcome on the dossier. Called inside the payout transaction. */
export async function applyDossierOutcome(conn: Db, dossierId: string, outcome: LitigationOutcome): Promise<void> {
  await conn.execute(`UPDATE ${LITIGATION_DOSSIERS_TABLE} SET outcome=?, outcomeRecordedAt=NOW(), updatedAt=NOW(3) WHERE dossierId=?`, [outcome, dossierId]);
}

/** Permanently remove an administrator dossier. */
export async function deleteAdminLitigationDossier(adminUserId: number, dossierId: string): Promise<{ dossierId: string; deleted: boolean }> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${LITIGATION_DOSSIERS_TABLE} WHERE dossierId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "litigation_dossier_deleted", "litigation_fund_dossier", id, null, { dossierId: id });
    return { dossierId: id, deleted };
  });
}

/* ------------------------------------------------------------------ *
 * Bundles
 * ------------------------------------------------------------------ */

export async function listAdminLitigationBundles(): Promise<AdminLitigationBundleRow[]> {
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_BUNDLES_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToBundle);
  });
}

export async function listEnabledAdminLitigationBundles(): Promise<LitigationBundle[]> {
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_BUNDLES_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => bundleRowToBundle(rowToBundle(row)));
  });
}

export async function findEnabledAdminLitigationBundle(bundleId: string): Promise<LitigationBundle | null> {
  const id = text(bundleId, 80);
  if (!id) return null;
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_BUNDLES_TABLE} WHERE bundleId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? bundleRowToBundle(rowToBundle(rows[0])) : null;
  });
}

export async function createAdminLitigationBundle(adminUserId: number, input: AdminLitigationBundleInput): Promise<AdminLitigationBundleRow> {
  const normalized = normalizeBundleInput(input);
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const base = `admin-bundle-${slugify(normalized.name) || "pool"}-${crypto.randomBytes(2).toString("hex")}`;
    const bundleId = await uniqueId(conn, LITIGATION_BUNDLES_TABLE, "bundleId", base);
    await conn.execute(
      `INSERT INTO ${LITIGATION_BUNDLES_TABLE}
        (bundleId,name,claimType,jurisdiction,riskGrade,targetMinor,unitPriceMinor,unitCount,caseIdsJson,allocationBpsJson,expectedMultipleBps,expectedDurationMonths,summary,source,asOf,enabled,createdByUserId,updatedByUserId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        bundleId, normalized.name, normalized.claimType, normalized.jurisdiction, normalized.riskGrade,
        normalized.targetMinor, normalized.unitPriceMinor, normalized.unitCount,
        JSON.stringify(normalized.caseIds), JSON.stringify(normalized.allocationBpsByCase),
        normalized.expectedMultipleBps, normalized.expectedDurationMonths, normalized.summary,
        normalized.source, normalized.asOf, adminUserId, adminUserId,
      ],
    );
    await recordAudit(conn, adminUserId, "litigation_bundle_created", "litigation_fund_bundle", bundleId, input.reason, {
      bundleId, caseIds: normalized.caseIds, targetMinor: normalized.targetMinor, expectedMultipleBps: normalized.expectedMultipleBps,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_BUNDLES_TABLE} WHERE bundleId=? LIMIT 1`, [bundleId]);
    return rowToBundle(rows[0]);
  });
}

export async function updateAdminLitigationBundle(adminUserId: number, bundleId: string, input: AdminLitigationBundleInput): Promise<AdminLitigationBundleRow> {
  const id = text(bundleId, 80);
  if (!id) throw new Error("A valid bundle id is required");
  const normalized = normalizeBundleInput(input);
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT bundleId FROM ${LITIGATION_BUNDLES_TABLE} WHERE bundleId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This bundle no longer exists on the desk");
    await conn.execute(
      `UPDATE ${LITIGATION_BUNDLES_TABLE}
        SET name=?,claimType=?,jurisdiction=?,riskGrade=?,targetMinor=?,unitPriceMinor=?,unitCount=?,caseIdsJson=?,allocationBpsJson=?,
            expectedMultipleBps=?,expectedDurationMonths=?,summary=?,source=?,asOf=?,updatedByUserId=?,updatedAt=NOW(3)
       WHERE bundleId=?`,
      [
        normalized.name, normalized.claimType, normalized.jurisdiction, normalized.riskGrade,
        normalized.targetMinor, normalized.unitPriceMinor, normalized.unitCount,
        JSON.stringify(normalized.caseIds), JSON.stringify(normalized.allocationBpsByCase),
        normalized.expectedMultipleBps, normalized.expectedDurationMonths, normalized.summary,
        normalized.source, normalized.asOf, adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "litigation_bundle_updated", "litigation_fund_bundle", id, input.reason, {
      bundleId: id, caseIds: normalized.caseIds, targetMinor: normalized.targetMinor, expectedMultipleBps: normalized.expectedMultipleBps,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_BUNDLES_TABLE} WHERE bundleId=? LIMIT 1`, [id]);
    return rowToBundle(rows[0]);
  });
}

export async function setAdminLitigationBundleEnabled(adminUserId: number, bundleId: string, enabled: boolean): Promise<AdminLitigationBundleRow> {
  const id = text(bundleId, 80);
  if (!id) throw new Error("A valid bundle id is required");
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${LITIGATION_BUNDLES_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE bundleId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This bundle no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "litigation_bundle_enabled" : "litigation_bundle_disabled", "litigation_fund_bundle", id, null, { bundleId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${LITIGATION_BUNDLES_TABLE} WHERE bundleId=? LIMIT 1`, [id]);
    return rowToBundle(rows[0]);
  });
}

export async function deleteAdminLitigationBundle(adminUserId: number, bundleId: string): Promise<{ bundleId: string; deleted: boolean }> {
  const id = text(bundleId, 80);
  if (!id) throw new Error("A valid bundle id is required");
  await ensureLitigationFundDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${LITIGATION_BUNDLES_TABLE} WHERE bundleId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "litigation_bundle_deleted", "litigation_fund_bundle", id, null, { bundleId: id });
    return { bundleId: id, deleted };
  });
}
