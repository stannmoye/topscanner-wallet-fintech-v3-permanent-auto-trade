import { sql } from "drizzle-orm";
import { getDb, getRawDbPool } from "../db";

/**
 * Outbound API / provider health.
 *
 * The administrator console previously showed a hard-coded provider list. This
 * module replaces that with a real registry of the outbound services the
 * platform calls, their configuration state, and the result of an on-demand
 * reachability probe (latency, response size, HTTP status). Latest results are
 * persisted additively in `api_health_checks` so the console can show which
 * providers work, which fail, which pull too much resource and how to reduce it.
 *
 * Passive mode never makes an outbound call. An on-demand probe is only started
 * by an explicit administrator action.
 */

export const API_HEALTH_TABLE = "api_health_checks";
export const API_HEALTH_STALE_MS = 24 * 60 * 60 * 1000;
export const API_PROBE_TIMEOUT_MS = 8_000;
export const API_PROBE_COOLDOWN_MS = 5_000;
const MAX_READ_BYTES = 2_000_000;

export type ApiProbeStatus = "ok" | "degraded" | "fail" | "not_configured" | "not_tested" | "stale";
export type ApiResourceClass = "low" | "moderate" | "high";
export type ApiProbeMode = "data" | "reachability" | "none";

type ProviderDefinition = {
  id: string;
  label: string;
  category: string;
  kind: string;
  probeMode: ApiProbeMode;
  /** Static endpoint, or a resolver for endpoints composed from environment variables. */
  endpoint?: string;
  resolveEndpoint?: () => string | null;
  /** Every key listed must be present for the provider to count as configured. */
  configKeys: string[];
  /** Providers that are always available because their endpoint is built into the code. */
  builtIn?: boolean;
  /** A dynamic configuration check (for providers configured through the admin portal, not env). */
  configCheck?: "email";
  timeoutMs: number;
  note: string;
  reductionNote: string;
};

/** Single source of truth for the outbound providers this platform uses. */
export const API_PROVIDER_REGISTRY: ProviderDefinition[] = [
  {
    id: "nasdaq-screener",
    label: "Nasdaq screener (market data)",
    category: "Market data",
    kind: "market-data",
    probeMode: "data",
    endpoint: "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=1&offset=0",
    configKeys: [],
    builtIn: true,
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Most-active stock screener used to build market-driven opportunities.",
    reductionNote: "Request only the rows in use and keep the most-active limit small; cache the snapshot for the refresh interval instead of re-pulling on every tick.",
  },
  {
    id: "frankfurter-ecb",
    label: "Frankfurter / ECB reference FX",
    category: "Market data",
    kind: "market-data",
    probeMode: "data",
    endpoint: "https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,GBP",
    configKeys: [],
    builtIn: true,
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Primary fiat FX feed (ECB reference rates). A stale or missing rate fails the conversion closed.",
    reductionNote: "ECB publishes at most once per TARGET business day, so poll at most a few times a day rather than per tick.",
  },
  {
    id: "open-er-api",
    label: "open.er-api (FX fallback)",
    category: "Market data",
    kind: "market-data",
    probeMode: "data",
    endpoint: "https://open.er-api.com/v6/latest/USD",
    configKeys: [],
    builtIn: true,
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Daily fallback FX feed used when the ECB reference feed has no current rate.",
    reductionNote: "Fallback only — call it solely when the primary feed is unavailable, not on a fixed high-frequency timer.",
  },
  {
    id: "coingecko",
    label: "CoinGecko (crypto prices)",
    category: "Market data",
    kind: "market-data",
    probeMode: "data",
    endpoint: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd",
    configKeys: [],
    builtIn: true,
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Crypto spot prices used for crypto wallet valuation.",
    reductionNote: "The public endpoint is rate-limited; request only the tokens in use and cache for at least the crypto freshness window.",
  },
  {
    id: "ai-llm",
    label: "AI assistant (LLM)",
    category: "AI",
    kind: "ai",
    probeMode: "reachability",
    resolveEndpoint: () => process.env.AI_API_BASE_URL?.trim() || null,
    configKeys: ["AI_API_BASE_URL", "AI_API_KEY"],
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "OpenAI-compatible language model endpoint used by assistant features.",
    reductionNote: "Apply request timeouts and small max-token limits, and cache or debounce identical prompts to avoid repeated billable calls.",
  },
  {
    id: "image-api",
    label: "Image generation API",
    category: "AI",
    kind: "media",
    probeMode: "reachability",
    resolveEndpoint: () => process.env.IMAGE_API_BASE_URL?.trim() || null,
    configKeys: ["IMAGE_API_BASE_URL", "IMAGE_API_KEY"],
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Image generation endpoint used for visual assets.",
    reductionNote: "Generate on demand and cache the resulting asset; avoid regenerating an image that already exists.",
  },
  {
    id: "transcription-api",
    label: "Transcription API",
    category: "AI",
    kind: "media",
    probeMode: "reachability",
    resolveEndpoint: () => process.env.TRANSCRIPTION_API_BASE_URL?.trim() || null,
    configKeys: ["TRANSCRIPTION_API_BASE_URL", "TRANSCRIPTION_API_KEY"],
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Speech-to-text endpoint used for audio transcription.",
    reductionNote: "Upload the smallest acceptable audio and avoid re-transcribing unchanged media.",
  },
  {
    id: "google-maps",
    label: "Google Maps (geocoding)",
    category: "Maps",
    kind: "maps",
    probeMode: "data",
    resolveEndpoint: () => {
      const key = process.env.GOOGLE_MAPS_SERVER_KEY?.trim();
      return key ? `https://maps.googleapis.com/maps/api/geocode/json?address=Arbitrade&key=${encodeURIComponent(key)}` : null;
    },
    configKeys: ["GOOGLE_MAPS_SERVER_KEY"],
    timeoutMs: API_PROBE_TIMEOUT_MS,
    note: "Server-side geocoding key used for location features.",
    reductionNote: "Geocode each address once and store the result instead of geocoding it again on every render.",
  },
  {
    id: "smtp-email",
    label: "Email delivery (SMTP / provider)",
    category: "Communications",
    kind: "email",
    probeMode: "none",
    configKeys: [],
    configCheck: "email",
    timeoutMs: 0,
    note: "Transactional email transport configured in the admin portal. Credentials are never sent from a diagnostic probe.",
    reductionNote: "Batch and throttle non-urgent mail so the transport and provider quota are not saturated.",
  },
];

export type ApiProbeResult = {
  status: ApiProbeStatus;
  statusCode: number | null;
  latencyMs: number | null;
  responseBytes: number | null;
  resourceClass: ApiResourceClass | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ApiProviderReport = {
  id: string;
  label: string;
  category: string;
  kind: string;
  endpoint: string | null;
  probeMode: ApiProbeMode;
  probeSupported: boolean;
  requiresConfig: boolean;
  configured: boolean;
  passiveStatus: ApiProbeStatus;
  lastCheckedAt: string | null;
  lastStatus: ApiProbeStatus | null;
  statusCode: number | null;
  latencyMs: number | null;
  responseBytes: number | null;
  resourceClass: ApiResourceClass | null;
  errorCode: string | null;
  errorMessage: string | null;
  note: string;
  recommendation: string;
};

export type ApiHealthReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  staleAfterMs: number;
  summary: { total: number; working: number; failing: number; notConfigured: number; notTested: number; highResource: number };
  providers: ApiProviderReport[];
  recommendations: string[];
};

const CREATE_API_HEALTH_TABLE_SQL = `CREATE TABLE IF NOT EXISTS api_health_checks (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  providerId VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  statusCode INT NULL,
  latencyMs INT NULL,
  responseBytes INT NULL,
  resourceClass VARCHAR(16) NULL,
  errorCode VARCHAR(64) NULL,
  errorMessage VARCHAR(500) NULL,
  checkedAt DATETIME(3) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY api_health_provider_uidx (providerId),
  INDEX api_health_checked_idx (checkedAt)
) ENGINE=InnoDB`;

function utcStamp(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR";
}

export function getApiProvider(id: string): ProviderDefinition | undefined {
  return API_PROVIDER_REGISTRY.find((provider) => provider.id === id);
}

function configKey(input: unknown): string {
  return String(input ?? "").replace(/[^A-Z0-9_]/gi, "").slice(0, 64) || "PROBE_ERROR";
}

/** Classify how much resource a probe consumed, from the measured latency and payload size. */
export function classifyProbeResource(bytes: number | null, latencyMs: number | null): ApiResourceClass | null {
  if (bytes == null && latencyMs == null) return null;
  if ((bytes != null && bytes > 512 * 1024) || (latencyMs != null && latencyMs > 4_000)) return "high";
  if ((bytes != null && bytes > 128 * 1024) || (latencyMs != null && latencyMs > 1_500)) return "moderate";
  return "low";
}

/** Derive the probe status from the HTTP result for the provider's probe mode. */
export function deriveProbeStatus(mode: ApiProbeMode, statusCode: number | null, networkError: boolean): ApiProbeStatus {
  if (networkError) return "fail";
  if (statusCode == null) return "fail";
  if (mode === "reachability") return "ok";
  if (statusCode >= 200 && statusCode < 400) return "ok";
  if (statusCode === 429) return "degraded";
  return "fail";
}

export function summarizeApiHealth(providers: ApiProviderReport[]): ApiHealthReport["summary"] {
  return {
    total: providers.length,
    working: providers.filter((provider) => provider.passiveStatus === "ok").length,
    failing: providers.filter((provider) => provider.passiveStatus === "fail" || provider.passiveStatus === "degraded").length,
    notConfigured: providers.filter((provider) => provider.passiveStatus === "not_configured").length,
    notTested: providers.filter((provider) => provider.passiveStatus === "not_tested" || provider.passiveStatus === "stale").length,
    highResource: providers.filter((provider) => provider.resourceClass === "high").length,
  };
}

/** Create the additive API health table when it is missing. Never throws. */
export async function ensureApiHealthSchema(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const pool = await getRawDbPool();
    if (!pool) return;
    const [tables] = await pool.query<any[]>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
      [API_HEALTH_TABLE],
    );
    if (tables.length) return;
    await pool.query(CREATE_API_HEALTH_TABLE_SQL);
    console.log("[ApiHealth] Created api_health_checks for the administrator console.");
  } catch (error) {
    console.error("[ApiHealth] Failed to ensure schema:", error instanceof Error ? error.name : "UnknownError");
  }
}

async function resolveConfigured(definition: ProviderDefinition): Promise<boolean> {
  if (definition.builtIn) return true;
  if (definition.configCheck === "email") {
    try {
      const mod = await import("../email");
      return Boolean(mod.isEmailDeliveryConfigured());
    } catch {
      return false;
    }
  }
  if (definition.configKeys.length === 0) return true;
  return definition.configKeys.every((key) => Boolean(process.env[key]?.trim()));
}

function resolveEndpoint(definition: ProviderDefinition): string | null {
  if (definition.resolveEndpoint) return definition.resolveEndpoint();
  return definition.endpoint ?? null;
}

async function readProviderRows(): Promise<Record<string, Record<string, unknown>>> {
  const map: Record<string, Record<string, unknown>> = {};
  try {
    if (!process.env.DATABASE_URL) return map;
    const db = await getDb();
    if (!db) return map;
    const result = await db.execute(sql`SELECT
        providerId,status,statusCode,latencyMs,responseBytes,resourceClass,errorCode,errorMessage,
        DATE_FORMAT(checkedAt,'%Y-%m-%dT%H:%i:%s.000Z') AS checkedAt
      FROM api_health_checks`);
    const rows = ((result as unknown as [Record<string, unknown>[], unknown])[0] || []) as Record<string, unknown>[];
    for (const row of rows) map[String(row.providerId ?? "")] = row;
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[ApiHealth] Failed to read checks:", error instanceof Error ? error.name : "UnknownError");
  }
  return map;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPublicProvider(definition: ProviderDefinition, configured: boolean, row: Record<string, unknown> | undefined, nowMs: number): ApiProviderReport {
  const endpoint = resolveEndpoint(definition);
  const lastStatus = row ? (String(row.status ?? "") as ApiProbeStatus) : null;
  const lastCheckedAt = row?.checkedAt == null ? null : String(row.checkedAt);
  const stale = lastCheckedAt ? nowMs - new Date(lastCheckedAt).getTime() > API_HEALTH_STALE_MS : false;
  const passiveStatus: ApiProbeStatus = !configured
    ? "not_configured"
    : !row
      ? "not_tested"
      : stale
        ? "stale"
        : lastStatus ?? "not_tested";
  const resourceClass = row?.resourceClass == null ? null : (String(row.resourceClass) as ApiResourceClass);
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    kind: definition.kind,
    endpoint,
    probeMode: definition.probeMode,
    probeSupported: definition.probeMode !== "none" && Boolean(endpoint) && configured,
    requiresConfig: !definition.builtIn,
    configured,
    passiveStatus,
    lastCheckedAt,
    lastStatus,
    statusCode: numberOrNull(row?.statusCode),
    latencyMs: numberOrNull(row?.latencyMs),
    responseBytes: numberOrNull(row?.responseBytes),
    resourceClass,
    errorCode: row?.errorCode == null ? null : String(row.errorCode),
    errorMessage: row?.errorMessage == null ? null : String(row.errorMessage),
    note: definition.note,
    recommendation: definition.reductionNote,
  };
}

/** Build the passive API health report (no outbound calls). */
export async function getApiHealthReport(): Promise<ApiHealthReport> {
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const base: ApiHealthReport = {
    sourceAvailable: true,
    generatedAt,
    staleAfterMs: API_HEALTH_STALE_MS,
    summary: { total: API_PROVIDER_REGISTRY.length, working: 0, failing: 0, notConfigured: 0, notTested: 0, highResource: 0 },
    providers: [],
    recommendations: [],
  };
  try {
    const rows = await readProviderRows();
    const configuredFlags = await Promise.all(API_PROVIDER_REGISTRY.map((definition) => resolveConfigured(definition)));
    const providers = API_PROVIDER_REGISTRY.map((definition, index) => toPublicProvider(definition, configuredFlags[index], rows[definition.id], nowMs));
    const recommendations: string[] = [];
    for (const provider of providers) {
      if (provider.passiveStatus === "fail") recommendations.push(`${provider.label} is failing${provider.errorCode ? ` (${provider.errorCode})` : ""}. ${provider.recommendation}`);
      else if (provider.passiveStatus === "degraded") recommendations.push(`${provider.label} responded with a rate-limit or error status. ${provider.recommendation}`);
      else if (provider.resourceClass === "high") recommendations.push(`${provider.label} is pulling high resources (${provider.latencyMs ?? "?"} ms, ${provider.responseBytes ?? "?"} bytes). ${provider.recommendation}`);
    }
    return { ...base, providers, summary: summarizeApiHealth(providers), recommendations };
  } catch (error) {
    if (isMissingTableError(error)) return { ...base, sourceAvailable: false };
    console.error("[ApiHealth] Failed to build report:", error instanceof Error ? error.name : "UnknownError");
    return { ...base, sourceAvailable: false };
  }
}

async function persistProbe(providerId: string, result: ApiProbeResult): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`INSERT INTO api_health_checks
        (providerId,status,statusCode,latencyMs,responseBytes,resourceClass,errorCode,errorMessage,checkedAt)
      VALUES (${providerId},${result.status},${result.statusCode},${result.latencyMs},${result.responseBytes},${result.resourceClass},${result.errorCode},${result.errorMessage},${utcStamp(new Date())})
      ON DUPLICATE KEY UPDATE status=VALUES(status),statusCode=VALUES(statusCode),latencyMs=VALUES(latencyMs),responseBytes=VALUES(responseBytes),resourceClass=VALUES(resourceClass),errorCode=VALUES(errorCode),errorMessage=VALUES(errorMessage),checkedAt=VALUES(checkedAt)`);
  } catch (error) {
    if (isMissingTableError(error)) return;
    console.error("[ApiHealth] Failed to persist probe:", error instanceof Error ? error.name : "UnknownError");
  }
}

export type ProbeOutcome = {
  providerId: string;
  ran: boolean;
  reason: string | null;
  result: ApiProbeResult | null;
};

const lastProbeAt = new Map<string, number>();

/**
 * Run one on-demand reachability probe and persist the result. This is the only
 * function that makes an outbound call; it is invoked solely by an explicit
 * administrator action and is rate-limited per provider.
 */
export async function probeApiProvider(providerId: string): Promise<ProbeOutcome> {
  const definition = getApiProvider(providerId);
  if (!definition) return { providerId, ran: false, reason: "Unknown provider.", result: null };
  if (definition.probeMode === "none") return { providerId, ran: false, reason: "This provider is configured through the admin portal; a diagnostic probe does not send credentials.", result: null };
  const configured = await resolveConfigured(definition);
  if (!configured) return { providerId, ran: false, reason: "This provider is not configured, so there is nothing to probe.", result: null };
  const endpoint = resolveEndpoint(definition);
  if (!endpoint) return { providerId, ran: false, reason: "No endpoint is configured for this provider.", result: null };
  const now = Date.now();
  const previous = lastProbeAt.get(providerId) ?? 0;
  if (now - previous < API_PROBE_COOLDOWN_MS) return { providerId, ran: false, reason: "A probe was run moments ago; wait a few seconds before retrying.", result: null };
  lastProbeAt.set(providerId, now);
  const result = await runHttpProbe(endpoint, definition.timeoutMs, definition.probeMode);
  await persistProbe(providerId, result);
  return { providerId, ran: true, reason: null, result };
}

async function runHttpProbe(url: string, timeoutMs: number, mode: ApiProbeMode): Promise<ApiProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Arbitrade-api-health/1.0", Accept: "application/json" },
    });
    const latencyMs = Date.now() - startedAt;
    const headerLength = Number(response.headers.get("content-length") || "0");
    let responseBytes: number | null = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : null;
    if (responseBytes == null || responseBytes <= MAX_READ_BYTES) {
      try {
        const buffer = await response.arrayBuffer();
        responseBytes = buffer.byteLength;
      } catch {
        /* Keep the header-derived length when the body cannot be read. */
      }
    }
    const status = deriveProbeStatus(mode, response.status, false);
    return {
      status,
      statusCode: response.status,
      latencyMs,
      responseBytes,
      resourceClass: classifyProbeResource(responseBytes, latencyMs),
      errorCode: status === "ok" ? null : configKey(`HTTP_${response.status}`),
      errorMessage: status === "ok" ? null : `Provider responded with HTTP ${response.status}.`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const code = (error as { code?: unknown } | null)?.code;
    const name = error instanceof Error ? error.name : "UnknownError";
    const errorCode = name === "AbortError" ? "TIMEOUT" : configKey(code ?? name);
    return {
      status: "fail",
      statusCode: null,
      latencyMs,
      responseBytes: null,
      resourceClass: null,
      errorCode,
      errorMessage: name === "AbortError" ? "The provider did not respond within the timeout." : `The provider could not be reached (${name}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}
