import "dotenv/config";
// Journal an import-time failure to disk before any other module evaluates.
import "./incident-hooks";
import { closeDbPool, getDb } from "../db";
import { runMonitoredWorkerCycle, sanitizeWorkerErrorMessage, waitForMonitoredWorkerCycles } from "./workerHealth";
import { registerWorkerInterval, stopWorkerIntervals } from "./workerRuntime";
import { TENDER_INGEST_INTERVAL_MS, runTenderIngestCycle } from "../modules/tender/ingest";

/**
 * Dedicated Tender Bid ingestion worker.
 *
 * Runs the tender ingestion cycle in its own process so a large or hostile source
 * response can never grow the API server's heap. It pairs with
 * `TENDER_INGEST_WORKER=dedicated` on the web process, which stops that process
 * from scheduling the same worker: one process fetches provider pages, the other
 * serves requests.
 *
 * The cycle is single-flight (`runMonitoredWorkerCycle`) and writes the shared
 * `worker_health_registry`, so the Tender desk's ingestion status is identical
 * whether the worker runs here or in the web process. Start it with
 * `pnpm worker:tender` (after `pnpm build`).
 */
async function main(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[TenderIngest] DATABASE_URL is not configured; the dedicated tender worker cannot start.");
    process.exitCode = 1;
    return;
  }

  const runTenderIngest = () => runMonitoredWorkerCycle("tender-ingest", () => runTenderIngestCycle(), {
    degradedWhen: (result) => result.sourcesFailed > 0,
    degradedMessage: (result) => `${result.sourcesFailed} tender source(s) failed during ingestion`,
  });

  const timer = registerWorkerInterval(() => {
    void runTenderIngest()
      .then((result) => { if (result.tendersUpserted || result.sourcesFailed) console.log("[TenderIngest] cycle", result); })
      .catch((error) => console.error("[TenderIngest]", sanitizeWorkerErrorMessage(error)));
  }, TENDER_INGEST_INTERVAL_MS);
  timer.unref();

  // The worker interval is unref'd (matching the in-process worker), so hold the
  // process open explicitly while the weekly schedule and any in-flight cycle run.
  const keepAlive = setInterval(() => undefined, 1 << 30);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info("[TenderIngest] Dedicated worker shutting down", { signal });
    clearInterval(keepAlive);
    stopWorkerIntervals();
    try {
      await waitForMonitoredWorkerCycles();
      await closeDbPool();
    } catch (error) {
      console.error("[TenderIngest] Dedicated worker shutdown failed", sanitizeWorkerErrorMessage(error));
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  console.log("[TenderIngest] Dedicated tender ingestion worker started", { intervalMs: TENDER_INGEST_INTERVAL_MS });
  await runTenderIngest().catch((error) => console.error("[TenderIngest]", sanitizeWorkerErrorMessage(error)));
}

void main().catch((error) => {
  console.error("[TenderIngest] Dedicated worker failed to start", sanitizeWorkerErrorMessage(error));
  process.exitCode = 1;
});
