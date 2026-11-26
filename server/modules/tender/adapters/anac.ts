import type { NormalizedTender, TenderProvider } from "../provider";
import { createOcdsProvider, normaliseOcdsRelease } from "./ocds";
import { pickString } from "../normalise";

/**
 * Italy — ANAC open-data OCDS releases.
 *
 * `GET https://dati.anticorruzione.it/opendata/api/ocds/releases` is the ANAC
 * (Autorità Nazionale Anticorruzione) Open Data platform's OCDS release feed of
 * published Italian contracts. The platform fronts its API with a web
 * application firewall that can reject automated requests, so this adapter is
 * treated as fragile: a rejection or an unreadable payload yields nothing (fail
 * closed) and the ingestion worker flags the source unhealthy rather than
 * inventing tenders. The notice's own document URL is preferred for attribution;
 * when a release carries none, the ANAC portal is used as a best-effort fallback.
 */
export const ANAC_OCDS_RELEASES_URL = "https://dati.anticorruzione.it/opendata/api/ocds/releases";
const ANAC_PORTAL_URL = "https://dati.anticorruzione.it/";

/** Build the customer-facing notice URL for an ANAC release, or null when it has no identity. */
export function buildAnacSourceUrl(externalId: string, raw: Record<string, unknown>): string | null {
  const tender = (raw.tender ?? {}) as Record<string, unknown>;
  const documents = Array.isArray(tender.documents) ? (tender.documents as Record<string, unknown>[]) : [];
  for (const document of documents) {
    const url = pickString(document.url);
    if (url) return url;
  }
  return externalId ? `${ANAC_PORTAL_URL}#/gare/${encodeURIComponent(externalId)}` : null;
}

/** Normalise one ANAC OCDS release, or null when it has no identity. */
export function normaliseAnacRelease(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseOcdsRelease(raw, { countryCode: "IT", buildSourceUrl: buildAnacSourceUrl });
}

export const anacProvider: TenderProvider = createOcdsProvider({
  key: "anac",
  countryCode: "IT",
  kind: "government",
  endpoint: ANAC_OCDS_RELEASES_URL,
  buildSourceUrl: buildAnacSourceUrl,
});
