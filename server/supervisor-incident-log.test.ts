import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIncidentWriter } from "../scripts/incident-log.mjs";

describe("supervisor incident journal fallback", () => {
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

  it("writes a sanitized supervisor crash to disk when the database is unavailable", async () => {
    delete process.env.DATABASE_URL;
    tempDir = mkdtempSync(join(tmpdir(), "incident-supervisor-"));
    process.env.INCIDENT_LOG_DIR = tempDir;
    const warnings: string[] = [];
    const writer = createIncidentWriter({
      bootId: "test-boot",
      logger: (error: Error) => warnings.push(error.message),
    });

    await writer.record({
      severity: "fatal",
      category: "resource_exhaustion",
      processRole: "supervisor",
      eventCode: "V8_HEAP_OOM",
      message: "Node.js reached the heap limit with password=not-a-secret",
      stack: "FATAL ERROR: Reached heap limit",
      context: { phase: "application-server", stderrTail: "JavaScript heap out of memory" },
      exitCode: null,
      signal: "SIGABRT",
    });
    await writer.close();

    const rows = readFileSync(join(tempDir, "incidents.jsonl"), "utf8").trim().split("\n");
    expect(rows).toHaveLength(1);
    const incident = JSON.parse(rows[0]);
    expect(incident.eventCode).toBe("V8_HEAP_OOM");
    expect(incident.bootId).toBe("test-boot");
    expect(incident.message).not.toContain("not-a-secret");
    expect(incident.message).toContain("[redacted]");
    expect(incident.context.stderrTail).toContain("JavaScript heap out of memory");
    expect(warnings).toContain("DATABASE_URL is required");
  });
});
