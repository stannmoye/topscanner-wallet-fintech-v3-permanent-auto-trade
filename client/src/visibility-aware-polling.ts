// Item 38: live customer polling must be visibility-aware and back off on
// errors without ever slowing down while the tab is visible. This module is the
// single source of truth for those cadences so every query uses the same rules.

/** Upper bound for the exponential back-off applied after consecutive failures. */
export const POLL_BACKOFF_MAX_INTERVAL_MS = 60_000;

/** Balance ribbon: the fastest customer poll (1.5 s) while the tab is visible. */
export const CUSTOMER_BALANCE_RIBBON_POLL_INTERVAL_MS = 1_500;
/** Primary pop-up/opportunity feed (3 s). */
export const CUSTOMER_OPPORTUNITY_POLL_INTERVAL_MS = 3_000;
/** Wallet/intelligence balance polls (5 s). */
export const CUSTOMER_BALANCE_POLL_INTERVAL_MS = 5_000;
/** Transaction console feed (2 s). */
export const CUSTOMER_CONSOLE_POLL_INTERVAL_MS = 2_000;
/** Transaction console activity pulse (1.8 s). */
export const CUSTOMER_CONSOLE_PULSE_INTERVAL_MS = 1_800;

/**
 * True while the document is visible (or when there is no document, e.g. during
 * server rendering or a headless test). Hidden tabs are paused so background
 * polling does not burn API quota.
 */
export function isPollingDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/**
 * Exponential back-off (base, base*2, base*4, …) capped at maxMs. A successful
 * fetch resets the query's fetchFailureCount to 0, which restores the base rate
 * on its own.
 */
export function pollingBackoffInterval(
  baseMs: number,
  failureCount: number,
  maxMs: number = POLL_BACKOFF_MAX_INTERVAL_MS,
): number {
  const base = Number.isFinite(baseMs) ? Math.max(1, Math.floor(baseMs)) : 1;
  const max = Number.isFinite(maxMs) ? Math.max(base, Math.floor(maxMs)) : POLL_BACKOFF_MAX_INTERVAL_MS;
  const failures = Number.isFinite(failureCount) ? Math.max(0, Math.floor(failureCount)) : 0;
  const exponent = Math.min(failures, 8);
  return Math.min(base * 2 ** exponent, max);
}

/**
 * The `refetchInterval` a TanStack Query should use: `false` (no polling) while
 * the tab is hidden, otherwise the back-off interval. Pair this with a
 * `visibilitychange` listener that refetches active queries on return so the
 * tab is instantly live again.
 */
export function visibilityAwareRefetchInterval(
  baseMs: number,
  failureCount: number,
  maxMs: number = POLL_BACKOFF_MAX_INTERVAL_MS,
): number | false {
  if (!isPollingDocumentVisible()) return false;
  return pollingBackoffInterval(baseMs, failureCount, maxMs);
}
