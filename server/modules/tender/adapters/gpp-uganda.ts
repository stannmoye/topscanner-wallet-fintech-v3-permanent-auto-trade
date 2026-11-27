import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Uganda — Government Procurement Portal (gpp.ppda.go.ug).
 *
 * The PPDA's Government Procurement Portal is the official portal on which all
 * procuring and disposing entities must publish tender notices, bid results and
 * contract awards. The portal is a JavaScript-rendered application and publishes
 * no machine-readable feed, so this adapter is treated as fragile and fails
 * closed — a listing that yields no notice links is recorded as a source error
 * by the ingestion worker rather than a fabricated tender. The URL is the
 * portal's real root so customer attribution is faithful.
 */
export const UGANDA_GPP_LISTING_URL = "https://gpp.ppda.go.ug/";

/** Normalise one extracted GPP listing row, or null when it has no identity. */
export function normaliseGppUgandaRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "UG" });
}

export const gppUgandaProvider: TenderProvider = createHtmlListingProvider({
  key: "gpp_uganda",
  countryCode: "UG",
  kind: "government",
  listingUrl: UGANDA_GPP_LISTING_URL,
  hrefIncludes: ["/tender/"],
});
