import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  firstLocalisedString,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * Denmark — udbud.dk public search.
 *
 * `POST https://udbud.dk/soegning/public/soegeresultat` is open (no key). The body
 * is `{"pagineringDto":{"aktuelSide":n,"maksElementer":m}}` and the payload is
 * `{ resultatElementDtoList: [ { dataDa, dataEn, noticeId, noticePublicationNumber } ], totaltAntalResultater }`.
 * Each element's `dataDa`/`dataEn` block carries `titel`, `ordregiver`,
 * `publiceringsdato`, `cpvKode`. The notice page is
 * `https://udbud.dk/Home/VisUdbud?id={noticeId}`.
 */
export const UDBUD_SEARCH_URL = "https://udbud.dk/soegning/public/soegeresultat";
const UDBUD_NOTICE_URL = "https://udbud.dk/Home/VisUdbud";
const UDBUD_PAGE_SIZE = 100;

type UdbudResponse = { resultatElementDtoList?: Record<string, unknown>[]; totaltAntalResultater?: number };

/** Read the result array from a udbud.dk payload (never fabricates entries). */
export function readUdbudResults(payload: unknown): Record<string, unknown>[] {
  const list = (payload as { resultatElementDtoList?: unknown })?.resultatElementDtoList;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

export async function fetchUdbudPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const page = Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1);
  const payload = await fetchJson<UdbudResponse>(UDBUD_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagineringDto: { aktuelSide: page, maksElementer: UDBUD_PAGE_SIZE } }),
  });
  const items = readUdbudResults(payload);
  const total = Number(payload.totaltAntalResultater ?? 0);
  const nextCursor = items.length > 0 && page * UDBUD_PAGE_SIZE < total ? String(page + 1) : null;
  return { items, nextCursor };
}

/** Normalise one udbud.dk notice, preferring the Danish block, or null without identity. */
export function normaliseUdbudNotice(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.noticeId, raw.noticePublicationNumber);
  if (!externalId) return null;
  const data = (raw.dataDa ?? raw.dataEn ?? {}) as Record<string, unknown>;
  const title = firstLocalisedString(data.titel) ?? pickString(raw.noticePublicationNumber, externalId);
  if (!title) return null;

  const sourceUrl = `${UDBUD_NOTICE_URL}?id=${encodeURIComponent(externalId)}`;
  const description = normaliseWhitespace(firstLocalisedString([data.beskrivelse, data.titel]));

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "DK",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(firstLocalisedString(data.ordregiver)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv: pickString(data.cpvKode) }),
    tenderType: null,
    procedure: null,
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: null,
    bidCloseAt: toIsoString(data.sluttidspunkt ?? data.tilbudsfrist),
    payoutAt: null,
    publishedAt: toIsoString(data.publiceringsdato),
    summary: truncate(description ?? title, TENDER_COLUMN_LIMITS.summary),
    descriptionText: description,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const udbudProvider: TenderProvider = {
  key: "udbud",
  countryCode: "DK",
  kind: "government",
  fetch: fetchUdbudPage,
};
