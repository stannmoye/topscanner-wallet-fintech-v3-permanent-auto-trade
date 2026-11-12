import { describe, expect, it } from "vitest";
import {
  calculateAutomaticTradeDebit,
  calculateAutomaticTradeCredit,
  calculateAutomaticTradeCycle,
  automaticTradeStageLabel,
} from "./automatic-trade-lifecycle-math";

describe("automatic-trade-lifecycle-math", () => {
  it("calculates debit side when customer qualifies", () => {
    const result = calculateAutomaticTradeDebit({
      capitalMinor: 100_00,
      currency: "USD",
      profitRateBps: 270,
    });
    expect(result.debitedMinor).toBe(100_00);
    expect(result.currency).toBe("USD");
    expect(result.expectedGrossProfitMinor).toBe(270);
    expect(result.expectedCreditMinor).toBe(102_70);
    expect(result.stage).toBe("capital_locked");
    expect(result.transitionText).toContain("Capital locked");
  });

  it("calculates credit side with principal and profit", () => {
    const result = calculateAutomaticTradeCredit({
      capitalMinor: 100_00,
      profitRateBps: 270,
      currency: "usd",
    });
    expect(result.creditedPrincipalMinor).toBe(100_00);
    expect(result.creditedProfitMinor).toBe(270);
    expect(result.totalCreditedMinor).toBe(102_70);
    expect(result.currency).toBe("USD");
    expect(result.stage).toBe("principal_and_profit_credited");
    expect(result.transitionText).toContain("credited");
  });

  it("prefers realized net profit when provided", () => {
    const result = calculateAutomaticTradeCredit({
      capitalMinor: 100_00,
      profitRateBps: 270,
      currency: "USD",
      realizedNetProfitMinor: 200,
    });
    expect(result.creditedProfitMinor).toBe(200);
    expect(result.totalCreditedMinor).toBe(102_00);
  });

  it("full cycle is consistent", () => {
    const cycle = calculateAutomaticTradeCycle(50_00, 500, "EUR");
    expect(cycle.debit.debitedMinor).toBe(50_00);
    expect(cycle.debit.expectedGrossProfitMinor).toBe(250);
    expect(cycle.credit.totalCreditedMinor).toBe(52_50);
  });

  it("rejects invalid capital on debit", () => {
    expect(() =>
      calculateAutomaticTradeDebit({ capitalMinor: 0, currency: "USD", profitRateBps: 100 }),
    ).toThrow(/positive/);
  });

  it("exposes human stage labels", () => {
    expect(automaticTradeStageLabel("capital_locked")).toBe("Capital locked into trade");
    expect(automaticTradeStageLabel("principal_and_profit_credited")).toBe(
      "Principal and profit credited",
    );
  });
});
