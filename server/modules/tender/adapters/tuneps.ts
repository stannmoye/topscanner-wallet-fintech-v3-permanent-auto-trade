import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Tunisia — TUNEPS (Tunisian Online E-Procurement System, tuneps.tn).
 *
 * TUNEPS is the mandatory national e-procurement platform operated under HAICOP;
 * the public consultations listing is `https://www.tuneps.tn/portail/consultations`.
 * The portal returns its listing through a session-backed view and publishes no
 * machine-readable feed, so this adapter is treated as fragile and fails closed —
 * a listing that yields no notice links is recorded as a source error by the
 * ingestion worker rather than a fabricated tender. The URL is the portal's real
 * public consultations page so customer attribution is faithful.
 */
export const TUNISIA_TUNEPS_LISTING_URL = "https://www.tuneps.tn/portail/consultations";

/** Normalise one extracted TUNEPS listing row, or null when it has no identity. */
export function normaliseTunepsRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "TN" });
}

export const tunepsProvider: TenderProvider = createHtmlListingProvider({
  key: "tuneps",
  countryCode: "TN",
  kind: "government",
  listingUrl: TUNISIA_TUNEPS_LISTING_URL,
  hrefIncludes: ["/portail/consultations/"],
});
