import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Belgium — e-Notification (publicprocurement.be) notices.
 *
 * `GET https://www.publicprocurement.be/` is the public e-Notification portal.
 * The portal serves a shell whose notice list is rendered client-side (the
 * underlying service is not published as an open API), so the served HTML carries
 * no notice links. This adapter is therefore treated as fragile and fails closed
 * — a page that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the portal's real
 * address so the customer attribution is faithful.
 */
export const BE_ENOTIFICATION_LISTING_URL = "https://www.publicprocurement.be/";

/** Normalise one extracted e-Notification listing row, or null when it has no identity. */
export function normaliseEnotificationRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "BE" });
}

export const enotificationProvider: TenderProvider = createHtmlListingProvider({
  key: "enotification",
  countryCode: "BE",
  kind: "government",
  listingUrl: BE_ENOTIFICATION_LISTING_URL,
  hrefIncludes: ["/notices/"],
});
