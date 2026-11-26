import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import { toIsoCountryCode } from "../countries";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * World Bank — procurement notices (`search.worldbank.org`).
 *
 * `GET https://search.worldbank.org/api/v2/procnotices?format=json&rows=N&os=offset`
 * is open (no key). The payload exposes `procnotices` (or a `documents` map) with
 * fields such as `bid_description`, `bid_reference_no`, `notice_type`,
 * `project_ctry_name`, `sector`, `submission_deadline_date`. Notices do not carry
 * a reliable contract value, so no USD amount is fabricated for them.
 */
const WORLD_BANK_PROCNOTICES_URL = "https://search.worldbank.org/api/v2/procnotices";
const WORLD_BANK_PAGE_SIZE = 100;
const WORLD_BANK_DETAIL_URL = "https://projects.worldbank.org/en/projects-operations/procurement-detail";

type WorldBankResponse = {
  procnotices?: Record<string, unknown>[];
  documents?: Record<string, unknown> | Record<string, unknown>[];
  os?: number;
  rows?: number;
  total?: number;
};

/** Read the notice array from either the `procnotices` array or a `documents` map. */
export function readWorldBankNotices(payload: WorldBankResponse): Record<string, unknown>[] {
  if (Array.isArray(payload.procnotices)) return payload.procnotices;
  if (Array.isArray(payload.documents)) return payload.documents;
  if (payload.documents && typeof payload.documents === "object") return Object.values(payload.documents) as Record<string, unknown>[];
  return [];
}

export async function fetchWorldBankPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const offset = Number.parseInt(params.cursor ?? "0", 10);
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const url = new URL(WORLD_BANK_PROCNOTICES_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("rows", String(WORLD_BANK_PAGE_SIZE));
  url.searchParams.set("os", String(safeOffset));
  if (params.since) url.searchParams.set("start_date", params.since.toISOString().slice(0, 10));

  const payload = await fetchJson<WorldBankResponse>(url.toString());
  const items = readWorldBankNotices(payload);
  const total = Number(payload.total ?? 0);
  const nextOffset = safeOffset + items.length;
  const nextCursor = items.length > 0 && (total === 0 || nextOffset < total) ? String(nextOffset) : null;
  return { items, nextCursor };
}

/** Compose an ISO timestamp from a date string and an optional local time string. */
function composeIso(dateValue: unknown, timeValue: unknown): string | null {
  const date = pickString(dateValue);
  if (!date) return null;
  const time = pickString(timeValue);
  return toIsoString(time ? `${date} ${time}` : date);
}

/** Normalise one World Bank procurement notice, or null when it has no identity. */
export function normaliseWorldBankNotice(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.bid_reference_no, raw.id);
  if (!externalId) return null;
  const title = pickString(raw.bid_description, raw.notice_text, externalId);
  if (!title) return null;

  const noticeText = normaliseWhitespace(raw.notice_text);
  const sourceUrl = pickString(raw.url) ?? `${WORLD_BANK_DETAIL_URL}/${externalId}`;

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: truncate(toIsoCountryCode(raw.project_ctry_name), TENDER_COLUMN_LIMITS.countryCode) ?? "",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(raw.project_name, raw.project_ctry_name)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.sector) }),
    tenderType: truncate(pickString(raw.notice_type, raw.procurement_type), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.procurement_method_name, raw.procurement_method_code), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: toIsoString(raw.noticedate),
    bidCloseAt: composeIso(raw.submission_deadline_date, raw.submission_deadline_time),
    payoutAt: null,
    publishedAt: toIsoString(raw.noticedate),
    summary: truncate(noticeText, TENDER_COLUMN_LIMITS.summary),
    descriptionText: noticeText,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const worldBankProvider: TenderProvider = {
  key: "world_bank",
  countryCode: "",
  kind: "private",
  fetch: fetchWorldBankPage,
};
