import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Nigeria — NOCOPO (Bureau of Public Procurement) open contracting portal.
 *
 * `GET https://nocopo.bpp.gov.ng/` is the Nigerian Open Contracting Portal. The
 * portal publishes no machine-readable feed and blocks automated requests from
 * outside Nigeria, so this adapter is treated as fragile and fails closed — an
 * unreadable page, a rejection, or a listing that yields no notice links is
 * recorded as a source error by the ingestion worker rather than a fabricated
 * tender. The URL is the portal's real address so the customer attribution is
 * faithful.
 */
export const NG_NOCOPO_LISTING_URL = "https://nocopo.bpp.gov.ng/";

/** Normalise one extracted NOCOPO listing row, or null when it has no identity. */
export function normaliseNocopoRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "NG" });
}

export const nocopoProvider: TenderProvider = createHtmlListingProvider({
  key: "nocopo",
  countryCode: "NG",
  kind: "government",
  listingUrl: NG_NOCOPO_LISTING_URL,
  hrefIncludes: ["/nocopo/"],
});
