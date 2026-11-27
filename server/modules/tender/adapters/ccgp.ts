import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * China — China Government Procurement Network (CCGP) public-bid notices.
 *
 * `https://www.ccgp.gov.cn/cggg/zygg/gkzb/` is the central-government
 * "public tender announcements" listing of the official China Government
 * Procurement Network (中国政府购买服务信息平台), whose notice links live under
 * the `/cggg/` tree. The portal publishes no machine-readable feed and fronts
 * automated callers with a challenge, so this adapter is treated as fragile and
 * fails closed — an unreadable page or a listing that yields no notice links is
 * recorded as a source error by the ingestion worker rather than a fabricated
 * tender. The URL is the real CCGP listing page so attribution is faithful.
 */
export const CHINA_CCGP_LISTING_URL = "https://www.ccgp.gov.cn/cggg/zygg/gkzb/";

/** Normalise one extracted CCGP listing row, or null when it has no identity. */
export function normaliseCcgpRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "CN" });
}

export const ccgpProvider: TenderProvider = createHtmlListingProvider({
  key: "ccgp",
  countryCode: "CN",
  kind: "government",
  listingUrl: CHINA_CCGP_LISTING_URL,
  hrefIncludes: ["/cggg/"],
});
