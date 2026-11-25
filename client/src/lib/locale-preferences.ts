/**
 * Persisted "Language & time" preferences that live outside the server session.
 *
 * The timezone choice is stored in `localStorage` so it applies across the
 * whole site and survives sign-out, mirroring the language preference. Reading
 * always falls back to the device timezone so the workspace has a sensible
 * default before the customer picks one.
 */

import { detectLocalTimezone } from "./timezones";

export const TIMEZONE_STORAGE_KEY = "wisebond-timezone";

/** The customer's stored timezone, or the device timezone when none is set. */
export function readStoredTimezone(storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null): string {
  try {
    const value = storage?.getItem(TIMEZONE_STORAGE_KEY);
    if (value && value.trim()) return value.trim();
  } catch {
    /* fall through to detection */
  }
  return detectLocalTimezone();
}

/** Persist the chosen timezone (never throws). */
export function writeStoredTimezone(tz: string, storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    if (tz && tz.trim()) storage?.setItem(TIMEZONE_STORAGE_KEY, tz.trim());
  } catch {
    /* preference becomes session-only when storage is unavailable */
  }
}

/** Clear the stored timezone so the device default is used again (never throws). */
export function clearStoredTimezone(storage: Pick<Storage, "removeItem"> | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    storage?.removeItem(TIMEZONE_STORAGE_KEY);
  } catch {
    /* ignore storage failures */
  }
}
