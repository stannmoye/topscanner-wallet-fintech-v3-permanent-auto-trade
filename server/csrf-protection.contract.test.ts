import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  csrfProtectionMiddleware,
  evaluateCsrfProtection,
  normalizeOrigin,
  resolveConfiguredOrigin,
  SCHEDULED_CALLBACK_PATH_PREFIX,
  SCHEDULED_SIGNATURE_HEADER,
} from "./_core/csrfProtection";

const serverSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

type Headers = Record<string, string | string[] | undefined>;

const base = (overrides: Partial<{ method: string; path: string; headers: Headers }> = {}) => ({
  method: overrides.method ?? "POST",
  path: overrides.path ?? "/api/trpc/customer.someMutation",
  headers: overrides.headers ?? {},
  configuredOrigin: null as string | null,
  requestOrigin: "https://stan.prod.page" as string | null,
});

const makeReq = (input: { method: string; path: string; headers: Headers; protocol?: string; host?: string }): Request =>
  ({
    method: input.method,
    path: input.path,
    headers: input.headers,
    protocol: input.protocol ?? "https",
    get: (name: string) => (name.toLowerCase() === "host" ? input.host ?? "stan.prod.page" : undefined),
  }) as unknown as Request;

const makeRes = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(value: unknown) {
    this.body = value;
    return this;
  },
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cross-site request protection (item 22)", () => {
  it("exempts safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(evaluateCsrfProtection(base({ method }) ).allowed).toBe(true);
    }
  });

  it("trusts a same-origin (or user-initiated) Sec-Fetch-Site and rejects cross-site writes", () => {
    expect(evaluateCsrfProtection(base({ headers: { "sec-fetch-site": "same-origin" } })).allowed).toBe(true);
    expect(evaluateCsrfProtection(base({ headers: { "sec-fetch-site": "none" } })).allowed).toBe(true);
    expect(evaluateCsrfProtection(base({ headers: { "sec-fetch-site": "cross-site" } })).allowed).toBe(false);
    expect(evaluateCsrfProtection(base({ headers: { "sec-fetch-site": "same-site" } })).allowed).toBe(false);
  });

  it("accepts a matching Origin and rejects a mismatched one", () => {
    const allowed = evaluateCsrfProtection(base({ headers: { origin: "https://stan.prod.page" } }));
    expect(allowed).toMatchObject({ allowed: true, reason: "origin-match" });
    const blocked = evaluateCsrfProtection(base({ headers: { origin: "https://evil.example" } }));
    expect(blocked).toMatchObject({ allowed: false, reason: "origin-mismatch" });
  });

  it("falls back to Referer when neither Sec-Fetch-Site nor Origin is present", () => {
    const allowed = evaluateCsrfProtection(base({ headers: { referer: "https://stan.prod.page/customer" } }));
    expect(allowed).toMatchObject({ allowed: true, reason: "referer-match" });
    const blocked = evaluateCsrfProtection(base({ headers: { referer: "https://evil.example/attack" } }));
    expect(blocked).toMatchObject({ allowed: false, reason: "referer-mismatch" });
  });

  it("prefers Origin over Referer", () => {
    const decision = evaluateCsrfProtection(base({
      headers: { origin: "https://evil.example", referer: "https://stan.prod.page/customer" },
    }));
    expect(decision).toMatchObject({ allowed: false, reason: "origin-mismatch" });
  });

  it("fails closed when there is no origin evidence at all", () => {
    expect(evaluateCsrfProtection(base())).toMatchObject({ allowed: false, reason: "missing-origin-evidence" });
  });

  it("exempts signed worker callbacks under /api/scheduled and the HMAC header", () => {
    expect(evaluateCsrfProtection(base({ path: SCHEDULED_CALLBACK_PATH_PREFIX + "reconcile" }))).toMatchObject({
      allowed: true,
      reason: "scheduled-callback-path",
    });
    expect(evaluateCsrfProtection(base({ headers: { [SCHEDULED_SIGNATURE_HEADER]: "deadbeef" } }))).toMatchObject({
      allowed: true,
      reason: "signed-worker-callback",
    });
  });

  it("still works behind a TLS-terminating proxy", () => {
    // PUBLIC_APP_URL is the HTTPS public origin; the app sees an http request.
    const decision = evaluateCsrfProtection({
      method: "POST",
      path: "/api/trpc/customer.someMutation",
      headers: { origin: "https://stan.prod.page", "sec-fetch-site": "same-origin" },
      configuredOrigin: "https://stan.prod.page",
      requestOrigin: "http://stan.prod.page",
    });
    expect(decision.allowed).toBe(true);

    // Even without Sec-Fetch-Site, the configured origin matches exactly.
    const strict = evaluateCsrfProtection({
      method: "POST",
      path: "/api/trpc/customer.someMutation",
      headers: { origin: "https://stan.prod.page" },
      configuredOrigin: "https://stan.prod.page",
      requestOrigin: "http://stan.prod.page",
    });
    expect(strict).toMatchObject({ allowed: true, reason: "origin-match" });
  });

  it("keeps the comparison strict when PUBLIC_APP_URL is configured", () => {
    const decision = evaluateCsrfProtection({
      method: "POST",
      path: "/api/trpc/customer.someMutation",
      headers: { origin: "http://stan.prod.page" },
      configuredOrigin: "https://stan.prod.page",
      requestOrigin: "http://stan.prod.page",
    });
    // http:// is not the configured https:// origin, so it must not be accepted.
    expect(decision.allowed).toBe(false);
  });

  it("allows a same-host origin when no PUBLIC_APP_URL is configured (dev/preview proxy)", () => {
    const decision = evaluateCsrfProtection({
      method: "POST",
      path: "/api/trpc/customer.someMutation",
      headers: { origin: "https://preview.example" },
      configuredOrigin: null,
      requestOrigin: "http://preview.example",
    });
    expect(decision).toMatchObject({ allowed: true, reason: "origin-host-match" });
  });

  it("normalises origins and reads PUBLIC_APP_URL for the configured origin", () => {
    expect(normalizeOrigin("https://Stan.Prod.Page/customer?x=1")).toBe("https://stan.prod.page");
    expect(normalizeOrigin("not a url")).toBeNull();
    vi.stubEnv("PUBLIC_APP_URL", "https://stan.prod.page/");
    expect(resolveConfiguredOrigin()).toBe("https://stan.prod.page");
    vi.stubEnv("PUBLIC_APP_URL", "");
    expect(resolveConfiguredOrigin()).toBeNull();
  });

  it("rejects a cross-site mutation through the middleware and lets a same-origin one pass", () => {
    const next = vi.fn() as unknown as NextFunction;

    const blockedRes = makeRes();
    csrfProtectionMiddleware()(
      makeReq({ method: "POST", path: "/api/trpc/x", headers: { origin: "https://evil.example" } }),
      blockedRes as unknown as Response,
      next,
    );
    expect(blockedRes.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const allowedRes = makeRes();
    csrfProtectionMiddleware()(
      makeReq({ method: "POST", path: "/api/trpc/x", headers: { "sec-fetch-site": "same-origin" } }),
      allowedRes as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(allowedRes.statusCode).toBe(200);
  });

  it("is wired into the server before routes are registered", () => {
    expect(serverSource).toContain('import { csrfProtectionMiddleware } from "./csrfProtection"');
    const csrfPosition = serverSource.indexOf("app.use(csrfProtectionMiddleware())");
    const headersPosition = serverSource.indexOf("app.use(securityHeadersMiddleware())");
    const firstRoutePosition = serverSource.indexOf("registerLocalStorageRoutes(app)");
    expect(csrfPosition).toBeGreaterThan(headersPosition);
    expect(csrfPosition).toBeLessThan(firstRoutePosition);
  });
});
