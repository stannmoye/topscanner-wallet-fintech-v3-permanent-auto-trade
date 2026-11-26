import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson, fetchText } from "../http";
import { csvRowsToObjects, findCsvValue, parseCsv } from "../csv";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * Canada — CanadaBuys open data.
 *
 * The notices are published as CSV resources on the open.canada.ca CKAN dataset
 * `6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2`. The adapter resolves the dataset through
 * the CKAN `package_show` action (so a resource URL change does not break it),
 * then downloads and parses each CSV resource. CSV headers are bilingual and vary
 * in shape, so columns are matched by token rather than by exact name.
 */
const CANADA_BUYS_DATASET_ID = "6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2";
const CANADA_BUYS_PACKAGE_URL = `https://open.canada.ca/data/api/3/action/package_show?id=${CANADA_BUYS_DATASET_ID}`;
const CANADA_BUYS_LISTING_URL = "https://canadabuys.canada.ca/en/tender-opportunities";
const CANADA_BUYS_PAGE_SIZE = 2000;
const CANADA_BUYS_MAX_RESOURCES = 8;

type CkanPackageResponse = {
  success?: boolean;
  result?: { resources?: { name?: string; url?: string; format?: string }[] };
};

type CanadaBuysCursor = { r: number; o: number };

function parseCursor(cursor: string | null | undefined): CanadaBuysCursor {
  if (!cursor) return { r: 0, o: 0 };
  try {
    const parsed = JSON.parse(cursor) as Partial<CanadaBuysCursor>;
    const r = Number(parsed.r);
    const o = Number(parsed.o);
    return { r: Number.isInteger(r) && r >= 0 ? r : 0, o: Number.isInteger(o) && o >= 0 ? o : 0 };
  } catch {
    return { r: 0, o: 0 };
  }
}

/** The CSV resource URLs on the dataset, in dataset order. */
export function selectCanadaBuysCsvResources(payload: CkanPackageResponse): string[] {
  const resources = payload.result?.resources ?? [];
  return resources
    .filter((resource) => {
      const format = (resource.format ?? "").toUpperCase();
      const url = resource.url ?? "";
      return format === "CSV" || /\.csv(\?|$)/i.test(url);
    })
    .map((resource) => resource.url)
    .filter((url): url is string => Boolean(url))
    .slice(0, CANADA_BUYS_MAX_RESOURCES);
}

export async function fetchCanadaBuysPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const cursor = parseCursor(params.cursor);
  const payload = await fetchJson<CkanPackageResponse>(CANADA_BUYS_PACKAGE_URL);
  const resources = selectCanadaBuysCsvResources(payload);
  if (!resources.length) throw new Error("CanadaBuys dataset exposes no CSV resources.");
  if (cursor.r >= resources.length) return { items: [], nextCursor: null };

  const text = await fetchText(resources[cursor.r]);
  const rows = csvRowsToObjects(parseCsv(text));
  const page = rows.slice(cursor.o, cursor.o + CANADA_BUYS_PAGE_SIZE);
  const items = page.map((row) => ({ __resource: cursor.r, ...row }));

  let nextCursor: string | null = null;
  if (cursor.o + page.length < rows.length) {
    nextCursor = JSON.stringify({ r: cursor.r, o: cursor.o + page.length });
  } else if (cursor.r + 1 < resources.length) {
    nextCursor = JSON.stringify({ r: cursor.r + 1, o: 0 });
  }
  return { items, nextCursor };
}

/** Map the CanadaBuys procurement-category code to a canonical industry label. */
export function canadaBuysIndustry(code: string | null): string | null {
  const value = (code ?? "").toUpperCase();
  if (value.startsWith("CNST")) return "Construction";
  if (value.startsWith("GD")) return "Goods";
  if (value.startsWith("SRV")) return "Services";
  return null;
}

/** Normalise one CanadaBuys CSV row, or null when it has no identity. */
export function normaliseCanadaBuysRow(raw: Record<string, string>): NormalizedTender | null {
  const externalId = pickString(
    findCsvValue(raw, "reference"),
    findCsvValue(raw, "solicitation"),
  );
  if (!externalId) return null;
  const title = pickString(findCsvValue(raw, "title"), findCsvValue(raw, "titre"), externalId);
  if (!title) return null;

  const categoryCode = findCsvValue(raw, "procurementcategory");
  const sourceUrl = pickString(findCsvValue(raw, "noticeurl"), findCsvValue(raw, "url")) ?? CANADA_BUYS_LISTING_URL;
  const closing = pickString(findCsvValue(raw, "closingdate"), findCsvValue(raw, "cloture"));
  const publication = findCsvValue(raw, "publicationdate");

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "CA",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(findCsvValue(raw, "contractingentityname")), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: canadaBuysIndustry(categoryCode) }),
    tenderType: truncate(findCsvValue(raw, "noticetype"), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(categoryCode, TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: toIsoString(publication),
    bidCloseAt: toIsoString(closing),
    payoutAt: null,
    publishedAt: toIsoString(publication),
    summary: truncate(normaliseWhitespace(title), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(findCsvValue(raw, "description")),
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const canadaBuysProvider: TenderProvider = {
  key: "canada_buys",
  countryCode: "CA",
  kind: "government",
  fetch: fetchCanadaBuysPage,
};
