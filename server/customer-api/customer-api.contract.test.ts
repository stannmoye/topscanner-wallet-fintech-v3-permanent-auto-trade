import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-contract assertions (the pattern used elsewhere in this repo). They
// fail loudly if the Customer API v1 wiring is removed or reordered, since the
// routes are only correct when registered before the tRPC/static fallback.

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const gatewaySource = read("./gateway.ts");
const schemaSource = read("../../drizzle/schema.ts");
const indexSource = read("../_core/index.ts");
const portalRunnerSource = read("../../scripts/apply-portal-migrations.mjs");

describe("customer API v1 contract", () => {
  it("declares the api_* governance tables in the Drizzle schema", () => {
    for (const table of ["api_keys", "api_webhook_endpoints", "api_webhook_deliveries", "api_idempotency_keys", "api_request_log"]) {
      expect(schemaSource).toContain(`mysqlTable("${table}"`);
    }
  });

  it("ships an additive migration that creates each table exactly once and is registered", () => {
    const migrationPath = "../../drizzle/0120_customer_api_v1.sql";
    expect(existsSync(new URL(migrationPath, import.meta.url))).toBe(true);
    const migration = read(migrationPath);
    for (const table of ["api_keys", "api_webhook_endpoints", "api_webhook_deliveries", "api_idempotency_keys", "api_request_log"]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    }
    expect(portalRunnerSource).toContain('"0120_customer_api_v1.sql"');
  });

  it("registers the customer API routes before the tRPC/static fallback", () => {
    const apiIndex = indexSource.indexOf("registerCustomerApiRoutes(app)");
    const trpcIndex = indexSource.indexOf('"/api/trpc"');
    expect(apiIndex).toBeGreaterThan(-1);
    expect(trpcIndex).toBeGreaterThan(-1);
    expect(apiIndex).toBeLessThan(trpcIndex);
  });

  it("exposes the versioned read surface with scope, error, correlation and audit behaviour", () => {
    expect(gatewaySource).toContain('const API_BASE_PATH = "/api/v1"');
    expect(gatewaySource).toContain("application/problem+json");
    expect(gatewaySource).toContain('res.set("X-Request-Id", requestId)');
    expect(gatewaySource).toContain("requireScope(");
    expect(gatewaySource).toContain("apiRequestLog");
    expect(gatewaySource).toContain("consumeRateLimit(");
  });

  it("reads opportunities read-only (never consumes delivery or triggers execution)", () => {
    expect(gatewaySource).toContain("consumeDelivery: false");
    expect(gatewaySource).not.toContain("allowAutomaticExecution: true");
    expect(gatewaySource).not.toContain("customerSessionExecution: true");
  });

  it("covers every investment-module position desk", () => {
    for (const module of [
      "stake",
      "treasury",
      "cooperate-dept",
      "litigation-funds",
      "ip-royalties",
      "music-royalties",
      "agro-investment",
      "carbon-credit",
      "green-energy",
      "lending",
      "mining",
    ]) {
      expect(gatewaySource).toContain(`"${module}"`);
    }
  });
});
