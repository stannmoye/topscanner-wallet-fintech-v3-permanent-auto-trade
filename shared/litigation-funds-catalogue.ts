/**
 * Real, cited legal-claim data for the customer Litigation Funds desk.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server and, as a resilience fallback, in the customer's
 * browser. It is the DISCOVERY layer: every record is a candidate claim pulled
 * from a free, public, keyless-first source and tagged with the provider it came
 * from and the date it was observed. A raw court filing or enforcement notice is
 * a *candidate*, not a fundable instrument — the economics are added by the desk
 * administrator in the DOSSIER layer, which always cites the underlying source.
 *
 * Verified sources (keyless first):
 *  - United States — Federal Register enforcement notices (SEC, CFTC, DOJ, FTC):
 *    live, keyless, official publication of regulatory/enforcement actions.
 *  - United Kingdom — Find Case Law (The National Archives): live Atom feed of
 *    court and tribunal judgments, with the neutral citation and deciding court.
 *  - Norway — Brønnøysund Register Centre: companies declared bankrupt, whose
 *    estates are realised and where creditor claims are lodged.
 *  - United States / global — CourtListener (free API token): litigation and
 *    bankruptcy dockets. Activates only when a token is configured.
 *  - Context — Eurostat + World Bank: macroeconomic litigation/enforcement
 *    context for the countries represented.
 *
 * Sources that could not be used are reported honestly rather than faked:
 *  - SEC litigation-releases RSS is FROZEN at 2023-07-26 (the Commission retired
 *    the feed). It is therefore SKIPPED; live SEC enforcement is covered by the
 *    Federal Register instead.
 *  - DOJ press releases and SEC release pages block non-browser clients (403)
 *    behind the office network, so they are skipped.
 *  - UK Companies House insolvency search needs a free API key and is skipped
 *    unless one is configured (the Norwegian register covers the same ground
 *    keyless).
 *
 * Nothing here is invented. Public sources do not publish a claim's merit, the
 * damages sought, the capital at risk or an expected multiple, so those fields
 * are left null on discovery records and shown as "not modelled" until an
 * administrator publishes a dossier with real, sourced numbers.
 */

import { flagFor } from "./country-options";

export type LitigationStage =
  | "FILED"
  | "DISCOVERY"
  | "MEDIATION"
  | "TRIAL"
  | "JUDGMENT"
  | "ENFORCEMENT"
  | "DISTRIBUTION";

export type LitigationMeritGrade = "A" | "B" | "C" | "D" | "E";

export type LitigationRiskGrade = "PRIME" | "BALANCED" | "SPECULATIVE" | "HIGH_RISK";

export type LitigationDossierStatus = "FUNDING" | "ESCROW" | "ACTIVE" | "RESOLVED" | "WITHDRAWN";

export type LitigationOutcome = "SETTLE" | "WIN" | "LOSE";

/** One modelled outcome for a fundable dossier. Probabilities across the three sum to 10,000 bps. */
export type LitigationScenario = {
  outcome: LitigationOutcome;
  label: string;
  /** Probability weight in basis points; the three scenarios must sum to 10,000. */
  probabilityBps: number;
  /** Gross recovery to the fund in minor units of the settlement currency. */
  grossRecoveryMinor: number;
  /** Expected duration in whole months. */
  durationMonths: number;
  /** Payout multiple to funders in basis points (10,000 = 1.00x principal). */
  funderMultipleBps: number;
};

export type LitigationMilestone = {
  stage: LitigationStage;
  label: string;
  /** Share of escrow released at this milestone, in basis points. */
  releaseBps: number;
  status: "PENDING" | "REACHED";
  reachedAt: string | null;
};

export type LitigationCase = {
  /** Stable slug. Discovery ids are source-prefixed; admin ids start with `admin-`. */
  id: string;
  caseName: string;
  claimant: string;
  defendant: string;
  claimType: string;
  /** Human-readable jurisdiction label, e.g. "United States" or "England & Wales". */
  jurisdiction: string;
  countryCode: string;
  country: string;
  flag: string;
  court: string;
  counsel: string | null;
  meritGrade: LitigationMeritGrade | null;
  estimatedDamagesMinor: number | null;
  capitalAtRiskMinor: number | null;
  expectedMultipleBps: number | null;
  expectedDurationMonths: number | null;
  fundingAskMinor: number | null;
  committedMinor: number;
  /** Committed / ask in basis points. */
  fundedBps: number;
  stage: LitigationStage;
  status: LitigationDossierStatus;
  /** Plain-language claim/problem summary. */
  problem: string;
  /** Three outcome scenarios. Empty on discovery records. */
  scenarios: LitigationScenario[];
  /** Probability-weighted expected value in minor units, or null when unmodelled. */
  expectedValueMinor: number | null;
  fundingDeadline: string | null;
  remainingDays: number | null;
  milestones: LitigationMilestone[];
  /** Bundle membership, when the case is sold as part of a bundle. */
  bundleId: string | null;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  /** True only for records an administrator has reviewed and published. */
  verified: boolean;
  /** True only when an administrator has published scenarios and a funding target. */
  fundable: boolean;
  highlights: string[];
};

export type LitigationBundle = {
  id: string;
  name: string;
  claimType: string;
  jurisdiction: string;
  riskGrade: LitigationRiskGrade;
  targetMinor: number;
  committedMinor: number;
  /** Price of one unit in minor units. */
  unitPriceMinor: number;
  /** Total units offered. */
  unitCount: number;
  caseIds: string[];
  /** Per-case allocation weight in basis points, keyed by case id. Sums to 10,000. */
  allocationBpsByCase: Record<string, number>;
  expectedMultipleBps: number;
  expectedDurationMonths: number | null;
  summary: string;
  enabled: boolean;
  source: string;
  asOf: string;
};

export type LitigationFundsSource = {
  name: string;
  url: string;
  /** ISO-3166 alpha-2 the source primarily covers, or "XX" for global/EU. */
  country: string;
  role: "claims" | "dockets" | "context";
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type LitigationFundsCatalogue = {
  cases: LitigationCase[];
  sources: LitigationFundsSource[];
  fetchedAt: string;
  degraded: boolean;
};

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;
const SEC_UA = "Arbitrade-litigation-desk/1.0 (contact: info@wisebond.org)";

const FEDERAL_REGISTER = "https://www.federalregister.gov/api/v1/documents.json";
const UK_CASELAW = "https://caselaw.nationalarchives.gov.uk/atom.xml";
const NORWAY_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter";

const MERIT_ORDER: Record<LitigationMeritGrade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const STAGE_ORDER: Record<LitigationStage, number> = {
  FILED: 0, DISCOVERY: 1, MEDIATION: 2, TRIAL: 3, JUDGMENT: 4, ENFORCEMENT: 5, DISTRIBUTION: 6,
};
const STATUS_ORDER: Record<LitigationDossierStatus, number> = {
  FUNDING: 0, ESCROW: 1, ACTIVE: 2, RESOLVED: 3, WITHDRAWN: 4,
};

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

async function text(url: string, options: { accept?: string; headers?: Record<string, string>; body?: string } = {}, attempt = 0): Promise<string> {
  try {
    const response = await fetch(url, {
      method: options.body ? "POST" : "GET",
      headers: {
        Accept: options.accept || "*/*",
        "User-Agent": SEC_UA,
        ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(options.headers || {}),
      },
      body: options.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      return text(url, options, attempt + 1);
    }
    throw new Error(`${url} → ${error instanceof Error ? error.message : "request failed"}`);
  }
}

async function json(url: string, options: { headers?: Record<string, string> } = {}): Promise<any> {
  const body = await text(url, { accept: "application/json", ...options });
  return JSON.parse(body);
}

const clampText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const direct = raw.slice(0, 10);
  if (ISO_DATE.test(direct)) return direct;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));

/** Extract every `<tag>…</tag>` inner block from an XML document (namespace-tolerant). */
function xmlBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) out.push(match[1]);
  return out;
}

/** First inner text of `<tag>` in a block, entity-decoded, or "". */
function xmlText(block: string, tag: string): string {
  const match = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, "i").exec(block);
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s{2,}/g, " ").trim();
}

/** Attribute value from a `<tag … attr="value" …>` occurrence inside a block. */
function xmlAttr(block: string, tag: string, attr: string): string {
  const match = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*?\\b${attr}="([^"]*)"`, "i").exec(block);
  return match ? decodeEntities(match[1]).trim() : "";
}

const MONTH_MS = 30 * 86_400_000;

export function remainingDaysFor(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = Date.parse(deadline);
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/* ------------------------------------------------------------------ *
 * Ordered comparison — fundable cases first, then status, merit, progress
 * ------------------------------------------------------------------ */

export function compareLitigationCases(a: LitigationCase, b: LitigationCase): number {
  if (a.fundable !== b.fundable) return a.fundable ? -1 : 1;
  const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (status !== 0) return status;
  const merit = (a.meritGrade ? MERIT_ORDER[a.meritGrade] : 9) - (b.meritGrade ? MERIT_ORDER[b.meritGrade] : 9);
  if (merit !== 0) return merit;
  if (a.fundedBps !== b.fundedBps) return b.fundedBps - a.fundedBps;
  if (a.asOf !== b.asOf) return b.asOf.localeCompare(a.asOf);
  return a.caseName.localeCompare(b.caseName);
}

/** Probability-weighted expected value over the published scenarios. */
export function expectedValueMinor(scenarios: LitigationScenario[]): number | null {
  if (!scenarios.length) return null;
  const total = scenarios.reduce((sum, scenario) => sum + Math.round((scenario.grossRecoveryMinor * scenario.probabilityBps) / 10_000), 0);
  return total;
}

export function stageLabel(stage: LitigationStage): string {
  return stage.charAt(0) + stage.slice(1).toLowerCase();
}

const DEFAULT_MILESTONES: LitigationMilestone[] = (
  [
    ["FILED", "Filed", 1000],
    ["DISCOVERY", "Discovery", 3000],
    ["MEDIATION", "Mediation", 4500],
    ["TRIAL", "Trial", 6000],
    ["JUDGMENT", "Judgment", 8000],
    ["ENFORCEMENT", "Enforcement", 9500],
    ["DISTRIBUTION", "Distribution", 10000],
  ] as [LitigationStage, string, number][]
).map(([stage, label, releaseBps]) => ({ stage, label, releaseBps, status: "PENDING" as const, reachedAt: null }));

export function defaultMilestones(): LitigationMilestone[] {
  return DEFAULT_MILESTONES.map((milestone) => ({ ...milestone }));
}

/* ------------------------------------------------------------------ *
 * United States — Federal Register enforcement notices (keyless, live)
 * ------------------------------------------------------------------ */

const FR_AGENCIES = [
  "securities-and-exchange-commission",
  "commodity-futures-trading-commission",
  "justice-department",
  "federal-trade-commission",
];

const FR_AGENCY_LABELS: Record<string, string> = {
  "securities-and-exchange-commission": "U.S. Securities and Exchange Commission (SEC)",
  "commodity-futures-trading-commission": "U.S. Commodity Futures Trading Commission (CFTC)",
  "justice-department": "U.S. Department of Justice (DOJ)",
  "federal-trade-commission": "U.S. Federal Trade Commission (FTC)",
};

async function fetchFederalRegisterClaims(): Promise<LitigationCase[]> {
  const query = FR_AGENCIES.map((agency) => `conditions%5Bagencies%5D%5B%5D=${agency}`).join("&");
  const payload = await json(`${FEDERAL_REGISTER}?per_page=24&order=newest&conditions%5Btype%5D%5B%5D=NOTICE&${query}`, {
    headers: { "User-Agent": SEC_UA },
  });
  const rows: any[] = payload?.results || [];
  const cases: LitigationCase[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const number = clampText(row?.document_number, 40);
    const title = clampText(row?.title, 200);
    if (!number || title.length < 4 || seen.has(number)) continue;
    seen.add(number);
    const agencySlugs: string[] = (row?.agencies || []).map((agency: any) => String(agency?.raw_name || agency?.name || "").toLowerCase());
    const matched = FR_AGENCIES.find((slug) => agencySlugs.some((name) => name.includes(slug.split("-")[0])));
    const agencyKey = matched || FR_AGENCIES[0];
    const agencyLabel = FR_AGENCY_LABELS[agencyKey];
    const published = isoDate(row?.publication_date) || new Date().toISOString().slice(0, 10);
    const htmlUrl = clampText(row?.html_url, 300);
    const claimType = agencyKey === "securities-and-exchange-commission" ? "Securities enforcement action"
      : agencyKey === "commodity-futures-trading-commission" ? "Commodities enforcement action"
      : agencyKey === "federal-trade-commission" ? "Competition / consumer enforcement action"
      : "Federal enforcement action";
    cases.push({
      id: `us-fr-${number}`,
      caseName: title,
      claimant: agencyLabel,
      defendant: "Respondent named in the published notice",
      claimType,
      jurisdiction: "United States",
      countryCode: "US",
      country: "United States",
      flag: flagFor("US"),
      court: agencyLabel,
      counsel: null,
      meritGrade: null,
      estimatedDamagesMinor: null,
      capitalAtRiskMinor: null,
      expectedMultipleBps: null,
      expectedDurationMonths: null,
      fundingAskMinor: null,
      committedMinor: 0,
      fundedBps: 0,
      stage: "FILED",
      status: "FUNDING",
      problem: clampText(row?.abstract, 900) || `${agencyLabel} published ${claimType.toLowerCase()} “${title}”. Read the official notice for the full facts and parties.`,
      scenarios: [],
      expectedValueMinor: null,
      fundingDeadline: null,
      remainingDays: null,
      milestones: [],
      bundleId: null,
      source: `Federal Register · ${agencyLabel}`,
      sourceUrl: htmlUrl || null,
      asOf: published,
      verified: false,
      fundable: false,
      highlights: [
        `Agency: ${agencyLabel}`,
        `Published ${published}`,
        clampText(row?.type, 40) || "Notice",
      ],
    });
  }
  if (!cases.length) throw new Error("Federal Register returned no enforcement notices");
  return cases;
}

/* ------------------------------------------------------------------ *
 * United Kingdom — Find Case Law (The National Archives), keyless, live
 * ------------------------------------------------------------------ */

const UK_QUERIES: { q: string; claimType: string }[] = [
  { q: "breach of contract", claimType: "Commercial contract claim" },
  { q: "insolvency", claimType: "Insolvency / creditor claim" },
  { q: "fraud", claimType: "Fraud / misrepresentation claim" },
  { q: "negligence", claimType: "Negligence claim" },
  { q: "damages", claimType: "Damages claim" },
];

/** Deciding court from the neutral-citation slug, e.g. ewhc/admin → High Court. */
function ukCourtFromSlug(slug: string, fallback: string): string {
  const code = slug.split("/")[0].toLowerCase();
  const map: Record<string, string> = {
    ewhc: "High Court of England & Wales",
    ewca: "Court of Appeal of England & Wales",
    ewcop: "Court of Protection",
    ewtcc: "Tax and Chancery Chamber",
    ukpc: "Privy Council",
    uksc: "UK Supreme Court",
    ukut: "Upper Tribunal",
    ukftt: "First-tier Tribunal",
    tna: "Tribunal / court",
  };
  return map[code] || fallback || "UK court or tribunal";
}

async function fetchUkCaseLawClaims(): Promise<LitigationCase[]> {
  const settled = await Promise.allSettled(
    UK_QUERIES.slice(0, 4).map((query) => text(`${UK_CASELAW}?query=${encodeURIComponent(query.q)}`, { accept: "application/atom+xml" })),
  );

  const cases: LitigationCase[] = [];
  const seen = new Set<string>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = UK_QUERIES[index];
    for (const entry of xmlBlocks(result.value, "entry")) {
      const title = clampText(xmlText(entry, "title"), 200);
      const link = xmlAttr(entry, "link", "href");
      const slug = clampText(xmlAttr(entry, "identifier", "slug"), 80);
      const citation = clampText(xmlText(entry, "identifier"), 60);
      const id = slug || link;
      if (!title || !id || seen.has(id)) continue;
      seen.add(id);
      const published = isoDate(xmlText(entry, "published")) || isoDate(xmlText(entry, "updated"));
      const courtName = ukTextCourt(entry);
      const [plaintiff, defendant] = title.split(/\s+v\s+/i);
      cases.push({
        id: `uk-cl-${id.replace(/[^A-Za-z0-9]+/g, "-")}`,
        caseName: title,
        claimant: clampText(plaintiff, 160) || "Claimant (see judgment)",
        defendant: clampText(defendant, 160) || "Defendant (see judgment)",
        claimType: query.claimType,
        jurisdiction: "United Kingdom",
        countryCode: "GB",
        country: "United Kingdom",
        flag: flagFor("GB"),
        court: ukCourtFromSlug(slug, courtName),
        counsel: null,
        meritGrade: null,
        estimatedDamagesMinor: null,
        capitalAtRiskMinor: null,
        expectedMultipleBps: null,
        expectedDurationMonths: null,
        fundingAskMinor: null,
        committedMinor: 0,
        fundedBps: 0,
        stage: published ? "JUDGMENT" : "FILED",
        status: "FUNDING",
        problem: `Published judgment “${title}” in a ${query.claimType.toLowerCase()}, decided by ${ukCourtFromSlug(slug, courtName)}${citation ? ` (${citation})` : ""}. Read the judgment for the full facts and outcome.`,
        scenarios: [],
        expectedValueMinor: null,
        fundingDeadline: null,
        remainingDays: null,
        milestones: [],
        bundleId: null,
        source: "Find Case Law (The National Archives)",
        sourceUrl: link || null,
        asOf: published || new Date().toISOString().slice(0, 10),
        verified: false,
        fundable: false,
        highlights: [
          `Court: ${ukCourtFromSlug(slug, courtName)}`,
          citation ? `Citation ${citation}` : "Citation not published",
          published ? `Published ${published}` : "Publication date not published",
        ],
      });
    }
  });
  if (!cases.length) throw new Error("Find Case Law returned no judgments");
  return cases;
}

function ukTextCourt(entry: string): string {
  const author = xmlText(entry, "author");
  const name = /<name>([\s\S]*?)<\/name>/i.exec(author);
  return decodeEntities(name ? name[1] : author).trim();
}

/* ------------------------------------------------------------------ *
 * Norway — Brønnøysund Register Centre (bankruptcy estates)
 * ------------------------------------------------------------------ */

type NoEnhet = {
  navn?: string;
  organisasjonsnummer?: string;
  organisasjonsform?: { beskrivelse?: string };
  naeringskode1?: { beskrivelse?: string };
  forretningsadresse?: { kommune?: string; poststed?: string };
  konkursdato?: string;
  registreringsdatoEnhetsregisteret?: string;
};

async function fetchNorwayClaims(): Promise<LitigationCase[]> {
  const payload = await json(`${NORWAY_BASE}?konkurs=true&size=20`, { headers: { "User-Agent": SEC_UA } });
  const rows: NoEnhet[] = payload?._embedded?.enheter || [];
  const cases: LitigationCase[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = clampText(row.navn, 160);
    const org = clampText(row.organisasjonsnummer, 20);
    if (!name || !org || seen.has(org)) continue;
    seen.add(org);
    const declared = isoDate(row.konkursdato);
    cases.push({
      id: `no-brreg-${org}`,
      caseName: `${name} — bankruptcy estate`,
      claimant: "Estate creditors (see register)",
      defendant: name,
      claimType: "Insolvency / creditor claim",
      jurisdiction: "Norway",
      countryCode: "NO",
      country: "Norway",
      flag: flagFor("NO"),
      court: "Insolvency estate (Norway)",
      counsel: null,
      meritGrade: null,
      estimatedDamagesMinor: null,
      capitalAtRiskMinor: null,
      expectedMultipleBps: null,
      expectedDurationMonths: null,
      fundingAskMinor: null,
      committedMinor: 0,
      fundedBps: 0,
      stage: "ENFORCEMENT",
      status: "FUNDING",
      problem: `${name} is a Norwegian ${clampText(row.organisasjonsform?.beskrivelse, 80) || "registered entity"} declared bankrupt${declared ? ` on ${declared}` : ""}. The estate is being realised and creditor claims are being lodged and recovered.`,
      scenarios: [],
      expectedValueMinor: null,
      fundingDeadline: null,
      remainingDays: null,
      milestones: [],
      bundleId: null,
      source: "Brønnøysund Register Centre (Enhetsregisteret)",
      sourceUrl: `https://data.brreg.no/enhetsregisteret/api/enheter/${org}`,
      asOf: declared || isoDate(row.registreringsdatoEnhetsregisteret) || new Date().toISOString().slice(0, 10),
      verified: false,
      fundable: false,
      highlights: [
        "Registry status: bankrupt (konkurs)",
        declared ? `Declared ${declared}` : "Declaration date not published",
        clampText(row?.naeringskode1?.beskrivelse, 80) || "Sector not published",
      ],
    });
  }
  if (!cases.length) throw new Error("Brønnøysund Register Centre returned no bankruptcy estates");
  return cases;
}

/* ------------------------------------------------------------------ *
 * United States / global — CourtListener dockets (free token, fail closed)
 * ------------------------------------------------------------------ */

const COURT_LISTENER_QUERIES: { q: string; claimType: string }[] = [
  { q: "breach of contract", claimType: "Commercial contract claim" },
  { q: "class action", claimType: "Class action" },
  { q: "securities", claimType: "Securities claim" },
];

async function fetchCourtListenerClaims(): Promise<LitigationCase[]> {
  const token = envKey("COURTLISTENER_API_TOKEN");
  if (!token) throw new Error("CourtListener token not configured (set COURTLISTENER_API_TOKEN)");
  const settled = await Promise.allSettled(
    COURT_LISTENER_QUERIES.map((query) =>
      json(`https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(query.q)}&type=r&order_by=dateFiled+desc`, {
        headers: { Authorization: `Token ${token}` },
      }),
    ),
  );
  const cases: LitigationCase[] = [];
  const seen = new Set<string>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = COURT_LISTENER_QUERIES[index];
    const rows: any[] = result.value?.results || [];
    for (const row of rows) {
      const name = clampText(row?.caseName, 200);
      const docketId = clampText(row?.docket_id || row?.id, 40);
      if (!name || !docketId || seen.has(docketId)) continue;
      seen.add(docketId);
      const filed = isoDate(row?.dateFiled);
      const docketNumber = clampText(row?.docketNumber, 60);
      const [plaintiff, defendant] = name.split(/\s+v\.?\s+/i);
      cases.push({
        id: `us-cl-${docketId}`,
        caseName: name,
        claimant: clampText(plaintiff, 160) || "Plaintiff (see docket)",
        defendant: clampText(defendant, 160) || "Defendant (see docket)",
        claimType: query.claimType,
        jurisdiction: "United States",
        countryCode: "US",
        country: "United States",
        flag: flagFor("US"),
        court: clampText(row?.court, 120) || "US federal court",
        counsel: clampText(row?.firm, 160) || null,
        meritGrade: null,
        estimatedDamagesMinor: null,
        capitalAtRiskMinor: null,
        expectedMultipleBps: null,
        expectedDurationMonths: null,
        fundingAskMinor: null,
        committedMinor: 0,
        fundedBps: 0,
        stage: filed ? "FILED" : "FILED",
        status: "FUNDING",
        problem: `CourtListener records a ${query.claimType.toLowerCase()} docket “${name}”${filed ? ` filed ${filed}` : ""}${docketNumber ? ` (docket ${docketNumber})` : ""} in ${clampText(row?.court, 120) || "a US federal court"}. Read the docket for the full facts and parties.`,
        scenarios: [],
        expectedValueMinor: null,
        fundingDeadline: null,
        remainingDays: null,
        milestones: [],
        bundleId: null,
        source: "CourtListener",
        sourceUrl: clampText(row?.absolute_url, 200) ? `https://www.courtlistener.com${clampText(row.absolute_url, 200)}` : null,
        asOf: filed || new Date().toISOString().slice(0, 10),
        verified: false,
        fundable: false,
        highlights: [
          clampText(row?.court, 120) || "US federal court",
          docketNumber ? `Docket ${docketNumber}` : "Docket number not published",
          filed ? `Filed ${filed}` : "Filing date not published",
        ],
      });
    }
  });
  if (!cases.length) throw new Error("CourtListener returned no litigation dockets");
  return cases;
}

/* ------------------------------------------------------------------ *
 * Context — Eurostat + World Bank (keyless, live)
 * ------------------------------------------------------------------ */

export type LitigationFundsContext = {
  eurostatEnforcementDeclarations: { geo: string; period: string; value: number }[];
  worldBank: { country: string; incomeLevel: string; region: string }[];
};

async function fetchEurostatContext(): Promise<LitigationFundsContext["eurostatEnforcementDeclarations"]> {
  const payload = await json("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_cobp_q?format=JSON&lastTimePeriod=1&indic_bt=BR&unit=NR&geo=EU27_2020");
  const values: Record<string, number> = payload?.value || {};
  const keys = Object.keys(values);
  if (!keys.length) return [];
  const latest = Number(values[keys[keys.length - 1]]);
  const timeIndex: Record<string, number> = payload?.dimension?.time?.category?.index || {};
  const timeLabels: Record<string, string> = payload?.dimension?.time?.category?.label || {};
  const timeCodes = Object.keys(timeIndex);
  const periodCode = timeCodes[timeCodes.length - 1] || "";
  return [{ geo: "EU27", period: timeLabels[periodCode] || periodCode, value: latest }];
}

async function fetchWorldBankContext(): Promise<LitigationFundsContext["worldBank"]> {
  const payload = await json("https://api.worldbank.org/v2/country?format=json&per_page=400");
  const rows: any[] = Array.isArray(payload?.[1]) ? payload[1] : [];
  return rows
    .filter((row) => /^[A-Z]{2}$/.test(String(row?.id || "")))
    .map((row) => ({
      country: String(row.id),
      incomeLevel: clampText(row?.incomeLevel?.value, 60) || "n/a",
      region: clampText(row?.region?.value, 60) || "n/a",
    }));
}

/* ------------------------------------------------------------------ *
 * Assembly + cache
 * ------------------------------------------------------------------ */

let cache: { value: LitigationFundsCatalogue; expiresAt: number } | null = null;
let inflight: Promise<LitigationFundsCatalogue> | null = null;

const FR_UNTIL = 0;

const reasonOf = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : "";

function sourceStatus(result: PromiseSettledResult<unknown>): "ok" | "degraded" | "unavailable" {
  if (result.status === "rejected") return "unavailable";
  const value = result.value;
  if (Array.isArray(value)) return value.length ? "ok" : "degraded";
  return "ok";
}

async function buildCatalogue(): Promise<LitigationFundsCatalogue> {
  const [federalRegister, uk, norway, courtlistener, eurostat, worldBank] = await Promise.allSettled([
    fetchFederalRegisterClaims(),
    fetchUkCaseLawClaims(),
    fetchNorwayClaims(),
    fetchCourtListenerClaims(),
    fetchEurostatContext(),
    fetchWorldBankContext(),
  ]);

  for (const [label, result] of [
    ["Federal Register", federalRegister], ["Find Case Law", uk], ["Brønnøysund", norway],
    ["CourtListener", courtlistener], ["Eurostat", eurostat], ["World Bank", worldBank],
  ] as const) {
    if (result.status === "rejected") console.warn(`[LitigationFunds] ${label} source failed: ${reasonOf(result)}`);
  }

  const raw: LitigationCase[] = [
    ...(federalRegister.status === "fulfilled" ? federalRegister.value : []),
    ...(uk.status === "fulfilled" ? uk.value : []),
    ...(norway.status === "fulfilled" ? norway.value : []),
    ...(courtlistener.status === "fulfilled" ? courtlistener.value : []),
  ];

  const seen = new Set<string>();
  const cases = raw.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  cases.sort(compareLitigationCases);

  const sources: LitigationFundsSource[] = [
    { name: "Federal Register (United States enforcement notices)", url: "https://www.federalregister.gov/developers/api/v1", country: "US", role: "claims", status: sourceStatus(federalRegister), detail: federalRegister.status === "rejected" ? reasonOf(federalRegister) : "SEC, CFTC, DOJ and FTC notices" },
    { name: "Find Case Law (The National Archives, UK)", url: UK_CASELAW, country: "GB", role: "claims", status: sourceStatus(uk), detail: uk.status === "rejected" ? reasonOf(uk) : "Court and tribunal judgments" },
    { name: "Brønnøysund Register Centre (Norway)", url: "https://data.brreg.no/enhetsregisteret/api", country: "NO", role: "claims", status: sourceStatus(norway), detail: norway.status === "rejected" ? reasonOf(norway) : "Bankruptcy estates and creditor claims" },
    { name: "CourtListener (United States / global dockets)", url: "https://www.courtlistener.com/api/rest/v4/", country: "US", role: "dockets", status: sourceStatus(courtlistener), detail: courtlistener.status === "rejected" ? reasonOf(courtlistener) : "Litigation and bankruptcy dockets" },
    { name: "Eurostat business bankruptcies (EU)", url: "https://ec.europa.eu/eurostat/databrowser/view/sts_cobp_q/", country: "XX", role: "context", status: sourceStatus(eurostat), detail: eurostat.status === "rejected" ? reasonOf(eurostat) : "Declared bankruptcies, latest quarter" },
    { name: "World Bank country API (context)", url: "https://api.worldbank.org/v2/country", country: "XX", role: "context", status: sourceStatus(worldBank), detail: worldBank.status === "rejected" ? reasonOf(worldBank) : "Income level and region" },
    { name: "SEC litigation-releases RSS (skipped)", url: "https://www.sec.gov/rss/litigation/litreleases.xml", country: "US", role: "claims", status: "unavailable", detail: "Frozen at 2023-07-26; live SEC enforcement is covered by the Federal Register" },
    { name: "DOJ press releases (skipped)", url: "https://www.justice.gov/news", country: "US", role: "claims", status: "unavailable", detail: "Blocks non-browser clients (HTTP 403); skipped rather than spoofed" },
  ];

  return {
    cases,
    sources,
    fetchedAt: new Date().toISOString(),
    degraded: sources.some((source) => source.status !== "ok"),
  };
}

/** Return the live catalogue, reusing the in-memory cache for ten minutes. */
export async function getLitigationFundsCatalogue(options: { force?: boolean } = {}): Promise<LitigationFundsCatalogue> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await buildCatalogue();
      if (value.cases.length) cache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Look up a single live case by its stable id. */
export async function findLitigationCase(id: string): Promise<LitigationCase | null> {
  const catalogue = await getLitigationFundsCatalogue();
  return catalogue.cases.find((item) => item.id === id) ?? null;
}

export function __resetLitigationFundsCacheForTest() {
  cache = null;
  inflight = null;
}

export const LITIGATION_STAGES: readonly LitigationStage[] = ["FILED", "DISCOVERY", "MEDIATION", "TRIAL", "JUDGMENT", "ENFORCEMENT", "DISTRIBUTION"];
export const LITIGATION_MERIT_GRADES: readonly LitigationMeritGrade[] = ["A", "B", "C", "D", "E"];
export const LITIGATION_RISK_GRADES: readonly LitigationRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];
export const LITIGATION_DOSSIER_STATUSES: readonly LitigationDossierStatus[] = ["FUNDING", "ESCROW", "ACTIVE", "RESOLVED", "WITHDRAWN"];
export const LITIGATION_OUTCOMES: readonly LitigationOutcome[] = ["SETTLE", "WIN", "LOSE"];
export const MONTHS_TO_MS = MONTH_MS;
export { MERIT_ORDER as LITIGATION_MERIT_ORDER, STAGE_ORDER as LITIGATION_STAGE_ORDER, STATUS_ORDER as LITIGATION_STATUS_ORDER };
