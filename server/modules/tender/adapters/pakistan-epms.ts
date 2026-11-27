import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Pakistan — EPMS (Electronic Procurement Management System) active tenders.
 *
 * `https://epms.ppra.gov.pk/public/tenders/active-tenders` is the public
 * active-tenders listing of EPMS, the federal e-procurement system overseen by
 * the Public Procurement Regulatory Authority (PPRA). It publishes no documented
 * machine-readable feed, so this adapter is treated as fragile and fails closed —
 * an unreadable page or a listing that yields no notice links is recorded as a
 * source error by the ingestion worker rather than a fabricated tender. The URL
 * is the real EPMS active-tenders page so attribution is faithful.
 */
export const PAKISTAN_EPMS_LISTING_URL = "https://epms.ppra.gov.pk/public/tenders/active-tenders";

/** Normalise one extracted EPMS listing row, or null when it has no identity. */
export function normalisePakistanEpmsRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "PK" });
}

export const pakistanEpmsProvider: TenderProvider = createHtmlListingProvider({
  key: "pakistan_epms",
  countryCode: "PK",
  kind: "government",
  listingUrl: PAKISTAN_EPMS_LISTING_URL,
  hrefIncludes: ["/tenders/"],
});
