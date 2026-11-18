import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  contentSecurityPolicyHeaderName,
  securityHeadersMiddleware,
} from "./_core/securityHeaders";

const serverSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

const ENFORCED_HEADERS = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
] as const;

describe("baseline browser security headers (item 21)", () => {
  it("enforces HSTS, frame, referrer and nosniff on every response in production", () => {
    const headers = buildSecurityHeaders("production");
    expect(Object.keys(headers).sort()).toEqual(
      ["Content-Security-Policy-Report-Only", ...ENFORCED_HEADERS].sort(),
    );
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("ships the CSP report-only in production so it cannot break the live site", () => {
    expect(contentSecurityPolicyHeaderName("production")).toBe("Content-Security-Policy-Report-Only");
    const headers = buildSecurityHeaders("production");
    expect(headers).not.toHaveProperty("Content-Security-Policy");
    expect(headers).toHaveProperty("Content-Security-Policy-Report-Only");
  });

  it("enforces the CSP outside production so developers and CI see real violations", () => {
    expect(contentSecurityPolicyHeaderName("development")).toBe("Content-Security-Policy");
    expect(contentSecurityPolicyHeaderName("test")).toBe("Content-Security-Policy");
    expect(contentSecurityPolicyHeaderName(undefined)).toBe("Content-Security-Policy");
    expect(buildSecurityHeaders("test")).toHaveProperty("Content-Security-Policy");
  });

  it("publishes a locked-down CSP with the directives the app needs", () => {
    const policy = buildContentSecurityPolicy({ development: false });
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("script-src 'self' https://maps.googleapis.com");
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).toContain("img-src 'self' data: blob: https:");
    expect(policy).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(policy).toContain("connect-src 'self' https://maps.googleapis.com https://*.googleapis.com");
    // A production policy must never allow inline scripts.
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("relaxes only the Vite dev-server origins in development", () => {
    const dev = buildContentSecurityPolicy({ development: true });
    expect(dev).toContain("script-src 'self' 'unsafe-inline' https://maps.googleapis.com");
    expect(dev).toContain("ws:");
    const prod = buildContentSecurityPolicy({ development: false });
    expect(prod).not.toContain("ws:");
  });

  it("installs every header through the Express middleware before continuing", () => {
    const setHeader = vi.fn();
    const next = vi.fn() as unknown as NextFunction;
    securityHeadersMiddleware("production")({} as Request, { setHeader } as unknown as Response, next);
    const names = setHeader.mock.calls.map(call => call[0]);
    expect(names).toEqual(expect.arrayContaining([
      "Content-Security-Policy-Report-Only",
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
    ]));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("is wired into the server before any route is registered", () => {
    expect(serverSource).toContain('import { securityHeadersMiddleware } from "./securityHeaders"');
    const middlewarePosition = serverSource.indexOf("app.use(securityHeadersMiddleware())");
    const firstRoutePosition = serverSource.indexOf("registerLocalStorageRoutes(app)");
    const parserPosition = serverSource.indexOf("app.use(express.json");
    expect(middlewarePosition).toBeGreaterThanOrEqual(0);
    expect(firstRoutePosition).toBeGreaterThan(middlewarePosition);
    expect(parserPosition).toBeGreaterThan(middlewarePosition);
  });
});
