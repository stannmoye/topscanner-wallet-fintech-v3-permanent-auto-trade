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
    heapUsePercent: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    limitBytes: number | null;
    availableBytes: number | null;
    limitUsePercent: number | null;
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
  const limitUsePercent = limitBytes && limitBytes > 0 ? pct(usage.rss / limitBytes) : null;

  const disk = await readDiskUsage();
  const improvements: Improvement[] = [];
  const notes: string[] = [];

  if (heapUsePercent >= 90) {
    improvements.push({
      tier: "critical", area: "Memory", title: "Node.js heap is at or above 90% of its allocation",
      detail: `Heap used ${heapUsePercent}% of ${Math.round(usage.heapTotal / 1024 / 1024)} MB allocated.`,
      recommendation: "Inspect large in-process reads (for example bulk row decodes) and the heap-growth trend before the next restart; capture a heap profile during a maintenance window.",
    });
  } else if (heapUsePercent >= 75) {
    improvements.push({
      tier: "major", area: "Memory", title: "Node.js heap pressure is elevated",
      detail: `Heap used ${heapUsePercent}% of ${Math.round(usage.heapTotal / 1024 / 1024)} MB allocated.`,
      recommendation: "Review recent large queries and payloads; confirm the heap limit is sized to the server before load grows further.",
    });
  } else if (heapUsePercent >= 60) {
    improvements.push({
      tier: "minor", area: "Memory", title: "Node.js heap above the comfort band",
      detail: `Heap used ${heapUsePercent}% of allocated heap.`,
      recommendation: "Monitor the trend; no action unless it keeps climbing toward 75%.",
    });
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
      externalBytes: usage.external,
      arrayBuffersBytes: usage.arrayBuffers,
      limitBytes,
      availableBytes,
      limitUsePercent,
    },
    disk,
    improvementSummary,
    improvements,
    notes,
  };
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
