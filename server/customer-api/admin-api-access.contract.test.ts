import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { READ_SCOPES } from "./scopes";

// Source-contract assertions for the administrator-facing Customer API surface.
// They fail loudly if the admin procedures, navigation destination or panel
// wiring are removed or renamed, and guard the panel's scope list against drift
// from the server scope registry.

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const navigationSource = read("../../client/src/admin-navigation.ts");
const adminAppSource = read("../../client/src/App.tsx");
const panelSource = read("../../client/src/components/AdminCustomerApiAccess.tsx");
const routersSource = read("../routers.ts");
const adminModuleSource = read("./admin.ts");
const settingsSource = read("./settings.ts");
const keysSource = read("./keys.ts");
const schemaSource = read("../../drizzle/schema.ts");
const portalRunnerSource = read("../../scripts/apply-portal-migrations.mjs");

describe("admin customer API access contract", () => {
  it("registers a canonical navigation destination that opens the admin panel", () => {
    expect(navigationSource).toContain('id: "customer-api-access", target: "apiAccess"');
    expect(adminAppSource).toContain('lazy(() => import("@/components/AdminCustomerApiAccess"))');
    expect(adminAppSource).toContain('section==="apiAccess"&&<Suspense');
  });

  it("exposes the admin tRPC procedures under adminOperations.apiAccess", () => {
    expect(routersSource).toContain("apiAccess: router({");
    for (const procedure of ["overview", "customerOptions", "keys", "createKey", "updateKey", "revokeKey", "requests", "deliveries", "settings", "updateSettings"]) {
      expect(routersSource).toContain(`${procedure}: adminProcedure`);
    }
  });

  it("maps domain validation errors to a 400 for the console", () => {
    expect(routersSource).toContain("runApiAccessAction");
    expect(routersSource).toContain("ApiKeyError");
    expect(routersSource).toContain("ApiAccessPolicyError");
  });

  it("provides the admin operations and policy services", () => {
    for (const fn of ["listAdminApiKeys", "createAdminApiKey", "updateAdminApiKey", "revokeAdminApiKey", "listAdminApiRequests", "listAdminApiWebhookDeliveries", "getAdminApiOverview", "listAdminApiCustomerOptions"]) {
      expect(adminModuleSource).toContain(fn);
    }
    expect(settingsSource).toContain("updateCustomerApiSettings");
    expect(settingsSource).toContain("resolveApiAccess");
    // updateApiKey is the key-store dependency the admin module imports.
    expect(keysSource).toContain("export async function updateApiKey");
  });

  it("persists the per-customer policy via a registered additive migration", () => {
    expect(schemaSource).toContain('mysqlTable("customer_api_settings"');
    const migrationPath = "../../drizzle/0121_customer_api_settings.sql";
    expect(existsSync(new URL(migrationPath, import.meta.url))).toBe(true);
    expect(read(migrationPath)).toContain("CREATE TABLE IF NOT EXISTS `customer_api_settings`");
    expect(portalRunnerSource).toContain('"0121_customer_api_settings.sql"');
  });

  it("audits every key and policy mutation into the administrator audit trail", () => {
    expect(adminModuleSource).toContain("v5AuditEvents");
    expect(adminModuleSource).toContain("customer_api.key_created");
    expect(adminModuleSource).toContain("customer_api.key_updated");
    expect(adminModuleSource).toContain("customer_api.key_revoked");
    expect(settingsSource).toContain("customer_api.settings_updated");
  });

  it("keeps the panel's grantable scopes in step with the server read-scope registry", () => {
    for (const scope of READ_SCOPES) {
      expect(panelSource).toContain(`id: "${scope}"`);
    }
  });

  it("defaults to the exportable React component the lazy loader expects", () => {
    expect(panelSource).toContain("export default function AdminCustomerApiAccess");
  });
});
