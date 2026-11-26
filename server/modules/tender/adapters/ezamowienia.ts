import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * Poland — e-Zamówienia (Biuletyn Zamówień Publicznych) public notices.
 *
 * `GET https://ezamowienia.gov.pl/mo-board/api/v1/notice` is the e-Zamówienia
 * board's documented notice API. It requires a publication window
 * (`PublicationDateFrom`, `PublicationDateTo`), a `NoticeType`
 * (`ContractNotice`), and a non-empty `PageSize`; it returns a JSON array of
 * notices carrying `noticeNumber`, `bzpNumber`, `publicationDate`, `orderObject`
 * (the subject), `cpvCode`, `submittingOffersDate` and `organizationName`. The
 * notice page is
 * `https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details/{bzpNumber}/01`.
 */
export const EZAMOWIENIA_NOTICE_URL = "https://ezamowienia.gov.pl/mo-board/api/v1/notice";
const EZAMOWIENIA_NOTICE_PAGE = "https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details";
const EZAMOWIENIA_NOTICE_TYPE = "ContractNotice";
const EZAMOWIENIA_PAGE_SIZE = 100;
const EZAMOWIENIA_MAX_PAGES = 10;
const EZAMOWIENIA_WINDOW_DAYS = 30;

/** Format an instant as the date-only `YYYY-MM-DD` the e-Zamówienia API requires. */
function ezamowieniaDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fetch one page of the e-Zamówienia notice feed for the window ending now. */
export async function fetchEzamowieniaPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const page = Math.min(Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1), EZAMOWIENIA_MAX_PAGES);
  const to = new Date();
  const from = params.since ?? new Date(to.getTime() - EZAMOWIENIA_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const url = new URL(EZAMOWIENIA_NOTICE_URL);
  url.searchParams.set("PublicationDateFrom", ezamowieniaDay(from));
  url.searchParams.set("PublicationDateTo", ezamowieniaDay(to));
  url.searchParams.set("NoticeType", EZAMOWIENIA_NOTICE_TYPE);
  url.searchParams.set("pageNumber", String(page));
  url.searchParams.set("pageSize", String(EZAMOWIENIA_PAGE_SIZE));

  const payload = await fetchJson<unknown>(url.toString());
  const items = Array.isArray(payload) ? payload : [];
  const nextCursor = items.length >= EZAMOWIENIA_PAGE_SIZE && page < EZAMOWIENIA_MAX_PAGES ? String(page + 1) : null;
  return { items, nextCursor };
}

/** Normalise one e-Zamówienia notice, or null when it has no identity. */
export function normaliseEzamowieniaNotice(raw: Record<string, unknown>): NormalizedTender | null {
  const bzpNumber = pickString(raw.bzpNumber);
  const externalId = pickString(raw.noticeNumber, bzpNumber, raw.tenderId);
  if (!externalId) return null;
  const title = pickString(raw.orderObject, raw.noticeNumber, externalId);
  if (!title) return null;

  const slug = (bzpNumber ?? externalId).replace(/ /g, "%20");
  const sourceUrl = `${EZAMOWIENIA_NOTICE_PAGE}/${slug}/01`;
  const description = normaliseWhitespace(raw.orderObject);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "PL",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(raw.organizationName)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv: pickString(raw.cpvCode), categoryName: pickString(raw.orderType) }),
    tenderType: truncate(pickString(raw.orderType, raw.noticeType), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.noticeType), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: null,
    bidCloseAt: toIsoString(raw.submittingOffersDate),
    payoutAt: null,
    publishedAt: toIsoString(raw.publicationDate),
    summary: truncate(description, TENDER_COLUMN_LIMITS.summary),
    descriptionText: description,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const ezamowieniaProvider: TenderProvider = {
  key: "ezamowienia",
  countryCode: "PL",
  kind: "government",
  fetch: fetchEzamowieniaPage,
};
