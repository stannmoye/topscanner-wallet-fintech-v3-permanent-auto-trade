import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Serbia — Public Procurement Portal (jnportal.ujn.gov.rs).
 *
 * `https://jnportal.ujn.gov.rs/oglasi-svi` is the "all notices" listing of
 * Serbia's Public Procurement Portal, operated by the Public Procurement
 * Administration (Uprava za javne nabavke). Notices are served through an
 * ASP.NET post-back view and the portal publishes no machine-readable feed, so
 * this adapter is treated as fragile and fails closed — a listing that yields no
 * notice links is recorded as a source error by the ingestion worker rather than
 * a fabricated tender. The URL is the portal's real notices listing so
 * attribution is faithful.
 */
export const SERBIA_PORTAL_LISTING_URL = "https://jnportal.ujn.gov.rs/oglasi-svi";

/** Normalise one extracted Serbian portal listing row, or null when it has no identity. */
export function normaliseRsPortalRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "RS" });
}

export const rsPortalProvider: TenderProvider = createHtmlListingProvider({
  key: "rs_portal",
  countryCode: "RS",
  kind: "government",
  listingUrl: SERBIA_PORTAL_LISTING_URL,
  hrefIncludes: ["/oglas/", "/postupak/"],
});
