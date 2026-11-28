import mysql, { type Pool } from "mysql2/promise";

export function mysqlConnectionOptions(raw = process.env.DATABASE_URL || "") {
  if (!raw) throw new Error("DATABASE_URL is not configured");
  const url = new URL(raw);
  const sslParam = url.searchParams.get("ssl");
  let ssl: Record<string, unknown> | undefined;
  if (sslParam) {
    try {
      const parsed = JSON.parse(sslParam);
      ssl = parsed === true ? {} : parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      ssl = undefined;
    }
  }
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl,
    timezone: "Z" as const,
  };
}

const DEFAULT_SHARED_POOL_CONNECTION_LIMIT = 8;

function sharedPoolConnectionLimit() {
  const raw = Number(process.env.DB_SHARED_POOL_CONNECTION_LIMIT);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHARED_POOL_CONNECTION_LIMIT;
  return Math.min(Math.floor(raw), 64);
}

/**
 * Shared, lazily-created MySQL connection pool for the Desk/Dossier/Mining
 * modules. Each of those modules used to open a *new* pool (2–3 connections),
 * run a single statement, then `pool.end()` on every call — churning TCP
 * connections plus the pool/connection object graph and MySQL packet buffers on
 * every hot-path request. Reusing one small bounded pool removes that
 * allocation/GC pressure and the connection-setup latency, while keeping the
 * total number of sockets predictable (see
 * docs/MEMORY_AND_RESPONSIVENESS_TUNING_PLAN.md, Stage 2).
 *
 * The pool is created on first use and never re-created; a configured
 * `DATABASE_URL` is required (same contract as before — callers guard on it).
 */
let sharedPool: Pool | undefined;

export function getSharedMysqlPool(): Pool {
  if (!sharedPool) {
    const limit = sharedPoolConnectionLimit();
    sharedPool = mysql.createPool({
      ...mysqlConnectionOptions(),
      waitForConnections: true,
      connectionLimit: limit,
      maxIdle: limit,
      idleTimeout: 60_000,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      connectTimeout: 10_000,
    });
  }
  return sharedPool;
}

/**
 * Close the shared pool during graceful shutdown so no sockets or timers keep
 * the process (or a worker) alive. Safe to call when no pool was ever created,
 * and safe to call more than once.
 */
export async function closeSharedMysqlPool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // Shutdown must never throw because a socket was already gone.
  }
}
