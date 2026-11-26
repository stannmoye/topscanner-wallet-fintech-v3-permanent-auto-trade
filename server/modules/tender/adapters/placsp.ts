import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchText } from "../http";
import { TENDER_COLUMN_LIMITS, normaliseWhitespace, pickString, toIsoString, truncate } from "../normalise";

/**
 * Spain — Plataforma de Contratación del Sector Público (PLACSP), the CODICE
 * "licitacionesPerfilesContratanteCompleto3" syndication feed.
 *
 * `GET https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom`
 * is an Atom feed of published tenders. The portal fronts its syndication with a
 * web application firewall that occasionally rejects automated requests, so this
 * adapter is treated as fragile: any rejection or an unreadable feed yields an
 * empty page (fail closed) and the ingestion worker flags the source unhealthy
 * rather than inventing tenders. A browser-like User-Agent is sent because the
 * firewall rejects the default ingestion agent.
 */
export const PLACSP_ATOM_URL =
  "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
const PLACSP_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Decode the handful of XML/HTML entities that appear inside feed text. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/** Collapse a possibly-tagged feed fragment into plain text. */
function stripTags(value: string): string {
  return normaliseWhitespace(decodeEntities(value.replace(/<[^>]*>/g, " "))) ?? "";
}

export type PlacspEntry = { id: string | null; title: string | null; link: string | null; updated: string | null; summary: string | null };

/** Extract `<entry>` blocks from an Atom feed, tolerantly (never throws). */
export function parseAtomEntries(xml: string): PlacspEntry[] {
  if (!xml || !xml.includes("<entry")) return [];
  const entries: PlacspEntry[] = [];
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const id = block.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const updated = block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1];
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1];
    const link = block.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
    entries.push({
      id: pickString(stripTags(id ?? "")),
      title: pickString(stripTags(title ?? "")),
      link: pickString(decodeEntities(link ?? "")),
      updated: pickString(updated),
      summary: pickString(stripTags(summary ?? "")),
    });
  }
  return entries;
}

export async function fetchPlacspPage(_params: TenderFetchParams): Promise<RawTenderPage> {
  // The syndication feed is a single rolling window; the CODICE feed exposes no
  // paging cursor, so one fetch per cycle is the whole feed.
  const xml = await fetchText(PLACSP_ATOM_URL, { headers: { "User-Agent": PLACSP_BROWSER_UA, Accept: "application/atom+xml, application/xml" } });
  return { items: parseAtomEntries(xml), nextCursor: null };
}

/** Normalise one PLACSP Atom entry, or null when it has no identity. */
export function normalisePlacspEntry(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.id, raw.link);
  if (!externalId) return null;
  const title = pickString(raw.title, externalId);
  if (!title) return null;
  const sourceUrl = pickString(raw.link);
  if (!sourceUrl) return null;

  const summary = normaliseWhitespace(raw.summary);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "ES",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: null,
    buyerType: null,
    industry: null,
    tenderType: null,
    procedure: null,
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: null,
    bidCloseAt: null,
    payoutAt: null,
    publishedAt: toIsoString(raw.updated),
    summary: truncate(summary ?? title, TENDER_COLUMN_LIMITS.summary),
    descriptionText: summary,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const placspProvider: TenderProvider = {
  key: "placsp",
  countryCode: "ES",
  kind: "government",
  fetch: fetchPlacspPage,
};
