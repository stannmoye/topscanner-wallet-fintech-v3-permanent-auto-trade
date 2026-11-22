/**
 * Carbon Credit desk — the carbon-only catalogue of investable credit opportunities.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server and, as a resilience fallback, in the customer's
 * browser. It defines the CARBON-ONLY taxonomy (afforestation & reforestation,
 * forest conservation, soil carbon, blue carbon, clean cookstoves, biochar,
 * direct air capture, BECCS, enhanced weathering, ocean alkalinity, renewable
 * energy credits, methane capture, waste & landfill gas and industrial
 * efficiency), the shared classifiers, the desk analytics and a small, honest
 * DISCOVERY layer.
 *
 * The desk is strictly about carbon. There is no free, keyless public register
 * that publishes *investable* carbon-credit opportunities, so the real, fundable
 * instruments are published by an administrator in the DOSSIER layer
 * (server/carbonCreditDossiers.ts). The discovery layer here only surfaces cited
 * public carbon references (from the keyless Eurostat (ESTAT) open feed and the
 * keyless World Bank Open Data feed) as un-priced candidates so the desk is
 * never empty; it never invents funding economics. Two independent providers are
 * drained so a failure or network block at one still leaves the desk populated
 * by the other.
 *
 * The desk is presented as a GEOGRAPHIC ATLAS: every record carries a
 * country/region and a longitude/latitude so the customer console can plot it as
 * a project pin on a region map. The atlas helpers below (regions, country
 * centroids and the ISO-3166 region resolver) exist for that purpose.
 *
 * Nothing here is invented: public sources publish no revenue economics, an
 * expected multiple, a funding target or an investor revenue share, so those
 * fields stay null on discovery records and read "not modelled" until an
 * administrator publishes a sourced dossier.
 */

import { flagFor } from "./country-options";
import type { DeskEconomics } from "./investment-economics";

/** The kinds of carbon-credit project the desk can carry. */
export type CarbonCreditType =
  | "REFORESTATION"
  | "FOREST_CONSERVATION"
  | "SOIL_CARBON"
  | "BLUE_CARBON"
  | "COOKSTOVES"
  | "BIOCHAR"
  | "DIRECT_AIR_CAPTURE"
  | "BECCS"
  | "ENHANCED_WEATHERING"
  | "OCEAN_ALKALINITY"
  | "RENEWABLE_ENERGY"
  | "METHANE_CAPTURE"
  | "WASTE_MANAGEMENT"
  | "INDUSTRIAL_EFFICIENCY";

/** Where a credit project is in its carbon lifecycle. */
export type CarbonStage =
  | "PLANNED"
  | "FUNDING"
  | "DEVELOPMENT"
  | "VALIDATION"
  | "ISSUANCE"
  | "RETIRING"
  | "CLOSED";

export type CarbonDossierStatus =
  | "FUNDING"
  | "ESCROW"
  | "DEVELOPMENT"
  | "ACTIVE"
  | "ISSUING"
  | "COMPLETED"
  | "WITHDRAWN";

export type CarbonRiskGrade = "PRIME" | "BALANCED" | "SPECULATIVE" | "HIGH_RISK";

/** How a carbon instrument resolves for its funders. */
export type CarbonOutcome = "HIGH_ISSUANCE" | "ON_PLAN" | "WRITE_OFF";

/** The verification standard / registry a project is (or will be) certified under. */
export type CarbonStandard =
  | "VERRA_VCS"
  | "GOLD_STANDARD"
  | "CDM"
  | "ACR"
  | "CAR"
  | "PLAN_VIVO"
  | "PURO_EARTH"
  | "OTHER";

/** The project category, used to group the atlas. */
export type CarbonSector =
  | "FORESTRY"
  | "AGRICULTURE"
  | "ENERGY"
  | "WASTE"
  | "INDUSTRIAL"
  | "OCEAN"
  | "GEOLOGICAL"
  | "OTHER";

/** The atlas region a project belongs to — the rail the customer console navigates by. */
export type CarbonRegion =
  | "AFRICA"
  | "LATIN_AMERICA"
  | "NORTH_AMERICA"
  | "EUROPE"
  | "SOUTH_ASIA"
  | "SOUTHEAST_ASIA"
  | "EAST_ASIA"
  | "OCEANIA"
  | "MIDDLE_EAST"
  | "GLOBAL";

/** Whether a pin is an administrator-reviewed instrument or an un-priced public reference. */
export type CarbonVerificationStatus = "VERIFIED" | "REFERENCE";

export type CarbonValueBand = "UNDER_100K" | "100K_1M" | "1M_10M" | "OVER_10M";

export type CarbonTerritoryBand = "LOCAL" | "REGIONAL" | "NATIONAL" | "GLOBAL";

/** One modelled outcome for a published instrument. Probabilities across the three sum to 10,000 bps. */
export type CarbonScenario = {
  outcome: CarbonOutcome;
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

export type CarbonMilestone = {
  stage: CarbonStage;
  label: string;
  /** Share of escrow released at this milestone, in basis points. */
  releaseBps: number;
  status: "PENDING" | "REACHED";
  reachedAt: string | null;
};

/**
 * One carbon opportunity. Discovery ids are source-prefixed (`wb-…` / `eurostat-…`);
 * an administrator-published dossier id starts with `admin-carbon-`.
 */
export type CarbonOpportunity = {
  id: string;
  /** Project / programme name. */
  title: string;
  /** The project developer, cooperative or rights holder. */
  operator: string;
  creditType: CarbonCreditType;
  sector: CarbonSector;
  /** Verification standard the project is (or will be) registered under. */
  standard: CarbonStandard | null;
  /** Human-readable territory label, e.g. "Kenya" or "Worldwide". */
  territory: string;
  territoryBand: CarbonTerritoryBand;
  /** The atlas region the project is plotted in. */
  region: CarbonRegion;
  countryCode: string;
  country: string;
  flag: string;
  /** Committed credit buyer / offtaker tied to the opportunity, when published. */
  offtaker: string | null;
  /** Plain-language description of the opportunity. */
  description: string;
  /** How a funder participates (e.g. "Revenue share", "Equity", "Recoupable advance"). */
  dealType: string | null;
  stage: CarbonStage;
  status: CarbonDossierStatus;
  riskGrade: CarbonRiskGrade | null;
  /** Investor share of gross revenue, in basis points, when modelled. */
  revenueSharesBps: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  projectedRevenueMinor: number | null;
  capitalAtRiskMinor: number | null;
  fundingAskMinor: number | null;
  /** Credits the project is expected to issue, in tonnes CO₂e, when modelled. */
  creditVolumeTonnes: number | null;
  /** Modelled price per tonne in minor units of the settlement currency, when modelled. */
  pricePerTonneMinor: number | null;
  committedMinor: number;
  /** Committed / ask in basis points. */
  fundedBps: number;
  minimumInvestmentMinor: number | null;
  unitPriceMinor: number | null;
  /** Validation / first-issuance window (YYYY-MM-DD), when published. */
  eventDate: string | null;
  fundingDeadline: string | null;
  remainingDays: number | null;
  /** Three outcome scenarios. Empty on discovery records. */
  scenarios: CarbonScenario[];
  /** Probability-weighted expected value in minor units, or null when unmodelled. */
  expectedValueMinor: number | null;
  milestones: CarbonMilestone[];
  highlights: string[];
  source: string;
  sourceUrl: string | null;
  asOf: string;
  /** True only for records an administrator has reviewed and published. */
  verified: boolean;
  /** True only when an administrator has published scenarios and a funding target. */
  fundable: boolean;
  /** VERIFIED for administrator instruments, REFERENCE for cited public references. */
  verificationStatus: CarbonVerificationStatus;
  /**
   * The opportunity's economic profile — its investable amount band, profit,
   * term, close date and platform fee — auto-assigned from the shared
   * desk-economics engine (server/deskEconomics.ts) on first sight and
   * overridable by an administrator. Present on every opportunity the desk
   * serves; absent only on a bare catalogue record.
   */
  economics?: DeskEconomics | null;
};

export type CarbonInvestmentSource = {
  name: string;
  url: string;
  /** ISO-3166 alpha-2 the source primarily covers, or "XX" for global. */
  country: string;
  role: "opportunities" | "catalogue" | "context";
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type CarbonInvestmentCatalogue = {
  opportunities: CarbonOpportunity[];
  sources: CarbonInvestmentSource[];
  fetchedAt: string;
  degraded: boolean;
};

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

const WORLDBANK_BASE = "https://api.worldbank.org/v2";
const WORLD_BANK_ISO3 =
  "BRA;IND;USA;CHN;KEN;NGA;AUS;ARG;IDN;VNM;UKR;FRA;PER;COD;COL;MEX;MOZ;TZA;ZMB;GHA";
const WORLD_BANK_DATE_RANGE = "2015:2024";
const ISO3_TO_ISO2: Record<string, string> = {
  BRA: "BR", IND: "IN", USA: "US", CHN: "CN", KEN: "KE", NGA: "NG",
  AUS: "AU", ARG: "AR", IDN: "ID", VNM: "VN", UKR: "UA", FRA: "FR",
  PER: "PE", COD: "CD", COL: "CO", MEX: "MX", MOZ: "MZ", TZA: "TZ",
  ZMB: "ZM", GHA: "GH",
};

const WORLDBANK_INDICATORS: {
  code: string;
  name: string;
  unit: string;
  creditType: CarbonCreditType;
  sector: CarbonSector;
}[] = [
  { code: "EN.GHG.CO2.MT.CE.AR5", name: "CO₂ emissions excluding LULUCF", unit: "million tonnes CO₂e", creditType: "INDUSTRIAL_EFFICIENCY", sector: "INDUSTRIAL" },
  { code: "EN.GHG.ALL.MT.CE.AR5", name: "Total greenhouse-gas emissions excluding LULUCF", unit: "million tonnes CO₂e", creditType: "INDUSTRIAL_EFFICIENCY", sector: "INDUSTRIAL" },
  { code: "AG.LND.FRST.K2", name: "Forest area", unit: "sq. km", creditType: "FOREST_CONSERVATION", sector: "FORESTRY" },
  { code: "AG.LND.FRST.ZS", name: "Forest area", unit: "% of land area", creditType: "FOREST_CONSERVATION", sector: "FORESTRY" },
  { code: "EG.ELC.RNEW.ZS", name: "Renewable electricity output", unit: "% of total electricity output", creditType: "RENEWABLE_ENERGY", sector: "ENERGY" },
];

/* A second, independent keyless provider: the Eurostat (ESTAT) open feed. It is
 * drained alongside the World Bank so that a failure or network block at either
 * provider still leaves the desk populated by the other. Each dataset's filter
 * reduces the multi-dimensional cube to one series per territory, and the
 * latest published period per territory is read in code. */
const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

const EUROSTAT_DATASETS: {
  dataset: string;
  metric: string;
  query: string;
  unit: string;
  creditType: CarbonCreditType;
  sector: CarbonSector;
}[] = [
  {
    dataset: "nrg_ind_ren",
    metric: "Share of renewable energy in gross final energy consumption",
    query: "nrg_bal=REN",
    unit: "%",
    creditType: "RENEWABLE_ENERGY",
    sector: "ENERGY",
  },
  {
    dataset: "env_air_gge",
    metric: "Greenhouse-gas emissions, total excluding LULUCF",
    query: "airpol=GHG&src_crf=TOTXMEMO&unit=MIO_T",
    unit: "million tonnes CO₂e",
    creditType: "INDUSTRIAL_EFFICIENCY",
    sector: "INDUSTRIAL",
  },
];

/** Eurostat's geo dimension mixes real territories with EU / euro-area aggregates. */
const EUROSTAT_AGGREGATE_GEO = new Set(["EU", "EA"]);

/* ------------------------------------------------------------------ *
 * Taxonomy — carbon-only credit types
 * ------------------------------------------------------------------ */

export const CARBON_CREDIT_TYPES: readonly CarbonCreditType[] = [
  "REFORESTATION",
  "FOREST_CONSERVATION",
  "SOIL_CARBON",
  "BLUE_CARBON",
  "COOKSTOVES",
  "BIOCHAR",
  "DIRECT_AIR_CAPTURE",
  "BECCS",
  "ENHANCED_WEATHERING",
  "OCEAN_ALKALINITY",
  "RENEWABLE_ENERGY",
  "METHANE_CAPTURE",
  "WASTE_MANAGEMENT",
  "INDUSTRIAL_EFFICIENCY",
];

const CARBON_TYPE_LABELS: Record<CarbonCreditType, string> = {
  REFORESTATION: "Afforestation & Reforestation",
  FOREST_CONSERVATION: "Forest Conservation (REDD+)",
  SOIL_CARBON: "Regenerative Agriculture & Soil Carbon",
  BLUE_CARBON: "Mangrove & Blue Carbon",
  COOKSTOVES: "Clean Cookstoves",
  BIOCHAR: "Biochar",
  DIRECT_AIR_CAPTURE: "Direct Air Capture",
  BECCS: "Bioenergy with CCS",
  ENHANCED_WEATHERING: "Enhanced Weathering",
  OCEAN_ALKALINITY: "Ocean Alkalinity",
  RENEWABLE_ENERGY: "Renewable Energy Credits",
  METHANE_CAPTURE: "Methane Capture & Avoidance",
  WASTE_MANAGEMENT: "Waste & Landfill Gas",
  INDUSTRIAL_EFFICIENCY: "Industrial Efficiency & Fuel Switching",
};

export function carbonTypeLabel(value: CarbonCreditType): string {
  return CARBON_TYPE_LABELS[value] ?? "Carbon opportunity";
}

/** Optional short blurb for each type, used by the customer desk and the admin picker. */
const CARBON_TYPE_BLURBS: Record<CarbonCreditType, string> = {
  REFORESTATION: "Planting and restoring forest on degraded or deforested land.",
  FOREST_CONSERVATION: "Protecting standing forest from clearance (REDD+).",
  SOIL_CARBON: "Regenerative farming that stores carbon in soils.",
  BLUE_CARBON: "Mangrove, seagrass and coastal wetland restoration.",
  COOKSTOVES: "Efficient cookstoves that cut fuel use and household emissions.",
  BIOCHAR: "Pyrolysed biomass that locks carbon into soils and materials.",
  DIRECT_AIR_CAPTURE: "Engineered machines that pull CO₂ directly from the air.",
  BECCS: "Bioenergy generation paired with geological carbon capture.",
  ENHANCED_WEATHERING: "Spreading crushed rock to mineralise and store CO₂.",
  OCEAN_ALKALINITY: "Ocean chemistry enhancement that increases carbon uptake.",
  RENEWABLE_ENERGY: "Renewable generation whose credits displace fossil power.",
  METHANE_CAPTURE: "Capturing methane from agriculture, coal and oil and gas.",
  WASTE_MANAGEMENT: "Landfill-gas and waste-to-energy methane abatement.",
  INDUSTRIAL_EFFICIENCY: "Industrial efficiency and fuel-switching emission cuts.",
};

export function carbonTypeBlurb(value: CarbonCreditType): string {
  return CARBON_TYPE_BLURBS[value] ?? "";
}

/** Grouped presentation of the credit types, for the admin picker and customer filters. */
export const CARBON_TYPE_GROUPS: { label: string; detail: string; types: CarbonCreditType[] }[] = [
  { label: "Nature-based", detail: "Forests, soils and coastal wetlands", types: ["REFORESTATION", "FOREST_CONSERVATION", "SOIL_CARBON", "BLUE_CARBON"] },
  { label: "Community & waste", detail: "Cookstoves, biochar, methane and waste", types: ["COOKSTOVES", "BIOCHAR", "METHANE_CAPTURE", "WASTE_MANAGEMENT"] },
  { label: "Engineered removals", detail: "Machines, bioenergy, weathering and oceans", types: ["DIRECT_AIR_CAPTURE", "BECCS", "ENHANCED_WEATHERING", "OCEAN_ALKALINITY"] },
  { label: "Energy & industry", detail: "Renewable credits and industrial abatement", types: ["RENEWABLE_ENERGY", "INDUSTRIAL_EFFICIENCY"] },
];

export const CARBON_SECTORS: readonly CarbonSector[] = [
  "FORESTRY", "AGRICULTURE", "ENERGY", "WASTE", "INDUSTRIAL", "OCEAN", "GEOLOGICAL", "OTHER",
];

const SECTOR_LABELS: Record<CarbonSector, string> = {
  FORESTRY: "Forestry", AGRICULTURE: "Agriculture", ENERGY: "Energy", WASTE: "Waste",
  INDUSTRIAL: "Industrial", OCEAN: "Ocean", GEOLOGICAL: "Geological", OTHER: "Other",
};

export function carbonSectorLabel(value: CarbonSector): string {
  return SECTOR_LABELS[value] ?? SECTOR_LABELS.OTHER;
}

export const CARBON_STANDARDS: readonly CarbonStandard[] = [
  "VERRA_VCS", "GOLD_STANDARD", "CDM", "ACR", "CAR", "PLAN_VIVO", "PURO_EARTH", "OTHER",
];

const STANDARD_LABELS: Record<CarbonStandard, string> = {
  VERRA_VCS: "Verra VCS", GOLD_STANDARD: "Gold Standard", CDM: "CDM", ACR: "ACR",
  CAR: "Climate Action Reserve", PLAN_VIVO: "Plan Vivo", PURO_EARTH: "Puro.earth", OTHER: "Other standard",
};

export function carbonStandardLabel(value: CarbonStandard): string {
  return STANDARD_LABELS[value] ?? "Other standard";
}

export const CARBON_STAGES: readonly CarbonStage[] = [
  "PLANNED", "FUNDING", "DEVELOPMENT", "VALIDATION", "ISSUANCE", "RETIRING", "CLOSED",
];

const STAGE_LABELS: Record<CarbonStage, string> = {
  PLANNED: "Planned", FUNDING: "Funding", DEVELOPMENT: "Development",
  VALIDATION: "Validation", ISSUANCE: "Issuance", RETIRING: "Retiring", CLOSED: "Closed",
};

export function carbonStageLabel(stage: CarbonStage): string {
  return STAGE_LABELS[stage] ?? "Planned";
}

export const CARBON_DOSSIER_STATUSES: readonly CarbonDossierStatus[] = [
  "FUNDING", "ESCROW", "DEVELOPMENT", "ACTIVE", "ISSUING", "COMPLETED", "WITHDRAWN",
];

const STATUS_LABELS: Record<CarbonDossierStatus, string> = {
  FUNDING: "Funding", ESCROW: "In escrow", DEVELOPMENT: "Development",
  ACTIVE: "Active", ISSUING: "Issuing", COMPLETED: "Completed", WITHDRAWN: "Withdrawn",
};

export function carbonStatusLabel(status: CarbonDossierStatus): string {
  return STATUS_LABELS[status] ?? "Funding";
}

export const CARBON_RISK_GRADES: readonly CarbonRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];

const RISK_LABELS: Record<CarbonRiskGrade, string> = {
  PRIME: "Prime", BALANCED: "Balanced", SPECULATIVE: "Speculative", HIGH_RISK: "High risk",
};

export function carbonRiskLabel(value: CarbonRiskGrade): string {
  return RISK_LABELS[value] ?? "Balanced";
}

export const CARBON_OUTCOMES: readonly CarbonOutcome[] = ["HIGH_ISSUANCE", "ON_PLAN", "WRITE_OFF"];

const OUTCOME_LABELS: Record<CarbonOutcome, string> = {
  HIGH_ISSUANCE: "High issuance", ON_PLAN: "On plan", WRITE_OFF: "Write-off",
};

export function carbonOutcomeLabel(value: CarbonOutcome): string {
  return OUTCOME_LABELS[value] ?? "On plan";
}

export const CARBON_TERRITORY_BANDS: readonly CarbonTerritoryBand[] = ["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"];

const TERRITORY_BAND_LABELS: Record<CarbonTerritoryBand, string> = {
  LOCAL: "Local", REGIONAL: "Regional", NATIONAL: "National", GLOBAL: "Global",
};

export function carbonTerritoryBandLabel(value: CarbonTerritoryBand): string {
  return TERRITORY_BAND_LABELS[value] ?? "Regional";
}

export const CARBON_VALUE_BANDS: readonly CarbonValueBand[] = ["UNDER_100K", "100K_1M", "1M_10M", "OVER_10M"];

const VALUE_BAND_LABELS: Record<CarbonValueBand, string> = {
  UNDER_100K: "Under 100K", "100K_1M": "100K – 1M", "1M_10M": "1M – 10M", OVER_10M: "Over 10M",
};

export function carbonValueBandLabel(value: CarbonValueBand): string {
  return VALUE_BAND_LABELS[value] ?? "";
}

/* ------------------------------------------------------------------ *
 * Atlas — regions, country centroids and the ISO-3166 region resolver
 * ------------------------------------------------------------------ */

/** The atlas rail: the regions the customer console navigates by, in reading order. */
export const CARBON_REGION_LIST: readonly CarbonRegion[] = [
  "AFRICA", "LATIN_AMERICA", "NORTH_AMERICA", "EUROPE", "SOUTH_ASIA",
  "SOUTHEAST_ASIA", "EAST_ASIA", "OCEANIA", "MIDDLE_EAST", "GLOBAL",
];

const REGION_LABELS: Record<CarbonRegion, string> = {
  AFRICA: "Africa", LATIN_AMERICA: "Latin America", NORTH_AMERICA: "North America",
  EUROPE: "Europe", SOUTH_ASIA: "South Asia", SOUTHEAST_ASIA: "Southeast Asia",
  EAST_ASIA: "East Asia", OCEANIA: "Oceania", MIDDLE_EAST: "Middle East", GLOBAL: "Global",
};

export function carbonRegionLabel(value: CarbonRegion): string {
  return REGION_LABELS[value] ?? "Global";
}

/** Approximate region centroids [longitude, latitude], used to place pins and region markers. */
export const CARBON_REGION_CENTROIDS: Record<CarbonRegion, [number, number]> = {
  AFRICA: [20, 3],
  LATIN_AMERICA: [-60, -15],
  NORTH_AMERICA: [-100, 45],
  EUROPE: [15, 50],
  SOUTH_ASIA: [78, 22],
  SOUTHEAST_ASIA: [110, 10],
  EAST_ASIA: [115, 35],
  OCEANIA: [140, -25],
  MIDDLE_EAST: [45, 28],
  GLOBAL: [0, 0],
};

const REGION_BY_ISO2: Record<string, CarbonRegion> = {
  // Africa
  DZ: "AFRICA", AO: "AFRICA", BJ: "AFRICA", BW: "AFRICA", BF: "AFRICA", BI: "AFRICA", CM: "AFRICA",
  CV: "AFRICA", CF: "AFRICA", TD: "AFRICA", KM: "AFRICA", CD: "AFRICA", CG: "AFRICA", CI: "AFRICA",
  DJ: "AFRICA", EG: "AFRICA", GQ: "AFRICA", ER: "AFRICA", SZ: "AFRICA", ET: "AFRICA", GA: "AFRICA",
  GM: "AFRICA", GH: "AFRICA", GN: "AFRICA", GW: "AFRICA", KE: "AFRICA", LS: "AFRICA", LR: "AFRICA",
  LY: "AFRICA", MG: "AFRICA", MW: "AFRICA", ML: "AFRICA", MR: "AFRICA", MU: "AFRICA", MA: "AFRICA",
  MZ: "AFRICA", NA: "AFRICA", NE: "AFRICA", NG: "AFRICA", RW: "AFRICA", ST: "AFRICA", SN: "AFRICA",
  SC: "AFRICA", SL: "AFRICA", SO: "AFRICA", ZA: "AFRICA", SS: "AFRICA", SD: "AFRICA", TZ: "AFRICA",
  TG: "AFRICA", TN: "AFRICA", UG: "AFRICA", ZM: "AFRICA", ZW: "AFRICA",
  // Latin America & Caribbean
  AR: "LATIN_AMERICA", BO: "LATIN_AMERICA", BR: "LATIN_AMERICA", CL: "LATIN_AMERICA", CO: "LATIN_AMERICA",
  CR: "LATIN_AMERICA", CU: "LATIN_AMERICA", DO: "LATIN_AMERICA", EC: "LATIN_AMERICA", SV: "LATIN_AMERICA",
  GT: "LATIN_AMERICA", GY: "LATIN_AMERICA", HT: "LATIN_AMERICA", HN: "LATIN_AMERICA", JM: "LATIN_AMERICA",
  MX: "LATIN_AMERICA", NI: "LATIN_AMERICA", PA: "LATIN_AMERICA", PY: "LATIN_AMERICA", PE: "LATIN_AMERICA",
  SR: "LATIN_AMERICA", UY: "LATIN_AMERICA", VE: "LATIN_AMERICA", BZ: "LATIN_AMERICA",
  // North America
  US: "NORTH_AMERICA", CA: "NORTH_AMERICA",
  // Europe
  AL: "EUROPE", AD: "EUROPE", AT: "EUROPE", BY: "EUROPE", BE: "EUROPE", BA: "EUROPE", BG: "EUROPE",
  HR: "EUROPE", CY: "EUROPE", CZ: "EUROPE", DK: "EUROPE", EE: "EUROPE", FI: "EUROPE", FR: "EUROPE",
  DE: "EUROPE", GR: "EUROPE", HU: "EUROPE", IS: "EUROPE", IE: "EUROPE", IT: "EUROPE", XK: "EUROPE",
  LV: "EUROPE", LI: "EUROPE", LT: "EUROPE", LU: "EUROPE", MT: "EUROPE", MD: "EUROPE", MC: "EUROPE",
  ME: "EUROPE", NL: "EUROPE", MK: "EUROPE", NO: "EUROPE", PL: "EUROPE", PT: "EUROPE", RO: "EUROPE",
  RU: "EUROPE", SM: "EUROPE", RS: "EUROPE", SK: "EUROPE", SI: "EUROPE", ES: "EUROPE", SE: "EUROPE",
  CH: "EUROPE", TR: "EUROPE", UA: "EUROPE", GB: "EUROPE", VA: "EUROPE",
  // South Asia
  AF: "SOUTH_ASIA", BD: "SOUTH_ASIA", BT: "SOUTH_ASIA", IN: "SOUTH_ASIA", MV: "SOUTH_ASIA",
  NP: "SOUTH_ASIA", PK: "SOUTH_ASIA", LK: "SOUTH_ASIA",
  // Southeast Asia
  BN: "SOUTHEAST_ASIA", KH: "SOUTHEAST_ASIA", ID: "SOUTHEAST_ASIA", LA: "SOUTHEAST_ASIA",
  MY: "SOUTHEAST_ASIA", MM: "SOUTHEAST_ASIA", PH: "SOUTHEAST_ASIA", SG: "SOUTHEAST_ASIA",
  TH: "SOUTHEAST_ASIA", TL: "SOUTHEAST_ASIA", VN: "SOUTHEAST_ASIA",
  // East Asia
  CN: "EAST_ASIA", HK: "EAST_ASIA", JP: "EAST_ASIA", KP: "EAST_ASIA", KR: "EAST_ASIA",
  MN: "EAST_ASIA", MO: "EAST_ASIA", TW: "EAST_ASIA",
  // Oceania
  AU: "OCEANIA", FJ: "OCEANIA", KI: "OCEANIA", MH: "OCEANIA", NR: "OCEANIA", NZ: "OCEANIA",
  PG: "OCEANIA", PW: "OCEANIA", WS: "OCEANIA", SB: "OCEANIA", TO: "OCEANIA", TV: "OCEANIA", VU: "OCEANIA",
  // Middle East
  BH: "MIDDLE_EAST", IR: "MIDDLE_EAST", IQ: "MIDDLE_EAST", IL: "MIDDLE_EAST", JO: "MIDDLE_EAST",
  KW: "MIDDLE_EAST", LB: "MIDDLE_EAST", OM: "MIDDLE_EAST", QA: "MIDDLE_EAST", SA: "MIDDLE_EAST",
  SY: "MIDDLE_EAST", AE: "MIDDLE_EAST", YE: "MIDDLE_EAST", PS: "MIDDLE_EAST",
};

/** Resolve the atlas region for an ISO-3166 alpha-2 code, falling back to GLOBAL. */
export function carbonRegionOf(countryCode: string | null | undefined): CarbonRegion {
  const code = String(countryCode || "").trim().toUpperCase();
  return REGION_BY_ISO2[code] ?? "GLOBAL";
}

/** Approximate country centroids [longitude, latitude] for pin placement on the atlas. */
export const CARBON_COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  BR: [-55, -10], IN: [79, 22], US: [-100, 40], CN: [105, 35], KE: [38, 0], NG: [8, 10],
  AU: [134, -25], AR: [-64, -34], ID: [120, -2], VN: [106, 16], UA: [32, 49], FR: [2, 46],
  PE: [-75, -10], CD: [24, -3], CO: [-72, 4], MX: [-102, 23], MZ: [35, -18], TZ: [35, -6],
  ZM: [27, -13], GH: [-1, 8], DE: [10, 51], ES: [-4, 40], IT: [12, 42], PL: [20, 52],
  NL: [5, 52], SE: [15, 62], FI: [26, 64], NO: [8, 61], DK: [10, 56], IE: [-8, 53],
  PT: [-8, 39], GR: [22, 39], RO: [25, 46], CZ: [15, 50], AT: [14, 47], BE: [4, 51],
  BG: [25, 43], HR: [16, 45], HU: [19, 47], SK: [19, 49], SI: [15, 46], LT: [24, 55],
  LV: [25, 57], EE: [26, 59], LU: [6, 50], CY: [33, 35], MT: [14, 36], IS: [-19, 65],
  GB: [-3, 55], TR: [35, 39], CA: [-100, 60], JP: [138, 36], KR: [128, 36], MY: [102, 4],
  PH: [122, 12], TH: [101, 15], PK: [70, 30], BD: [90, 24], LK: [81, 8], NP: [84, 28],
  ET: [40, 9], ZA: [24, -29], EG: [30, 27], MA: [-7, 32], CM: [12, 6], CI: [-5, 8],
  SN: [-14, 14], MG: [47, -20], BO: [-64, -17], EC: [-78, -2], GY: [-59, 5],
  PY: [-58, -23], UY: [-56, -33], CL: [-71, -35], PG: [144, -6], NZ: [172, -41], FJ: [178, -18],
  SA: [45, 24], AE: [54, 24], IL: [35, 31], IR: [53, 32], IQ: [44, 33], KZ: [67, 48],
  RU: [100, 61], MN: [103, 47], MM: [96, 21], KH: [105, 12], LA: [103, 18], BN: [114, 4],
};

/** Resolve a pin coordinate for a country, falling back to its region centroid. */
export function carbonCountryPoint(countryCode: string | null | undefined): [number, number] {
  const code = String(countryCode || "").trim().toUpperCase();
  return CARBON_COUNTRY_CENTROIDS[code] ?? CARBON_REGION_CENTROIDS[carbonRegionOf(code)];
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

/**
 * Best-effort classification of a carbon opportunity from its heading text.
 * Priority-ordered: the first pattern that matches wins. Strictly carbon.
 */
const TYPE_PATTERNS: [CarbonCreditType, RegExp][] = [
  ["DIRECT_AIR_CAPTURE", /\b(direct air capture|dac|air capture)\b/i],
  ["BECCS", /\b(beccs|bioenergy with carbon capture|bio-?energy ccs)\b/i],
  ["ENHANCED_WEATHERING", /\b(enhanced weathering|enhanced rock|olivine|basalt|mineralis|mineraliz)\b/i],
  ["OCEAN_ALKALINITY", /\b(ocean alkalinity|alkalinity enhancement|ocean carbon)\b/i],
  ["BLUE_CARBON", /\b(blue carbon|mangrove|seagrass|salt marsh|coastal wetland)\b/i],
  ["BIOCHAR", /\b(biochar|pyrolys|pyrogenic)\b/i],
  ["COOKSTOVES", /\b(cook ?stove|cookstove|improved stove|clean cooking)\b/i],
  ["METHANE_CAPTURE", /\b(methane|biogas|digester|flaring|coal mine gas|livestock methane)\b/i],
  ["WASTE_MANAGEMENT", /\b(landfill|waste|compost|anaerobic|refuse)\b/i],
  ["SOIL_CARBON", /\b(soil carbon|regenerative agri|cover crop|no-?till|agroforestry|soil organic)\b/i],
  ["REFORESTATION", /\b(reforest|afforest|tree planting|reforestation|woodland|planting)\b/i],
  ["FOREST_CONSERVATION", /\b(redd\+?|forest conservation|forest protection|deforestation|avoided|conservation|forest)\b/i],
  ["RENEWABLE_ENERGY", /\b(renewable|solar|wind|hydro|geothermal|clean power|electricity)\b/i],
  ["INDUSTRIAL_EFFICIENCY", /\b(industrial|efficiency|fuel switch|cement|steel|carbon capture|emissions)\b/i],
];

export function classifyCarbonType(input: { title?: string | null; description?: string | null; hint?: CarbonCreditType | null }): CarbonCreditType {
  if (input.hint && (CARBON_CREDIT_TYPES as readonly string[]).includes(input.hint)) return input.hint;
  const haystack = `${input.title || ""} ${input.description || ""}`;
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(haystack)) return type;
  return "FOREST_CONSERVATION";
}

/** Coarse value band from a minor-unit amount, only set when an amount is known. */
export function carbonValueBandFromMinor(minor: number | null | undefined): CarbonValueBand | null {
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

export function carbonRemainingDaysFor(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = Date.parse(deadline);
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/** Probability-weighted expected revenue over the published scenarios. */
export function carbonExpectedValueMinor(scenarios: CarbonScenario[]): number | null {
  if (!scenarios.length) return null;
  return scenarios.reduce((sum, scenario) => sum + Math.round((scenario.grossRevenueMinor * scenario.probabilityBps) / 10_000), 0);
}

const RISK_ORDER: Record<CarbonRiskGrade, number> = { PRIME: 0, BALANCED: 1, SPECULATIVE: 2, HIGH_RISK: 3 };
const STATUS_ORDER: Record<CarbonDossierStatus, number> = {
  FUNDING: 0, ESCROW: 1, DEVELOPMENT: 2, ACTIVE: 3, ISSUING: 4, COMPLETED: 5, WITHDRAWN: 6,
};

/** Fundable opportunities first, then lifecycle status, risk grade, funding progress, recency. */
export function compareCarbonOpportunities(a: CarbonOpportunity, b: CarbonOpportunity): number {
  if (a.fundable !== b.fundable) return a.fundable ? -1 : 1;
  const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (status !== 0) return status;
  const risk = (a.riskGrade ? RISK_ORDER[a.riskGrade] : 9) - (b.riskGrade ? RISK_ORDER[b.riskGrade] : 9);
  if (risk !== 0) return risk;
  if (a.fundedBps !== b.fundedBps) return b.fundedBps - a.fundedBps;
  if (a.asOf !== b.asOf) return b.asOf.localeCompare(a.asOf);
  return a.title.localeCompare(b.title);
}

const DEFAULT_CARBON_MILESTONES: CarbonMilestone[] = (
  [
    ["PLANNED", "Planned", 1000],
    ["FUNDING", "Funded", 2500],
    ["DEVELOPMENT", "In development", 4500],
    ["VALIDATION", "Validated", 6500],
    ["ISSUANCE", "Issuing credits", 8000],
    ["RETIRING", "Retiring credits", 9200],
    ["CLOSED", "Closed", 10000],
  ] as [CarbonStage, string, number][]
).map(([stage, label, releaseBps]) => ({ stage, label, releaseBps, status: "PENDING" as const, reachedAt: null }));

export function defaultCarbonMilestones(): CarbonMilestone[] {
  return DEFAULT_CARBON_MILESTONES.map((milestone) => ({ ...milestone }));
}

/* ------------------------------------------------------------------ *
 * Discovery layer — cited public carbon references (keyless)
 * ------------------------------------------------------------------ */

async function fetchWorldBankIndicator(indicator: (typeof WORLDBANK_INDICATORS)[number]): Promise<CarbonOpportunity[]> {
  const url = `${WORLDBANK_BASE}/country/${WORLD_BANK_ISO3}/indicator/${indicator.code}?format=json&per_page=100&date=${WORLD_BANK_DATE_RANGE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`World Bank responded ${response.status}`);
    const payload: any = await response.json();
    const records: any[] = Array.isArray(payload?.[1]) ? payload[1] : [];
    const mapped: CarbonOpportunity[] = [];
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
        creditType: indicator.creditType,
        sector: indicator.sector,
        standard: null,
        territory: countryName,
        territoryBand: "NATIONAL",
        region: carbonRegionOf(iso2),
        countryCode: iso2,
        country: countryName,
        flag: flagFor(iso2),
        offtaker: null,
        description: `${countryName} — “${indicator.name}” (${date}, ${indicator.unit}). A cited public carbon reference surfaced from the World Bank Open Data feed. No funding economics are published for discovery references.`,
        dealType: null,
        stage: "DEVELOPMENT",
        status: "ACTIVE",
        riskGrade: null,
        revenueSharesBps: null,
        expectedMultipleBps: null,
        expectedDurationMonths: null,
        projectedRevenueMinor: null,
        capitalAtRiskMinor: null,
        fundingAskMinor: null,
        creditVolumeTonnes: null,
        pricePerTonneMinor: null,
        committedMinor: 0,
        fundedBps: 0,
        minimumInvestmentMinor: null,
        unitPriceMinor: null,
        eventDate: `${date}-01-01`,
        fundingDeadline: null,
        remainingDays: null,
        scenarios: [],
        expectedValueMinor: null,
        milestones: defaultCarbonMilestones(),
        highlights: value != null ? [`Value: ${value} ${indicator.unit}`] : [],
        source: "World Bank Open Data",
        sourceUrl: `https://data.worldbank.org/indicator/${indicator.code}`,
        asOf: `${date}-01-01`,
        verified: false,
        fundable: false,
        verificationStatus: "REFERENCE",
      });
    }
    return mapped;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drain one keyless Eurostat (ESTAT) carbon dataset. JSON-stat encodes each
 * observation at flat index Σ index_i × stride_i (stride_i = product of the sizes
 * of the later dimensions); decoding that index yields the territory and period
 * of every observation, from which the latest period per territory is kept.
 */
async function fetchEurostatDataset(dataset: (typeof EUROSTAT_DATASETS)[number]): Promise<CarbonOpportunity[]> {
  const query = dataset.query ? `&${dataset.query}` : "";
  const url = `${EUROSTAT_BASE}/${dataset.dataset}?format=JSON&lang=EN${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Eurostat responded ${response.status}`);
    const payload: any = await response.json();
    const ids: string[] = Array.isArray(payload?.id) ? payload.id : [];
    const sizes: number[] = Array.isArray(payload?.size) ? payload.size : [];
    const values: Record<string, number> = payload?.value && typeof payload.value === "object" ? payload.value : {};
    if (!ids.length || !sizes.length) return [];
    const geoDim = ids.indexOf("geo");
    if (geoDim < 0) return [];
    const timeDim = ids.indexOf("time");
    const strides = sizes.map((_, index) => sizes.slice(index + 1).reduce((product, size) => product * size, 1));
    const geoIndex: Record<string, number> = payload?.dimension?.geo?.category?.index || {};
    const geoLabels: Record<string, string> = payload?.dimension?.geo?.category?.label || {};
    const timeIndex: Record<string, number> = payload?.dimension?.time?.category?.index || {};
    const timeLabels: Record<string, string> = payload?.dimension?.time?.category?.label || {};
    const geoCodes = Object.keys(geoIndex);
    const timeCodes = Object.keys(timeIndex);

    // One observation per territory: keep the latest time period published for each geo.
    const byGeo = new Map<number, { value: number; period: string; timePosition: number }>();
    for (const key of Object.keys(values)) {
      const flat = Number(key);
      const value = Number(values[key]);
      if (!Number.isFinite(flat) || !Number.isFinite(value)) continue;
      const geoPosition = Math.floor(flat / strides[geoDim]) % sizes[geoDim];
      const timePosition = timeDim >= 0 ? Math.floor(flat / strides[timeDim]) % sizes[timeDim] : 0;
      const existing = byGeo.get(geoPosition);
      if (existing && existing.timePosition >= timePosition) continue;
      const timeCode = timeCodes[timePosition] || "";
      byGeo.set(geoPosition, { value, period: timeLabels[timeCode] || timeCode, timePosition });
    }

    const mapped: CarbonOpportunity[] = [];
    for (const [geoPosition, observation] of byGeo) {
      const code = geoCodes[geoPosition];
      if (!code || !/^[A-Z]{2}$/.test(code) || EUROSTAT_AGGREGATE_GEO.has(code)) continue;
      const countryName = decodeEntities(String(geoLabels[code] || code)).trim();
      const period = observation.period;
      if (!countryName || !period) continue;
      mapped.push({
        id: `eurostat-${dataset.dataset}-${code}-${period}`,
        title: `${dataset.metric} — ${countryName} (${period})`,
        operator: "Eurostat (ESTAT)",
        creditType: dataset.creditType,
        sector: dataset.sector,
        standard: null,
        territory: countryName,
        territoryBand: "NATIONAL",
        region: carbonRegionOf(code),
        countryCode: code,
        country: countryName,
        flag: flagFor(code),
        offtaker: null,
        description: `${countryName} — “${dataset.metric}” (${period}, ${dataset.unit}). A cited public carbon reference surfaced from the Eurostat (ESTAT) open feed. No funding economics are published for discovery references.`,
        dealType: null,
        stage: "DEVELOPMENT",
        status: "ACTIVE",
        riskGrade: null,
        revenueSharesBps: null,
        expectedMultipleBps: null,
        expectedDurationMonths: null,
        projectedRevenueMinor: null,
        capitalAtRiskMinor: null,
        fundingAskMinor: null,
        creditVolumeTonnes: null,
        pricePerTonneMinor: null,
        committedMinor: 0,
        fundedBps: 0,
        minimumInvestmentMinor: null,
        unitPriceMinor: null,
        eventDate: `${period}-01-01`,
        fundingDeadline: null,
        remainingDays: null,
        scenarios: [],
        expectedValueMinor: null,
        milestones: defaultCarbonMilestones(),
        highlights: [`Value: ${observation.value} ${dataset.unit}`],
        source: "Eurostat (ESTAT)",
        sourceUrl: `https://ec.europa.eu/eurostat/databrowser/view/${dataset.dataset}/default/table`,
        asOf: `${period}-01-01`,
        verified: false,
        fundable: false,
        verificationStatus: "REFERENCE",
      });
    }
    return mapped;
  } finally {
    clearTimeout(timer);
  }
}

let cache: { value: CarbonInvestmentCatalogue; expiresAt: number } | null = null;
let inflight: Promise<CarbonInvestmentCatalogue> | null = null;

async function buildCatalogue(): Promise<CarbonInvestmentCatalogue> {
  const opportunities: CarbonOpportunity[] = [];
  const seen = new Set<string>();

  // Drain both keyless providers concurrently so one slow or blocked feed never
  // serialises the other, and a failure at either still leaves the desk populated.
  const [worldBankResults, eurostatResults] = await Promise.all([
    Promise.allSettled(WORLDBANK_INDICATORS.map((indicator) => fetchWorldBankIndicator(indicator))),
    Promise.allSettled(EUROSTAT_DATASETS.map((dataset) => fetchEurostatDataset(dataset))),
  ]);

  const collect = (results: PromiseSettledResult<CarbonOpportunity[]>[], label: string): number => {
    let count = 0;
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`[CarbonCredits] ${label} discovery source failed:`, result.reason instanceof Error ? result.reason.message : "UnknownError");
        continue;
      }
      for (const item of result.value) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        opportunities.push(item);
        count += 1;
      }
    }
    return count;
  };

  const worldBankCount = collect(worldBankResults, "World Bank");
  const eurostatCount = collect(eurostatResults, "Eurostat");
  const worldBankOk = worldBankCount > 0;
  const eurostatOk = eurostatCount > 0;

  const sources: CarbonInvestmentSource[] = [
    {
      name: "Arbitrade carbon desk — administrator published",
      url: "",
      country: "XX",
      role: "opportunities",
      status: "ok",
      detail: "Carbon-credit opportunities across reforestation, forest conservation, soil carbon, blue carbon, cookstoves, biochar, direct air capture, BECCS, enhanced weathering, ocean alkalinity, renewable energy, methane capture, waste and industrial efficiency are published by the desk administrator with cited economics.",
    },
    {
      name: "Eurostat (ESTAT)",
      url: "https://ec.europa.eu/eurostat",
      country: "EU",
      role: "catalogue",
      status: eurostatOk ? "ok" : "degraded",
      detail: eurostatOk
        ? `${eurostatCount} cited Eurostat carbon reference${eurostatCount === 1 ? "" : "s"} surfaced across renewable-energy share and greenhouse-gas emissions. References carry no funding economics.`
        : "The Eurostat public carbon reference feed is unavailable right now; other cited sources and administrator-published opportunities are unaffected.",
    },
    {
      name: "World Bank Open Data",
      url: "https://data.worldbank.org",
      country: "XX",
      role: "catalogue",
      status: worldBankOk ? "ok" : "degraded",
      detail: worldBankOk
        ? `${worldBankCount} cited public carbon reference${worldBankCount === 1 ? "" : "s"} surfaced for context. References carry no funding economics.`
        : "The World Bank public carbon reference feed is unavailable right now; other cited sources and administrator-published opportunities are unaffected.",
    },
    {
      name: "Arbitrade carbon desk — desk methodology",
      url: "",
      country: "XX",
      role: "context",
      status: "ok",
      detail: "Carbon only: reforestation, forest conservation, soil carbon, blue carbon, cookstoves, biochar, direct air capture, BECCS, enhanced weathering, ocean alkalinity, renewable energy, methane capture, waste and industrial efficiency. No non-carbon assets are carried.",
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
export async function getCarbonInvestmentCatalogue(options: { force?: boolean } = {}): Promise<CarbonInvestmentCatalogue> {
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
export async function findCarbonOpportunity(id: string): Promise<CarbonOpportunity | null> {
  const catalogue = await getCarbonInvestmentCatalogue();
  return catalogue.opportunities.find((item) => item.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Desk analytics — aggregated from the opportunities on the desk
 * ------------------------------------------------------------------ */

export type CarbonAnalyticsBucket = { key: string; label: string; count: number };

export type CarbonAnalytics = {
  totalOpportunities: number;
  fundableCount: number;
  natureBased: number;
  raisingMinor: number;
  committedMinor: number;
  tonnage: number;
  byType: CarbonAnalyticsBucket[];
  bySector: CarbonAnalyticsBucket[];
  byStandard: CarbonAnalyticsBucket[];
  byRegion: CarbonAnalyticsBucket[];
  byTerritory: CarbonAnalyticsBucket[];
  byStage: CarbonAnalyticsBucket[];
  byMonth: CarbonAnalyticsBucket[];
};

const ISO_MONTH = /^\d{4}-\d{2}$/;

export function buildCarbonAnalytics(opportunities: CarbonOpportunity[]): CarbonAnalytics {
  const typeCounts = new Map<CarbonCreditType, number>();
  const sectorCounts = new Map<CarbonSector, number>();
  const standardCounts = new Map<string, number>();
  const regionCounts = new Map<CarbonRegion, number>();
  const territoryCounts = new Map<string, number>();
  const stageCounts = new Map<CarbonStage, number>();
  const monthCounts = new Map<string, number>();
  let fundableCount = 0;
  let natureBased = 0;
  let raisingMinor = 0;
  let committedMinor = 0;
  let tonnage = 0;

  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const record of opportunities) {
    bump(typeCounts, record.creditType);
    bump(sectorCounts, record.sector);
    bump(standardCounts, record.standard ?? "UNVERIFIED");
    bump(regionCounts, record.region);
    bump(territoryCounts, record.territory || "Unspecified");
    bump(stageCounts, record.stage);
    const month = (record.eventDate || record.asOf || "").slice(0, 7);
    if (ISO_MONTH.test(month)) bump(monthCounts, month);
    if (record.fundable) fundableCount += 1;
    if (record.creditType === "REFORESTATION" || record.creditType === "FOREST_CONSERVATION" || record.creditType === "SOIL_CARBON" || record.creditType === "BLUE_CARBON") natureBased += 1;
    raisingMinor += Number(record.fundingAskMinor || 0);
    committedMinor += Number(record.committedMinor || 0);
    tonnage += Number(record.creditVolumeTonnes || 0);
  }

  const buckets = <K>(map: Map<K, number>, label: (key: K) => string): CarbonAnalyticsBucket[] =>
    [...map.entries()]
      .map(([key, count]) => ({ key: String(key), label: label(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    totalOpportunities: opportunities.length,
    fundableCount,
    natureBased,
    raisingMinor,
    committedMinor,
    tonnage,
    byType: buckets(typeCounts, (key) => carbonTypeLabel(key)),
    bySector: buckets(sectorCounts, (key) => carbonSectorLabel(key)),
    byStandard: buckets(standardCounts, (key) => (key === "UNVERIFIED" ? "Not yet verified" : carbonStandardLabel(key as CarbonStandard))),
    byRegion: buckets(regionCounts, (key) => carbonRegionLabel(key)),
    byTerritory: buckets(territoryCounts, (key) => key).slice(0, 12),
    byStage: buckets(stageCounts, (key) => carbonStageLabel(key)),
    byMonth: buckets(monthCounts, (key) => key).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12),
  };
}

export function __resetCarbonCreditCacheForTest() {
  cache = null;
  inflight = null;
}

export const CARBON_MONTHS_TO_MS = MONTH_MS;
export const CARBON_WORLDBANK_INDICATORS = WORLDBANK_INDICATORS;
export const CARBON_EUROSTAT_DATASETS = EUROSTAT_DATASETS;
export const CARBON_DESK_CURRENCY = "USD";
export function carbonEnvKey(name: string): string {
  return envKey(name);
}
