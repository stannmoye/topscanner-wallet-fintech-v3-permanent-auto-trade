import { TRPCError } from "@trpc/server";
import { configuredAuthRateLimitStore, type AuthRateLimitStore } from "./authRateLimit";

/**
 * Item 49: a generous, per-administrator-account limiter for administrator
 * MUTATIONS on the tRPC surface, which previously had no limit at all.
 *
 * Design constraints:
 * - Keyed by the signed-in administrator's account id, never by IP, so a shared
 *   or NATed address can never throttle a legitimate administrator and a second
 *   administrator is unaffected by a runaway client.
 * - Deliberately far above human interaction rates (300 actions / 5 minutes). It
 *   exists to stop runaway or abusive automation, not to constrain normal console
 *   use, so it can never lock the administrator out of everyday operations.
 * - Reads (queries) are never limited: the console polls them continuously.
 * - If a shared rate-limit store is configured but unavailable, the request is
 *   allowed (fail-open) with a bounded warning, because blocking an already
 *   authenticated administrator would be a lockout. Cross-instance enforcement
 *   resumes automatically once the store recovers.
 */

export const ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS = 5 * 60_000;
export const ADMIN_MUTATION_RATE_LIMIT_MAX = 300;

type Bucket = { count: number; resetAt: number };

export type AdminMutationRateLimiterOptions = {
  windowMs?: number;
  max?: number;
  store?: AuthRateLimitStore;
  now?: () => number;
};

function tooManyRequests(): TRPCError {
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many administrator actions in a short period. Please wait a moment and try again.",
  });
}

export function createAdminMutationRateLimiter(options: AdminMutationRateLimiterOptions = {}) {
  const windowMs = options.windowMs ?? ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS;
  const max = options.max ?? ADMIN_MUTATION_RATE_LIMIT_MAX;
  const store = options.store;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return async function consume(adminUserId: number): Promise<void> {
    const key = `admin-mutation:${adminUserId}`;
    if (store) {
      let result: { count: number; resetMs: number };
      try {
        result = await store.consume(key, windowMs);
      } catch (error) {
        // Fail open so a rate-limit store outage can never lock the administrator
        // out of the console. The event is logged (bounded) for monitoring.
        console.warn(
          "[AdminRateLimit] Shared store unavailable; allowing administrator mutation",
          error instanceof Error ? error.name : "UnknownError",
        );
        return;
      }
      if (result.count > max) throw tooManyRequests();
      return;
    }

    const current = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    // Bound memory if a very large number of administrator accounts is active in
    // one window; drop the oldest entry rather than growing without limit.
    if (buckets.size > 10_000) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined && oldest !== key) buckets.delete(oldest);
    }
    if (bucket.count > max) throw tooManyRequests();
  };
}

export const enforceAdminMutationRateLimit = createAdminMutationRateLimiter({
  store: configuredAuthRateLimitStore,
});
