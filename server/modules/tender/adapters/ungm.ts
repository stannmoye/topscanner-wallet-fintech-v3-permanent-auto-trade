import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * United Nations Global Marketplace (UNGM) — public notice listing.
 *
 * `GET https://www.ungm.org/Public/Notice` is UNGM's public notice board. The
 * board renders its notice list client-side from an internal search endpoint that
 * requires an anti-forgery token (the board's own `/Public/Notice/Search` rejects
 * a bare POST), so the served HTML carries no notice links and this adapter is
 * treated as fragile and fails closed — a page that yields no notice links is
 * recorded as a source error by the ingestion worker rather than a fabricated
 * tender. The URL is UNGM's real notice board so the customer attribution is
 * faithful.
 */
export const UNGM_LISTING_URL = "https://www.ungm.org/Public/Notice";

/** Normalise one extracted UNGM listing row, or null when it has no identity. */
export function normaliseUngmRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "" });
}

export const ungmProvider: TenderProvider = createHtmlListingProvider({
  key: "ungm",
  countryCode: "",
  kind: "private",
  listingUrl: UNGM_LISTING_URL,
  hrefIncludes: ["/public/notice/"],
});
