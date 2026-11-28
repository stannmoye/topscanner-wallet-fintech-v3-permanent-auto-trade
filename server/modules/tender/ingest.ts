import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, getFreshTradingFxRate } from "../../db";
import { currencyRegistry, fxRateSnapshots, tenderSources, tenders } from "../../../drizzle/schema";
import { nativeMinorToUsdMinorExact } from "../../../shared/money";
import { sanitizeWorkerErrorMessage } from "../../_core/workerHealth";
import { computeTenderDedupeGroup } from "./dedupe";
import { deriveTenderStatus } from "./normalise";
import { resolveTenderAdapter, type TenderAdapter } from "./registry";
import { TENDER_SOURCE_DERIVED_FIELDS, readTenderOverrides, type TenderOverrides } from "./corrections";
import type { NormalizedTender } from "./provider";
import type { FxRateSnapshot } from "../trading-wallet-fx";

/**
 * Tender Bid — ingestion worker.
 *
 * One cycle walks every enabled `tender_sources` row that is due for its
 * configured interval, fetches its pages through the registered adapter, and
 * upserts the normalised tenders by `(sourceId, externalId)`. It is deliberately
 * conservative:
 *
 * - a source with no implemented adapter is recorded as `no_adapter`, never guessed;
 * - a page that fails to fetch fails only that source (recorded as `error`), never the cycle,
 *   after a bounded number of retries with exponential back-off;
 * - consecutive page requests to one source are paced (rate-limit etiquette);
 * - one unreadable tender fails only that row (counted), never the page;
 * - a tender's USD value is only set when a fresh FX rate resolves; otherwise the
 *   native amount is kept and the USD value stays null (fail closed, never guessed);
 * - administrator-owned fields (the qualification percentage/amount and its override
 *   flag) are never written by ingestion, so a correction survives the next sync;
 * - a field an administrator has overridden through the corrections menu is omitted
 *   from the update set, so the correction also survives the next sync (the override
 *   map records which fields to leave alone);
 * - each page is bounded, and a source that does not drain within the page cap resumes
 *   from the high-water mark of the items it did ingest;
 * - rows are written in bounded multi-row upsert batches (one statement per batch and
 *   one override lookup per batch instead of one of each per row), so a page of notices
 *   does not cost a round trip per row; a row with an administrator override is written
 *   on its own so its overridden fields are still preserved;
 * - the raw provider payload retained for audit is bounded to an excerpt, so one huge
 *   notice cannot grow the row (and the write buffer) without limit.
 *
 * The stored `currency_registry.usdRate` is an audit snapshot and is never used as a
 * calculation input; USD values come only from a fresh `getFreshTradingFxRate` quote.
 */

/**
 * The canonical polling cadence for an enabled tender source: once every seven
 * days. Tender providers are only contacted weekly, so ingestion is not a
 * continuous background fetch; an administrator can still force an immediate
 * refresh through the audited "Fetch now" action.
 */
export const TENDER_INGEST_INTERVAL_MS = 604_800_000;

/** Upper bound on pages fetched per source per cycle, so one busy source cannot stall the cycle. */
export const TENDER_INGEST_MAX_PAGES_PER_SOURCE = 100;

/** Upper bound on the number of due sources handled in a single cycle. */
export const TENDER_INGEST_MAX_SOURCES_PER_CYCLE = 25;

/** Bounded retry attempts for a single page fetch before the source is marked failed. */
export const TENDER_INGEST_MAX_FETCH_ATTEMPTS = 3;

/** Base delay for the exponential back-off between page-fetch retries. */
export const TENDER_INGEST_RETRY_BASE_DELAY_MS = 500;

/** Polite delay between consecutive page requests to the same source (rate-limit etiquette). */
export const TENDER_INGEST_PAGE_DELAY_MS = 250;

/**
 * Number of prepared tenders written per multi-row upsert statement. Batching
 * bounds both the number of database round trips for a page of notices and the
 * peak heap held while a batch is built, so a large page is written in fixed-size
 * chunks instead of one statement (and one override lookup) per row.
 */
export const TENDER_INGEST_UPSERT_BATCH_SIZE = 50;

/**
 * Maximum characters of a tender's raw provider payload retained in `rawJson` for
 * audit. The column is never read back into the application (it is excluded from
 * every customer and administrator projection), so storing an unbounded copy of
 * every notice doubles the ingestion heap and row size for no functional gain; a
 * bounded excerpt keeps the forensic value without the cost.
 */
export const TENDER_RAW_JSON_MAX_CHARS = 16_000;

type TenderSourceRow = typeof tenderSources.$inferSelect;

type CurrencyConfig = { scale: number; assetType: "fiat" | "crypto" | "token"; externalCode: string | null };

export type TenderIngestCycleResult = {
  startedAt: string;
  finishedAt: string;
  sourcesDue: number;
  sourcesProcessed: number;
  sourcesFailed: number;
  sourcesSkippedNoAdapter: number;
  pagesFetched: number;
  tendersUpserted: number;
  rowsFailed: number;
};

type SourceOutcome =
  | { kind: "no_adapter" }
  | { kind: "ok"; pages: number; upserted: number; rowsFailed: number; drained: boolean; highWater: Date | null }
  | { kind: "failed"; error: string };

/**
 * Serialise a provider payload for the audit-only `rawJson` column, bounded to
 * `TENDER_RAW_JSON_MAX_CHARS`. The retained value is a forensic excerpt, not a
 * value the application reads back, so a truncated payload is suffixed with an
 * explicit marker rather than silently cut.
 */
function safeStringify(value: unknown, maxChars = TENDER_RAW_JSON_MAX_CHARS): string | null {
  if (value == null) return null;
  let json: string;
  try {
    json = JSON.stringify(value) ?? "";
  } catch {
    return null;
  }
  return json.length <= maxChars ? json : `${json.slice(0, maxChars)}…[truncated]`;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function isSourceDue(source: TenderSourceRow, nowMs: number): boolean {
  const interval = Number.isFinite(source.expectedIntervalMs) && source.expectedIntervalMs > 0
    ? source.expectedIntervalMs
    : TENDER_INGEST_INTERVAL_MS;
  const last = source.lastSyncAt ? new Date(source.lastSyncAt).getTime() : 0;
  return !last || nowMs - last >= interval;
}

/** Resolve after `ms` milliseconds (used for retry back-off and inter-page pacing). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
}

/** Read a source's `configJson` into a plain record, or null when absent/not an object. */
function readSourceConfig(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Fetch one page through the adapter with bounded retries and exponential
 * back-off. A transient failure (network blip, momentary 5xx) is retried; once
 * the attempt cap is reached the error propagates so the source is marked failed.
 * The caller passes the source's registry key and config so an adapter shared by
 * several sources (or driven by configuration) can route the request correctly.
 */
async function fetchPageWithRetry(
  adapter: TenderAdapter,
  params: { since?: Date; cursor: string | null; sourceKey: string; config: Record<string, unknown> | null },
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TENDER_INGEST_MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await adapter.provider.fetch(params);
    } catch (error) {
      lastError = error;
      if (attempt < TENDER_INGEST_MAX_FETCH_ATTEMPTS) {
        await sleep(TENDER_INGEST_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Read the enabled currency registry into a lookup for FX conversion. */
async function loadCurrencyMap(db: Awaited<ReturnType<typeof getDb>>): Promise<Map<string, CurrencyConfig>> {
  const map = new Map<string, CurrencyConfig>();
  if (!db) return map;
  try {
    const rows = await db.select({
      code: currencyRegistry.code,
      scale: currencyRegistry.scale,
      assetType: currencyRegistry.assetType,
      externalCode: currencyRegistry.externalCode,
      enabled: currencyRegistry.enabled,
    }).from(currencyRegistry);
    for (const row of rows) {
      if (!row.enabled) continue;
      map.set(String(row.code).toUpperCase(), {
        scale: Number(row.scale),
        assetType: row.assetType,
        externalCode: row.externalCode ? String(row.externalCode) : null,
      });
    }
  } catch {
    // Without a currency registry no tender gets a USD value this cycle; native amounts still ingest.
  }
  return map;
}

/**
 * Resolve a tender's USD contract value from a fresh FX quote. Returns a null USD
 * value and snapshot when the currency is unknown/disabled or the quote is
 * unavailable — never a guessed amount. One snapshot is recorded per currency per
 * cycle and shared by every tender that uses it.
 */
async function convertToUsdMinor(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tender: NormalizedTender,
  currencyMap: Map<string, CurrencyConfig>,
  fxCache: Map<string, FxRateSnapshot>,
  snapshotIds: Map<string, number>,
): Promise<{ usdMinor: number | null; snapshotId: number | null }> {
  if (tender.contractAmountMinor == null || !tender.contractCurrency) return { usdMinor: null, snapshotId: null };
  const code = tender.contractCurrency.toUpperCase();
  if (code === "USD") return { usdMinor: tender.contractAmountMinor, snapshotId: null };

  const config = currencyMap.get(code);
  if (!config) return { usdMinor: null, snapshotId: null };

  let rate = fxCache.get(code);
  if (!rate) {
    try {
      rate = await getFreshTradingFxRate({ code, scale: config.scale, assetType: config.assetType, externalCode: config.externalCode });
      fxCache.set(code, rate);
    } catch {
      return { usdMinor: null, snapshotId: null };
    }
  }

  let usdMinor: number;
  try {
    usdMinor = nativeMinorToUsdMinorExact(tender.contractAmountMinor, config.scale, rate.rateUsdPerUnit);
  } catch {
    return { usdMinor: null, snapshotId: null };
  }

  let snapshotId = snapshotIds.get(code) ?? null;
  if (snapshotId == null) {
    try {
      const inserted = await db.insert(fxRateSnapshots).values({
        baseAsset: code,
        quoteAsset: "USD",
        rate: String(rate.rateUsdPerUnit),
        provider: rate.provider,
        sourceDate: rate.sourceDate,
        rawJson: JSON.stringify({
          purpose: "tender_contract_value_conversion",
          currency: code,
          scale: config.scale,
          fetchedAt: rate.fetchedAt instanceof Date ? rate.fetchedAt.toISOString() : String(rate.fetchedAt),
        }),
      });
      const id = Number((inserted as unknown as Array<{ insertId?: number }>)[0]?.insertId ?? 0);
      if (Number.isFinite(id) && id > 0) {
        snapshotId = id;
        snapshotIds.set(code, id);
      }
    } catch {
      snapshotId = null;
    }
  }
  return { usdMinor, snapshotId };
}

/** A row's insert payload, minus the two key columns the writer always supplies. */
type TenderSharedColumns = Omit<typeof tenders.$inferInsert, "sourceId" | "externalId">;

/** A normalised tender validated and priced, ready for a batched write. */
type PreparedTender = {
  externalId: string;
  shared: TenderSharedColumns;
  publishedAt: Date | null;
};

/**
 * Validate and price one normalised tender into a write-ready payload. Returns
 * `null` when the tender is missing a required field (external id, title, link),
 * which the caller counts as an unreadable row. Administrator-owned fields are
 * intentionally absent from the payload so a correction is never clobbered by a
 * later sync.
 */
async function prepareTender(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  source: TenderSourceRow,
  tender: NormalizedTender,
  currencyMap: Map<string, CurrencyConfig>,
  fxCache: Map<string, FxRateSnapshot>,
  snapshotIds: Map<string, number>,
  now: Date,
): Promise<PreparedTender | null> {
  if (!tender.externalId || !tender.title || !tender.sourceUrl) return null;
  const { usdMinor, snapshotId } = await convertToUsdMinor(db, tender, currencyMap, fxCache, snapshotIds);

  const shared = {
    dedupeGroup: computeTenderDedupeGroup({ countryCode: tender.countryCode, buyer: tender.buyer, title: tender.title }),
    countryCode: tender.countryCode || source.countryCode || "",
    title: tender.title,
    buyer: tender.buyer,
    buyerType: tender.buyerType,
    industry: tender.industry,
    tenderType: tender.tenderType,
    procedure: tender.procedure,
    contractAmountMinor: tender.contractAmountMinor,
    contractCurrency: tender.contractCurrency,
    contractAmountUsdMinor: usdMinor,
    fxSnapshotId: snapshotId,
    bidOpenAt: toDate(tender.bidOpenAt),
    bidCloseAt: toDate(tender.bidCloseAt),
    payoutAt: toDate(tender.payoutAt),
    publishedAt: toDate(tender.publishedAt),
    summary: tender.summary,
    descriptionText: tender.descriptionText,
    documentsJson: tender.documents.length ? tender.documents : null,
    sourceUrl: tender.sourceUrl,
    status: deriveTenderStatus({ bidOpenAt: tender.bidOpenAt, bidCloseAt: tender.bidCloseAt }, now),
    lastSyncedAt: now,
    rawJson: safeStringify(tender.raw),
  };

  return { externalId: tender.externalId, shared, publishedAt: shared.publishedAt };
}

/**
 * The `ON DUPLICATE KEY UPDATE` set for a multi-row batch: every column takes the
 * value of the row being inserted (`VALUES(col)`), so each row in the batch updates
 * to its own values rather than a single shared literal, and `updatedAt` is stamped
 * once for the whole statement. The column list is derived from the prepared payload
 * and restricted to plain identifier keys, so nothing but our own column names can
 * reach the statement.
 */
function buildBatchUpdateSet(shared: TenderSharedColumns, now: Date): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(shared)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
    set[key] = sql.raw(`VALUES(\`${key}\`)`);
  }
  set.updatedAt = now;
  return set;
}

/**
 * Upsert one prepared tender on its own, dropping every overridden source-derived
 * field from the update set so an administrator correction survives the sync.
 */
async function upsertPreparedTender(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  source: TenderSourceRow,
  row: PreparedTender,
  now: Date,
  overrides: TenderOverrides,
): Promise<void> {
  const update: Record<string, unknown> = { ...row.shared, updatedAt: now };
  for (const field of Object.keys(overrides)) {
    if (TENDER_SOURCE_DERIVED_FIELDS.has(field) && field in update) delete update[field];
  }
  await db.insert(tenders).values({
    sourceId: source.id,
    externalId: row.externalId,
    ...row.shared,
  }).onDuplicateKeyUpdate({ set: update });
}

type UpsertCounts = { upserted: number; rowsFailed: number };

/**
 * Write a batch of prepared tenders.
 *
 * The override map for the whole batch is read in one query (not one per row).
 * Rows without an override go through a single multi-row upsert; the (rare) rows
 * that carry an administrator override are written individually, so their
 * overridden fields are still left untouched. If the multi-row statement fails,
 * the batch is retried row by row so one bad row cannot lose the whole batch.
 */
async function writeTenderBatch(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  source: TenderSourceRow,
  rows: readonly PreparedTender[],
  now: Date,
): Promise<UpsertCounts> {
  if (!rows.length) return { upserted: 0, rowsFailed: 0 };

  const externalIds = [...new Set(rows.map((row) => row.externalId))];
  const overrideMap = new Map<string, TenderOverrides>();
  try {
    const existing = await db.select({ externalId: tenders.externalId, overridesJson: tenders.overridesJson })
      .from(tenders)
      .where(and(eq(tenders.sourceId, source.id), inArray(tenders.externalId, externalIds)));
    for (const record of existing) {
      const overrides = readTenderOverrides(record.overridesJson);
      if (Object.keys(overrides).length) overrideMap.set(record.externalId, overrides);
    }
  } catch {
    // A failed override read must not drop the batch: every row is then written as
    // if un-overridden, so the next successful sync restores the corrections.
  }

  const overridden = rows.filter((row) => overrideMap.has(row.externalId));
  const clean = rows.filter((row) => !overrideMap.has(row.externalId));

  let upserted = 0;
  let rowsFailed = 0;

  if (clean.length) {
    try {
      await db.insert(tenders).values(
        clean.map((row) => ({ sourceId: source.id, externalId: row.externalId, ...row.shared })),
      ).onDuplicateKeyUpdate({ set: buildBatchUpdateSet(clean[0].shared, now) });
      upserted += clean.length;
    } catch {
      for (const row of clean) {
        try {
          await upsertPreparedTender(db, source, row, now, {});
          upserted++;
        } catch {
          rowsFailed++;
        }
      }
    }
  }

  for (const row of overridden) {
    try {
      await upsertPreparedTender(db, source, row, now, overrideMap.get(row.externalId) ?? {});
      upserted++;
    } catch {
      rowsFailed++;
    }
  }

  return { upserted, rowsFailed };
}

async function ingestSource(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  source: TenderSourceRow,
  adapter: TenderAdapter,
  currencyMap: Map<string, CurrencyConfig>,
  fxCache: Map<string, FxRateSnapshot>,
  snapshotIds: Map<string, number>,
  now: Date,
): Promise<SourceOutcome> {
  const since = source.lastSyncAt ? new Date(source.lastSyncAt) : undefined;
  const config = readSourceConfig(source.configJson);
  let cursor: string | null = null;
  let pages = 0;
  let upserted = 0;
  let rowsFailed = 0;
  let drained = true;
  let highWater: Date | null = null;
  // Rows accumulate here and are written in bounded batches, so a page of notices
  // is not one database round trip per row and the in-flight set stays bounded.
  const pending: PreparedTender[] = [];

  const flush = async (): Promise<void> => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    const counts = await writeTenderBatch(db, source, batch, now);
    upserted += counts.upserted;
    rowsFailed += counts.rowsFailed;
  };

  while (true) {
    let page;
    try {
      page = await fetchPageWithRetry(adapter, { since, cursor, sourceKey: source.key, config });
    } catch (error) {
      // Persist what earlier pages read before recording the source as failed.
      await flush();
      return { kind: "failed", error: sanitizeWorkerErrorMessage(error) };
    }
    const items = Array.isArray(page.items) ? page.items : [];
    for (const rawItem of items) {
      let tender: NormalizedTender | null;
      try {
        tender = adapter.normalise(rawItem);
      } catch {
        rowsFailed++;
        continue;
      }
      if (!tender) {
        rowsFailed++;
        continue;
      }
      let prepared: PreparedTender | null;
      try {
        prepared = await prepareTender(db, source, tender, currencyMap, fxCache, snapshotIds, now);
      } catch {
        rowsFailed++;
        continue;
      }
      if (!prepared) {
        rowsFailed++;
        continue;
      }
      pending.push(prepared);
      if (prepared.publishedAt && (!highWater || prepared.publishedAt > highWater)) highWater = prepared.publishedAt;
      if (pending.length >= TENDER_INGEST_UPSERT_BATCH_SIZE) await flush();
    }
    pages++;
    cursor = page.nextCursor ?? null;
    if (!cursor) break;
    if (pages >= TENDER_INGEST_MAX_PAGES_PER_SOURCE) {
      drained = false;
      break;
    }
    // Pace consecutive page requests to the same source (rate-limit etiquette).
    await sleep(TENDER_INGEST_PAGE_DELAY_MS);
  }
  await flush();
  return { kind: "ok", pages, upserted, rowsFailed, drained, highWater };
}

/**
 * Choose which enabled sources to ingest this cycle.
 *
 * Sources are ordered least-recently-attempted first (`updatedAt` ascending),
 * which acts as the durable per-run cursor: `updatedAt` advances on every attempt
 * (success, failure or no-adapter), so successive cycles — including repeated
 * forced "Fetch now" runs — rotate through the whole enabled catalogue instead of
 * re-selecting the same first rows and never reaching the rest. The per-cycle
 * bound still caps how many sources one run touches, so a run never contacts all
 * providers at once, and `force` only widens the due set, never the cap.
 */
export function selectTenderSourcesForCycle(
  sources: readonly TenderSourceRow[],
  options: { force: boolean; nowMs: number; limit: number },
): TenderSourceRow[] {
  return [...sources]
    .filter((source) => options.force || isSourceDue(source, options.nowMs))
    .sort((a, b) => {
      const aAt = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bAt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (aAt !== bAt) return aAt - bAt;
      return a.id - b.id;
    })
    .slice(0, Math.max(0, options.limit));
}

/**
 * Run one tender-ingestion cycle across every due, enabled source.
 *
 * With `force` set, every enabled source is treated as due so an administrator
 * can refresh immediately through the audited "Fetch now" action without waiting
 * for the weekly cadence. Sources are still processed least-recently-attempted
 * first, and the per-cycle source bound still applies, so repeated forced cycles
 * progress through the whole catalogue while each individual cycle stays bounded.
 */
export async function runTenderIngestCycle(options: { force?: boolean } = {}): Promise<TenderIngestCycleResult> {
  const startedAt = new Date();
  const db = await getDb();
  if (!db) throw new Error("Tender ingestion database is unavailable.");

  const currencyMap = await loadCurrencyMap(db);
  const fxCache = new Map<string, FxRateSnapshot>();
  const snapshotIds = new Map<string, number>();

  const enabled = await db.select().from(tenderSources)
    .where(eq(tenderSources.enabled, true));
  const nowMs = startedAt.getTime();
  const due = selectTenderSourcesForCycle(enabled, {
    force: options.force === true,
    nowMs,
    limit: TENDER_INGEST_MAX_SOURCES_PER_CYCLE,
  });

  let sourcesProcessed = 0;
  let sourcesFailed = 0;
  let sourcesSkippedNoAdapter = 0;
  let pagesFetched = 0;
  let tendersUpserted = 0;
  let rowsFailed = 0;

  for (const source of due) {
    const adapter = resolveTenderAdapter(source.adapter);
    if (!adapter) {
      sourcesSkippedNoAdapter++;
      await db.update(tenderSources).set({
        lastStatus: "no_adapter",
        lastError: `No ingestion adapter is implemented for "${source.adapter}".`,
        updatedAt: new Date(),
      }).where(eq(tenderSources.id, source.id));
      continue;
    }

    let outcome: SourceOutcome;
    try {
      outcome = await ingestSource(db, source, adapter, currencyMap, fxCache, snapshotIds, startedAt);
    } catch (error) {
      outcome = { kind: "failed", error: sanitizeWorkerErrorMessage(error) };
    }

    if (outcome.kind === "failed") {
      sourcesFailed++;
      await db.update(tenderSources).set({
        lastStatus: "error",
        lastError: outcome.error.slice(0, 500),
        updatedAt: new Date(),
      }).where(eq(tenderSources.id, source.id));
      continue;
    }
    if (outcome.kind === "no_adapter") {
      sourcesSkippedNoAdapter++;
      continue;
    }

    sourcesProcessed++;
    pagesFetched += outcome.pages;
    tendersUpserted += outcome.upserted;
    rowsFailed += outcome.rowsFailed;
    const sinceMs = source.lastSyncAt ? new Date(source.lastSyncAt).getTime() : 0;
    const nextSyncAt = outcome.drained || !outcome.highWater || outcome.highWater.getTime() <= sinceMs
      ? startedAt
      : outcome.highWater;
    await db.update(tenderSources).set({
      lastSyncAt: nextSyncAt,
      lastStatus: outcome.drained ? "ok" : "partial",
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(tenderSources.id, source.id));
  }

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    sourcesDue: due.length,
    sourcesProcessed,
    sourcesFailed,
    sourcesSkippedNoAdapter,
    pagesFetched,
    tendersUpserted,
    rowsFailed,
  };
}
