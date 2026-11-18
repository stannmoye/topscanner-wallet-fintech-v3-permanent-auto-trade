import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_FEED_INTERNAL_OBJECT_FIELDS,
  stripCustomerFeedInternalObjects,
} from "./modules/customer-feed-payload";

const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

const customerFeedStart = db.indexOf("export async function listCustomerOpportunities(");
const customerFeedEnd = db.indexOf("export async function claimAutoTradeCycleCustomers(", customerFeedStart);
const customerFeed = db.slice(customerFeedStart, customerFeedEnd);

describe("item 40 – minimal customer opportunity feed payload", () => {
  it("never builds the raw administrator package/fee policy objects into the customer feed", () => {
    expect(customerFeedStart).toBeGreaterThanOrEqual(0);
    expect(customerFeedEnd).toBeGreaterThan(customerFeedStart);
    // The exact object-valued builders that used to leak the full admin policy structures.
    expect(customerFeed).not.toContain("packagePolicy:policyByName.get(normalizeTradingPackagePolicyKey(String(row.packageName)))||null");
    expect(customerFeed).not.toContain("packageFeePolicy:packageFeeByName.get(String(row.packageName))||null");
    expect(customerFeed).not.toContain("packagePolicy:base.packagePolicy??null");
    expect(customerFeed).not.toContain("packageFeePolicy:base.packageFeePolicy??null");
  });

  it("ships only the minimal customer-facing scalars the pop-up renders", () => {
    expect(customerFeed).toContain("packageFeeRateBps:");
    expect(customerFeed).toContain("packageMinimumTradeUnits:");
    expect(customerFeed).toContain("packageMaximumTradeUnits:");
  });

  it("the customer pop-up reads the minimal scalars, never the raw objects", () => {
    expect(app).not.toContain("popup.packagePolicy");
    expect(app).not.toContain("popup.packageFeePolicy");
    expect(app).toContain("Number(popup.packageFeeRateBps||0)");
    expect(app).toContain("Number(popup.packageMinimumTradeUnits||0)");
    expect(app).toContain("Number(popup.packageMaximumTradeUnits||0)");
  });

  it("the router strips any internal policy object so the feed cannot re-leak it", () => {
    expect(router).toContain("stripCustomerFeedInternalObjects(value)");
    const rawOffer = {
      id: 42,
      symbol: "EXMPL",
      packageFeeRateBps: 250,
      packageMinimumTradeUnits: 100,
      packageMaximumTradeUnits: 500,
      packagePolicy: { minimumTradeUnits: 100, maximumTradeUnits: 500, maxConcurrentActiveTrades: 3, maxDailyRewardMinor: 99999999 },
      packageFeePolicy: { feeRateBps: 250, roundingMode: "half_up", version: 4 },
    };
    const projected = stripCustomerFeedInternalObjects(rawOffer);
    // The projected payload carries exactly the customer-facing keys, nothing added, nothing else removed.
    expect(Object.keys(projected).sort()).toEqual([
      "id",
      "packageFeeRateBps",
      "packageMaximumTradeUnits",
      "packageMinimumTradeUnits",
      "symbol",
    ]);
    for (const field of CUSTOMER_FEED_INTERNAL_OBJECT_FIELDS) expect(projected).not.toHaveProperty(field);
  });

  it("leaves non-object values untouched and does not mutate the source object", () => {
    expect(stripCustomerFeedInternalObjects(null)).toBeNull();
    expect(stripCustomerFeedInternalObjects(7)).toBe(7);
    const source = { id: 1, packagePolicy: { a: 1 } };
    const projected = stripCustomerFeedInternalObjects(source);
    expect(projected).not.toBe(source);
    expect(source).toHaveProperty("packagePolicy");
  });
});
