import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getIncidentReport, listIncidents } from "./incident-log";
import { appendJournalRecord } from "./incident-journal";

describe("incident journal report integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalIncidentLogDir = process.env.INCIDENT_LOG_DIR;
  let tempDir: string | undefined;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalIncidentLogDir === undefined) delete process.env.INCIDENT_LOG_DIR;
    else process.env.INCIDENT_LOG_DIR = originalIncidentLogDir;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("shows supervisor OOM journal entries in both admin incident queries without a database", async () => {
    delete process.env.DATABASE_URL;
    tempDir = mkdtempSync(join(tmpdir(), "incident-report-"));
    process.env.INCIDENT_LOG_DIR = tempDir;
    appendJournalRecord({
      occurredAt: new Date().toISOString(),
      severity: "fatal",
      category: "resource_exhaustion",
      processRole: "supervisor",
      eventCode: "V8_HEAP_OOM",
      message: "Node.js V8 aborted after reaching the JavaScript heap limit.",
      stack: "FATAL ERROR: Reached heap limit",
      context: { stderrTail: "JavaScript heap out of memory" },
      appVersion: null,
      sourceRevision: null,
      instanceId: null,
      bootId: "previous-boot",
      exitCode: null,
      signal: "SIGABRT",
    });

    const list = await listIncidents({ severity: "fatal", category: "resource_exhaustion" });
    const report = await getIncidentReport();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: -1, eventCode: "V8_HEAP_OOM", processRole: "supervisor", signal: "SIGABRT" });
    expect(report.sourceAvailable).toBe(true);
    expect(report.summary).toMatchObject({ total: 1, fatal: 1, categories: { resource_exhaustion: 1 } });
    expect(report.incidents[0]?.message).toContain("heap limit");
  });
});
