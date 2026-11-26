import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Asian Development Bank (ADB) — operational procurement data.
 *
 * `GET https://data.adb.org/dataset/operational-procurement-database` is the ADB
 * open-data landing page for its operational procurement database. The site
 * blocks automated requests (it returns HTTP 403 to the ingestion user agent), so
 * this adapter is treated as fragile and fails closed — an unreadable page, a
 * rejection, or a listing that yields no notice links is recorded as a source
 * error by the ingestion worker rather than a fabricated tender. The URL is the
 * ADB open-data landing page so the customer attribution is faithful.
 */
export const ADB_PROCUREMENT_LISTING_URL = "https://data.adb.org/dataset/operational-procurement-database";

/** Normalise one extracted ADB listing row, or null when it has no identity. */
export function normaliseAdbRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "" });
}

export const adbProvider: TenderProvider = createHtmlListingProvider({
  key: "adb",
  countryCode: "",
  kind: "private",
  listingUrl: ADB_PROCUREMENT_LISTING_URL,
  hrefIncludes: ["/dataset/"],
});
