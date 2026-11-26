import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import { TENDER_COLUMN_LIMITS, normaliseWhitespace, pickString, toIsoString, truncate } from "../normalise";

/**
 * Netherlands — TenderNed public publications.
 *
 * `GET https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties?page=&size=`
 * is open (no key). The payload is
 * `{ content: [ … ], totalElements, totalPages, size, number }`; each publication
 * carries `publicatieId`, `publicatieDatum`, `aanbestedingNaam`, `opdrachtgeverNaam`,
 * `sluitingsDatum`, `procedure {omschrijving}`, `typeOpdracht {omschrijving}`,
 * `opdrachtBeschrijving` and `link.href` (a customer-facing notice URL). TenderNed
 * does not publish a contract value in this feed, so no amount is fabricated.
 */
export const TENDERNED_PUBLICATIES_URL = "https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties";
const TENDERNED_NOTICE_URL = "https://www.tenderned.nl/aankondigingen/overzicht";
const TENDERNED_PAGE_SIZE = 100;

type TenderNedResponse = {
  content?: Record<string, unknown>[];
  totalPages?: number;
  number?: number;
};

/** Read the publication array from a TenderNed payload (never fabricates entries). */
export function readTenderNedContent(payload: unknown): Record<string, unknown>[] {
  const content = (payload as { content?: unknown })?.content;
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
}

export async function fetchTenderNedPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const page = Math.max(Number.parseInt(params.cursor ?? "0", 10) || 0, 0);
  const url = new URL(TENDERNED_PUBLICATIES_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(TENDERNED_PAGE_SIZE));

  const payload = await fetchJson<TenderNedResponse>(url.toString());
  const items = readTenderNedContent(payload);
  const totalPages = Number(payload.totalPages ?? 0);
  const hasMore = totalPages > 0 ? page + 1 < totalPages : items.length >= TENDERNED_PAGE_SIZE;
  const nextCursor = items.length > 0 && hasMore ? String(page + 1) : null;
  return { items, nextCursor };
}

/** Read a TenderNed `{ code, omschrijving }` block into a single label. */
function nestedLabel(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return pickString(record.omschrijving, record.code);
  }
  return pickString(value);
}

/** Normalise one TenderNed publication, or null when it has no identity. */
export function normaliseTenderNedPublication(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.publicatieId, raw.kenmerk);
  if (!externalId) return null;
  const title = pickString(raw.aanbestedingNaam, raw.kenmerk, externalId);
  if (!title) return null;

  const link = (raw.link ?? {}) as Record<string, unknown>;
  const sourceUrl = pickString(link.href) ?? `${TENDERNED_NOTICE_URL}/${encodeURIComponent(externalId)}`;
  const description = normaliseWhitespace(raw.opdrachtBeschrijving);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "NL",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(raw.opdrachtgeverNaam)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: null,
    tenderType: truncate(nestedLabel(raw.typeOpdracht), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(nestedLabel(raw.procedure), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: null,
    bidCloseAt: toIsoString(raw.sluitingsDatum),
    payoutAt: null,
    publishedAt: toIsoString(raw.publicatieDatum),
    summary: truncate(description ?? title, TENDER_COLUMN_LIMITS.summary),
    descriptionText: description,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const tendernedProvider: TenderProvider = {
  key: "tenderned",
  countryCode: "NL",
  kind: "government",
  fetch: fetchTenderNedPage,
};
