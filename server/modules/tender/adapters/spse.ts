import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Indonesia — SPSE / LKPP national e-tendering (lelang) listing.
 *
 * `https://spse.inaproc.id/nasional/lelang` is the national public tender
 * (lelang) listing of SPSE, Indonesia's government e-procurement system operated
 * by LKPP. It publishes no machine-readable national feed and renders results
 * client-side, so this adapter is treated as fragile and fails closed — an
 * unreadable page or a listing that yields no notice links is recorded as a
 * source error by the ingestion worker rather than a fabricated tender. The URL
 * is the real SPSE national listing page so attribution is faithful.
 */
export const INDONESIA_SPSE_LISTING_URL = "https://spse.inaproc.id/nasional/lelang";

/** Normalise one extracted SPSE listing row, or null when it has no identity. */
export function normaliseSpseRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "ID" });
}

export const spseProvider: TenderProvider = createHtmlListingProvider({
  key: "spse",
  countryCode: "ID",
  kind: "government",
  listingUrl: INDONESIA_SPSE_LISTING_URL,
  hrefIncludes: ["/lelang/"],
});
