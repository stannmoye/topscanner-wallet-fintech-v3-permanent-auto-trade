import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import { createOcdsProvider, normaliseOcdsRelease } from "./ocds";
import { pickString } from "../normalise";

/**
 * South Africa — National Treasury eTenders OCDS releases.
 *
 * `GET https://ocds-api.etenders.gov.za/api/OCDSReleases?PageNumber=&PageSize=&dateFrom=&dateTo=`
 * is the National Treasury's documented OCDS 1.1 feed. `dateFrom`/`dateTo` are
 * required; both are date-only (`YYYY-MM-DD`). Each release carries a `tender`
 * block (with `documents[]`) and a `buyer`. The Tender's own document URL is
 * preferred for attribution; when a release has none, the eTenders portal home
 * is used as a best-effort fallback.
 */
export const ZA_ETENDERS_OCDS_URL = "https://ocds-api.etenders.gov.za/api/OCDSReleases";
const ZA_ETENDERS_PORTAL_URL = "https://www.etenders.gov.za/";
const ZA_PAGE_SIZE = 100;
const ZA_MAX_PAGES = 20;
const ZA_WINDOW_DAYS = 30;

/** Format an instant as the date-only `YYYY-MM-DD` the eTenders API requires. */
function zaDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fetch one page of the eTenders OCDS feed for the window ending now. */
export async function fetchZaEtendersPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const page = Math.min(Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1), ZA_MAX_PAGES);
  const to = new Date();
  const from = params.since ?? new Date(to.getTime() - ZA_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const url = new URL(ZA_ETENDERS_OCDS_URL);
  url.searchParams.set("PageNumber", String(page));
  url.searchParams.set("PageSize", String(ZA_PAGE_SIZE));
  url.searchParams.set("dateFrom", zaDay(from));
  url.searchParams.set("dateTo", zaDay(to));

  const payload = await fetchJson<{ releases?: unknown[] }>(url.toString());
  const items = Array.isArray(payload.releases) ? payload.releases : [];
  const nextCursor = items.length >= ZA_PAGE_SIZE && page < ZA_MAX_PAGES ? String(page + 1) : null;
  return { items, nextCursor };
}

/** Build the customer-facing notice URL, or null when it has no identity. */
export function buildZaEtendersSourceUrl(externalId: string, raw: Record<string, unknown>): string | null {
  const tender = (raw.tender ?? {}) as Record<string, unknown>;
  const documents = Array.isArray(tender.documents) ? (tender.documents as Record<string, unknown>[]) : [];
  for (const document of documents) {
    const url = pickString(document.url);
    if (url) return url;
  }
  return externalId ? `${ZA_ETENDERS_PORTAL_URL}Home/opportunities` : null;
}

/** Normalise one eTenders OCDS release, or null when it has no identity. */
export function normaliseZaEtendersRelease(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseOcdsRelease(raw, { countryCode: "ZA", buildSourceUrl: buildZaEtendersSourceUrl });
}

export const zaEtendersProvider: TenderProvider = createOcdsProvider({
  key: "za_etenders",
  countryCode: "ZA",
  kind: "government",
  endpoint: ZA_ETENDERS_OCDS_URL,
  buildSourceUrl: buildZaEtendersSourceUrl,
  fetchPage: fetchZaEtendersPage,
});
