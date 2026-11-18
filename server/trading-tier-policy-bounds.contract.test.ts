import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TRADING_TIER_POLICY_ENUM_BOUNDS,
  TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS,
  TRADING_TIER_POLICY_NUMERIC_BOUNDS,
  TRADING_TIER_POLICY_STRING_BOUNDS,
} from "../shared/trading-tier-policy-bounds";

const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const validator = readFileSync(new URL("../client/src/trading-policy-validation.ts", import.meta.url), "utf8");
const policyEditor = readFileSync(new URL("../client/src/components/TradingDeliveryPolicyEditor.tsx", import.meta.url), "utf8");

/**
 * Item 32: the per-tier policy editor validates every editable field against
 * the shared bounds module, which mirrors the server schema. This test fails if
 * the shared module and the server `updatePackagePolicies` schema drift apart.
 */
const start = router.indexOf("updatePackagePolicies: adminProcedure.input(");
const end = router.indexOf("updateOpportunityPackagePolicies", start);
const policySchemaBlock = router.slice(start, end);

// One per-tier policy string field is nullable on the server (badgeLabel).
const nullablePolicyStringFields = new Set(["badgeLabel"]);

describe("per-tier Trading policy bounds match the server schema (item 32)", () => {
  it("exposes every numeric, nullable, string and enum bound the server accepts", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    for (const [field, bound] of Object.entries(TRADING_TIER_POLICY_NUMERIC_BOUNDS)) {
      expect(router).toContain(`${field}: z.number().int().min(${bound.min}).max(${bound.max}).optional()`);
    }
    for (const [field, bound] of Object.entries(TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS)) {
      expect(router).toContain(`${field}: z.number().int().min(${bound.min}).max(${bound.max}).nullable().optional()`);
    }
    for (const [field, bound] of Object.entries(TRADING_TIER_POLICY_STRING_BOUNDS)) {
      const nullable = nullablePolicyStringFields.has(field) ? ".nullable()" : "";
      expect(router).toContain(`${field}: z.string().trim().max(${bound.maxLength})${nullable}.optional()`);
    }
    for (const [field, allowed] of Object.entries(TRADING_TIER_POLICY_ENUM_BOUNDS)) {
      expect(router).toContain(`${field}: z.enum(["${(allowed as readonly string[]).join('","')}"]).optional()`);
    }
  });

  it("has no per-tier numeric or enum field in the server schema missing from the shared module", () => {
    const serverNumeric = [...policySchemaBlock.matchAll(/^\s*(\w+):\s*z\.number\(\)/gm)].map((match) => match[1]).sort();
    const serverEnum = [...policySchemaBlock.matchAll(/^\s*(\w+):\s*z\.enum\(/gm)].map((match) => match[1]).sort();

    const sharedNumeric = [...Object.keys(TRADING_TIER_POLICY_NUMERIC_BOUNDS), ...Object.keys(TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS)].sort();
    const sharedEnum = Object.keys(TRADING_TIER_POLICY_ENUM_BOUNDS).sort();

    expect(serverNumeric).toEqual(sharedNumeric);
    expect(serverEnum).toEqual(sharedEnum);
  });

  it("keeps the tier reason and array bounds aligned with the shared contract", () => {
    expect(router).toContain("reason: z.string().trim().min(5).max(500)");
    expect(router).toContain("}).strict()).min(1).max(1000)");
  });

  it("wires the client validator and editor to the shared bounds", () => {
    for (const name of [
      "TRADING_TIER_POLICY_NUMERIC_BOUNDS",
      "TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS",
      "TRADING_TIER_POLICY_STRING_BOUNDS",
      "TRADING_TIER_POLICY_ENUM_BOUNDS",
    ]) {
      expect(validator).toContain(name);
    }
    expect(validator).toContain('from "@shared/trading-tier-policy-bounds"');
    expect(validator).toContain("export function validateTradingPolicyRow");
    expect(validator).toContain("export function tradingPolicyRowValid");
    expect(app).toContain("tradingPolicyRowValid(row)");
    expect(app).toContain("policyRowErrors={policyRowErrors}");
    expect(policyEditor).toContain("rowErrors.map(([field,message])");
  });
});
