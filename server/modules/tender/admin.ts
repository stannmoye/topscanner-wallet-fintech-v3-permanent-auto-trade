import { and, asc, count, desc, eq, getTableColumns, like, or } from "drizzle-orm";
import { getDb } from "../../db";
import { tenderFieldHistory, tenderSources, tenders, v5AuditEvents } from "../../../drizzle/schema";
import { runMonitoredWorkerCycle } from "../../_core/workerHealth";
import { runTenderIngestCycle, type TenderIngestCycleResult } from "./ingest";
import { deriveTenderStatus } from "./normalise";
import {
  TENDER_CORRECTION_FIELDS,
  hasTenderFieldOverride,
  parseTenderCorrection,
  readTenderOverrides,
  tenderFieldDisplay,
  tenderFieldFromJson,
  tenderFieldToJson,
  type TenderCorrectionField,
  type TenderOverrides,
} from "./corrections";

/**
 * Tender Bid — administrator corrections, source health and the corrections view
 * (Stage 5).
 *
 * Every edit goes through `correctTenderField`, which validates the value, writes
 * an append-only `tender_field_history` row (old → new, administrator, note) and
 * records the override so the change takes effect on the customer side
 * immediately and survives the next ingestion cycle. `revertTenderField` restores
 * a source-derived field to the value the source last provided. Source enable and
 * disable are audited to `v5_audit_events`. Nothing is hard-coded; the editable
 * field catalogue lives in `corrections.ts` and is read from there.
 */

/** Upper bound on correction rows read in one request. */
export const TENDER_ADMIN_MAX_ROWS = 200;

/** Upper bound on the per-tender correction history returned with a detail view. */
export const TENDER_CORRECTION_HISTORY_MAX_ROWS = 100;

type TenderRow = typeof tenders.$inferSelect;
type TenderSourceRow = typeof tenderSources.$inferSelect;

/**
 * The correction desk only reads the summary and correction columns; the heavy
 * `rawJson` longtext payload is never rendered or edited here and must never be
 * pulled for a page of rows. Projecting an explicit column set (mirroring
 * `customerDesk.ts`) keeps the heap flat regardless of how large an individual
 * stored payload is, so a 200-row page cannot exhaust a small host's heap.
 */
const { rawJson: _adminRawJson, ...adminTenderColumns } = getTableColumns(tenders);
type TenderAdminRow = Omit<TenderRow, "rawJson">;

export type AdminTenderSource = {
  id: number;
  key: string;
  label: string;
  countryCode: string;
  kind: string;
  adapter: string;
  enabled: boolean;
  expectedIntervalMs: number;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  /** How many tenders are currently stored for this source. */
  tenderCount: number;
};

export type AdminTenderSummary = {
  id: number;
  sourceId: number;
  sourceLabel: string | null;
  sourceKind: string | null;
  externalId: string;
  countryCode: string;
  title: string;
  status: string;
  storedStatus: string;
  contractAmountUsdMinor: number | null;
  qualificationAmountUsdMinor: number | null;
  bidCloseAt: string | null;
  publishedAt: string | null;
  lastSyncedAt: string | null;
  overrideCount: number;
};

export type AdminTenderDetail = AdminTenderSummary & {
  sourceKey: string | null;
  buyer: string | null;
  buyerType: string | null;
  industry: string | null;
  tenderType: string | null;
  procedure: string | null;
  contractAmountMinor: number | null;
  contractCurrency: string | null;
  qualificationPctBps: number | null;
  qualificationOverridden: boolean;
  bidOpenAt: string | null;
  payoutAt: string | null;
  summary: string | null;
  descriptionText: string | null;
  sourceUrl: string;
  overrides: TenderOverrides;
  history: AdminTenderHistoryEntry[];
};

export type AdminTenderHistoryEntry = {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  adminUserId: number;
  createdAt: string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** The editable field catalogue, exposed so the admin form is built from one source. */
export function listTenderCorrectionFields(): readonly TenderCorrectionField[] {
  return TENDER_CORRECTION_FIELDS;
}

/** The customer-visible status: an administrator pin wins, then a recorded award, then the clock. */
function liveStatus(row: TenderAdminRow): string {
  if (hasTenderFieldOverride(row.overridesJson, "status")) return row.status;
  if (row.status === "awarded") return "awarded";
  return deriveTenderStatus({ bidOpenAt: iso(row.bidOpenAt), bidCloseAt: iso(row.bidCloseAt) });
}

function overrideCount(value: unknown): number {
  return Object.keys(readTenderOverrides(value)).length;
}

function requireDatabase<T>(db: T | null | undefined): T {
  if (!db) throw new Error("Database is not available");
  return db;
}

function validateNote(note: string, label: string): string {
  const trimmed = String(note || "").trim();
  if (trimmed.length < 3 || trimmed.length > 500) throw new Error(`Provide a ${label} of 3–500 characters.`);
  return trimmed;
}

/** Every source with its live health columns and the number of tenders it holds. */
export async function listTenderSourcesForAdmin(): Promise<{ sources: AdminTenderSource[]; total: number }> {
  const db = requireDatabase(await getDb());
  const [rows, counts] = await Promise.all([
    db.select().from(tenderSources).orderBy(asc(tenderSources.countryCode), asc(tenderSources.label)),
    db.select({ sourceId: tenders.sourceId, total: count() }).from(tenders).groupBy(tenders.sourceId),
  ]);
  const countBySource = new Map<number, number>();
  for (const row of counts) countBySource.set(Number(row.sourceId), Number(row.total));
  const sources = rows.map((row) => toAdminSource(row, countBySource.get(row.id) ?? 0));
  return { sources, total: sources.length };
}

function toAdminSource(row: TenderSourceRow, tenderCount: number): AdminTenderSource {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    countryCode: row.countryCode,
    kind: row.kind,
    adapter: row.adapter,
    enabled: row.enabled,
    expectedIntervalMs: Number(row.expectedIntervalMs),
    lastSyncAt: iso(row.lastSyncAt),
    lastStatus: row.lastStatus ?? null,
    lastError: row.lastError ?? null,
    tenderCount,
  };
}

/**
 * Enable or disable one source. Disabling only stops future polling; stored
 * tenders remain visible. The change is recorded in the shared administrator
 * audit trail.
 */
export async function setTenderSourceEnabled(
  adminId: number,
  input: { sourceId: number; enabled: boolean; reason: string },
): Promise<AdminTenderSource> {
  const db = requireDatabase(await getDb());
  const sourceId = Number(input.sourceId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) throw new Error("Select a source to change.");
  const reason = validateNote(input.reason, "reason");
  const source = (await db.select().from(tenderSources).where(eq(tenderSources.id, sourceId)).limit(1))[0];
  if (!source) throw new Error("This tender source no longer exists.");

  await db.update(tenderSources)
    .set({ enabled: Boolean(input.enabled), updatedAt: new Date() })
    .where(eq(tenderSources.id, sourceId));

  try {
    await db.insert(v5AuditEvents).values({
      actorUserId: adminId,
      action: input.enabled ? "tender_source_enabled" : "tender_source_disabled",
      entityType: "tender_source",
      entityId: String(sourceId),
      reason,
      reference: `tender-source:${source.key}`,
      metadataJson: JSON.stringify({ key: source.key, enabled: Boolean(input.enabled) }),
    });
  } catch (error) {
    console.error("[Tender] Source audit write failed:", error instanceof Error ? error.name : "UnknownError");
  }

  const total = (await db.select({ total: count() }).from(tenders).where(eq(tenders.sourceId, sourceId)))[0];
  return toAdminSource({ ...source, enabled: Boolean(input.enabled) }, Number(total?.total ?? 0));
}

/**
 * Run one tender-ingestion cycle immediately on demand (the administrator
 * "Fetch now" action). The weekly cadence means providers are not polled
 * continuously; this forces every enabled source to be treated as due so an
 * administrator can refresh without waiting for the next weekly run. The cycle
 * remains bounded, and the request is recorded in the shared audit trail.
 */
export async function runTenderIngestNow(
  adminId: number,
  input: { reason: string },
): Promise<TenderIngestCycleResult> {
  const db = requireDatabase(await getDb());
  const reason = validateNote(input.reason, "reason");
  const result = await runMonitoredWorkerCycle("tender-ingest", () => runTenderIngestCycle({ force: true }), {
    degradedWhen: (cycle) => cycle.sourcesFailed > 0,
    degradedMessage: (cycle) => `${cycle.sourcesFailed} tender source(s) failed during ingestion`,
  });

  try {
    await db.insert(v5AuditEvents).values({
      actorUserId: adminId,
      action: "tender_ingest_fetch_now",
      entityType: "tender_source",
      entityId: "all",
      reason,
      reference: "tender-source:fetch-now",
      metadataJson: JSON.stringify({
        sourcesDue: result.sourcesDue,
        sourcesProcessed: result.sourcesProcessed,
        sourcesFailed: result.sourcesFailed,
        tendersUpserted: result.tendersUpserted,
      }),
    });
  } catch (error) {
    console.error("[Tender] Fetch-now audit write failed:", error instanceof Error ? error.name : "UnknownError");
  }

  return result;
}

/**
 * Search the correction desk. A term matches the title, buyer or external id;
 * the optional filters narrow by source and country.
 */
export async function listTendersForAdmin(input?: {
  query?: string;
  sourceId?: number;
  countryCode?: string;
}): Promise<{ tenders: AdminTenderSummary[]; total: number }> {
  const db = requireDatabase(await getDb());
  const filters = [];
  const term = String(input?.query ?? "").trim();
  if (term) {
    const pattern = `%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    filters.push(or(like(tenders.title, pattern), like(tenders.buyer, pattern), like(tenders.externalId, pattern)));
  }
  if (input?.sourceId && Number.isSafeInteger(input.sourceId)) filters.push(eq(tenders.sourceId, Number(input.sourceId)));
  if (input?.countryCode) filters.push(eq(tenders.countryCode, String(input.countryCode).trim().toUpperCase().slice(0, 8)));

  const rows = await db.select({
    tender: adminTenderColumns,
    sourceLabel: tenderSources.label,
    sourceKind: tenderSources.kind,
  })
    .from(tenders)
    .innerJoin(tenderSources, eq(tenders.sourceId, tenderSources.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(tenders.lastSyncedAt), desc(tenders.id))
    .limit(TENDER_ADMIN_MAX_ROWS);

  return { tenders: rows.map((row) => toSummary(row.tender, row.sourceLabel, row.sourceKind)), total: rows.length };
}

function toSummary(row: TenderAdminRow, sourceLabel: string | null, sourceKind: string | null): AdminTenderSummary {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceLabel,
    sourceKind,
    externalId: row.externalId,
    countryCode: row.countryCode,
    title: row.title,
    status: liveStatus(row),
    storedStatus: row.status,
    contractAmountUsdMinor: safeInteger(row.contractAmountUsdMinor),
    qualificationAmountUsdMinor: safeInteger(row.qualificationAmountUsdMinor),
    bidCloseAt: iso(row.bidCloseAt),
    publishedAt: iso(row.publishedAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    overrideCount: overrideCount(row.overridesJson),
  };
}

/** One tender with its current values, its override map and its correction history. */
export async function getTenderForAdmin(tenderId: number): Promise<AdminTenderDetail | null> {
  const db = requireDatabase(await getDb());
  const id = Number(tenderId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const joined = (await db.select({
    tender: adminTenderColumns,
    sourceKey: tenderSources.key,
    sourceLabel: tenderSources.label,
    sourceKind: tenderSources.kind,
  })
    .from(tenders)
    .innerJoin(tenderSources, eq(tenders.sourceId, tenderSources.id))
    .where(eq(tenders.id, id))
    .limit(1))[0];
  if (!joined) return null;

  const history = await db.select()
    .from(tenderFieldHistory)
    .where(eq(tenderFieldHistory.tenderId, id))
    .orderBy(desc(tenderFieldHistory.createdAt), desc(tenderFieldHistory.id))
    .limit(TENDER_CORRECTION_HISTORY_MAX_ROWS);

  const row = joined.tender;
  return {
    ...toSummary(row, joined.sourceLabel, joined.sourceKind),
    sourceKey: joined.sourceKey,
    buyer: row.buyer ?? null,
    buyerType: row.buyerType ?? null,
    industry: row.industry ?? null,
    tenderType: row.tenderType ?? null,
    procedure: row.procedure ?? null,
    contractAmountMinor: safeInteger(row.contractAmountMinor),
    contractCurrency: row.contractCurrency ?? null,
    qualificationPctBps: safeInteger(row.qualificationPctBps),
    qualificationOverridden: Boolean(row.qualificationOverridden),
    bidOpenAt: iso(row.bidOpenAt),
    payoutAt: iso(row.payoutAt),
    summary: row.summary ?? null,
    descriptionText: row.descriptionText ?? null,
    sourceUrl: row.sourceUrl,
    overrides: readTenderOverrides(row.overridesJson),
    history: history.map((entry) => ({
      id: entry.id,
      field: entry.field,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      note: entry.note ?? null,
      adminUserId: entry.adminUserId,
      createdAt: iso(entry.createdAt) ?? new Date().toISOString(),
    })),
  };
}

const QUALIFICATION_FIELDS = new Set(["qualificationPctBps", "qualificationAmountUsdMinor"]);

function qualificationOverriddenFor(overrides: TenderOverrides): boolean {
  for (const field of QUALIFICATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) return true;
  }
  return false;
}

/**
 * Correct one tender field. The value is validated, an append-only history row is
 * written, and — the first time a field is corrected — the value it is replacing
 * is captured so the field can later be reverted to the source value. Ingestion
 * reads the override keys and leaves those fields untouched, so the correction
 * survives re-ingestion and shows to customers immediately.
 */
export async function correctTenderField(
  adminId: number,
  input: { tenderId: number; field: string; value: string; note: string },
): Promise<AdminTenderDetail> {
  const db = requireDatabase(await getDb());
  const tenderId = Number(input.tenderId);
  if (!Number.isSafeInteger(tenderId) || tenderId <= 0) throw new Error("Select a tender to correct.");
  const note = validateNote(input.note, "note");
  const parsed = parseTenderCorrection(String(input.field), input.value);
  if (!parsed.ok) throw new Error(parsed.error);
  const field = String(input.field);

  const row = (await db.select().from(tenders).where(eq(tenders.id, tenderId)).limit(1))[0];
  if (!row) throw new Error("This tender no longer exists.");

  const overrides = readTenderOverrides(row.overridesJson);
  const nextOverrides: TenderOverrides = { ...overrides };
  // Capture the source value the first time this field is overridden, so a later
  // revert restores exactly what the source last provided.
  if (!Object.prototype.hasOwnProperty.call(overrides, field)) {
    nextOverrides[field] = tenderFieldToJson(field, (row as Record<string, unknown>)[field]);
  }

  const oldDisplay = tenderFieldDisplay((row as Record<string, unknown>)[field]);
  const set: Record<string, unknown> = {
    [field]: parsed.columnValue,
    overridesJson: nextOverrides,
    updatedAt: new Date(),
  };
  if (QUALIFICATION_FIELDS.has(field)) set.qualificationOverridden = true;

  await db.transaction(async (tx) => {
    await tx.update(tenders).set(set).where(eq(tenders.id, tenderId));
    await tx.insert(tenderFieldHistory).values({
      tenderId,
      adminUserId: adminId,
      field,
      oldValue: oldDisplay,
      newValue: tenderFieldDisplay(parsed.jsonValue),
      note,
    });
  });

  const detail = await getTenderForAdmin(tenderId);
  if (!detail) throw new Error("This tender no longer exists.");
  return detail;
}

/**
 * Revert a source-derived field to the value captured when it was overridden and
 * drop the override so the next ingestion cycle resumes writing the field.
 */
export async function revertTenderField(
  adminId: number,
  input: { tenderId: number; field: string; note: string },
): Promise<AdminTenderDetail> {
  const db = requireDatabase(await getDb());
  const tenderId = Number(input.tenderId);
  if (!Number.isSafeInteger(tenderId) || tenderId <= 0) throw new Error("Select a tender to revert.");
  const note = validateNote(input.note, "note");
  const field = String(input.field);

  const row = (await db.select().from(tenders).where(eq(tenders.id, tenderId)).limit(1))[0];
  if (!row) throw new Error("This tender no longer exists.");

  const overrides = readTenderOverrides(row.overridesJson);
  if (!Object.prototype.hasOwnProperty.call(overrides, field)) {
    throw new Error("This field is not overridden, so there is nothing to revert.");
  }
  const sourceValue = tenderFieldFromJson(field, overrides[field]);

  const nextOverrides: TenderOverrides = { ...overrides };
  delete nextOverrides[field];

  const oldDisplay = tenderFieldDisplay((row as Record<string, unknown>)[field]);
  const set: Record<string, unknown> = {
    [field]: sourceValue,
    overridesJson: nextOverrides,
    updatedAt: new Date(),
  };
  if (QUALIFICATION_FIELDS.has(field)) set.qualificationOverridden = qualificationOverriddenFor(nextOverrides);

  await db.transaction(async (tx) => {
    await tx.update(tenders).set(set).where(eq(tenders.id, tenderId));
    await tx.insert(tenderFieldHistory).values({
      tenderId,
      adminUserId: adminId,
      field,
      oldValue: oldDisplay,
      newValue: tenderFieldDisplay(sourceValue),
      note: `Reverted to source value. ${note}`.slice(0, 500),
    });
  });

  const detail = await getTenderForAdmin(tenderId);
  if (!detail) throw new Error("This tender no longer exists.");
  return detail;
}
