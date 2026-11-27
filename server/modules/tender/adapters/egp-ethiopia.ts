import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Ethiopia — Electronic Government Procurement (eGP, production.egp.gov.et).
 *
 * `https://production.egp.gov.et/egp/bids/all` is the tender-note listing of the
 * national eGP platform operated by the FDRE Public Procurement and Property
 * Authority. The portal gates notices behind a supplier session and publishes no
 * machine-readable feed, so this adapter is treated as fragile and fails closed —
 * a listing that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the portal's real
 * bids listing so attribution is faithful.
 */
export const ETHIOPIA_EGP_LISTING_URL = "https://production.egp.gov.et/egp/bids/all";

/** Normalise one extracted eGP listing row, or null when it has no identity. */
export function normaliseEgpEthiopiaRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "ET" });
}

export const egpEthiopiaProvider: TenderProvider = createHtmlListingProvider({
  key: "egp_ethiopia",
  countryCode: "ET",
  kind: "government",
  listingUrl: ETHIOPIA_EGP_LISTING_URL,
  hrefIncludes: ["/egp/bids/"],
});
