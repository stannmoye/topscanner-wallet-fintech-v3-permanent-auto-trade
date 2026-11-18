import { describe, expect, it } from "vitest";
import {
  TRADING_TIER_POLICY_ENUM_BOUNDS,
  TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS,
  TRADING_TIER_POLICY_NUMERIC_BOUNDS,
  TRADING_TIER_POLICY_STRING_BOUNDS,
} from "@shared/trading-tier-policy-bounds";
import { TRADING_TIER_POLICY_PATCH_KEYS } from "./trading-policy-patches";
import { tradingPolicyRowErrorMap, tradingPolicyRowValid, validateTradingPolicyRow } from "./trading-policy-validation";
import type { TradingDeliveryPolicyRow } from "./components/TradingDeliveryPolicyEditor";

const baseRow: TradingDeliveryPolicyRow = {
  packageName: "Imperial Ledger",
  policyVersion: 3,
  enabled: true,
  automaticDelivery: true,
  automaticTradingEnabled: true,
  badgeLabel: "Premium",
  badgeStyle: "purple",
  minimumPayoutRateBps: 270,
  maximumPayoutRateBps: 420,
  minimumTradeDurationSeconds: 120,
  maximumTradeDurationSeconds: 600,
  companyRotationEnabled: true,
  companyRotationCountryNames: "",
  companyRotationRepeatPolicy: "avoid_until_exhausted",
  maxPopupsPerDay: 600,
  maxVisibleOffers: 5,
  minimumTradeUnits: 100,
  maximumTradeUnits: 5000,
  minHourlyTarget: 1,
  normalHourlyTarget: 10,
  marketInfluenceBps: 500,
  burstEnabled: true,
  maxBurstSize: 3,
  dailyPopupTarget: 0,
  schedulingPeriod: "rolling_24h",
  minIntervalSeconds: 60,
  maxIntervalSeconds: 600,
  randomizationEnabled: true,
  completionDisplaySeconds: 8,
  postCompletionIntervalSeconds: 30,
  maxPendingDeliveries: 3,
  maxTradeAttemptsPerDay: 5,
  tradeRetryDelaySeconds: 30,
  maxSuccessfulTradesPerDay: 2,
  maxConcurrentActiveTrades: 2,
  requirePreviousSettlement: true,
  minSettlementDelaySeconds: 0,
  maxSettlementDelaySeconds: 300,
  minimumRewardBps: 0,
  maxDailyRewardMinor: 0,
  maxRewardPerTradeMinor: 0,
  closePolicy: "after_completion",
};

const row = (overrides: Partial<TradingDeliveryPolicyRow> = {}): TradingDeliveryPolicyRow => ({ ...baseRow, ...overrides });
const errorFields = (value: TradingDeliveryPolicyRow) => validateTradingPolicyRow(value).map((item) => item.field).sort();

describe("per-tier policy validation (item 32)", () => {
  it("accepts a complete, in-range tier row", () => {
    expect(validateTradingPolicyRow(baseRow)).toEqual([]);
    expect(tradingPolicyRowValid(baseRow)).toBe(true);
    expect(tradingPolicyRowErrorMap(baseRow)).toEqual({});
  });

  it("validates every editable per-tier field present in the shared bounds", () => {
    const covered = new Set<string>([
      ...Object.keys(TRADING_TIER_POLICY_NUMERIC_BOUNDS),
      ...Object.keys(TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS),
      ...Object.keys(TRADING_TIER_POLICY_STRING_BOUNDS),
      ...Object.keys(TRADING_TIER_POLICY_ENUM_BOUNDS),
    ]);
    expect([...covered].sort()).toEqual([...TRADING_TIER_POLICY_PATCH_KEYS].sort());
  });

  it("rejects a numeric field outside the server range", () => {
    expect(errorFields(row({ maxPopupsPerDay: 0 }))).toContain("maxPopupsPerDay");
    expect(errorFields(row({ maxVisibleOffers: 10_001 }))).toContain("maxVisibleOffers");
    expect(errorFields(row({ tradeRetryDelaySeconds: 4 }))).toContain("tradeRetryDelaySeconds");
    expect(errorFields(row({ minimumTradeUnits: 0 }))).toContain("minimumTradeUnits");
    expect(errorFields(row({ completionDisplaySeconds: 3601 }))).toContain("completionDisplaySeconds");
    expect(errorFields(row({ maxConcurrentActiveTrades: 0 }))).toContain("maxConcurrentActiveTrades");
    expect(validateTradingPolicyRow(row({ maxPopupsPerDay: 0 }))[0].message).toContain("between 1 and 1000");
  });

  it("rejects a non-integer where a whole number is required", () => {
    expect(errorFields(row({ maxVisibleOffers: 5.5 }))).toContain("maxVisibleOffers");
  });

  it("validates nullable bounds only when set", () => {
    expect(tradingPolicyRowValid(row({ minimumPayoutRateBps: null, maximumPayoutRateBps: null, minimumTradeDurationSeconds: null, maximumTradeDurationSeconds: null, enabled: false, automaticDelivery: false, automaticTradingEnabled: false }))).toBe(true);
    expect(errorFields(row({ minimumPayoutRateBps: 5001 }))).toContain("minimumPayoutRateBps");
    expect(errorFields(row({ maximumTradeDurationSeconds: 86401 }))).toContain("maximumTradeDurationSeconds");
    expect(errorFields(row({ minimumTradeDurationSeconds: 9 }))).toContain("minimumTradeDurationSeconds");
  });

  it("requires paired configured-return and duration bounds", () => {
    const unpairedRate = errorFields(row({ minimumPayoutRateBps: null }));
    expect(unpairedRate).toContain("minimumPayoutRateBps");
    expect(validateTradingPolicyRow(row({ minimumPayoutRateBps: null }))[0].message).toContain("both configured return rate bounds");

    const unpairedDuration = errorFields(row({ maximumTradeDurationSeconds: null }));
    expect(unpairedDuration).toContain("maximumTradeDurationSeconds");

    expect(errorFields(row({ minimumPayoutRateBps: 400, maximumPayoutRateBps: 300 }))).toContain("maximumPayoutRateBps");
    expect(errorFields(row({ minimumTradeDurationSeconds: 600, maximumTradeDurationSeconds: 120 }))).toContain("maximumTradeDurationSeconds");
  });

  it("enforces ordering on editable numeric pairs", () => {
    expect(errorFields(row({ minimumTradeUnits: 5000, maximumTradeUnits: 100 }))).toContain("maximumTradeUnits");
    expect(errorFields(row({ minIntervalSeconds: 600, maxIntervalSeconds: 60 }))).toContain("maxIntervalSeconds");
    expect(errorFields(row({ minSettlementDelaySeconds: 600, maxSettlementDelaySeconds: 60 }))).toContain("maxSettlementDelaySeconds");
  });

  it("rejects an unknown enum value and an over-long string", () => {
    expect(errorFields(row({ badgeStyle: "rainbow" as TradingDeliveryPolicyRow["badgeStyle"] }))).toContain("badgeStyle");
    expect(errorFields(row({ schedulingPeriod: "week" as TradingDeliveryPolicyRow["schedulingPeriod"] }))).toContain("schedulingPeriod");
    expect(errorFields(row({ closePolicy: "whenever" as TradingDeliveryPolicyRow["closePolicy"] }))).toContain("closePolicy");
    expect(errorFields(row({ badgeLabel: "x".repeat(41) }))).toContain("badgeLabel");
    expect(errorFields(row({ companyRotationCountryNames: "y".repeat(2001) }))).toContain("companyRotationCountryNames");
  });

  it("requires positive configured offer terms before enabling delivery", () => {
    const errors = errorFields(row({ enabled: true, automaticDelivery: true, minimumPayoutRateBps: 0, maximumPayoutRateBps: null, minimumTradeDurationSeconds: null, maximumTradeDurationSeconds: null }));
    expect(errors).toContain("minimumPayoutRateBps");
    expect(errors).toContain("maximumPayoutRateBps");
    expect(errors).toContain("minimumTradeDurationSeconds");
    expect(errors).toContain("maximumTradeDurationSeconds");
    expect(tradingPolicyRowValid(row({ enabled: true, automaticDelivery: true, minimumPayoutRateBps: 1, maximumPayoutRateBps: 1 }))).toBe(true);
  });

  it("requires an enabled, delivering tier before automatic trading", () => {
    expect(errorFields(row({ automaticTradingEnabled: true, enabled: false }))).toContain("automaticTradingEnabled");
    expect(errorFields(row({ automaticTradingEnabled: true, automaticDelivery: false }))).toContain("automaticTradingEnabled");
  });

  it("reports switch fields that are not explicit booleans", () => {
    expect(errorFields(row({ enabled: "true" as unknown as boolean }))).toContain("enabled");
  });

  it("returns one field-level message map entry per invalid field", () => {
    const map = tradingPolicyRowErrorMap(row({ maxPopupsPerDay: 0, badgeStyle: "rainbow" as TradingDeliveryPolicyRow["badgeStyle"] }));
    expect(Object.keys(map).sort()).toEqual(["badgeStyle", "maxPopupsPerDay"]);
    expect(map.maxPopupsPerDay).toContain("Hard daily pop-up ceiling");
  });
});
