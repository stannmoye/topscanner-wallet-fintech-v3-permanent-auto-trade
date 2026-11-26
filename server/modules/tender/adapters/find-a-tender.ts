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
 * United Kingdom — Find a Tender Service (OCDS).
 *
 * `GET https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages` with
 * `updatedFrom`, `updatedTo`, `limit` and `cursor`. The response is an OCDS
 * release package: `{ releases: [ { ocid, id, date, tender, buyer, ... } ] }`,
 * with the next page advertised on `links.next`. Pagination follows the cursor
 * chain until it is exhausted.
 */
const FTS_RELEASE_PACKAGES_URL = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const FTS_NOTICE_URL = "https://www.find-tender.service.gov.uk/Notice";
const FTS_PAGE_SIZE = 100;

type FtsReleasePackage = {
  releases?: Record<string, unknown>[];
  links?: { next?: string };
};

/** Extract the `cursor` query parameter from the package's `links.next` URL. */
export function extractFtsNextCursor(links: { next?: string } | undefined): string | null {
  const next = pickString(links?.next);
  if (!next) return null;
  try {
    const value = new URL(next).searchParams.get("cursor");
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export async function fetchFindATenderPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const url = new URL(FTS_RELEASE_PACKAGES_URL);
  const from = params.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  url.searchParams.set("updatedFrom", from.toISOString());
  url.searchParams.set("updatedTo", new Date().toISOString());
  url.searchParams.set("limit", String(FTS_PAGE_SIZE));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const payload = await fetchJson<FtsReleasePackage>(url.toString());
  const items = Array.isArray(payload.releases) ? payload.releases : [];
  return { items, nextCursor: extractFtsNextCursor(payload.links) };
}

function normaliseFtsDocuments(tender: Record<string, unknown>): { label: string; url: string }[] {
  const documents = Array.isArray(tender.documents) ? tender.documents : [];
  const result: { label: string; url: string }[] = [];
  for (const item of documents) {
    const document = item as Record<string, unknown>;
    const documentUrl = pickString(document.url);
    if (!documentUrl) continue;
    result.push({ label: pickString(document.title, document.description) ?? "Tender document", url: documentUrl });
  }
  return result;
}

/** Normalise one Find a Tender OCDS release, or null when it has no identity. */
export function normaliseFindATenderRelease(raw: Record<string, unknown>): NormalizedTender | null {
  const tender = (raw.tender ?? {}) as Record<string, unknown>;
  const externalId = pickString(raw.id, raw.ocid);
  if (!externalId) return null;
  const title = pickString(tender.title, externalId);
  if (!title) return null;

  const buyer = (raw.buyer ?? {}) as Record<string, unknown>;
  const value = (tender.value ?? {}) as Record<string, unknown>;
  const period = (tender.tenderPeriod ?? {}) as Record<string, unknown>;
  const classification = (tender.classification ?? {}) as Record<string, unknown>;
  const amountMinor = toMinorUnits(value.amount, 2);
  const status = pickString(tender.status);
  const sourceUrl = `${FTS_NOTICE_URL}/${externalId}`;

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "GB",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(buyer.name)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv: classification.id, categoryName: tender.mainProcurementCategory }),
    tenderType: truncate(pickString(tender.mainProcurementCategory), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(tender.procurementMethodDetails, tender.procurementMethod), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode(value.currency),
    bidOpenAt: toIsoString(period.startDate),
    bidCloseAt: toIsoString(period.endDate),
    payoutAt: null,
    publishedAt: toIsoString(raw.date),
    summary: truncate(normaliseWhitespace(tender.description), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(tender.description),
    documents: normaliseFtsDocuments(tender),
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const findATenderProvider: TenderProvider = {
  key: "find_a_tender",
  countryCode: "GB",
  kind: "government",
  fetch: fetchFindATenderPage,
};
