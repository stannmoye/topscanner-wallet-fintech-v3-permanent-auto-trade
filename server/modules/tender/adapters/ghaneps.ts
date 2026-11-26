import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Ghana — GHANEPS (Ghana Electronic Procurement System) tender notices.
 *
 * `GET https://ghaneps.gov.gh/epps/quickSearchAction.do?searchSelect=6` is the
 * public GHANEPS notice search. The portal fronts the search with a session/redirect
 * flow and publishes no machine-readable feed, so this adapter is treated as
 * fragile and fails closed — an unreadable page, a redirect to a login shell, or
 * a listing that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the portal's real
 * search so the customer attribution is faithful.
 */
export const GH_GHANEPS_LISTING_URL = "https://ghaneps.gov.gh/epps/quickSearchAction.do?searchSelect=6";

/** Normalise one extracted GHANEPS listing row, or null when it has no identity. */
export function normaliseGhanepsRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "GH" });
}

export const ghanepsProvider: TenderProvider = createHtmlListingProvider({
  key: "ghaneps",
  countryCode: "GH",
  kind: "government",
  listingUrl: GH_GHANEPS_LISTING_URL,
  hrefIncludes: ["/epps/"],
});
