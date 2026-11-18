import { describe, expect, it } from "vitest";
import { isCustomerOpportunityAllowed, isWithinQuietHours } from "./opportunityEligibility";

describe("isCustomerOpportunityAllowed", () => {
  const defaults = {
    enabled: true,
    allowedAssets: "USD,EUR,GBP,BTC,ETH",
    currency: "USD",
    symbol: "BTC-USD",
    rewardBps: 75,
    minimumRewardBps: 50,
  };

  it("allows an asset whose currency is on the customer's allowlist and meets reward minimum", () => {
    expect(isCustomerOpportunityAllowed(defaults)).toBe(true);
  });

  it("matches allowed assets case-insensitively and supports symbol allowlisting", () => {
    expect(isCustomerOpportunityAllowed({ ...defaults, currency: "jpy", symbol: "eth", allowedAssets: "ETH" })).toBe(true);
  });

  it("rejects currencies and symbols outside the allowlist", () => {
    expect(isCustomerOpportunityAllowed({ ...defaults, currency: "JPY", symbol: "USD-JPY" })).toBe(false);
  });

  it("rejects rewards below the customer's minimum", () => {
    expect(isCustomerOpportunityAllowed({ ...defaults, rewardBps: 49 })).toBe(false);
  });

  it("fails closed when rules are disabled or the allowlist is empty", () => {
    expect(isCustomerOpportunityAllowed({ ...defaults, enabled: false })).toBe(false);
    expect(isCustomerOpportunityAllowed({ ...defaults, allowedAssets: " , " })).toBe(false);
  });

  it("rejects non-finite reward settings", () => {
    expect(isCustomerOpportunityAllowed({ ...defaults, rewardBps: Number.NaN })).toBe(false);
  });
});

describe("isWithinQuietHours", () => {
  it("evaluates the window in UTC by default, independent of the server clock", () => {
    expect(isWithinQuietHours(new Date("2026-01-01T23:30:00Z"), "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T06:59:00Z"), "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T07:00:00Z"), "22:00", "07:00")).toBe(false);
  });

  it("recognizes daytime quiet hours and excludes the end time", () => {
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00Z"), "11:00", "13:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T13:00:00Z"), "11:00", "13:00")).toBe(false);
  });

  it("evaluates the window in an explicit admin-configured timezone", () => {
    // January: America/New_York is UTC-5. 03:00Z = 22:00 EST (quiet start), 11:59Z = 06:59 EST (still quiet).
    expect(isWithinQuietHours(new Date("2026-01-01T03:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T11:59:00Z"), "22:00", "07:00", "America/New_York")).toBe(true);
    // 12:00Z = 07:00 EST (end excluded) and 16:00Z = 11:00 EST (daytime) are outside the window.
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(false);
    expect(isWithinQuietHours(new Date("2026-01-01T16:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(false);
  });

  it("tracks the DST offset for the same timezone", () => {
    // July: America/New_York is UTC-4. 02:00Z = 22:00 EDT (quiet); the same instant is 21:00 in winter.
    expect(isWithinQuietHours(new Date("2026-07-01T02:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T02:00:00Z"), "22:00", "07:00", "America/New_York")).toBe(false);
  });

  it("falls back to UTC when the configured timezone is missing or invalid", () => {
    expect(isWithinQuietHours(new Date("2026-01-01T23:30:00Z"), "22:00", "07:00", "")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T23:30:00Z"), "22:00", "07:00", "Not/AZone")).toBe(true);
  });

  it("treats equal or invalid times as no quiet-hours window", () => {
    const now = new Date("2026-01-01T23:30:00Z");
    expect(isWithinQuietHours(now, "22:00", "22:00")).toBe(false);
    expect(isWithinQuietHours(now, "invalid", "07:00")).toBe(false);
  });
});
