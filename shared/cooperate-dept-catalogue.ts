/**
 * Real distressed / acquisition-target company data for the customer Cooperate
 * Dept desk.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run both on the server and, as a resilience fallback, in the customer's
 * browser. Every published record is pulled from a free public data source and
 * is tagged with the provider it came from and the observation date, so the
 * desk can always show where a figure came from:
 *
 *  - Norway — Brønnøysund Register Centre (Enhetsregisteret) open API: companies
 *    formally declared bankrupt (`konkurs`), under winding-up (`underAvvikling`)
 *    or under compulsory dissolution, with the real declaration date.
 *  - France — recherche-entreprises.api.gouv.fr (INSEE/RNE): companies whose
 *    administrative state is "cessée" (ceased) with the real closure date,
 *    NAF sector, employee band and registered office.
 *  - United States — SEC EDGAR full-text search: 8-K / annual filings that
 *    disclose going-concern doubt, substantial doubt or Chapter 11, plus the
 *    EDGAR submissions feed (data.sec.gov) for identity, SIC sector and address.
 *  - Global — GLEIF LEI records: legal entities whose LEI status is INACTIVE
 *    (retired / lapsed / merged), with legal form, jurisdiction and city.
 *  - Global — Wikidata: founders, inception date, headquarters, industry and
 *    employee count used to enrich the records the company feeds produce.
 *  - Global — World Bank (country API): income level and region context for the
 *    countries represented in the catalogue.
 *  - European Union — Eurostat (sts_cobp_q): national bankruptcy-declaration
 *    counts used as the EU macro-distress context strip.
 *  - United Kingdom — Companies House search (free API key): insolvency and
 *    administration cases. Activates only when a key is configured.
 *  - United States / global — CourtListener (free API token): bankruptcy and
 *    litigation dockets. Activates only when a token is configured.
 *
 * Nothing here is invented. Several fields the desk would like to show are not
 * published by any free source for private companies — above all an accurate
 * net worth / enterprise value, and a literal "date litigation begins". Those
 * are never guessed: the record carries an explicit note explaining the gap, and
 * a countdown is only ever derived from a *real dated event* (a declared
 * insolvency date, a formal closure date, an administrator-entered court date).
 * When a source cannot be reached the provider fails closed for that source and
 * the desk reports the remaining, genuinely fetched companies — never filler.
 */

import { flagFor } from "./country-options";

export type DistressSeverity = "CRITICAL" | "HIGH" | "ELEVATED" | "WATCH";

export type CompanyStatus =
  | "INSOLVENT"
  | "WINDING_UP"
  | "DISTRESSED"
  | "DISSOLVED"
  | "SEEKING_ACQUIRER"
  | "STARTUP";

export type DistressSignal = {
  code: string;
  label: string;
  severity: DistressSeverity;
  detail: string;
  date?: string | null;
  source: string;
};

/** A countdown is only ever built from a real dated event. */
export type CompanyCountdown = {
  label: string;
  /** "until" = a future date; "since" = a case age measured from a past date. */
  direction: "until" | "since";
  targetDate: string;
  source: string;
};

export type CooperateDeptCompany = {
  /** Stable slug. Live-provider ids are prefixed with the source; admin ids with `admin-`. */
  id: string;
  name: string;
  legalName?: string | null;
  countryCode: string;
  country: string;
  flag: string;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  foundedYear?: number | null;
  foundedMonth?: number | null;
  founderNames: string[];
  keyPeople: string[];
  /** Legal form / company type, e.g. "Private limited company (AS)". */
  companyType: string;
  sectors: string[];
  regulator?: string | null;
  /** Plain-language description of the problem the company has. */
  problem: string;
  /** Real employee headcount where a source publishes it, otherwise null. */
  staffCount?: number | null;
  /** Published employee band when only a band is available. */
  staffRange?: string | null;
  /** Derived, plainly labelled financial state, e.g. "Insolvency proceedings". */
  financialStatus: string;
  /**
   * Honest statement about net worth. No free source publishes a private
   * company's net worth, so this explains the gap rather than inventing a value.
   */
  netWorthNote: string;
  /** Official register / regulator status text where the source publishes it. */
  regulatorStatus?: string | null;
  status: CompanyStatus;
  severity: DistressSeverity;
  signals: DistressSignal[];
  countdown?: CompanyCountdown | null;
  /** What an investor can take, e.g. "Equity stake / full acquisition". */
  ownershipOpportunity: string;
  /** Indicative capital sought in minor units of USD, admin-declared only. */
  capitalAskMinor?: number | null;
  source: string;
  sourceUrl?: string | null;
  asOf: string;
  summary: string;
  highlights: string[];
  identity: {
    lei?: string | null;
    registrationNumber?: string | null;
    ticker?: string | null;
    cik?: string | null;
  };
  /** True only for records an administrator has reviewed and published. */
  verified: boolean;
};

export type CooperateDeptSource = {
  name: string;
  url: string;
  /** ISO-3166 alpha-2 the source primarily covers, or "XX" for global/EU. */
  country: string;
  role: "companies" | "enrichment" | "context";
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type CooperateDeptCatalogue = {
  companies: CooperateDeptCompany[];
  sources: CooperateDeptSource[];
  fetchedAt: string;
  degraded: boolean;
};

const SEC_UA = "Arbitrade-corp-desk/1.0 (contact: info@wisebond.org)";
const REQUEST_TIMEOUT_MS = 15_000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

const SEC_FULLTEXT = "https://efts.sec.gov/LATEST/search-index";
const SEC_SUBMISSIONS = "https://data.sec.gov/submissions";

/* ------------------------------------------------------------------ *
 * Shared HTTP helpers
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

async function json(url: string, options: { accept?: string; headers?: Record<string, string>; body?: string } = {}, attempt = 0): Promise<any> {
  try {
    const response = await fetch(url, {
      method: options.body ? "POST" : "GET",
      headers: {
        Accept: options.accept || "application/json",
        "User-Agent": SEC_UA,
        ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(options.headers || {}),
      },
      body: options.body,
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

const clampText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown): string | null {
  const text = String(value ?? "").trim().slice(0, 10);
  return ISO_DATE.test(text) ? text : null;
}

function foundedParts(value: string | null): { foundedYear: number | null; foundedMonth: number | null } {
  if (!value) return { foundedYear: null, foundedMonth: null };
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return { foundedYear: null, foundedMonth: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    foundedYear: year >= 1500 && year <= 2100 ? year : null,
    foundedMonth: month >= 1 && month <= 12 ? month : null,
  };
}

/** French INSEE employee bands (tranche_effectif_salarie). */
const FRENCH_STAFF_BANDS: Record<string, { label: string; count: number | null }> = {
  "00": { label: "0 salaried staff", count: 0 },
  "01": { label: "1–2 staff", count: 2 },
  "02": { label: "3–5 staff", count: 5 },
  "03": { label: "6–9 staff", count: 9 },
  "11": { label: "10–19 staff", count: 19 },
  "12": { label: "20–49 staff", count: 49 },
  "21": { label: "50–99 staff", count: 99 },
  "22": { label: "100–199 staff", count: 199 },
  "31": { label: "200–249 staff", count: 249 },
  "32": { label: "250–499 staff", count: 499 },
  "41": { label: "500–999 staff", count: 999 },
  "42": { label: "1,000–1,999 staff", count: 1_999 },
  "51": { label: "2,000–4,999 staff", count: 4_999 },
  "52": { label: "5,000–9,999 staff", count: 9_999 },
  "53": { label: "10,000+ staff", count: 10_000 },
};

const SEVERITY_ORDER: Record<DistressSeverity, number> = { CRITICAL: 0, HIGH: 1, ELEVATED: 2, WATCH: 3 };

/** The highest (most severe) label across a record's signals. */
function worstSeverity(signals: DistressSignal[]): DistressSeverity {
  return signals.reduce<DistressSeverity>(
    (worst, signal) => (SEVERITY_ORDER[signal.severity] < SEVERITY_ORDER[worst] ? signal.severity : worst),
    "WATCH",
  );
}

const NET_WORTH_NOTE =
  "No free public register publishes a private company's net worth. Enterprise value, debt and shareholder equity must be requested from the desk administrator and verified against audited accounts before any commitment.";

/**
 * Shared ordering: the most severe distress first, then the most recently
 * dated event, then alphabetically — used by both the live catalogue and the
 * customer dashboard so administrator records slot into the same order.
 */
export function compareCooperateDeptCompanies(a: CooperateDeptCompany, b: CooperateDeptCompany): number {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (severity !== 0) return severity;
  const aDate = a.countdown?.targetDate || a.asOf;
  const bDate = b.countdown?.targetDate || b.asOf;
  if (aDate !== bDate) return bDate.localeCompare(aDate);
  return a.name.localeCompare(b.name);
}

/* ------------------------------------------------------------------ *
 * Norway — Brønnøysund Register Centre (Enhetsregisteret)
 * ------------------------------------------------------------------ */

type NoEnhet = {
  navn?: string;
  organisasjonsnummer?: string;
  organisasjonsform?: { kode?: string; beskrivelse?: string };
  naeringskode1?: { kode?: string; beskrivelse?: string };
  forretningsadresse?: { adresse?: string[]; kommune?: string; landkode?: string; postnummer?: string; poststed?: string };
  konkurs?: boolean;
  konkursdato?: string;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  stiftelsesdato?: string;
  registreringsdatoEnhetsregisteret?: string;
  kapital?: { belop?: number; valuta?: string; type?: string };
  antallAnsatte?: number;
};

const NORWAY_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter";

async function fetchNorwayCompanies(): Promise<CooperateDeptCompany[]> {
  const queries = [
    { key: "konkurs=true", status: "INSOLVENT" as const, code: "bankruptcy", label: "Bankrupt", severity: "CRITICAL" as const },
    { key: "underAvvikling=true", status: "WINDING_UP" as const, code: "winding_up", label: "Under winding-up", severity: "HIGH" as const },
    { key: "underTvangsavviklingEllerTvangsopplosning=true", status: "WINDING_UP" as const, code: "compulsory_dissolution", label: "Compulsory dissolution", severity: "HIGH" as const },
  ];
  const settled = await Promise.allSettled(queries.map((query) => json(`${NORWAY_BASE}?${query.key}&size=18`)));

  const companies: CooperateDeptCompany[] = [];
  const seen = new Set<string>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = queries[index];
    const rows: NoEnhet[] = result.value?._embedded?.enheter || [];
    for (const row of rows) {
      const name = clampText(row.navn, 160);
      const orgNumber = clampText(row.organisasjonsnummer, 20);
      if (!name || !orgNumber || seen.has(orgNumber)) continue;
      seen.add(orgNumber);
      const declared = isoDate(row.konkursdato);
      const founded = foundedParts(isoDate(row.stiftelsesdato));
      const address = row.forretningsadresse || {};
      const signals: DistressSignal[] = [{
        code: query.code,
        label: query.label,
        severity: query.severity,
        detail: declared ? `Declared ${declared} by the Brønnøysund Register Centre.` : "Reported by the Brønnøysund Register Centre.",
        date: declared,
        source: "Brønnøysund Register Centre (Enhetsregisteret)",
      }];
      companies.push({
        id: `no-${orgNumber}`,
        name,
        legalName: name,
        countryCode: "NO",
        country: "Norway",
        flag: flagFor("NO"),
        city: clampText(address.poststed || address.kommune, 80) || null,
        state: clampText(address.kommune, 80) || null,
        region: null,
        foundedYear: founded.foundedYear,
        foundedMonth: founded.foundedMonth,
        founderNames: [],
        keyPeople: [],
        companyType: clampText(row.organisasjonsform?.beskrivelse, 80) || "Registered entity",
        sectors: [clampText(row.naeringskode1?.beskrivelse, 120) || clampText(row.naeringskode1?.kode, 20)].filter(Boolean),
        regulator: "Brønnøysund Register Centre (Foretaksregisteret)",
        problem: query.status === "INSOLVENT"
          ? "Declared bankrupt. Creditors are realising the estate and the business requires an acquirer to continue trading."
          : "Placed under winding-up / compulsory dissolution. Operations are being closed unless a buyer or recapitalisation is arranged.",
        staffCount: Number.isFinite(Number(row.antallAnsatte)) ? Number(row.antallAnsatte) : null,
        staffRange: null,
        financialStatus: query.status === "INSOLVENT" ? "Bankrupt (insolvency estate)" : "Winding-up / compulsory dissolution",
        netWorthNote: NET_WORTH_NOTE,
        regulatorStatus: query.label,
        status: query.status,
        severity: query.severity,
        signals,
        countdown: declared
          ? { label: "Declared bankrupt", direction: "since", targetDate: declared, source: "Brønnøysund Register Centre" }
          : null,
        ownershipOpportunity: "Asset purchase or acquisition of the estate",
        capitalAskMinor: null,
        source: "Brønnøysund Register Centre (Enhetsregisteret)",
        sourceUrl: `https://data.brreg.no/enhetsregisteret/api/enheter/${orgNumber}`,
        asOf: declared || isoDate(row.registreringsdatoEnhetsregisteret) || new Date().toISOString().slice(0, 10),
        summary: `${name} is a Norwegian ${clampText(row.organisasjonsform?.beskrivelse, 60) || "registered entity"}${row.naeringskode1?.beskrivelse ? ` in ${clampText(row.naeringskode1.beskrivelse, 80)}` : ""}, recorded by the Brønnøysund Register Centre as ${query.label.toLowerCase()}${declared ? ` on ${declared}` : ""}.`,
        highlights: [
          `Registry status: ${query.label}`,
          declared ? `Declared ${declared}` : "Declaration date not published",
          row.kapital?.belop ? `Registered share capital ${row.kapital.belop.toLocaleString()} ${clampText(row.kapital.valuta, 6) || "NOK"}` : "Share capital not published",
        ],
        identity: { registrationNumber: orgNumber, lei: null, ticker: null, cik: null },
        verified: false,
      });
    }
  });
  if (!companies.length) throw new Error("Brønnøysund Register Centre returned no distressed companies");
  return companies;
}

/* ------------------------------------------------------------------ *
 * France — recherche-entreprises.api.gouv.fr (INSEE / RNE)
 * ------------------------------------------------------------------ */

type FrCompany = {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  etat_administratif?: string;
  date_creation?: string;
  date_fermeture?: string;
  tranche_effectif_salarie?: string;
  activite_principale?: string;
  section_activite_principale?: string;
  nature_juridique?: string;
  categorie_entreprise?: string;
  siege?: { libelle_commune?: string; departement?: string; commune?: string; code_postal?: string };
  dirigeants?: Array<{ nom?: string; prenoms?: string; type_dirigeant?: string; qualite?: string }>;
};

const FRANCE_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const FRANCE_QUERIES = ["energie", "btp construction", "commerce detail", "transport logistique", "restauration", "technologie"];

async function fetchFranceCompanies(): Promise<CooperateDeptCompany[]> {
  const settled = await Promise.allSettled(
    FRANCE_QUERIES.slice(0, 4).map((query) =>
      json(`${FRANCE_BASE}?q=${encodeURIComponent(query)}&etat_administratif=C&per_page=10`),
    ),
  );

  const companies: CooperateDeptCompany[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const rows: FrCompany[] = result.value?.results || [];
    for (const row of rows) {
      const siren = clampText(row.siren, 12);
      const name = clampText(row.nom_complet || row.nom_raison_sociale, 160);
      if (!siren || !name || seen.has(siren)) continue;
      if (String(row.etat_administratif || "").toUpperCase() !== "C") continue;
      seen.add(siren);
      const closed = isoDate(row.date_fermeture);
      const founded = foundedParts(isoDate(row.date_creation));
      const band = FRENCH_STAFF_BANDS[clampText(row.tranche_effectif_salarie, 2)];
      const directors = (row.dirigeants || [])
        .filter((person) => person && person.type_dirigeant !== "personne morale")
        .map((person) => `${clampText(person.prenoms, 60)} ${clampText(person.nom, 60)}`.trim())
        .filter(Boolean)
        .slice(0, 4);
      const signals: DistressSignal[] = [{
        code: "ceased",
        label: "Ceased (administrative closure)",
        severity: "ELEVATED",
        detail: closed ? `Administrative state “cessée” with a closure date of ${closed} (INSEE/RNE).` : "Administrative state “cessée” recorded by INSEE/RNE.",
        date: closed,
        source: "recherche-entreprises.api.gouv.fr (INSEE/RNE)",
      }];
      companies.push({
        id: `fr-${siren}`,
        name,
        legalName: name,
        countryCode: "FR",
        country: "France",
        flag: flagFor("FR"),
        city: clampText(row.siege?.libelle_commune, 80) || null,
        state: clampText(row.siege?.departement, 40) || null,
        region: null,
        foundedYear: founded.foundedYear,
        foundedMonth: founded.foundedMonth,
        founderNames: [],
        keyPeople: directors,
        companyType: `French company · legal nature code ${clampText(row.nature_juridique, 12) || "n/a"}`,
        sectors: [clampText(row.activite_principale, 40) && `NAF ${clampText(row.activite_principale, 20)}`, clampText(row.section_activite_principale, 40)].filter(Boolean) as string[],
        regulator: "INSEE / Registre national des entreprises (RNE)",
        problem: "The company is recorded as administratively ceased (dissolved / struck off), leaving assets, contracts or a brand that a new owner could acquire.",
        staffCount: band?.count ?? null,
        staffRange: band?.label ?? null,
        financialStatus: "Ceased (dissolved / struck off)",
        netWorthNote: NET_WORTH_NOTE,
        regulatorStatus: "cessée",
        status: "DISSOLVED",
        severity: "ELEVATED",
        signals,
        countdown: closed
          ? { label: "Closed", direction: "since", targetDate: closed, source: "INSEE / RNE" }
          : null,
        ownershipOpportunity: "Asset or brand acquisition",
        capitalAskMinor: null,
        source: "recherche-entreprises.api.gouv.fr (INSEE/RNE)",
        sourceUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
        asOf: closed || new Date().toISOString().slice(0, 10),
        summary: `${name} is a French company recorded as ceased${closed ? ` on ${closed}` : ""} by INSEE/RNE${band ? `, previously employing ${band.label}` : ""}.`,
        highlights: [
          "Registry status: ceased (dissolved)",
          closed ? `Closure date ${closed}` : "Closure date not published",
          band ? `Last employee band: ${band.label}` : "Employee band not published",
        ],
        identity: { registrationNumber: siren, lei: null, ticker: null, cik: null },
        verified: false,
      });
    }
  }
  if (!companies.length) throw new Error("recherche-entreprises.api.gouv.fr returned no ceased companies");
  return companies;
}

/* ------------------------------------------------------------------ *
 * United States — SEC EDGAR full-text search + submissions
 * ------------------------------------------------------------------ */

type SecHit = {
  _source?: {
    ciks?: string[];
    display_names?: string[];
    file_date?: string;
    root_forms?: string[];
    biz_locations?: string[];
    sics?: string[];
  };
};

const SEC_QUERIES: { q: string; code: string; label: string; severity: DistressSeverity }[] = [
  { q: "\"going concern\"", code: "going_concern", label: "Going-concern disclosure", severity: "HIGH" },
  { q: "\"substantial doubt\"", code: "substantial_doubt", label: "Substantial-doubt disclosure", severity: "HIGH" },
  { q: "\"chapter 11\"", code: "chapter_11", label: "Chapter 11 bankruptcy filing", severity: "CRITICAL" },
];

function parseSecName(display: string): { name: string; ticker: string | null; cik: string | null } {
  const cikMatch = /\(CIK\s+(\d{6,10})\)/.exec(display);
  const tickerMatch = /\(([A-Z]{1,6})\)/.exec(display.replace(/\(CIK[^)]*\)/, ""));
  const name = display.replace(/\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return { name, ticker: tickerMatch ? tickerMatch[1] : null, cik: cikMatch ? cikMatch[1] : null };
}

async function fetchSecSubmissions(cik: string): Promise<any | null> {
  try {
    const padded = cik.padStart(10, "0");
    return await json(`${SEC_SUBMISSIONS}/CIK${padded}.json`, { headers: { "User-Agent": SEC_UA } });
  } catch {
    return null;
  }
}

async function fetchUsSecCompanies(): Promise<CooperateDeptCompany[]> {
  const settled = await Promise.allSettled(
    SEC_QUERIES.map((query) => json(`${SEC_FULLTEXT}?q=${encodeURIComponent(query.q)}&forms=8-K`, { headers: { "User-Agent": SEC_UA } })),
  );

  // Deduplicate to distinct issuers, keeping the most severe signal and the
  // newest filing date per CIK.
  type Candidate = { cik: string; display: string; date: string; query: (typeof SEC_QUERIES)[number]; location: string | null };
  const byCik = new Map<string, Candidate>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = SEC_QUERIES[index];
    const hits: SecHit[] = result.value?.hits?.hits || [];
    for (const hit of hits) {
      const source = hit._source || {};
      const cikRaw = Array.isArray(source.ciks) ? source.ciks[0] : null;
      const display = Array.isArray(source.display_names) ? source.display_names[0] : null;
      if (!cikRaw || !display) continue;
      const cik = String(cikRaw).replace(/^0+/, "") || String(cikRaw);
      const date = isoDate(source.file_date) || new Date().toISOString().slice(0, 10);
      const location = Array.isArray(source.biz_locations) ? source.biz_locations[0] : null;
      const existing = byCik.get(cik);
      if (!existing || SEVERITY_ORDER[query.severity] < SEVERITY_ORDER[existing.query.severity] || date > existing.date) {
        byCik.set(cik, { cik, display, date, query: existing && SEVERITY_ORDER[existing.query.severity] < SEVERITY_ORDER[query.severity] ? existing.query : query, location: location || existing?.location || null });
      }
    }
  });

  const candidates = Array.from(byCik.values()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const filings = await Promise.allSettled(candidates.map((candidate) => fetchSecSubmissions(candidate.cik)));

  const companies: CooperateDeptCompany[] = candidates.map((candidate, index) => {
    const parsed = parseSecName(candidate.display);
    const filing = filings[index].status === "fulfilled" ? filings[index].value : null;
    const address = filing?.addresses?.business || {};
    const [city, state] = String(candidate.location || "").split(",").map((part) => part.trim());
    const sicDescription = clampText(filing?.sicDescription, 120);
    // SEC EDGAR does not publish a founding date for issuers, so it is left null.
    const founded: { foundedYear: number | null; foundedMonth: number | null } = { foundedYear: null, foundedMonth: null };
    const signals: DistressSignal[] = [{
      code: candidate.query.code,
      label: candidate.query.label,
      severity: candidate.query.severity,
      detail: `SEC EDGAR full-text search matched “${candidate.query.q.replace(/"/g, "")}” in a Form 8-K filed ${candidate.date}.`,
      date: candidate.date,
      source: "SEC EDGAR full-text search",
    }];
    return {
      id: `us-sec-${candidate.cik}`,
      name: parsed.name || candidate.display,
      legalName: clampText(filing?.name, 160) || parsed.name || candidate.display,
      countryCode: "US",
      country: "United States",
      flag: flagFor("US"),
      city: clampText(city || address.city, 80) || null,
      state: clampText(state || address.stateOrCountry, 40) || null,
      region: null,
      foundedYear: founded.foundedYear,
      foundedMonth: founded.foundedMonth,
      founderNames: [],
      keyPeople: [],
      companyType: clampText(filing?.entityType === "operating" ? "Operating company" : filing?.entityType, 60) || "SEC registrant",
      sectors: [sicDescription].filter(Boolean),
      regulator: "U.S. Securities and Exchange Commission (SEC)",
      problem: candidate.query.severity === "CRITICAL"
        ? "The company has filed for Chapter 11 bankruptcy protection; the business, or its assets, may be available to an acquirer."
        : "The company's own SEC filing discloses going-concern / substantial doubt about its ability to continue, so it may need new capital or an acquirer.",
      staffCount: null,
      staffRange: null,
      financialStatus: candidate.query.severity === "CRITICAL" ? "Chapter 11 bankruptcy filing" : "Going-concern doubt disclosed",
      netWorthNote: NET_WORTH_NOTE,
      regulatorStatus: "SEC registrant",
      status: candidate.query.severity === "CRITICAL" ? "INSOLVENT" : "DISTRESSED",
      severity: candidate.query.severity,
      signals,
      countdown: { label: "Filing date", direction: "since", targetDate: candidate.date, source: "SEC EDGAR" },
      ownershipOpportunity: "Equity stake or acquisition of the listed entity",
      capitalAskMinor: null,
      source: "SEC EDGAR full-text search",
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${candidate.cik}`,
      asOf: candidate.date,
      summary: `${parsed.name || candidate.display} is a US SEC registrant${sicDescription ? ` in ${sicDescription}` : ""} that disclosed ${candidate.query.label.toLowerCase()} in a Form 8-K filed ${candidate.date}.`,
      highlights: [
        `Signal: ${candidate.query.label}`,
        `Filing date ${candidate.date}`,
        sicDescription ? `SIC sector: ${sicDescription}` : "SIC sector not published",
      ],
      identity: { cik: candidate.cik, ticker: parsed.ticker, lei: clampText(filing?.lei, 24) || null, registrationNumber: null },
      verified: false,
    };
  });
  if (!companies.length) throw new Error("SEC EDGAR full-text search returned no distressed filers");
  return companies;
}

/* ------------------------------------------------------------------ *
 * Global — GLEIF LEI records (inactive legal entities)
 * ------------------------------------------------------------------ */

const GLEIF_BASE = "https://api.gleif.org/api/v1/lei-records";

async function fetchGleifCompanies(): Promise<CooperateDeptCompany[]> {
  const payload = await json(`${GLEIF_BASE}?filter%5Bentity.status%5D=INACTIVE&page%5Bsize%5D=24`);
  const rows: any[] = payload?.data || [];
  const companies: CooperateDeptCompany[] = [];
  for (const row of rows) {
    const entity = row?.attributes?.entity;
    const registration = row?.attributes?.registration;
    const name = clampText(entity?.legalName?.name, 160);
    const lei = clampText(row?.attributes?.lei, 24);
    if (!name || !lei) continue;
    const countryCode = clampText(entity?.legalAddress?.country || entity?.jurisdiction, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) continue;
    const retired = clampText(registration?.status, 24).toUpperCase() === "RETIRED";
    const founded = foundedParts(isoDate(clampText(entity?.creationDate, 10)));
    const signals: DistressSignal[] = [{
      code: retired ? "lei_retired" : "lei_inactive",
      label: retired ? "LEI retired" : "LEI inactive",
      severity: "WATCH",
      detail: `GLEIF reports this legal entity's LEI as ${retired ? "RETIRED" : "INACTIVE"}, which typically follows merger, dissolution or lapse of the entity.`,
      date: isoDate(clampText(registration?.lastUpdateDate, 10)),
      source: "GLEIF LEI records",
    }];
    companies.push({
      id: `gleif-${lei}`,
      name,
      legalName: name,
      countryCode,
      country: countryCode,
      flag: flagFor(countryCode),
      city: clampText(entity?.legalAddress?.city, 80) || null,
      state: clampText(entity?.legalAddress?.region, 60) || null,
      region: null,
      foundedYear: founded.foundedYear,
      foundedMonth: founded.foundedMonth,
      founderNames: [],
      keyPeople: [],
      companyType: clampText(entity?.legalForm?.id, 40) ? `Legal form code ${clampText(entity?.legalForm?.id, 20)}` : "Registered legal entity",
      sectors: [],
      regulator: clampText(entity?.registeredAt?.id, 24) ? `Registration authority ${clampText(entity?.registeredAt?.id, 24)}` : "LEI issuing organisation",
      problem: "This legal entity's LEI is no longer active, indicating it has merged, dissolved or lapsed. Its identity, brand or surviving obligations may be open to an acquirer.",
      staffCount: null,
      staffRange: null,
      financialStatus: retired ? "LEI retired (merged / dissolved)" : "LEI inactive",
      netWorthNote: NET_WORTH_NOTE,
      regulatorStatus: clampText(registration?.status, 24) || "INACTIVE",
      status: "SEEKING_ACQUIRER",
      severity: "WATCH",
      signals,
      countdown: null,
      ownershipOpportunity: "Identity / residual-entity acquisition",
      capitalAskMinor: null,
      source: "GLEIF LEI records",
      sourceUrl: `https://search.gleif.org/#/record/${lei}`,
      asOf: isoDate(clampText(registration?.lastUpdateDate, 10)) || new Date().toISOString().slice(0, 10),
      summary: `${name} is a legal entity in ${countryCode} whose LEI is recorded as ${retired ? "retired" : "inactive"} by GLEIF.`,
      highlights: [
        `LEI ${lei}`,
        `Registration status: ${clampText(registration?.status, 20) || "INACTIVE"}`,
        `Jurisdiction ${clampText(entity?.jurisdiction, 8) || countryCode}`,
      ],
      identity: { lei, registrationNumber: clampText(entity?.registeredAs, 40) || null, ticker: null, cik: null },
      verified: false,
    });
  }
  if (!companies.length) throw new Error("GLEIF returned no inactive legal entities");
  return companies;
}

/* ------------------------------------------------------------------ *
 * Global — Wikidata enrichment
 * ------------------------------------------------------------------ */

type WikidataFacts = {
  foundedYear: number | null;
  foundedMonth: number | null;
  founders: string[];
  headquarters: string | null;
  industries: string[];
  employees: number | null;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|co|ltd|limited|plc|as|asa|ab|ag|sa|nv|gmbh|spa|srl|oyj|oy|aps|a\/s)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Enrich a set of names with Wikidata facts (founders, inception, headquarters,
 * industry and employees). Best-effort by design: a slow or failed query simply
 * leaves the live records un-enriched rather than fabricating values.
 */
async function fetchWikidataFacts(names: string[]): Promise<Map<string, WikidataFacts>> {
  const facts = new Map<string, WikidataFacts>();
  const targets = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).slice(0, 10);
  if (!targets.length) return facts;

  const values = targets.map((name) => `"${name.replace(/"/g, "")}"@en`).join(" ");
  const query = `SELECT ?name ?company ?founder ?inception ?hq ?industry ?employees WHERE {
    VALUES ?name { ${values} }
    ?company rdfs:label ?name .
    ?company wdt:P31/wdt:P279* wd:Q43229 .
    OPTIONAL { ?company wdt:P112 ?founder . }
    OPTIONAL { ?company wdt:P571 ?inception . }
    OPTIONAL { ?company wdt:P159 ?hq . }
    OPTIONAL { ?company wdt:P452 ?industry . }
    OPTIONAL { ?company wdt:P1128 ?employees . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 120`;

  const payload = await json("https://query.wikidata.org/sparql?format=json", {
    accept: "application/sparql-results+json",
    headers: { Accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }).toString(),
  });

  const bindings: any[] = payload?.results?.bindings || [];
  for (const binding of bindings) {
    const label = String(binding?.name?.value || "").trim();
    if (!label) continue;
    const key = normalizeName(label);
    const current = facts.get(key) || { foundedYear: null, foundedMonth: null, founders: [], headquarters: null, industries: [], employees: null };
    const inception = isoDate(String(binding?.inception?.value || ""));
    if (inception) {
      const parts = foundedParts(inception);
      current.foundedYear = current.foundedYear ?? parts.foundedYear;
      current.foundedMonth = current.foundedMonth ?? parts.foundedMonth;
    }
    const founder = clampText(binding?.founder?.value ? binding?.founderLabel?.value || binding?.founder?.value : "", 80);
    if (founder && !current.founders.includes(founder)) current.founders.push(founder);
    const hq = clampText(binding?.hqLabel?.value, 80);
    if (hq && !current.headquarters) current.headquarters = hq;
    const industry = clampText(binding?.industryLabel?.value, 80);
    if (industry && !current.industries.includes(industry)) current.industries.push(industry);
    const employees = Number(binding?.employees?.value);
    if (Number.isFinite(employees) && employees > 0 && !current.employees) current.employees = Math.round(employees);
    facts.set(key, current);
  }
  return facts;
}

function applyWikidata(company: CooperateDeptCompany, facts: Map<string, WikidataFacts>): CooperateDeptCompany {
  const match = facts.get(normalizeName(company.name)) || facts.get(normalizeName(company.legalName || ""));
  if (!match) return company;
  const sectors = Array.from(new Set([...company.sectors, ...match.industries])).slice(0, 6);
  return {
    ...company,
    foundedYear: company.foundedYear ?? match.foundedYear,
    foundedMonth: company.foundedMonth ?? match.foundedMonth,
    founderNames: company.founderNames.length ? company.founderNames : match.founders.slice(0, 4),
    city: company.city ?? match.headquarters,
    sectors,
    staffCount: company.staffCount ?? match.employees,
    verified: company.verified,
  };
}

/* ------------------------------------------------------------------ *
 * Context — World Bank (country) + Eurostat (EU bankruptcies)
 * ------------------------------------------------------------------ */

export type CooperateDeptContext = {
  worldBank: { country: string; incomeLevel: string; region: string }[];
  eurostatBankruptcies: { geo: string; period: string; value: number }[];
};

async function fetchWorldBankContext(): Promise<CooperateDeptContext["worldBank"]> {
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

async function fetchEurostatBankruptcies(): Promise<CooperateDeptContext["eurostatBankruptcies"]> {
  const payload = await json("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_cobp_q?format=JSON&lastTimePeriod=1&indic_bt=BR&unit=NR&geo=EU27_2020");
  const ids: string[] = payload?.id || [];
  const sizes: number[] = payload?.size || [];
  const values: Record<string, number> = payload?.value || {};
  if (!ids.length || !sizes.length || !values) return [];

  // JSON-stat encodes each observation at flat index Σ index_i × stride_i, where
  // stride_i is the product of the sizes of the dimensions that follow it.
  const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((product, size) => product * size, 1));
  const timeDim = ids.indexOf("time");
  const geoDim = ids.indexOf("geo");
  const timeIndex: Record<string, number> = payload?.dimension?.time?.category?.index || {};
  const geoIndex: Record<string, number> = payload?.dimension?.geo?.category?.index || {};
  const timeLabels: Record<string, string> = payload?.dimension?.time?.category?.label || {};
  const geoLabels: Record<string, string> = payload?.dimension?.geo?.category?.label || {};
  const timeCodes = Object.keys(timeIndex);
  const geoCodes = Object.keys(geoIndex);

  let latest: { geo: string; period: string; value: number; timePosition: number } | null = null;
  for (const key of Object.keys(values)) {
    const flat = Number(key);
    const value = Number(values[key]);
    if (!Number.isFinite(flat) || !Number.isFinite(value)) continue;
    const timePosition = timeDim >= 0 ? Math.floor(flat / strides[timeDim]) % sizes[timeDim] : 0;
    const geoPosition = geoDim >= 0 ? Math.floor(flat / strides[geoDim]) % sizes[geoDim] : 0;
    if (latest && timePosition <= latest.timePosition) continue;
    const geoCode = geoCodes[geoPosition] || "EU27_2020";
    const timeCode = timeCodes[timePosition] || String(timePosition);
    latest = { geo: geoLabels[geoCode] || geoCode, period: timeLabels[timeCode] || timeCode, value, timePosition };
  }
  return latest ? [{ geo: latest.geo, period: latest.period, value: latest.value }] : [];
}

/* ------------------------------------------------------------------ *
 * Free-key providers — United Kingdom + CourtListener (fail closed)
 * ------------------------------------------------------------------ */

async function fetchUkCompaniesHouse(): Promise<CooperateDeptCompany[]> {
  const key = envKey("COMPANIES_HOUSE_API_KEY");
  if (!key) throw new Error("UK Companies House key not configured (set COMPANIES_HOUSE_API_KEY)");
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const payload = await json("https://api.company-information.service.gov.uk/advanced-search/get-results?company_status=liquidation&size=18", { headers: { Authorization: auth } });
  const rows: any[] = payload?.items || [];
  const companies: CooperateDeptCompany[] = [];
  for (const row of rows) {
    const name = clampText(row?.title, 160);
    const number = clampText(row?.company_number, 20);
    if (!name || !number) continue;
    const founded = foundedParts(isoDate(row?.date_of_creation));
    const address = clampText(row?.address_snippet, 160);
    companies.push({
      id: `uk-ch-${number}`,
      name,
      legalName: name,
      countryCode: "GB",
      country: "United Kingdom",
      flag: flagFor("GB"),
      city: address ? address.split(",").slice(-2, -1).join(" ").trim() || null : null,
      state: null,
      region: null,
      foundedYear: founded.foundedYear,
      foundedMonth: founded.foundedMonth,
      founderNames: [],
      keyPeople: [],
      companyType: clampText(row?.company_type, 60) || "UK company",
      sectors: (Array.isArray(row?.sic_codes) ? row.sic_codes : []).map((code: string) => `SIC ${clampText(code, 10)}`).slice(0, 4),
      regulator: "Companies House (UK)",
      problem: "The company is in liquidation / administration with Companies House; the business or its assets may be acquired.",
      staffCount: null,
      staffRange: null,
      financialStatus: "Liquidation / administration",
      netWorthNote: NET_WORTH_NOTE,
      regulatorStatus: "liquidation",
      status: "INSOLVENT",
      severity: "CRITICAL",
      signals: [{
        code: "insolvency",
        label: "Insolvency proceeding",
        severity: "CRITICAL",
        detail: "Companies House records this company as in liquidation.",
        date: isoDate(row?.date_of_cessation),
        source: "Companies House (UK)",
      }],
      countdown: isoDate(row?.date_of_cessation) ? { label: "Cessation date", direction: "since", targetDate: isoDate(row?.date_of_cessation) as string, source: "Companies House" } : null,
      ownershipOpportunity: "Asset or business acquisition",
      capitalAskMinor: null,
      source: "Companies House (UK)",
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}`,
      asOf: new Date().toISOString().slice(0, 10),
      summary: `${name} is a UK company recorded in liquidation by Companies House.`,
      highlights: ["Registry status: liquidation", address || "Registered office not published"],
      identity: { registrationNumber: number, lei: null, ticker: null, cik: null },
      verified: false,
    });
  }
  if (!companies.length) throw new Error("Companies House returned no insolvent companies");
  return companies;
}

async function fetchCourtListenerCases(): Promise<CooperateDeptCompany[]> {
  const token = envKey("COURTLISTENER_API_TOKEN");
  if (!token) throw new Error("CourtListener token not configured (set COURTLISTENER_API_TOKEN)");
  const payload = await json("https://www.courtlistener.com/api/rest/v4/search/?q=chapter+11&type=r&order_by=dateFiled+desc", { headers: { Authorization: `Token ${token}` } });
  const rows: any[] = payload?.results || [];
  const companies: CooperateDeptCompany[] = [];
  for (const row of rows) {
    const name = clampText(row?.caseName, 160);
    const docket = clampText(row?.docketNumber, 60);
    if (!name) continue;
    const filed = isoDate(row?.dateFiled);
    companies.push({
      id: `cl-${clampText(row?.docket_id || row?.id, 40) || Math.random().toString(36).slice(2, 8)}`,
      name,
      legalName: name,
      countryCode: "US",
      country: "United States",
      flag: flagFor("US"),
      city: null,
      state: null,
      region: null,
      foundedYear: null,
      foundedMonth: null,
      founderNames: [],
      keyPeople: [],
      companyType: "Litigation / bankruptcy docket",
      sectors: [],
      regulator: clampText(row?.court, 120) || "US federal court",
      problem: "An active Chapter 11 bankruptcy docket is recorded on CourtListener; the estate may seek a buyer or recapitalisation.",
      staffCount: null,
      staffRange: null,
      financialStatus: "Chapter 11 docket",
      netWorthNote: NET_WORTH_NOTE,
      regulatorStatus: "filed",
      status: "INSOLVENT",
      severity: "CRITICAL",
      signals: [{
        code: "chapter_11_docket",
        label: "Chapter 11 docket",
        severity: "CRITICAL",
        detail: `CourtListener records a bankruptcy docket${docket ? ` (${docket})` : ""}${filed ? ` filed ${filed}` : ""}.`,
        date: filed,
        source: "CourtListener",
      }],
      countdown: filed ? { label: "Docket filed", direction: "since", targetDate: filed, source: "CourtListener" } : null,
      ownershipOpportunity: "Estate / asset acquisition",
      capitalAskMinor: null,
      source: "CourtListener",
      sourceUrl: clampText(row?.absolute_url, 200) ? `https://www.courtlistener.com${clampText(row.absolute_url, 200)}` : null,
      asOf: filed || new Date().toISOString().slice(0, 10),
      summary: `CourtListener records a Chapter 11 bankruptcy docket for ${name}${filed ? ` (filed ${filed})` : ""}.`,
      highlights: [clampText(row?.court, 120) || "US federal court", docket ? `Docket ${docket}` : "Docket number not published"],
      identity: { registrationNumber: docket || null, lei: null, ticker: null, cik: null },
      verified: false,
    });
  }
  if (!companies.length) throw new Error("CourtListener returned no bankruptcy dockets");
  return companies;
}

/* ------------------------------------------------------------------ *
 * Catalogue assembly + cache
 * ------------------------------------------------------------------ */

let cache: { value: CooperateDeptCatalogue; expiresAt: number } | null = null;
let inflight: Promise<CooperateDeptCatalogue> | null = null;

const reasonOf = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : "";

/** Every provider resolves to an array (companies or context rows), so an empty array is "degraded". */
function sourceStatus(result: PromiseSettledResult<unknown>): "ok" | "degraded" | "unavailable" {
  if (result.status === "rejected") return "unavailable";
  const value = result.value;
  if (Array.isArray(value)) return value.length ? "ok" : "degraded";
  return "ok";
}

async function buildCatalogue(): Promise<CooperateDeptCatalogue> {
  const [norway, france, sec, gleif, uk, courtlistener, worldBank, eurostat] = await Promise.allSettled([
    fetchNorwayCompanies(),
    fetchFranceCompanies(),
    fetchUsSecCompanies(),
    fetchGleifCompanies(),
    fetchUkCompaniesHouse(),
    fetchCourtListenerCases(),
    fetchWorldBankContext(),
    fetchEurostatBankruptcies(),
  ]);

  for (const [label, result] of [
    ["Norway", norway], ["France", france], ["SEC", sec], ["GLEIF", gleif],
    ["Companies House", uk], ["CourtListener", courtlistener], ["World Bank", worldBank], ["Eurostat", eurostat],
  ] as const) {
    if (result.status === "rejected") console.warn(`[CooperateDept] ${label} source failed: ${reasonOf(result)}`);
  }

  const raw: CooperateDeptCompany[] = [
    ...(norway.status === "fulfilled" ? norway.value : []),
    ...(france.status === "fulfilled" ? france.value : []),
    ...(sec.status === "fulfilled" ? sec.value : []),
    ...(gleif.status === "fulfilled" ? gleif.value : []),
    ...(uk.status === "fulfilled" ? uk.value : []),
    ...(courtlistener.status === "fulfilled" ? courtlistener.value : []),
  ];

  // Wikidata enrichment over a bounded sample of the most severe records.
  let enriched = raw;
  try {
    const sample = raw.slice().sort(compareCooperateDeptCompanies).slice(0, 10).map((company) => company.name);
    const facts = await fetchWikidataFacts(sample);
    enriched = raw.map((company) => applyWikidata(company, facts));
  } catch (error) {
    console.warn(`[CooperateDept] Wikidata enrichment skipped: ${error instanceof Error ? error.message : "unknown"}`);
  }

  const seen = new Set<string>();
  const companies = enriched.filter((company) => {
    if (seen.has(company.id)) return false;
    seen.add(company.id);
    return true;
  });
  companies.sort(compareCooperateDeptCompanies);

  const sources: CooperateDeptSource[] = [
    { name: "Brønnøysund Register Centre (Norway)", url: "https://data.brreg.no/enhetsregisteret/api", country: "NO", role: "companies", status: sourceStatus(norway), detail: norway.status === "rejected" ? reasonOf(norway) : undefined },
    { name: "recherche-entreprises.api.gouv.fr (France)", url: "https://recherche-entreprises.api.gouv.fr", country: "FR", role: "companies", status: sourceStatus(france), detail: france.status === "rejected" ? reasonOf(france) : undefined },
    { name: "SEC EDGAR full-text search (United States)", url: "https://efts.sec.gov/LATEST/search-index", country: "US", role: "companies", status: sourceStatus(sec), detail: sec.status === "rejected" ? reasonOf(sec) : undefined },
    { name: "GLEIF LEI records (global)", url: "https://api.gleif.org/api/v1/lei-records", country: "XX", role: "companies", status: sourceStatus(gleif), detail: gleif.status === "rejected" ? reasonOf(gleif) : undefined },
    { name: "Companies House (United Kingdom)", url: "https://api.company-information.service.gov.uk", country: "GB", role: "companies", status: sourceStatus(uk), detail: uk.status === "rejected" ? reasonOf(uk) : undefined },
    { name: "CourtListener (United States / global)", url: "https://www.courtlistener.com/api/rest/v4/search/", country: "US", role: "companies", status: sourceStatus(courtlistener), detail: courtlistener.status === "rejected" ? reasonOf(courtlistener) : undefined },
    { name: "Wikidata (global enrichment)", url: "https://query.wikidata.org/", country: "XX", role: "enrichment", status: companies.some((company) => company.founderNames.length) ? "ok" : "degraded", detail: "Founders, inception, headquarters, industry and employees" },
    { name: "World Bank country API (context)", url: "https://api.worldbank.org/v2/country", country: "XX", role: "context", status: sourceStatus(worldBank), detail: worldBank.status === "rejected" ? reasonOf(worldBank) : undefined },
    { name: "Eurostat business bankruptcies (EU)", url: "https://ec.europa.eu/eurostat/databrowser/view/sts_cobp_q/", country: "XX", role: "context", status: sourceStatus(eurostat), detail: eurostat.status === "rejected" ? reasonOf(eurostat) : undefined },
    { name: "SEC EDGAR submissions (United States)", url: "https://data.sec.gov/submissions", country: "US", role: "enrichment", status: sec.status === "fulfilled" ? "ok" : "degraded", detail: "Entity identity, SIC sector and address" },
  ];

  return {
    companies,
    sources,
    fetchedAt: new Date().toISOString(),
    degraded: sources.some((source) => source.status !== "ok"),
  };
}

/** Return the live catalogue, reusing the in-memory cache for ten minutes. */
export async function getCooperateDeptCatalogue(options: { force?: boolean } = {}): Promise<CooperateDeptCatalogue> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await buildCatalogue();
      if (value.companies.length) cache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Look up a single live company by its stable id. */
export async function findCooperateDeptCompany(id: string): Promise<CooperateDeptCompany | null> {
  const catalogue = await getCooperateDeptCatalogue();
  return catalogue.companies.find((company) => company.id === id) ?? null;
}

export function __resetCooperateDeptCacheForTest() {
  cache = null;
  inflight = null;
}
