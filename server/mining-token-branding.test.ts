import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMiningAssetRate,
  invalidateMiningTokenRateCache,
  resolveLiveMiningTokenRate,
  type Db,
  type MiningConfig,
} from "./mining-store";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./marketProviders", () => ({ fetchCurrencyUsdRate: fetchMock }));

const baseConfig = (overrides: Partial<MiningConfig> = {}): MiningConfig => ({
  id: 1, version: 1, effectiveAt: new Date(), packagePurchasesEnabled: true, boostsEnabled: true,
  tokenName: "CoinKi", tokenSymbol: "CKI", tokenUnitsPerUsd: "4", rewardTokensPerThsHour: "1", defaultContractDurationMonths: 12,
  calculationModel: "package_daily", difficultyBaselineThs: "1", ckiPerThsPerDay: "1", swapFeeBps: 0, purchaseFeeBps: 0,
  minSwapTokens: "0", maxSwapTokens: "1000000", defaultAutoConversionThreshold: "0",
  boostCycleSeconds: 3600, boostDurationSeconds: 120, boostRewardCkiPerDay: "0", boostActivationBonusCki: "0", quoteTtlSeconds: 60,
  fiatMaxAgeSeconds: 345600, cryptoMaxAgeSeconds: 300, maxRateDeviationBps: 300,
  dailyRewardCapTokens: "1000000", dualApprovalThresholdUsd: "1000", globalHashPowerThs: "1",
  miningSpeedMultiplier: "1",
  tokenIconUrl: "", tokenRateSource: "fixed", tokenExternalSymbol: "", tokenRateProvider: "",
  ...overrides,
});

beforeEach(() => {
  fetchMock.mockReset();
  invalidateMiningTokenRateCache();
});
afterEach(() => invalidateMiningTokenRateCache());

describe("Coin branding is display-only", () => {
  it("keeps the internal CKI ledger asset regardless of the configured display name and symbol", async () => {
    const config = baseConfig({ tokenName: "Aurora", tokenSymbol: "AUR" });
    const rate = await getMiningAssetRate({} as Db, "CKI", config);
    expect(rate.asset).toBe("CKI");
    expect(rate.scale).toBe(8);
  });

  it("derives the fixed USD reference from tokens-per-dollar without touching the ledger", async () => {
    const rate = await getMiningAssetRate({} as Db, "CKI", baseConfig({ tokenUnitsPerUsd: "4" }));
    expect(rate.usdPerUnit.toString()).toBe("0.25");
    expect(rate.provider).toMatch(/internal/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still prices the USD reference unit at exactly one", async () => {
    const rate = await getMiningAssetRate({} as Db, "USD", baseConfig());
    expect(rate.usdPerUnit.toString()).toBe("1");
  });
});

describe("Live coin rate resolution", () => {
  it("fails closed when live pricing is enabled without an external asset id", async () => {
    await expect(resolveLiveMiningTokenRate(baseConfig({ tokenRateSource: "live", tokenExternalSymbol: "" })))
      .rejects.toThrow(/external asset id/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the live market price and labels the provider", async () => {
    fetchMock.mockResolvedValue({ rate: "2", provider: "coingecko:bitcoin", sourceDate: new Date().toISOString(), fetchedAt: new Date() });
    const config = baseConfig({ tokenRateSource: "live", tokenExternalSymbol: "bitcoin", tokenRateProvider: "coingecko" });
    const rate = await getMiningAssetRate({} as Db, "CKI", config);
    expect(rate.usdPerUnit.toString()).toBe("2");
    expect(rate.provider).toContain("coingecko:bitcoin");
    expect(rate.provider).toContain("live");
  });

  it("fails closed instead of substituting a stale or zero price", async () => {
    fetchMock.mockResolvedValue({ rate: "0", provider: "coingecko:bitcoin", sourceDate: new Date().toISOString(), fetchedAt: new Date() });
    const config = baseConfig({ tokenRateSource: "live", tokenExternalSymbol: "bitcoin" });
    await expect(resolveLiveMiningTokenRate(config)).rejects.toThrow(/invalid price/i);
  });

  it("serves rapid comparisons from a short cache, and an admin edit forces a fresh tick", async () => {
    fetchMock.mockResolvedValue({ rate: "2", provider: "coingecko:bitcoin", sourceDate: new Date().toISOString(), fetchedAt: new Date() });
    const config = baseConfig({ tokenRateSource: "live", tokenExternalSymbol: "bitcoin" });
    await getMiningAssetRate({} as Db, "CKI", config);
    await getMiningAssetRate({} as Db, "CKI", config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    invalidateMiningTokenRateCache();
    await getMiningAssetRate({} as Db, "CKI", config);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
