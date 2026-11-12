import type { opportunityPackagePolicies } from "../../drizzle/schema";

export type OpportunityPackagePolicyRow = typeof opportunityPackagePolicies.$inferSelect;

/**
 * The package policy editor may patch only these package-owned fields.
 * Global delivery masters and immutable/version metadata are deliberately absent.
 */
export const PACKAGE_OPPORTUNITY_POLICY_PATCH_KEYS = [
  "maxPopupsPerDay", "maxVisibleOffers", "minimumTradeUnits", "maximumTradeUnits",
  "minHourlyTarget", "normalHourlyTarget", "marketInfluenceBps", "maxBurstSize",
  "dailyPopupTarget", "schedulingPeriod", "minIntervalSeconds", "maxIntervalSeconds",
  "completionDisplaySeconds", "postCompletionIntervalSeconds",
  "maxPendingDeliveries", "maxTradeAttemptsPerDay",
  "tradeRetryDelaySeconds", "maxSuccessfulTradesPerDay", "maxConcurrentActiveTrades",
  "minSettlementDelaySeconds", "maxSettlementDelaySeconds", "minimumRewardBps",
  "maxDailyRewardMinor", "maxRewardPerTradeMinor", "badgeLabel", "badgeStyle",
  "minimumPayoutRateBps", "maximumPayoutRateBps", "minimumTradeDurationSeconds",
  "maximumTradeDurationSeconds", "companyRotationCountryNames", "companyRotationRepeatPolicy",
  "closePolicy",
] as const satisfies readonly (keyof OpportunityPackagePolicyRow)[];

export type PackageOpportunityPolicyPatch = Pick<OpportunityPackagePolicyRow, "packageName"> &
  Partial<Pick<OpportunityPackagePolicyRow, (typeof PACKAGE_OPPORTUNITY_POLICY_PATCH_KEYS)[number]>>;

/**
 * Defaults for a newly created package's policy row.
 *
 * A newly created package is ready for informational opportunity delivery once
 * its package lifecycle is enabled. Global delivery masters remain separately
 * owned by Package Configuration. Automatic financial execution is deliberately
 * OFF; this policy must never reserve or debit customer funds by default.
 */
export const DEFAULT_NEW_PACKAGE_OPPORTUNITY_POLICY = {
  badgeLabel: null,
  badgeStyle: "neutral",
  minimumPayoutRateBps: 200,
  maximumPayoutRateBps: 300,
  minimumTradeDurationSeconds: 300,
  maximumTradeDurationSeconds: 900,
  companyRotationEnabled: false,
  companyRotationCountryNames: null,
  companyRotationRepeatPolicy: "avoid_until_exhausted",
  maxPopupsPerDay: 10,
  maxVisibleOffers: 3,
  minimumTradeUnits: 1000,
  maximumTradeUnits: 100000,
  minHourlyTarget: 0,
  normalHourlyTarget: 0,
  marketInfluenceBps: 0,
  burstEnabled: false,
  maxBurstSize: 3,
  enabled: true,
  automaticDelivery: true,
  dailyPopupTarget: 10,
  schedulingPeriod: "rolling_24h",
  minIntervalSeconds: 45,
  maxIntervalSeconds: 3600,
  randomizationEnabled: false,
  // Legacy compatibility column only; runtime display/expiry uses the selected duration bounds above.
  popupDisplayTargetSeconds: 300,
  completionDisplaySeconds: 8,
  postCompletionIntervalSeconds: 30,
  maxPendingDeliveries: 3,
  deliveryRetryPolicy: "temporary",
  maxDeliveryAttempts: 3,
  expiryHandling: "expire",
  duplicatePrevention: true,
  audioEnabled: true,
  audioSound: "soft-chime",
  automaticTradingEnabled: false,
  maxTradeAttemptsPerDay: 0,
  tradeRetryDelaySeconds: 30,
  maxSuccessfulTradesPerDay: 0,
  maxConcurrentActiveTrades: 1,
  requirePreviousSettlement: true,
  minSettlementDelaySeconds: 900,
  maxSettlementDelaySeconds: 900,
  minimumRewardBps: 0,
  allowedOpportunityTypes: null,
  maxDailyRewardMinor: 0,
  rewardLimitCurrency: "USD",
  dailyRewardWindow: "calendar_day",
  maxRewardPerTradeMinor: 0,
  unsettledRewardPolicy: "reserve",
  capReachedPolicy: "stop_new_trades",
  settlementConfirmationState: "ledger_and_wallet",
  settlementRetryPolicy: "manual",
  maxSettlementAttempts: 3,
  closePolicy: "after_completion",
  policyVersion: 1,
} as const satisfies Omit<OpportunityPackagePolicyRow, "id" | "packageName" | "updatedBy" | "updatedAt">;

/**
 * Merge one package's persisted policy with its own partial edit. A row for a
 * different package is rejected rather than being silently reused.
 */
export function resolveEffectivePackageOpportunityPolicy(
  packageName: string,
  current: OpportunityPackagePolicyRow | null | undefined,
  supplied: Partial<OpportunityPackagePolicyRow>,
  updatedBy: number,
) {
  if (!packageName.trim()) throw new Error("Package name is required");
  if (current && current.packageName !== packageName) {
    throw new Error("Saved opportunity policy belongs to a different package");
  }
  if (supplied.packageName !== undefined && supplied.packageName !== packageName) {
    throw new Error("Opportunity policy update targets a different package");
  }
  return {
    ...DEFAULT_NEW_PACKAGE_OPPORTUNITY_POLICY,
    ...(current ?? {}),
    ...supplied,
    packageName,
    updatedBy,
    // Financial execution is not enabled by package creation or policy editing.
    automaticTradingEnabled: false,
  };
}
