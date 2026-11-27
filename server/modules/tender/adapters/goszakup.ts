import type { NormalizedTender } from "../provider";
import { createOcdsProvider, normaliseOcdsRelease } from "./ocds";

/**
 * Kazakhstan — Goszakup (goszakup.gov.kz) open contracting feed.
 *
 * Kazakhstan publishes its general government procurement as Open Contracting
 * Data Standard 1.1. The tendering API endpoint is
 * `https://ows.goszakup.gov.kz/v2/ocds` (contracts are published separately at
 * `https://ows.goszakup.gov.kz/ocds-contract`); the schema and endpoints are
 * catalogued by the national open-contracting provider (DPAteam /
 * Kazakhstan_OCDS_schema), and the portal publishes the notices at
 * `https://goszakup.gov.kz/`. The feed is read as an OCDS release package; a
 * payload that is not OCDS-shaped yields nothing and the ingestion worker flags
 * the source unhealthy rather than storing a fabricated tender (fail closed).
 * The notice link is the release's own first document URL, failing back to the
 * portal root so attribution stays faithful.
 */
export const KAZAKHSTAN_OCDS_TENDERS_URL = "https://ows.goszakup.gov.kz/v2/ocds";
const KAZAKHSTAN_PORTAL_URL = "https://goszakup.gov.kz/";

/** Build the customer-facing notice URL from the release's own document, or the portal root. */
export function kazakhstanGoszakupSourceUrl(externalId: string, raw: Record<string, unknown>): string | null {
  const tender = (raw.tender ?? {}) as Record<string, unknown>;
  const documents = Array.isArray(tender.documents) ? (tender.documents as Record<string, unknown>[]) : [];
  const documentUrl = documents.map((document) => document.url).find((url) => typeof url === "string" && url.trim());
  if (typeof documentUrl === "string" && documentUrl.trim()) return documentUrl.trim();
  return externalId ? KAZAKHSTAN_PORTAL_URL : null;
}

/** Normalise one Goszakup OCDS release, or null when it has no usable identity. */
export function normaliseGoszakupRelease(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseOcdsRelease(raw, { countryCode: "KZ", buildSourceUrl: kazakhstanGoszakupSourceUrl });
}

export const goszakupProvider = createOcdsProvider({
  key: "goszakup",
  countryCode: "KZ",
  kind: "government",
  endpoint: KAZAKHSTAN_OCDS_TENDERS_URL,
  buildSourceUrl: kazakhstanGoszakupSourceUrl,
});
