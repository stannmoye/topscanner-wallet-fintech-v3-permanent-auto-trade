import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Moldova — MTender public portal (public.mtender.gov.md).
 *
 * `https://public.mtender.gov.md/tenders/` is the public tender point of Moldova's
 * MTender electronic procurement service, led by the Ministry of Finance. MTender
 * discloses OCDS 1.1 data, but the public tender point is a JavaScript-rendered
 * application whose list is not exposed to a plain document fetch, so this adapter
 * is treated as fragile and fails closed — a listing that yields no notice links
 * is recorded as a source error by the ingestion worker rather than a fabricated
 * tender. The URL is the portal's real public tender point so attribution is faithful.
 */
export const MOLDOVA_MTENDER_LISTING_URL = "https://public.mtender.gov.md/tenders/";

/** Normalise one extracted MTender listing row, or null when it has no identity. */
export function normaliseMtenderRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "MD" });
}

export const mtenderProvider: TenderProvider = createHtmlListingProvider({
  key: "mtender",
  countryCode: "MD",
  kind: "government",
  listingUrl: MOLDOVA_MTENDER_LISTING_URL,
  hrefIncludes: ["/tenders/"],
});
