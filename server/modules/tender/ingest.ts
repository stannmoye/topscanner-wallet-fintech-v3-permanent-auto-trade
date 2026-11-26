import { asc, eq } from "drizzle-orm";
import { getDb, getFreshTradingFxRate } from "../../db";
import { currencyRegistry, fxRateSnapshots, tenderSources, tenders } from "../../../drizzle/schema";
import { nativeMinorToUsdMinorExact } from "../../../shared/money";
import { sanitizeWorkerErrorMessage } from "../../_core/workerHealth";
import { computeTenderDedupeGroup } from "./dedupe";
import { deriveTenderStatus } from "./normalise";
import { resolveTenderAdapter, type TenderAdapter } from "./registry";
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
 * - a page that fails to fetch fails only that source (recorded as `error`), never the cycle;
 * - one unreadable tender fails only that row (counted), never the page;
 * - a tender's USD value is only set when a fresh FX rate resolves; otherwise the
 *   native amount is kept and the USD value stays null (fail closed, never guessed);
 * - administrator-owned fields (the qualification percentage/amount and its override
 *   flag) are never written by ingestion, so a correction survives the next sync;
 * - each page is bounded, and a source that does not drain within the page cap resumes
 *   from the high-water mark of the items it did ingest.
 *
 * The stored `currency_registry.usdRate` is an audit snapshot and is never used as a
 * calculation input; USD values come only from a fresh `getFreshTradingFxRate` quote.
 */

/** Upper bound on pages fetched per source per cycle, so one busy source cannot stall the cycle. */
export const TENDER_INGEST_MAX_PAGES_PER_SOURCE = 100;

/** Upper bound on the number of due sources handled in a single cycle. */
export const TENDER_INGEST_MAX_SOURCES_PER_CYCLE = 25;

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

function safeStringify(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function isSourceDue(source: TenderSourceRow, nowMs: number): boolean {
  const interval = Number.isFinite(source.expectedIntervalMs) && source.expectedIntervalMs > 0
    ? source.expectedIntervalMs
    : 3_600_000;
  const last = source.lastSyncAt ? new Date(source.lastSyncAt).getTime() : 0;
  return !last || nowMs - last >= interval;
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

/**
 * Upsert one normalised tender. Administrator-owned fields are intentionally absent
 * from the update set so a correction is never clobbered by a later sync.
 */
async function upsertTender(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  source: TenderSourceRow,
  tender: NormalizedTender,
  currencyMap: Map<string, CurrencyConfig>,
  fxCache: Map<string, FxRateSnapshot>,
  snapshotIds: Map<string, number>,
  now: Date,
): Promise<boolean> {
  if (!tender.externalId || !tender.title || !tender.sourceUrl) return false;
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

  await db.insert(tenders).values({
    sourceId: source.id,
    externalId: tender.externalId,
    ...shared,
  }).onDuplicateKeyUpdate({ set: { ...shared, updatedAt: now } });
  return true;
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
  let cursor: string | null = null;
  let pages = 0;
  let upserted = 0;
  let rowsFailed = 0;
  let drained = true;
  let highWater: Date | null = null;

  while (true) {
    let page;
    try {
      page = await adapter.provider.fetch({ since, cursor });
    } catch (error) {
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
      try {
        const stored = await upsertTender(db, source, tender, currencyMap, fxCache, snapshotIds, now);
        if (stored) upserted++; else rowsFailed++;
      } catch {
        rowsFailed++;
      }
      const published = toDate(tender.publishedAt);
      if (published && (!highWater || published > highWater)) highWater = published;
    }
    pages++;
    cursor = page.nextCursor ?? null;
    if (!cursor) break;
    if (pages >= TENDER_INGEST_MAX_PAGES_PER_SOURCE) {
      drained = false;
      break;
    }
  }
  return { kind: "ok", pages, upserted, rowsFailed, drained, highWater };
}

/** Run one tender-ingestion cycle across every due, enabled source. */
export async function runTenderIngestCycle(): Promise<TenderIngestCycleResult> {
  const startedAt = new Date();
  const db = await getDb();
  if (!db) throw new Error("Tender ingestion database is unavailable.");

  const currencyMap = await loadCurrencyMap(db);
  const fxCache = new Map<string, FxRateSnapshot>();
  const snapshotIds = new Map<string, number>();

  const enabled = await db.select().from(tenderSources)
    .where(eq(tenderSources.enabled, true))
    .orderBy(asc(tenderSources.id));
  const nowMs = startedAt.getTime();
  const due = enabled.filter((source) => isSourceDue(source, nowMs)).slice(0, TENDER_INGEST_MAX_SOURCES_PER_CYCLE);

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
