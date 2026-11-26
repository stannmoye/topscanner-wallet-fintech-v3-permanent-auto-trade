import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * African Development Bank (AfDB) — project-related procurement notices.
 *
 * `GET https://www.afdb.org/en/documents/project-related-procurement/procurement-notices`
 * is the Bank's public procurement-notice listing. The site blocks automated
 * requests (it returns HTTP 403 to the ingestion user agent), so this adapter is
 * treated as fragile and fails closed — an unreadable page, a rejection, or a
 * listing that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the Bank's real
 * notice listing so the customer attribution is faithful.
 */
export const AFDB_PROCUREMENT_LISTING_URL =
  "https://www.afdb.org/en/documents/project-related-procurement/procurement-notices";

/** Normalise one extracted AfDB listing row, or null when it has no identity. */
export function normaliseAfdbRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "" });
}

export const afdbProvider: TenderProvider = createHtmlListingProvider({
  key: "afdb",
  countryCode: "",
  kind: "private",
  listingUrl: AFDB_PROCUREMENT_LISTING_URL,
  hrefIncludes: ["/en/documents/"],
});
