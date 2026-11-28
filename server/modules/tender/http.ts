/**
 * Tender Bid — shared HTTP helpers for the source adapters.
 *
 * Every adapter identifies the platform in its User-Agent (source attribution
 * and rate-limit etiquette, see `docs/TENDER_BID_SPECIFICATION.md` §3.1) and
 * bounds each request with an explicit timeout so one dead portal can never
 * stall the ingestion cycle, and bounds each response body by size so one
 * oversized or hostile portal response cannot exhaust the process heap. Nothing
 * here retries: retry/back-off is the ingestion worker's responsibility so
 * policy lives in one place.
 */

export const TENDER_USER_AGENT = "Arbitrade-tender-ingest/1.0 (+https://arbitrade.example; platform tender ingestion)";

export const TENDER_HTTP_TIMEOUT_MS = 30_000;

/**
 * Upper bound on a single source response body. A response that declares or
 * streams more than this fails that one source (recorded as `error`), never the
 * cycle — the same fail-closed behaviour as any other unreadable page. This
 * keeps one portal's oversized feed (or a misbehaving endpoint) from growing the
 * ingestion worker's heap without limit.
 *
 * The ceiling is deliberately modest: no legitimate tender page (a JSON array, a
 * CSV export or a compressed bundle) approaches it, and holding a whole response
 * in the worker heap is the single largest per-fetch allocation. A response over
 * the limit fails closed rather than being buffered, and multi-member archives
 * are read one member at a time (see `zip.ts`) so a ZIP bundle never holds every
 * decompressed member in memory at once.
 */
export const TENDER_HTTP_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function withDefaults(init: RequestInit | undefined): RequestInit {
  return {
    ...init,
    headers: { "User-Agent": TENDER_USER_AGENT, Accept: "application/json", ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(TENDER_HTTP_TIMEOUT_MS),
  };
}

/** Fetch a response, throwing a redaction-safe error when the source rejects the request. */
export async function fetchResponse(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, withDefaults(init));
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response;
}

/**
 * Read a response body into a buffer, refusing to grow past
 * `TENDER_HTTP_MAX_RESPONSE_BYTES`. A declared `Content-Length` over the limit is
 * rejected before any bytes are read; otherwise the body is streamed and the
 * running total is checked, so a chunked/undeclared response cannot slip past it.
 */
async function readBoundedBody(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > TENDER_HTTP_MAX_RESPONSE_BYTES) {
    throw new Error(`Tender source response of ${declared} bytes exceeds the ${TENDER_HTTP_MAX_RESPONSE_BYTES}-byte limit`);
  }
  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > TENDER_HTTP_MAX_RESPONSE_BYTES) {
      throw new Error(`Tender source response exceeds the ${TENDER_HTTP_MAX_RESPONSE_BYTES}-byte limit`);
    }
    return buffer;
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > TENDER_HTTP_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Tender source response exceeds the ${TENDER_HTTP_MAX_RESPONSE_BYTES}-byte limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/** Fetch and parse a JSON document, preserving the untouched payload for `rawJson` auditing. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const buffer = await readBoundedBody(await fetchResponse(url, init));
  return JSON.parse(buffer.toString("utf8")) as T;
}

/** Fetch a text document (CSV, XML, plain text). */
export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const buffer = await readBoundedBody(await fetchResponse(url, init));
  return buffer.toString("utf8");
}

/** Fetch a binary document (a ZIP export, for example). */
export async function fetchBytes(url: string, init?: RequestInit): Promise<ArrayBuffer> {
  const buffer = await readBoundedBody(await fetchResponse(url, init));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
