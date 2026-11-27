import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Nepal — Bolpatra e-GP (Public Procurement Monitoring Office).
 *
 * `https://www.bolpatra.gov.np/egp/searchOpportunity` is the opportunity-search
 * page of Nepal's national e-Government Procurement portal, operated by the
 * Public Procurement Monitoring Office (PPMO). The portal renders its results in
 * an application shell and publishes no machine-readable feed, so this adapter is
 * treated as fragile and fails closed — a listing that yields no notice links is
 * recorded as a source error by the ingestion worker rather than a fabricated
 * tender. The URL is the portal's real opportunity search so attribution is faithful.
 */
export const NEPAL_BOLPATRA_LISTING_URL = "https://www.bolpatra.gov.np/egp/searchOpportunity";

/** Normalise one extracted Bolpatra listing row, or null when it has no identity. */
export function normaliseBolpatraRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "NP" });
}

export const bolpatraProvider: TenderProvider = createHtmlListingProvider({
  key: "bolpatra",
  countryCode: "NP",
  kind: "government",
  listingUrl: NEPAL_BOLPATRA_LISTING_URL,
  hrefIncludes: ["/egp/notice/"],
});
