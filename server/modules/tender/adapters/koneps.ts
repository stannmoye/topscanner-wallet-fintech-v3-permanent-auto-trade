import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseCurrencyCode,
  normaliseWhitespace,
  pickString,
  toIsoString,
  toMinorUnits,
  truncate,
} from "../normalise";

/**
 * South Korea — KONEPS / narajangteo bid notices via data.go.kr.
 *
 * The public procurement open API is published on the Korean open-data portal:
 * `GET https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThng`
 * (goods notices). It requires a `serviceKey` from data.go.kr (read from
 * `KOREA_KONEPS_API_KEY`, falling back to `DATA_GO_KR_SERVICE_KEY`) and takes
 * `pageNo`, `numOfRows`, `type=json`, `inqryDiv=1` and the notice window
 * `inqryBgnDt`/`inqryEndDt` (`YYYYMMDDHHmm`). The response is
 * `{ response: { header, body: { items: [ … ], totalCount } } }`; each row carries
 * `bidNtceNo`, `bidNtceOrd`, `bidNtceNm`, `ntceInsttNm`, `dminsttNm`,
 * `bidNtceDt`, `bidClseDt`, `presmptPrce` (KRW) and a detail link. Without a key
 * the provider refuses rather than fetching anonymously (fail closed), and the
 * worker records the source as unhealthy.
 */
export const KOREA_KONEPS_BID_URL = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThng";
const KOREA_KONEPS_PORTAL_URL = "https://www.g2b.go.kr/";
const KOREA_KONEPS_PAGE_SIZE = 100;
const KOREA_KONEPS_WINDOW_DAYS = 30;

type KonepsResponse = {
  response?: {
    header?: { resultCode?: unknown; resultMsg?: unknown };
    body?: { items?: unknown; totalCount?: unknown; pageNo?: unknown; numOfRows?: unknown };
  };
};

/** Format an instant as `YYYYMMDDHHmm`, the KONEPS inquiry window format. */
export function formatKonepsInstant(date: Date): string {
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

/** The notice window for a fetch, defaulting to the most recent 30 days. */
export function resolveKonepsWindow(since: Date | undefined, now: Date): { inqryBgnDt: string; inqryEndDt: string } {
  const lowerBound = new Date(now.getTime() - KOREA_KONEPS_WINDOW_DAYS * 86_400_000);
  const start = since && since > lowerBound ? since : lowerBound;
  return { inqryBgnDt: formatKonepsInstant(start), inqryEndDt: formatKonepsInstant(now) };
}

/** Read the row array from a KONEPS payload, tolerating an empty `items` marker. */
export function readKonepsItems(payload: unknown): Record<string, unknown>[] {
  const items = (payload as KonepsResponse)?.response?.body?.items;
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  const nested = (items as { item?: unknown })?.item;
  if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  if (nested && typeof nested === "object") return [nested as Record<string, unknown>];
  return [];
}

function readServiceKey(): string {
  const key = process.env.KOREA_KONEPS_API_KEY?.trim() || process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!key) throw new Error("data.go.kr service key is not configured (KOREA_KONEPS_API_KEY or DATA_GO_KR_SERVICE_KEY).");
  return key;
}

export async function fetchKonepsPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const key = readServiceKey();
  const page = Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1);
  const { inqryBgnDt, inqryEndDt } = resolveKonepsWindow(params.since, new Date());

  const url = new URL(KOREA_KONEPS_BID_URL);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("pageNo", String(page));
  url.searchParams.set("numOfRows", String(KOREA_KONEPS_PAGE_SIZE));
  url.searchParams.set("type", "json");
  url.searchParams.set("inqryDiv", "1");
  url.searchParams.set("inqryBgnDt", inqryBgnDt);
  url.searchParams.set("inqryEndDt", inqryEndDt);

  const payload = await fetchJson<KonepsResponse>(url.toString());
  const items = readKonepsItems(payload);
  const total = Number((payload as KonepsResponse)?.response?.body?.totalCount ?? 0);
  const nextCursor = items.length > 0 && (total === 0 || page * KOREA_KONEPS_PAGE_SIZE < total) ? String(page + 1) : null;
  return { items, nextCursor };
}

/** Normalise one KONEPS bid notice, or null when it has no usable identity. */
export function normaliseKonepsNotice(raw: Record<string, unknown>): NormalizedTender | null {
  const noticeNo = pickString(raw.bidNtceNo);
  if (!noticeNo) return null;
  const order = pickString(raw.bidNtceOrd);
  const externalId = order ? `${noticeNo}-${order}` : noticeNo;
  const title = pickString(raw.bidNtceNm, noticeNo);
  if (!title) return null;

  const sourceUrl = pickString(raw.bidNtceDtlUrl, raw.bidNtceUrl) ?? KOREA_KONEPS_PORTAL_URL;
  // KRW has no minor unit, so the whole-won amount is stored with scale 0.
  const amountMinor = toMinorUnits(raw.presmptPrce, 0);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "KR",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(raw.ntceInsttNm, raw.dminsttNm)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.bidNtceKndNm, raw.prdctClsfcNoNm) }),
    tenderType: truncate(pickString(raw.bidNtceKndNm, raw.bidNtceType), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.bidMthdNm, raw.cntrctCnclsMthdNm), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode("KRW"),
    bidOpenAt: toIsoString(raw.bidNtceDt),
    bidCloseAt: toIsoString(raw.bidClseDt),
    payoutAt: null,
    publishedAt: toIsoString(raw.bidNtceDt),
    summary: truncate(normaliseWhitespace(pickString(raw.bidNtceNm)), TENDER_COLUMN_LIMITS.summary),
    descriptionText: null,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const konepsProvider: TenderProvider = {
  key: "koneps",
  countryCode: "KR",
  kind: "government",
  fetch: fetchKonepsPage,
};
