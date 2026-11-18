/**
 * Single source of truth for the per-tier Trading policy field bounds.
 *
 * The server enforces these exact bounds in `updatePackagePolicies`
 * (server/routers.ts) and the per-tier policy editor validates every editable
 * field against the same values (client/src/trading-policy-validation.ts).
 * server/trading-tier-policy-bounds.contract.test.ts asserts the shared module
 * stays identical to the server schema so the two can never drift.
 *
 * Item 32 intentionally does not rewrite the server schema literals (several
 * contract tests pin the exact router text); instead the shared module is the
 * client's authority and a contract test guards it against the server.
 */
export type TierPolicyNumericBound = { min: number; max: number };

/** Numeric per-tier policy fields that are always present (never nullable). */
export const TRADING_TIER_POLICY_NUMERIC_BOUNDS = {
  maxPopupsPerDay: { min: 1, max: 1000 },
  maxVisibleOffers: { min: 1, max: 10000 },
  minimumTradeUnits: { min: 1, max: 2147483647 },
  maximumTradeUnits: { min: 1, max: 2147483647 },
  minHourlyTarget: { min: 0, max: 100 },
  normalHourlyTarget: { min: 0, max: 100 },
  marketInfluenceBps: { min: 0, max: 10000 },
  maxBurstSize: { min: 0, max: 100 },
  dailyPopupTarget: { min: 0, max: 10000 },
  minIntervalSeconds: { min: 0, max: 604800 },
  maxIntervalSeconds: { min: 0, max: 604800 },
  completionDisplaySeconds: { min: 1, max: 3600 },
  postCompletionIntervalSeconds: { min: 0, max: 604800 },
  maxPendingDeliveries: { min: 0, max: 1000 },
  maxTradeAttemptsPerDay: { min: 0, max: 10000 },
  tradeRetryDelaySeconds: { min: 5, max: 3600 },
  maxSuccessfulTradesPerDay: { min: 0, max: 10000 },
  maxConcurrentActiveTrades: { min: 1, max: 1000 },
  minSettlementDelaySeconds: { min: 0, max: 604800 },
  maxSettlementDelaySeconds: { min: 0, max: 604800 },
  minimumRewardBps: { min: 0, max: 10000 },
  maxDailyRewardMinor: { min: 0, max: 2147483647 },
  maxRewardPerTradeMinor: { min: 0, max: 2147483647 },
} as const satisfies Record<string, TierPolicyNumericBound>;

/**
 * Nullable per-tier policy fields. A null value means "not configured"; the
 * paired "both set or both blank" and positive-when-required rules live in the
 * client validator because they depend on other fields in the same row.
 */
export const TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS = {
  minimumPayoutRateBps: { min: 0, max: 5000 },
  maximumPayoutRateBps: { min: 0, max: 5000 },
  minimumTradeDurationSeconds: { min: 10, max: 86400 },
  maximumTradeDurationSeconds: { min: 10, max: 86400 },
} as const satisfies Record<string, TierPolicyNumericBound>;

/** String per-tier policy fields and their maximum length. */
export const TRADING_TIER_POLICY_STRING_BOUNDS = {
  badgeLabel: { maxLength: 40 },
  companyRotationCountryNames: { maxLength: 2000 },
} as const;

/** Enum per-tier policy fields and their accepted values (server order). */
export const TRADING_TIER_POLICY_ENUM_BOUNDS = {
  schedulingPeriod: ["rolling_24h", "calendar_day"],
  badgeStyle: ["neutral", "blue", "purple", "gold", "green"],
  companyRotationRepeatPolicy: ["avoid_until_exhausted", "allow_repeats"],
  closePolicy: ["after_completion", "after_final_display"],
} as const;

/** Human-readable field labels reused for field-level validation messages. */
export const TRADING_TIER_POLICY_FIELD_LABELS: Record<string, string> = {
  maxPopupsPerDay: "Hard daily pop-up ceiling",
  maxVisibleOffers: "Maximum visible offers at once",
  minimumTradeUnits: "Minimum required capital",
  maximumTradeUnits: "Maximum required capital",
  minHourlyTarget: "Minimum hourly target",
  normalHourlyTarget: "Normal hourly target",
  marketInfluenceBps: "Market influence",
  maxBurstSize: "Maximum burst size",
  dailyPopupTarget: "Optional daily target cap",
  minIntervalSeconds: "Minimum interval between deliveries",
  maxIntervalSeconds: "Maximum interval between deliveries",
  completionDisplaySeconds: "Post-completion card display delay",
  postCompletionIntervalSeconds: "Interval after completion",
  maxPendingDeliveries: "Maximum pending deliveries",
  maxTradeAttemptsPerDay: "Maximum trade attempts per day",
  tradeRetryDelaySeconds: "Trade retry delay",
  maxSuccessfulTradesPerDay: "Maximum successful trades per day",
  maxConcurrentActiveTrades: "Maximum concurrent active trades",
  minSettlementDelaySeconds: "Minimum settlement delay",
  maxSettlementDelaySeconds: "Maximum settlement delay",
  minimumRewardBps: "Minimum eligible reward rate",
  maxDailyRewardMinor: "Maximum daily reward cap",
  maxRewardPerTradeMinor: "Maximum reward per trade",
  minimumPayoutRateBps: "Minimum configured return rate",
  maximumPayoutRateBps: "Maximum configured return rate",
  minimumTradeDurationSeconds: "Minimum opportunity / pop-up duration",
  maximumTradeDurationSeconds: "Maximum opportunity / pop-up duration",
  badgeLabel: "Badge label",
  badgeStyle: "Badge style",
  companyRotationCountryNames: "Country-folder filters",
  companyRotationRepeatPolicy: "Repeat policy",
  schedulingPeriod: "Delivery counting window",
  closePolicy: "Card close policy",
  // Switch fields carried on the same row (edited in the shared Trading
  // controls panel, not this editor) but validated together with the row.
  enabled: "Tier enabled",
  automaticDelivery: "Automatic delivery",
  automaticTradingEnabled: "Automatic trading",
  companyRotationEnabled: "Company rotation",
  burstEnabled: "Burst delivery",
  randomizationEnabled: "Randomized timing",
  requirePreviousSettlement: "Require previous settlement",
};
