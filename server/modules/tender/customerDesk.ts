import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { tenderSources, tenders } from "../../../drizzle/schema";
import { deriveTenderStatus } from "./normalise";
import { TENDER_STATUSES, type TenderSourceKind, type TenderStatus } from "./provider";

/**
 * Tender Bid — customer desk (Stage 3, read-only).
 *
 * This module is the single read seam between the ingestion store and the
 * customer portal. It renders only what ingestion actually recorded: every row
 * comes from the `tenders` table joined to its `tender_sources` row, so a tender
 * always carries a real source URL and source attribution. Nothing is
 * synthesised, and a missing USD value is reported as `null` (never guessed).
 *
 * The same tender seen via more than one source (e.g. a UK notice also on TED)
 * is grouped by `dedupeGroup` and shown once with every source link, so the
 * customer sees it a single time. The customer-visible status is derived live
 * from the bidding window at read time (an `awarded` tender keeps its recorded
 * outcome), so a tender's status is correct even between ingestion cycles.
 */

/** Upper bound on the rows read per request, so one busy desk cannot stall the portal. */
export const TENDER_DESK_MAX_ROWS = 500;

export type TenderDeskSourceRef = {
  key: string | null;
  label: string;
  kind: TenderSourceKind | string;
  url: string;
};

export type CustomerTender = {
  id: number;
  title: string;
  countryCode: string;
  buyer: string | null;
  buyerType: string | null;
  industry: string | null;
  tenderType: string | null;
  procedure: string | null;
  status: TenderStatus;
  contractAmountMinor: number | null;
  contractCurrency: string | null;
  contractAmountUsdMinor: number | null;
  qualificationAmountUsdMinor: number | null;
  qualificationConfigured: boolean;
  bidOpenAt: string | null;
  bidCloseAt: string | null;
  payoutAt: string | null;
  publishedAt: string | null;
  summary: string | null;
  descriptionText: string | null;
  documents: { label: string; url: string }[];
  sourceUrl: string;
  sources: TenderDeskSourceRef[];
  sourceCount: number;
  lastSyncedAt: string | null;
};

export type TenderDeskOverview = {
  tenders: CustomerTender[];
  facets: {
    countries: string[];
    industries: string[];
    tenderTypes: string[];
    statuses: readonly TenderStatus[];
  };
  total: number;
  truncated: boolean;
  generatedAt: string;
};

type TenderRow = typeof tenders.$inferSelect;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** Read the stored documents JSON, keeping only entries that carry a usable URL. */
function readDocuments(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  const documents: { label: string; url: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) continue;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : url;
    documents.push({ label, url });
  }
  return documents;
}

/** A tender keeps its recorded award outcome; otherwise the clock decides the status. */
function liveStatus(row: TenderRow): TenderStatus {
  if (row.status === "awarded") return "awarded";
  return deriveTenderStatus({ bidOpenAt: iso(row.bidOpenAt), bidCloseAt: iso(row.bidCloseAt) });
}

/** Rank a row by how complete it is, so the richest record fronts a dedupe group. */
function completeness(row: TenderRow): number {
  let score = 0;
  if (row.contractAmountUsdMinor != null) score += 4;
  if (row.buyer) score += 1;
  if (row.industry) score += 1;
  if (row.tenderType) score += 1;
  if (row.descriptionText) score += 1;
  if (row.bidCloseAt) score += 1;
  return score;
}

type JoinedRow = {
  tender: TenderRow;
  sourceKey: string | null;
  sourceLabel: string | null;
  sourceKind: string | null;
};

function toSourceRef(row: JoinedRow): TenderDeskSourceRef {
  return {
    key: row.sourceKey,
    label: row.sourceLabel ?? "Tender source",
    kind: row.sourceKind ?? "government",
    url: row.tender.sourceUrl,
  };
}

function toCustomerTender(canonical: JoinedRow, members: JoinedRow[]): CustomerTender {
  const row = canonical.tender;
  const sources: TenderDeskSourceRef[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const ref = toSourceRef(member);
    const key = `${ref.key ?? ""}|${ref.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(ref);
  }
  if (!sources.length) sources.push(toSourceRef(canonical));
  return {
    id: row.id,
    title: row.title,
    countryCode: row.countryCode,
    buyer: row.buyer ?? null,
    buyerType: row.buyerType ?? null,
    industry: row.industry ?? null,
    tenderType: row.tenderType ?? null,
    procedure: row.procedure ?? null,
    status: liveStatus(row),
    contractAmountMinor: safeInteger(row.contractAmountMinor),
    contractCurrency: row.contractCurrency ?? null,
    contractAmountUsdMinor: safeInteger(row.contractAmountUsdMinor),
    qualificationAmountUsdMinor: safeInteger(row.qualificationAmountUsdMinor),
    qualificationConfigured: safeInteger(row.qualificationAmountUsdMinor) != null,
    bidOpenAt: iso(row.bidOpenAt),
    bidCloseAt: iso(row.bidCloseAt),
    payoutAt: iso(row.payoutAt),
    publishedAt: iso(row.publishedAt),
    summary: row.summary ?? null,
    descriptionText: row.descriptionText ?? null,
    documents: readDocuments(row.documentsJson),
    sourceUrl: row.sourceUrl,
    sources,
    sourceCount: sources.length,
    lastSyncedAt: iso(row.lastSyncedAt),
  };
}

/**
 * Group joined rows into customer tenders, one entry per `dedupeGroup`. The
 * richest member fronts the group; every member's source link is kept.
 */
function groupTenders(rows: JoinedRow[]): CustomerTender[] {
  const groups = new Map<string, JoinedRow[]>();
  for (const row of rows) {
    const dedupe = row.tender.dedupeGroup;
    const key = dedupe && dedupe.length ? `g:${dedupe}` : `t:${row.tender.id}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const tenders: CustomerTender[] = [];
  for (const members of groups.values()) {
    const canonical = members.reduce((best, candidate) => {
      const delta = completeness(candidate.tender) - completeness(best.tender);
      if (delta > 0) return candidate;
      if (delta === 0 && candidate.tender.id < best.tender.id) return candidate;
      return best;
    }, members[0]);
    tenders.push(toCustomerTender(canonical, members));
  }
  return tenders;
}

function distinct(values: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Build the filter facets from the whole catalogue, so the list can be narrowed. */
function buildFacets(tenders: CustomerTender[]): TenderDeskOverview["facets"] {
  return {
    countries: distinct(tenders.map((tender) => tender.countryCode)),
    industries: distinct(tenders.map((tender) => tender.industry)),
    tenderTypes: distinct(tenders.map((tender) => tender.tenderType)),
    statuses: TENDER_STATUSES,
  };
}

/**
 * Read the customer-facing tender catalogue. Returns only real ingested tenders
 * grouped by dedupe group, most recently published first.
 */
export async function getTenderDeskOverview(): Promise<TenderDeskOverview> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const rows = await db
    .select({
      tender: tenders,
      sourceKey: tenderSources.key,
      sourceLabel: tenderSources.label,
      sourceKind: tenderSources.kind,
    })
    .from(tenders)
    .innerJoin(tenderSources, eq(tenders.sourceId, tenderSources.id))
    .orderBy(desc(tenders.publishedAt), desc(tenders.id))
    .limit(TENDER_DESK_MAX_ROWS);

  const deskTenders = groupTenders(rows);
  return {
    tenders: deskTenders,
    facets: buildFacets(deskTenders),
    total: deskTenders.length,
    truncated: rows.length >= TENDER_DESK_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Read one tender with its full record (long description, documents, every
 * source link in its dedupe group). Returns null when the tender does not exist.
 */
export async function getCustomerTender(tenderId: number): Promise<CustomerTender | null> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const rows = await db
    .select({
      tender: tenders,
      sourceKey: tenderSources.key,
      sourceLabel: tenderSources.label,
      sourceKind: tenderSources.kind,
    })
    .from(tenders)
    .innerJoin(tenderSources, eq(tenders.sourceId, tenderSources.id))
    .where(eq(tenders.id, tenderId))
    .limit(1);

  const target = rows[0];
  if (!target) return null;

  // Collect the whole dedupe group so the detail view lists every source link.
  let members = rows;
  const dedupe = target.tender.dedupeGroup;
  if (dedupe && dedupe.length) {
    members = await db
      .select({
        tender: tenders,
        sourceKey: tenderSources.key,
        sourceLabel: tenderSources.label,
        sourceKind: tenderSources.kind,
      })
      .from(tenders)
      .innerJoin(tenderSources, eq(tenders.sourceId, tenderSources.id))
      .where(eq(tenders.dedupeGroup, dedupe))
      .limit(TENDER_DESK_MAX_ROWS);
    if (!members.some((member) => member.tender.id === target.tender.id)) members = rows;
  }

  const grouped = groupTenders(members);
  return grouped.find((tender) => tender.id === target.tender.id) ?? toCustomerTender(target, members);
}
