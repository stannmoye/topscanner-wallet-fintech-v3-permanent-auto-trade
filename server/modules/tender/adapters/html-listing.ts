import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider, TenderSourceKind } from "../provider";
import { fetchText } from "../http";
import { TENDER_COLUMN_LIMITS, normaliseWhitespace, pickString, truncate } from "../normalise";

/**
 * Tender Bid — tolerant HTML listing scraper.
 *
 * A number of national portals publish no machine-readable feed at all: they are
 * HTML listing pages whose notices are ordinary links. This factory turns a
 * configured listing URL into a `TenderProvider` that fetches the page and
 * extracts the notice anchors. It is deliberately conservative — it reads only
 * what the page states, namely each notice's link and its link text — and is
 * treated as inherently fragile:
 *
 * - a page it cannot read yields an empty page, never a fabricated notice;
 * - a scrape that starts returning nothing simply stops refreshing its source and
 *   the source is flagged unhealthy by the ingestion worker;
 * - nothing about a notice (amount, window, buyer) is invented — those fields
 *   stay null until an administrator corrects them or the portal offers a feed.
 *
 * The notice link it extracts is a real URL on the source portal, so the
 * customer always sees faithful attribution.
 */

export type HtmlListingRow = { title: string; url: string };

export type HtmlListingAdapterConfig = {
  key: string;
  countryCode: string;
  kind: TenderSourceKind;
  /** The listing page to fetch. For a source shared by several rows, see `listingUrlBySource`. */
  listingUrl: string;
  /** Per-registry-key overrides for a listing URL (used by the shared Etimad adapter). */
  listingUrlBySource?: Record<string, string>;
  /** A link is treated as a notice only when its href contains one of these tokens. */
  hrefIncludes: string[];
  /** Page size is implied by the listing page; `buildPageUrl` walks to the next page. */
  buildPageUrl?: (page: number, params: TenderFetchParams) => string;
  /** Upper bound on pages fetched per run. */
  maxPages?: number;
  /** Base for resolving relative hrefs (defaults to the listing URL's origin). */
  baseUrl?: string;
  /** Override the row extractor (for a portal with non-anchor markup). */
  extractRows?: (html: string, pageUrl: string) => HtmlListingRow[];
  /**
   * When true (the default), a first page that yields no notice links throws, so
   * the ingestion worker flags the source unhealthy rather than silently
   * reporting a healthy-but-empty scrape. This is the fail-closed behaviour a
   * fragile scraper needs: a portal whose markup changed, or that now serves a
   * JavaScript-only shell, is surfaced instead of being trusted.
   */
  failOnEmpty?: boolean;
};

const DEFAULT_MAX_PAGES = 5;

/** Decode the handful of HTML entities that appear inside link text. */
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

/** Resolve a possibly-relative href against a page URL, or null when unusable. */
function resolveUrl(href: string, pageUrl: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return null;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Extract notice anchors from an HTML listing page. Reads `<a href="…">…</a>`
 * pairs, keeps those whose href contains one of `hrefIncludes`, and de-duplicates
 * by target URL. Returns [] when nothing matches (the caller fails closed).
 */
export function extractListingLinks(html: string, options: { hrefIncludes: string[]; pageUrl: string }): HtmlListingRow[] {
  const tokens = options.hrefIncludes.map((token) => token.toLowerCase()).filter(Boolean);
  if (!html || tokens.length === 0) return [];

  const rows: HtmlListingRow[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = match[1];
    const lower = href.toLowerCase();
    if (!tokens.some((token) => lower.includes(token))) continue;
    const url = resolveUrl(href, options.pageUrl);
    if (!url || seen.has(url)) continue;
    const title = normaliseWhitespace(decodeEntities(match[2].replace(/<[^>]*>/g, " ")));
    if (!title || title.length < 8) continue;
    seen.add(url);
    rows.push({ title, url });
  }
  return rows;
}

/** Derive a stable external id from a notice URL: its last non-empty path segment. */
export function externalIdFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    return decoded.trim() ? decoded.trim() : null;
  } catch {
    return null;
  }
}

/** Derive a stable external id from a notice URL's query parameter (e.g. `resourceId`). */
export function externalIdFromQueryParam(url: string, param: string): string | null {
  try {
    const value = new URL(url).searchParams.get(param);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Turn an extracted listing row into a tender, or null when it has no usable identity. */
export function normaliseHtmlListingRow(
  row: HtmlListingRow,
  options: { countryCode: string; deriveExternalId?: (url: string) => string | null },
): NormalizedTender | null {
  const url = pickString(row.url);
  const title = normaliseWhitespace(row.title);
  if (!url || !title) return null;
  const externalId = (options.deriveExternalId ?? externalIdFromUrl)(url);
  if (!externalId) return null;

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: truncate(options.countryCode, TENDER_COLUMN_LIMITS.countryCode) ?? "",
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
    publishedAt: null,
    summary: truncate(title, TENDER_COLUMN_LIMITS.summary),
    descriptionText: null,
    documents: [],
    sourceUrl: truncate(url, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw: row,
  };
}

export function createHtmlListingProvider(config: HtmlListingAdapterConfig): TenderProvider {
  const maxPages = Math.max(config.maxPages ?? DEFAULT_MAX_PAGES, 1);
  const failOnEmpty = config.failOnEmpty ?? true;
  const extractRows = config.extractRows
    ?? ((html: string, pageUrl: string) => extractListingLinks(html, { hrefIncludes: config.hrefIncludes, pageUrl }));

  return {
    key: config.key,
    countryCode: config.countryCode,
    kind: config.kind,
    async fetch(params: TenderFetchParams): Promise<RawTenderPage> {
      const page = Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1);
      const listingUrl = (params.sourceKey ? config.listingUrlBySource?.[params.sourceKey] : null) ?? config.listingUrl;
      const pageUrl = config.buildPageUrl?.(page, params) ?? listingUrl;

      const html = await fetchText(pageUrl);
      const items = extractRows(html, pageUrl);
      if (failOnEmpty && page === 1 && items.length === 0) {
        throw new Error(`No notice links found on ${pageUrl}; the listing may have changed.`);
      }
      const nextCursor = items.length > 0 && page < maxPages ? String(page + 1) : null;
      return { items, nextCursor };
    },
  };
}
