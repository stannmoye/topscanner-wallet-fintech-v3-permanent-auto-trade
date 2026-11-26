import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Norway — Doffin public notices.
 *
 * `GET https://doffin.no/notices` is the public notice listing. The site is a
 * single-page application: the listing is rendered client-side and the served
 * HTML carries no notice links, so this adapter is treated as fragile and fails
 * closed — a page that yields no notice links is recorded as a source error by
 * the ingestion worker rather than a fabricated tender. The URL is the portal's
 * real, documented notice page so the customer attribution is faithful.
 */
export const NO_DOFFIN_LISTING_URL = "https://doffin.no/notices";

/** Normalise one extracted Doffin listing row, or null when it has no identity. */
export function normaliseDoffinRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "NO" });
}

export const doffinProvider: TenderProvider = createHtmlListingProvider({
  key: "doffin",
  countryCode: "NO",
  kind: "government",
  listingUrl: NO_DOFFIN_LISTING_URL,
  hrefIncludes: ["/notices/"],
});
