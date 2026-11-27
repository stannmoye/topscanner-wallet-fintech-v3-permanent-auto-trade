import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Morocco — Portail Marocain des Marches Publics.
 *
 * `https://www.marchespublics.gov.ma/` is the official Moroccan public
 * procurement portal that publishes appel d'offres (tender) notices. It publishes
 * no documented machine-readable feed and renders results client-side, so this
 * adapter is treated as fragile and fails closed — an unreadable page or a
 * listing that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the real portal so
 * attribution is faithful.
 */
export const MOROCCO_MARCHESPUBLICS_LISTING_URL = "https://www.marchespublics.gov.ma/";

/** Normalise one extracted Marches Publics listing row, or null when it has no identity. */
export function normaliseMarchespublicsRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "MA" });
}

export const marchespublicsProvider: TenderProvider = createHtmlListingProvider({
  key: "marchespublics",
  countryCode: "MA",
  kind: "government",
  listingUrl: MOROCCO_MARCHESPUBLICS_LISTING_URL,
  hrefIncludes: ["appel-offres"],
});
