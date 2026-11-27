import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseCurrencyCode,
  normaliseWhitespace,
  pickString,
  toIsoString,
  toMinorUnits,
  truncate,
} from "../normalise";

/**
 * Ukraine — Prozorro public procurement (public-api.prozorro.gov.ua).
 *
 * `GET https://public-api.prozorro.gov.ua/api/2.5/tenders?limit=<n>&offset=<cursor>`
 * is the documented Prozorro read API. The response is
 * `{ data: [ … ], next_page: { offset, path, uri } }`; each tender carries `id`
 * (internal uuid), `tenderID` (the public `UA-YYYY-MM-DD-NNNNNN-x` number),
 * `title`, `description`, `date`, `procuringEntity.name`,
 * `value.{amount,currency}`, `tenderPeriod.{startDate,endDate}`, `status` and
 * `items[].classification.id` (CPV). Paging is by the opaque `next_page.offset`
 * token. The public notice page is
 * `https://prozorro.gov.ua/tender/<tenderID>`. No key is required. A payload that
 * is not the documented shape yields nothing rather than a fabricated tender.
 */
export const PROZORRO_TENDERS_URL = "https://public-api.prozorro.gov.ua/api/2.5/tenders";
const PROZORRO_TENDER_URL = "https://prozorro.gov.ua/tender";
const PROZORRO_PAGE_SIZE = 50;

type ProzorroResponse = {
  data?: Record<string, unknown>[];
  next_page?: { offset?: unknown; uri?: unknown };
};

/** Read the tender array from a Prozorro payload (never fabricates entries). */
export function readProzorroTenders(payload: unknown): Record<string, unknown>[] {
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export async function fetchProzorroPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const url = new URL(PROZORRO_TENDERS_URL);
  url.searchParams.set("limit", String(PROZORRO_PAGE_SIZE));
  if (params.cursor) url.searchParams.set("offset", params.cursor);

  const payload = await fetchJson<ProzorroResponse>(url.toString());
  const items = readProzorroTenders(payload);
  const offset = pickString(payload.next_page?.offset);
  return { items, nextCursor: items.length > 0 ? offset : null };
}

/** Normalise one Prozorro tender, or null when it has no usable identity. */
export function normaliseProzorroTender(raw: Record<string, unknown>): NormalizedTender | null {
  const tenderId = pickString(raw.tenderID, raw.id);
  if (!tenderId) return null;
  const title = pickString(raw.title, raw.tenderID, tenderId);
  if (!title) return null;
  const sourceUrl = `${PROZORRO_TENDER_URL}/${encodeURIComponent(tenderId)}`;

  const entity = (raw.procuringEntity ?? {}) as Record<string, unknown>;
  const value = (raw.value ?? {}) as Record<string, unknown>;
  const period = (raw.tenderPeriod ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
  const classification = (items[0]?.classification ?? {}) as Record<string, unknown>;
  const amountMinor = toMinorUnits(value.amount, 2);

  return {
    externalId: truncate(tenderId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "UA",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(entity.name)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv: classification.id }),
    tenderType: truncate(pickString(raw.procurementMethodType), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.status), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode(value.currency),
    bidOpenAt: toIsoString(period.startDate),
    bidCloseAt: toIsoString(period.endDate),
    payoutAt: null,
    publishedAt: toIsoString(raw.date),
    summary: truncate(normaliseWhitespace(pickString(raw.description, raw.title)), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(pickString(raw.description)),
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const prozorroProvider: TenderProvider = {
  key: "prozorro",
  countryCode: "UA",
  kind: "government",
  fetch: fetchProzorroPage,
};
