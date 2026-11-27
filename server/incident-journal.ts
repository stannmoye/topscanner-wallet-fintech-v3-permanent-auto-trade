import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Durable, disk-backed incident journal.
 *
 * The primary incident log lives in the database, but that is not always enough
 * on a managed host: cPanel launches the application straight from
 * `dist/index.js` (the external `scripts/start-with-diagnostics.mjs` supervisor
 * never runs), and the database is sometimes the very thing that is failing.
 * This journal is a second copy written straight to disk with synchronous Node
 * built-ins, so a crash is still on the server — and still visible in the
 * administrator console — after the process dies and restarts, even when the
 * database is unreachable, the incident table is missing, or the process is
 * terminated before an asynchronous database write can complete.
 *
 * Every helper here is best-effort and never throws: persisting a crash must
 * never become a second fault.
 */

/** File name of the append-only journal inside the journal directory. */
export const INCIDENT_JOURNAL_FILENAME = "incidents.jsonl";

export type JournalRecord = {
  occurredAt: string;
  severity: string;
  category: string;
  processRole: string;
  eventCode: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  appVersion: string | null;
  sourceRevision: string | null;
  instanceId: string | null;
  bootId: string | null;
  exitCode: number | null;
  signal: string | null;
};

/** A journal record together with the synthetic id the console deletes by. */
export type JournalEntry = JournalRecord & { id: number };

/**
 * Absolute path of the journal file. Defaults to `<cwd>/logs/incidents.jsonl`
 * (next to the built server on the managed host) and can be redirected with
 * `INCIDENT_LOG_DIR` so the journal can live on a mounted, writable volume that
 * survives redeploys.
 */
export function incidentJournalPath(): string {
  const dir = (process.env.INCIDENT_LOG_DIR || "").trim() || join(process.cwd(), "logs");
  return join(dir, INCIDENT_JOURNAL_FILENAME);
}

/** Append one record to the journal. Returns whether the write succeeded. */
export function appendJournalRecord(record: JournalRecord): boolean {
  try {
    const path = incidentJournalPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read every journal record, oldest first, assigning each a stable, negative
 * synthetic id. Journal ids are negative so they can never collide with the
 * positive auto-increment ids of the database rows they are merged with, while
 * keeping the report a single list in the console.
 */
export function readJournalEntries(): JournalEntry[] {
  try {
    const path = incidentJournalPath();
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n");
    const entries: JournalEntry[] = [];
    let position = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      position += 1;
      try {
        const parsed = JSON.parse(trimmed) as JournalRecord;
        if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
          entries.push({ ...parsed, id: -position });
        }
      } catch {
        // A truncated final line (process killed mid-write) is expected; skip it.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Size of the journal file in bytes, or null when it does not exist. */
export function journalFileSize(): number | null {
  try {
    const path = incidentJournalPath();
    if (!existsSync(path)) return null;
    return statSync(path).size;
  } catch {
    return null;
  }
}

function rewriteJournal(records: JournalRecord[]): void {
  const path = incidentJournalPath();
  mkdirSync(dirname(path), { recursive: true });
  const text = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(path, text ? `${text}\n` : "", { encoding: "utf8" });
}

function stripId(entry: JournalEntry): JournalRecord {
  const { id: _id, ...rest } = entry;
  return rest;
}

/** Delete one journal record by its negative synthetic id. Returns rows removed. */
export function deleteJournalEntry(id: number): number {
  if (!Number.isFinite(id) || id >= 0) return 0;
  try {
    const entries = readJournalEntries();
    const target = entries.find((entry) => entry.id === Math.trunc(id));
    if (!target) return 0;
    rewriteJournal(entries.filter((entry) => entry.id !== target.id).map(stripId));
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Delete journal records: one restart session when a boot id is supplied, or the
 * whole file otherwise. Returns rows removed.
 */
export function clearJournalEntries(options: { bootId?: string } = {}): number {
  try {
    const entries = readJournalEntries();
    if (!entries.length) return 0;
    const bootId = options.bootId?.trim();
    const kept = entries.filter((entry) => (bootId ? entry.bootId !== bootId : false)).map(stripId);
    const removed = entries.length - kept.length;
    if (removed) rewriteJournal(kept);
    return removed;
  } catch {
    return 0;
  }
}

/** Delete journal records older than the ISO cutoff. Returns rows removed. */
export function purgeJournalEntries(cutoffIso: string): number {
  try {
    const entries = readJournalEntries();
    if (!entries.length) return 0;
    const kept = entries.filter((entry) => String(entry.occurredAt ?? "") >= cutoffIso).map(stripId);
    const removed = entries.length - kept.length;
    if (removed) rewriteJournal(kept);
    return removed;
  } catch {
    return 0;
  }
}
