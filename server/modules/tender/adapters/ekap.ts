import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Turkiye — EKAP (Elektronik Kamu Alimlari Platformu) tender search.
 *
 * `https://ekap.kik.gov.tr/EKAP/Ortak/IhaleArama/index.html` is the public EKAP
 * tender-search page operated by KIK. It publishes no machine-readable feed and
 * is largely client-rendered, so this adapter is treated as fragile and fails
 * closed — an unreadable page or a listing that yields no notice links is
 * recorded as a source error by the ingestion worker rather than a fabricated
 * tender. The URL is EKAP's real search page so the customer attribution is
 * faithful.
 */
export const TURKIYE_EKAP_LISTING_URL = "https://ekap.kik.gov.tr/EKAP/Ortak/IhaleArama/index.html";

/** Normalise one extracted EKAP listing row, or null when it has no identity. */
export function normaliseEkapRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "TR" });
}

export const ekapProvider: TenderProvider = createHtmlListingProvider({
  key: "ekap",
  countryCode: "TR",
  kind: "government",
  listingUrl: TURKIYE_EKAP_LISTING_URL,
  hrefIncludes: ["ihale"],
});
