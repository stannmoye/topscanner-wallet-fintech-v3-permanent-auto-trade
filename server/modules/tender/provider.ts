/**
 * Tender Bid — provider contract and normalised model.
 *
 * A `TenderProvider` is the single seam between the ingestion worker and an
 * external tender source. A provider may be a documented API/OCDS feed, an
 * open-data file, or a scraper; the rest of the system only ever sees the
 * normalised shape below, so adding or replacing a source never changes the
 * customer or administrator experience.
 *
 * Providers return raw, source-shaped items. Normalisation (currency kept as
 * its own code, dates as ISO strings, long descriptions preserved verbatim)
 * happens in the adapter layer; USD conversion happens later against a fresh FX
 * snapshot and never inside a provider.
 */

/** Whether a source is an official government portal or a private/supranational aggregator. */
export type TenderSourceKind = "government" | "private";

/** Valid `tender_sources.kind` values. */
export const TENDER_SOURCE_KINDS: readonly TenderSourceKind[] = ["government", "private"];

/** Customer-visible tender status, derived from the bidding window. */
export type TenderStatus = "upcoming" | "open" | "closing" | "closed" | "awarded";

/** Valid `tenders.status` values. */
export const TENDER_STATUSES: readonly TenderStatus[] = ["upcoming", "open", "closing", "closed", "awarded"];

/** Lifecycle of a customer bid. */
export type TenderBidStatus = "placed" | "charge_pending" | "charged" | "won" | "lost" | "cancelled";

/** Valid `tender_bids.status` values. */
export const TENDER_BID_STATUSES: readonly TenderBidStatus[] = ["placed", "charge_pending", "charged", "won", "lost", "cancelled"];

/** Parameters passed to a provider fetch. Providers that cannot fetch incrementally ignore `since`. */
export type TenderFetchParams = {
  /** Only return items published/updated on or after this instant, when the source supports it. */
  since?: Date;
  /** Opaque pagination cursor returned by a previous page. */
  cursor?: string | null;
};

/** One page of raw, source-shaped items plus the cursor for the next page. */
export type RawTenderPage<TRaw = unknown> = {
  items: TRaw[];
  /** Next-page cursor, or null/absent when there are no further pages. */
  nextCursor?: string | null;
};

/** A document or link attached to a tender. */
export type NormalizedTenderDocument = { label: string; url: string };

/**
 * The single normalised shape every provider adapter must produce.
 *
 * `contractAmountMinor` is the source's native-currency amount in integer minor
 * units and `contractCurrency` is its ISO 4217 code; the USD equivalent is
 * derived later from a fresh FX snapshot (never guessed). Dates are ISO-8601
 * strings or null. `raw` keeps the untouched source record for auditing.
 */
export type NormalizedTender = {
  externalId: string;
  countryCode: string;
  title: string;
  buyer: string | null;
  buyerType: string | null;
  industry: string | null;
  tenderType: string | null;
  procedure: string | null;
  contractAmountMinor: number | null;
  contractCurrency: string | null;
  bidOpenAt: string | null;
  bidCloseAt: string | null;
  payoutAt: string | null;
  publishedAt: string | null;
  summary: string | null;
  descriptionText: string | null;
  documents: NormalizedTenderDocument[];
  sourceUrl: string;
  raw: unknown;
};

/**
 * Every tender source adapter implements this interface. `key` and `countryCode`
 * mirror the `tender_sources` registry row so the worker can route a fetch back
 * to its source, and `kind` records whether the source is official or private.
 */
export interface TenderProvider {
  /** Stable registry key, e.g. "sam_gov". */
  key: string;
  /** ISO 3166-1 alpha-2 country code, or "" for supranational sources. */
  countryCode: string;
  kind: TenderSourceKind;
  /** Fetch one page of raw source items, optionally incrementally. */
  fetch(params: TenderFetchParams): Promise<RawTenderPage>;
}
