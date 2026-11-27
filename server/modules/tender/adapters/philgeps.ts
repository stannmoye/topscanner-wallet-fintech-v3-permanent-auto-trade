import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Philippines — PhilGEPS (Philippine Government Electronic Procurement System).
 *
 * `https://notices.philgeps.gov.ph/` is the public procurement-notice site of
 * PhilGEPS, operated by the PS-DBM. It publishes no documented machine-readable
 * feed, so this adapter is treated as fragile and fails closed — an unreadable
 * page or a listing that yields no notice links is recorded as a source error by
 * the ingestion worker rather than a fabricated tender. The URL is the real
 * PhilGEPS notice site so attribution is faithful.
 */
export const PHILIPPINES_PHILGEPS_LISTING_URL = "https://notices.philgeps.gov.ph/";

/** Normalise one extracted PhilGEPS listing row, or null when it has no identity. */
export function normalisePhilgepsRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "PH" });
}

export const philgepsProvider: TenderProvider = createHtmlListingProvider({
  key: "philgeps",
  countryCode: "PH",
  kind: "government",
  listingUrl: PHILIPPINES_PHILGEPS_LISTING_URL,
  hrefIncludes: ["/Tender"],
});
