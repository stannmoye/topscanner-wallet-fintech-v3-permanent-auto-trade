function timestampMilliseconds(value: unknown): number | null {
  let milliseconds: number;
  if (value instanceof Date) milliseconds = value.getTime();
  else if (typeof value === "number") milliseconds = value;
  else if (typeof value === "string" && value.trim()) milliseconds = Date.parse(value);
  else return null;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/**
 * A countdown must never trust the browser's wall clock: a customer can move
 * their system clock and would otherwise skip or extend a live opportunity.
 * We therefore anchor once to the server-issued time (from the feed) together
 * with the monotonic `performance.now()` reading taken at that instant, and
 * derive "now" from the elapsed monotonic time only. Wall-clock changes have
 * no effect on the result.
 */
export interface ServerClockAnchor {
  serverTimeMilliseconds: number;
  performanceMilliseconds: number;
}

export function createServerClockAnchor(
  serverTime: unknown,
  performanceNow: number,
): ServerClockAnchor | null {
  const serverTimeMilliseconds = timestampMilliseconds(serverTime);
  if (serverTimeMilliseconds === null || !Number.isFinite(performanceNow)) return null;
  return { serverTimeMilliseconds, performanceMilliseconds: performanceNow };
}

export function serverNowMilliseconds(
  anchor: ServerClockAnchor | null,
  performanceNow: number,
): number | null {
  if (!anchor || !Number.isFinite(performanceNow)) return null;
  return anchor.serverTimeMilliseconds + (performanceNow - anchor.performanceMilliseconds);
}

export function remainingOpportunityMillisecondsFromAnchor(
  closesAt: unknown,
  anchor: ServerClockAnchor | null,
  performanceNow: number,
): number | null {
  const now = serverNowMilliseconds(anchor, performanceNow);
  if (now === null) return null;
  return remainingOpportunityMilliseconds(closesAt, now, 0);
}

export function remainingOpportunityMilliseconds(
  closesAt: unknown,
  nowMilliseconds: number,
  serverClockOffsetMilliseconds = 0,
): number | null {
  const closesAtMilliseconds = timestampMilliseconds(closesAt);
  if (closesAtMilliseconds === null || !Number.isFinite(nowMilliseconds) || !Number.isFinite(serverClockOffsetMilliseconds)) return null;
  return Math.max(0, closesAtMilliseconds - (nowMilliseconds + serverClockOffsetMilliseconds));
}

export function remainingOpportunitySeconds(
  closesAt: unknown,
  nowMilliseconds: number,
  serverClockOffsetMilliseconds = 0,
): number | null {
  const remaining = remainingOpportunityMilliseconds(closesAt, nowMilliseconds, serverClockOffsetMilliseconds);
  return remaining === null ? null : Math.ceil(remaining / 1_000);
}
