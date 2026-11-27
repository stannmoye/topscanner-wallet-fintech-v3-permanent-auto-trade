import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Japan — KKJ (Kobetsu Kikaku Jigyo) public-procurement information site.
 *
 * `https://www.kkj.go.jp/s/` is the public search site for Japanese government
 * procurement notices, run for the Cabinet Office. It publishes no
 * machine-readable feed and renders its results client-side, so this adapter is
 * treated as fragile and fails closed — an unreadable page or a listing that
 * yields no notice links is recorded as a source error by the ingestion worker
 * rather than a fabricated tender. The URL is the real KKJ search site so
 * attribution is faithful.
 */
export const JAPAN_KKJ_LISTING_URL = "https://www.kkj.go.jp/s/";

/** Normalise one extracted KKJ listing row, or null when it has no identity. */
export function normaliseKkjRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "JP" });
}

export const kkjProvider: TenderProvider = createHtmlListingProvider({
  key: "kkj",
  countryCode: "JP",
  kind: "government",
  listingUrl: JAPAN_KKJ_LISTING_URL,
  hrefIncludes: ["/s/"],
});
