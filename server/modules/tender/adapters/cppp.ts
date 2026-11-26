import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * India — CPPP / eProcure latest active tenders.
 *
 * `GET https://eprocure.gov.in/cppp/latestactivetenders` is the Central Public
 * Procurement Portal's public listing. The portal publishes no machine-readable
 * feed and blocks automated requests from outside India, so this adapter is
 * treated as fragile and fails closed — an unreadable page, a rejection, or a
 * listing that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the portal's real
 * listing so the customer attribution is faithful.
 */
export const IN_CPPP_LISTING_URL = "https://eprocure.gov.in/cppp/latestactivetenders";

/** Normalise one extracted CPPP listing row, or null when it has no identity. */
export function normaliseCpppRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "IN" });
}

export const cpppProvider: TenderProvider = createHtmlListingProvider({
  key: "cppp",
  countryCode: "IN",
  kind: "government",
  listingUrl: IN_CPPP_LISTING_URL,
  hrefIncludes: ["/cppp/"],
});
