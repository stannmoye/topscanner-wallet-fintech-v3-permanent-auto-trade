import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Sri Lanka — National Procurement Commission notices (treasury.gov.lk).
 *
 * `https://www.treasury.gov.lk/procurement/procurement-notices` is the
 * procurement-notices page of the General Treasury / National Procurement
 * Commission, the body that publishes national procurement notices. The page is a
 * JavaScript-rendered application and publishes no machine-readable feed, so this
 * adapter is treated as fragile and fails closed — a listing that yields no
 * notice links is recorded as a source error by the ingestion worker rather than
 * a fabricated tender. The URL is the real notices page so attribution is faithful.
 */
export const SRI_LANKA_TREASURY_LISTING_URL = "https://www.treasury.gov.lk/procurement/procurement-notices";

/** Normalise one extracted Treasury listing row, or null when it has no identity. */
export function normaliseTreasuryLkRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "LK" });
}

export const treasuryLkProvider: TenderProvider = createHtmlListingProvider({
  key: "treasury_lk",
  countryCode: "LK",
  kind: "government",
  listingUrl: SRI_LANKA_TREASURY_LISTING_URL,
  hrefIncludes: ["/procurement/notice/"],
});
