import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, externalIdFromQueryParam, normaliseHtmlListingRow } from "./html-listing";

/**
 * Ireland — national eTenders (epps) current contract opportunities.
 *
 * `GET https://www.etenders.gov.ie/epps/cft/prepareCurrentOpportunities.do?currentType=cft`
 * is the server-rendered listing of live contract notices; each notice links to
 * `/epps/cft/prepareViewCfTWS.do?resourceId={id}`, so the notice identity is the
 * `resourceId` query parameter. The portal has no documented machine-readable
 * feed and occasionally rejects automated requests, so this adapter is treated as
 * fragile: an unreadable page, a rejection, or a listing that yields no notice
 * links is recorded as a source error (fail closed) rather than a fabricated
 * tender.
 */
export const IE_ETENDERS_LISTING_URL = "https://www.etenders.gov.ie/epps/cft/prepareCurrentOpportunities.do?currentType=cft";

/** Normalise one extracted eTenders listing row, or null when it has no identity. */
export function normaliseEtendersRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, {
    countryCode: "IE",
    deriveExternalId: (url) => externalIdFromQueryParam(url, "resourceId"),
  });
}

export const etendersProvider: TenderProvider = createHtmlListingProvider({
  key: "etenders",
  countryCode: "IE",
  kind: "government",
  listingUrl: IE_ETENDERS_LISTING_URL,
  hrefIncludes: ["prepareViewCfTWS.do"],
});
