/**
 * Automatic trade lifecycle mathematics.
 *
 * When a qualifying popup arrives and the customer has sufficient combined
 * spendable balance across wallets, the platform automatically:
 *   1. Debits (locks) the required capital into the trade
 *   2. Runs the trade for the configured duration
 *   3. Credits principal + net profit back to the same wallet currency
 *
 * No customer click or manual confirmation is required. All amounts are
 * integer minor units. Profit uses the same half-up basis-point rounding
 * as the rest of the trading stack.
 */

import { calculateConfiguredProfitMinor } from "./trading-popup-policy";
import { calculateTradeSettlement } from "./trade-settlement";

export type AutomaticTradeDebitInput = {
  /** Required capital in minor units */
  capitalMinor: number;
  currency: string;
  /** Configured profit rate in basis points from the package snapshot */
  profitRateBps: number;
};

export type AutomaticTradeDebitResult = {
  debitedMinor: number;
  currency: string;
  expectedGrossProfitMinor: number;
  expectedCreditMinor: number;
  stage: "capital_locked";
  stageLabel: string;
  transitionText: string;
};

export type AutomaticTradeCreditInput = {
  capitalMinor: number;
  profitRateBps: number;
  currency: string;
  /** Optional realized net profit when settlement has already computed it */
  realizedNetProfitMinor?: number;
};

export type AutomaticTradeCreditResult = {
  creditedPrincipalMinor: number;
  creditedProfitMinor: number;
  totalCreditedMinor: number;
  currency: string;
  stage: "principal_and_profit_credited";
  stageLabel: string;
  transitionText: string;
};

export type AutomaticTradeLifecycleStage =
  | "evaluating_balance"
  | "capital_locking"
  | "capital_locked"
  | "trade_live"
  | "settlement_processing"
  | "principal_and_profit_credited"
  | "completed";

/**
 * Called the moment a customer qualifies for an automatic popup trade.
 * Returns the exact capital that will be locked from available balance
 * and the expected credit totals for the live progress UI.
 */
export function calculateAutomaticTradeDebit(input: AutomaticTradeDebitInput): AutomaticTradeDebitResult {
  const capitalMinor = Number(input.capitalMinor);
  const profitRateBps = Number(input.profitRateBps);

  if (!Number.isSafeInteger(capitalMinor) || capitalMinor < 1) {
    throw new RangeError("Automatic trade capital must be a positive safe integer in minor units");
  }
  if (!Number.isSafeInteger(profitRateBps) || profitRateBps < 0) {
    throw new RangeError("Profit rate must be a non-negative safe integer in basis points");
  }

  const expectedGrossProfitMinor = calculateConfiguredProfitMinor(capitalMinor, profitRateBps);
  const expectedCreditMinor = capitalMinor + expectedGrossProfitMinor;

  if (!Number.isSafeInteger(expectedCreditMinor)) {
    throw new RangeError("Expected credit total exceeds safe integer precision");
  }

  return {
    debitedMinor: capitalMinor,
    currency: String(input.currency).trim().toUpperCase(),
    expectedGrossProfitMinor,
    expectedCreditMinor,
    stage: "capital_locked",
    stageLabel: "Capital locked into trade",
    transitionText: "Capital locked into trade from available balance",
  };
}

/**
 * Called when settlement completes and principal + profit are returned.
 * Prefer realizedNetProfitMinor when the settlement engine has already
 * applied fees; otherwise falls back to configured gross profit.
 */
export function calculateAutomaticTradeCredit(input: AutomaticTradeCreditInput): AutomaticTradeCreditResult {
  const capitalMinor = Number(input.capitalMinor);
  const profitRateBps = Number(input.profitRateBps);

  if (!Number.isSafeInteger(capitalMinor) || capitalMinor < 0) {
    throw new RangeError("Principal must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(profitRateBps) || profitRateBps < 0) {
    throw new RangeError("Profit rate must be a non-negative safe integer in basis points");
  }

  const configuredProfit =
    capitalMinor < 1 ? 0 : calculateConfiguredProfitMinor(capitalMinor, profitRateBps);

  const profitMinor =
    input.realizedNetProfitMinor !== undefined && Number.isSafeInteger(input.realizedNetProfitMinor)
      ? Math.max(0, Number(input.realizedNetProfitMinor))
      : configuredProfit;

  const settlement = calculateTradeSettlement({
    currency: input.currency,
    principalMinor: capitalMinor,
    rewardMinor: profitMinor,
  });

  return {
    creditedPrincipalMinor: settlement.principalMinor,
    creditedProfitMinor: settlement.rewardMinor,
    totalCreditedMinor: settlement.totalMinor,
    currency: settlement.walletCurrency,
    stage: "principal_and_profit_credited",
    stageLabel: "Principal and profit credited",
    transitionText: "Principal and profit credited to wallet",
  };
}

/**
 * Full cycle helper for diagnostics and UI previews.
 */
export function calculateAutomaticTradeCycle(
  capitalMinor: number,
  profitRateBps: number,
  currency: string,
) {
  const debit = calculateAutomaticTradeDebit({ capitalMinor, profitRateBps, currency });
  const credit = calculateAutomaticTradeCredit({ capitalMinor, profitRateBps, currency });
  return { debit, credit };
}

/**
 * Human-readable stage labels for the live progress UI.
 */
export function automaticTradeStageLabel(stage: AutomaticTradeLifecycleStage): string {
  switch (stage) {
    case "evaluating_balance":
      return "Evaluating combined wallet balance";
    case "capital_locking":
      return "Locking capital across wallets";
    case "capital_locked":
      return "Capital locked into trade";
    case "trade_live":
      return "Trade executing";
    case "settlement_processing":
      return "Settlement processing";
    case "principal_and_profit_credited":
      return "Principal and profit credited";
    case "completed":
      return "Trade completed";
    default:
      return "Processing";
  }
}
