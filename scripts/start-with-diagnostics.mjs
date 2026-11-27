import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mergeNodeOptions, resolveMemoryFlags } from "./memory-limit.mjs";
import { createIncidentWriter } from "./incident-log.mjs";

// Size the V8 heap to the container/host once, before any phase is spawned, and
// hand the same bound to every child (migrations and the application server).
const memory = resolveMemoryFlags();

const timestamp = () => new Date().toISOString();
const log = (level, event, details = {}) => {
  const safe = { timestamp: timestamp(), level, event, ...details };
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    "[StartupDiagnostics] " + JSON.stringify(safe),
  );
};
const redact = (value) =>
  String(value).replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]");

let activeChild;
let shuttingDown = false;

// Share one boot id between the supervisor and its application child so a crash
// recorded by either side is grouped into the same restart session, and persist
// supervisor-observed crashes (a failed migration phase, an out-of-memory kill or
// an unexpected exit) so the cause survives the platform restart.
const BOOT_ID = process.env.ARBITRADE_BOOT_ID || randomUUID();
process.env.ARBITRADE_BOOT_ID = BOOT_ID;
const SOURCE_REVISION = process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || null;
const incidents = createIncidentWriter({
  bootId: BOOT_ID,
  sourceRevision: SOURCE_REVISION,
  logger: (error) =>
    console.error(
      "[StartupDiagnostics] " +
        JSON.stringify({ timestamp: timestamp(), level: "warn", event: "supervisor-incident-record-failed", message: redact(error?.message || "Unable to record incident") }),
    ),
});
let supervisorCrashRecorded = false;

process.on("uncaughtException", (error) => {
  log("error", "startup-wrapper-uncaught-exception", {
    name: error?.name || "Error",
    code: error?.code,
    message: redact(error?.message || "No error message"),
    stack: redact(error?.stack || "").slice(0, 12000),
  });
  void incidents
    .record({
      severity: "fatal",
      category: "startup_failure",
      processRole: "supervisor",
      eventCode: error?.code ?? error?.name,
      message: error?.message || "Supervisor uncaught exception",
      stack: redact(error?.stack || "").slice(0, 12000),
    })
    .finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  log("error", "startup-wrapper-unhandled-rejection", {
    name: error.name,
    code: error.code,
    message: redact(error.message),
    stack: redact(error.stack || "").slice(0, 12000),
  });
  void incidents
    .record({
      severity: "error",
      category: "startup_failure",
      processRole: "supervisor",
      eventCode: error.code ?? error.name,
      message: error.message || "Supervisor unhandled rejection",
      stack: redact(error.stack || "").slice(0, 12000),
    })
    .finally(() => process.exit(1));
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("warn", "shutdown-signal-received", { signal });
    if (activeChild && !activeChild.killed) activeChild.kill(signal);
    else process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

function runPhase(name, args, extraEnv = {}, requirePersistent = false) {
  return new Promise((resolve, reject) => {
    log("info", "phase-start", { phase: name, command: args[0], args: args.slice(1) });
    let child;
    try {
      child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, memory),
          ...extraEnv,
        },
        stdio: ["inherit", "pipe", "pipe"],
      });
    } catch (error) {
      log("error", "phase-spawn-failed", {
        phase: name,
        name: error?.name || "Error",
        code: error?.code,
        message: redact(error?.message || "Unable to spawn child process"),
        stack: redact(error?.stack || "").slice(0, 12000),
      });
      if (error && typeof error === "object") error.phase = name;
      reject(error);
      return;
    }

    activeChild = child;
    let stderrTail = "";
    for (const [streamName, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
      const lines = createInterface({ input: stream });
      lines.on("line", (line) => {
        const output = redact(line);
        if (streamName === "stderr") stderrTail = `${stderrTail}${output}\n`.slice(-12000);
        (streamName === "stderr" ? process.stderr : process.stdout).write(output + "\n");
      });
    }

    child.on("error", (error) => {
      log("error", "phase-process-error", {
        phase: name,
        name: error?.name || "Error",
        code: error?.code,
        message: redact(error?.message || "Child process error"),
        stack: redact(error?.stack || "").slice(0, 12000),
      });
      activeChild = undefined;
      if (error && typeof error === "object") error.phase = name;
      reject(error);
    });

    child.on("close", async (code, signal) => {
      activeChild = undefined;
      if (requirePersistent && !shuttingDown) {
        log("error", "persistent-process-exited-unexpectedly", { phase: name, exitCode: code, signal: signal || undefined });
        const heapOom = /FATAL ERROR:\s*(?:Reached heap limit|Ineffective mark-compacts near heap limit)|JavaScript heap out of memory/i.test(stderrTail);
        // SIGKILL/SIGABRT can be memory-related, but only label the precise V8
        // heap failure when the child's bounded stderr tail contains its fatal text.
        const suspectedOom = heapOom || signal === "SIGKILL" || signal === "SIGABRT" || code === null;
        await incidents.record({
          severity: "fatal",
          category: suspectedOom ? "resource_exhaustion" : "unexpected_exit",
          processRole: "supervisor",
          eventCode: heapOom ? "V8_HEAP_OOM" : signal || `EXIT_${code ?? "NULL"}`,
          message: heapOom
            ? `Node.js V8 aborted after reaching the JavaScript heap limit in phase "${name}".`
            : `Persistent startup phase "${name}" exited before a shutdown signal was received (exit code ${code ?? "null"}, signal ${signal || "none"}).`,
          stack: stderrTail.slice(-8000) || null,
          context: {
            phase: name,
            exitCode: code,
            signal: signal || null,
            suspectedMemoryLimit: suspectedOom,
            stderrTail: stderrTail.slice(-3000) || null,
          },
          exitCode: code ?? null,
          signal: signal || null,
        });
        supervisorCrashRecorded = true;
        const error = new Error(`Persistent startup phase "${name}" exited before a shutdown signal was received (exit code ${code ?? "null"}).`);
        error.code = "PERSISTENT_PROCESS_EXITED";
        error.phase = name;
        reject(error);
        return;
      }
      if (code === 0 || (requirePersistent && shuttingDown)) {
        log("info", "phase-complete", { phase: name, exitCode: code, shutdownRequested: shuttingDown });
        resolve();
        return;
      }
      const details = { phase: name, exitCode: code, signal: signal || undefined };
      log("error", "phase-failed", details);
      const error = new Error(`Startup phase "${name}" failed (exit code ${code ?? "null"}, signal ${signal || "none"}).`);
      error.code = code === null ? "CHILD_SIGNAL_EXIT" : "CHILD_EXIT_NONZERO";
      error.phase = name;
      reject(error);
    });
  });
}

async function main() {
  log("info", "startup-begin", {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    workingDirectory: process.cwd(),
    portConfigured: Boolean(process.env.PORT),
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    detectedMemoryLimitMB: memory.limitMib,
    maxOldSpaceSizeMB: memory.maxOldSpaceSizeMb,
    maxSemiSpaceSizeMB: memory.maxSemiSpaceSizeMb,
  });

  await runPhase("main-database-migrations", ["scripts/guarded-main-migrate.mjs"]);
  // Apply the idempotent additive worker-schema bridge before checking contracts.
  // Verification alone cannot repair a Blitz database missing a worker-owned table.
  await runPhase("worker-runtime-schema-repair", ["scripts/ensure-worker-runtime-schema.mjs"]);
  // Mining customer/admin routes use additive schema fields outside the Drizzle
  // chain, so reconcile them before exposing the application server.
  await runPhase("mining-current-schema-repair", ["scripts/ensure-mining-current-schema.mjs"]);
  // The administrator visitor-analytics dashboard reads site_analytics_events,
  // which lives outside the Drizzle chain and is created additively here.
  await runPhase("visitor-analytics-schema-repair", ["scripts/ensure-analytics-schema.mjs"]);
  // The customer and admin Privacy Centre menus read tables that live outside
  // the Drizzle chain; create and verify them additively before serving.
  await runPhase("privacy-center-schema-repair", ["scripts/ensure-privacy-schema.mjs"]);
  await runPhase("worker-runtime-schema-preflight", ["scripts/ensure-worker-runtime-schema.mjs", "--verify-only"]);
  await runPhase("application-server", ["--trace-uncaught", "--unhandled-rejections=strict", "dist/index.js"], {}, true);

  log("info", "all-startup-phases-complete", {
    note: "The server process exited normally. A separate listening-ready message should be emitted by the application.",
  });
  await incidents.close();
}

main().catch(async (error) => {
  log("error", "startup-aborted", {
    name: error?.name || "Error",
    code: error?.code,
    message: redact(error?.message || "Startup failed without an error message"),
    stack: redact(error?.stack || "").slice(0, 12000),
  });
  // Persist the boot failure unless the persistent-server crash was already
  // recorded above, so a failed migration or aborted startup is still explained
  // after the platform restarts everything.
  if (!supervisorCrashRecorded) {
    await incidents.record({
      severity: "fatal",
      category: "startup_failure",
      processRole: "supervisor",
      eventCode: error?.code ?? error?.name,
      message: error?.message || "Startup failed without an error message",
      stack: redact(error?.stack || "").slice(0, 12000),
      context: { phase: error?.phase ?? null },
    });
  }
  await incidents.close();
  process.exitCode = 1;
});
