import type { NormalizedTender, TenderProvider } from "../provider";
import { createHtmlListingProvider, normaliseHtmlListingRow } from "./html-listing";

/**
 * Mexico — ComprasMX (the federal procurement platform that replaced CompraNet).
 *
 * `https://comprasmx.buengobierno.gob.mx/sitiopublico/` is the documented public
 * diffusion site of ComprasMX, where the Secretaria de la Funcion Publica
 * publishes federal procurement procedures. The site is a client-rendered
 * application that publishes no machine-readable feed, so this adapter is treated
 * as fragile and fails closed — an unreadable page or a listing that yields no
 * notice links is recorded as a source error by the ingestion worker rather than
 * a fabricated tender. The URL is the real public diffusion page so attribution
 * is faithful.
 */
export const MEXICO_COMPRASMX_LISTING_URL = "https://comprasmx.buengobierno.gob.mx/sitiopublico/";

/** Normalise one extracted ComprasMX listing row, or null when it has no identity. */
export function normaliseComprasmxRow(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseHtmlListingRow(raw as { title: string; url: string }, { countryCode: "MX" });
}

export const comprasmxProvider: TenderProvider = createHtmlListingProvider({
  key: "comprasmx",
  countryCode: "MX",
  kind: "government",
  listingUrl: MEXICO_COMPRASMX_LISTING_URL,
  hrefIncludes: ["procedimiento"],
});
