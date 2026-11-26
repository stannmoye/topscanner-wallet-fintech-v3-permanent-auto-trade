import type { NormalizedTender, TenderProvider } from "../provider";
import { createOcdsProvider, normaliseOcdsRelease } from "./ocds";
import { pickString } from "../normalise";

/**
 * Australia — AusTender OCDS published contracts.
 *
 * `GET https://api.tenders.gov.au/ocds/findByDates/contractPublished/{from}/{to}`
 * is AusTender's documented OCDS 1.1 feed of published contract notices. The
 * date window is part of the path and must be a full UTC ISO-8601 instant
 * (`YYYY-MM-DDTHH:MM:SSZ`); a date-only value is rejected by the API. Each
 * release carries the notice under `contracts`/`awards` rather than `tender`, so
 * the shared OCDS normaliser reads those blocks. AusTender publishes no stable
 * human notice deep-link in the feed, so the customer is pointed at AusTender's
 * own contract search for the contract's CN reference.
 */
export const AUSTENDER_OCDS_URL = "https://api.tenders.gov.au/ocds/findByDates/contractPublished";
const AUSTENDER_SEARCH_URL = "https://www.tenders.gov.au/cn/search";
const AUSTENDER_WINDOW_DAYS = 7;

/** Format an instant as the `YYYY-MM-DDTHH:MM:SSZ` the AusTender path requires. */
function austenderInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Build the AusTender OCDS request URL for the window ending now. */
export function buildAustenderUrl(params: { since?: Date }): string {
  const to = new Date();
  const from = params.since ?? new Date(to.getTime() - AUSTENDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return `${AUSTENDER_OCDS_URL}/${austenderInstant(from)}/${austenderInstant(to)}`;
}

/** Build the customer-facing notice URL (AusTender's own contract search), or null. */
export function buildAustenderSourceUrl(externalId: string, raw: Record<string, unknown>): string | null {
  const contract = Array.isArray(raw.contracts) ? (raw.contracts[0] as Record<string, unknown> | undefined) : undefined;
  const contractId = pickString(contract?.id, externalId);
  if (!contractId) return null;
  return `${AUSTENDER_SEARCH_URL}?searchTerm=${encodeURIComponent(contractId)}`;
}

/** Normalise one AusTender OCDS release, or null when it has no identity. */
export function normaliseAustenderRelease(raw: Record<string, unknown>): NormalizedTender | null {
  return normaliseOcdsRelease(raw, { countryCode: "AU", buildSourceUrl: buildAustenderSourceUrl });
}

export const austenderProvider: TenderProvider = createOcdsProvider({
  key: "austender",
  countryCode: "AU",
  kind: "government",
  endpoint: AUSTENDER_OCDS_URL,
  buildUrl: buildAustenderUrl,
  buildSourceUrl: buildAustenderSourceUrl,
});
