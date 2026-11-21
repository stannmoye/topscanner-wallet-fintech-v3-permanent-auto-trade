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
 *  - Euro area AAA government benchmark yield curve — ECB Data Portal
 *    (dataflow `YC`, series key `B.U2.EUR.4F.G_N_A.SV_C_YM.<MATURITY>`).
 *  - Euro area sovereign 10-year government bond yields — ECB Data Portal
 *    (dataflow `IRS`, series key `M.<AREA>.L.L40.CI.0000.EUR.N.Z`).
 *
 * Nothing here is invented: when a source cannot be reached the provider fails
 * closed for that source and the desk reports the remaining, genuinely fetched
 * instruments (or an explicit "market data unavailable" state), never filler.
 */

export type TreasuryBondHistoryPoint = { t: string; v: number };

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
const CATALOGUE_TTL_MS = 10 * 60 * 1000;
const HISTORY_MONTHS = 12;
const REQUEST_TIMEOUT_MS = 15_000;

const flagFor = (countryCode: string) =>
  countryCode.length === 2
    ? String.fromCodePoint(...countryCode.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0)))
    : "🏳️";

/**
 * Fetch JSON from a public data source with a hard timeout and a single retry.
 * A retry resolves transient DNS/TLS hiccups and cold-start slowness seen on
 * managed hosts, which would otherwise silently drop a whole data source.
 */
async function json(url: string, attempt = 0): Promise<any> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Arbitrade-treasury-desk/1.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      return json(url, attempt + 1);
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
 * Catalogue assembly + cache
 * ------------------------------------------------------------------ */

let cache: { value: TreasuryBondCatalogue; expiresAt: number } | null = null;
let inflight: Promise<TreasuryBondCatalogue> | null = null;

const reasonOf = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : "";

async function buildCatalogue(): Promise<TreasuryBondCatalogue> {
  const [us, benchmark, sovereign] = await Promise.allSettled([
    fetchUsTreasuryInstruments(),
    fetchEuroAreaBenchmarkInstruments(),
    fetchEuSovereignInstruments(),
  ]);

  // Surface which source failed so production logs make an egress outage obvious.
  for (const [label, result] of [["US Treasury", us], ["EU benchmark", benchmark], ["EU sovereigns", sovereign]] as const) {
    if (result.status === "rejected") console.warn(`[TreasuryBonds] ${label} source failed: ${reasonOf(result)}`);
  }

  const instruments: TreasuryBondInstrument[] = [
    ...(us.status === "fulfilled" ? us.value : []),
    ...(benchmark.status === "fulfilled" ? benchmark.value : []),
    ...(sovereign.status === "fulfilled" ? sovereign.value : []),
  ];
  instruments.sort((a, b) => {
    const order: Record<string, number> = { BILL: 0, FRN: 1, TIPS: 2, NOTE: 3, BOND: 4, BENCHMARK: 5, SOVEREIGN: 6 };
    return (order[a.category] ?? 9) - (order[b.category] ?? 9) || b.couponRatePct - a.couponRatePct;
  });

  const statusOf = (result: PromiseSettledResult<unknown[]>) =>
    (result.status === "fulfilled" && result.value.length ? "ok" : "unavailable") as "ok" | "unavailable";

  const sources: TreasuryBondSource[] = [
    { name: "U.S. Treasury Fiscal Data API", url: "https://fiscaldata.treasury.gov/", status: statusOf(us), detail: us.status === "rejected" ? reasonOf(us) : undefined },
    { name: "ECB Data Portal — euro area yield curve", url: "https://data.ecb.europa.eu/", status: statusOf(benchmark), detail: benchmark.status === "rejected" ? reasonOf(benchmark) : undefined },
    { name: "ECB Data Portal — long-term interest rates", url: "https://data.ecb.europa.eu/", status: statusOf(sovereign), detail: sovereign.status === "rejected" ? reasonOf(sovereign) : undefined },
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
