import { describe, expect, it } from "vitest";
import { inspectMainMigrationSchema } from "./main-migration-schema-diagnostic.mjs";

function fakeConnection(columns) {
  return {
    async query(sql) {
      expect(sql).toContain("information_schema.columns");
      expect(sql).toContain("table_schema=DATABASE()");
      return [columns.map(([table_name, column_name, is_nullable = "YES", column_default = null, extra = ""]) => ({ table_name, column_name, is_nullable, column_default, extra })), []];
    },
  };
}

describe("read-only main migration schema diagnostics", () => {
  it("identifies a missing legacy rename source and its existing destination", async () => {
    const result = await inspectMainMigrationSchema(fakeConnection([
      ["opportunity_package_policies", "maxPopupsPerDay"],
      ["app_settings", "settingKey"],
      ["app_settings", "settingValue"],
    ]), "0019_daily_opportunity_quotas");

    expect(result).toContain(
      "Missing required pre-existing column opportunity_package_policies.maxPopupsPerMinute for 0019_daily_opportunity_quotas.sql.",
    );
    expect(result).toContain(
      "0019_daily_opportunity_quotas.sql may already be reflected in the schema: source opportunity_package_policies.maxPopupsPerMinute is absent while destination opportunity_package_policies.maxPopupsPerDay exists, but tracker history did not record the migration.",
    );
  });

  it("reports missing pre-existing fields without suggesting a migration retry", async () => {
    const result = await inspectMainMigrationSchema(fakeConnection([
      ["packages", "name"],
      ["packages", "enabled"],
      ["customer_package_subscriptions", "userId"],
      ["customer_package_subscriptions", "packageId"],
      ["customer_package_subscriptions", "startsAt"],
      ["customer_package_subscriptions", "status"],
      ["opportunity_package_policies", "packageName"],
      ["opportunity_package_policies", "enabled"],
      ["app_settings", "settingKey"],
      ["app_settings", "settingValue"],
      ["trade_positions", "status"],
    ]), "0069_trading_package_activation");

    expect(result).toContain("Missing required pre-existing column missed_opportunities.potentialRewardMinor for 0069_trading_package_activation.sql.");
    expect(result.some(message => /Missing required/.test(message))).toBe(true);
    expect(result.some(message => /Progress hint for 0069_trading_package_activation/.test(message))).toBe(true);
  });

  it("checks 0112 fee INSERT columns and flags extra required live columns", async () => {
    const required = ["packageId", "version", "feeRateBps", "roundingMode", "effectiveAt", "changedBy", "changedAt", "reason", "source"];
    const compatible = await inspectMainMigrationSchema(fakeConnection(required.map(column => ["trading_package_fee_policy_versions", column, "NO", column === "changedAt" ? "CURRENT_TIMESTAMP" : null])), "0112_permanent_automatic_financial_execution");
    expect(compatible).toEqual([]);
    const incompatible = await inspectMainMigrationSchema(fakeConnection([...required.map(column => ["trading_package_fee_policy_versions", column, "NO", null]), ["trading_package_fee_policy_versions", "legacyRequiredFlag", "NO", null]]), "0112_permanent_automatic_financial_execution");
    expect(incompatible).toContain("Migration 0112 fee-policy INSERT omits additional NOT NULL/no-default column trading_package_fee_policy_versions.legacyRequiredFlag; inspect the live table definition before retrying.");
  });

  it("detects duration bounds that remain NOT NULL after the forward correction", async () => {
    const result = await inspectMainMigrationSchema(fakeConnection([
      ["opportunity_package_policies", "minimumTradeDurationSeconds", "NO"],
      ["opportunity_package_policies", "maximumTradeDurationSeconds", "YES"],
    ]), "0094_trading_policy_duration_bounds_nullable");

    expect(result).toContain(
      "Column opportunity_package_policies.minimumTradeDurationSeconds must be nullable for 0094_trading_policy_duration_bounds_nullable.sql.",
    );
  });
});
