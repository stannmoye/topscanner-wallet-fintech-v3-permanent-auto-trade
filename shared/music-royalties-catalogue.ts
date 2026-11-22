/**
 * Music Royalties desk — the music-only catalogue of investable opportunities.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server and, as a resilience fallback, in the customer's
 * browser. It defines the MUSIC-ONLY taxonomy (shows & concerts, tours,
 * festivals, new artists, new albums, endorsement deals, brand labels, master
 * rights, publishing catalogues, sync licensing, merchandise, music videos,
 * catalogue acquisitions and royalty streams), the shared classifiers, the
 * desk analytics and a small, honest DISCOVERY layer.
 *
 * The desk is strictly about music. Unlike the litigation desk there is no free,
 * keyless public register that publishes *investable* music opportunities, so
 * the real, fundable instruments are published by an administrator in the
 * DOSSIER layer (server/musicRoyaltyDossiers.ts). The discovery layer here only
 * surfaces cited public catalogue references (from the keyless Apple iTunes
 * Search API) as un-priced candidates so the desk is never empty; it never
 * invents funding economics.
 *
 * Nothing here is invented: public sources publish no royalty economics, an
 * expected multiple, a funding target or an investor revenue share, so those
 * fields stay null on discovery records and read "not modelled" until an
 * administrator publishes a sourced dossier.
 */

import { flagFor } from "./country-options";

/** The kinds of music opportunity the desk can carry. At least twelve, per the desk brief. */
export type MusicInvestmentType =
  | "SHOW_CONCERT"
  | "FESTIVAL"
  | "TOUR"
  | "NEW_ARTIST"
  | "NEW_ALBUM"
  | "ENDORSEMENT_DEAL"
  | "BRAND_LABEL"
  | "MASTER_RIGHTS"
  | "PUBLISHING_CATALOGUE"
  | "SYNC_LICENSING"
  | "MERCHANDISE"
  | "MUSIC_VIDEO"
  | "CATALOGUE_ACQUISITION"
  | "ROYALTY_STREAM";

/** Where an opportunity is in its music lifecycle. */
export type MusicStage =
  | "ANNOUNCED"
  | "FUNDING"
  | "IN_PRODUCTION"
  | "RELEASED"
  | "TOURING"
  | "PAYING"
  | "CLOSED";

export type MusicDossierStatus =
  | "FUNDING"
  | "ESCROW"
  | "IN_PRODUCTION"
  | "ACTIVE"
  | "PAYING"
  | "COMPLETED"
  | "WITHDRAWN";

export type MusicRiskGrade = "PRIME" | "BALANCED" | "SPECULATIVE" | "HIGH_RISK";

/** How a music instrument resolves for its funders. */
export type MusicOutcome = "HIT" | "RECOUP" | "WRITE_OFF";

export type MusicGenre =
  | "POP"
  | "HIP_HOP"
  | "ROCK"
  | "ELECTRONIC"
  | "R_AND_B"
  | "COUNTRY"
  | "JAZZ"
  | "CLASSICAL"
  | "LATIN"
  | "AFROBEATS"
  | "GOSPEL"
  | "INDIE"
  | "OTHER";

export type MusicValueBand = "UNDER_100K" | "100K_1M" | "1M_10M" | "OVER_10M";

export type MusicTerritoryBand = "LOCAL" | "REGIONAL" | "NATIONAL" | "GLOBAL";

/** One modelled outcome for a published instrument. Probabilities across the three sum to 10,000 bps. */
export type MusicScenario = {
  outcome: MusicOutcome;
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

export type MusicMilestone = {
  stage: MusicStage;
  label: string;
  /** Share of escrow released at this milestone, in basis points. */
  releaseBps: number;
  status: "PENDING" | "REACHED";
  reachedAt: string | null;
};

/**
 * One music opportunity. Discovery ids are source-prefixed (`itunes-…`); an
 * administrator-published dossier id starts with `admin-music-`.
 */
export type MusicOpportunity = {
  id: string;
  /** Project / act / event name. */
  title: string;
  /** The artist, act, promoter or rights holder. */
  artist: string;
  musicType: MusicInvestmentType;
  genre: MusicGenre;
  /** Human-readable territory label, e.g. "North America" or "Worldwide". */
  territory: string;
  territoryBand: MusicTerritoryBand;
  countryCode: string;
  country: string;
  flag: string;
  /** Record / brand label tied to the opportunity, when published. */
  label: string | null;
  /** Plain-language description of the opportunity. */
  description: string;
  /** How a funder participates (e.g. "Revenue share", "Equity", "Recoupable advance"). */
  dealType: string | null;
  stage: MusicStage;
  status: MusicDossierStatus;
  riskGrade: MusicRiskGrade | null;
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
  /** Show date, tour window start, or release date (YYYY-MM-DD), when published. */
  eventDate: string | null;
  fundingDeadline: string | null;
  remainingDays: number | null;
  /** Three outcome scenarios. Empty on discovery records. */
  scenarios: MusicScenario[];
  /** Probability-weighted expected value in minor units, or null when unmodelled. */
  expectedValueMinor: number | null;
  milestones: MusicMilestone[];
  highlights: string[];
  source: string;
  sourceUrl: string | null;
  asOf: string;
  /** True only for records an administrator has reviewed and published. */
  verified: boolean;
  /** True only when an administrator has published scenarios and a funding target. */
  fundable: boolean;
};

export type MusicRoyaltiesSource = {
  name: string;
  url: string;
  /** ISO-3166 alpha-2 the source primarily covers, or "XX" for global. */
  country: string;
  role: "opportunities" | "catalogue" | "context";
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type MusicRoyaltiesCatalogue = {
  opportunities: MusicOpportunity[];
  sources: MusicRoyaltiesSource[];
  fetchedAt: string;
  degraded: boolean;
};

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

const ITUNES_SEARCH = "https://itunes.apple.com/search";
const DISCOVERY_TERMS = ["new music releases", "top albums"];

/* ------------------------------------------------------------------ *
 * Taxonomy — at least twelve music-only investment types
 * ------------------------------------------------------------------ */

export const MUSIC_INVESTMENT_TYPES: readonly MusicInvestmentType[] = [
  "SHOW_CONCERT",
  "FESTIVAL",
  "TOUR",
  "NEW_ARTIST",
  "NEW_ALBUM",
  "ENDORSEMENT_DEAL",
  "BRAND_LABEL",
  "MASTER_RIGHTS",
  "PUBLISHING_CATALOGUE",
  "SYNC_LICENSING",
  "MERCHANDISE",
  "MUSIC_VIDEO",
  "CATALOGUE_ACQUISITION",
  "ROYALTY_STREAM",
];

const MUSIC_TYPE_LABELS: Record<MusicInvestmentType, string> = {
  SHOW_CONCERT: "Show / Concert",
  FESTIVAL: "Festival",
  TOUR: "Tour",
  NEW_ARTIST: "New Artist",
  NEW_ALBUM: "New Album",
  ENDORSEMENT_DEAL: "Endorsement Deal",
  BRAND_LABEL: "Brand / Label",
  MASTER_RIGHTS: "Master Rights",
  PUBLISHING_CATALOGUE: "Publishing Catalogue",
  SYNC_LICENSING: "Sync Licensing",
  MERCHANDISE: "Merchandise",
  MUSIC_VIDEO: "Music Video",
  CATALOGUE_ACQUISITION: "Catalogue Acquisition",
  ROYALTY_STREAM: "Royalty Stream",
};

export function musicTypeLabel(value: MusicInvestmentType): string {
  return MUSIC_TYPE_LABELS[value] ?? "Music opportunity";
}

/** Optional short blurb for each type, used by the customer desk and the admin picker. */
const MUSIC_TYPE_BLURBS: Record<MusicInvestmentType, string> = {
  SHOW_CONCERT: "A single live show or concert with ticketing and event revenue.",
  FESTIVAL: "A multi-act festival with ticketing, sponsorship and concession revenue.",
  TOUR: "A multi-date tour with box-office, sponsorship and merchandise revenue.",
  NEW_ARTIST: "An unsigned or breakthrough artist seeking development capital.",
  NEW_ALBUM: "A record in production seeking recoupable production and marketing capital.",
  ENDORSEMENT_DEAL: "A brand endorsement or partnership tied to an artist's reach.",
  BRAND_LABEL: "A record or music brand label raising growth capital.",
  MASTER_RIGHTS: "A stake in master recording royalties on a defined catalogue.",
  PUBLISHING_CATALOGUE: "A stake in songwriting and publishing royalties.",
  SYNC_LICENSING: "Placement rights for film, television, games and advertising.",
  MERCHANDISE: "An artist merchandise line and its sell-through royalties.",
  MUSIC_VIDEO: "A music-video production funded against its release revenue.",
  CATALOGUE_ACQUISITION: "Acquiring an existing music catalogue for its income stream.",
  ROYALTY_STREAM: "An advance against an already-earning royalty stream.",
};

export function musicTypeBlurb(value: MusicInvestmentType): string {
  return MUSIC_TYPE_BLURBS[value] ?? "";
}

/** Grouped presentation of the music types, for the admin picker and customer filters. */
export const MUSIC_TYPE_GROUPS: { label: string; detail: string; types: MusicInvestmentType[] }[] = [
  { label: "Live & Events", detail: "Shows, concerts, festivals and tours", types: ["SHOW_CONCERT", "FESTIVAL", "TOUR"] },
  { label: "Artists & Releases", detail: "New artists, records and videos", types: ["NEW_ARTIST", "NEW_ALBUM", "MUSIC_VIDEO"] },
  { label: "Rights & Catalogue", detail: "Masters, publishing and catalogue assets", types: ["MASTER_RIGHTS", "PUBLISHING_CATALOGUE", "CATALOGUE_ACQUISITION", "ROYALTY_STREAM"] },
  { label: "Brands & Commercial", detail: "Endorsements, labels, sync and merchandise", types: ["ENDORSEMENT_DEAL", "BRAND_LABEL", "SYNC_LICENSING", "MERCHANDISE"] },
];

export const MUSIC_GENRES: readonly MusicGenre[] = [
  "POP", "HIP_HOP", "ROCK", "ELECTRONIC", "R_AND_B", "COUNTRY", "JAZZ",
  "CLASSICAL", "LATIN", "AFROBEATS", "GOSPEL", "INDIE", "OTHER",
];

const GENRE_LABELS: Record<MusicGenre, string> = {
  POP: "Pop", HIP_HOP: "Hip-hop", ROCK: "Rock", ELECTRONIC: "Electronic", R_AND_B: "R&B",
  COUNTRY: "Country", JAZZ: "Jazz", CLASSICAL: "Classical", LATIN: "Latin",
  AFROBEATS: "Afrobeats", GOSPEL: "Gospel", INDIE: "Indie", OTHER: "Other",
};

export function genreLabel(value: MusicGenre): string {
  return GENRE_LABELS[value] ?? GENRE_LABELS.OTHER;
}

export const MUSIC_STAGES: readonly MusicStage[] = [
  "ANNOUNCED", "FUNDING", "IN_PRODUCTION", "RELEASED", "TOURING", "PAYING", "CLOSED",
];

const STAGE_LABELS: Record<MusicStage, string> = {
  ANNOUNCED: "Announced", FUNDING: "Funding", IN_PRODUCTION: "In production",
  RELEASED: "Released", TOURING: "Touring", PAYING: "Paying", CLOSED: "Closed",
};

export function stageLabel(stage: MusicStage): string {
  return STAGE_LABELS[stage] ?? "Announced";
}

export const MUSIC_DOSSIER_STATUSES: readonly MusicDossierStatus[] = [
  "FUNDING", "ESCROW", "IN_PRODUCTION", "ACTIVE", "PAYING", "COMPLETED", "WITHDRAWN",
];

const STATUS_LABELS: Record<MusicDossierStatus, string> = {
  FUNDING: "Funding", ESCROW: "In escrow", IN_PRODUCTION: "In production",
  ACTIVE: "Active", PAYING: "Paying", COMPLETED: "Completed", WITHDRAWN: "Withdrawn",
};

export function statusLabel(status: MusicDossierStatus): string {
  return STATUS_LABELS[status] ?? "Funding";
}

export const MUSIC_RISK_GRADES: readonly MusicRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];

const RISK_LABELS: Record<MusicRiskGrade, string> = {
  PRIME: "Prime", BALANCED: "Balanced", SPECULATIVE: "Speculative", HIGH_RISK: "High risk",
};

export function riskGradeLabel(value: MusicRiskGrade): string {
  return RISK_LABELS[value] ?? "Balanced";
}

export const MUSIC_OUTCOMES: readonly MusicOutcome[] = ["HIT", "RECOUP", "WRITE_OFF"];

const OUTCOME_LABELS: Record<MusicOutcome, string> = {
  HIT: "Breakout hit", RECOUP: "Recoup", WRITE_OFF: "Write-off",
};

export function outcomeLabel(value: MusicOutcome): string {
  return OUTCOME_LABELS[value] ?? "Recoup";
}

export const MUSIC_TERRITORY_BANDS: readonly MusicTerritoryBand[] = ["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"];

const TERRITORY_BAND_LABELS: Record<MusicTerritoryBand, string> = {
  LOCAL: "Local", REGIONAL: "Regional", NATIONAL: "National", GLOBAL: "Global",
};

export function territoryBandLabel(value: MusicTerritoryBand): string {
  return TERRITORY_BAND_LABELS[value] ?? "Regional";
}

export const MUSIC_VALUE_BANDS: readonly MusicValueBand[] = ["UNDER_100K", "100K_1M", "1M_10M", "OVER_10M"];

const VALUE_BAND_LABELS: Record<MusicValueBand, string> = {
  UNDER_100K: "Under 100K", "100K_1M": "100K – 1M", "1M_10M": "1M – 10M", OVER_10M: "Over 10M",
};

export function valueBandLabel(value: MusicValueBand): string {
  return VALUE_BAND_LABELS[value] ?? "";
}

/**
 * Best-effort classification of a music opportunity from its heading text.
 * Priority-ordered: the first pattern that matches wins. Strictly music.
 */
const TYPE_PATTERNS: [MusicInvestmentType, RegExp][] = [
  ["FESTIVAL", /\b(festival|fest\b|coachella|glastonbury|line-?up)\b/i],
  ["TOUR", /\b(world tour|tour|on the road|residency|concert series)\b/i],
  ["SHOW_CONCERT", /\b(concert|live show|gig|show at|arena show|stadium show)\b/i],
  ["ENDORSEMENT_DEAL", /\b(endorsement|brand deal|ambassador|partnership|sponsorship deal)\b/i],
  ["SYNC_LICENSING", /\b(sync|licensing for film|placement|soundtrack|trailer|advert placement)\b/i],
  ["MERCHANDISE", /\b(merch|merchandise|apparel|tour merch)\b/i],
  ["MUSIC_VIDEO", /\b(music video|visualizer|video production)\b/i],
  ["MASTER_RIGHTS", /\b(masters?|master recording|master rights|sound recording)\b/i],
  ["PUBLISHING_CATALOGUE", /\b(publishing|catalog?ue of songs|songwriting|composition rights)\b/i],
  ["CATALOGUE_ACQUISITION", /\b(acqui(re|sition)|buy ?out|purchase of catalog?ue|rights acquisition)\b/i],
  ["ROYALTY_STREAM", /\b(royalt(y|ies)|income stream|revenue stream|advance)\b/i],
  ["BRAND_LABEL", /\b(record label|brand label|imprint|label group)\b/i],
  ["NEW_ARTIST", /\b(new artist|emerging artist|unsigned|breakthrough artist|debut artist)\b/i],
  ["NEW_ALBUM", /\b(album|record|ep\b|lp\b|mixtape|release)\b/i],
];

export function classifyMusicType(input: { title?: string | null; description?: string | null; hint?: MusicInvestmentType | null }): MusicInvestmentType {
  if (input.hint && (MUSIC_INVESTMENT_TYPES as readonly string[]).includes(input.hint)) return input.hint;
  const haystack = `${input.title || ""} ${input.description || ""}`;
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(haystack)) return type;
  return "NEW_ALBUM";
}

/** Coarse value band from a minor-unit amount, only set when an amount is known. */
export function musicValueBandFromMinor(minor: number | null | undefined): MusicValueBand | null {
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
export function expectedValueMinor(scenarios: MusicScenario[]): number | null {
  if (!scenarios.length) return null;
  return scenarios.reduce((sum, scenario) => sum + Math.round((scenario.grossRevenueMinor * scenario.probabilityBps) / 10_000), 0);
}

const RISK_ORDER: Record<MusicRiskGrade, number> = { PRIME: 0, BALANCED: 1, SPECULATIVE: 2, HIGH_RISK: 3 };
const STATUS_ORDER: Record<MusicDossierStatus, number> = {
  FUNDING: 0, ESCROW: 1, IN_PRODUCTION: 2, ACTIVE: 3, PAYING: 4, COMPLETED: 5, WITHDRAWN: 6,
};

/** Fundable opportunities first, then lifecycle status, risk grade, funding progress, recency. */
export function compareMusicOpportunities(a: MusicOpportunity, b: MusicOpportunity): number {
  if (a.fundable !== b.fundable) return a.fundable ? -1 : 1;
  const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (status !== 0) return status;
  const risk = (a.riskGrade ? RISK_ORDER[a.riskGrade] : 9) - (b.riskGrade ? RISK_ORDER[b.riskGrade] : 9);
  if (risk !== 0) return risk;
  if (a.fundedBps !== b.fundedBps) return b.fundedBps - a.fundedBps;
  if (a.asOf !== b.asOf) return b.asOf.localeCompare(a.asOf);
  return a.title.localeCompare(b.title);
}

const DEFAULT_MUSIC_MILESTONES: MusicMilestone[] = (
  [
    ["ANNOUNCED", "Announced", 1500],
    ["FUNDING", "Funded", 3000],
    ["IN_PRODUCTION", "In production", 5500],
    ["RELEASED", "Released", 7500],
    ["TOURING", "Touring", 9000],
    ["PAYING", "Paying out", 10000],
  ] as [MusicStage, string, number][]
).map(([stage, label, releaseBps]) => ({ stage, label, releaseBps, status: "PENDING" as const, reachedAt: null }));

export function defaultMusicMilestones(): MusicMilestone[] {
  return DEFAULT_MUSIC_MILESTONES.map((milestone) => ({ ...milestone }));
}

/* ------------------------------------------------------------------ *
 * Discovery layer — cited public catalogue references (keyless)
 * ------------------------------------------------------------------ */

function mapGenre(raw: string): MusicGenre {
  const value = String(raw || "");
  if (/hip.?hop|rap/i.test(value)) return "HIP_HOP";
  if (/r&b|soul/i.test(value)) return "R_AND_B";
  if (/pop/i.test(value)) return "POP";
  if (/rock|metal|punk/i.test(value)) return "ROCK";
  if (/dance|electronic|house|techno|edm/i.test(value)) return "ELECTRONIC";
  if (/country/i.test(value)) return "COUNTRY";
  if (/jazz/i.test(value)) return "JAZZ";
  if (/classical/i.test(value)) return "CLASSICAL";
  if (/latin|reggaeton|salsa|bachata/i.test(value)) return "LATIN";
  if (/world|afro/i.test(value)) return "AFROBEATS";
  if (/gospel|christian/i.test(value)) return "GOSPEL";
  if (/indie|alternative/i.test(value)) return "INDIE";
  return "OTHER";
}

async function fetchItunesAlbums(term: string): Promise<MusicOpportunity[]> {
  const url = `${ITUNES_SEARCH}?term=${encodeURIComponent(term)}&entity=album&limit=20&media=music`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`iTunes responded ${response.status}`);
    const payload: any = await response.json();
    const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
    const asOf = new Date().toISOString().slice(0, 10);
    const mapped: MusicOpportunity[] = [];
    for (const item of results) {
      const collectionId = item?.collectionId;
      const title = decodeEntities(String(item?.collectionName || "")).trim();
      const artist = decodeEntities(String(item?.artistName || "")).trim();
      if (!collectionId || !title || !artist) continue;
      const releaseDate = typeof item?.releaseDate === "string" ? item.releaseDate.slice(0, 10) : null;
      mapped.push({
        id: `itunes-${collectionId}`,
        title,
        artist,
        musicType: "NEW_ALBUM",
        genre: mapGenre(item?.primaryGenreName),
        territory: "Global",
        territoryBand: "GLOBAL",
        countryCode: "XX",
        country: "Global",
        flag: flagFor("XX"),
        label: item?.copyright ? decodeEntities(String(item.copyright)).slice(0, 80) : null,
        description: `${artist} — “${title}”. A cited public catalogue reference surfaced from the music discovery feed. No funding economics are published for discovery records.`,
        dealType: null,
        stage: "RELEASED",
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
        eventDate: releaseDate,
        fundingDeadline: null,
        remainingDays: null,
        scenarios: [],
        expectedValueMinor: null,
        milestones: defaultMusicMilestones(),
        highlights: item?.trackCount ? [`${Number(item.trackCount)} tracks`] : [],
        source: "Apple iTunes Search API",
        sourceUrl: typeof item?.collectionViewUrl === "string" ? item.collectionViewUrl : null,
        asOf,
        verified: false,
        fundable: false,
      });
    }
    return mapped;
  } finally {
    clearTimeout(timer);
  }
}

let cache: { value: MusicRoyaltiesCatalogue; expiresAt: number } | null = null;
let inflight: Promise<MusicRoyaltiesCatalogue> | null = null;

async function buildCatalogue(): Promise<MusicRoyaltiesCatalogue> {
  const opportunities: MusicOpportunity[] = [];
  const seen = new Set<string>();
  let discoveryOk = false;
  for (const term of DISCOVERY_TERMS) {
    try {
      const items = await fetchItunesAlbums(term);
      if (items.length) discoveryOk = true;
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        opportunities.push(item);
      }
    } catch (error) {
      console.error("[MusicRoyalties] Discovery source failed:", error instanceof Error ? error.message : "UnknownError");
    }
  }

  const sources: MusicRoyaltiesSource[] = [
    {
      name: "Arbitrade music desk — administrator published",
      url: "",
      country: "XX",
      role: "opportunities",
      status: "ok",
      detail: "Shows, concerts, tours, endorsements and funded productions are published by the desk administrator with cited economics.",
    },
    {
      name: "Apple iTunes Search API",
      url: "https://performance-partners.apple.com/search-api",
      country: "US",
      role: "catalogue",
      status: discoveryOk ? "ok" : "degraded",
      detail: discoveryOk
        ? `${opportunities.length} cited public catalogue reference${opportunities.length === 1 ? "" : "s"} surfaced for context. References carry no funding economics.`
        : "The public catalogue reference feed is unavailable right now; administrator-published opportunities are unaffected.",
    },
    {
      name: "Arbitrade music desk — desk methodology",
      url: "",
      country: "XX",
      role: "context",
      status: "ok",
      detail: "Music only: live events, artists, releases, rights, catalogue, brands and commercial music income. No non-music assets are carried.",
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
export async function getMusicRoyaltiesCatalogue(options: { force?: boolean } = {}): Promise<MusicRoyaltiesCatalogue> {
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
export async function findMusicOpportunity(id: string): Promise<MusicOpportunity | null> {
  const catalogue = await getMusicRoyaltiesCatalogue();
  return catalogue.opportunities.find((item) => item.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Desk analytics — aggregated from the opportunities on the desk
 * ------------------------------------------------------------------ */

export type MusicAnalyticsBucket = { key: string; label: string; count: number };

export type MusicAnalytics = {
  totalOpportunities: number;
  fundableCount: number;
  showsAndConcerts: number;
  raisingMinor: number;
  committedMinor: number;
  byType: MusicAnalyticsBucket[];
  byGenre: MusicAnalyticsBucket[];
  byTerritory: MusicAnalyticsBucket[];
  byStage: MusicAnalyticsBucket[];
  byMonth: MusicAnalyticsBucket[];
};

const ISO_MONTH = /^\d{4}-\d{2}$/;

export function buildMusicAnalytics(opportunities: MusicOpportunity[]): MusicAnalytics {
  const typeCounts = new Map<MusicInvestmentType, number>();
  const genreCounts = new Map<MusicGenre, number>();
  const territoryCounts = new Map<string, number>();
  const stageCounts = new Map<MusicStage, number>();
  const monthCounts = new Map<string, number>();
  let fundableCount = 0;
  let showsAndConcerts = 0;
  let raisingMinor = 0;
  let committedMinor = 0;

  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const record of opportunities) {
    bump(typeCounts, record.musicType);
    bump(genreCounts, record.genre);
    bump(territoryCounts, record.territory || "Unspecified");
    bump(stageCounts, record.stage);
    const month = (record.eventDate || record.asOf || "").slice(0, 7);
    if (ISO_MONTH.test(month)) bump(monthCounts, month);
    if (record.fundable) fundableCount += 1;
    if (record.musicType === "SHOW_CONCERT" || record.musicType === "FESTIVAL" || record.musicType === "TOUR") showsAndConcerts += 1;
    raisingMinor += Number(record.fundingAskMinor || 0);
    committedMinor += Number(record.committedMinor || 0);
  }

  const buckets = <K>(map: Map<K, number>, label: (key: K) => string): MusicAnalyticsBucket[] =>
    [...map.entries()]
      .map(([key, count]) => ({ key: String(key), label: label(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    totalOpportunities: opportunities.length,
    fundableCount,
    showsAndConcerts,
    raisingMinor,
    committedMinor,
    byType: buckets(typeCounts, (key) => musicTypeLabel(key)),
    byGenre: buckets(genreCounts, (key) => genreLabel(key)),
    byTerritory: buckets(territoryCounts, (key) => key).slice(0, 12),
    byStage: buckets(stageCounts, (key) => stageLabel(key)),
    byMonth: buckets(monthCounts, (key) => key).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12),
  };
}

export function __resetMusicRoyaltiesCacheForTest() {
  cache = null;
  inflight = null;
}

export const MONTHS_TO_MS = MONTH_MS;
export const MUSIC_ITUNES_TERMS = DISCOVERY_TERMS;
export const MUSIC_DESK_CURRENCY = "USD";
export function musicEnvKey(name: string): string {
  return envKey(name);
}
