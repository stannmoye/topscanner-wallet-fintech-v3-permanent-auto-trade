import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINING_PACKAGE_THEME,
  getMiningPackageTheme,
  isMiningPackageThemeKey,
  MINING_PACKAGE_THEMES,
} from "../shared/mining-package-themes";

const adminUi = readFileSync(new URL("../client/src/components/AdminMining.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerMining.tsx", import.meta.url), "utf8");
const adminService = readFileSync(new URL("./mining-admin.ts", import.meta.url), "utf8");
const customerService = readFileSync(new URL("./mining.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0124_mining_package_visual_themes.sql", import.meta.url), "utf8");
const migrationRunner = readFileSync(new URL("../scripts/apply-mining-migrations.mjs", import.meta.url), "utf8");
const schemaRepair = readFileSync(new URL("../scripts/ensure-mining-current-schema.mjs", import.meta.url), "utf8");
const themeSchemaRepair = readFileSync(new URL("../scripts/mining-package-theme-schema.mjs", import.meta.url), "utf8");
const mainMigration = readFileSync(new URL("../scripts/guarded-main-migrate.mjs", import.meta.url), "utf8");
const portalMigration = readFileSync(new URL("../scripts/apply-portal-migrations.mjs", import.meta.url), "utf8");

describe("Mining package visual themes", () => {
  it("provides eight distinct, safe presets and a stable legacy fallback", () => {
    expect(MINING_PACKAGE_THEMES).toHaveLength(8);
    expect(new Set(MINING_PACKAGE_THEMES.map((theme) => theme.key)).size).toBe(8);
    expect(new Set(MINING_PACKAGE_THEMES.map((theme) => theme.accent)).size).toBe(8);
    expect(new Set(MINING_PACKAGE_THEMES.map((theme) => theme.label)).size).toBe(8);
    expect(MINING_PACKAGE_THEMES.map((theme) => theme.label)).toEqual([
      "Aurora", "Ember", "Glacier", "Solar", "Nebula", "Neon", "Plasma", "Midnight",
    ]);
    expect(DEFAULT_MINING_PACKAGE_THEME).toBe("aurora");
    expect(isMiningPackageThemeKey("nebula")).toBe(true);
    expect(isMiningPackageThemeKey("midnight")).toBe(true);
    expect(isMiningPackageThemeKey("url(https://invalid)")).toBe(false);
    expect(getMiningPackageTheme("unknown").key).toBe(DEFAULT_MINING_PACKAGE_THEME);
  });

  it("persists theme choice on package versions through save and clone operations", () => {
    expect(adminService).toContain("themeKey=?,termsText=?");
    expect(adminService).toContain("expectedDailyRewardCki,themeKey,termsText");
    expect(adminService).toContain("getMiningPackageTheme(source.themeKey).key");
    expect(adminService).toContain("themeKey:input.themeKey");
    expect(router).toContain("themeKey:z.enum(MINING_PACKAGE_THEME_KEYS).optional()");
  });

  it("returns the version theme to customers and maps only approved palette values to CSS", () => {
    expect(customerService).toContain("v.expectedDailyRewardCki,v.themeKey");
    expect(customerService).toContain("themeKey: getMiningPackageTheme(row.themeKey).key");
    expect(customerUi).toContain("getMiningPackageTheme(item.themeKey)");
    expect(customerUi).toContain('"--package-accent":theme.accent');
    expect(customerUi).toContain("theme-${theme.key}");
  });

  it("adds the Aurora default for existing versions through both migration paths", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS themeKey VARCHAR(32) NOT NULL DEFAULT 'aurora'");
    expect(migrationRunner).toContain('"0124_mining_package_visual_themes"');
    expect(migrationRunner).toContain("WHERE p.code=? AND v.id=p.currentVersionId AND v.themeKey='aurora'");
    expect(migrationRunner).toContain('{ code: "CKI_VELOCITY", themeKey: "ember" }');
    expect(migrationRunner).toContain('{ code: "CKI_QUANTUM", themeKey: "glacier" }');
    expect(migrationRunner).toContain('{ code: "CKI_TITAN", themeKey: "solar" }');
    expect(migrationRunner).toContain('{ code: "CKI_INFINITY", themeKey: "nebula" }');
    expect(mainMigration).toContain("ensureMiningPackageThemeSchema(connection)");
    expect(portalMigration).toContain("ensureMiningPackageThemeSchema(connection, { required: true })");
    expect(schemaRepair).toContain("ensureMiningPackageThemeSchema(db, { required: true })");
    expect(themeSchemaRepair).toContain("themeKey NOT IN ('aurora','ember','glacier','solar','nebula','neon','plasma','midnight')");
  });

  it("shows all eight selectable previews in the admin package form", () => {
    expect(adminUi).toContain("MINING_PACKAGE_THEMES.map(theme");
    expect(adminUi).toContain('aria-label="Package color themes"');
    expect(adminUi).toContain("setPackage(\"themeKey\",theme.key)");
    expect(adminUi).toContain("Customer card color theme");
  });
});
