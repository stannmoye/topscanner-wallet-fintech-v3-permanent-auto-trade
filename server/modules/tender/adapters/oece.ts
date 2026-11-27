import type { NormalizedTender } from "../provider";
import { createOcdsProvider, normaliseOcdsRelease } from "./ocds";

/**
 * Peru — OECE Contrataciones Abiertas (Open Contracting).
 *
 * `GET https://contratacionesabiertas.oece.gob.pe/api/releases` is the
 * documented OCDS release endpoint of Peru's open-contracting portal, operated by
 * OECE and transforming SEACE V1/V2/V3 into the Open Contracting Data Standard
 * (`{ releases: [ … ] }`). The portal serves its public SPA shell to automated
 * callers that do not present a browser session, so a payload that is not an OCDS
 * release package makes the JSON normaliser yield nothing and the ingestion
 * worker records the source as unhealthy (fail closed) rather than storing a
 * fabricated tender. The notice link is the release's own first document URL,
 * failing back to the portal root so attribution stays faithful.
 */
export const PERU_OECE_RELEASES_URL = "https://contratacionesabiertas.oece.gob.pe/api/releases";
const PERU_OECE_PORTAL_URL = "https://contratacionesabiertas.oece.gob.pe/";

/** Build the customer-facing notice URL from the release's own document, or the portal root. */
export function peruOeceSourceUrl(externalId: string, raw: Record<string, unknown>): string | null {
  const tender = (raw.tender ?? {}) as Record<string, unknown>;
  const documents = Array.isArray(tender.documents) ? (tender.documents as Record<string, unknown>[]) : [];
  const documentUrl = documents.map((document) => document.url).find((url) => typeof url === "string" && url.trim());
  if (typeof documentUrl === "string" && documentUrl.trim()) return documentUrl.trim();
  return externalId ? PERU_OECE_PORTAL_URL : null;
}

/** Normalise one OECE OCDS release, or null when it has no usable identity. */
export function normaliseOeceRelease(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseOcdsRelease(raw, { countryCode: "PE", buildSourceUrl: peruOeceSourceUrl });
}

export const oeceProvider = createOcdsProvider({
  key: "oece",
  countryCode: "PE",
  kind: "government",
  endpoint: PERU_OECE_RELEASES_URL,
  buildSourceUrl: peruOeceSourceUrl,
});
