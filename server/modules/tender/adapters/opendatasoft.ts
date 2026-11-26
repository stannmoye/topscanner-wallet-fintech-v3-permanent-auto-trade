import type { RawTenderPage, TenderFetchParams, TenderProvider, TenderSourceKind } from "../provider";
import { fetchJson } from "../http";
import { pickString } from "../normalise";

/**
 * Tender Bid — generic OpenDataSoft (Explore API v2.1) adapter.
 *
 * Several open-data portals (France's BOAMP/DILA, and others) expose their
 * catalogue through OpenDataSoft's documented Explore API:
 * `GET <endpoint>?limit=<n>&offset=<n>&order_by=<field>%20desc`. The response is
 * `{ total_count, results: [ { <field>: <value>, … } ] }`. This factory turns a
 * configured records endpoint into a `TenderProvider`, bounding each cycle to a
 * modest number of records so one very large catalogue cannot dominate the
 * ingestion cycle. A payload that is not the documented shape yields nothing.
 */

export type OpenDataSoftAdapterConfig = {
  key: string;
  countryCode: string;
  kind: TenderSourceKind;
  /** The dataset's records endpoint, e.g. `…/api/explore/v2.1/catalog/datasets/boamp/records`. */
  endpoint: string;
  /** Records requested per page (1–100). */
  pageSize?: number;
  /** Upper bound on records read per cycle; the cursor stops once it is reached. */
  maxRecords?: number;
  /** Field to order by, newest first. Defaults to the dataset's own order. */
  orderBy?: string;
  /** ODSQL `where` clause (a date window, for example), or null for none. */
  buildWhere?: (params: TenderFetchParams) => string | null;
};

const DEFAULTS = { pageSize: 100, maxRecords: 500 } as const;

/** Read the record array from an OpenDataSoft Explore v2.1 payload. */
export function readOpenDataSoftRecords(payload: unknown): Record<string, unknown>[] {
  const results = (payload as { results?: unknown })?.results;
  return Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
}

export function createOpenDataSoftProvider(config: OpenDataSoftAdapterConfig): TenderProvider {
  const pageSize = Math.min(Math.max(config.pageSize ?? DEFAULTS.pageSize, 1), 100);
  const maxRecords = Math.max(config.maxRecords ?? DEFAULTS.maxRecords, pageSize);

  return {
    key: config.key,
    countryCode: config.countryCode,
    kind: config.kind,
    async fetch(params: TenderFetchParams): Promise<RawTenderPage> {
      const offset = Number.parseInt(params.cursor ?? "0", 10);
      const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;

      const url = new URL(config.endpoint);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(safeOffset));
      if (config.orderBy) url.searchParams.set("order_by", `${config.orderBy} desc`);
      const where = config.buildWhere?.(params) ?? null;
      if (where) url.searchParams.set("where", where);

      const payload = await fetchJson(url.toString());
      const items = readOpenDataSoftRecords(payload);
      const total = Number((payload as { total_count?: unknown })?.total_count ?? 0);
      const ceiling = total > 0 ? Math.min(total, maxRecords) : maxRecords;
      const nextOffset = safeOffset + items.length;
      const nextCursor = items.length > 0 && nextOffset < ceiling ? String(nextOffset) : null;
      return { items, nextCursor };
    },
  };
}

/** Format an instant as the `YYYY-MM-DD` day ODSQL date literals use. */
export function openDataSoftDay(value: Date | undefined): string | null {
  if (!value) return null;
  const ms = value.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Compose an ODSQL `field >= date'…'` clause, or null when no window is given. */
export function openDataSoftSinceClause(field: string, params: TenderFetchParams): string | null {
  const day = openDataSoftDay(params.since);
  const safeField = pickString(field);
  if (!day || !safeField) return null;
  return `${safeField} >= date'${day}'`;
}
