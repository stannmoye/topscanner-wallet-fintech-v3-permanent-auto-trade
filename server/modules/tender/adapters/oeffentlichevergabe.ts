import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchBytes } from "../http";
import { readZipEntries } from "../zip";
import { toIsoCountryCode } from "../countries";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  firstLocalisedString,
  firstNumber,
  normaliseCurrencyCode,
  normaliseWhitespace,
  pickString,
  toIsoString,
  toMinorUnits,
  truncate,
} from "../normalise";

/**
 * Germany — Bekanntmachungsservice des Bundes (oeffentlichevergabe.de).
 *
 * `GET https://oeffentlichevergabe.de/api/notice-exports?pubDay=YYYY-MM-DD&format=ocds.zip`
 * returns a ZIP of the notices published on one day (Europe/Berlin) as OCDS 1.1
 * (`ocds-mnwr74` prefix). The API takes a single `pubDay` or `pubMonth` — never a
 * range — so this adapter walks one day per page: each fetch returns the releases
 * for one day and points `nextCursor` at the following day, stopping at the most
 * recent day the service has published. `pubDay` cannot be today or a future day,
 * so the newest available day is yesterday in UTC (always at least one day behind
 * Berlin). The export needs no key.
 */
const GERMANY_NOTICE_EXPORTS_URL = "https://oeffentlichevergabe.de/api/notice-exports";
const GERMANY_DETAILS_URL = "https://oeffentlichevergabe.de/ui/de/search/details";
const GERMANY_SEARCH_URL = "https://oeffentlichevergabe.de/ui/de/search/bekanntmachungen";
const GERMANY_OCDS_MIME = "application/vnd.bekanntmachungsservice.ocds.zip+zip";
const GERMANY_OCDS_FORMAT = "ocds.zip";
/** The service rejects `pubDay` earlier than this date. */
const GERMANY_MIN_DAY = "2022-12-01";

/** The UTC calendar day for a date, as `YYYY-MM-DD`. */
export function germanyDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` day string by a whole number of days. */
export function addGermanyDays(day: string, delta: number): string {
  const base = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(base)) return day;
  return new Date(base + delta * 86_400_000).toISOString().slice(0, 10);
}

/** The most recent day the service can serve: yesterday in UTC. */
export function latestAvailableGermanyDay(now: Date): string {
  return germanyDayString(new Date(now.getTime() - 86_400_000));
}

/** The day to fetch for this call: the resume cursor, else the `since` day, else the latest available day. */
export function resolveGermanyDay(params: TenderFetchParams, now: Date): string {
  if (params.cursor && /^\d{4}-\d{2}-\d{2}$/.test(params.cursor)) return params.cursor;
  const sinceDay = params.since ? germanyDayString(params.since) : null;
  if (sinceDay && sinceDay > GERMANY_MIN_DAY) return sinceDay;
  return latestAvailableGermanyDay(now);
}

/** Flatten an OCDS payload into releases, accepting a release package, a single release, or an array. */
export function readOcdsReleases(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    const releases: Record<string, unknown>[] = [];
    for (const item of payload) releases.push(...readOcdsReleases(item));
    return releases;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.releases)) return record.releases as Record<string, unknown>[];
    if (record.tender || record.ocid || record.contractingProcesses) return [record];
  }
  return [];
}

export async function fetchOeffentlichevergabePage(params: TenderFetchParams): Promise<RawTenderPage> {
  const now = new Date();
  const latest = latestAvailableGermanyDay(now);
  let day = resolveGermanyDay(params, now);
  if (day < GERMANY_MIN_DAY) day = GERMANY_MIN_DAY;
  if (day > latest) return { items: [], nextCursor: null };

  const url = new URL(GERMANY_NOTICE_EXPORTS_URL);
  url.searchParams.set("pubDay", day);
  url.searchParams.set("format", GERMANY_OCDS_FORMAT);
  const exportUrl = url.toString();

  const buffer = Buffer.from(await fetchBytes(exportUrl, { headers: { Accept: GERMANY_OCDS_MIME } }));
  const releases: Record<string, unknown>[] = [];
  for (const entry of readZipEntries(buffer)) {
    if (!entry.name.toLowerCase().endsWith(".json")) continue;
    try {
      releases.push(...readOcdsReleases(JSON.parse(entry.data.toString("utf8"))));
    } catch {
      // One unreadable member must not discard the rest of the day's notices.
    }
  }
  const items = releases.map((release) => ({ ...release, __exportUrl: exportUrl }));
  const nextDay = addGermanyDays(day, 1);
  return { items, nextCursor: nextDay <= latest ? nextDay : null };
}

/** The first tender-document URL in an OCDS release, or null. */
function readGermanyDocumentUrl(tender: Record<string, unknown>): string | null {
  const documents = Array.isArray(tender.documents) ? tender.documents : [];
  for (const item of documents) {
    const url = pickString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  return null;
}

/** Resolve the buyer's country from its OCDS address, defaulting to Germany. */
function resolveGermanyCountry(buyer: Record<string, unknown>): string {
  const address = (buyer.address ?? {}) as Record<string, unknown>;
  const candidate = pickString(address.countryCode, address.countryName);
  if (!candidate) return "DE";
  if (/^[A-Za-z]{2}$/.test(candidate)) return candidate.toUpperCase();
  return toIsoCountryCode(candidate) || "DE";
}

/** Normalise one German OCDS release, or null when it has no identity. */
export function normaliseOeffentlichevergabeRelease(raw: Record<string, unknown>): NormalizedTender | null {
  const tender = (raw.tender ?? {}) as Record<string, unknown>;
  const externalId = pickString(raw.id, raw.ocid, tender.id);
  if (!externalId) return null;
  const title = pickString(firstLocalisedString(tender.title), externalId);
  if (!title) return null;

  const buyer = (raw.buyer ?? {}) as Record<string, unknown>;
  const value = (tender.value ?? {}) as Record<string, unknown>;
  const period = (tender.tenderPeriod ?? {}) as Record<string, unknown>;
  const classification = (tender.classification ?? {}) as Record<string, unknown>;
  const amountMinor = toMinorUnits(firstNumber(value.amount), 2);
  const noticeId = pickString(raw.noticeId, raw["notice-id"]);
  const sourceUrl =
    readGermanyDocumentUrl(tender)
    ?? (noticeId ? `${GERMANY_DETAILS_URL}?noticeId=${encodeURIComponent(noticeId)}` : null)
    ?? pickString(raw.__exportUrl)
    ?? GERMANY_SEARCH_URL;

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: truncate(resolveGermanyCountry(buyer), TENDER_COLUMN_LIMITS.countryCode) ?? "DE",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(buyer.name)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv: classification.id, categoryName: tender.mainProcurementCategory }),
    tenderType: truncate(pickString(tender.mainProcurementCategory), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(tender.procurementMethodDetails, tender.procurementMethod), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode(value.currency ?? "EUR"),
    bidOpenAt: toIsoString(period.startDate),
    bidCloseAt: toIsoString(period.endDate),
    payoutAt: null,
    publishedAt: toIsoString(raw.date),
    summary: truncate(normaliseWhitespace(tender.description), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(tender.description),
    documents: readGermanyDocumentUrl(tender) ? [{ label: "Tender documents", url: readGermanyDocumentUrl(tender)! }] : [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const oeffentlichevergabeProvider: TenderProvider = {
  key: "oeffentlichevergabe",
  countryCode: "DE",
  kind: "government",
  fetch: fetchOeffentlichevergabePage,
};
