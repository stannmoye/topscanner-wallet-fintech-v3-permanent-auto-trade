import type { NormalizedTender, NormalizedTenderDocument, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * Kenya — PPIP / e-GP active tender feed.
 *
 * `GET https://tenders.go.ke/api/active-tenders?page=N` is the JSON feed behind
 * Kenya's Public Procurement Information Portal (a Laravel `?page=` paginator:
 * `{ current_page, data: [ … ], last_page, next_page_url, total }`). Each row
 * carries `id`, `ocid`, `title`, `tender_ref`, `published_at`, `close_at`,
 * `description`, the procuring entity under `pe.name`, a `procurement_category`
 * and relative `documents[].url`. Each tender's own page is
 * `https://tenders.go.ke/tender/{id}`. The feed publishes no contract value, so
 * no amount is fabricated.
 */
export const PPIP_ACTIVE_TENDERS_URL = "https://tenders.go.ke/api/active-tenders";
const PPIP_ORIGIN = "https://tenders.go.ke";
const PPIP_TENDER_URL = `${PPIP_ORIGIN}/tender`;

type PpipResponse = {
  current_page?: number;
  data?: Record<string, unknown>[];
  last_page?: number;
};

/** Read the tender array from a PPIP payload (never fabricates entries). */
export function readPpipTenders(payload: unknown): Record<string, unknown>[] {
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Fetch one page of the PPIP active-tender feed. */
export async function fetchPpipPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const page = Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1);
  const url = new URL(PPIP_ACTIVE_TENDERS_URL);
  url.searchParams.set("page", String(page));

  const payload = await fetchJson<PpipResponse>(url.toString());
  const items = readPpipTenders(payload);
  const current = Number(payload.current_page ?? page);
  const last = Number(payload.last_page ?? current);
  const nextCursor = items.length > 0 && current < last ? String(current + 1) : null;
  return { items, nextCursor };
}

/** Resolve a PPIP document URL (the feed serves relative `/storage/…` paths). */
function ppipDocuments(raw: Record<string, unknown>): NormalizedTenderDocument[] {
  const list = Array.isArray(raw.documents) ? raw.documents : [];
  const result: NormalizedTenderDocument[] = [];
  for (const entry of list) {
    const document = (entry ?? {}) as Record<string, unknown>;
    const href = pickString(document.url, document.path);
    if (!href) continue;
    let url: string;
    try {
      url = new URL(href, PPIP_ORIGIN).toString();
    } catch {
      continue;
    }
    result.push({ label: pickString(document.name, document.title) ?? "Tender document", url });
  }
  return result;
}

/** Normalise one PPIP tender, or null when it has no identity. */
export function normalisePpipTender(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.ocid, raw.tender_ref, raw.id);
  if (!externalId) return null;
  const title = pickString(raw.title, raw.tender_ref, externalId);
  if (!title) return null;

  const pe = (raw.pe ?? {}) as Record<string, unknown>;
  const category = (raw.procurement_category ?? {}) as Record<string, unknown>;
  const sourceUrl = `${PPIP_TENDER_URL}/${encodeURIComponent(pickString(raw.id, externalId)!)}`;
  const description = normaliseWhitespace(raw.description);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "KE",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(pe.name, raw.venue)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(category.name) }),
    tenderType: truncate(pickString(category.name), TENDER_COLUMN_LIMITS.tenderType),
    procedure: null,
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: toIsoString(raw.published_at),
    bidCloseAt: toIsoString(raw.close_at),
    payoutAt: null,
    publishedAt: toIsoString(raw.published_at),
    summary: truncate(description ?? title, TENDER_COLUMN_LIMITS.summary),
    descriptionText: description,
    documents: ppipDocuments(raw),
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const ppipProvider: TenderProvider = {
  key: "ppip",
  countryCode: "KE",
  kind: "government",
  fetch: fetchPpipPage,
};
