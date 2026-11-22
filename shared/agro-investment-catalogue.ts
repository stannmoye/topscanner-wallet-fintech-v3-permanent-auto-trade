/**
 * Agro Investment desk — the agriculture-only catalogue of investable opportunities.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server and, as a resilience fallback, in the customer's
 * browser. It defines the AGRICULTURE-ONLY taxonomy (row crops, orchards &
 * vineyards, livestock, dairy, poultry, aquaculture, greenhouse, farmland,
 * irrigation & water, farm machinery, storage & logistics, agri inputs,
 * agritech and processing), the shared classifiers, the desk analytics and a
 * small, honest DISCOVERY layer.
 *
 * The desk is strictly about agriculture. Unlike the litigation desk there is no
 * free, keyless public register that publishes *investable* agriculture
 * opportunities, so the real, fundable instruments are published by an
 * administrator in the DOSSIER layer (server/agroInvestmentDossiers.ts). The
 * discovery layer here only surfaces cited public agriculture references (from
 * the keyless World Bank Open Data feed) as un-priced candidates so the desk is
 * never empty; it never invents funding economics.
 *
 * Nothing here is invented: public sources publish no revenue economics, an
 * expected multiple, a funding target or an investor revenue share, so those
 * fields stay null on discovery records and read "not modelled" until an
 * administrator publishes a sourced dossier.
 */

import { flagFor } from "./country-options";

/** The kinds of agriculture opportunity the desk can carry. */
export type AgroInvestmentType =
  | "ROW_CROP"
  | "ORCHARD_VINEYARD"
  | "LIVESTOCK"
  | "DAIRY"
  | "POULTRY"
  | "AQUACULTURE"
  | "GREENHOUSE"
  | "FARMLAND"
  | "IRRIGATION_WATER"
  | "FARM_MACHINERY"
  | "STORAGE_LOGISTICS"
  | "AGRI_INPUTS"
  | "AGRITECH"
  | "AGRI_PROCESSING";

/** Where an opportunity is in its agriculture lifecycle. */
export type AgroStage =
  | "PLANNED"
  | "FUNDING"
  | "IN_PRODUCTION"
  | "HARVESTING"
  | "OFF_TAKE"
  | "PAYING"
  | "CLOSED";

export type AgroDossierStatus =
  | "FUNDING"
  | "ESCROW"
  | "IN_PRODUCTION"
  | "ACTIVE"
  | "PAYING"
  | "COMPLETED"
  | "WITHDRAWN";

export type AgroRiskGrade = "PRIME" | "BALANCED" | "SPECULATIVE" | "HIGH_RISK";

/** How an agriculture instrument resolves for its funders. */
export type AgroOutcome = "STRONG_SEASON" | "ON_PLAN" | "WRITE_OFF";

export type AgroSector =
  | "GRAINS"
  | "OILSEEDS"
  | "PULSES"
  | "VEGETABLES"
  | "FRUIT_NUTS"
  | "VITICULTURE"
  | "SUGAR"
  | "BEVERAGE_CROPS"
  | "FIBRE"
  | "LIVESTOCK"
  | "DAIRY"
  | "POULTRY"
  | "AQUACULTURE"
  | "FLORICULTURE"
  | "OTHER";

export type AgroValueBand = "UNDER_100K" | "100K_1M" | "1M_10M" | "OVER_10M";

export type AgroTerritoryBand = "LOCAL" | "REGIONAL" | "NATIONAL" | "GLOBAL";

/** One modelled outcome for a published instrument. Probabilities across the three sum to 10,000 bps. */
export type AgroScenario = {
  outcome: AgroOutcome;
  label: string;
  /** Probability weight in basis points; the scenarios must sum to 10,000. */
  probabilityBps: number;
  /** Gross revenue to the instrument in minor units of the settlement currency. */
  grossRevenueMinor: number;
  /** Expected duration in whole months. */
  durationMonths: number;
  /** Payout multiple to funders in basis points (10,000 = 1.00x principal). */
  funderMultipleBps: number;
};

export type AgroMilestone = {
  stage: AgroStage;
  label: string;
  /** Share of escrow released at this milestone, in basis points. */
  releaseBps: number;
  status: "PENDING" | "REACHED";
  reachedAt: string | null;
};

/**
 * One agriculture opportunity. Discovery ids are source-prefixed (`wb-…`); an
 * administrator-published dossier id starts with `admin-agro-`.
 */
export type AgroOpportunity = {
  id: string;
  /** Project / farm / asset name. */
  title: string;
  /** The farm, cooperative, agribusiness or rights holder. */
  operator: string;
  agroType: AgroInvestmentType;
  sector: AgroSector;
  /** Human-readable territory label, e.g. "Kenya" or "Worldwide". */
  territory: string;
  territoryBand: AgroTerritoryBand;
  countryCode: string;
  country: string;
  flag: string;
  /** Committed buyer / distributor tied to the opportunity, when published. */
  offtaker: string | null;
  /** Plain-language description of the opportunity. */
  description: string;
  /** How a funder participates (e.g. "Revenue share", "Equity", "Recoupable advance"). */
  dealType: string | null;
  stage: AgroStage;
  status: AgroDossierStatus;
  riskGrade: AgroRiskGrade | null;
  /** Investor share of gross revenue, in basis points, when modelled. */
  revenueSharesBps: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  projectedRevenueMinor: number | null;
  capitalAtRiskMinor: number | null;
  fundingAskMinor: number | null;
  committedMinor: number;
  /** Committed / ask in basis points. */
  fundedBps: number;
  minimumInvestmentMinor: number | null;
  unitPriceMinor: number | null;
  /** Planting / harvest window start, or production date (YYYY-MM-DD), when published. */
  eventDate: string | null;
  fundingDeadline: string | null;
  remainingDays: number | null;
  /** Three outcome scenarios. Empty on discovery records. */
  scenarios: AgroScenario[];
  /** Probability-weighted expected value in minor units, or null when unmodelled. */
  expectedValueMinor: number | null;
  milestones: AgroMilestone[];
  highlights: string[];
  source: string;
  sourceUrl: string | null;
  asOf: string;
  /** True only for records an administrator has reviewed and published. */
  verified: boolean;
  /** True only when an administrator has published scenarios and a funding target. */
  fundable: boolean;
};

export type AgroInvestmentSource = {
  name: string;
  url: string;
  /** ISO-3166 alpha-2 the source primarily covers, or "XX" for global. */
  country: string;
  role: "opportunities" | "catalogue" | "context";
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type AgroInvestmentCatalogue = {
  opportunities: AgroOpportunity[];
  sources: AgroInvestmentSource[];
  fetchedAt: string;
  degraded: boolean;
};

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

const WORLDBANK_BASE = "https://api.worldbank.org/v2";
const WORLD_BANK_ISO3 = "BRA;IND;USA;CHN;KEN;NGA;AUS;ARG;IDN;VNM;UKR;FRA";
const WORLD_BANK_DATE_RANGE = "2015:2024";
const ISO3_TO_ISO2: Record<string, string> = {
  BRA: "BR", IND: "IN", USA: "US", CHN: "CN", KEN: "KE", NGA: "NG",
  AUS: "AU", ARG: "AR", IDN: "ID", VNM: "VN", UKR: "UA", FRA: "FR",
};

const WORLDBANK_INDICATORS: { code: string; name: string }[] = [
  { code: "AG.PRD.FOOD.XD", name: "Food production index" },
  { code: "AG.YLD.CREL.KG", name: "Cereal yield (kg per hectare)" },
  { code: "AG.LND.AGRI.ZS", name: "Agricultural land (% of land area)" },
  { code: "NV.AGR.TOTL.ZS", name: "Agriculture value added (% of GDP)" },
];

/* ------------------------------------------------------------------ *
 * Taxonomy — agriculture-only investment types
 * ------------------------------------------------------------------ */

export const AGRO_INVESTMENT_TYPES: readonly AgroInvestmentType[] = [
  "ROW_CROP",
  "ORCHARD_VINEYARD",
  "LIVESTOCK",
  "DAIRY",
  "POULTRY",
  "AQUACULTURE",
  "GREENHOUSE",
  "FARMLAND",
  "IRRIGATION_WATER",
  "FARM_MACHINERY",
  "STORAGE_LOGISTICS",
  "AGRI_INPUTS",
  "AGRITECH",
  "AGRI_PROCESSING",
];

const AGRO_TYPE_LABELS: Record<AgroInvestmentType, string> = {
  ROW_CROP: "Row Crops",
  ORCHARD_VINEYARD: "Orchard & Vineyard",
  LIVESTOCK: "Livestock & Ranching",
  DAIRY: "Dairy",
  POULTRY: "Poultry & Eggs",
  AQUACULTURE: "Aquaculture & Fisheries",
  GREENHOUSE: "Greenhouse & Horticulture",
  FARMLAND: "Farmland & Land",
  IRRIGATION_WATER: "Irrigation & Water",
  FARM_MACHINERY: "Farm Machinery & Equipment",
  STORAGE_LOGISTICS: "Storage & Logistics",
  AGRI_INPUTS: "Agri Inputs & Services",
  AGRITECH: "AgriTech",
  AGRI_PROCESSING: "Processing & Value-Add",
};

export function agroTypeLabel(value: AgroInvestmentType): string {
  return AGRO_TYPE_LABELS[value] ?? "Agriculture opportunity";
}

/** Optional short blurb for each type, used by the customer desk and the admin picker. */
const AGRO_TYPE_BLURBS: Record<AgroInvestmentType, string> = {
  ROW_CROP: "Arable row-crop production with harvest and off-take revenue.",
  ORCHARD_VINEYARD: "Orchard or vineyard establishment with fruit or wine revenue.",
  LIVESTOCK: "Livestock production and ranching with sale and grazing revenue.",
  DAIRY: "A dairy operation with milk and dairy-product revenue.",
  POULTRY: "Poultry and egg production with flock and sell-through revenue.",
  AQUACULTURE: "Aquaculture or fisheries production with harvest revenue.",
  GREENHOUSE: "Protected greenhouse and horticulture growing revenue.",
  FARMLAND: "Farmland and land acquisition funded against lease and title income.",
  IRRIGATION_WATER: "Irrigation and water infrastructure funded against water access revenue.",
  FARM_MACHINERY: "Farm machinery and equipment funded against its service revenue.",
  STORAGE_LOGISTICS: "Storage, cold-chain and logistics funded against handling revenue.",
  AGRI_INPUTS: "Agri inputs and services — seed, fertiliser and crop protection.",
  AGRITECH: "AgriTech software, sensing and precision-agriculture platforms.",
  AGRI_PROCESSING: "Processing and value-add, turning raw produce into finished goods.",
};

export function agroTypeBlurb(value: AgroInvestmentType): string {
  return AGRO_TYPE_BLURBS[value] ?? "";
}

/** Grouped presentation of the agriculture types, for the admin picker and customer filters. */
export const AGRO_TYPE_GROUPS: { label: string; detail: string; types: AgroInvestmentType[] }[] = [
  { label: "Crops & Land", detail: "Row crops, orchards, greenhouse and farmland", types: ["ROW_CROP", "ORCHARD_VINEYARD", "GREENHOUSE", "FARMLAND"] },
  { label: "Livestock & Fisheries", detail: "Livestock, dairy, poultry and aquaculture", types: ["LIVESTOCK", "DAIRY", "POULTRY", "AQUACULTURE"] },
  { label: "Infrastructure & Inputs", detail: "Irrigation, machinery, storage and agri inputs", types: ["IRRIGATION_WATER", "FARM_MACHINERY", "STORAGE_LOGISTICS", "AGRI_INPUTS"] },
  { label: "Technology & Processing", detail: "AgriTech and processing value-add", types: ["AGRITECH", "AGRI_PROCESSING"] },
];

export const AGRO_SECTORS: readonly AgroSector[] = [
  "GRAINS", "OILSEEDS", "PULSES", "VEGETABLES", "FRUIT_NUTS", "VITICULTURE",
  "SUGAR", "BEVERAGE_CROPS", "FIBRE", "LIVESTOCK", "DAIRY", "POULTRY",
  "AQUACULTURE", "FLORICULTURE", "OTHER",
];

const SECTOR_LABELS: Record<AgroSector, string> = {
  GRAINS: "Grains", OILSEEDS: "Oilseeds", PULSES: "Pulses", VEGETABLES: "Vegetables",
  FRUIT_NUTS: "Fruit & nuts", VITICULTURE: "Viticulture", SUGAR: "Sugar",
  BEVERAGE_CROPS: "Beverage crops", FIBRE: "Fibre", LIVESTOCK: "Livestock",
  DAIRY: "Dairy", POULTRY: "Poultry", AQUACULTURE: "Aquaculture",
  FLORICULTURE: "Floriculture", OTHER: "Other",
};

export function sectorLabel(value: AgroSector): string {
  return SECTOR_LABELS[value] ?? SECTOR_LABELS.OTHER;
}

export const AGRO_STAGES: readonly AgroStage[] = [
  "PLANNED", "FUNDING", "IN_PRODUCTION", "HARVESTING", "OFF_TAKE", "PAYING", "CLOSED",
];

const STAGE_LABELS: Record<AgroStage, string> = {
  PLANNED: "Planned", FUNDING: "Funding", IN_PRODUCTION: "In production",
  HARVESTING: "Harvesting", OFF_TAKE: "Off-take", PAYING: "Paying", CLOSED: "Closed",
};

export function stageLabel(stage: AgroStage): string {
  return STAGE_LABELS[stage] ?? "Planned";
}

export const AGRO_DOSSIER_STATUSES: readonly AgroDossierStatus[] = [
  "FUNDING", "ESCROW", "IN_PRODUCTION", "ACTIVE", "PAYING", "COMPLETED", "WITHDRAWN",
];

const STATUS_LABELS: Record<AgroDossierStatus, string> = {
  FUNDING: "Funding", ESCROW: "In escrow", IN_PRODUCTION: "In production",
  ACTIVE: "Active", PAYING: "Paying", COMPLETED: "Completed", WITHDRAWN: "Withdrawn",
};

export function statusLabel(status: AgroDossierStatus): string {
  return STATUS_LABELS[status] ?? "Funding";
}

export const AGRO_RISK_GRADES: readonly AgroRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];

const RISK_LABELS: Record<AgroRiskGrade, string> = {
  PRIME: "Prime", BALANCED: "Balanced", SPECULATIVE: "Speculative", HIGH_RISK: "High risk",
};

export function riskGradeLabel(value: AgroRiskGrade): string {
  return RISK_LABELS[value] ?? "Balanced";
}

export const AGRO_OUTCOMES: readonly AgroOutcome[] = ["STRONG_SEASON", "ON_PLAN", "WRITE_OFF"];

const OUTCOME_LABELS: Record<AgroOutcome, string> = {
  STRONG_SEASON: "Strong season", ON_PLAN: "On plan", WRITE_OFF: "Write-off",
};

export function outcomeLabel(value: AgroOutcome): string {
  return OUTCOME_LABELS[value] ?? "On plan";
}

export const AGRO_TERRITORY_BANDS: readonly AgroTerritoryBand[] = ["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"];

const TERRITORY_BAND_LABELS: Record<AgroTerritoryBand, string> = {
  LOCAL: "Local", REGIONAL: "Regional", NATIONAL: "National", GLOBAL: "Global",
};

export function territoryBandLabel(value: AgroTerritoryBand): string {
  return TERRITORY_BAND_LABELS[value] ?? "Regional";
}

export const AGRO_VALUE_BANDS: readonly AgroValueBand[] = ["UNDER_100K", "100K_1M", "1M_10M", "OVER_10M"];

const VALUE_BAND_LABELS: Record<AgroValueBand, string> = {
  UNDER_100K: "Under 100K", "100K_1M": "100K – 1M", "1M_10M": "1M – 10M", OVER_10M: "Over 10M",
};

export function valueBandLabel(value: AgroValueBand): string {
  return VALUE_BAND_LABELS[value] ?? "";
}

/**
 * Best-effort classification of an agriculture opportunity from its heading text.
 * Priority-ordered: the first pattern that matches wins. Strictly agriculture.
 */
const TYPE_PATTERNS: [AgroInvestmentType, RegExp][] = [
  ["AGRITECH", /\b(agritech|ag-?tech|precision ag|farm software|drone|sensor|satellite|digital ag)\b/i],
  ["AGRI_PROCESSING", /\b(processing|value-?add|mill(ing)?|refinery|packing|cannery|crush(ing)?|food processing)\b/i],
  ["IRRIGATION_WATER", /\b(irrigation|water|canal|borehole|reservoir|drip|pivot)\b/i],
  ["FARM_MACHINERY", /\b(machinery|tractor|harvester|equipment|implement|fleet)\b/i],
  ["STORAGE_LOGISTICS", /\b(storage|silo|warehouse|logistics|cold chain|distribution|haulage)\b/i],
  ["AGRI_INPUTS", /\b(inputs?|fertilis|fertiliz|seed(s)?|agrochemical|pesticide|crop protection)\b/i],
  ["GREENHOUSE", /\b(greenhouse|glasshouse|horticulture|nursery|polytunnel|hydroponic)\b/i],
  ["AQUACULTURE", /\b(aquaculture|fisher|fish farm|shrimp|tilapia|salmon|hatchery)\b/i],
  ["POULTRY", /\b(poultry|chicken|layer|broiler|egg(s)?)\b/i],
  ["DAIRY", /\b(dairy|milk|creamery|milking)\b/i],
  ["LIVESTOCK", /\b(livestock|ranch(ing)?|cattle|beef|sheep|goat|pasture|grazing)\b/i],
  ["ORCHARD_VINEYARD", /\b(orchard|vineyard|viticulture|winery|citrus|olive|tree fruit|plantation)\b/i],
  ["FARMLAND", /\b(farmland|land acquisition|acreage|title|land bank)\b/i],
  ["ROW_CROP", /\b(row crop|grain|cereal|maize|corn|wheat|soy(bean)?|rice|sugar(cane|beet)?|cotton|pulse|oilseed)\b/i],
];

export function classifyAgroType(input: { title?: string | null; description?: string | null; hint?: AgroInvestmentType | null }): AgroInvestmentType {
  if (input.hint && (AGRO_INVESTMENT_TYPES as readonly string[]).includes(input.hint)) return input.hint;
  const haystack = `${input.title || ""} ${input.description || ""}`;
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(haystack)) return type;
  return "ROW_CROP";
}

/** Coarse value band from a minor-unit amount, only set when an amount is known. */
export function agroValueBandFromMinor(minor: number | null | undefined): AgroValueBand | null {
  if (minor === null || minor === undefined) return null;
  const value = Number(minor);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 10_000_000) return "UNDER_100K";
  if (value < 100_000_000) return "100K_1M";
  if (value < 1_000_000_000) return "1M_10M";
  return "OVER_10M";
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/** Read an optional infrastructure key without assuming a Node runtime. */
function envKey(name: string): string {
  try {
    const value = (globalThis as any)?.process?.env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function decodeEntities(value: string): string {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const MONTH_MS = 30 * 86_400_000;

export function remainingDaysFor(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = Date.parse(deadline);
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/** Probability-weighted expected revenue over the published scenarios. */
export function expectedValueMinor(scenarios: AgroScenario[]): number | null {
  if (!scenarios.length) return null;
  return scenarios.reduce((sum, scenario) => sum + Math.round((scenario.grossRevenueMinor * scenario.probabilityBps) / 10_000), 0);
}

const RISK_ORDER: Record<AgroRiskGrade, number> = { PRIME: 0, BALANCED: 1, SPECULATIVE: 2, HIGH_RISK: 3 };
const STATUS_ORDER: Record<AgroDossierStatus, number> = {
  FUNDING: 0, ESCROW: 1, IN_PRODUCTION: 2, ACTIVE: 3, PAYING: 4, COMPLETED: 5, WITHDRAWN: 6,
};

/** Fundable opportunities first, then lifecycle status, risk grade, funding progress, recency. */
export function compareAgroOpportunities(a: AgroOpportunity, b: AgroOpportunity): number {
  if (a.fundable !== b.fundable) return a.fundable ? -1 : 1;
  const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (status !== 0) return status;
  const risk = (a.riskGrade ? RISK_ORDER[a.riskGrade] : 9) - (b.riskGrade ? RISK_ORDER[b.riskGrade] : 9);
  if (risk !== 0) return risk;
  if (a.fundedBps !== b.fundedBps) return b.fundedBps - a.fundedBps;
  if (a.asOf !== b.asOf) return b.asOf.localeCompare(a.asOf);
  return a.title.localeCompare(b.title);
}

const DEFAULT_AGRO_MILESTONES: AgroMilestone[] = (
  [
    ["PLANNED", "Planned", 1500],
    ["FUNDING", "Funded", 3000],
    ["IN_PRODUCTION", "In production", 5500],
    ["HARVESTING", "Harvesting", 7500],
    ["OFF_TAKE", "Off-take", 9000],
    ["PAYING", "Paying out", 10000],
  ] as [AgroStage, string, number][]
).map(([stage, label, releaseBps]) => ({ stage, label, releaseBps, status: "PENDING" as const, reachedAt: null }));

export function defaultAgroMilestones(): AgroMilestone[] {
  return DEFAULT_AGRO_MILESTONES.map((milestone) => ({ ...milestone }));
}

/* ------------------------------------------------------------------ *
 * Discovery layer — cited public catalogue references (keyless)
 * ------------------------------------------------------------------ */

function indicatorType(code: string): AgroInvestmentType {
  if (code === "AG.LND.AGRI.ZS") return "FARMLAND";
  if (code === "NV.AGR.TOTL.ZS") return "AGRI_PROCESSING";
  return "ROW_CROP";
}

async function fetchWorldBankIndicator(indicator: { code: string; name: string }): Promise<AgroOpportunity[]> {
  const url = `${WORLDBANK_BASE}/country/${WORLD_BANK_ISO3}/indicator/${indicator.code}?format=json&per_page=100&date=${WORLD_BANK_DATE_RANGE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`World Bank responded ${response.status}`);
    const payload: any = await response.json();
    const records: any[] = Array.isArray(payload?.[1]) ? payload[1] : [];
    const mapped: AgroOpportunity[] = [];
    for (const record of records) {
      const value = record?.value;
      if (value === null || value === undefined || value === "") continue;
      const countryiso3 = String(record?.countryiso3code || "").toUpperCase();
      const iso2 = ISO3_TO_ISO2[countryiso3];
      if (!iso2) continue;
      const countryName = decodeEntities(String(record?.country?.value || "")).trim();
      const date = String(record?.date || "");
      if (!countryName || !date) continue;
      mapped.push({
        id: `wb-${indicator.code}-${countryiso3}-${date}`,
        title: `${indicator.name} — ${countryName} (${date})`,
        operator: "World Bank Open Data",
        agroType: indicatorType(indicator.code),
        sector: "OTHER",
        territory: countryName,
        territoryBand: "NATIONAL",
        countryCode: iso2,
        country: countryName,
        flag: flagFor(iso2),
        offtaker: null,
        description: `${countryName} — “${indicator.name}” (${date}). A cited public agriculture reference surfaced from the World Bank Open Data feed. No funding economics are published for discovery references.`,
        dealType: null,
        stage: "IN_PRODUCTION",
        status: "ACTIVE",
        riskGrade: null,
        revenueSharesBps: null,
        expectedMultipleBps: null,
        expectedDurationMonths: null,
        projectedRevenueMinor: null,
        capitalAtRiskMinor: null,
        fundingAskMinor: null,
        committedMinor: 0,
        fundedBps: 0,
        minimumInvestmentMinor: null,
        unitPriceMinor: null,
        eventDate: `${date}-01-01`,
        fundingDeadline: null,
        remainingDays: null,
        scenarios: [],
        expectedValueMinor: null,
        milestones: defaultAgroMilestones(),
        highlights: value != null ? [`Value: ${value}`] : [],
        source: "World Bank Open Data",
        sourceUrl: `https://data.worldbank.org/indicator/${indicator.code}`,
        asOf: `${date}-01-01`,
        verified: false,
        fundable: false,
      });
    }
    return mapped;
  } finally {
    clearTimeout(timer);
  }
}

let cache: { value: AgroInvestmentCatalogue; expiresAt: number } | null = null;
let inflight: Promise<AgroInvestmentCatalogue> | null = null;

async function buildCatalogue(): Promise<AgroInvestmentCatalogue> {
  const opportunities: AgroOpportunity[] = [];
  const seen = new Set<string>();
  let discoveryOk = false;
  for (const indicator of WORLDBANK_INDICATORS) {
    try {
      const items = await fetchWorldBankIndicator(indicator);
      if (items.length) discoveryOk = true;
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        opportunities.push(item);
      }
    } catch (error) {
      console.error("[AgroInvestments] Discovery source failed:", error instanceof Error ? error.message : "UnknownError");
    }
  }

  const sources: AgroInvestmentSource[] = [
    {
      name: "Arbitrade agro desk — administrator published",
      url: "",
      country: "XX",
      role: "opportunities",
      status: "ok",
      detail: "Agriculture opportunities across row crops, orchards, livestock, dairy, poultry, aquaculture, greenhouse, farmland, irrigation, machinery, storage & logistics, inputs, agritech and processing are published by the desk administrator with cited economics.",
    },
    {
      name: "World Bank Open Data",
      url: "https://data.worldbank.org",
      country: "XX",
      role: "catalogue",
      status: discoveryOk ? "ok" : "degraded",
      detail: discoveryOk
        ? `${opportunities.length} cited public agriculture reference${opportunities.length === 1 ? "" : "s"} surfaced for context. References carry no funding economics.`
        : "The public agriculture reference feed is unavailable right now; administrator-published opportunities are unaffected.",
    },
    {
      name: "Arbitrade agro desk — desk methodology",
      url: "",
      country: "XX",
      role: "context",
      status: "ok",
      detail: "Agriculture only: row crops, orchards, livestock, dairy, poultry, aquaculture, greenhouse, farmland, irrigation, machinery, storage & logistics, inputs, agritech and processing. No non-agriculture assets are carried.",
    },
  ];

  return {
    opportunities,
    sources,
    fetchedAt: new Date().toISOString(),
    degraded: sources.some((source) => source.status !== "ok"),
  };
}

/** Return the live catalogue, reusing the in-memory cache for ten minutes. */
export async function getAgroInvestmentCatalogue(options: { force?: boolean } = {}): Promise<AgroInvestmentCatalogue> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await buildCatalogue();
      if (value.opportunities.length) cache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Look up a single discovery opportunity by its stable id. */
export async function findAgroOpportunity(id: string): Promise<AgroOpportunity | null> {
  const catalogue = await getAgroInvestmentCatalogue();
  return catalogue.opportunities.find((item) => item.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Desk analytics — aggregated from the opportunities on the desk
 * ------------------------------------------------------------------ */

export type AgroAnalyticsBucket = { key: string; label: string; count: number };

export type AgroAnalytics = {
  totalOpportunities: number;
  fundableCount: number;
  cropsAndLand: number;
  raisingMinor: number;
  committedMinor: number;
  byType: AgroAnalyticsBucket[];
  bySector: AgroAnalyticsBucket[];
  byTerritory: AgroAnalyticsBucket[];
  byStage: AgroAnalyticsBucket[];
  byMonth: AgroAnalyticsBucket[];
};

const ISO_MONTH = /^\d{4}-\d{2}$/;

export function buildAgroAnalytics(opportunities: AgroOpportunity[]): AgroAnalytics {
  const typeCounts = new Map<AgroInvestmentType, number>();
  const sectorCounts = new Map<AgroSector, number>();
  const territoryCounts = new Map<string, number>();
  const stageCounts = new Map<AgroStage, number>();
  const monthCounts = new Map<string, number>();
  let fundableCount = 0;
  let cropsAndLand = 0;
  let raisingMinor = 0;
  let committedMinor = 0;

  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const record of opportunities) {
    bump(typeCounts, record.agroType);
    bump(sectorCounts, record.sector);
    bump(territoryCounts, record.territory || "Unspecified");
    bump(stageCounts, record.stage);
    const month = (record.eventDate || record.asOf || "").slice(0, 7);
    if (ISO_MONTH.test(month)) bump(monthCounts, month);
    if (record.fundable) fundableCount += 1;
    if (record.agroType === "ROW_CROP" || record.agroType === "ORCHARD_VINEYARD" || record.agroType === "GREENHOUSE" || record.agroType === "FARMLAND") cropsAndLand += 1;
    raisingMinor += Number(record.fundingAskMinor || 0);
    committedMinor += Number(record.committedMinor || 0);
  }

  const buckets = <K>(map: Map<K, number>, label: (key: K) => string): AgroAnalyticsBucket[] =>
    [...map.entries()]
      .map(([key, count]) => ({ key: String(key), label: label(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    totalOpportunities: opportunities.length,
    fundableCount,
    cropsAndLand,
    raisingMinor,
    committedMinor,
    byType: buckets(typeCounts, (key) => agroTypeLabel(key)),
    bySector: buckets(sectorCounts, (key) => sectorLabel(key)),
    byTerritory: buckets(territoryCounts, (key) => key).slice(0, 12),
    byStage: buckets(stageCounts, (key) => stageLabel(key)),
    byMonth: buckets(monthCounts, (key) => key).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12),
  };
}

export function __resetAgroInvestmentCacheForTest() {
  cache = null;
  inflight = null;
}

export const MONTHS_TO_MS = MONTH_MS;
export const AGRO_WORLDBANK_INDICATORS = WORLDBANK_INDICATORS;
export const AGRO_DESK_CURRENCY = "USD";
export function agroEnvKey(name: string): string {
  return envKey(name);
}
