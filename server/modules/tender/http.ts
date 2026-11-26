/**
 * Tender Bid — shared HTTP helpers for the source adapters.
 *
 * Every adapter identifies the platform in its User-Agent (source attribution
 * and rate-limit etiquette, see `docs/TENDER_BID_SPECIFICATION.md` §3.1) and
 * bounds each request with an explicit timeout so one dead portal can never
 * stall the ingestion cycle. Nothing here retries: retry/back-off is the
 * ingestion worker's responsibility so policy lives in one place.
 */

export const TENDER_USER_AGENT = "Arbitrade-tender-ingest/1.0 (+https://arbitrade.example; platform tender ingestion)";

export const TENDER_HTTP_TIMEOUT_MS = 30_000;

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

/** Fetch and parse a JSON document, preserving the untouched payload for `rawJson` auditing. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(url, init);
  return (await response.json()) as T;
}

/** Fetch a text document (CSV, XML, plain text). */
export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetchResponse(url, init);
  return await response.text();
}

/** Fetch a binary document (a ZIP export, for example). */
export async function fetchBytes(url: string, init?: RequestInit): Promise<ArrayBuffer> {
  const response = await fetchResponse(url, init);
  return await response.arrayBuffer();
}
