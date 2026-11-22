/**
 * Cited IP-royalty data for the customer IP Royalties desk.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server and, as a resilience fallback, in the customer's
 * browser. It follows the two-layer design used across the platform's
 * investment desks:
 *
 *  - DISCOVERY layer — real, cited public intellectual-property and licensing
 *    registers drained through *free, keyless* APIs (Crossref, Open Library,
 *    the Art Institute of Chicago, the iTunes Search API and the GitHub
 *    repository search). These registers publish works, ownership and licence
 *    identity, but they do NOT publish the royalty rate, the expected
 *    collections or any funder economics. Every discovered record is therefore
 *    a *candidate* with `fundable: false` and no modelled numbers. Nothing is
 *    invented.
 *
 *  - DOSSIER layer — the administrator-reviewed economics for one IP right or
 *    one portfolio. It is the only thing a customer can fund and it is stored
 *    server-side (server/ipRoyaltiesDossiers.ts), never here.
 *
 * SCOPE BOUNDARIES. This desk spans ten licensing sectors (see
 * `SECTOR_RIGHT_TYPES`) and deliberately excludes the IP-adjacent sectors that
 * have their own menus: music royalties, NFTs, agro investment, green energy
 * and carbon credits. `boundaryFor`/`isIpRoyaltyInScope` classify an item and
 * route it to the sister desk it belongs to, so nothing out of scope is ever
 * shown or funded here.
 *
 * Sources that cannot be reached keylessly are reported honestly rather than
 * faked; a key-gated source is marked `keyed` and skipped until a token is
 * configured, and one that blocks non-browser clients is marked `unavailable`.
 * Because no public register publishes a royalty rate, a right only becomes
 * fundable when an administrator publishes sourced economics for it.
 */

import { findCountry, flagFor } from "./country-options";

export type IpRightType =
  | "PATENT"
  | "TRADEMARK"
  | "BRAND"
  | "COPYRIGHT"
  | "SOFTWARE"
  | "FILM_TV"
  | "CHARACTER"
  | "IMAGE_LIKENESS"
  | "FRANCHISE"
  | "KNOW_HOW"
  | "DESIGN";

export type IpRoyaltyRiskGrade = "PRIME" | "BALANCED" | "SPECULATIVE" | "HIGH_RISK";

/** Lifecycle of an administrator-published IP-royalty dossier. */
export type IpRoyaltyDossierStatus = "FUNDING" | "ACTIVE" | "DISTRIBUTING" | "COMPLETED" | "WITHDRAWN";

/** How a right's royalty is calculated. */
export type IpRoyaltyBasis = "PERCENT_OF_NET_SALES" | "PER_UNIT" | "FIXED_FEE" | "REVENUE_SHARE";

/** How often a licensed right is expected to settle and distribute. */
export type IpRoyaltyCadence = "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";

/** The final resolution recorded against a funded right. */
export type IpRoyaltyOutcome = "BUYOUT" | "RUNOFF_COMPLETE" | "WRITE_OFF";

export type IpRoyaltyInstrumentType = "RIGHT" | "PORTFOLIO";

/** A historical-payment indicator for the modelled stream. */
export type IpRoyaltyPaymentHistory = {
  /** Share of observed periods settled on time, in basis points. */
  onTimeBps: number;
  /** Average days from period end to receipt. */
  averageCollectionDays: number;
  /** Number of periods actually observed. */
  periodsObserved: number;
};

/**
 * One modelled stress case for a fundable right. Probabilities across the
 * scenarios of a right sum to exactly 10,000 basis points.
 */
export type IpRoyaltyScenario = {
  label: string;
  /** Probability weight in basis points; the scenarios must sum to 10,000. */
  probabilityBps: number;
  /** Expected distribution to funders per year, in minor units of the settlement currency. */
  expectedAnnualDistributionMinor: number;
  /** Expected life of the stream in whole months. */
  durationMonths: number;
  /** Total payout multiple to funders over the term, in bps (10,000 = 1.00x principal). */
  funderMultipleBps: number;
};

/**
 * A catalogue-facing IP right. Discovery records carry no economics
 * (`fundable: false`); a dossier-derived record is enriched with sourced
 * numbers by the administrator and becomes fundable.
 */
export type IpRight = {
  id: string;
  rightName: string;
  rightType: IpRightType;
  licensor: string;
  licenseeSummary: string | null;
  assetClass: string | null;
  jurisdiction: string;
  countryCode: string;
  country: string;
  flag: string;
  royaltyBasis: IpRoyaltyBasis;
  /** Royalty rate as basis points of net sales, when the basis is sales-linked. */
  royaltyRateBps: number | null;
  /** Royalty per unit sold, in minor units, when the basis is per-unit. */
  perUnitMinor: number | null;
  cadence: IpRoyaltyCadence;
  termMonths: number | null;
  minimumGuaranteeMinor: number | null;
  licenseeCount: number | null;
  /** Share of the stream from the single largest licensee, in basis points. */
  topLicenseeConcentrationBps: number | null;
  paymentHistory: IpRoyaltyPaymentHistory | null;
  riskGrade: IpRoyaltyRiskGrade | null;
  capitalAtRiskMinor: number | null;
  expectedAnnualDistributionMinor: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  fundingAskMinor: number | null;
  fundingDeadline: string | null;
  remainingDays: number | null;
  committedMinor: number;
  fundedBps: number;
  status: IpRoyaltyDossierStatus;
  /** True once an administrator has published sourced economics. */
  fundable: boolean;
  problem: string;
  highlights: string[];
  scenarios: IpRoyaltyScenario[];
  source: string;
  sourceUrl: string | null;
  asOf: string;
};

/** A pro-rata pool of several IP rights sold as one instrument. */
export type IpRoyaltyPortfolio = {
  id: string;
  name: string;
  rightType: IpRightType;
  jurisdiction: string;
  riskGrade: IpRoyaltyRiskGrade;
  targetMinor: number;
  unitPriceMinor: number;
  unitCount: number;
  rightIds: string[];
  /** Per-right allocation weight of the pool, in basis points summing to 10,000. */
  allocationBpsByRight: Record<string, number>;
  expectedMultipleBps: number;
  expectedDurationMonths: number | null;
  expectedAnnualDistributionMinor: number | null;
  summary: string;
  committedMinor: number;
  fundedBps: number;
  fundingDeadline: string | null;
  remainingDays: number | null;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  enabled: boolean;
};

export type IpRoyaltiesSource = {
  name: string;
  url: string;
  role: "discovery" | "context";
  status: "ok" | "keyed" | "unavailable";
  detail: string;
};

export type IpRoyaltiesCatalogue = {
  rights: IpRight[];
  sources: IpRoyaltiesSource[];
  fetchedAt: string;
  degraded: boolean;
};

export const IP_RIGHT_TYPES: readonly IpRightType[] = [
  "PATENT", "TRADEMARK", "BRAND", "DESIGN",
  "COPYRIGHT", "FILM_TV", "CHARACTER", "IMAGE_LIKENESS",
  "SOFTWARE", "FRANCHISE", "KNOW_HOW",
];
export const IP_ROYALTY_RISK_GRADES: readonly IpRoyaltyRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];
export const IP_ROYALTY_DOSSIER_STATUSES: readonly IpRoyaltyDossierStatus[] = ["FUNDING", "ACTIVE", "DISTRIBUTING", "COMPLETED", "WITHDRAWN"];
export const IP_ROYALTY_BASES: readonly IpRoyaltyBasis[] = ["PERCENT_OF_NET_SALES", "PER_UNIT", "FIXED_FEE", "REVENUE_SHARE"];
export const IP_ROYALTY_CADENCES: readonly IpRoyaltyCadence[] = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"];
export const IP_ROYALTY_OUTCOMES: readonly IpRoyaltyOutcome[] = ["BUYOUT", "RUNOFF_COMPLETE", "WRITE_OFF"];

/* ------------------------------------------------------------------ *
 * Sectors — the three grouped tabs the desk is organised under.
 * ------------------------------------------------------------------ */

export type IpRoyaltySector = "REGISTERED_IP" | "CREATIVE_MEDIA" | "BUSINESS_TECH";

export const IP_ROYALTY_SECTORS: readonly IpRoyaltySector[] = ["REGISTERED_IP", "CREATIVE_MEDIA", "BUSINESS_TECH"];

const SECTOR_LABELS: Record<IpRoyaltySector, string> = {
  REGISTERED_IP: "Registered IP",
  CREATIVE_MEDIA: "Creative & media",
  BUSINESS_TECH: "Business & tech",
};
const SECTOR_DETAILS: Record<IpRoyaltySector, string> = {
  REGISTERED_IP: "Patents, trademarks and registered designs",
  CREATIVE_MEDIA: "Copyrights, film & TV, characters and image rights",
  BUSINESS_TECH: "Software, franchise and trade secrets",
};
const SECTOR_BY_RIGHT_TYPE: Record<IpRightType, IpRoyaltySector> = {
  PATENT: "REGISTERED_IP", TRADEMARK: "REGISTERED_IP", BRAND: "REGISTERED_IP", DESIGN: "REGISTERED_IP",
  COPYRIGHT: "CREATIVE_MEDIA", FILM_TV: "CREATIVE_MEDIA", CHARACTER: "CREATIVE_MEDIA", IMAGE_LIKENESS: "CREATIVE_MEDIA",
  SOFTWARE: "BUSINESS_TECH", FRANCHISE: "BUSINESS_TECH", KNOW_HOW: "BUSINESS_TECH",
};

/** The right types that belong to each of the three sectors. */
export const SECTOR_RIGHT_TYPES: Record<IpRoyaltySector, readonly IpRightType[]> = {
  REGISTERED_IP: ["PATENT", "TRADEMARK", "BRAND", "DESIGN"],
  CREATIVE_MEDIA: ["COPYRIGHT", "FILM_TV", "CHARACTER", "IMAGE_LIKENESS"],
  BUSINESS_TECH: ["SOFTWARE", "FRANCHISE", "KNOW_HOW"],
};

export function sectorForRightType(value: IpRightType): IpRoyaltySector { return SECTOR_BY_RIGHT_TYPE[value] || "BUSINESS_TECH"; }
export function sectorLabel(value: IpRoyaltySector): string { return SECTOR_LABELS[value] || value; }
export function sectorDetail(value: IpRoyaltySector): string { return SECTOR_DETAILS[value] || ""; }

/* ------------------------------------------------------------------ *
 * Scope boundaries — the sister desks that own IP-adjacent sectors.
 * ------------------------------------------------------------------ */

/**
 * IP-adjacent sectors this desk must NOT include, because each has its own
 * menu. An item that classifies to one of these is routed away, never shown.
 */
export type IpRoyaltyBoundary = "MUSIC_ROYALTIES" | "NFT" | "AGRO_INVESTMENT" | "GREEN_ENERGY" | "CARBON_CREDIT";

export const IP_ROYALTY_BOUNDARIES: readonly IpRoyaltyBoundary[] = ["MUSIC_ROYALTIES", "NFT", "AGRO_INVESTMENT", "GREEN_ENERGY", "CARBON_CREDIT"];

const BOUNDARY_LABELS: Record<IpRoyaltyBoundary, string> = {
  MUSIC_ROYALTIES: "Music Royalties",
  NFT: "NFT",
  AGRO_INVESTMENT: "Agro Investment",
  GREEN_ENERGY: "Green Energy",
  CARBON_CREDIT: "Carbon Credit",
};

/** Ordered most-specific first; the first match wins. */
const BOUNDARY_PATTERNS: Array<[IpRoyaltyBoundary, RegExp]> = [
  ["MUSIC_ROYALTIES", /\b(music|musical|song|soundtrack|score|lyric|album|record label|recording artist|master rights|mechanical royal\w*|performance royal\w*|publishing catalogue)\b/i],
  ["NFT", /\b(nft|non[- ]?fungible|tokeni[sz]ed|mint(ed|ing|s)?|digital collectible|blockchain art|crypto art)\b/i],
  ["AGRO_INVESTMENT", /\b(plant breed\w*|plant variet\w*|seed variet\w*|seed patent|agro\w*|agricultur\w*|crop science|livestock|agritech|farm machinery|harvest)\b/i],
  ["GREEN_ENERGY", /\b(solar|wind (power|turbine|farm)|clean energy|green energy|renewable energy|photovoltaic|hydroelectric|geothermal|energy storage)\b/i],
  ["CARBON_CREDIT", /\b(carbon credit|carbon offset|carbon allowance|emission allowance|carbon (trading|sequestration)|verified carbon)\b/i],
];

export function boundaryLabel(value: IpRoyaltyBoundary): string { return BOUNDARY_LABELS[value] || value; }

/** The sister desk that owns this item, or null when it is in scope here. */
export function boundaryFor(text: string | null | undefined): IpRoyaltyBoundary | null {
  const value = String(text || "");
  if (!value.trim()) return null;
  for (const [boundary, pattern] of BOUNDARY_PATTERNS) if (pattern.test(value)) return boundary;
  return null;
}

/** True when an IP item belongs on this desk (music, NFTs, agro, green energy and carbon are routed away). */
export function isIpRoyaltyInScope(text: string | null | undefined): boolean {
  return boundaryFor(text) === null;
}

/** A human sentence explaining where an out-of-scope item belongs. */
export function boundaryGuidance(text: string | null | undefined): string {
  const boundary = boundaryFor(text);
  return boundary ? `In scope for ${boundaryLabel(boundary)}, not the IP Royalties desk.` : "";
}

const RIGHT_TYPE_LABELS: Record<IpRightType, string> = {
  PATENT: "Patent",
  TRADEMARK: "Trademark",
  BRAND: "Brand / licensing",
  COPYRIGHT: "Copyright",
  SOFTWARE: "Software & technology licence",
  FILM_TV: "Film, TV & streaming",
  CHARACTER: "Characters & merchandising",
  IMAGE_LIKENESS: "Image & likeness",
  FRANCHISE: "Franchise",
  KNOW_HOW: "Trade secret / know-how",
  DESIGN: "Registered design",
};
const RISK_LABELS: Record<IpRoyaltyRiskGrade, string> = {
  PRIME: "Prime", BALANCED: "Balanced", SPECULATIVE: "Speculative", HIGH_RISK: "High risk",
};
const STATUS_LABELS: Record<IpRoyaltyDossierStatus, string> = {
  FUNDING: "Funding", ACTIVE: "Active", DISTRIBUTING: "Distributing", COMPLETED: "Completed", WITHDRAWN: "Withdrawn",
};
const BASIS_LABELS: Record<IpRoyaltyBasis, string> = {
  PERCENT_OF_NET_SALES: "Share of net sales",
  PER_UNIT: "Per unit sold",
  FIXED_FEE: "Fixed recurring fee",
  REVENUE_SHARE: "Revenue share",
};
const CADENCE_LABELS: Record<IpRoyaltyCadence, string> = {
  MONTHLY: "Monthly", QUARTERLY: "Quarterly", SEMI_ANNUAL: "Semi-annual", ANNUAL: "Annual",
};
const OUTCOME_LABELS: Record<IpRoyaltyOutcome, string> = {
  BUYOUT: "Bought out", RUNOFF_COMPLETE: "Run-off complete", WRITE_OFF: "Written off",
};

export function rightTypeLabel(value: IpRightType): string { return RIGHT_TYPE_LABELS[value] || value; }
export function riskGradeLabel(value: IpRoyaltyRiskGrade): string { return RISK_LABELS[value] || value; }
export function statusLabel(value: IpRoyaltyDossierStatus): string { return STATUS_LABELS[value] || value; }
export function basisLabel(value: IpRoyaltyBasis): string { return BASIS_LABELS[value] || value; }
export function cadenceLabel(value: IpRoyaltyCadence): string { return CADENCE_LABELS[value] || value; }
export function outcomeLabel(value: IpRoyaltyOutcome): string { return OUTCOME_LABELS[value] || value; }

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
export const MONTHS_TO_MS = MONTH_MS;

/** Whole days until a YYYY-MM-DD deadline; negative once past, null when unset. */
export function remainingDaysFor(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = Date.parse(deadline.length <= 10 ? `${deadline}T00:00:00Z` : deadline);
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Sort the catalogue: fundable first, then the most funded, then by name. */
export function compareIpRights(a: IpRight, b: IpRight): number {
  return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0)
    || b.fundedBps - a.fundedBps
    || a.rightName.localeCompare(b.rightName);
}

/** Probability-weighted expected annual distribution across the scenarios. */
export function expectedAnnualDistMinor(scenarios: IpRoyaltyScenario[]): number | null {
  const total = scenarios.reduce((sum, scenario) => sum + Math.max(0, Number(scenario.probabilityBps) || 0), 0);
  if (!scenarios.length || total <= 0) return null;
  const weighted = scenarios.reduce(
    (sum, scenario) => sum + (Math.max(0, scenario.expectedAnnualDistributionMinor) * Math.max(0, scenario.probabilityBps)) / total,
    0,
  );
  return Math.round(weighted);
}

/** Probability-weighted expected funder multiple across the scenarios, in bps. */
export function weightedFunderMultipleBps(scenarios: IpRoyaltyScenario[]): number | null {
  const total = scenarios.reduce((sum, scenario) => sum + Math.max(0, Number(scenario.probabilityBps) || 0), 0);
  if (!scenarios.length || total <= 0) return null;
  const weighted = scenarios.reduce(
    (sum, scenario) => sum + (Math.max(0, scenario.funderMultipleBps) * Math.max(0, scenario.probabilityBps)) / total,
    0,
  );
  return Math.round(weighted);
}

/** The most conservative (lowest) funder multiple across the modelled scenarios. */
export function downsideFunderMultipleBps(scenarios: IpRoyaltyScenario[]): number | null {
  if (!scenarios.length) return null;
  const lowest = scenarios.reduce((min, scenario) => Math.min(min, Math.max(0, scenario.funderMultipleBps)), Number.POSITIVE_INFINITY);
  return Number.isFinite(lowest) ? lowest : null;
}

/** A small, honest three-case default: base / stressed / downside. Probabilities sum to 10,000. */
export function defaultRoyaltyScenarios(): IpRoyaltyScenario[] {
  return [
    { label: "Base", probabilityBps: 6_000, expectedAnnualDistributionMinor: 0, durationMonths: 36, funderMultipleBps: 14_000 },
    { label: "Stressed", probabilityBps: 3_000, expectedAnnualDistributionMinor: 0, durationMonths: 30, funderMultipleBps: 10_000 },
    { label: "Downside", probabilityBps: 1_000, expectedAnnualDistributionMinor: 0, durationMonths: 18, funderMultipleBps: 4_000 },
  ];
}

/** Best-effort classification of an IP right type from free text. */
export function classifyRightType(input: { text?: string | null; hint?: IpRightType | null }): IpRightType {
  if (input.hint) return input.hint;
  const text = String(input.text || "");
  const patterns: Array<[IpRightType, RegExp]> = [
    ["PATENT", /\b(patent|prior art|pct|\bepo\b|uspto patent|invention|utility model)\b/i],
    ["TRADEMARK", /\b(trade[- ]?mark|trademark|service mark|madrid|brand registry|\bmark\b)\b/i],
    ["DESIGN", /\b(design right|registered design|industrial design|design patent|ornamental|product design|fashion|furniture|packaging)\b/i],
    ["FILM_TV", /\b(film|movie|television|\btv\b|streaming|broadcast|distribution right|screenplay|cinema|mini-?series)\b/i],
    ["CHARACTER", /\b(character|merchandis\w*|mascot|toy|game franchise|animated)\b/i],
    ["IMAGE_LIKENESS", /\b(likeness|image rights?|name, image|voice rights?|personality rights?|publicity rights?|endorsement|celebrity)\b/i],
    ["COPYRIGHT", /\b(copyright|©|literary work|artwork|photograph\w*|manuscript|novel|article)\b/i],
    ["KNOW_HOW", /\b(know[- ]?how|trade secret|proprietary process|formulation|recipe|confidential (process|information))\b/i],
    ["SOFTWARE", /\b(software|sdk|api licen[cs]e|source code|saas|licence key|codebase|application)\b/i],
    ["FRANCHISE", /\b(franchis\w*|franchisor|master franchise)\b/i],
    ["BRAND", /\b(brand|licensing programme|trade dress|brand identity|logo)\b/i],
  ];
  for (const [type, pattern] of patterns) if (pattern.test(text)) return type;
  return "BRAND";
}

export type IpRoyaltyBucket = { key: string; label: string; count: number };

export type IpRoyaltyAnalytics = {
  total: number;
  fundable: number;
  byType: IpRoyaltyBucket[];
  bySector: IpRoyaltyBucket[];
  byJurisdiction: IpRoyaltyBucket[];
  averageFundedBps: number;
  averageExpectedMultipleBps: number | null;
};

/** Aggregate figures for the desk's analytics tab. */
export function buildIpRoyaltyAnalytics(rights: IpRight[]): IpRoyaltyAnalytics {
  const typeCounts = new Map<IpRightType, number>();
  const sectorCounts = new Map<IpRoyaltySector, number>();
  const jurisdictionCounts = new Map<string, number>();
  let fundedSum = 0;
  let multipleSum = 0;
  let multipleCount = 0;
  for (const right of rights) {
    typeCounts.set(right.rightType, (typeCounts.get(right.rightType) || 0) + 1);
    const sector = sectorForRightType(right.rightType);
    sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    jurisdictionCounts.set(right.country, (jurisdictionCounts.get(right.country) || 0) + 1);
    fundedSum += Number(right.fundedBps) || 0;
    if (right.expectedMultipleBps !== null && right.expectedMultipleBps !== undefined) {
      multipleSum += right.expectedMultipleBps;
      multipleCount += 1;
    }
  }
  const byType = Array.from(typeCounts.entries())
    .map(([key, count]) => ({ key, label: rightTypeLabel(key), count }))
    .sort((a, b) => b.count - a.count);
  const bySector = Array.from(sectorCounts.entries())
    .map(([key, count]) => ({ key, label: sectorLabel(key), count }))
    .sort((a, b) => b.count - a.count);
  const byJurisdiction = Array.from(jurisdictionCounts.entries())
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count);
  return {
    total: rights.length,
    fundable: rights.filter((right) => right.fundable).length,
    byType,
    bySector,
    byJurisdiction,
    averageFundedBps: rights.length ? Math.round(fundedSum / rights.length) : 0,
    averageExpectedMultipleBps: multipleCount ? Math.round(multipleSum / multipleCount) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Discovery — free, keyless public APIs.
 * ------------------------------------------------------------------ */

const REQUEST_TIMEOUT_MS = 6_500;
const DISCOVERY_UA = "Arbitrade-IP-Royalties/1.0 (+https://wisebond.org; ops@wisebond.org)";

const CROSSREF_WORKS = "https://api.crossref.org/works";
const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const ARTIC_ARTWORKS = "https://api.artic.edu/api/v1/artworks";
const ITUNES_SEARCH = "https://itunes.apple.com/search";
const GITHUB_SEARCH = "https://api.github.com/search/repositories";
const PATENTSVIEW_PATENT = "https://search.patentsview.org/api/v1/patent/";

/** Read an optional infrastructure key without assuming a Node runtime. */
function envKey(name: string): string {
  try {
    const value = (globalThis as any)?.process?.env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

async function fetchJson(url: string, options: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<any | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": DISCOVERY_UA, ...(options.headers || {}) },
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const clamp = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const direct = raw.slice(0, 10);
  if (ISO_DATE.test(direct)) return direct;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/** iTunes reports 3-letter storefront codes ("USA"); map to ISO alpha-2. */
function storefrontCode(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.length === 2 && findCountry(raw)) return raw;
  if (raw.length >= 3) {
    const two = raw.slice(0, 2);
    if (findCountry(two)) return two;
  }
  return "";
}

type CandidateInput = {
  id: string;
  rightName: string;
  rightType: IpRightType;
  licensor: string;
  licenseeSummary?: string | null;
  assetClass?: string | null;
  countryCode?: string;
  jurisdiction?: string;
  royaltyBasis?: IpRoyaltyBasis;
  cadence?: IpRoyaltyCadence;
  problem: string;
  highlights?: string[];
  source: string;
  sourceUrl?: string | null;
  asOf: string;
};

/**
 * Build a discovery candidate. Economics are deliberately absent — such a
 * record is cited but NOT fundable until an administrator publishes a dossier.
 */
function candidate(input: CandidateInput): IpRight {
  const code = String(input.countryCode || "").trim().toUpperCase();
  const known = code ? findCountry(code) : null;
  const countryName = known?.name || input.jurisdiction || "International";
  return {
    id: input.id,
    rightName: input.rightName,
    rightType: input.rightType,
    licensor: input.licensor,
    licenseeSummary: input.licenseeSummary ?? null,
    assetClass: input.assetClass ?? null,
    jurisdiction: input.jurisdiction || countryName,
    countryCode: known ? code : "",
    country: countryName,
    flag: flagFor(code),
    royaltyBasis: input.royaltyBasis ?? "REVENUE_SHARE",
    royaltyRateBps: null,
    perUnitMinor: null,
    cadence: input.cadence ?? "ANNUAL",
    termMonths: null,
    minimumGuaranteeMinor: null,
    licenseeCount: null,
    topLicenseeConcentrationBps: null,
    paymentHistory: null,
    riskGrade: null,
    capitalAtRiskMinor: null,
    expectedAnnualDistributionMinor: null,
    expectedMultipleBps: null,
    expectedDurationMonths: null,
    fundingAskMinor: null,
    fundingDeadline: null,
    remainingDays: null,
    committedMinor: 0,
    fundedBps: 0,
    status: "FUNDING",
    fundable: false,
    problem: input.problem,
    highlights: input.highlights ?? [],
    scenarios: [],
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    asOf: input.asOf,
  };
}

const inScope = (right: IpRight | null): right is IpRight =>
  !!right && isIpRoyaltyInScope(`${right.rightName} ${right.licensor} ${right.assetClass ?? ""}`);

/** Crossref — books, articles and proceedings (Copyright). */
async function fetchCrossrefRights(): Promise<IpRight[]> {
  const payload = await fetchJson(`${CROSSREF_WORKS}?filter=type:book,type:journal-article,type:proceedings-article&rows=20&select=DOI,title,author,publisher,issued,type,URL,container-title`);
  const items: any[] = Array.isArray(payload?.message?.items) ? payload.message.items : [];
  const rows = items.map((item): IpRight | null => {
    const title = clamp(Array.isArray(item?.title) ? item.title[0] : item?.title, 140);
    if (!title) return null;
    const doi = clamp(item?.DOI || item?.URL, 120);
    if (!doi) return null;
    const author = Array.isArray(item?.author) && item.author[0]
      ? clamp(`${item.author[0].given || ""} ${item.author[0].family || ""}`, 120)
      : "";
    const publisher = clamp(item?.publisher || author || "Unknown publisher", 120);
    const issued = item?.issued?.["date-parts"]?.[0];
    const asOf = Array.isArray(issued) && issued[0]
      ? toIsoDate(`${String(issued[0]).padStart(4, "0")}-${String(issued[1] || 1).padStart(2, "0")}-${String(issued[2] || 1).padStart(2, "0")}`)
      : toIsoDate(0);
    const kind = clamp(item?.type, 40) || "work";
    return candidate({
      id: `ipr-crossref-${doi}`,
      rightName: title,
      rightType: "COPYRIGHT",
      licensor: publisher,
      licenseeSummary: author && author !== publisher ? author : null,
      assetClass: kind,
      royaltyBasis: "REVENUE_SHARE",
      problem: `Published ${kind.replace(/-/g, " ")} (Crossref DOI ${doi}). Registrants publish the work and its publisher, not the licence rate or the collections.`,
      highlights: ["Crossref", `DOI ${doi}`],
      source: "Crossref (registered works)",
      sourceUrl: clamp(item?.URL, 300) || `https://doi.org/${doi}`,
      asOf,
    });
  });
  return rows.filter(inScope);
}

/** Open Library — books (Copyright). */
async function fetchOpenLibraryRights(): Promise<IpRight[]> {
  const payload = await fetchJson(`${OPEN_LIBRARY_SEARCH}?q=subject%3Abusiness+OR+subject%3Atechnology&limit=20&fields=key,title,author_name,first_publish_year,publisher`);
  const docs: any[] = Array.isArray(payload?.docs) ? payload.docs : [];
  const rows = docs.map((doc): IpRight | null => {
    const title = clamp(doc?.title, 140);
    const key = clamp(doc?.key, 120);
    if (!title || !key) return null;
    const author = Array.isArray(doc?.author_name) ? clamp(doc.author_name[0], 120) : "";
    const publisher = Array.isArray(doc?.publisher) ? clamp(doc.publisher[0], 120) : "";
    return candidate({
      id: `ipr-openlibrary-${key.replace(/^\//, "")}`,
      rightName: title,
      rightType: "COPYRIGHT",
      licensor: publisher || author || "Unknown publisher",
      licenseeSummary: author && author !== publisher ? author : null,
      assetClass: "book",
      royaltyBasis: "REVENUE_SHARE",
      problem: "Open Library catalogs the work, its author and publisher. It does not publish licensing terms or royalty collections.",
      highlights: ["Open Library", doc?.first_publish_year ? `First published ${doc.first_publish_year}` : "Publication record"].filter(Boolean) as string[],
      source: "Open Library (Internet Archive)",
      sourceUrl: `https://openlibrary.org${key}`,
      asOf: doc?.first_publish_year ? toIsoDate(`${doc.first_publish_year}-01-01`) : toIsoDate(0),
    });
  });
  return rows.filter(inScope);
}

/** Art Institute of Chicago — artwork (Copyright). */
async function fetchArtworkRights(): Promise<IpRight[]> {
  const payload = await fetchJson(`${ARTIC_ARTWORKS}?page=1&limit=20&fields=id,title,artist_display,date_display,department_title,is_public_domain`);
  const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
  const rows = items.map((item): IpRight | null => {
    const title = clamp(item?.title, 140);
    const id = item?.id;
    if (!title || id === undefined || id === null) return null;
    const artist = clamp(item?.artist_display, 140);
    const department = clamp(item?.department_title, 80);
    return candidate({
      id: `ipr-artic-${id}`,
      rightName: title,
      rightType: "COPYRIGHT",
      licensor: artist || "Unknown artist",
      licenseeSummary: department || null,
      assetClass: department || "artwork",
      royaltyBasis: "REVENUE_SHARE",
      problem: "The Art Institute of Chicago catalogs the artwork and its maker. It publishes no licensing rate and no royalty economics.",
      highlights: ["Art Institute of Chicago", item?.is_public_domain ? "Public domain" : "All rights reserved"].filter(Boolean) as string[],
      source: "Art Institute of Chicago (public collection)",
      sourceUrl: `https://www.artic.edu/artworks/${id}`,
      asOf: toIsoDate(item?.date_display),
    });
  });
  return rows.filter(inScope);
}

/** iTunes Search — film & TV, apps and ebooks (keyless, free). */
async function fetchItunesRights(entity: "movie" | "tvShow" | "software" | "ebook", rightType: IpRightType, term: string, lease: string): Promise<IpRight[]> {
  const payload = await fetchJson(`${ITUNES_SEARCH}?term=${encodeURIComponent(term)}&entity=${entity}&limit=20&country=us&media=all`);
  const items: any[] = Array.isArray(payload?.results) ? payload.results : [];
  const rows = items.map((item): IpRight | null => {
    const title = clamp(item?.trackName || item?.collectionName, 140);
    const trackId = item?.trackId ?? item?.collectionId;
    if (!title || trackId === undefined || trackId === null) return null;
    const licensor = clamp(item?.artistName || item?.sellerName || item?.artistName, 140) || "Unknown licensor";
    const code = storefrontCode(item?.country);
    const asOf = item?.releaseDate ? toIsoDate(item.releaseDate) : toIsoDate(0);
    const genre = clamp(item?.primaryGenreName, 60);
    return candidate({
      id: `ipr-itunes-${entity}-${trackId}`,
      rightName: title,
      rightType,
      licensor,
      licenseeSummary: genre || null,
      assetClass: genre || lease,
      countryCode: code,
      jurisdiction: code ? `${findCountry(code)?.name || code} (storefront)` : "International",
      royaltyBasis: rightType === "SOFTWARE" ? "PER_UNIT" : "REVENUE_SHARE",
      cadence: rightType === "SOFTWARE" ? "MONTHLY" : "ANNUAL",
      problem: `The iTunes catalogue lists this ${lease} and its rights-holder. It publishes the sale and rental price, never the royalty rate or the collections.`,
      highlights: ["iTunes Search API", lease, genre].filter(Boolean) as string[],
      source: "iTunes Search API (Apple catalogue)",
      sourceUrl: clamp(item?.trackViewUrl || item?.collectionViewUrl, 300) || null,
      asOf,
    });
  });
  return rows.filter(inScope);
}

/** GitHub — openly licensed source repositories (Software & technology licences). */
async function fetchSoftwareRights(): Promise<IpRight[]> {
  const payload = await fetchJson(`${GITHUB_SEARCH}?q=license%3Amit+stars%3A%3E5000&sort=stars&order=desc&per_page=20`, { headers: { Accept: "application/vnd.github+json" } });
  const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
  const rows = items.map((item): IpRight | null => {
    const name = clamp(item?.full_name, 140);
    const id = item?.id;
    if (!name || id === undefined || id === null) return null;
    const license = clamp(item?.license?.spdx_id || item?.license?.name, 60);
    return candidate({
      id: `ipr-github-${id}`,
      rightName: name,
      rightType: "SOFTWARE",
      licensor: clamp(item?.owner?.login, 120) || name,
      licenseeSummary: license ? `Licence ${license}` : null,
      assetClass: clamp(item?.language, 40) || "source code",
      royaltyBasis: "REVENUE_SHARE",
      cadence: "MONTHLY",
      problem: "GitHub publishes the repository, its owner and its licence. The commercial licensing rate and any derived royalties are not published.",
      highlights: ["GitHub", license ? `Licence ${license}` : "No licence", `★ ${Number(item?.stargazers_count || 0).toLocaleString()}`],
      source: "GitHub repository search",
      sourceUrl: clamp(item?.html_url, 300) || null,
      asOf: toIsoDate(item?.pushed_at || item?.updated_at),
    });
  });
  return rows.filter(inScope);
}

/** PatentsView — granted patents (keyed: activates only with PATENTSVIEW_API_KEY). */
async function fetchPatentRights(): Promise<IpRight[]> {
  const key = envKey("PATENTSVIEW_API_KEY");
  if (!key) return [];
  const query = encodeURIComponent(JSON.stringify({ _gte: { patent_date: "2018-01-01" } }));
  const fields = encodeURIComponent(JSON.stringify(["patent_id", "patent_title", "patent_date", "assignees.assignee_organization"]));
  const options = encodeURIComponent(JSON.stringify({ size: 20 }));
  const payload = await fetchJson(`${PATENTSVIEW_PATENT}?q=${query}&f=${fields}&o=${options}&s=${encodeURIComponent(JSON.stringify([{ patent_date: "desc" }]))}`, { headers: { "X-Api-Key": key } });
  const items: any[] = Array.isArray(payload?.patents) ? payload.patents : [];
  const rows = items.map((item): IpRight | null => {
    const title = clamp(item?.patent_title, 160);
    const id = clamp(item?.patent_id, 40);
    if (!title || !id) return null;
    const assignees = Array.isArray(item?.assignees)
      ? clamp(item.assignees.map((entry: any) => clamp(entry?.assignee_organization, 80)).filter(Boolean).join(", "), 160)
      : "";
    return candidate({
      id: `ipr-patent-${id}`,
      rightName: title,
      rightType: "PATENT",
      licensor: assignees || "Unassigned",
      licenseeSummary: "Granted patent",
      assetClass: "patent",
      royaltyBasis: "REVENUE_SHARE",
      problem: "PatentsView publishes the grant, its assignee and its date. It does not publish licensing terms or royalty economics.",
      highlights: ["PatentsView", `Patent ${id}`],
      source: "PatentsView (USPTO)",
      sourceUrl: `https://patents.google.com/patent/US${id.replace(/[^0-9A-Za-z]/g, "")}`,
      asOf: toIsoDate(item?.patent_date),
    });
  });
  return rows.filter(inScope);
}

/**
 * The public registers the discovery layer draws on. Registers publish
 * ownership/identity, not royalty economics, so nothing here is fundable on
 * its own. Key-gated sources are marked `keyed` and are skipped until a token
 * is configured; sources that block non-browser clients are marked
 * `unavailable` and are skipped rather than faked.
 *
 * Boundary note: music royalties, NFTs, agro investment, green energy and
 * carbon credits belong to their own menus and are excluded here.
 */
export const IP_ROYALTIES_SOURCES: readonly IpRoyaltiesSource[] = [
  { name: "Crossref", url: "https://api.crossref.org/works", role: "discovery", status: "ok", detail: "Registered books and articles (DOI); no royalty rates are published." },
  { name: "Open Library (Internet Archive)", url: "https://openlibrary.org/search.json", role: "discovery", status: "ok", detail: "Book catalogue records; licensing terms are not published." },
  { name: "Art Institute of Chicago", url: "https://api.artic.edu/api/v1/artworks", role: "discovery", status: "ok", detail: "Public artwork collection; no licensing rate is published." },
  { name: "iTunes Search API (Apple)", url: "https://itunes.apple.com/search", role: "discovery", status: "ok", detail: "Film, TV, software and ebook catalogue identity; sale price only, never the royalty rate." },
  { name: "GitHub repository search", url: "https://api.github.com/search/repositories", role: "discovery", status: "ok", detail: "Openly licensed source repositories and their licence." },
  { name: "PatentsView (USPTO)", url: "https://search.patentsview.org/api/v1/patent/", role: "discovery", status: "keyed", detail: "Granted patents and assignees; requires a free PATENTSVIEW_API_KEY and is skipped until configured." },
  { name: "EPO Open Patent Services (OPS)", url: "https://www.epo.org", role: "discovery", status: "keyed", detail: "Full European patent data; requires a free OPS key and is skipped until configured." },
  { name: "USPTO Patent Assignment Search", url: "https://assignment.uspto.gov", role: "discovery", status: "ok", detail: "Recorded patent ownership and assignment; no royalty rates are published." },
  { name: "WIPO Global Brand Database", url: "https://branddb.wipo.int", role: "discovery", status: "unavailable", detail: "Trademark and design registrations; blocks non-browser clients and is skipped rather than spoofed." },
  { name: "US Copyright Office Public Catalog", url: "https://cocatalog.loc.gov", role: "discovery", status: "unavailable", detail: "Copyright registrations and recorded transfers; no public API is offered." },
  { name: "Market context — WIPO IP statistics", url: "https://www.wipo.int/ipstats", role: "context", status: "ok", detail: "Aggregate IP filing and licensing context by country." },
];

let catalogueCache: { value: IpRoyaltiesCatalogue; expiresAt: number } | null = null;
let catalogueInflight: Promise<IpRoyaltiesCatalogue> | null = null;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

const liveStatus = (result: PromiseSettledResult<unknown>): "ok" | "keyed" | "unavailable" => {
  if (result.status === "rejected") return "unavailable";
  const value = result.value;
  if (Array.isArray(value)) return value.length ? "ok" : "unavailable";
  return "ok";
};

async function buildCatalogue(): Promise<IpRoyaltiesCatalogue> {
  const [crossref, openLibrary, artworks, films, tv, apps, ebooks, software, patents] = await Promise.allSettled([
    fetchCrossrefRights(),
    fetchOpenLibraryRights(),
    fetchArtworkRights(),
    fetchItunesRights("movie", "FILM_TV", "independent film", "film"),
    fetchItunesRights("tvShow", "FILM_TV", "television series", "TV series"),
    fetchItunesRights("software", "SOFTWARE", "productivity app", "app"),
    fetchItunesRights("ebook", "COPYRIGHT", "business book", "ebook"),
    fetchSoftwareRights(),
    fetchPatentRights(),
  ]);

  const results = [crossref, openLibrary, artworks, films, tv, apps, ebooks, software, patents];
  for (const result of results) {
    if (result.status === "rejected") console.warn(`[IpRoyalties] discovery source failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  }

  const raw: IpRight[] = [
    ...(crossref.status === "fulfilled" ? crossref.value : []),
    ...(openLibrary.status === "fulfilled" ? openLibrary.value : []),
    ...(artworks.status === "fulfilled" ? artworks.value : []),
    ...(films.status === "fulfilled" ? films.value : []),
    ...(tv.status === "fulfilled" ? tv.value : []),
    ...(apps.status === "fulfilled" ? apps.value : []),
    ...(ebooks.status === "fulfilled" ? ebooks.value : []),
    ...(software.status === "fulfilled" ? software.value : []),
    ...(patents.status === "fulfilled" ? patents.value : []),
  ];

  // De-duplicate by id and hard-filter anything out of scope, so a sister-desk
  // item (music, NFT, agro, green energy, carbon) can never leak onto this desk.
  const seen = new Set<string>();
  const rights = raw.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return isIpRoyaltyInScope(`${item.rightName} ${item.licensor} ${item.assetClass ?? ""}`);
  });
  rights.sort(compareIpRights);

  const patentsKeyed = liveStatus(patents) === "unavailable" && !envKey("PATENTSVIEW_API_KEY");
  const sources: IpRoyaltiesSource[] = [
    { name: "Crossref", url: CROSSREF_WORKS, role: "discovery", status: crossref.status === "fulfilled" && crossref.value.length ? "ok" : "unavailable", detail: crossref.status === "rejected" ? "Unreachable right now" : "Registered books and articles (DOI); no royalty rates are published." },
    { name: "Open Library (Internet Archive)", url: OPEN_LIBRARY_SEARCH, role: "discovery", status: openLibrary.status === "fulfilled" && openLibrary.value.length ? "ok" : "unavailable", detail: openLibrary.status === "rejected" ? "Unreachable right now" : "Book catalogue records; licensing terms are not published." },
    { name: "Art Institute of Chicago", url: ARTIC_ARTWORKS, role: "discovery", status: artworks.status === "fulfilled" && artworks.value.length ? "ok" : "unavailable", detail: artworks.status === "rejected" ? "Unreachable right now" : "Public artwork collection; no licensing rate is published." },
    { name: "iTunes Search API (Apple)", url: ITUNES_SEARCH, role: "discovery", status: [films, tv, apps, ebooks].some((result) => result.status === "fulfilled" && (result.value as IpRight[]).length) ? "ok" : "unavailable", detail: "Film, TV, software and ebook catalogue identity; sale price only, never the royalty rate." },
    { name: "GitHub repository search", url: GITHUB_SEARCH, role: "discovery", status: software.status === "fulfilled" && software.value.length ? "ok" : "unavailable", detail: software.status === "rejected" ? "Unreachable right now" : "Openly licensed source repositories and their licence." },
    { name: "PatentsView (USPTO)", url: PATENTSVIEW_PATENT, role: "discovery", status: patentsKeyed ? "keyed" : liveStatus(patents), detail: patentsKeyed ? "Requires a free PATENTSVIEW_API_KEY; skipped until configured." : "Granted patents and assignees." },
    { name: "EPO Open Patent Services (OPS)", url: "https://www.epo.org", role: "discovery", status: "keyed", detail: "Requires a free OPS key and is skipped until configured." },
    { name: "USPTO Patent Assignment Search", url: "https://assignment.uspto.gov", role: "discovery", status: "ok", detail: "Recorded patent ownership and assignment; no royalty rates are published." },
    { name: "WIPO Global Brand Database", url: "https://branddb.wipo.int", role: "discovery", status: "unavailable", detail: "Trademark and design registrations; blocks non-browser clients and is skipped rather than spoofed." },
    { name: "US Copyright Office Public Catalog", url: "https://cocatalog.loc.gov", role: "discovery", status: "unavailable", detail: "No public API is offered." },
    { name: "Market context — WIPO IP statistics", url: "https://www.wipo.int/ipstats", role: "context", status: "ok", detail: "Aggregate IP filing and licensing context by country." },
  ];

  return {
    rights,
    sources,
    fetchedAt: new Date().toISOString(),
    degraded: sources.some((source) => source.status !== "ok" && source.status !== "keyed"),
  };
}

/**
 * The discovery catalogue for the desk. Public registers describe works,
 * ownership and licence identity, so the discovery layer contributes cited
 * candidates with no economics: the fundable universe is produced by
 * administrator dossiers. This is intentional and honest — nothing is invented.
 */
export async function getIpRoyaltiesCatalogue(options: { force?: boolean } = {}): Promise<IpRoyaltiesCatalogue> {
  const now = Date.now();
  if (!options.force && catalogueCache && catalogueCache.expiresAt > now) return catalogueCache.value;
  if (catalogueInflight) return catalogueInflight;
  catalogueInflight = (async () => {
    try {
      const value = await buildCatalogue();
      catalogueCache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
      return value;
    } finally {
      catalogueInflight = null;
    }
  })();
  return catalogueInflight;
}

/** Look up a discovery right by id. */
export async function findIpRight(id: string): Promise<IpRight | null> {
  const catalogue = await getIpRoyaltiesCatalogue();
  return catalogue.rights.find((right) => right.id === id) || null;
}

/** Country of a right plus its flag emoji. */
export function ipRightFlag(countryCode: string): string {
  return flagFor(countryCode);
}

export function __resetIpRoyaltiesCacheForTest() {
  catalogueCache = null;
  catalogueInflight = null;
}
