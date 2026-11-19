import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideTradeExecutionRetry } from "./modules/trade-execution-retry";
import { canReserveReward, remainingRewardAllowance } from "./modules/advanced-auto-trading";

const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const createTradeStart = source.indexOf("export async function createTrade(");
const createTradeEnd = source.indexOf("\nexport async function listTrades(", createTradeStart);
const createTrade = source.slice(createTradeStart, createTradeEnd);

const BLOCKED_CODES = [
  "NO_ELIGIBLE_TIER",
  "DAILY_OPPORTUNITY_QUOTA_EXHAUSTED",
  "TIER_ACTIVE_INVESTMENT_LIMIT_REACHED",
  "CONCURRENT_ACTIVE_TRADE_LIMIT_REACHED",
  "DAILY_SUCCESSFUL_TRADE_LIMIT_REACHED",
  "DAILY_REWARD_CEILING_REACHED",
];

describe("allocation cap enforcement (item 10)", () => {
  it("fails closed instead of silently falling back to every subscription", () => {
    expect(createTradeStart).toBeGreaterThanOrEqual(0);
    expect(createTradeEnd).toBeGreaterThan(createTradeStart);
    expect(createTrade).not.toContain("subscriptionsWithQuota=eligibleSubscriptions.slice()");
    expect(createTrade).not.toContain("eligibleSubscriptions=activePackageSubscriptions.slice()");
    expect(createTrade).toContain("const eligibleSubscriptions=activePackageSubscriptions.filter");
    expect(createTrade).toContain("const subscriptionsWithQuota=eligibleSubscriptions.filter");
    expect(createTrade).toContain('throw allocationBlockedError("NO_ELIGIBLE_TIER"');
    expect(createTrade).toContain('throw allocationBlockedError("DAILY_OPPORTUNITY_QUOTA_EXHAUSTED"');
  });

  it("enforces the tier active-investment cap only when the administrator sets it above zero", () => {
    expect(createTrade).toContain("const tierActiveLimit=Number(activeTermsSnapshot.maxActiveInvestments??activePackageSubscription.maxActiveInvestments??0)");
    expect(createTrade).toContain("if(tierActiveLimit>0){");
    expect(createTrade).toContain("packageSubscriptionId=${selectedSubscriptionId}");
    expect(createTrade).toContain('throw allocationBlockedError("TIER_ACTIVE_INVESTMENT_LIMIT_REACHED"');
    expect(createTrade).not.toContain("void tierActiveLimit");
  });

  it("enforces the customer-wide concurrency and daily successful-trade caps", () => {
    expect(createTrade).toContain("const maxConcurrentActiveTrades=Number(packagePolicy.maxConcurrentActiveTrades)");
    expect(createTrade).toContain('throw allocationBlockedError("CONCURRENT_ACTIVE_TRADE_LIMIT_REACHED"');
    expect(createTrade).toContain("const maxSuccessfulTradesPerDay=Number(packagePolicy.maxSuccessfulTradesPerDay)");
    expect(createTrade).toContain("if(maxSuccessfulTradesPerDay>0){");
    expect(createTrade).toContain('throw allocationBlockedError("DAILY_SUCCESSFUL_TRADE_LIMIT_REACHED"');
    expect(createTrade).not.toContain("void packagePolicy.maxConcurrentActiveTrades");
    expect(createTrade).not.toContain("void packagePolicy.maxSuccessfulTradesPerDay");
  });

  it("enforces the daily reward ceiling before any wallet debit", () => {
    expect(createTrade).toContain("canReserveReward(Number(packagePolicy.maxDailyRewardMinor),credited,reserved,reward)");
    expect(createTrade).toContain('throw allocationBlockedError("DAILY_REWARD_CEILING_REACHED"');
    expect(createTrade).not.toContain("void remainingRewardAllowance");
    const ceilingIndex = createTrade.indexOf('throw allocationBlockedError("DAILY_REWARD_CEILING_REACHED"');
    const reservationIndex = createTrade.indexOf('entryType:"trade_reservation"');
    expect(ceilingIndex).toBeGreaterThanOrEqual(0);
    expect(reservationIndex).toBeGreaterThan(ceilingIndex);
  });

  it("attaches an uppercase code so each block is a terminal, auditable state", () => {
    const helper = source.slice(source.indexOf("function allocationBlockedError("), createTradeStart);
    expect(helper).toContain("error.code=code");
    for (const code of BLOCKED_CODES) {
      expect(code).toMatch(/^[A-Z0-9_]{1,80}$/);
      expect(createTrade).toContain(`allocationBlockedError("${code}"`);
      // decideTradeExecutionRetry preserves the code and treats it as a terminal
      // failure, which the worker records as the missed-opportunity reason.
      const error = new Error("business block") as Error & { code: string };
      error.code = code;
      expect(decideTradeExecutionRetry(error, 1, 5, new Date())).toEqual({ kind: "failed", attemptNumber: 1, errorCode: code });
    }
  });

  it("treats a zero cap as no cap only where the tier editor documents it", () => {
    // maxDailyRewardMinor = 0 disables the ceiling; a positive cap limits reward.
    expect(canReserveReward(1000, 0, 0, 1000)).toBe(true);
    expect(canReserveReward(1000, 0, 0, 1001)).toBe(false);
    expect(canReserveReward(1000, 600, 300, 100)).toBe(true);
    expect(canReserveReward(1000, 600, 400, 1)).toBe(false);
    expect(remainingRewardAllowance(1000, 600, 300)).toBe(100);
  });

  it("stops creating or showing an opportunity for a package once its daily successful-trade cap is reached", () => {
    const start = source.indexOf("export async function listCustomerOpportunities(");
    const end = source.indexOf("\nexport async function claimAutoTradeCycleCustomers(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const delivery = source.slice(start, end);
    // The cap is the single generation gate: a package at its UTC-day settled-trade
    // ceiling is dropped from generation, delivery, execution and the offer feed.
    expect(delivery).toContain("const packageHasDailySuccessfulCapacity=(packageName:string|null|undefined):boolean=>");
    expect(delivery).toContain("return successfulTradesTodayUtc<cap;");
    expect(delivery).toContain(".filter(subscription=>subscriptionHasDailySuccessfulCapacity(subscription))");
    expect(delivery).toContain(".filter(row=>packageHasDailySuccessfulCapacity(row.packageName));");
    expect(delivery).toContain("&&subscriptionHasDailySuccessfulCapacity(subscription);");
    expect(delivery).toContain("&&subscriptionHasDailySuccessfulCapacity(assignedSubscription);");
    // No pop-up (and therefore no hold or debit) is produced once every package is capped.
    expect(delivery).toContain("if(eligibleSubscriptions.every(subscription=>!subscriptionHasDailySuccessfulCapacity(subscription))){");
    expect(delivery).toContain('"DAILY_SUCCESSFUL_TRADE_LIMIT_REACHED"');
    const earlyReturn = delivery.indexOf("if(eligibleSubscriptions.every(subscription=>!subscriptionHasDailySuccessfulCapacity(subscription))){");
    const generation = delivery.indexOf("await generateAutomaticCustomerOpportunity({");
    expect(earlyReturn).toBeGreaterThanOrEqual(0);
    expect(generation).toBeGreaterThan(earlyReturn);
  });
});
