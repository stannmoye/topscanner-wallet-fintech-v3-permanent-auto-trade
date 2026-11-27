import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Bangladesh — e-GP (National e-Government Procurement) tender search.
 *
 * `https://www.eprocure.gov.bd/resources/common/StdTenderSearch.jsp?h=t` is the
 * public e-tender/e-proposal search of the National e-GP system run by CPTU/BPPA.
 * It publishes no documented machine-readable feed, so this adapter is treated as
 * fragile and fails closed — an unreadable page or a listing that yields no
 * notice links is recorded as a source error by the ingestion worker rather than
 * a fabricated tender. The URL is the real e-GP search page so attribution is
 * faithful.
 */
export const BANGLADESH_EPROCURE_LISTING_URL = "https://www.eprocure.gov.bd/resources/common/StdTenderSearch.jsp?h=t";

/** Normalise one extracted e-GP (Bangladesh) listing row, or null when it has no identity. */
export function normaliseEprocureBdRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "BD" });
}

export const eprocureBdProvider: TenderProvider = createHtmlListingProvider({
  key: "eprocure_bd",
  countryCode: "BD",
  kind: "government",
  listingUrl: BANGLADESH_EPROCURE_LISTING_URL,
  hrefIncludes: ["resources/common/"],
});
