import { randomUUID } from "node:crypto";
import { appendJournalRecord } from "../incident-journal";
import { sanitizeIncidentText } from "../incident-sanitize";

/**
 * Earliest-possible crash capture.
 *
 * This module has **no application imports** on purpose (only Node built-ins plus
 * the dependency-free journal and sanitizer), so it is evaluated first when
 * `server/_core/index.ts` is loaded. That means the `uncaughtException` and
 * `unhandledRejection` handlers below are installed *before* the rest of the
 * application module graph evaluates. A module that throws while it is being
 * imported — one of the most common ways a Node server dies on a managed host —
 * is therefore still recorded, instead of vanishing with only a stdout line that
 * no one keeps.
 *
 * Records are journaled straight to disk synchronously because the process is
 * about to die and an asynchronous database write cannot be trusted to finish.
 * Normal (non-fatal) incidents continue to use the database through
 * {@link recordIncident}, which falls back to the same journal when the database
 * is unavailable, so a crash is never lost to a failing database.
 */

/** Source revision of the running build, for attribution on the journal record. */
const APP_SOURCE_REVISION = process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || null;

/**
 * Resolve this process's boot id and publish it back into the environment so the
 * application's incident log groups into the exact same restart session, whether
 * the id came from the supervisor or was generated here.
 */
const INCIDENT_HOOK_BOOT_ID = process.env.ARBITRADE_BOOT_ID?.trim() || randomUUID();
process.env.ARBITRADE_BOOT_ID = INCIDENT_HOOK_BOOT_ID;

type JournalCrashInput = {
  severity: string;
  category: string;
  eventCode?: string | null;
  message: string;
  stack?: string | null;
  context?: Record<string, unknown> | null;
  exitCode?: number | null;
  signal?: string | null;
};

/**
 * Write a fatal/error crash record to the durable disk journal. Best-effort and
 * synchronous, so it works during the last moments of a crashing process, and it
 * never throws.
 */
export function recordJournalCrash(input: JournalCrashInput): boolean {
  return appendJournalRecord({
    occurredAt: new Date().toISOString(),
    severity: input.severity,
    category: input.category,
    processRole: "application",
    eventCode: input.eventCode ?? null,
    message: sanitizeIncidentText(input.message || "Incident without a message", 1000) || "Incident without a message",
    stack: input.stack ? sanitizeIncidentText(input.stack, 8000) : null,
    context: input.context ?? null,
    appVersion: process.env.APP_VERSION ?? null,
    sourceRevision: APP_SOURCE_REVISION,
    instanceId: process.env.INSTANCE_ID ?? null,
    bootId: INCIDENT_HOOK_BOOT_ID,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
  });
}

// Installed before the application module graph loads. Semantics are unchanged:
// the uncaught path still records, then exits non-zero.
process.on("uncaughtException", (error) => {
  recordJournalCrash({
    severity: "fatal",
    category: "uncaught_exception",
    eventCode: error?.name,
    message: error?.message || "Uncaught exception",
    stack: error?.stack ?? String(error),
    context: { code: (error as { code?: unknown })?.code ?? null },
    exitCode: 1,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  recordJournalCrash({
    severity: "error",
    category: "unhandled_rejection",
    eventCode: error.name,
    message: error.message || "Unhandled promise rejection",
    stack: error.stack ?? String(reason),
    context: { code: (error as { code?: unknown })?.code ?? null },
  });
});
