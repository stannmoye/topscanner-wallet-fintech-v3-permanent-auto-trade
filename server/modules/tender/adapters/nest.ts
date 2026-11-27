import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Tanzania — NeST (National e-Procurement System of Tanzania).
 *
 * `https://nest.go.tz/tenders/published-tenders` is the published-tenders listing
 * of Tanzania's national e-procurement system. The portal is a JavaScript-rendered
 * application and publishes no machine-readable feed, so this adapter is treated
 * as fragile and fails closed — a listing that yields no notice links is recorded
 * as a source error by the ingestion worker rather than a fabricated tender. The
 * URL is the portal's real published-tenders page so attribution is faithful.
 */
export const TANZANIA_NEST_LISTING_URL = "https://nest.go.tz/tenders/published-tenders";

/** Normalise one extracted NeST listing row, or null when it has no identity. */
export function normaliseNestRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "TZ" });
}

export const nestProvider: TenderProvider = createHtmlListingProvider({
  key: "nest",
  countryCode: "TZ",
  kind: "government",
  listingUrl: TANZANIA_NEST_LISTING_URL,
  hrefIncludes: ["/tenders/"],
});
