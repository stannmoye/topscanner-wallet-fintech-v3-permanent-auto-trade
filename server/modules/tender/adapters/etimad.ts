import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import { toIsoCountryCode } from "../countries";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * United Arab Emirates / Saudi Arabia — Etimad aggregator feed.
 *
 * `GET https://tenders.etimad.sa/Tender/AllSupplierTendersForVisitorAsync` is the
 * public JSON endpoint the Etimad portal uses to list visitor-visible tenders;
 * the payload is `{ data: [ … ], totalCount, pageSize, currentPage }` and each
 * row carries `tenderId`, `tenderIdString`, `referenceNumber`, `tenderName`,
 * `agencyName`, `tenderTypeName`, `tenderStatusName`, `submissionDate` and
 * `lastOfferPresentationDate`. The notice page is
 * `https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId={tenderIdString}`.
 *
 * Etimad fronts this endpoint with a bot-protection challenge that serves an HTML
 * interstitial instead of JSON to automated callers, so this adapter is treated
 * as fragile: a challenge page (or any unreadable payload) makes the JSON parse
 * throw, which the ingestion worker records as an `error` for the source (fail
 * closed) rather than storing a fabricated tender. The country is taken from the
 * row when it publishes one, otherwise the registry row's own country is used.
 */
export const ETIMAD_TENDERS_URL = "https://tenders.etimad.sa/Tender/AllSupplierTendersForVisitorAsync";
const ETIMAD_DETAIL_URL = "https://tenders.etimad.sa/Tender/DetailsForVisitor";
const ETIMAD_PAGE_SIZE = 50;

type EtimadResponse = {
  data?: Record<string, unknown>[];
  currentPage?: number;
  totalCount?: number;
  pageSize?: number;
};

/** Read the tender array from an Etimad payload (never fabricates entries). */
export function readEtimadTenders(payload: unknown): Record<string, unknown>[] {
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Fetch one page of the Etimad visitor tender feed. */
export async function fetchEtimadPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const page = Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1);
  const url = new URL(ETIMAD_TENDERS_URL);
  url.searchParams.set("pageNumber", String(page));
  url.searchParams.set("pageSize", String(ETIMAD_PAGE_SIZE));

  const payload = await fetchJson<EtimadResponse>(url.toString());
  const items = readEtimadTenders(payload);
  const current = Number(payload.currentPage ?? page);
  const total = Number(payload.totalCount ?? 0);
  const size = Number(payload.pageSize ?? ETIMAD_PAGE_SIZE);
  const nextCursor = items.length > 0 && (total === 0 || current * size < total) ? String(current + 1) : null;
  return { items, nextCursor };
}

/** Normalise one Etimad tender, or null when it has no identity. */
export function normaliseEtimadTender(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.tenderIdString, raw.referenceNumber, raw.tenderId, raw.tenderNumber);
  if (!externalId) return null;
  const title = pickString(raw.tenderName, raw.referenceNumber, externalId);
  if (!title) return null;

  const detailId = pickString(raw.tenderIdString, raw.tenderId, externalId)!;
  const sourceUrl = `${ETIMAD_DETAIL_URL}?STenderId=${encodeURIComponent(detailId)}`;
  const countryCode = toIsoCountryCode(raw.countryName ?? raw.countryCode) ?? "";

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode,
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(raw.agencyName, raw.branchName)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.activityName, raw.tenderTypeName) }),
    tenderType: truncate(pickString(raw.tenderTypeName), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.tenderStatusName), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: toIsoString(raw.submissionDate),
    bidCloseAt: toIsoString(raw.lastOfferPresentationDate),
    payoutAt: toIsoString(raw.offersOpeningDate),
    publishedAt: toIsoString(raw.submissionDate),
    summary: truncate(normaliseWhitespace(pickString(raw.tenderName)), TENDER_COLUMN_LIMITS.summary),
    descriptionText: null,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const etimadProvider: TenderProvider = {
  key: "etimad",
  countryCode: "",
  kind: "private",
  fetch: fetchEtimadPage,
};
