import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Item 64: the package name shown in the login/auth response and the one shown by
// customer.tradingEligibility must come from a single server source of truth.
// The stored users.packageName column is kept but is no longer read for display.

const databaseSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const serverEntrypointSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const kycSource = readFileSync(new URL("./kyc.ts", import.meta.url), "utf8");
const diagnosticsSource = readFileSync(new URL("./opportunityDeliveryDiagnostics.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");

describe("single source of truth for the customer package name", () => {
  it("derives the display name from the trading eligibility function", () => {
    expect(databaseSource).toContain("export const NO_ACTIVE_PACKAGE_LABEL");
    expect(databaseSource).toContain("export async function resolveCustomerPackageName");
    expect(databaseSource).toContain("export async function resolveCustomerPackageNames");
    const start = databaseSource.indexOf("export async function resolveCustomerPackageName(");
    const end = databaseSource.indexOf("export async function resolveCustomerPackageNames(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const resolver = databaseSource.slice(start, end);
    expect(resolver).toContain("await getCustomerTradingEligibility(userId)");
    expect(resolver).toContain("eligibility.currentPackage?.name");
    expect(resolver).toContain("NO_ACTIVE_PACKAGE_LABEL");
  });

  it("keeps the stored column but stops reading it for display", () => {
    // The column must not be dropped.
    expect(schemaSource).toContain('packageName: varchar("packageName"');
    // No remaining reader of the stored users.packageName column.
    expect(databaseSource).not.toContain("packageName:users.packageName");
    expect(kycSource).not.toContain("u.packageName");
    expect(diagnosticsSource).not.toContain("packageName FROM users");
    expect(diagnosticsSource).not.toContain("id,name,packageName FROM users");
  });

  it("uses one identical message for the resolved label", () => {
    const resolverStart = databaseSource.indexOf("export const NO_ACTIVE_PACKAGE_LABEL");
    expect(resolverStart).toBeGreaterThanOrEqual(0);
    expect(databaseSource.slice(resolverStart, resolverStart + 120)).toContain('"No active package"');
  });

  it("derives the package name in every authentication response", () => {
    const matches = serverEntrypointSource.match(/packageName: await resolveCustomerPackageName\(user\.id\)/g) ?? [];
    // register + customer login + admin login
    expect(matches).toHaveLength(3);
    expect(serverEntrypointSource).not.toContain("return res.json({ user: safeUser });");
  });

  it("derives the package name in auth.me", () => {
    const start = routerSource.indexOf("me: publicProcedure.query(async opts =>");
    const end = routerSource.indexOf("requestEmailVerification: protectedProcedure.mutation", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const me = routerSource.slice(start, end);
    expect(me).toContain("resolveCustomerPackageName(opts.ctx.user.id)");
    expect(me).toContain("packageName:");
  });

  it("derives the package name in the admin KYC directory and delivery diagnostics", () => {
    expect(kycSource).toContain("resolveCustomerPackageNames");
    expect(diagnosticsSource).toContain("resolveCustomerPackageName");
    expect(diagnosticsSource).toContain("resolveCustomerPackageNames");
  });
});
