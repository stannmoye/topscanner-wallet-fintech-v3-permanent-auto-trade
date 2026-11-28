import { getHeapStatistics } from "node:v8";
import { getIncidentSummary } from "../incident-log";
import { getApiHealthReport } from "./apiHealth";
import { getWorkerHealthSummary } from "./workerHealth";

/**
 * Resource usage and improvement tiers.
 *
 * Reports live process memory, the host/volume disk usage, and a single
 * prioritised list of improvements grouped as critical / major / minor. The
 * improvement tiers are derived from real signals — recent incidents, outbound
 * API health, and background-worker health — plus the live memory/disk
 * thresholds, so the console answers "what most needs fixing" without any
 * hard-coded list.
 */

export type ImprovementTier = "critical" | "major" | "minor";

export type Improvement = {
  tier: ImprovementTier;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
};

export type ResourceReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    /** Heap used as a share of the committed heap (`heapTotal`) — informational only. */
    heapUsePercent: number;
    /** The configured V8 heap ceiling (`v8.getHeapStatistics().heap_size_limit`), the real heap budget. */
    heapLimitBytes: number | null;
    /** Heap used as a share of the configured heap ceiling; the signal a heap alarm should use. */
    heapLimitUsePercent: number | null;
    externalBytes: number;
    arrayBuffersBytes: number;
    limitBytes: number | null;
    availableBytes: number | null;
    limitUsePercent: number | null;
  };
  database: {
    connected: boolean;
    connectionLimit: number | null;
    totalConnections: number | null;
    idleConnections: number | null;
    activeConnections: number | null;
    queuedRequests: number | null;
  };
  disk: {
    target: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  } | null;
  improvementSummary: { critical: number; major: number; minor: number; total: number };
  improvements: Improvement[];
  notes: string[];
};

const TIER_ORDER: Record<ImprovementTier, number> = { critical: 0, major: 1, minor: 2 };

function pct(value: number): number {
  return Math.round(value * 1000) / 10;
}

async function readDiskUsage(): Promise<ResourceReport["disk"]> {
  try {
    const fs = await import("node:fs/promises");
    const statfs = (fs as unknown as { statfs?: (path: string) => Promise<{ bsize: number | bigint; blocks: number | bigint; bavail: number | bigint }> }).statfs;
    if (typeof statfs !== "function") return null;
    const target = process.env.UPLOADS_DIR?.trim() || process.cwd();
    const info = await statfs(target);
    const blockSize = Number(info.bsize);
    const totalBytes = blockSize * Number(info.blocks);
    const freeBytes = blockSize * Number(info.bavail);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return { target, totalBytes, freeBytes, usedBytes, usedPercent: pct(usedBytes / totalBytes) };
  } catch {
    return null;
  }
}

/**
 * Build the resource + improvement report. Never throws: each contributing
 * signal degrades to "unavailable" rather than breaking the page.
 */
export async function getResourceReport(): Promise<ResourceReport> {
  const generatedAt = new Date().toISOString();
  const usage = process.memoryUsage();
  const constrained = (process as unknown as { constrainedMemory?: () => number }).constrainedMemory;
  const available = (process as unknown as { availableMemory?: () => number }).availableMemory;
  const limitBytes = typeof constrained === "function" ? boundedMemory(constrained.call(process)) : null;
  const availableBytes = typeof available === "function" ? boundedMemory(available.call(process)) : null;
  const heapUsePercent = usage.heapTotal > 0 ? pct(usage.heapUsed / usage.heapTotal) : 0;
  const heapStatistics = readHeapStatistics();
  const heapLimitBytes = heapStatistics ? boundedMemory(heapStatistics.heap_size_limit) : null;
  const heapLimitUsePercent = heapLimitBytes && heapLimitBytes > 0 ? pct(usage.heapUsed / heapLimitBytes) : null;
  const limitUsePercent = limitBytes && limitBytes > 0 ? pct(usage.rss / limitBytes) : null;

  const disk = await readDiskUsage();
  const improvements: Improvement[] = [];
  const notes: string[] = [];

  // Heap pressure is judged against the configured V8 heap ceiling, never against
  // the committed heap (`heapTotal`): a freshly-grown committed heap can sit at a
  // high share of itself with plenty of headroom left, so a bare heap ratio is
  // not a fatal signal. Only container pressure (RSS vs the cgroup limit) is
  // severe enough to be critical; heap pressure alone is at most a warning.
  if (heapLimitUsePercent != null) {
    if (heapLimitUsePercent >= 90) {
      improvements.push({
        tier: "major", area: "Memory", title: "Node.js heap is close to its configured limit",
        detail: `Heap used is ${heapLimitUsePercent}% of the ${formatBytes(heapLimitBytes ?? 0)} configured V8 heap limit (${formatBytes(usage.heapUsed)} used).`,
        recommendation: "Raise the configured heap limit or reduce steady-state heap use before V8 aborts with an out-of-memory error; capture a heap profile during a maintenance window.",
      });
    } else if (heapLimitUsePercent >= 75) {
      improvements.push({
        tier: "minor", area: "Memory", title: "Node.js heap use is rising toward its configured limit",
        detail: `Heap used is ${heapLimitUsePercent}% of the ${formatBytes(heapLimitBytes ?? 0)} configured V8 heap limit.`,
        recommendation: "Monitor the heap-growth trend; no action unless it keeps climbing toward the limit.",
      });
    }
  } else {
    notes.push("The configured V8 heap limit is unavailable on this runtime, so heap pressure is not measured against a ceiling.");
  }

  if (limitUsePercent != null) {
    if (limitUsePercent >= 85) {
      improvements.push({
        tier: "critical", area: "Memory", title: "Process memory is close to the container limit",
        detail: `Resident memory is ${limitUsePercent}% of the ${Math.round((limitBytes ?? 0) / 1024 / 1024)} MB memory limit.`,
        recommendation: "Raise the container/server memory or reduce steady-state memory immediately; approaching the limit risks an OOM kill.",
      });
    } else if (limitUsePercent >= 70) {
      improvements.push({
        tier: "major", area: "Memory", title: "Process memory is a large share of the container limit",
        detail: `Resident memory is ${limitUsePercent}% of the ${Math.round((limitBytes ?? 0) / 1024 / 1024)} MB memory limit.`,
        recommendation: "Keep headroom free for load spikes; review the largest allocations if this keeps rising.",
      });
    }
  }

  const database = await readDatabasePool();
  if (database.connected && database.connectionLimit != null && database.activeConnections != null && database.activeConnections >= database.connectionLimit) {
    improvements.push({
      tier: "major", area: "Database", title: "Database connection pool is saturated",
      detail: `All ${database.connectionLimit} pooled connection${database.connectionLimit === 1 ? "" : "s"} are in use${database.queuedRequests ? ` with ${database.queuedRequests} request(s) queued` : ""}.`,
      recommendation: "Raise DB_POOL_CONNECTION_LIMIT only after confirming the database can accept more connections; otherwise reduce concurrent long-running queries and payload sizes.",
    });
  }

  if (disk) {
    if (disk.usedPercent >= 90) {
      improvements.push({
        tier: "critical", area: "Disk", title: "Disk volume is nearly full",
        detail: `${disk.target} is ${disk.usedPercent}% used (${formatBytes(disk.freeBytes)} free).`,
        recommendation: "Free space or expand the volume now — a full disk stops writes and the database.",
      });
    } else if (disk.usedPercent >= 75) {
      improvements.push({
        tier: "major", area: "Disk", title: "Disk volume usage is high",
        detail: `${disk.target} is ${disk.usedPercent}% used (${formatBytes(disk.freeBytes)} free).`,
        recommendation: "Review uploaded files, logs and retained exports, and plan a cleanup or expansion.",
      });
    } else if (disk.usedPercent >= 60) {
      improvements.push({
        tier: "minor", area: "Disk", title: "Disk volume usage is rising",
        detail: `${disk.target} is ${disk.usedPercent}% used.`,
        recommendation: "Keep an eye on growth; no action needed yet.",
      });
    }
  } else {
    notes.push("Disk usage is unavailable on this host (statfs not supported for the uploads volume).");
  }

  try {
    const incidents = await getIncidentSummary();
    if (incidents.fatal > 0) {
      improvements.push({
        tier: incidents.last24h > 0 ? "critical" : "major", area: "Crashes", title: `${incidents.fatal} fatal incident${incidents.fatal === 1 ? "" : "s"} recorded`,
        detail: `${incidents.fatal} fatal and ${incidents.error} error incidents are retained (${incidents.last24h} in the last 24 hours).`,
        recommendation: "Open Crash & Incident Diagnostics, read the recorded cause and stack for the most recent fatal incident, and fix it before it recurs.",
      });
    } else if (incidents.last24h > 0) {
      improvements.push({
        tier: incidents.last24h >= 5 ? "major" : "minor", area: "Crashes", title: `${incidents.last24h} incident${incidents.last24h === 1 ? "" : "s"} in the last 24 hours`,
        detail: "No fatal incident is retained, but errors are recurring.",
        recommendation: "Review the incident log and confirm whether the errors share a single root cause.",
      });
    }
    if (!incidents.total && incidents.total === 0) notes.push("No incidents are recorded yet.");
  } catch {
    notes.push("Incident history is unavailable (database not reachable).");
  }

  try {
    const apiHealth = await getApiHealthReport();
    for (const provider of apiHealth.providers) {
      if (provider.passiveStatus === "fail") {
        improvements.push({
          tier: provider.kind === "market-data" ? "critical" : "major", area: "APIs", title: `${provider.label} is not working`,
          detail: provider.errorCode ? `Last probe failed with ${provider.errorCode}.` : "The last probe failed.",
          recommendation: provider.recommendation,
        });
      } else if (provider.passiveStatus === "degraded") {
        improvements.push({
          tier: "major", area: "APIs", title: `${provider.label} is degraded`,
          detail: "The provider returned a rate-limit or error status.",
          recommendation: provider.recommendation,
        });
      } else if (provider.resourceClass === "high") {
        improvements.push({
          tier: "minor", area: "APIs", title: `${provider.label} is pulling high resources`,
          detail: `Measured ${provider.latencyMs ?? "?"} ms and ${provider.responseBytes ?? "?"} bytes on the last probe.`,
          recommendation: provider.recommendation,
        });
      }
    }
    if (!apiHealth.sourceAvailable) notes.push("API health history is unavailable (additive table not present).");
  } catch {
    notes.push("API health could not be evaluated.");
  }

  try {
    const workerHealth = await getWorkerHealthSummary();
    const failing = workerHealth.workers.filter((worker) => worker.isCurrentInstance && worker.status !== "healthy" && worker.status !== "running");
    for (const worker of failing.slice(0, 10)) {
      improvements.push({
        tier: worker.status === "degraded" ? "major" : "minor", area: "Workers", title: `${worker.displayName} is ${String(worker.status).replace(/_/g, " ")}`,
        detail: worker.lastError || "The worker heartbeat is outside its expected window.",
        recommendation: "Inspect the worker error and the Worker Health page, then correct the underlying cause before relying on recovery actions.",
      });
    }
  } catch {
    notes.push("Worker health could not be evaluated.");
  }

  improvements.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  const improvementSummary = {
    critical: improvements.filter((item) => item.tier === "critical").length,
    major: improvements.filter((item) => item.tier === "major").length,
    minor: improvements.filter((item) => item.tier === "minor").length,
    total: improvements.length,
  };

  return {
    sourceAvailable: true,
    generatedAt,
    memory: {
      rssBytes: usage.rss,
      heapTotalBytes: usage.heapTotal,
      heapUsedBytes: usage.heapUsed,
      heapUsePercent,
      heapLimitBytes,
      heapLimitUsePercent,
      externalBytes: usage.external,
      arrayBuffersBytes: usage.arrayBuffers,
      limitBytes,
      availableBytes,
      limitUsePercent,
    },
    database,
    disk,
    improvementSummary,
    improvements,
    notes,
  };
}

/** Read the configured V8 heap limit, or null when the runtime does not expose it. */
function readHeapStatistics(): ReturnType<typeof getHeapStatistics> | null {
  try {
    return getHeapStatistics();
  } catch {
    return null;
  }
}

/**
 * Read the shared MySQL pool for diagnostics. The pool is a singleton created in
 * `../db`; the module is imported lazily so this read-only report never pulls the
 * database module graph into a process that has no database configured.
 */
async function readDatabasePool(): Promise<ResourceReport["database"]> {
  const empty = { connected: false, connectionLimit: null, totalConnections: null, idleConnections: null, activeConnections: null, queuedRequests: null };
  try {
    const { getDbPoolStats } = await import("../db");
    const stats = getDbPoolStats();
    return stats ? { connected: true, ...stats } : empty;
  } catch {
    return empty;
  }
}

function boundedMemory(value: number): number | null {
  return Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER ? value : null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Math.round((bytes / Math.pow(1024, index)) * 10) / 10} ${units[index]}`;
}
