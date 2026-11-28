import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import { findCountry, flagFor } from "@shared/country-options";
import {
  classifyAgroType,
  defaultAgroMilestones,
  expectedValueMinor,
  agroValueBandFromMinor,
  remainingDaysFor,
  AGRO_DOSSIER_STATUSES,
  AGRO_INVESTMENT_TYPES,
  AGRO_OUTCOMES,
  AGRO_RISK_GRADES,
  AGRO_SECTORS,
  AGRO_STAGES,
  AGRO_TERRITORY_BANDS,
  type AgroDossierStatus,
  type AgroInvestmentType,
  type AgroMilestone,
  type AgroOpportunity,
  type AgroOutcome,
  type AgroRiskGrade,
  type AgroScenario,
  type AgroSector,
  type AgroStage,
  type AgroTerritoryBand,
} from "@shared/agro-investment-catalogue";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for administrator-published Agro Investment
 * dossiers (kept outside Drizzle, matching the litigation / IP royalty template).
 *
 * The DISCOVERY layer (shared/agro-investment-catalogue.ts) surfaces cited public
 * agriculture references; those are candidates with no economics. A DOSSIER is
 * the administrator's reviewed, sourced opportunity for one agriculture project
 * and is the only thing a customer can fund. Nothing is invented: an
 * administrator must supply the funding target, the revenue multiple and — for a
 * fully modelled opportunity — the three outcome scenarios, each traceable to a
 * source URL and an as-of date.
 */
export const AGRO_DOSSIERS_TABLE = "agro_investment_dossiers";

const CREATE_DOSSIERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS agro_investment_dossiers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dossierId VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  operator VARCHAR(160) NOT NULL,
  agroType VARCHAR(32) NOT NULL,
  sector VARCHAR(16) NOT NULL,
  territory VARCHAR(120) NOT NULL,
  territoryBand VARCHAR(16) NOT NULL,
  countryCode VARCHAR(2) NOT NULL,
  country VARCHAR(120) NOT NULL,
  offtaker VARCHAR(160) NULL,
  description TEXT NOT NULL,
  dealType VARCHAR(120) NULL,
  stage VARCHAR(24) NOT NULL,
  dossierStatus VARCHAR(24) NOT NULL DEFAULT 'FUNDING',
  riskGrade VARCHAR(16) NULL,
  revenueSharesBps INT NULL,
  expectedMultipleBps INT NULL,
  expectedDurationMonths INT NULL,
  projectedRevenueMinor BIGINT NULL,
  capitalAtRiskMinor BIGINT NULL,
  fundingAskMinor BIGINT NULL,
  minimumInvestmentMinor BIGINT NULL,
  unitPriceMinor BIGINT NULL,
  eventDate VARCHAR(24) NULL,
  fundingDeadline VARCHAR(24) NULL,
  highlightsJson TEXT NULL,
  scenariosJson TEXT NULL,
  milestonesJson TEXT NULL,
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
  UNIQUE KEY agro_investment_dossiers_id_idx (dossierId),
  KEY agro_investment_dossiers_enabled_idx (enabled, dossierStatus),
  KEY agro_investment_dossiers_type_idx (agroType)
) ENGINE=InnoDB`;

const DEFAULT_SOURCE = "Arbitrade agro desk — administrator published";
const MAX_MINOR = 100_000_000_000;

export type AdminAgroDossierRow = {
  id: number;
  dossierId: string;
  title: string;
  operator: string;
  agroType: AgroInvestmentType;
  sector: AgroSector;
  territory: string;
  territoryBand: AgroTerritoryBand;
  countryCode: string;
  country: string;
  flag: string;
  offtaker: string | null;
  description: string;
  dealType: string | null;
  stage: AgroStage;
  status: AgroDossierStatus;
  riskGrade: AgroRiskGrade | null;
  revenueSharesBps: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  projectedRevenueMinor: number | null;
  capitalAtRiskMinor: number | null;
  fundingAskMinor: number | null;
  minimumInvestmentMinor: number | null;
  unitPriceMinor: number | null;
  eventDate: string | null;
  fundingDeadline: string | null;
  highlights: string[];
  scenarios: AgroScenario[];
  milestones: AgroMilestone[];
  source: string;
  sourceUrl: string | null;
  asOf: string;
  committedMinor: number;
  outcome: AgroOutcome | null;
  outcomeRecordedAt: string | null;
  enabled: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminAgroScenarioInput = {
  outcome: AgroOutcome;
  label?: string;
  probabilityBps: number;
  grossRevenueMinor: number;
  durationMonths: number;
  funderMultipleBps: number;
};

export type AdminAgroDossierInput = {
  title: string;
  operator: string;
  agroType: AgroInvestmentType;
  sector: AgroSector;
  countryCode: string;
  territory?: string | null;
  territoryBand?: AgroTerritoryBand | null;
  offtaker?: string | null;
  description: string;
  dealType?: string | null;
  revenueSharesBps?: number | null;
  expectedMultipleBps?: number | null;
  expectedDurationMonths?: number | null;
  projectedRevenueMinor?: number | null;
  capitalAtRiskMinor?: number | null;
  fundingAskMinor?: number | null;
  minimumInvestmentMinor?: number | null;
  unitPriceMinor?: number | null;
  eventDate?: string | null;
  fundingDeadline?: string | null;
  stage: AgroStage;
  status: AgroDossierStatus;
  riskGrade?: AgroRiskGrade | null;
  highlights?: string[] | null;
  scenarios?: AdminAgroScenarioInput[] | null;
  milestones?: AgroMilestone[] | null;
  source?: string | null;
  sourceUrl?: string | null;
  asOf?: string | null;
  reason?: string | null;
};

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const conn = await getSharedMysqlPool().getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive dossiers table exists (memoized). */
export function ensureAgroInvestmentDossierSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => { await conn.query(CREATE_DOSSIERS_TABLE_SQL); });
    } catch (error) {
      schemaReady = null;
      console.error("[AgroInvestmentDossiers] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
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

function parseScenarios(raw: unknown): AgroScenario[] {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(list)) return [];
    return list.map((item: any) => ({
      outcome: item.outcome,
      label: text(item.label, 80) || String(item.outcome || ""),
      probabilityBps: Math.round(Number(item.probabilityBps) || 0),
      grossRevenueMinor: Math.round(Number(item.grossRevenueMinor) || 0),
      durationMonths: Math.round(Number(item.durationMonths) || 0),
      funderMultipleBps: Math.round(Number(item.funderMultipleBps) || 0),
    })).filter((item) => (AGRO_OUTCOMES as readonly string[]).includes(item.outcome));
  } catch { return []; }
}

function parseMilestones(raw: unknown): AgroMilestone[] {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(list)) return [];
    return list
      .filter((item: any) => (AGRO_STAGES as readonly string[]).includes(String(item?.stage)))
      .map((item: any) => ({
        stage: item.stage as AgroStage,
        label: text(item.label, 60) || String(item.stage),
        releaseBps: Math.round(Number(item.releaseBps) || 0),
        status: item.status === "REACHED" ? "REACHED" : "PENDING",
        reachedAt: item.reachedAt ? text(item.reachedAt, 40) : null,
      }));
  } catch { return []; }
}

/**
 * Validate the administrator's dossier. Fails closed: an unknown agriculture
 * type or sector, a bad country, a non-positive funding target, negative
 * economics, or scenarios whose probabilities do not sum to exactly 100% all
 * throw before anything is written. Economics are only accepted when cited.
 */
function normalizeAgroDossierInput(input: AdminAgroDossierInput) {
  const title = text(input.title, 200);
  if (title.length < 3) throw new Error("Enter an opportunity title of at least 3 characters");
  const operator = text(input.operator, 160);
  if (operator.length < 2) throw new Error("Enter the farm, cooperative, agribusiness or rights holder");
  if (!(AGRO_INVESTMENT_TYPES as readonly string[]).includes(input.agroType)) throw new Error("Select a valid agriculture investment type");
  if (!(AGRO_SECTORS as readonly string[]).includes(input.sector)) throw new Error("Select a valid agriculture sector");

  const country = findCountry(input.countryCode);
  if (!country) throw new Error("Select a supported country for this opportunity");

  const description = text(input.description, 2000);
  if (description.length < 8) throw new Error("Describe the opportunity in at least 8 characters");

  if (!(AGRO_STAGES as readonly string[]).includes(input.stage)) throw new Error("Select a valid lifecycle stage");
  if (!(AGRO_DOSSIER_STATUSES as readonly string[]).includes(input.status)) throw new Error("Select a valid opportunity status");

  const riskGrade = input.riskGrade === null || input.riskGrade === undefined || (input.riskGrade as string) === "" ? null : input.riskGrade;
  if (riskGrade !== null && !(AGRO_RISK_GRADES as readonly string[]).includes(riskGrade)) throw new Error("Select a valid risk grade");

  const territoryBand: AgroTerritoryBand = input.territoryBand && (AGRO_TERRITORY_BANDS as readonly string[]).includes(input.territoryBand)
    ? input.territoryBand : "NATIONAL";
  const territory = text(input.territory, 120) || country.name;

  const fundingAskMinor = optionalMinor(input.fundingAskMinor, "funding target");
  const capitalAtRiskMinor = optionalMinor(input.capitalAtRiskMinor, "capital at risk");
  const projectedRevenueMinor = optionalMinor(input.projectedRevenueMinor, "projected revenue");
  const minimumInvestmentMinor = optionalMinor(input.minimumInvestmentMinor, "minimum investment");
  const unitPriceMinor = optionalMinor(input.unitPriceMinor, "unit price");

  const rawShares = input.revenueSharesBps === null || input.revenueSharesBps === undefined ? null : Math.round(Number(input.revenueSharesBps));
  if (rawShares !== null && (!Number.isFinite(rawShares) || rawShares < 0 || rawShares > 10_000)) throw new Error("Investor revenue share must be between 0% and 100%");

  const rawMultiple = input.expectedMultipleBps === null || input.expectedMultipleBps === undefined ? null : Math.round(Number(input.expectedMultipleBps));
  if (rawMultiple !== null && (!Number.isFinite(rawMultiple) || rawMultiple < 0 || rawMultiple > 1_000_000)) throw new Error("Enter an expected multiple up to 100.00x");
  const rawDuration = input.expectedDurationMonths === null || input.expectedDurationMonths === undefined ? null : Math.round(Number(input.expectedDurationMonths));
  if (rawDuration !== null && (!Number.isFinite(rawDuration) || rawDuration < 0 || rawDuration > 600)) throw new Error("Enter an expected duration up to 600 months");

  const eventDate = text(input.eventDate, 24) || null;
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error("Enter the event or production date as YYYY-MM-DD");
  const fundingDeadline = text(input.fundingDeadline, 24) || null;
  if (fundingDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(fundingDeadline)) throw new Error("Enter the funding deadline as YYYY-MM-DD");

  const highlights = (Array.isArray(input.highlights) ? input.highlights : [])
    .map((item) => text(item, 160)).filter(Boolean).slice(0, 8);

  // Outcome scenarios: either none (not modelled — cannot invest) or a full set
  // of exactly the three outcomes summing to 10,000 basis points.
  const rawScenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  let scenarios: AgroScenario[] = [];
  if (rawScenarios.length) {
    const seen = new Set<string>();
    scenarios = rawScenarios.map((scenario) => {
      const outcome = String(scenario?.outcome || "").toUpperCase() as AgroOutcome;
      if (!(AGRO_OUTCOMES as readonly string[]).includes(outcome)) throw new Error("Each scenario must be a STRONG_SEASON, ON_PLAN or WRITE_OFF outcome");
      if (seen.has(outcome)) throw new Error(`The ${outcome} scenario is duplicated`);
      seen.add(outcome);
      const probabilityBps = Math.round(Number(scenario.probabilityBps));
      if (!Number.isFinite(probabilityBps) || probabilityBps < 0 || probabilityBps > 10_000) throw new Error("Each scenario probability must be between 0% and 100%");
      const grossRevenueMinor = Math.round(Number(scenario.grossRevenueMinor));
      if (!Number.isSafeInteger(grossRevenueMinor) || grossRevenueMinor < 0 || grossRevenueMinor > MAX_MINOR) throw new Error("Enter a valid gross revenue for each scenario");
      const durationMonths = Math.round(Number(scenario.durationMonths));
      if (!Number.isFinite(durationMonths) || durationMonths < 0 || durationMonths > 600) throw new Error("Enter a valid duration for each scenario");
      const funderMultipleBps = Math.round(Number(scenario.funderMultipleBps));
      if (!Number.isFinite(funderMultipleBps) || funderMultipleBps < 0 || funderMultipleBps > 1_000_000) throw new Error("Enter a valid funder multiple for each scenario");
      return { outcome, label: text(scenario.label, 80) || outcome, probabilityBps, grossRevenueMinor, durationMonths, funderMultipleBps };
    });
    for (const outcome of AGRO_OUTCOMES) {
      if (!seen.has(outcome)) throw new Error(`Provide the ${outcome} scenario so the three modelled outcomes are complete`);
    }
    const total = scenarios.reduce((sum, scenario) => sum + scenario.probabilityBps, 0);
    if (total !== 10_000) throw new Error("Scenario probabilities must sum to exactly 100%");
    if (!fundingAskMinor) throw new Error("Set a funding target before publishing outcome scenarios");
  }

  const rawMilestones = Array.isArray(input.milestones) ? input.milestones : [];
  let milestones: AgroMilestone[];
  if (rawMilestones.length) {
    milestones = rawMilestones
      .filter((milestone) => (AGRO_STAGES as readonly string[]).includes(milestone?.stage))
      .map((milestone) => ({
        stage: milestone.stage as AgroStage,
        label: text(milestone.label, 60) || String(milestone.stage),
        releaseBps: Math.round(Number(milestone.releaseBps) || 0),
        status: milestone.status === "REACHED" ? ("REACHED" as const) : ("PENDING" as const),
        reachedAt: milestone.reachedAt ? text(milestone.reachedAt, 40) : null,
      }));
    if (!milestones.length) throw new Error("Provide at least one valid milestone stage");
    const releaseTotal = milestones.reduce((sum, milestone) => sum + milestone.releaseBps, 0);
    if (releaseTotal !== 10_000) throw new Error("Milestone release weights must sum to exactly 100% of escrow");
  } else {
    milestones = defaultAgroMilestones();
  }

  const asOf = text(input.asOf, 24) || new Date().toISOString().slice(0, 10);
  const sourceUrl = text(input.sourceUrl, 300) || null;
  if (scenarios.length && !sourceUrl) throw new Error("A modelled opportunity must cite its source URL so the economics can be verified");

  return {
    title, operator, agroType: input.agroType, sector: input.sector,
    country, territory, territoryBand,
    offtaker: text(input.offtaker, 160) || null,
    description,
    dealType: text(input.dealType, 120) || null,
    revenueSharesBps: rawShares,
    expectedMultipleBps: rawMultiple, expectedDurationMonths: rawDuration,
    projectedRevenueMinor, capitalAtRiskMinor, fundingAskMinor, minimumInvestmentMinor, unitPriceMinor,
    eventDate, fundingDeadline,
    stage: input.stage, status: input.status, riskGrade,
    highlights, scenarios, milestones,
    source: text(input.source, 160) || DEFAULT_SOURCE, sourceUrl, asOf,
  };
}

function rowToDossier(row: any): AdminAgroDossierRow {
  const status = (AGRO_DOSSIER_STATUSES as readonly string[]).includes(String(row.dossierStatus))
    ? (row.dossierStatus as AgroDossierStatus) : "FUNDING";
  const stage = (AGRO_STAGES as readonly string[]).includes(String(row.stage))
    ? (row.stage as AgroStage) : "PLANNED";
  return {
    id: Number(row.id),
    dossierId: String(row.dossierId),
    title: String(row.title),
    operator: String(row.operator),
    agroType: (AGRO_INVESTMENT_TYPES as readonly string[]).includes(String(row.agroType))
      ? (row.agroType as AgroInvestmentType)
      : classifyAgroType({ title: String(row.title || ""), description: String(row.description || "") }),
    sector: (AGRO_SECTORS as readonly string[]).includes(String(row.sector)) ? (row.sector as AgroSector) : "OTHER",
    territory: String(row.territory || ""),
    territoryBand: (AGRO_TERRITORY_BANDS as readonly string[]).includes(String(row.territoryBand)) ? (row.territoryBand as AgroTerritoryBand) : "NATIONAL",
    countryCode: String(row.countryCode),
    country: String(row.country || ""),
    flag: String(row.flag || ""),
    offtaker: row.offtaker ? String(row.offtaker) : null,
    description: String(row.description || ""),
    dealType: row.dealType ? String(row.dealType) : null,
    stage,
    status,
    riskGrade: (AGRO_RISK_GRADES as readonly string[]).includes(String(row.riskGrade)) ? (row.riskGrade as AgroRiskGrade) : null,
    revenueSharesBps: row.revenueSharesBps === null || row.revenueSharesBps === undefined ? null : Number(row.revenueSharesBps),
    expectedMultipleBps: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? null : Number(row.expectedMultipleBps),
    expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? null : Number(row.expectedDurationMonths),
    projectedRevenueMinor: row.projectedRevenueMinor === null || row.projectedRevenueMinor === undefined ? null : Number(row.projectedRevenueMinor),
    capitalAtRiskMinor: row.capitalAtRiskMinor === null || row.capitalAtRiskMinor === undefined ? null : Number(row.capitalAtRiskMinor),
    fundingAskMinor: row.fundingAskMinor === null || row.fundingAskMinor === undefined ? null : Number(row.fundingAskMinor),
    minimumInvestmentMinor: row.minimumInvestmentMinor === null || row.minimumInvestmentMinor === undefined ? null : Number(row.minimumInvestmentMinor),
    unitPriceMinor: row.unitPriceMinor === null || row.unitPriceMinor === undefined ? null : Number(row.unitPriceMinor),
    eventDate: row.eventDate ? String(row.eventDate) : null,
    fundingDeadline: row.fundingDeadline ? String(row.fundingDeadline) : null,
    highlights: parseStringArray(row.highlightsJson, 160),
    scenarios: parseScenarios(row.scenariosJson),
    milestones: parseMilestones(row.milestonesJson),
    source: String(row.source || DEFAULT_SOURCE),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
    asOf: String(row.asOf || ""),
    committedMinor: Number(row.committedMinor || 0),
    outcome: (AGRO_OUTCOMES as readonly string[]).includes(String(row.outcome)) ? (row.outcome as AgroOutcome) : null,
    outcomeRecordedAt: row.outcomeRecordedAt ? new Date(row.outcomeRecordedAt).toISOString() : null,
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    createdByUserId: row.createdByUserId === null || row.createdByUserId === undefined ? null : Number(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null || row.updatedByUserId === undefined ? null : Number(row.updatedByUserId),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Project an administrator dossier into the shared customer-facing opportunity shape. */
export function dossierRowToOpportunity(row: AdminAgroDossierRow): AgroOpportunity {
  const fundable = row.status === "FUNDING" && Boolean(row.fundingAskMinor && row.fundingAskMinor > 0) && row.scenarios.length > 0;
  const fundedBps = row.fundingAskMinor && row.fundingAskMinor > 0
    ? Math.min(10_000, Math.round((row.committedMinor * 10_000) / row.fundingAskMinor)) : 0;
  return {
    id: row.dossierId,
    title: row.title,
    operator: row.operator,
    agroType: row.agroType,
    sector: row.sector,
    territory: row.territory,
    territoryBand: row.territoryBand,
    countryCode: row.countryCode,
    country: row.country,
    flag: row.flag,
    offtaker: row.offtaker,
    description: row.description,
    dealType: row.dealType,
    stage: row.stage,
    status: row.status,
    riskGrade: row.riskGrade,
    revenueSharesBps: row.revenueSharesBps,
    expectedMultipleBps: row.expectedMultipleBps,
    expectedDurationMonths: row.expectedDurationMonths,
    projectedRevenueMinor: row.projectedRevenueMinor,
    capitalAtRiskMinor: row.capitalAtRiskMinor,
    fundingAskMinor: row.fundingAskMinor,
    committedMinor: row.committedMinor,
    fundedBps,
    minimumInvestmentMinor: row.minimumInvestmentMinor,
    unitPriceMinor: row.unitPriceMinor,
    eventDate: row.eventDate,
    fundingDeadline: row.fundingDeadline,
    remainingDays: remainingDaysFor(row.fundingDeadline),
    scenarios: row.scenarios,
    expectedValueMinor: expectedValueMinor(row.scenarios),
    milestones: row.milestones,
    highlights: row.highlights,
    source: row.source,
    sourceUrl: row.sourceUrl,
    asOf: row.asOf,
    verified: true,
    fundable,
  };
}

async function recordAudit(conn: Db, actorUserId: number, action: string, entityType: string, entityId: string, reason: string | null | undefined, metadata: unknown) {
  await conn.execute(
    `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
    [actorUserId, action, entityType, entityId, text(reason, 500) || null, `${entityType}:${entityId}`, JSON.stringify(metadata ?? {})],
  );
}

async function uniqueId(conn: Db, table: string, column: string, base: string): Promise<string> {
  const root = base.slice(0, 72) || `admin-agro-${crypto.randomBytes(3).toString("hex")}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [rows] = await conn.query<any[]>(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`, [candidate]);
    if (!rows.length) return candidate;
  }
  return `admin-agro-${crypto.randomBytes(6).toString("hex")}`;
}

/* ------------------------------------------------------------------ *
 * Dossiers
 * ------------------------------------------------------------------ */

/** All administrator dossiers, newest first, for the admin console. */
export async function listAdminAgroDossiers(): Promise<AdminAgroDossierRow[]> {
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} ORDER BY createdAt DESC, id DESC`);
    return rows.map(rowToDossier);
  });
}

/** Enabled dossiers projected for the customer desk. */
export async function listEnabledAdminAgroDossiers(): Promise<AgroOpportunity[]> {
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE enabled=1 ORDER BY createdAt DESC, id DESC`);
    return rows.map((row) => dossierRowToOpportunity(rowToDossier(row)));
  });
}

/** Full administrator dossier row by id (used by settlement). */
export async function findAdminAgroDossier(dossierId: string): Promise<AdminAgroDossierRow | null> {
  const id = text(dossierId, 80);
  if (!id) return null;
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rows.length ? rowToDossier(rows[0]) : null;
  });
}

/** Resolve a single enabled dossier for a customer commitment, or null. */
export async function findEnabledAdminAgroDossier(dossierId: string): Promise<AgroOpportunity | null> {
  const id = text(dossierId, 80);
  if (!id) return null;
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? AND enabled=1 LIMIT 1`, [id]);
    return rows.length ? dossierRowToOpportunity(rowToDossier(rows[0])) : null;
  });
}

const DOSSIER_INSERT_COLUMNS =
  "dossierId,title,operator,agroType,sector,territory,territoryBand,countryCode,country,flag,offtaker,description,dealType,stage,dossierStatus,riskGrade,revenueSharesBps,expectedMultipleBps,expectedDurationMonths,projectedRevenueMinor,capitalAtRiskMinor,fundingAskMinor,minimumInvestmentMinor,unitPriceMinor,eventDate,fundingDeadline,highlightsJson,scenariosJson,milestonesJson,source,sourceUrl,asOf,enabled,createdByUserId,updatedByUserId";

function dossierInsertValues(normalized: ReturnType<typeof normalizeAgroDossierInput>, actor: number) {
  return [
    normalized.title, normalized.operator, normalized.agroType, normalized.sector,
    normalized.territory, normalized.territoryBand, normalized.country.code, normalized.country.name, flagFor(normalized.country.code),
    normalized.offtaker, normalized.description, normalized.dealType, normalized.stage, normalized.status, normalized.riskGrade,
    normalized.revenueSharesBps, normalized.expectedMultipleBps, normalized.expectedDurationMonths,
    normalized.projectedRevenueMinor, normalized.capitalAtRiskMinor, normalized.fundingAskMinor,
    normalized.minimumInvestmentMinor, normalized.unitPriceMinor, normalized.eventDate, normalized.fundingDeadline,
    JSON.stringify(normalized.highlights), JSON.stringify(normalized.scenarios), JSON.stringify(normalized.milestones),
    normalized.source, normalized.sourceUrl, normalized.asOf, 1, actor, actor,
  ];
}

/** Create an administrator dossier. Enabled on submit. */
export async function createAdminAgroDossier(adminUserId: number, input: AdminAgroDossierInput): Promise<AdminAgroDossierRow> {
  const normalized = normalizeAgroDossierInput(input);
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const base = `admin-agro-${slugify(normalized.title) || "opportunity"}-${crypto.randomBytes(2).toString("hex")}`;
    const dossierId = await uniqueId(conn, AGRO_DOSSIERS_TABLE, "dossierId", base);
    await conn.execute(
      `INSERT INTO ${AGRO_DOSSIERS_TABLE} (${DOSSIER_INSERT_COLUMNS}) VALUES (${Array(35).fill("?").join(",")})`,
      [dossierId, ...dossierInsertValues(normalized, adminUserId)],
    );
    await recordAudit(conn, adminUserId, "agro_dossier_created", "agro_investment_dossier", dossierId, input.reason, {
      dossierId, agroType: normalized.agroType, countryCode: normalized.country.code, status: normalized.status,
      stage: normalized.stage, fundingAskMinor: normalized.fundingAskMinor, scenarios: normalized.scenarios.length,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [dossierId]);
    return rowToDossier(rows[0]);
  });
}

/** Update an existing administrator dossier; the country flag/territory are re-derived. */
export async function updateAdminAgroDossier(adminUserId: number, dossierId: string, input: AdminAgroDossierInput): Promise<AdminAgroDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  const normalized = normalizeAgroDossierInput(input);
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT dossierId FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This opportunity no longer exists on the desk");
    await conn.execute(
      `UPDATE ${AGRO_DOSSIERS_TABLE}
        SET title=?,operator=?,agroType=?,sector=?,territory=?,territoryBand=?,countryCode=?,country=?,flag=?,offtaker=?,description=?,dealType=?,
            stage=?,dossierStatus=?,riskGrade=?,revenueSharesBps=?,expectedMultipleBps=?,expectedDurationMonths=?,projectedRevenueMinor=?,
            capitalAtRiskMinor=?,fundingAskMinor=?,minimumInvestmentMinor=?,unitPriceMinor=?,eventDate=?,fundingDeadline=?,
            highlightsJson=?,scenariosJson=?,milestonesJson=?,source=?,sourceUrl=?,asOf=?,updatedByUserId=?,updatedAt=NOW(3)
       WHERE dossierId=?`,
      [
        normalized.title, normalized.operator, normalized.agroType, normalized.sector,
        normalized.territory, normalized.territoryBand, normalized.country.code, normalized.country.name, flagFor(normalized.country.code),
        normalized.offtaker, normalized.description, normalized.dealType, normalized.stage, normalized.status, normalized.riskGrade,
        normalized.revenueSharesBps, normalized.expectedMultipleBps, normalized.expectedDurationMonths,
        normalized.projectedRevenueMinor, normalized.capitalAtRiskMinor, normalized.fundingAskMinor,
        normalized.minimumInvestmentMinor, normalized.unitPriceMinor, normalized.eventDate, normalized.fundingDeadline,
        JSON.stringify(normalized.highlights), JSON.stringify(normalized.scenarios), JSON.stringify(normalized.milestones),
        normalized.source, normalized.sourceUrl, normalized.asOf, adminUserId, id,
      ],
    );
    await recordAudit(conn, adminUserId, "agro_dossier_updated", "agro_investment_dossier", id, input.reason, {
      dossierId: id, agroType: normalized.agroType, status: normalized.status, fundingAskMinor: normalized.fundingAskMinor,
    });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Enable or disable a dossier. Disabled dossiers leave the customer desk. */
export async function setAdminAgroDossierEnabled(adminUserId: number, dossierId: string, enabled: boolean): Promise<AdminAgroDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`UPDATE ${AGRO_DOSSIERS_TABLE} SET enabled=?, updatedByUserId=?, updatedAt=NOW(3) WHERE dossierId=?`, [enabled ? 1 : 0, adminUserId, id]);
    if (!result.affectedRows) throw new Error("This opportunity no longer exists on the desk");
    await recordAudit(conn, adminUserId, enabled ? "agro_dossier_enabled" : "agro_dossier_disabled", "agro_investment_dossier", id, null, { dossierId: id, enabled });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/** Move the dossier through its lifecycle. */
export async function setAdminAgroDossierStatus(adminUserId: number, dossierId: string, status: AgroDossierStatus, reason?: string | null): Promise<AdminAgroDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  if (!(AGRO_DOSSIER_STATUSES as readonly string[]).includes(status)) throw new Error("Select a valid opportunity status");
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [existing] = await conn.query<any[]>(`SELECT dossierId FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    if (!existing.length) throw new Error("This opportunity no longer exists on the desk");
    await conn.execute(`UPDATE ${AGRO_DOSSIERS_TABLE} SET dossierStatus=?, updatedByUserId=?, updatedAt=NOW(3) WHERE dossierId=?`, [status, adminUserId, id]);
    await recordAudit(conn, adminUserId, "agro_dossier_status_changed", "agro_investment_dossier", id, reason, { dossierId: id, status });
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(rows[0]);
  });
}

/**
 * Mark one escrow milestone as reached. The release weight is
 * administrator-configured, not derived here. Once a milestone is reached it is
 * never reverted — history is append-only.
 */
export async function reachAdminAgroMilestone(adminUserId: number, dossierId: string, stage: AgroStage, reason?: string | null): Promise<AdminAgroDossierRow> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  if (!(AGRO_STAGES as readonly string[]).includes(stage)) throw new Error("Select a valid milestone stage");
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1 FOR UPDATE`, [id]);
    if (!rows.length) throw new Error("This opportunity no longer exists on the desk");
    const record = rowToDossier(rows[0]);
    const milestones = record.milestones.length ? record.milestones : defaultAgroMilestones();
    const target = milestones.find((milestone) => milestone.stage === stage);
    if (!target) throw new Error("This opportunity does not model that milestone");
    if (target.status === "REACHED") throw new Error("That milestone has already been reached");
    const reachedAt = new Date().toISOString();
    const updated = milestones.map((milestone) => (milestone.stage === stage ? { ...milestone, status: "REACHED" as const, reachedAt } : milestone));
    await conn.execute(`UPDATE ${AGRO_DOSSIERS_TABLE} SET milestonesJson=?, updatedByUserId=?, updatedAt=NOW(3) WHERE dossierId=?`, [JSON.stringify(updated), adminUserId, id]);
    await recordAudit(conn, adminUserId, "agro_milestone_reached", "agro_investment_dossier", id, reason, { dossierId: id, stage, releaseBps: target.releaseBps, reachedAt });
    const [after] = await conn.query<any[]>(`SELECT * FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=? LIMIT 1`, [id]);
    return rowToDossier(after[0]);
  });
}

/** Stamp the recorded outcome on the dossier. Called inside the settlement transaction. */
export async function applyAgroDossierOutcome(conn: Db, dossierId: string, outcome: AgroOutcome): Promise<void> {
  await conn.execute(`UPDATE ${AGRO_DOSSIERS_TABLE} SET outcome=?, outcomeRecordedAt=NOW(), updatedAt=NOW(3) WHERE dossierId=?`, [outcome, dossierId]);
}

/** Permanently remove an administrator dossier. */
export async function deleteAdminAgroDossier(adminUserId: number, dossierId: string): Promise<{ dossierId: string; deleted: boolean }> {
  const id = text(dossierId, 80);
  if (!id) throw new Error("A valid dossier id is required");
  await ensureAgroInvestmentDossierSchema();
  return withConnection(async (conn) => {
    const [result] = await conn.query<any>(`DELETE FROM ${AGRO_DOSSIERS_TABLE} WHERE dossierId=?`, [id]);
    const deleted = Boolean(result.affectedRows);
    if (deleted) await recordAudit(conn, adminUserId, "agro_dossier_deleted", "agro_investment_dossier", id, null, { dossierId: id });
    return { dossierId: id, deleted };
  });
}
