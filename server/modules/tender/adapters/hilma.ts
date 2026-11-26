import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Finland — HILMA (hankintailmoitukset.fi) tender notices.
 *
 * `GET https://www.hankintailmoitukset.fi/en/tender-notices` is the public
 * national tender notice listing. The site is a single-page application: the
 * listing is rendered client-side (its API sits behind an API-management gateway
 * whose routes are not published), so the served HTML carries no notice links.
 * This adapter is therefore treated as fragile and fails closed — a page that
 * yields no notice links is recorded as a source error by the ingestion worker
 * rather than a fabricated tender. The URL is the portal's real notice page so
 * the customer attribution is faithful.
 */
export const FI_HILMA_LISTING_URL = "https://www.hankintailmoitukset.fi/en/tender-notices";

/** Normalise one extracted HILMA listing row, or null when it has no identity. */
export function normaliseHilmaRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "FI" });
}

export const hilmaProvider: TenderProvider = createHtmlListingProvider({
  key: "hilma",
  countryCode: "FI",
  kind: "government",
  listingUrl: FI_HILMA_LISTING_URL,
  hrefIncludes: ["/tender-notices/"],
});
