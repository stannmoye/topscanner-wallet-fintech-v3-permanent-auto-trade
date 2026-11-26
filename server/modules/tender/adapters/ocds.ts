import type {
  NormalizedTender,
  RawTenderPage,
  TenderFetchParams,
  TenderProvider,
  TenderSourceKind,
} from "../provider";
import { fetchJson } from "../http";
import { toIsoCountryCode } from "../countries";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  firstLocalisedString,
  normaliseCurrencyCode,
  normaliseWhitespace,
  pickString,
  toIsoString,
  toMinorUnits,
  truncate,
} from "../normalise";

/**
 * Tender Bid — generic Open Contracting Data Standard (OCDS) adapter.
 *
 * Several national portals publish an OCDS release package through a documented
 * REST endpoint. Rather than a bespoke module per country, this factory turns a
 * configured endpoint into a `TenderProvider` and normalises each release with
 * the shared `normaliseOcdsRelease`. The normaliser reads an OCDS release
 * tolerantly: some publishers put the notice under `tender`, others (an award
 * notice, for example Australia's AusTender) only under `contracts`/`awards`,
 * and the buyer may be a top-level `buyer` or a `parties` entry with the
 * `procuringEntity` role. A release that yields no id or no usable source URL is
 * rejected rather than stored with a placeholder (fail closed), so a portal that
 * is not OCDS-shaped simply produces nothing.
 */

export type OcdsAdapterConfig = {
  key: string;
  /** ISO alpha-2, or "" for a supranational feed that resolves the country per release. */
  countryCode: string;
  kind: TenderSourceKind;
  /** The documented API endpoint the adapter calls. */
  endpoint: string;
  /** Build the customer-facing notice URL, or null when the release has no identity. */
  buildSourceUrl: (externalId: string, raw: Record<string, unknown>) => string | null;
  /** Query string appended to the endpoint (a date window, for example). */
  buildQuery?: (params: TenderFetchParams) => Record<string, string>;
  /** Build the full request URL, overriding `endpoint` + `buildQuery` (a path-based date window, for example). */
  buildUrl?: (params: TenderFetchParams) => string;
  /** Fully control pagination when the endpoint's paging is not a simple query offset. */
  fetchPage?: (params: TenderFetchParams) => Promise<RawTenderPage>;
  /** Extract raw releases from the payload (default: `payload.releases`). */
  extractReleases?: (payload: unknown) => Record<string, unknown>[];
  /** Next-page cursor (default: none — these endpoints are window-bounded). */
  extractNextCursor?: (payload: unknown) => string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** The first entry of an OCDS collection block (`contracts`, `awards`, …). */
function firstOf(block: unknown): Record<string, unknown> {
  return asArray(block)[0] ?? {};
}

/** The procuring-entity party in a release, or an empty record. */
function procuringEntity(raw: Record<string, unknown>): Record<string, unknown> {
  for (const party of asArray(raw.parties)) {
    const roles = Array.isArray(party.roles) ? party.roles : [];
    if (roles.includes("procuringEntity") || roles.includes("buyer")) return party;
  }
  return {};
}

function ocdsDocuments(tender: Record<string, unknown>, contract: Record<string, unknown>): { label: string; url: string }[] {
  const source = Array.isArray(tender.documents) ? tender.documents : asArray(contract.documents);
  const result: { label: string; url: string }[] = [];
  for (const item of source) {
    const document = asRecord(item);
    const url = pickString(document.url);
    if (!url) continue;
    result.push({ label: pickString(document.title, document.description) ?? "Tender document", url });
  }
  return result;
}

/**
 * Normalise one OCDS release into the shared model. Reads the tender, buyer,
 * contract, award and period blocks tolerantly; a release without an id or a
 * usable source URL is rejected rather than stored with a placeholder.
 */
export function normaliseOcdsRelease(
  raw: Record<string, unknown>,
  options: { countryCode: string; buildSourceUrl: (externalId: string, raw: Record<string, unknown>) => string | null },
): NormalizedTender | null {
  const tender = asRecord(raw.tender);
  const contract = firstOf(raw.contracts);
  const award = firstOf(raw.awards);
  const externalId = pickString(raw.id, raw.ocid, contract.id);
  if (!externalId) return null;
  const title = firstLocalisedString(tender.title)
    ?? pickString(contract.title, award.title, raw.ocid, externalId);
  if (!title) return null;
  const sourceUrl = options.buildSourceUrl(externalId, raw);
  if (!sourceUrl) return null;

  const buyer = asRecord(raw.buyer);
  const entity = procuringEntity(raw);
  const buyerAddress = asRecord(buyer.address);
  const entityAddress = asRecord(entity.address);
  const value = { ...asRecord(award.value), ...asRecord(contract.value), ...asRecord(tender.value) };
  const period = { ...asRecord(contract.period), ...asRecord(award.period), ...asRecord(tender.tenderPeriod) };
  const classification = {
    ...asRecord(asArray(contract.items)[0]?.classification),
    ...asRecord(tender.classification),
  };
  const amountMinor = toMinorUnits(value.amount, 2);

  const countryCode = options.countryCode
    || toIsoCountryCode(buyerAddress.countryName ?? entityAddress.countryName ?? raw.countryName);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode,
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(firstLocalisedString(buyer.name), entity.name)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv: classification.id, categoryName: tender.mainProcurementCategory }),
    tenderType: truncate(pickString(tender.mainProcurementCategory), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(tender.procurementMethodDetails, tender.procurementMethod), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode(value.currency),
    bidOpenAt: toIsoString(period.startDate),
    bidCloseAt: toIsoString(period.endDate),
    payoutAt: null,
    publishedAt: toIsoString(raw.date),
    summary: truncate(normaliseWhitespace(firstLocalisedString([tender.description, contract.description])), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(firstLocalisedString([tender.description, contract.description])),
    documents: ocdsDocuments(tender, contract),
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

/** Build a `TenderProvider` for an OCDS endpoint. */
export function createOcdsProvider(config: OcdsAdapterConfig): TenderProvider {
  const extractReleases = config.extractReleases ?? ((payload: unknown) => asArray((payload as { releases?: unknown })?.releases));

  async function defaultFetch(params: TenderFetchParams): Promise<RawTenderPage> {
    let url = config.buildUrl?.(params) ?? config.endpoint;
    if (!config.buildUrl) {
      const parsed = new URL(config.endpoint);
      for (const [name, value] of Object.entries(config.buildQuery?.(params) ?? {})) {
        parsed.searchParams.set(name, value);
      }
      url = parsed.toString();
    }
    const payload = await fetchJson(url);
    return {
      items: extractReleases(payload),
      nextCursor: config.extractNextCursor?.(payload) ?? null,
    };
  }

  return {
    key: config.key,
    countryCode: config.countryCode,
    kind: config.kind,
    fetch: config.fetchPage ?? defaultFetch,
  };
}
