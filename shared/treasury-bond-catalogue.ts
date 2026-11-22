/**
 * Real sovereign / treasury bond market data for the customer Treasury Bond desk.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run both on the server and, as a resilience fallback, in the customer's
 * browser. Every published figure is pulled from a free, key-less public data
 * source and is tagged with the provider and observation date so the portal can
 * show where each number came from:
 *
 *  - United States Treasury securities — U.S. Treasury "Fiscal Data" API
 *    (Average Interest Rates on U.S. Treasury Securities, dataset
 *    `v2/accounting/od/avg_interest_rates`).
 *  - United States Treasury auction results — U.S. Treasury "Fiscal Data" API
 *    (dataset `v1/accounting/od/auctions_query`: high yield, bid-to-cover and
 *    amounts accepted from the most recent auction of each security term).
 *  - Euro area AAA government benchmark yield curve — ECB Data Portal
 *    (dataflow `YC`, series key `B.U2.EUR.4F.G_N_A.SV_C_YM.<MATURITY>`).
 *  - Euro area sovereign 10-year government bond yields — ECB Data Portal
 *    (dataflow `IRS`, series key `M.<AREA>.L.L40.CI.0000.EUR.N.Z`).
 *  - European Union government long-term bond yields — Eurostat
 *    (dataset `irt_lt_mcby_m`, Maastricht convergence long-term interest rates,
 *    monthly, covering EU and EEA reporting countries).
 *  - Non-EU OECD sovereign 10-year government bond yields — OECD SDMX
 *    (dataflow `DF_FINMARK`, measure `IRLT`: long-term interest rates for
 *    Australia, Canada, Japan, the United Kingdom, Switzerland, Norway, and
 *    other OECD members).
 *
 * Nothing here is invented: when a source cannot be reached the provider fails
 * closed for that source and the desk reports the remaining, genuinely fetched
 * instruments (or an explicit "market data unavailable" state), never filler.
 */

import { flagFor } from "./country-options";
import type { DeskEconomics } from "./investment-economics";

export type TreasuryBondHistoryPoint = { t: string; v: number };

export type TreasuryBondCategory = TreasuryBondInstrument["category"];

export type TreasuryBondInstrument = {
  /** Stable slug used by the wallet ledger and positions table. */
  id: string;
  countryCode: string;
  country: string;
  flag: string;
  issuer: string;
  name: string;
  category: "BILL" | "NOTE" | "BOND" | "TIPS" | "FRN" | "BENCHMARK" | "SOVEREIGN";
  /** Human label for the tenor, e.g. "10 years", "6 months". */
  tenorLabel: string;
  /** Tenor expressed in years (0.25 = 3 months) for interest maths. */
  tenorYears: number;
  /** Interest / coupon rate in percent per annum, as published by the source. */
  couponRatePct: number;
  couponFrequency: string;
  nativeCurrency: string;
  /** Minimum purchase in minor units (cents) of the settlement currency. */
  minInvestmentMinor: number;
  /** Indicative issuer credit quality label (reference only, not live ratings). */
  creditQuality: string;
  riskLabel: string;
  paymentMethod: string;
  source: string;
  sourceSeries: string;
  asOf: string;
  summary: string;
  highlights: string[];
  history: TreasuryBondHistoryPoint[];
  /**
   * Auto-assigned, admin-overridable economic profile for the desk offer
   * (investable amount, profit, term, presentation currency, platform fee and
   * any settlement delay). Filled by the server on the customer desk; absent on
   * the raw public-data catalogue.
   */
  economics?: DeskEconomics | null;
};

export type TreasuryBondSource = {
  name: string;
  url: string;
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type TreasuryBondCatalogue = {
  instruments: TreasuryBondInstrument[];
  sources: TreasuryBondSource[];
  fetchedAt: string;
  degraded: boolean;
};

const FISCAL_DATA_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const ECB_BASE = "https://data-api.ecb.europa.eu/service/data";
const OECD_BASE = "https://sdmx.oecd.org/public/rest/data";
const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const CATALOGUE_TTL_MS = 10 * 60 * 1000;
const HISTORY_MONTHS = 12;
const HISTORY_MONTHS_FETCHED = 24;
const REQUEST_TIMEOUT_MS = 15_000;

/** Canonical desk ordering: instrument category precedence, then highest rate first. */
const CATEGORY_ORDER: Record<TreasuryBondCategory, number> = {
  BILL: 0, FRN: 1, TIPS: 2, NOTE: 3, BOND: 4, BENCHMARK: 5, SOVEREIGN: 6,
};

/**
 * Shared ordering used by both the live catalogue and the customer dashboard so
 * administrator-published instruments slot into the desk in the same order.
 */
export function compareTreasuryBondInstruments(a: TreasuryBondInstrument, b: TreasuryBondInstrument): number {
  return (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)
    || b.couponRatePct - a.couponRatePct;
}

/** `YYYY-MM` label for `count` months before now, used to bound history queries. */
function monthsAgo(count: number): string {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - count);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fetch JSON from a public data source with a hard timeout and a single retry.
 * A retry resolves transient DNS/TLS hiccups and cold-start slowness seen on
 * managed hosts, which would otherwise silently drop a whole data source.
 *
 * `accept` is overridable because a few SDMX endpoints (notably the OECD
 * service) reject `Accept: application/json` with an HTTP 500 and only serve
 * the JSON-stat payload for a wildcard Accept header.
 */
async function json(url: string, options: { accept?: string } = {}, attempt = 0): Promise<any> {
  try {
    const response = await fetch(url, {
      headers: { Accept: options.accept || "application/json", "User-Agent": "Arbitrade-treasury-desk/1.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      return json(url, options, attempt + 1);
    }
    throw new Error(`${url} → ${error instanceof Error ? error.message : "request failed"}`);
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ *
 * United States Treasury securities (Fiscal Data API)
 * ------------------------------------------------------------------ */

type UsRateRow = { rate: number; asOf: string; history: TreasuryBondHistoryPoint[] };

const US_SECURITY_SEED: Record<string, {
  id: string;
  name: string;
  category: TreasuryBondInstrument["category"];
  tenorLabel: string;
  tenorYears: number;
  couponFrequency: string;
  minInvestmentMinor: number;
  creditQuality: string;
  riskLabel: string;
  paymentMethod: string;
  summary: string;
}> = {
  "Treasury Bills": {
    id: "us-treasury-bills",
    name: "US Treasury Bills",
    category: "BILL",
    tenorLabel: "Short term · up to 1 year",
    tenorYears: 0.5,
    couponFrequency: "Sold at a discount, paid at maturity",
    minInvestmentMinor: 10000,
    creditQuality: "Very high (AA+ sovereign, reference)",
    riskLabel: "Lowest credit risk",
    paymentMethod: "Maturity value paid at the stated maturity date",
    summary: "Short-dated US government obligations issued at a discount. The published average interest rate is the blended cost of outstanding bills, the closest free proxy for the current short-term government yield.",
  },
  "Treasury Notes": {
    id: "us-treasury-notes",
    name: "US Treasury Notes",
    category: "NOTE",
    tenorLabel: "Medium term · 2 to 10 years",
    tenorYears: 5,
    couponFrequency: "Semi-annual coupon",
    minInvestmentMinor: 100000,
    creditQuality: "Very high (AA+ sovereign, reference)",
    riskLabel: "Lowest credit risk",
    paymentMethod: "Semi-annual interest plus principal at maturity",
    summary: "Medium-dated US government securities paying a fixed semi-annual coupon. Notes are the standard reference point for the US government medium-term cost of borrowing.",
  },
  "Treasury Bonds": {
    id: "us-treasury-bonds",
    name: "US Treasury Bonds",
    category: "BOND",
    tenorLabel: "Long term · 20 to 30 years",
    tenorYears: 20,
    couponFrequency: "Semi-annual coupon",
    minInvestmentMinor: 100000,
    creditQuality: "Very high (AA+ sovereign, reference)",
    riskLabel: "Lowest credit risk · rate sensitive",
    paymentMethod: "Semi-annual interest plus principal at maturity",
    summary: "Long-dated US government bonds with the longest maturity profile. They carry the most interest-rate sensitivity of the US Treasury family while retaining sovereign credit backing.",
  },
  "Treasury Inflation-Protected Securities (TIPS)": {
    id: "us-treasury-tips",
    name: "US Treasury Inflation-Protected Securities",
    category: "TIPS",
    tenorLabel: "Medium term · 5 to 30 years",
    tenorYears: 10,
    couponFrequency: "Semi-annual coupon, inflation-adjusted principal",
    minInvestmentMinor: 10000,
    creditQuality: "Very high (AA+ sovereign, reference)",
    riskLabel: "Lowest credit risk · inflation protected",
    paymentMethod: "Inflation-adjusted interest and principal at maturity",
    summary: "Treasury securities whose principal is adjusted with the official inflation index, designed to protect purchasing power while keeping full US government backing.",
  },
  "Treasury Floating Rate Notes (FRN)": {
    id: "us-treasury-frn",
    name: "US Treasury Floating Rate Notes",
    category: "FRN",
    tenorLabel: "Short term · 2 years",
    tenorYears: 2,
    couponFrequency: "Quarterly floating coupon",
    minInvestmentMinor: 100000,
    creditQuality: "Very high (AA+ sovereign, reference)",
    riskLabel: "Lowest credit risk · floating rate",
    paymentMethod: "Quarterly floating interest plus principal at maturity",
    summary: "Two-year US government notes whose coupon resets with short-term reference rates, reducing interest-rate sensitivity while keeping sovereign credit quality.",
  },
};

export async function fetchUsTreasuryInstruments(): Promise<TreasuryBondInstrument[]> {
  const fields = "record_date,security_desc,security_type_desc,avg_interest_rate_amt";
  const payload = await json(
    `${FISCAL_DATA_BASE}/v2/accounting/od/avg_interest_rates?sort=-record_date&page%5Bsize%5D=400&fields=${fields}`,
  );
  const rows: any[] = Array.isArray(payload?.data) ? payload.data : [];
  const collected = new Map<string, UsRateRow>();

  for (const row of rows) {
    const label = String(row?.security_desc || "").trim();
    const seed = US_SECURITY_SEED[label];
    if (!seed) continue;
    const rate = Number(row?.avg_interest_rate_amt);
    const asOf = String(row?.record_date || "");
    if (!Number.isFinite(rate) || !asOf) continue;
    const entry = collected.get(label) || { rate, asOf, history: [] };
    if (!collected.has(label)) collected.set(label, entry);
    // Rows arrive newest-first; keep the latest as the headline and build a
    // chronological history limited to the trailing history window.
    if (entry.history.length < HISTORY_MONTHS && !entry.history.some((point) => point.t === asOf)) {
      entry.history.push({ t: asOf, v: round2(rate) });
    }
  }

  const instruments: TreasuryBondInstrument[] = [];
  for (const [label, seed] of Object.entries(US_SECURITY_SEED)) {
    const entry = collected.get(label);
    if (!entry) continue;
    instruments.push({
      id: seed.id,
      countryCode: "US",
      country: "United States",
      flag: flagFor("US"),
      issuer: "U.S. Department of the Treasury",
      name: seed.name,
      category: seed.category,
      tenorLabel: seed.tenorLabel,
      tenorYears: seed.tenorYears,
      couponRatePct: round2(entry.rate),
      couponFrequency: seed.couponFrequency,
      nativeCurrency: "USD",
      minInvestmentMinor: seed.minInvestmentMinor,
      creditQuality: seed.creditQuality,
      riskLabel: seed.riskLabel,
      paymentMethod: seed.paymentMethod,
      source: "U.S. Treasury Fiscal Data API",
      sourceSeries: `Average interest rates · ${label}`,
      asOf: entry.asOf,
      summary: seed.summary,
      highlights: [
        "Backed by the full faith and credit of the United States government",
        `Published average interest rate ${round2(entry.rate).toFixed(3)}% as of ${entry.asOf}`,
        "Highly liquid secondary market and a predictable maturity",
      ],
      history: entry.history.slice().sort((a, b) => a.t.localeCompare(b.t)),
    });
  }
  return instruments;
}

/* ------------------------------------------------------------------ *
 * Euro area AAA government benchmark yield curve (ECB Data Portal)
 * ------------------------------------------------------------------ */

const EU_BENCHMARK_MATURITIES: { key: string; label: string; years: number }[] = [
  { key: "SR_3M", label: "3 months", years: 0.25 },
  { key: "SR_6M", label: "6 months", years: 0.5 },
  { key: "SR_1Y", label: "1 year", years: 1 },
  { key: "SR_2Y", label: "2 years", years: 2 },
  { key: "SR_5Y", label: "5 years", years: 5 },
  { key: "SR_10Y", label: "10 years", years: 10 },
  { key: "SR_30Y", label: "30 years", years: 30 },
];

type EcbSeries = { value: number; asOf: string; history: TreasuryBondHistoryPoint[] };

/** Parse an ECB Data Portal `jsondata` payload and return the latest observation plus history. */
function parseEcbSeries(payload: any): EcbSeries | null {
  const seriesList = payload?.dataSets?.[0]?.series;
  if (!seriesList) return null;
  const first = seriesList[Object.keys(seriesList)[0]];
  const observations = first?.observations || {};
  const timeValues: any[] = payload?.structure?.dimensions?.observation?.[0]?.values || [];
  const points: TreasuryBondHistoryPoint[] = [];
  for (const key of Object.keys(observations).sort((a, b) => Number(a) - Number(b))) {
    const raw = observations[key]?.[0];
    if (raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const t = String(timeValues[Number(key)]?.id || "");
    points.push({ t, v: round2(value) });
  }
  if (!points.length) return null;
  const latest = points[points.length - 1];
  return { value: latest.v, asOf: latest.t, history: points };
}

export async function fetchEuroAreaBenchmarkInstruments(): Promise<TreasuryBondInstrument[]> {
  const results = await Promise.all(EU_BENCHMARK_MATURITIES.map(async (maturity) => {
    try {
      const payload = await json(
        `${ECB_BASE}/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.${maturity.key}?lastNObservations=24&format=jsondata`,
      );
      return { maturity, series: parseEcbSeries(payload) };
    } catch {
      return { maturity, series: null };
    }
  }));

  const instruments = results.flatMap(({ maturity, series }) => {
    if (!series) return [];
    return [{
      id: `eu-benchmark-${maturity.key.toLowerCase().replace("sr_", "")}`,
      countryCode: "EU",
      country: "Euro area",
      flag: "🇪🇺",
      issuer: "Euro area sovereigns (AAA-rated), ECB benchmark curve",
      name: `Euro Area AAA Government Benchmark · ${maturity.label}`,
      category: "BENCHMARK" as const,
      tenorLabel: maturity.label,
      tenorYears: maturity.years,
      couponRatePct: series.value,
      couponFrequency: maturity.years <= 1 ? "Zero coupon, paid at maturity" : "Annual coupon",
      nativeCurrency: "EUR",
      minInvestmentMinor: 10000,
      creditQuality: "AAA-rated euro area sovereigns (reference)",
      riskLabel: "Very low credit risk · euro area benchmark",
      paymentMethod: "Interest plus principal at maturity",
      source: "ECB Data Portal (yield curve)",
      sourceSeries: `YC · B.U2.EUR.4F.G_N_A.SV_C_YM.${maturity.key}`,
      asOf: series.asOf,
      summary: `The ECB's AAA-rated euro area government benchmark yield for the ${maturity.label} tenor, the standard reference for high-grade euro sovereign debt.`,
      highlights: [
        "Built from the highest-quality (AAA) euro area sovereign issuers",
        "Widely used as the euro risk-free reference curve",
        `Published benchmark yield ${series.value.toFixed(3)}% as of ${series.asOf}`,
      ],
      history: series.history,
    }];
  });
  if (!instruments.length) throw new Error("Euro area benchmark yield curve returned no observations");
  return instruments;
}

/* ------------------------------------------------------------------ *
 * Euro area sovereign 10-year government bond yields (ECB Data Portal)
 * ------------------------------------------------------------------ */

const EU_SOVEREIGNS: { code: string; country: string; creditQuality: string; riskLabel: string }[] = [
  { code: "DE", country: "Germany", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "NL", country: "Netherlands", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "LU", country: "Luxembourg", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "AT", country: "Austria", creditQuality: "High (AA+, reference)", riskLabel: "Low credit risk" },
  { code: "FI", country: "Finland", creditQuality: "High (AA+, reference)", riskLabel: "Low credit risk" },
  { code: "IE", country: "Ireland", creditQuality: "High (AA, reference)", riskLabel: "Low credit risk" },
  { code: "FR", country: "France", creditQuality: "High (AA-, reference)", riskLabel: "Low credit risk" },
  { code: "BE", country: "Belgium", creditQuality: "High (AA-, reference)", riskLabel: "Low credit risk" },
  { code: "ES", country: "Spain", creditQuality: "Good (A, reference)", riskLabel: "Moderate credit risk" },
  { code: "PT", country: "Portugal", creditQuality: "Good (A-, reference)", riskLabel: "Moderate credit risk" },
  { code: "SI", country: "Slovenia", creditQuality: "Good (A, reference)", riskLabel: "Moderate credit risk" },
  { code: "SK", country: "Slovakia", creditQuality: "Good (A+, reference)", riskLabel: "Moderate credit risk" },
  { code: "IT", country: "Italy", creditQuality: "Investment grade (BBB, reference)", riskLabel: "Elevated credit risk" },
  { code: "GR", country: "Greece", creditQuality: "Investment grade (BBB-, reference)", riskLabel: "Elevated credit risk" },
];

export async function fetchEuSovereignInstruments(): Promise<TreasuryBondInstrument[]> {
  const codes = EU_SOVEREIGNS.map((s) => s.code);
  const key = `M.${codes.join("+")}.L.L40.CI.0000.EUR.N.Z`;
  const payload = await json(`${ECB_BASE}/IRS/${key}?lastNObservations=13&format=jsondata`);
  const seriesList = payload?.dataSets?.[0]?.series;
  const areaValues: any[] = payload?.structure?.dimensions?.series?.find((d: any) => d.id === "REF_AREA")?.values || [];
  if (!seriesList || !areaValues.length) throw new Error("ECB long-term interest-rate series was empty");

  const byCode = new Map<string, EcbSeries>();
  for (const seriesKey of Object.keys(seriesList)) {
    const indices = seriesKey.split(":").map(Number);
    // REF_AREA is the second series dimension in the IRS dataflow.
    const areaCode = String(areaValues[indices[1]]?.id || "");
    if (!areaCode) continue;
    const parsed = parseEcbSeries({ dataSets: [{ series: { [seriesKey]: seriesList[seriesKey] } }], structure: payload.structure });
    if (parsed) byCode.set(areaCode, parsed);
  }

  const instruments = EU_SOVEREIGNS.flatMap(({ code, country, creditQuality, riskLabel }) => {
    const series = byCode.get(code);
    if (!series) return [];
    return [{
      id: `eu-sovereign-${code.toLowerCase()}-10y`,
      countryCode: code,
      country,
      flag: flagFor(code),
      issuer: `${country} government`,
      name: `${country} 10-Year Government Bond`,
      category: "SOVEREIGN" as const,
      tenorLabel: "10 years",
      tenorYears: 10,
      couponRatePct: series.value,
      couponFrequency: "Annual coupon",
      nativeCurrency: "EUR",
      minInvestmentMinor: 10000,
      creditQuality,
      riskLabel,
      paymentMethod: "Interest plus principal at maturity",
      source: "ECB Data Portal (long-term interest rates)",
      sourceSeries: `IRS · M.${code}.L.L40.CI.0000.EUR.N.Z`,
      asOf: series.asOf,
      summary: `The euro-denominated 10-year benchmark government bond yield for ${country}, published by the European Central Bank from the secondary market.`,
      highlights: [
        `${country} euro-denominated sovereign credit`,
        "Published benchmark 10-year yield from the ECB",
        `Rate ${series.value.toFixed(3)}% as of ${series.asOf}`,
      ],
      history: series.history,
    }];
  });
  if (!instruments.length) throw new Error("ECB long-term interest-rate series returned no sovereign yields");
  return instruments;
}

/* ------------------------------------------------------------------ *
 * Shared 10-year sovereign instrument builder
 * ------------------------------------------------------------------ */

type SovereignSeed = {
  /** ISO-3166 alpha-2 code (drives the flag); distinct from provider geo codes. */
  iso2: string;
  country: string;
  currency: string;
  creditQuality: string;
  riskLabel: string;
};

function sovereignInstrument(args: {
  id: string;
  seed: SovereignSeed;
  source: string;
  sourceSeries: string;
  latest: TreasuryBondHistoryPoint;
  history: TreasuryBondHistoryPoint[];
  summary: string;
}): TreasuryBondInstrument {
  const { id, seed, source, sourceSeries, latest, history, summary } = args;
  return {
    id,
    countryCode: seed.iso2,
    country: seed.country,
    flag: flagFor(seed.iso2),
    issuer: `${seed.country} government`,
    name: `${seed.country} 10-Year Government Bond`,
    category: "SOVEREIGN",
    tenorLabel: "10 years",
    tenorYears: 10,
    couponRatePct: latest.v,
    couponFrequency: "Annual coupon",
    nativeCurrency: seed.currency,
    minInvestmentMinor: 10000,
    creditQuality: seed.creditQuality,
    riskLabel: seed.riskLabel,
    paymentMethod: "Interest plus principal at maturity",
    source,
    sourceSeries,
    asOf: latest.t,
    summary,
    highlights: [
      `${seed.country} sovereign credit in ${seed.currency}`,
      "Published benchmark 10-year government yield",
      `Rate ${latest.v.toFixed(3)}% as of ${latest.t}`,
    ],
    history: history.slice(-HISTORY_MONTHS),
  };
}

/* ------------------------------------------------------------------ *
 * European Union government long-term yields (Eurostat)
 * ------------------------------------------------------------------ */

/**
 * Eurostat reports long-term government bond yields on the harmonised Maastricht
 * convergence basis for all EU/EEA reporting countries. Only the jurisdictions
 * the ECB euro-area feeds do not already cover are requested here, so a country
 * is never listed twice across sources. Eurostat uses non-ISO geo codes ("EL"
 * for Greece, "UK" for the United Kingdom), which is why the ISO code is stored
 * separately from the provider geo code.
 */
const EUROSTAT_SOVEREIGNS: (SovereignSeed & { geo: string })[] = [
  { geo: "BG", iso2: "BG", country: "Bulgaria", currency: "BGN", creditQuality: "Good (BBB, reference)", riskLabel: "Moderate credit risk" },
  { geo: "CZ", iso2: "CZ", country: "Czechia", currency: "CZK", creditQuality: "High (AA-, reference)", riskLabel: "Low credit risk" },
  { geo: "DK", iso2: "DK", country: "Denmark", currency: "DKK", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { geo: "EE", iso2: "EE", country: "Estonia", currency: "EUR", creditQuality: "High (AA-, reference)", riskLabel: "Low credit risk" },
  { geo: "HR", iso2: "HR", country: "Croatia", currency: "EUR", creditQuality: "Good (A-, reference)", riskLabel: "Moderate credit risk" },
  { geo: "CY", iso2: "CY", country: "Cyprus", currency: "EUR", creditQuality: "Investment grade (BBB, reference)", riskLabel: "Elevated credit risk" },
  { geo: "LV", iso2: "LV", country: "Latvia", currency: "EUR", creditQuality: "Good (A, reference)", riskLabel: "Moderate credit risk" },
  { geo: "LT", iso2: "LT", country: "Lithuania", currency: "EUR", creditQuality: "Good (A, reference)", riskLabel: "Moderate credit risk" },
  { geo: "HU", iso2: "HU", country: "Hungary", currency: "HUF", creditQuality: "Investment grade (BBB, reference)", riskLabel: "Elevated credit risk" },
  { geo: "MT", iso2: "MT", country: "Malta", currency: "EUR", creditQuality: "Good (A, reference)", riskLabel: "Moderate credit risk" },
  { geo: "PL", iso2: "PL", country: "Poland", currency: "PLN", creditQuality: "Good (A-, reference)", riskLabel: "Moderate credit risk" },
  { geo: "RO", iso2: "RO", country: "Romania", currency: "RON", creditQuality: "Investment grade (BBB-, reference)", riskLabel: "Elevated credit risk" },
  { geo: "SE", iso2: "SE", country: "Sweden", currency: "SEK", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
];

export async function fetchEurostatSovereignInstruments(): Promise<TreasuryBondInstrument[]> {
  const payload = await json(`${EUROSTAT_BASE}/irt_lt_mcby_m?format=JSON&lastTimePeriod=${HISTORY_MONTHS}`);
  const dimension = payload?.dimension;
  const geoIndex: Record<string, number> = dimension?.geo?.category?.index || {};
  const geoLabels: Record<string, string> = dimension?.geo?.category?.label || {};
  const timeIndex: Record<string, number> = dimension?.time?.category?.index || {};
  const timeLabels: Record<string, string> = dimension?.time?.category?.label || {};
  const values: Record<string, number> = payload?.value || {};
  const sizes: number[] = payload?.size || [];
  if (!Object.keys(geoIndex).length || !Object.keys(timeIndex).length || !Object.keys(values).length) {
    throw new Error("Eurostat long-term interest-rate dataset was empty");
  }

  // JSON-stat flat index: (((freq * size[1]) + int_rt) * size[2] + geo) * size[3] + time.
  // `freq` and `int_rt` are single-valued here, so the leading terms collapse.
  const timeSize = Number(sizes[3]) || Object.keys(timeIndex).length;
  const periods = Object.keys(timeIndex).sort((a, b) => timeIndex[a] - timeIndex[b]);

  const instruments = EUROSTAT_SOVEREIGNS.flatMap((seed) => {
    const geoPosition = geoIndex[seed.geo];
    if (geoPosition === undefined) return [];
    const history: TreasuryBondHistoryPoint[] = [];
    for (let step = 0; step < periods.length; step += 1) {
      const raw = values[geoPosition * timeSize + step];
      if (raw === undefined || raw === null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const period = periods[step];
      history.push({ t: timeLabels[period] || period, v: round2(value) });
    }
    if (!history.length) return [];
    const latest = history[history.length - 1];
    return [sovereignInstrument({
      id: `eurostat-${seed.iso2.toLowerCase()}-10y`,
      seed,
      source: "Eurostat (long-term interest rates)",
      sourceSeries: `irt_lt_mcby_m · ${seed.geo} · ${geoLabels[seed.geo] || seed.country}`,
      latest,
      history,
      summary: `The harmonised long-term (10-year) government bond yield for ${seed.country}, published by Eurostat on the Maastricht convergence basis.`,
    })];
  });
  if (!instruments.length) throw new Error("Eurostat long-term interest-rate dataset returned no sovereign yields");
  return instruments;
}

/* ------------------------------------------------------------------ *
 * Non-EU OECD sovereign 10-year yields (OECD SDMX)
 * ------------------------------------------------------------------ */

const OECD_SOVEREIGNS: (SovereignSeed & { code: string })[] = [
  { code: "AUS", iso2: "AU", country: "Australia", currency: "AUD", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "CAN", iso2: "CA", country: "Canada", currency: "CAD", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "JPN", iso2: "JP", country: "Japan", currency: "JPY", creditQuality: "High (A+, reference)", riskLabel: "Low credit risk" },
  { code: "GBR", iso2: "GB", country: "United Kingdom", currency: "GBP", creditQuality: "High (AA, reference)", riskLabel: "Low credit risk" },
  { code: "CHE", iso2: "CH", country: "Switzerland", currency: "CHF", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "NOR", iso2: "NO", country: "Norway", currency: "NOK", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "SWE", iso2: "SE", country: "Sweden", currency: "SEK", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "DNK", iso2: "DK", country: "Denmark", currency: "DKK", creditQuality: "Very high (AAA, reference)", riskLabel: "Very low credit risk" },
  { code: "POL", iso2: "PL", country: "Poland", currency: "PLN", creditQuality: "Good (A-, reference)", riskLabel: "Moderate credit risk" },
  { code: "CZE", iso2: "CZ", country: "Czechia", currency: "CZK", creditQuality: "High (AA-, reference)", riskLabel: "Low credit risk" },
  { code: "HUN", iso2: "HU", country: "Hungary", currency: "HUF", creditQuality: "Investment grade (BBB, reference)", riskLabel: "Elevated credit risk" },
];

// SDMX keys must carry every dimension, including empty ones: after the country
// and the fixed `M.IRLT` series there are six trailing empty dimensions.
const OECD_KEY_SUFFIX = `M.IRLT${".".repeat(6)}`;

export async function fetchOecdSovereignInstruments(): Promise<TreasuryBondInstrument[]> {
  // A single batched request is used deliberately: the OECD SDMX service
  // rate-limits per-country requests (HTTP 429/500), while one multi-country
  // request is served reliably and keeps the outlet within a polite request rate.
  const codes = OECD_SOVEREIGNS.map((seed) => seed.code);
  const url = `${OECD_BASE}/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/${codes.join("+")}.${OECD_KEY_SUFFIX}?startPeriod=${monthsAgo(HISTORY_MONTHS_FETCHED - 1)}&format=jsondata`;
  const payload = await json(url, { accept: "*/*" });
  const seriesList = payload?.data?.dataSets?.[0]?.series;
  const areaValues: any[] = payload?.data?.structure?.dimensions?.series?.find((dimension: any) => dimension.id === "REF_AREA")?.values || [];
  const timeValues: any[] = payload?.data?.structure?.dimensions?.observation?.[0]?.values || [];
  if (!seriesList || !areaValues.length) throw new Error("OECD long-term interest-rate dataset was empty");

  const byCode = new Map<string, { latest: TreasuryBondHistoryPoint; history: TreasuryBondHistoryPoint[] }>();
  for (const seriesKey of Object.keys(seriesList)) {
    // REF_AREA is the first series dimension; the observation dimension does not
    // arrive in time order, so the points are sorted chronologically below.
    const code = String(areaValues[Number(seriesKey.split(":")[0])]?.id || "");
    if (!code) continue;
    const observations = seriesList[seriesKey]?.observations || {};
    const history: TreasuryBondHistoryPoint[] = [];
    for (const index of Object.keys(observations)) {
      const raw = observations[index]?.[0];
      if (raw === null || raw === undefined) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const period = String(timeValues[Number(index)]?.id || "");
      if (!period) continue;
      history.push({ t: period, v: round2(value) });
    }
    if (!history.length) continue;
    history.sort((a, b) => a.t.localeCompare(b.t));
    byCode.set(code, { latest: history[history.length - 1], history });
  }

  const instruments = OECD_SOVEREIGNS.flatMap((seed) => {
    const row = byCode.get(seed.code);
    if (!row) return [];
    return [sovereignInstrument({
      id: `oecd-${seed.iso2.toLowerCase()}-10y`,
      seed,
      source: "OECD SDMX (long-term interest rates)",
      sourceSeries: `DF_FINMARK · ${seed.code}.M.IRLT`,
      latest: row.latest,
      history: row.history,
      summary: `The ${seed.country} 10-year government benchmark bond yield, published by the OECD from national long-term interest-rate statistics.`,
    })];
  });
  if (!instruments.length) throw new Error("OECD long-term interest-rate dataset returned no sovereign yields");
  return instruments;
}

/* ------------------------------------------------------------------ *
 * United States Treasury auction results (Fiscal Data API)
 * ------------------------------------------------------------------ */

const AUCTION_CATEGORY: { match: RegExp; category: TreasuryBondInstrument["category"] }[] = [
  { match: /inflation[- ]?(protected|indexed)|tips/i, category: "TIPS" },
  { match: /floating/i, category: "FRN" },
  { match: /bill/i, category: "BILL" },
  { match: /note/i, category: "NOTE" },
  { match: /bond/i, category: "BOND" },
];

function auctionCategory(type: string): TreasuryBondInstrument["category"] | null {
  const hit = AUCTION_CATEGORY.find((entry) => entry.match.test(type));
  return hit ? hit.category : null;
}

/** Normalise an auction term ("29-Year 10-Month", "13-Week") into a tenor bucket. */
function auctionTerm(term: string): { label: string; years: number } | null {
  const years = /(\d+)\s*-\s*Year/i.exec(term);
  const months = /(\d+)\s*-\s*Month/i.exec(term);
  const weeks = /(\d+)\s*-\s*Week/i.exec(term);
  if (years) {
    // Reopenings quote "29-Year 10-Month" etc.; round to the nearest whole year
    // so a reopened 30-year bond collapses into the single 30-Year bucket.
    const total = Number(years[1]) + (months ? Number(months[1]) / 12 : 0);
    const rounded = Math.max(1, Math.round(total));
    return { label: `${rounded}-Year`, years: rounded };
  }
  if (weeks) {
    const count = Math.max(1, Number(weeks[1]));
    return { label: `${count}-Week`, years: count / 52 };
  }
  if (months) {
    const count = Math.max(1, Number(months[1]));
    return { label: `${count}-Month`, years: count / 12 };
  }
  return null;
}

const usdBillions = (value: number) => (Number.isFinite(value) ? `$${(value / 1_000_000_000).toFixed(1)}bn` : "n/a");

export async function fetchUsAuctionInstruments(): Promise<TreasuryBondInstrument[]> {
  const fields = "auction_date,security_type,security_term,high_yield,offering_amt,bid_to_cover_ratio";
  const payload = await json(`${FISCAL_DATA_BASE}/v1/accounting/od/auctions_query?filter=high_yield:gt:0&sort=-auction_date&page%5Bsize%5D=250&fields=${fields}`);
  const rows: any[] = Array.isArray(payload?.data) ? payload.data : [];

  // Keep only the most recent completed auction of each category + tenor bucket.
  const buckets = new Map<string, { row: any; label: string; years: number; category: TreasuryBondInstrument["category"] }>();
  for (const row of rows) {
    const type = String(row?.security_type || "").trim();
    const term = String(row?.security_term || "").trim();
    const date = String(row?.auction_date || "");
    const rate = Number(row?.high_yield);
    if (!type || !term || !date || !Number.isFinite(rate)) continue;
    const category = auctionCategory(type);
    const parsed = auctionTerm(term);
    if (!category || !parsed) continue;
    const key = `${category}:${parsed.label}`;
    const current = buckets.get(key);
    if (!current || date > current.row.auction_date) buckets.set(key, { row, ...parsed, category });
  }

  const instruments = Array.from(buckets.values()).map(({ row, label, years, category }) => {
    const rate = Number(row.high_yield);
    const cover = Number(row.bid_to_cover_ratio);
    const accepted = Number(row.total_accepted);
    const offered = Number(row.offering_amt);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return {
      id: `us-auction-${category.toLowerCase()}-${slug}`,
      countryCode: "US",
      country: "United States",
      flag: flagFor("US"),
      issuer: "U.S. Department of the Treasury",
      name: `US Treasury ${label.replace("-", " ")} Auction`,
      category,
      tenorLabel: label.replace("-", " "),
      tenorYears: round2(years),
      couponRatePct: round2(rate),
      couponFrequency: category === "BILL" ? "Sold at a discount, paid at maturity" : "Semi-annual coupon",
      nativeCurrency: "USD",
      minInvestmentMinor: category === "BILL" ? 10000 : 100000,
      creditQuality: "Very high (AA+ sovereign, reference)",
      riskLabel: "Lowest credit risk",
      paymentMethod: "Interest plus principal at maturity",
      source: "U.S. Treasury Fiscal Data API (auction results)",
      sourceSeries: `auctions_query · ${row.security_type} ${row.security_term} · ${row.auction_date}`,
      asOf: row.auction_date,
      summary: `The most recent US Treasury auction of the ${row.security_term} ${String(row.security_type).toLowerCase()} cleared at a high yield of ${round2(rate).toFixed(3)}%, with bid-to-cover showing the investor demand the auction attracted.`,
      highlights: [
        `Cleared high yield ${round2(rate).toFixed(3)}% at the ${row.auction_date} auction`,
        Number.isFinite(cover) ? `Bid-to-cover ${cover.toFixed(2)}×` : "Bid-to-cover not published for this auction",
        Number.isFinite(accepted) ? `Accepted ${usdBillions(accepted)} (offered ${usdBillions(offered)})` : "Auction amount accepted not published",
      ],
      history: [],
    } satisfies TreasuryBondInstrument;
  });
  if (!instruments.length) throw new Error("US Treasury auction dataset returned no completed auctions");
  return instruments;
}

/* ------------------------------------------------------------------ *
 * Catalogue assembly + cache
 * ------------------------------------------------------------------ */

let cache: { value: TreasuryBondCatalogue; expiresAt: number } | null = null;
let inflight: Promise<TreasuryBondCatalogue> | null = null;

const reasonOf = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : "";

async function buildCatalogue(): Promise<TreasuryBondCatalogue> {
  const [us, benchmark, sovereign, eurostat, oecd, auctions] = await Promise.allSettled([
    fetchUsTreasuryInstruments(),
    fetchEuroAreaBenchmarkInstruments(),
    fetchEuSovereignInstruments(),
    fetchEurostatSovereignInstruments(),
    fetchOecdSovereignInstruments(),
    fetchUsAuctionInstruments(),
  ]);

  // Surface which source failed so production logs make an egress outage obvious.
  for (const [label, result] of [
    ["US Treasury", us], ["US auctions", auctions], ["EU benchmark", benchmark],
    ["EU sovereigns", sovereign], ["Eurostat sovereigns", eurostat], ["OECD sovereigns", oecd],
  ] as const) {
    if (result.status === "rejected") console.warn(`[TreasuryBonds] ${label} source failed: ${reasonOf(result)}`);
  }

  const raw: TreasuryBondInstrument[] = [
    ...(us.status === "fulfilled" ? us.value : []),
    ...(benchmark.status === "fulfilled" ? benchmark.value : []),
    ...(sovereign.status === "fulfilled" ? sovereign.value : []),
    ...(eurostat.status === "fulfilled" ? eurostat.value : []),
    ...(oecd.status === "fulfilled" ? oecd.value : []),
    ...(auctions.status === "fulfilled" ? auctions.value : []),
  ];

  // A country's 10-year sovereign yield can be carried by more than one feed
  // (e.g. the ECB and Eurostat both cover the euro area). Keep the first — the
  // most specific — source per jurisdiction so no country is ever listed twice.
  const seenSovereign = new Set<string>();
  const instruments = raw.filter((instrument) => {
    if (instrument.category !== "SOVEREIGN") return true;
    if (seenSovereign.has(instrument.countryCode)) return false;
    seenSovereign.add(instrument.countryCode);
    return true;
  });
  instruments.sort(compareTreasuryBondInstruments);

  const statusOf = (result: PromiseSettledResult<unknown[]>) =>
    (result.status === "fulfilled" && result.value.length ? "ok" : "unavailable") as "ok" | "unavailable";

  const sources: TreasuryBondSource[] = [
    { name: "U.S. Treasury Fiscal Data API", url: "https://fiscaldata.treasury.gov/", status: statusOf(us), detail: us.status === "rejected" ? reasonOf(us) : undefined },
    { name: "U.S. Treasury — auction results", url: "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/", status: statusOf(auctions), detail: auctions.status === "rejected" ? reasonOf(auctions) : undefined },
    { name: "ECB Data Portal — euro area yield curve", url: "https://data.ecb.europa.eu/", status: statusOf(benchmark), detail: benchmark.status === "rejected" ? reasonOf(benchmark) : undefined },
    { name: "ECB Data Portal — long-term interest rates", url: "https://data.ecb.europa.eu/", status: statusOf(sovereign), detail: sovereign.status === "rejected" ? reasonOf(sovereign) : undefined },
    { name: "Eurostat — long-term interest rates", url: "https://ec.europa.eu/eurostat/databrowser/view/irt_lt_mcby_m/", status: statusOf(eurostat), detail: eurostat.status === "rejected" ? reasonOf(eurostat) : undefined },
    { name: "OECD SDMX — long-term interest rates", url: "https://data-explorer.oecd.org/", status: statusOf(oecd), detail: oecd.status === "rejected" ? reasonOf(oecd) : undefined },
  ];

  return {
    instruments,
    sources,
    fetchedAt: new Date().toISOString(),
    degraded: sources.some((source) => source.status !== "ok"),
  };
}

/** Return the live catalogue, reusing the in-memory cache for ten minutes. */
export async function getTreasuryBondCatalogue(options: { force?: boolean } = {}): Promise<TreasuryBondCatalogue> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await buildCatalogue();
      // Only cache a catalogue that actually contains instruments, so a total
      // upstream outage does not pin an empty result for the whole TTL.
      if (value.instruments.length) cache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Look up a single instrument by its stable id, using the live catalogue. */
export async function findTreasuryBondInstrument(id: string): Promise<TreasuryBondInstrument | null> {
  const catalogue = await getTreasuryBondCatalogue();
  return catalogue.instruments.find((instrument) => instrument.id === id) ?? null;
}

/** Simple-interest profit for holding `principalMinor` at `ratePct` for `years`. */
export function projectTreasuryBondProfit(principalMinor: number, ratePct: number, years: number): number {
  if (!Number.isFinite(principalMinor) || principalMinor <= 0) return 0;
  if (!Number.isFinite(ratePct) || ratePct <= 0) return 0;
  if (!Number.isFinite(years) || years <= 0) return 0;
  return Math.floor((principalMinor * ratePct * years) / 100);
}

export function __resetTreasuryBondCacheForTest() {
  cache = null;
  inflight = null;
}
