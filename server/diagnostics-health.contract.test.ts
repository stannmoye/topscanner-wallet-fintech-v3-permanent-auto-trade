import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyProbeResource, deriveProbeStatus } from "./_core/apiHealth";

const incidentModule = readFileSync(new URL("./incident-log.ts", import.meta.url), "utf8");
const apiHealthModule = readFileSync(new URL("./_core/apiHealth.ts", import.meta.url), "utf8");
const resourceModule = readFileSync(new URL("./_core/resourceReport.ts", import.meta.url), "utf8");
const workerHealth = readFileSync(new URL("./_core/workerHealth.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("../scripts/start-with-diagnostics.mjs", import.meta.url), "utf8");
const supervisorLog = readFileSync(new URL("../scripts/incident-log.mjs", import.meta.url), "utf8");
const nav = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("../client/src/components/AdminDiagnosticsHealth.tsx", import.meta.url), "utf8");

describe("crash & incident diagnostics contract", () => {
  it("persists incidents to an additive, idempotently-created table", () => {
    expect(incidentModule).toContain('export const INCIDENT_LOG_TABLE = "application_incident_events"');
    expect(incidentModule).toContain("CREATE TABLE IF NOT EXISTS application_incident_events");
    expect(incidentModule).toContain("export async function ensureIncidentLogSchema");
    expect(incidentModule).toContain("export async function recordIncident");
    // Recording a crash must never become a second fault.
    expect(incidentModule).toContain("if (isMissingTableError(error)) return;");
  });

  it("captures uncaught errors, unhandled rejections, startup failures, OOM and worker failures", () => {
    expect(core).toContain('process.on("uncaughtException"');
    expect(core).toContain('category: "uncaught_exception"');
    expect(core).toContain('process.on("unhandledRejection"');
    expect(core).toContain('category: "unhandled_rejection"');
    expect(core).toContain('category: "startup_failure"');
    expect(core).toContain('category: "resource_exhaustion"');
    expect(core).toContain('eventCode: "MEMORY_PRESSURE"');
    expect(workerHealth).toContain('category: "worker_failure"');
    expect(workerHealth).toContain("recordWorkerIncident");
  });

  it("shares one boot id between the supervisor and the app so a restart groups into one session", () => {
    expect(incidentModule).toContain("process.env.ARBITRADE_BOOT_ID?.trim() || randomUUID()");
    expect(wrapper).toContain("process.env.ARBITRADE_BOOT_ID = BOOT_ID");
    expect(wrapper).toContain("createIncidentWriter");
    expect(supervisorLog).toContain('export const INCIDENT_LOG_TABLE = "application_incident_events"');
    // A supervisor-observed exit is classified as an OOM when the signal says so.
    expect(wrapper).toContain('signal === "SIGKILL"');
    expect(wrapper).toContain('category: suspectedOom ? "resource_exhaustion" : "unexpected_exit"');
  });

  it("guarantees the incident schema on boot and clears expired rows on a schedule", () => {
    expect(core).toContain("await ensureIncidentLogSchema();");
    expect(core).toContain("await ensureApiHealthSchema();");
    expect(core).toContain("purgeIncidentLog");
    expect(core).toContain("const memoryWatchdogTimer = registerWorkerInterval(");
  });

  it("keeps the incident window bounded and reportable across restarts", () => {
    expect(incidentModule).toContain("export const INCIDENT_RETENTION_DAYS = 90");
    expect(incidentModule).toContain("export async function getIncidentReport");
    expect(incidentModule).toContain("isCurrentBoot: bootId === INCIDENT_BOOT_ID");
    expect(incidentModule).toContain("DELETE FROM application_incident_events WHERE occurredAt < ?");
  });

  it("lets an administrator manually delete one crash report or clear a session", () => {
    expect(incidentModule).toContain("export async function deleteIncident");
    expect(incidentModule).toContain("DELETE FROM application_incident_events WHERE id = ?");
    expect(incidentModule).toContain("export async function clearIncidents");
    expect(incidentModule).toContain("DELETE FROM application_incident_events WHERE bootId = ?");
  });
});

describe("resource & improvement contract", () => {
  it("reports live memory and disk usage", () => {
    expect(resourceModule).toContain("process.memoryUsage()");
    expect(resourceModule).toContain("constrainedMemory");
    expect(resourceModule).toContain("statfs");
    expect(resourceModule).toContain("export async function getResourceReport");
  });

  it("tiers improvements as critical / major / minor from real signals", () => {
    expect(resourceModule).toContain('export type ImprovementTier = "critical" | "major" | "minor"');
    expect(resourceModule).toContain("getIncidentSummary");
    expect(resourceModule).toContain("getApiHealthReport");
    expect(resourceModule).toContain("getWorkerHealthSummary");
    expect(resourceModule).toContain("TIER_ORDER");
  });
});

describe("API health contract", () => {
  it("registers the outbound providers and defaults to passive status", () => {
    expect(apiHealthModule).toContain("export const API_PROVIDER_REGISTRY");
    expect(apiHealthModule).toContain('export const API_HEALTH_TABLE = "api_health_checks"');
    expect(apiHealthModule).toContain("export async function getApiHealthReport");
    expect(apiHealthModule).toContain("export async function ensureApiHealthSchema");
    // The passive report must never make an outbound call.
    expect(apiHealthModule).toContain("Build the passive API health report (no outbound calls).");
  });

  it("runs a real, rate-limited on-demand probe that measures latency and payload", () => {
    expect(apiHealthModule).toContain("export async function probeApiProvider");
    expect(apiHealthModule).toContain("API_PROBE_COOLDOWN_MS");
    expect(apiHealthModule).toContain("AbortController");
    expect(apiHealthModule).toContain("response.arrayBuffer()");
    expect(apiHealthModule).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("classifies probe resource from measured bytes and latency", () => {
    expect(classifyProbeResource(600 * 1024, 100)).toBe("high");
    expect(classifyProbeResource(200 * 1024, 100)).toBe("moderate");
    expect(classifyProbeResource(10 * 1024, 100)).toBe("low");
    expect(classifyProbeResource(null, 5_000)).toBe("high");
    expect(classifyProbeResource(null, null)).toBeNull();
  });

  it("derives status and treats a 429 as degraded", () => {
    expect(deriveProbeStatus("data", 200, false)).toBe("ok");
    expect(deriveProbeStatus("data", 429, false)).toBe("degraded");
    expect(deriveProbeStatus("data", 500, false)).toBe("fail");
    expect(deriveProbeStatus("reachability", 500, false)).toBe("ok");
    expect(deriveProbeStatus("data", null, true)).toBe("fail");
  });
});

describe("diagnostics tRPC surface", () => {
  it("exposes admin-only incident, resource and API-health procedures", () => {
    expect(router).toContain('import { getApiHealthReport, probeApiProvider } from "./_core/apiHealth"');
    expect(router).toContain('import { getResourceReport } from "./_core/resourceReport"');
    expect(router).toContain('import { clearIncidents, deleteIncident, getIncidentReport, listIncidents, purgeIncidentLog } from "./incident-log"');
    expect(router).toContain("incidents: adminProcedure.input(z.object({");
    expect(router).toContain("incidentList: adminProcedure.input(z.object({");
    expect(router).toContain("purgeIncidents: adminProcedure.input(z.object({");
    expect(router).toContain("deleteIncident: adminProcedure.input(z.object({");
    expect(router).toContain("clearIncidents: adminProcedure.input(z.object({");
    expect(router).toContain("resourceReport: adminProcedure.query(() => getResourceReport())");
    expect(router).toContain("apiHealth: adminProcedure.query(() => getApiHealthReport())");
    expect(router).toContain("probeApiProvider: adminProcedure.input(z.object({ providerId:");
  });
});

describe("diagnostics admin console", () => {
  it("registers the Diagnostics & Health menu with its three sub-pages", () => {
    expect(nav).toContain('id: "diagnostics-health", label: "Diagnostics & Health"');
    expect(nav).toContain('target: "crashDiagnostics"');
    expect(nav).toContain('target: "resourceHealth"');
    expect(nav).toContain('target: "apiHealth"');
    expect(nav).toContain("Critical Improvements");
    expect(nav).toContain("Reduce Resource Use");
  });

  it("routes each submenu target to a lazy diagnostics component", () => {
    expect(appSource).toContain('const AdminCrashDiagnostics = lazy(() => import("@/components/AdminDiagnosticsHealth")');
    expect(appSource).toContain('const AdminResourceHealth = lazy(() => import("@/components/AdminDiagnosticsHealth")');
    expect(appSource).toContain('const AdminApiHealth = lazy(() => import("@/components/AdminDiagnosticsHealth")');
    expect(appSource).toContain('{section==="crashDiagnostics"&&<Suspense');
    expect(appSource).toContain('{section==="resourceHealth"&&<Suspense');
    expect(appSource).toContain('{section==="apiHealth"&&<Suspense');
  });

  it("renders the crash cause, resource tiers and API probe controls", () => {
    expect(component).toContain("trpc.adminOperations.incidents.useQuery");
    expect(component).toContain("trpc.adminOperations.incidentList.useQuery");
    expect(component).toContain("trpc.adminOperations.deleteIncident.useMutation");
    expect(component).toContain("trpc.adminOperations.clearIncidents.useMutation");
    expect(component).toContain("trpc.adminOperations.resourceReport.useQuery");
    expect(component).toContain("trpc.adminOperations.apiHealth.useQuery");
    expect(component).toContain("trpc.adminOperations.probeApiProvider.useMutation");
    expect(component).toContain("Critical improvements");
    expect(component).toContain("High resource");
  });
});
