import type { NextFunction, Request, Response } from "express";

/**
 * Item 21: baseline browser security headers applied to every response.
 *
 * The policy is intentionally permissive only where the application actually
 * needs it, so enabling it cannot break a live page:
 *   - Google Maps (loaded by client/src/components/Map.tsx) needs its script,
 *     image and connect origins.
 *   - React inline `style` attributes and the UI kit need `style-src 'unsafe-inline'`.
 *   - Remote logos, avatars and generated images are served from arbitrary HTTPS
 *     hosts, so `img-src` allows `https:` (plus same-origin, `data:` and `blob:`).
 *
 * `script-src` is strict (`'self'`) in production; the Vite dev server injects an
 * inline React-refresh preamble and an HMR WebSocket, so development adds
 * `'unsafe-inline'` and `ws:/wss:` and nothing else changes.
 */
export function buildContentSecurityPolicy(options: { development?: boolean } = {}): string {
  const scriptSrc = options.development
    ? "'self' 'unsafe-inline' https://maps.googleapis.com"
    : "'self' https://maps.googleapis.com";
  const connectSrc = options.development
    ? "'self' ws: wss: https://maps.googleapis.com https://*.googleapis.com"
    : "'self' https://maps.googleapis.com https://*.googleapis.com";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

/** The full header set installed once per request. */
export function buildSecurityHeaders(nodeEnv: string | undefined = process.env.NODE_ENV): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy({ development: nodeEnv === "development" }),
    // Browsers ignore HSTS over plain HTTP, so it is safe to always send it.
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

/** Express middleware: installs the baseline security headers on every response. */
export function securityHeadersMiddleware(nodeEnv: string | undefined = process.env.NODE_ENV) {
  const headers = buildSecurityHeaders(nodeEnv);
  return (_req: Request, res: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    next();
  };
}
