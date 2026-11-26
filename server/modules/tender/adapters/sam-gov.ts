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
 * United States — SAM.gov Get Opportunities.
 *
 * `GET https://api.sam.gov/opportunities/v2/search` with `api_key`, `postedFrom`
 * and `postedTo` (both `MM/DD/YYYY`, a window of at most one year), `limit`
 * (1–1000) and `offset`. The response is
 * `{ totalRecords, limit, offset, opportunitiesData: [...] }`. The key is a
 * secret read from `SAM_GOV_API_KEY`; when it is absent the provider refuses
 * rather than fetching anonymously, and the worker records the source as
 * unhealthy. Contract values are only present on award notices; an open
 * solicitation legitimately has no amount and therefore no USD value.
 */
const SAM_GOV_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const SAM_GOV_NOTICE_URL = "https://sam.gov/opp";
const SAM_GOV_MAX_WINDOW_DAYS = 365;
const SAM_GOV_PAGE_SIZE = 100;

type SamGovResponse = {
  totalRecords?: number;
  limit?: number;
  offset?: number;
  opportunitiesData?: Record<string, unknown>[];
};

/** SAM.gov requires `MM/DD/YYYY`. */
export function formatSamGovDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

/** The publish window for a fetch, clamped to SAM.gov's one-year maximum. */
export function resolveSamGovWindow(since: Date | undefined, now: Date): { postedFrom: string; postedTo: string } {
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const lowerBound = new Date(now.getTime() - SAM_GOV_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const from = since && since > lowerBound ? since : defaultFrom;
  return { postedFrom: formatSamGovDate(from), postedTo: formatSamGovDate(now) };
}

function readApiKey(): string {
  const key = process.env.SAM_GOV_API_KEY?.trim();
  if (!key) throw new Error("SAM.gov API key is not configured (SAM_GOV_API_KEY).");
  return key;
}

export async function fetchSamGovPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const key = readApiKey();
  const offset = Number.parseInt(params.cursor ?? "0", 10);
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const { postedFrom, postedTo } = resolveSamGovWindow(params.since, new Date());
  const url = new URL(SAM_GOV_SEARCH_URL);
  url.searchParams.set("api_key", key);
  url.searchParams.set("postedFrom", postedFrom);
  url.searchParams.set("postedTo", postedTo);
  url.searchParams.set("limit", String(SAM_GOV_PAGE_SIZE));
  url.searchParams.set("offset", String(safeOffset));

  const payload = await fetchJson<SamGovResponse>(url.toString());
  const items = Array.isArray(payload.opportunitiesData) ? payload.opportunitiesData : [];
  const total = Number(payload.totalRecords ?? 0);
  const nextOffset = safeOffset + items.length;
  const nextCursor = items.length > 0 && (total === 0 || nextOffset < total) ? String(nextOffset) : null;
  return { items, nextCursor };
}

/** Normalise one SAM.gov opportunity, or null when it has no usable identity. */
export function normaliseSamGovOpportunity(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.noticeId, raw.solicitationNumber);
  if (!externalId) return null;
  const title = pickString(raw.title, raw.solicitationNumber, externalId);
  if (!title) return null;

  const hierarchy = Array.isArray(raw.organizationHierarchy) ? raw.organizationHierarchy : [];
  const firstOrg = hierarchy[0] as Record<string, unknown> | undefined;
  const buyer = pickString(firstOrg?.name, raw.fullParentPathName, raw.department, raw.subTier)
    ?? null;

  const award = (raw.award ?? null) as Record<string, unknown> | null;
  const awardAmount = award ? toMinorUnits(award.amount, 2) : null;

  const sourceUrl = pickString(raw.uiLink) ?? `${SAM_GOV_NOTICE_URL}/${externalId}/view`;
  const descriptionUrl = pickString(raw.description);
  const documents = descriptionUrl ? [{ label: "SAM.gov notice description", url: descriptionUrl }] : [];

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "US",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(buyer), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ naics: raw.naicsCode, categoryName: raw.classificationCode ? `PSC ${raw.classificationCode}` : null }),
    tenderType: truncate(pickString(raw.type, raw.baseType), TENDER_COLUMN_LIMITS.tenderType),
    procedure: pickString(raw.baseType) ?? "SAM.gov",
    contractAmountMinor: awardAmount,
    contractCurrency: awardAmount == null ? null : normaliseCurrencyCode("USD"),
    bidOpenAt: toIsoString(raw.postedDate),
    bidCloseAt: toIsoString(raw.responseDeadLine ?? raw.archiveDate),
    payoutAt: award ? toIsoString(award.date) : null,
    publishedAt: toIsoString(raw.postedDate),
    summary: truncate(normaliseWhitespace(raw.title), TENDER_COLUMN_LIMITS.summary),
    descriptionText: null,
    documents,
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const samGovProvider: TenderProvider = {
  key: "sam_gov",
  countryCode: "US",
  kind: "government",
  fetch: fetchSamGovPage,
};
