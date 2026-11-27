import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Georgia — State Procurement Agency e-procurement (tenders.procurement.gov.ge).
 *
 * The State Procurement Agency operates Georgia's unified electronic procurement
 * system at `https://tenders.procurement.gov.ge/`, publishing all public
 * procurement above the simplified threshold. The portal is a JavaScript-rendered
 * application and publishes no machine-readable feed, so this adapter is treated
 * as fragile and fails closed — a listing that yields no notice links is recorded
 * as a source error by the ingestion worker rather than a fabricated tender. The
 * URL is the portal's real root so attribution is faithful.
 */
export const GEORGIA_PROCUREMENT_LISTING_URL = "https://tenders.procurement.gov.ge/";

/** Normalise one extracted SPA listing row, or null when it has no identity. */
export function normaliseGeorgiaProcurementRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "GE" });
}

export const georgiaProcurementProvider: TenderProvider = createHtmlListingProvider({
  key: "georgia_procurement",
  countryCode: "GE",
  kind: "government",
  listingUrl: GEORGIA_PROCUREMENT_LISTING_URL,
  hrefIncludes: ["/tender/"],
});
