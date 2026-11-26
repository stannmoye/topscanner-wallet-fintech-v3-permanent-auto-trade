import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import { toIsoCountryCode } from "../countries";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  firstLocalisedString,
  firstNumber,
  normaliseCurrencyCode,
  normaliseWhitespace,
  pickString,
  toIsoString,
  toMinorUnits,
  truncate,
} from "../normalise";

/**
 * European Union — TED (Tenders Electronic Daily) v3 search.
 *
 * `POST https://api.ted.europa.eu/v3/notices/search` needs no authentication for
 * search. The body carries an expert `query`, the `fields` to return, a `limit`
 * (1–250), `scope` (`ACTIVE` for open notices) and `paginationMode: ITERATION`,
 * which walks the whole result set by echoing the returned `iterationNextToken`
 * back on the next call. A response flagged `timedOut` is treated as a failure so
 * the worker keeps the previous data instead of recording a partial page.
 */
const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";
const TED_NOTICE_URL = "https://ted.europa.eu/en/notice/-/detail";
const TED_PAGE_SIZE = 100;
const TED_DEFAULT_QUERY = "TD = (0 OR 3 OR 7 OR I OR M OR P OR A)";
const TED_FIELDS = [
  "publication-number",
  "notice-title",
  "buyer-name",
  "buyer-country",
  "classification-cpv",
  "contract-nature",
  "total-value",
  "estimated-value",
  "publication-date",
  "deadline-receipt-tender-date-lot",
  "notice-type",
];

type TedNotice = Record<string, unknown>;
type TedResponse = {
  notices?: TedNotice[];
  iterationNextToken?: string;
  timedOut?: boolean;
};

/** Resolve a buyer country that may be a two-letter code or a country name. */
function resolveTedCountry(value: unknown): string {
  const raw = pickString(value);
  if (!raw) return "";
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return toIsoCountryCode(raw);
}

/** Read a repeatable TED field that may be a scalar or an array. */
function firstOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? firstOf(value[0]) : null;
  return value;
}

export async function fetchTedPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const body: Record<string, unknown> = {
    query: TED_DEFAULT_QUERY,
    fields: TED_FIELDS,
    limit: TED_PAGE_SIZE,
    scope: "ACTIVE",
    paginationMode: "ITERATION",
    checkQuerySyntax: false,
  };
  if (params.cursor) body.iterationNextToken = params.cursor;

  const payload = await fetchJson<TedResponse>(TED_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (payload.timedOut) throw new Error("TED search timed out; the page was discarded.");
  const items = Array.isArray(payload.notices) ? payload.notices : [];
  return { items, nextCursor: pickString(payload.iterationNextToken) };
}

/** Normalise one TED notice, or null when it has no publication number. */
export function normaliseTedNotice(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(firstOf(raw["publication-number"]), raw.noticeId);
  if (!externalId) return null;
  const title = firstLocalisedString(raw["notice-title"]) ?? externalId;

  const value = firstOf(raw["total-value"]) ?? firstOf(raw["estimated-value"]);
  const amountMinor = toMinorUnits(firstNumber(value), 2);
  const cpv = firstOf(raw["classification-cpv"]);
  const sourceUrl = `${TED_NOTICE_URL}/${externalId}`;

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: truncate(resolveTedCountry(firstOf(raw["buyer-country"])), TENDER_COLUMN_LIMITS.countryCode) ?? "",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(firstLocalisedString(raw["buyer-name"])), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ cpv, categoryName: firstLocalisedString(raw["contract-nature"]) }),
    tenderType: truncate(firstLocalisedString(raw["notice-type"]), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(firstLocalisedString(raw["contract-nature"]), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode("EUR"),
    bidOpenAt: null,
    bidCloseAt: toIsoString(firstOf(raw["deadline-receipt-tender-date-lot"])),
    payoutAt: null,
    publishedAt: toIsoString(firstOf(raw["publication-date"])),
    summary: truncate(normaliseWhitespace(title), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(title),
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const tedProvider: TenderProvider = {
  key: "ted",
  countryCode: "",
  kind: "private",
  fetch: fetchTedPage,
};
