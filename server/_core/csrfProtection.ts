import type { NextFunction, Request, Response } from "express";

/**
 * Item 22: CSRF protection for state-changing requests.
 *
 * The portal authenticates with a `SameSite=Lax` cookie, which already blocks
 * most cross-site writes, but Lax alone is thin: it does not protect against
 * same-site sub-domains, older browsers, or a mis-set attribute, and it is not a
 * defence an auditor can point at. This middleware adds the standard
 * Fetch-metadata + Origin/Referer check on top.
 *
 * Decision order for every unsafe method (anything other than GET/HEAD/OPTIONS):
 *   1. `Sec-Fetch-Site`. A modern browser always sets it and JavaScript cannot
 *      forge it, so `same-origin`/`none` is trusted and anything else is a
 *      cross-site write, which is rejected.
 *   2. `Origin`. When `Sec-Fetch-Site` is absent (older browser), the request
 *      origin must be one of the origins this deployment is served from.
 *   3. `Referer`. Fallback for clients that send neither of the above.
 *   4. No origin evidence at all fails closed: a real browser posting to the app
 *      always provides at least one of the three.
 *
 * The signed worker callbacks the heartbeat scheduler fires at `/api/scheduled/…`
 * originate from the server itself and are authenticated with an HMAC header, so
 * they are exempt (see heartbeat.ts `callbackSignature`).
 */

/** RFC 9110 safe methods never change state and are exempt. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Path prefix reserved for signed worker callbacks (heartbeat / local scheduled jobs). */
export const SCHEDULED_CALLBACK_PATH_PREFIX = "/api/scheduled/";

/** HMAC header the heartbeat worker attaches to its signed callback requests. */
export const SCHEDULED_SIGNATURE_HEADER = "x-arbitrade-scheduled-signature";

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value?.trim() || undefined;
}

/** Normalise an origin or referer URL to its `scheme://host[:port]` origin, or null. */
export function normalizeOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** The host (no scheme) of a normalised origin, or null. */
function originHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export type CsrfRequestInput = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** Origin from `PUBLIC_APP_URL` when configured; the strict source of truth. */
  configuredOrigin?: string | null;
  /** Origin derived from the request itself (`req.protocol`://`req.get("host")`). */
  requestOrigin?: string | null;
};

export type CsrfDecision = { allowed: boolean; reason: string };

/** Pure decision function so the policy is unit-testable without booting Express. */
export function evaluateCsrfProtection(input: CsrfRequestInput): CsrfDecision {
  const method = (input.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return { allowed: true, reason: "safe-method" };

  if (input.path.startsWith(SCHEDULED_CALLBACK_PATH_PREFIX)) {
    return { allowed: true, reason: "scheduled-callback-path" };
  }
  if (firstHeader(input.headers[SCHEDULED_SIGNATURE_HEADER])) {
    return { allowed: true, reason: "signed-worker-callback" };
  }

  const fetchSite = firstHeader(input.headers["sec-fetch-site"])?.toLowerCase();
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") {
      return { allowed: true, reason: "sec-fetch-site-same-origin" };
    }
    return { allowed: false, reason: "sec-fetch-site-cross-site" };
  }

  const configured = normalizeOrigin(input.configuredOrigin ?? undefined);
  const requestOrigin = normalizeOrigin(input.requestOrigin ?? undefined);
  // PUBLIC_APP_URL is the authoritative public origin; only fall back to the
  // request-derived origin when the deployment has not configured one (dev,
  // preview). Including the request-derived origin alongside a configured one
  // would defeat the scheme check behind a TLS-terminating proxy.
  const allowedOrigins = new Set<string>();
  if (configured) allowedOrigins.add(configured);
  else if (requestOrigin) allowedOrigins.add(requestOrigin);
  if (!allowedOrigins.size) return { allowed: false, reason: "unknown-expected-origin" };

  // When PUBLIC_APP_URL is not configured the request-derived origin is the only
  // reference. Behind a proxy that rewrites the scheme we still accept a
  // same-host origin, matching the standard host-based Origin check. A
  // configured PUBLIC_APP_URL keeps the comparison strict (scheme + host).
  const allowHostOnlyFallback = !configured;

  const evaluate = (candidate: string | null, kind: "origin" | "referer"): CsrfDecision => {
    if (!candidate) return { allowed: false, reason: `missing-${kind}` };
    if (allowedOrigins.has(candidate)) return { allowed: true, reason: `${kind}-match` };
    if (allowHostOnlyFallback && requestOrigin && originHost(candidate) === originHost(requestOrigin)) {
      return { allowed: true, reason: `${kind}-host-match` };
    }
    return { allowed: false, reason: `${kind}-mismatch` };
  };

  const origin = normalizeOrigin(firstHeader(input.headers["origin"]));
  if (origin) return evaluate(origin, "origin");

  const referer = normalizeOrigin(firstHeader(input.headers["referer"]));
  if (referer) return evaluate(referer, "referer");

  // No Sec-Fetch-Site, Origin or Referer: fail closed.
  return { allowed: false, reason: "missing-origin-evidence" };
}

/** The origin the application believes it is served from. */
export function resolveConfiguredOrigin(): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  return normalizeOrigin(configured);
}

/** Express middleware: rejects cross-site state-changing requests. */
export function csrfProtectionMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const decision = evaluateCsrfProtection({
      method: req.method,
      path: req.path,
      headers: req.headers as Record<string, string | string[] | undefined>,
      configuredOrigin: resolveConfiguredOrigin(),
      requestOrigin: `${req.protocol}://${req.get("host") ?? ""}`,
    });
    if (decision.allowed) return next();
    res.status(403).json({ error: "Request blocked: the cross-site request was rejected." });
  };
}
