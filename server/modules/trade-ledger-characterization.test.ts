/**
 * Characterization tests for the automatic-trade ledger flow.
 *
 * These lock in TODAY'S observable behaviour so the later protected-area items
 * (9, 10, 14, 17, 18, 19, 20, 30) cannot silently change debit/credit amounts,
 * wallet balance movements or the settlement reconciliation result.
 *
 * The suite is deliberately pure: the running environment has no MariaDB, so we
 * characterise the exact mathematics and ledger contracts that the transactional
 * code in `db.ts` consumes. Every helper exercised here is the same one the
 * transactional path calls.
 *
 * Expectations that a later item is allowed to change are marked inline:
 *   - item 19 removes the loss clamp in automatic-trade-lifecycle-math.
 *   - item 20 removes the platform fee entirely.
 */

import { describe, expect, it } from "vitest";
import {
  calculateCombinedAvailableTargetMinor,
  planCrossWalletFunding,
  type CrossWalletFundingPlan,
  type FxRateSnapshot,
} from "./trading-wallet-fx";
import {
  calculateAutomaticTradeCredit,
  calculateAutomaticTradeDebit,
} from "./automatic-trade-lifecycle-math";
import { calculateRealizedProfitSettlement } from "./realized-profit-accounting";
import {
  buildExpectedSettlementPostings,
  inspectSettlementLedgerPostings,
  type SettlementLedgerEntry,
  type SettlementLedgerSnapshot,
} from "./wallet-ledger-reconciliation";

const rate = (currency: string, scale: number, rateUsdPerUnit: string): FxRateSnapshot => ({
  currency,
  scale,
  rateUsdPerUnit,
  provider: "test-api",
  sourceDate: "2026-10-29T10:00:00.000Z",
  fetchedAt: new Date("2026-10-29T10:00:00.000Z"),
});

type WalletState = { currency: string; scale: number; availableMinor: number; lockedMinor: number; earnedMinor: number };

/** Applies a funding plan's source debits and target credit to wallet state. */
function applyFundingPlan(
  wallets: WalletState[],
  plan: CrossWalletFundingPlan,
  targetCurrency: string,
): WalletState[] {
  const next = wallets.map(wallet => ({ ...wallet }));
  for (const debit of plan.sourceDebits) {
    const source = next.find(wallet => wallet.currency === debit.currency);
    if (!source) throw new Error("missing source wallet in characterization model");
    source.availableMinor -= debit.amountMinor;
  }
  const target = next.find(wallet => wallet.currency === targetCurrency);
  if (!target) throw new Error("missing target wallet in characterization model");
  target.availableMinor += plan.targetCreditMinor;
  return next;
}

/** Locks the specified capital in the target wallet (debit available -> locked). */
function applyCapitalLock(wallets: WalletState[], targetCurrency: string, capitalMinor: number): WalletState[] {
  const next = wallets.map(wallet => ({ ...wallet }));
  const target = next.find(wallet => wallet.currency === targetCurrency);
  if (!target) throw new Error("missing target wallet in characterization model");
  target.availableMinor -= capitalMinor;
  target.lockedMinor += capitalMinor;
  return next;
}

/** Releases locked principal and credits principal + profit on settlement. */
function applySettlementCredit(
  wallets: WalletState[],
  targetCurrency: string,
  principalMinor: number,
  profitMinor: number,
): WalletState[] {
  const next = wallets.map(wallet => ({ ...wallet }));
  const target = next.find(wallet => wallet.currency === targetCurrency);
  if (!target) throw new Error("missing target wallet in characterization model");
  target.lockedMinor -= principalMinor;
  target.availableMinor += principalMinor + profitMinor;
  target.earnedMinor += profitMinor;
  return next;
}

describe("characterization: cross-wallet FX funding", () => {
  it("plans an all-or-none conversion and moves only available funds", () => {
    const wallets: WalletState[] = [
      { currency: "USD", scale: 2, availableMinor: 5_000, lockedMinor: 0, earnedMinor: 0 },
      { currency: "EUR", scale: 2, availableMinor: 10_000, lockedMinor: 0, earnedMinor: 0 },
    ];
    const plan = planCrossWalletFunding({
      requiredTargetMinor: 10_000,
      targetAvailableMinor: 5_000,
      targetRate: rate("USD", 2, "1"),
      sourceWallets: [{ currency: "EUR", scale: 2, availableMinor: 10_000, rate: rate("EUR", 2, "1.1") }],
    });

    expect(plan.targetCreditMinor).toBe(5_000);
    expect(plan.sourceDebits).toEqual([
      expect.objectContaining({ currency: "EUR", amountMinor: 4_546, convertedTargetMinor: 5_000 }),
    ]);

    const funded = applyFundingPlan(wallets, plan, "USD");
    expect(funded.find(w => w.currency === "USD")).toMatchObject({ availableMinor: 10_000, lockedMinor: 0, earnedMinor: 0 });
    expect(funded.find(w => w.currency === "EUR")).toMatchObject({ availableMinor: 5_454, lockedMinor: 0, earnedMinor: 0 });

    const locked = applyCapitalLock(funded, "USD", 10_000);
    expect(locked.find(w => w.currency === "USD")).toMatchObject({ availableMinor: 0, lockedMinor: 10_000 });
    expect(locked.find(w => w.currency === "EUR")).toMatchObject({ availableMinor: 5_454, lockedMinor: 0 });

    // Today's settlement keeps the platform fee; item 20 removes it.
    const settled = applySettlementCredit(locked, "USD", 10_000, 225);
    expect(settled.find(w => w.currency === "USD")).toMatchObject({ availableMinor: 10_225, lockedMinor: 0, earnedMinor: 225 });
    expect(settled.find(w => w.currency === "EUR")).toMatchObject({ availableMinor: 5_454, earnedMinor: 0 });
  });

  it("matches the combined spendable balance calculator used by the display layer", () => {
    const combined = calculateCombinedAvailableTargetMinor({
      targetCurrency: "USD",
      targetRate: rate("USD", 2, "1"),
      wallets: [
        { currency: "USD", scale: 2, availableMinor: 5_000 },
        { currency: "EUR", scale: 2, availableMinor: 10_000, rate: rate("EUR", 2, "1.1") },
      ],
    });
    expect(combined).toBe(16_000);
  });
});

describe("characterization: automatic trade debit and credit", () => {
  it("locks exactly the capital and credits principal plus configured return", () => {
    const debit = calculateAutomaticTradeDebit({ capitalMinor: 10_000, profitRateBps: 250, currency: "usd" });
    expect(debit).toMatchObject({
      debitedMinor: 10_000,
      expectedGrossProfitMinor: 250,
      expectedCreditMinor: 10_250,
      currency: "USD",
      stage: "capital_locked",
    });

    const credit = calculateAutomaticTradeCredit({ capitalMinor: 10_000, profitRateBps: 250, currency: "USD" });
    expect(credit).toMatchObject({
      creditedPrincipalMinor: 10_000,
      creditedProfitMinor: 250,
      totalCreditedMinor: 10_250,
      stage: "principal_and_profit_credited",
    });
  });

  it("uses the realized net profit when the settlement engine supplies it", () => {
    const credit = calculateAutomaticTradeCredit({
      capitalMinor: 10_000,
      profitRateBps: 250,
      currency: "USD",
      realizedNetProfitMinor: 225,
    });
    expect(credit).toMatchObject({ creditedPrincipalMinor: 10_000, creditedProfitMinor: 225, totalCreditedMinor: 10_225 });
  });

  it("characterizes today's no-loss clamp on realized profit (item 19 changes this)", () => {
    // Today a negative realized result is clamped to zero, so the lifecycle total
    // credit always equals principal. Item 19 keeps the no-loss guarantee but makes
    // reporting reflect the real credit; the clamp expectation is intentionally here.
    const credit = calculateAutomaticTradeCredit({
      capitalMinor: 10_000,
      profitRateBps: 250,
      currency: "USD",
      realizedNetProfitMinor: -400,
    });
    expect(credit.creditedProfitMinor).toBe(0);
    expect(credit.totalCreditedMinor).toBe(10_000);
  });
});

describe("characterization: realized profit settlement (fee behaviour, item 20)", () => {
  it("computes fee on positive gross profit and returns principal plus net", () => {
    const accounting = calculateRealizedProfitSettlement({
      principalMinor: 10_000,
      grossProfitMinor: 250,
      feeRateBps: 1_000,
      roundingMode: "half_up",
    });
    expect(accounting).toMatchObject({
      principalMinor: 10_000,
      grossProfitMinor: 250,
      platformFeeMinor: 25,
      netProfitMinor: 225,
      totalReturnedMinor: 10_225,
      rewardCreditedMinor: 225,
      outcome: "profit",
    });
  });

  it("charges no fee on a loss and reports the loss outcome", () => {
    const accounting = calculateRealizedProfitSettlement({
      principalMinor: 10_000,
      grossProfitMinor: -300,
      feeRateBps: 1_000,
      roundingMode: "half_up",
    });
    expect(accounting).toMatchObject({
      platformFeeMinor: 0,
      netProfitMinor: -300,
      totalReturnedMinor: 9_700,
      rewardCreditedMinor: 0,
      outcome: "loss",
    });
  });
});

describe("characterization: settlement ledger and reconciliation", () => {
  const settledTrade: SettlementLedgerSnapshot = {
    tradeId: 1001,
    userId: 42,
    currency: "USD",
    principalMinor: 10_000,
    status: "settled",
    settlementStatus: "completed",
    settlementOutcome: "profit",
    settlementReference: "trade-1001-settle",
    realizedGrossProfitMinor: 250,
    platformFeeMinor: 25,
    netProfitMinor: 225,
    rewardCreditedMinor: 225,
    platformFeeRateBps: 1_000,
    platformFeeRoundingMode: "half_up",
    feePolicyVersion: 1,
  };

  const expectedEntries: SettlementLedgerEntry[] = [
    { id: 1, userId: 42, currency: "USD", amountMinor: 10_000, entryType: "trade_principal_release", reference: "trade-1001-settle:principal" },
    { id: 2, userId: 42, currency: "USD", amountMinor: 250, entryType: "trade_reward", reference: "trade-1001-settle:gross-profit" },
    { id: 3, userId: 42, currency: "USD", amountMinor: -25, entryType: "trade_platform_fee", reference: "trade-1001-settle:platform-fee" },
  ];

  it("derives the exact settlement ledger postings", () => {
    const { expected, issues } = buildExpectedSettlementPostings(settledTrade);
    expect(issues).toEqual([]);
    expect(expected).toEqual([
      { userId: 42, currency: "USD", amountMinor: 10_000, entryType: "trade_principal_release", reference: "trade-1001-settle:principal" },
      { userId: 42, currency: "USD", amountMinor: 250, entryType: "trade_reward", reference: "trade-1001-settle:gross-profit" },
      { userId: 42, currency: "USD", amountMinor: -25, entryType: "trade_platform_fee", reference: "trade-1001-settle:platform-fee" },
    ]);
  });

  it("reconciles cleanly when every expected ledger posting is present exactly once", () => {
    const result = inspectSettlementLedgerPostings(settledTrade, expectedEntries);
    expect(result.issues.filter(issue => issue.confidence === "confirmed")).toEqual([]);
    expect(result).toMatchObject({ tradeId: 1001, userId: 42, currency: "USD", platformFeeMinor: 25, netProfitMinor: 225 });
  });

  it("flags a missing or mismatched posting as a confirmed issue", () => {
    const missing = inspectSettlementLedgerPostings(settledTrade, expectedEntries.slice(0, 2));
    expect(missing.issues.some(issue => issue.code === "settlement_ledger_posting_missing" && issue.confidence === "confirmed")).toBe(true);

    const mismatched = inspectSettlementLedgerPostings(settledTrade, [
      { ...expectedEntries[0], amountMinor: 9_999 },
      expectedEntries[1],
      expectedEntries[2],
    ]);
    expect(mismatched.issues.some(issue => issue.code === "settlement_ledger_posting_mismatch")).toBe(true);
  });
});
