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
 * Switzerland — simap.ch public project publications.
 *
 * `GET https://www.simap.ch/api/publications/v2/project/project-search?newestPublicationFrom=YYYY-MM-DD`
 * is simap.ch's documented v2 publication API (spec: `/api/specifications/simap.yaml`).
 * The payload is
 * `{ projects: [ { id, title {de,en,fr,it}, projectNumber, projectType, projectSubType,
 * processType, publicationId, publicationDate, publicationNumber, pubType, procOfficeName {…},
 * lots, orderAddress {…} } ], pagination: { lastItem, itemsPerPage } }`. Paging is by the
 * opaque `lastItem` cursor the response advertises. Each project's own page is
 * `https://www.simap.ch/en/project/{projectNumber}`. simap.ch publishes no contract
 * value in this feed, so no amount is fabricated.
 */
export const SIMAP_PROJECT_SEARCH_URL = "https://www.simap.ch/api/publications/v2/project/project-search";
const SIMAP_PROJECT_URL = "https://www.simap.ch/en/project";
const SIMAP_WINDOW_DAYS = 30;

type SimapResponse = {
  projects?: Record<string, unknown>[];
  pagination?: { lastItem?: unknown; itemsPerPage?: unknown };
};

/** Format an instant as the date-only `YYYY-MM-DD` simap.ch's window filter uses. */
function simapDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Read the project array from a simap.ch payload (never fabricates entries). */
export function readSimapProjects(payload: unknown): Record<string, unknown>[] {
  const projects = (payload as { projects?: unknown })?.projects;
  return Array.isArray(projects) ? (projects as Record<string, unknown>[]) : [];
}

/** Fetch one page of the simap.ch project search for the window ending now. */
export async function fetchSimapPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const to = new Date();
  const from = params.since ?? new Date(to.getTime() - SIMAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const url = new URL(SIMAP_PROJECT_SEARCH_URL);
  url.searchParams.set("newestPublicationFrom", simapDay(from));
  const cursor = pickString(params.cursor);
  if (cursor) url.searchParams.set("lastItem", cursor);

  const payload = await fetchJson<SimapResponse>(url.toString());
  const items = readSimapProjects(payload);
  const perPage = Number(payload.pagination?.itemsPerPage ?? 0);
  const lastItem = pickString(payload.pagination?.lastItem);
  // The API advertises a `lastItem` cursor while more pages remain; stop once the
  // page is short or the cursor is absent.
  const hasMore = items.length > 0 && (perPage <= 0 || items.length >= perPage);
  const nextCursor = hasMore && lastItem ? lastItem : null;
  return { items, nextCursor };
}

/** Normalise one simap.ch project, or null when it has no identity. */
export function normaliseSimapProject(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.projectNumber, raw.publicationNumber, raw.id);
  if (!externalId) return null;
  const title = firstLocalisedString(raw.title) ?? pickString(raw.projectNumber, externalId);
  if (!title) return null;

  const sourceUrl = `${SIMAP_PROJECT_URL}/${encodeURIComponent(externalId)}`;
  const description = normaliseWhitespace(firstLocalisedString(raw.title));

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "CH",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(firstLocalisedString(raw.procOfficeName)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.projectSubType) }),
    tenderType: truncate(pickString(raw.projectType), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.processType), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: null,
    bidCloseAt: null,
    payoutAt: null,
    publishedAt: toIsoString(raw.publicationDate),
    summary: truncate(description ?? title, TENDER_COLUMN_LIMITS.summary),
    descriptionText: description,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const simapProvider: TenderProvider = {
  key: "simap",
  countryCode: "CH",
  kind: "government",
  fetch: fetchSimapPage,
};
