import { describe, expect, it } from "vitest";
import { countEnabledTradingPackages, isEnabledTradingPackage } from "./trading-package-status";

describe("enabled Trading package count", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");

  it("counts enabled packages that have not expired", () => {
    expect(countEnabledTradingPackages([
      { enabled: true, expiresAt: null },
      { enabled: 1, expiresAt: "2026-11-12T12:00:01.000Z" },
      { enabled: false, expiresAt: null },
      { enabled: true, expiresAt: "2026-11-12T11:59:59.000Z" },
    ], now)).toBe(2);
  });

  it("excludes archived packages and invalid expiry dates", () => {
    expect(isEnabledTradingPackage({ enabled: true, archived: true }, now)).toBe(false);
    expect(isEnabledTradingPackage({ enabled: true, archivedAt: "2026-11-01T00:00:00.000Z" }, now)).toBe(false);
    expect(isEnabledTradingPackage({ enabled: true, expiresAt: "not-a-date" }, now)).toBe(false);
  });

  it("does not count disabled packages even when their expiry is in the future", () => {
    expect(countEnabledTradingPackages([
      { enabled: false, expiresAt: "2027-01-01T00:00:00.000Z" },
    ], now)).toBe(0);
  });
});
