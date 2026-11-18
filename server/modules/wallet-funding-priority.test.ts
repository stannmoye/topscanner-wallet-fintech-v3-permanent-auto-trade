import { describe, expect, it } from "vitest";
import { planCrossWalletFunding, type FxRateSnapshot } from "./trading-wallet-fx";
import {
  DEFAULT_WALLET_FUNDING_PRIORITY,
  WALLET_FUNDING_PRIORITY_MAX_ENTRIES,
  configuredWalletFundingOrder,
  normalizeWalletFundingPriorityOrder,
  parseWalletFundingPriorityState,
  resolveWalletFundingOrder,
  serializeWalletFundingPriority,
} from "./wallet-funding-priority";

const rate = (currency: string, scale: number, rateUsdPerUnit: string): FxRateSnapshot => ({
  currency, scale, rateUsdPerUnit, provider: "test-api", sourceDate: "2026-10-29T10:00:00.000Z",
  fetchedAt: new Date("2026-10-29T10:00:00.000Z"),
});

describe("wallet funding priority parsing", () => {
  it("treats an absent or blank value as not-configured", () => {
    expect(parseWalletFundingPriorityState(null)).toEqual({ status: "not-configured" });
    expect(parseWalletFundingPriorityState(undefined)).toEqual({ status: "not-configured" });
    expect(parseWalletFundingPriorityState("   ")).toEqual({ status: "not-configured" });
  });

  it("treats an unreadable or shape-invalid value as malformed so callers fail closed", () => {
    expect(parseWalletFundingPriorityState("{not json}").status).toBe("malformed");
    expect(parseWalletFundingPriorityState('"a string"').status).toBe("malformed");
    expect(parseWalletFundingPriorityState(JSON.stringify({ order: ["USD"], policyVersion: 0 })).status).toBe("malformed");
    expect(parseWalletFundingPriorityState(JSON.stringify({ order: ["usd"], policyVersion: 1, updatedBy: null, updatedAt: null })).status).toBe("configured");
    expect(parseWalletFundingPriorityState(JSON.stringify({ order: ["US D"], policyVersion: 1, updatedBy: null, updatedAt: null })).status).toBe("malformed");
    expect(parseWalletFundingPriorityState(JSON.stringify({ order: ["USD"], policyVersion: 1, updatedBy: 0, updatedAt: null })).status).toBe("malformed");
  });

  it("normalizes and validates a proposed order", () => {
    expect(normalizeWalletFundingPriorityOrder(["usd", " eur ", "GBP"])).toEqual(["USD", "EUR", "GBP"]);
    expect(normalizeWalletFundingPriorityOrder([])).toEqual([]);
    expect(normalizeWalletFundingPriorityOrder(["USD", "usd"])).toBeNull();
    expect(normalizeWalletFundingPriorityOrder(["USD", 3])).toBeNull();
    expect(normalizeWalletFundingPriorityOrder(["U"])).toBeNull();
    expect(normalizeWalletFundingPriorityOrder(Array.from({ length: WALLET_FUNDING_PRIORITY_MAX_ENTRIES + 1 }, (_, i) => `C${i}`))).toBeNull();
  });

  it("round-trips a configured value and exposes its order", () => {
    const config = { order: ["USD", "EUR", "GBP"], policyVersion: 3, updatedBy: 7, updatedAt: "2026-10-29T10:00:00.000Z", reason: "admin chose USD first" };
    const state = parseWalletFundingPriorityState(serializeWalletFundingPriority(config));
    expect(state.status).toBe("configured");
    expect(configuredWalletFundingOrder(state)).toEqual(["USD", "EUR", "GBP"]);
    expect(configuredWalletFundingOrder({ status: "not-configured" })).toBeNull();
  });
});

describe("wallet funding order resolution", () => {
  it("defaults to USD first then the remaining currencies alphabetically", () => {
    expect(DEFAULT_WALLET_FUNDING_PRIORITY).toEqual(["USD"]);
    expect(resolveWalletFundingOrder({ currencies: ["GBP", "USD", "EUR", "BTC"] })).toEqual(["USD", "BTC", "EUR", "GBP"]);
  });

  it("places configured currencies first in their saved order, then the rest alphabetically", () => {
    expect(resolveWalletFundingOrder({ currencies: ["GBP", "EUR", "USD", "BTC"], order: ["EUR", "BTC"] }))
      .toEqual(["EUR", "BTC", "GBP", "USD"]);
  });

  it("ignores a malformed configured order and falls back to the default", () => {
    expect(resolveWalletFundingOrder({ currencies: ["EUR", "USD"], order: ["USD", "usd"] })).toEqual(["USD", "EUR"]);
  });
});

describe("planCrossWalletFunding honours the administrator priority", () => {
  it("debits a smaller-priority wallet first when the admin order says so", () => {
    const result = planCrossWalletFunding({
      requiredTargetMinor: 10_000,
      targetAvailableMinor: 5_000,
      targetRate: rate("USD", 2, "1"),
      sourceWallets: [
        { currency: "GBP", scale: 2, availableMinor: 4_000, rate: rate("GBP", 2, "1.25") },
        { currency: "EUR", scale: 2, availableMinor: 9_000, rate: rate("EUR", 2, "1.1") },
      ],
      priorityCurrencies: ["GBP", "EUR"],
    });
    expect(result.sourceDebits[0].currency).toBe("GBP");
    expect(result.targetCreditMinor).toBe(5_000);
  });

  it("keeps the alphabetical default when no priority is configured", () => {
    const result = planCrossWalletFunding({
      requiredTargetMinor: 10_000,
      targetAvailableMinor: 5_000,
      targetRate: rate("USD", 2, "1"),
      sourceWallets: [
        { currency: "GBP", scale: 2, availableMinor: 4_000, rate: rate("GBP", 2, "1.25") },
        { currency: "EUR", scale: 2, availableMinor: 9_000, rate: rate("EUR", 2, "1.1") },
      ],
    });
    expect(result.sourceDebits[0].currency).toBe("EUR");
  });
});
