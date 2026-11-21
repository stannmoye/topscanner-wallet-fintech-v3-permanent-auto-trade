import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calculateMiningConversion, calculateMiningDifficultyIndex, calculateMiningReward, calculatePackageDailyRate, calculatePackageDailyReward, canStartMiningAccrual, getBoostCooldownWindow, isQuoteFresh, isRateWithinDeviation, normalizeMiningSpeedMultiplier, overlapSeconds } from "./mining-rules";

describe("mining reward rules", () => {
  it("uses the configured tokens per TH/s-hour formula with decimal precision", () => {
    expect(calculateMiningReward([{ baseThs: "10", boostThs: "0", rewardTokensPerThsHour: "2", elapsedSeconds: 60 }])).toBe("0.33333333");
  });

  it("adds boost hash power only during its active portion of a fixed interval", () => {
    const intervalStart = new Date("2026-10-11T12:00:00.000Z");
    const intervalEnd = new Date("2026-10-11T12:01:00.000Z");
    const boostStart = new Date("2026-10-11T12:00:30.000Z");
    const boostedSeconds = overlapSeconds(intervalStart, intervalEnd, boostStart, intervalEnd);
    const baseSeconds = 60 - boostedSeconds;
    expect(boostedSeconds).toBe(30);
    expect(calculateMiningReward([
      { baseThs: "10", boostThs: "0", rewardTokensPerThsHour: "60", elapsedSeconds: baseSeconds },
      { baseThs: "10", boostThs: "5", rewardTokensPerThsHour: "60", elapsedSeconds: boostedSeconds },
    ])).toBe("12.50000000");
  });

  it("preserves millisecond boost overlap across a full minute without losing fractional seconds", () => {
    const intervalStart = new Date("2026-10-12T14:47:00.000Z");
    const intervalEnd = new Date("2026-10-12T14:48:00.000Z");
    const boostStart = new Date("2026-10-12T14:46:59.093Z");
    const boostEnd = new Date("2026-10-12T14:47:19.093Z");
    const boostedSeconds = overlapSeconds(intervalStart, intervalEnd, boostStart, boostEnd);
    const baseSeconds = 60 - boostedSeconds;
    expect(boostedSeconds).toBe(19.093);
    expect(baseSeconds + boostedSeconds).toBe(60);
    expect(calculateMiningReward([
      { baseThs: "1", boostThs: "0", rewardTokensPerThsHour: "0.0390625", elapsedSeconds: baseSeconds },
      { baseThs: "1", boostThs: "0.25", rewardTokensPerThsHour: "0.0390625", elapsedSeconds: boostedSeconds },
    ])).toBe("0.00070283");
  });

  it("rejects invalid and overlong segments instead of trusting unchecked rates", () => {
    expect(() => calculateMiningReward([{ baseThs: "-1", boostThs: "0", rewardTokensPerThsHour: "1", elapsedSeconds: 60 }])).toThrow(/non-negative/);
    expect(() => calculateMiningReward([{ baseThs: "1", boostThs: "0", rewardTokensPerThsHour: "1", elapsedSeconds: 61 }])).toThrow(/sixty seconds/);
  });
});

describe("package daily reward model", () => {
  it("prorates each requested initial package rate by eligible seconds", () => {
    const rates = ["0.10", "0.30", "0.70", "1.60", "4.00"];
    for (const dailyRate of rates) {
      expect(calculatePackageDailyReward([{ expectedDailyRewardCki: dailyRate, baseThs: "1", boostThs: "0", eligibleSeconds: 86_400 }]))
        .toBe(new Decimal(dailyRate).toFixed(18));
      expect(calculatePackageDailyReward([{ expectedDailyRewardCki: dailyRate, baseThs: "1", boostThs: "0", eligibleSeconds: 43_200 }]))
        .toBe(new Decimal(dailyRate).div(2).toFixed(18));
    }
  });

  it("prorates a configured package estimate for six eligible hours", () => {
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki: "2", baseThs: "1", boostThs: "0", eligibleSeconds: 21_600 }])).toBe("0.500000000000000000");
  });

  it("calculates a single eligible second with high-precision decimal arithmetic", () => {
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki:"4.00",baseThs:"1",boostThs:"0",eligibleSeconds:1 }]))
      .toBe("0.000046296296296296");
  });

  it("credits a configured CKI boost reward even when the boost adds zero TH/s", () => {
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki:"1.6", baseThs:"16", boostThs:"0", eligibleSeconds:60, boostRewardCkiPerDay:"24" }]))
      .toBe("0.017777777777777777");
  });

  it("sums package rewards while a temporary hash boost does not multiply a fixed package rate", () => {
    expect(calculatePackageDailyReward([
      { expectedDailyRewardCki: "2", baseThs: "1", boostThs: "0.5", eligibleSeconds: 60 },
      { expectedDailyRewardCki: "3", baseThs: "3", boostThs: "0", eligibleSeconds: 60 },
    ])).toBe("0.003472222222222222");
  });

  it("preserves the pre-existing boost multiplier only for contracts explicitly marked legacy", () => {
    expect(calculatePackageDailyReward([{expectedDailyRewardCki:"2",baseThs:"1",boostThs:"0.5",eligibleSeconds:60,applyBoostMultiplier:true}]))
      .toBe("0.002083333333333333");
    expect(calculatePackageDailyReward([{expectedDailyRewardCki:"2",baseThs:"1",boostThs:"0.5",eligibleSeconds:60}]))
      .toBe("0.001388888888888888");
  });

  it("uses either fixed package reward or TH/s production, never their sum", () => {
    expect(calculatePackageDailyRate({calculationModel:"package_daily",expectedDailyRewardCki:"0.70",baseThs:"7",ckiPerThsPerDay:"0.5"}))
      .toBe("0.700000000000000000");
    expect(calculatePackageDailyRate({calculationModel:"hashrate_daily",expectedDailyRewardCki:"0.70",baseThs:"7",ckiPerThsPerDay:"0.5"}))
      .toBe("3.500000000000000000");
  });

  it("rejects a zero or unsupported TH/s-derived production rate", () => {
    expect(() => calculatePackageDailyRate({calculationModel:"hashrate_daily",expectedDailyRewardCki:null,baseThs:"7",ckiPerThsPerDay:"0"})).toThrow(/CKI production/);
    expect(() => calculatePackageDailyRate({calculationModel:"other" as any,expectedDailyRewardCki:"1",baseThs:"1",ckiPerThsPerDay:"1"})).toThrow(/Unsupported/);
  });

  it("does not invent rewards for a package with no configured daily estimate", () => {
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki: null, baseThs: "1", boostThs: "0", eligibleSeconds: 60 }])).toBe("0.000000000000000000");
  });

  it("rejects negative daily estimates and boosts without purchased base capacity", () => {
    expect(() => calculatePackageDailyReward([{ expectedDailyRewardCki: "-1", baseThs: "1", boostThs: "0", eligibleSeconds: 60 }])).toThrow(/non-negative/);
    expect(() => calculatePackageDailyReward([{ expectedDailyRewardCki: "1", baseThs: "0", boostThs: "1", eligibleSeconds: 60 }])).toThrow(/positive base/);
  });
});

describe("administrator global mining speed multiplier", () => {
  it("defaults to one and validates the supported range", () => {
    expect(normalizeMiningSpeedMultiplier(null).toString()).toBe("1");
    expect(normalizeMiningSpeedMultiplier(undefined).toString()).toBe("1");
    expect(normalizeMiningSpeedMultiplier("").toString()).toBe("1");
    expect(normalizeMiningSpeedMultiplier("2.5").toString()).toBe("2.5");
    expect(normalizeMiningSpeedMultiplier("0.01").toString()).toBe("0.01");
    expect(normalizeMiningSpeedMultiplier("1000").toString()).toBe("1000");
    expect(() => normalizeMiningSpeedMultiplier("0.009")).toThrow(/between/);
    expect(() => normalizeMiningSpeedMultiplier("1000.01")).toThrow(/between/);
    expect(() => normalizeMiningSpeedMultiplier("0")).toThrow(/between/);
  });

  it("scales the fixed package-daily rate without touching the stored snapshot", () => {
    expect(calculatePackageDailyRate({ calculationModel: "package_daily", expectedDailyRewardCki: "0.7", baseThs: "7", ckiPerThsPerDay: "0.5", speedMultiplier: "2" }))
      .toBe("1.400000000000000000");
    expect(calculatePackageDailyRate({ calculationModel: "package_daily", expectedDailyRewardCki: "0.7", baseThs: "7", ckiPerThsPerDay: "0.5" }))
      .toBe(calculatePackageDailyRate({ calculationModel: "package_daily", expectedDailyRewardCki: "0.7", baseThs: "7", ckiPerThsPerDay: "0.5", speedMultiplier: "1" }));
  });

  it("scales the TH/s-derived rate by the same multiplier", () => {
    expect(calculatePackageDailyRate({ calculationModel: "hashrate_daily", expectedDailyRewardCki: null, baseThs: "7", ckiPerThsPerDay: "0.5", speedMultiplier: "0.5" }))
      .toBe("1.750000000000000000");
    expect(calculatePackageDailyRate({ calculationModel: "hashrate_daily", expectedDailyRewardCki: null, baseThs: "7", ckiPerThsPerDay: "0.5", speedMultiplier: "3" }))
      .toBe("10.500000000000000000");
  });

  it("scales the accrued package reward linearly for a full eligible day", () => {
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki: "2", baseThs: "1", boostThs: "0", eligibleSeconds: 86_400, speedMultiplier: "1" }]))
      .toBe("2.000000000000000000");
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki: "2", baseThs: "1", boostThs: "0", eligibleSeconds: 86_400, speedMultiplier: "2" }]))
      .toBe("4.000000000000000000");
  });

  it("applies the speed multiplier to both the base and the boost daily reward", () => {
    expect(calculatePackageDailyReward([{ expectedDailyRewardCki: "0", baseThs: "1", boostThs: "0", eligibleSeconds: 86_400, boostRewardCkiPerDay: "24", speedMultiplier: "2" }]))
      .toBe("48.000000000000000000");
  });

  it("changes reward only when the multiplier changes and never mutates the snapshot", () => {
    const base = { expectedDailyRewardCki: "3.5", baseThs: "5", boostThs: "0", eligibleSeconds: 43_200 };
    expect(calculatePackageDailyReward([{ ...base, speedMultiplier: "4" }]))
      .toBe(new Decimal(calculatePackageDailyReward([{ ...base, speedMultiplier: "2" }])).times(2).toFixed(18));
  });
});

describe("immediate mining accrual gate", () => {
  it("starts accrual without any operations pause switch", () => {
    expect(canStartMiningAccrual({ expectedDailyRewardCki: "1.25" })).toBe(true);
  });

  it("requires a positive configured daily estimate before immediate accrual", () => {
    expect(canStartMiningAccrual({ expectedDailyRewardCki: null })).toBe(false);
    expect(canStartMiningAccrual({ expectedDailyRewardCki: "0" })).toBe(false);
    expect(canStartMiningAccrual({ expectedDailyRewardCki: "0.0001" })).toBe(true);
  });
});

describe("simulated network difficulty index", () => {
  it("scales aggregate hash power against a 100 TH/s simulation reference", () => {
    expect(calculateMiningDifficultyIndex("0", "100")).toBe("1.00");
    expect(calculateMiningDifficultyIndex("12.5", "100")).toBe("1.13");
    expect(calculateMiningDifficultyIndex("100", "100")).toBe("2.00");
  });

  it("rejects negative hash power and a zero reference", () => {
    expect(() => calculateMiningDifficultyIndex("-1", "100")).toThrow(/non-negative/);
    expect(() => calculateMiningDifficultyIndex("1", "0")).toThrow(/greater than zero/);
  });
});

describe("mining conversion rules", () => {
  it("uses the configured internal reference, rate direction, fee, and target precision", () => {
    expect(calculateMiningConversion({ tokenAmount: "1000", tokenUnitsPerUsd: "1000", usdPerTargetUnit: "1.25", feeBps: 100, targetScale: 2 })).toEqual({
      grossAmount: "0.80", feeAmount: "0.01", netAmount: "0.79", rate: "0.00079",
    });
  });

  it("converts 1 CKI to approximately $1.27 at the configured internal reference rate", () => {
    expect(calculateMiningConversion({ tokenAmount: "1", tokenUnitsPerUsd: "0.787401574803149606", usdPerTargetUnit: "1", feeBps: 0, targetScale: 2 })).toEqual({
      grossAmount: "1.27", feeAmount: "0.00", netAmount: "1.27", rate: "1.27",
    });
  });

  it("rounds down and refuses a quote that would disappear at target precision", () => {
    expect(() => calculateMiningConversion({ tokenAmount: "0.1", tokenUnitsPerUsd: "1000", usdPerTargetUnit: "30000", feeBps: 0, targetScale: 8 })).toThrow(/below the target asset/);
  });

  it("rejects rates beyond configured deviation", () => {
    expect(isRateWithinDeviation("101", "100", 200)).toBe(true);
    expect(isRateWithinDeviation("110", "100", 500)).toBe(false);
  });
});

describe("mining time and quote guards", () => {
  it("makes a first boost immediately available and starts its four-hour cooldown at activation", () => {
    const now = new Date("2026-10-11T14:05:00.000Z");
    const cycle = getBoostCooldownWindow(now, null, 4 * 60 * 60);
    expect(cycle.ready).toBe(true);
    expect(cycle.nextEligibleAt.toISOString()).toBe(now.toISOString());
    expect(cycle.expiresAt.toISOString()).toBe("2026-10-11T18:05:00.000Z");
  });

  it("counts four hours from the customer's own previous activation, not a shared clock boundary", () => {
    const now = new Date("2026-10-11T14:05:00.000Z");
    const cycle = getBoostCooldownWindow(now, new Date("2026-10-11T12:10:00.000Z"), 4 * 60 * 60);
    expect(cycle.ready).toBe(false);
    expect(cycle.start.toISOString()).toBe("2026-10-11T12:10:00.000Z");
    expect(cycle.nextEligibleAt.toISOString()).toBe("2026-10-11T16:10:00.000Z");
    expect(getBoostCooldownWindow(new Date("2026-10-11T16:10:00.000Z"), new Date("2026-10-11T12:10:00.000Z"), 4 * 60 * 60).ready).toBe(true);
  });

  it("accepts only non-future quotes inside the freshness limit", () => {
    const now = new Date("2026-10-11T14:00:00.000Z");
    expect(isQuoteFresh(new Date("2026-10-11T13:59:00.000Z"), now, 120)).toBe(true);
    expect(isQuoteFresh(new Date("2026-10-11T13:58:00.000Z"), now, 120)).toBe(true);
    expect(isQuoteFresh(new Date("2026-10-11T13:57:59.999Z"), now, 120)).toBe(false);
    expect(isQuoteFresh(new Date("2026-10-11T13:50:00.000Z"), now, 120)).toBe(false);
    expect(isQuoteFresh(new Date("2026-10-11T14:01:00.000Z"), now, 120)).toBe(false);
  });

  it("rejects invalid quote timestamps and invalid freshness windows", () => {
    const now = new Date("2026-10-11T14:00:00.000Z");
    expect(isQuoteFresh(new Date("invalid"), now, 120)).toBe(false);
    expect(isQuoteFresh(new Date("2026-10-11T13:59:00.000Z"), now, 0)).toBe(false);
    expect(isQuoteFresh(new Date("2026-10-11T13:59:00.000Z"), now, 1.5)).toBe(false);
  });
});
