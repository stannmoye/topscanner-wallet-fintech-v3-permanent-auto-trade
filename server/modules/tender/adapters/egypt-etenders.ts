import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Egypt — Government Procurement Portal (etenders.gov.eg).
 *
 * `https://etenders.gov.eg/` is the official Egyptian Government Procurement
 * Portal (بوابة التعاقدات العامة) that publishes public tenders and bidding
 * documents. It publishes no documented machine-readable feed and fronts
 * automated callers, so this adapter is treated as fragile and fails closed — an
 * unreadable page or a listing that yields no notice links is recorded as a
 * source error by the ingestion worker rather than a fabricated tender. The URL
 * is the real portal so attribution is faithful.
 */
export const EGYPT_ETENDERS_LISTING_URL = "https://etenders.gov.eg/";

/** Normalise one extracted Egypt portal listing row, or null when it has no identity. */
export function normaliseEgyptEtendersRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "EG" });
}

export const egyptEtendersProvider: TenderProvider = createHtmlListingProvider({
  key: "egypt_etenders",
  countryCode: "EG",
  kind: "government",
  listingUrl: EGYPT_ETENDERS_LISTING_URL,
  hrefIncludes: ["/tender"],
});
