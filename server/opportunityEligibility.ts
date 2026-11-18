export type CustomerOpportunityEligibilityInput = {
  enabled: boolean;
  allowedAssets: string | null | undefined;
  currency: string;
  symbol?: string | null;
  rewardBps: number;
  minimumRewardBps: number;
};

/**
 * Applies explicit customer opportunity preferences before an offer can be
 * delivered or considered for automatic trading. Empty asset lists fail closed.
 */
export function isCustomerOpportunityAllowed(input: CustomerOpportunityEligibilityInput): boolean {
  if (input.enabled !== true) return false;

  const allowed = new Set(
    String(input.allowedAssets ?? "")
      .split(",")
      .map((asset) => asset.trim().toUpperCase())
      .filter(Boolean),
  );
  const currency = String(input.currency ?? "").trim().toUpperCase();
  const symbol = String(input.symbol ?? "").trim().toUpperCase();

  if (!allowed.size || (!allowed.has(currency) && (!symbol || !allowed.has(symbol)))) {
    return false;
  }

  const rewardBps = Number(input.rewardBps);
  const minimumRewardBps = Number(input.minimumRewardBps);
  if (!Number.isFinite(rewardBps) || !Number.isFinite(minimumRewardBps)) return false;
  return rewardBps >= minimumRewardBps;
}

/** Quiet hours fall back to UTC when no administrator timezone is configured. */
export const DEFAULT_QUIET_HOURS_TIME_ZONE = "UTC";

/**
 * Resolves the admin-configured timezone used for the quiet-hours window.
 * A missing or invalid IANA zone falls back to UTC so the window stays
 * well-defined and never silently tracks the server's local clock.
 */
export function resolveQuietHoursTimeZone(timeZone?: string | null): string {
  const candidate = String(timeZone ?? "").trim();
  if (!candidate) return DEFAULT_QUIET_HOURS_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_QUIET_HOURS_TIME_ZONE;
  }
}

function zonedMinuteOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hours = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minutes = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hours * 60 + minutes;
}

/**
 * Quiet hours suppress popup delivery, not automatic execution of an otherwise
 * eligible opportunity. Equal start/end values mean quiet hours are disabled.
 * The window is evaluated in the admin-configured timezone (UTC when none is
 * configured) instead of the server's local clock, so a customer changing their
 * device clock, or a server-hosted offset, cannot shift the window.
 */
export function isWithinQuietHours(now: Date, start: string, end: string, timeZone: string = DEFAULT_QUIET_HOURS_TIME_ZONE): boolean {
  const toMinutes = (value: string): number => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
    if (!match) return -1;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return -1;
    return hours * 60 + minutes;
  };

  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes < 0 || endMinutes < 0 || startMinutes === endMinutes) return false;

  const currentMinutes = zonedMinuteOfDay(now, resolveQuietHoursTimeZone(timeZone));
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}
