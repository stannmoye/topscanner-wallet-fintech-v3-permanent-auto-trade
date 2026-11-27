import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Vietnam — MuaSamCong (National E-Procurement System) public tender notices.
 *
 * `https://muasamcong.mof.gov.vn/` is the national e-procurement portal run by
 * the Ministry of Finance, where state procurement notices are published. It
 * publishes no documented machine-readable feed and renders results
 * client-side, so this adapter is treated as fragile and fails closed — an
 * unreadable page or a listing that yields no notice links is recorded as a
 * source error by the ingestion worker rather than a fabricated tender. The URL
 * is the real MuaSamCong portal so attribution is faithful.
 */
export const VIETNAM_MUASAMCONG_LISTING_URL = "https://muasamcong.mof.gov.vn/";

/** Normalise one extracted MuaSamCong listing row, or null when it has no identity. */
export function normaliseMuasamcongRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "VN" });
}

export const muasamcongProvider: TenderProvider = createHtmlListingProvider({
  key: "muasamcong",
  countryCode: "VN",
  kind: "government",
  listingUrl: VIETNAM_MUASAMCONG_LISTING_URL,
  hrefIncludes: ["/web/"],
});
