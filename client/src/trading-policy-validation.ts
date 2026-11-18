/**
 * Per-tier Trading policy validation (item 32).
 *
 * Every editable field in the per-tier policy editor is validated here against
 * the shared bounds in `shared/trading-tier-policy-bounds.ts`, which mirror the
 * server schema in `server/routers.ts` (`updatePackagePolicies`) and the
 * cross-field rules enforced in `server/db.ts` + `validatePackageAutomationPolicy`.
 * `server/trading-tier-policy-bounds.contract.test.ts` guards the shared module
 * against the server so the client and server bounds cannot drift.
 *
 * The validator is pure: it returns one entry per invalid field so the editor
 * can show field-level messages instead of a single opaque error.
 */
import {
  TRADING_TIER_POLICY_ENUM_BOUNDS,
  TRADING_TIER_POLICY_FIELD_LABELS,
  TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS,
  TRADING_TIER_POLICY_NUMERIC_BOUNDS,
  TRADING_TIER_POLICY_STRING_BOUNDS,
} from "@shared/trading-tier-policy-bounds";
import type { TradingDeliveryPolicyRow } from "./components/TradingDeliveryPolicyEditor";

export type TradingPolicyFieldError = { field: string; message: string };

/** Switch fields carried on the same policy row and validated with it. */
export const TRADING_TIER_POLICY_SWITCH_FIELDS = [
  "enabled",
  "automaticDelivery",
  "automaticTradingEnabled",
  "companyRotationEnabled",
  "burstEnabled",
  "randomizationEnabled",
  "requirePreviousSettlement",
] as const satisfies ReadonlyArray<keyof TradingDeliveryPolicyRow>;

function fieldLabel(field: string): string {
  return TRADING_TIER_POLICY_FIELD_LABELS[field] ?? field;
}

function isIntegerWithin(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isPresentInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Validates every editable per-tier policy field and returns one error per
 * invalid field, keyed by the field name used in the policy payload.
 */
export function validateTradingPolicyRow(row: TradingDeliveryPolicyRow): TradingPolicyFieldError[] {
  const errors: TradingPolicyFieldError[] = [];
  const record = row as unknown as Record<string, unknown>;
  const push = (field: string, message: string) => errors.push({ field, message });

  // Always-present numeric fields: whole number inside the server range.
  for (const [field, bound] of Object.entries(TRADING_TIER_POLICY_NUMERIC_BOUNDS)) {
    if (!isIntegerWithin(record[field], bound.min, bound.max)) {
      push(field, `${fieldLabel(field)} must be a whole number between ${bound.min} and ${bound.max}.`);
    }
  }

  // Nullable numeric fields: blank is allowed, otherwise whole number in range.
  for (const [field, bound] of Object.entries(TRADING_TIER_POLICY_NULLABLE_NUMERIC_BOUNDS)) {
    const value = record[field];
    if (value === null || value === undefined) continue;
    if (!isIntegerWithin(value, bound.min, bound.max)) {
      push(field, `${fieldLabel(field)} must be blank, or a whole number between ${bound.min} and ${bound.max}.`);
    }
  }

  // String fields: text within the maximum length.
  for (const [field, bound] of Object.entries(TRADING_TIER_POLICY_STRING_BOUNDS)) {
    const value = record[field];
    if (typeof value !== "string") push(field, `${fieldLabel(field)} must be text.`);
    else if (value.length > bound.maxLength) push(field, `${fieldLabel(field)} must be at most ${bound.maxLength} characters.`);
  }

  // Enum fields: one of the server-accepted values.
  for (const [field, allowed] of Object.entries(TRADING_TIER_POLICY_ENUM_BOUNDS)) {
    const values = allowed as readonly string[];
    if (!values.includes(String(record[field] ?? ""))) {
      push(field, `${fieldLabel(field)} must be one of: ${values.join(", ")}.`);
    }
  }

  // Switch fields: must be an explicit boolean.
  for (const field of TRADING_TIER_POLICY_SWITCH_FIELDS) {
    if (typeof record[field] !== "boolean") push(field, `${fieldLabel(field)} must be switched on or off.`);
  }

  // Paired configured-return bounds: set both or leave both blank, and
  // minimum must not exceed maximum.
  const minimumPayoutRateBps = row.minimumPayoutRateBps;
  const maximumPayoutRateBps = row.maximumPayoutRateBps;
  if ((minimumPayoutRateBps === null) !== (maximumPayoutRateBps === null)) {
    push(minimumPayoutRateBps === null ? "minimumPayoutRateBps" : "maximumPayoutRateBps", "Set both configured return rate bounds or leave both blank.");
  } else if (isPresentInteger(minimumPayoutRateBps) && isPresentInteger(maximumPayoutRateBps) && maximumPayoutRateBps < minimumPayoutRateBps) {
    push("maximumPayoutRateBps", "Maximum configured return rate must be at least the minimum.");
  }

  // Paired opportunity-duration bounds: same both-or-none and ordering rule.
  const minimumTradeDurationSeconds = row.minimumTradeDurationSeconds;
  const maximumTradeDurationSeconds = row.maximumTradeDurationSeconds;
  if ((minimumTradeDurationSeconds === null) !== (maximumTradeDurationSeconds === null)) {
    push(minimumTradeDurationSeconds === null ? "minimumTradeDurationSeconds" : "maximumTradeDurationSeconds", "Set both opportunity / pop-up duration bounds or leave both blank.");
  } else if (isPresentInteger(minimumTradeDurationSeconds) && isPresentInteger(maximumTradeDurationSeconds) && maximumTradeDurationSeconds < minimumTradeDurationSeconds) {
    push("maximumTradeDurationSeconds", "Maximum opportunity / pop-up duration must be at least the minimum.");
  }

  // Relational ordering on the remaining editable numeric pairs.
  if (isIntegerWithin(row.minimumTradeUnits, 1, 2147483647) && isIntegerWithin(row.maximumTradeUnits, 1, 2147483647) && row.maximumTradeUnits < row.minimumTradeUnits) {
    push("maximumTradeUnits", "Maximum required capital must be at least the minimum required capital.");
  }
  if (isIntegerWithin(row.minIntervalSeconds, 0, 604800) && isIntegerWithin(row.maxIntervalSeconds, 0, 604800) && row.maxIntervalSeconds < row.minIntervalSeconds) {
    push("maxIntervalSeconds", "Maximum interval between deliveries must be at least the minimum interval.");
  }
  if (isIntegerWithin(row.minSettlementDelaySeconds, 0, 604800) && isIntegerWithin(row.maxSettlementDelaySeconds, 0, 604800) && row.maxSettlementDelaySeconds < row.minSettlementDelaySeconds) {
    push("maxSettlementDelaySeconds", "Maximum settlement delay must be at least the minimum settlement delay.");
  }

  // Enabling automatic delivery requires complete, positive configured offer terms.
  if (row.enabled === true && row.automaticDelivery === true) {
    if (minimumPayoutRateBps === null || minimumPayoutRateBps < 1) push("minimumPayoutRateBps", "Enabled delivery requires a positive minimum configured return rate (at least 0.01%).");
    if (maximumPayoutRateBps === null) push("maximumPayoutRateBps", "Enabled delivery requires a maximum configured return rate.");
    if (minimumTradeDurationSeconds === null) push("minimumTradeDurationSeconds", "Enabled delivery requires a minimum opportunity / pop-up duration.");
    if (maximumTradeDurationSeconds === null) push("maximumTradeDurationSeconds", "Enabled delivery requires a maximum opportunity / pop-up duration.");
  }

  // Automatic trading depends on an enabled tier with automatic delivery.
  if (row.automaticTradingEnabled === true && !(row.enabled === true && row.automaticDelivery === true)) {
    push("automaticTradingEnabled", "Automatic trading requires an enabled tier with automatic delivery.");
  }

  return errors;
}

/** True when the row passes every per-tier policy bound. */
export function tradingPolicyRowValid(row: TradingDeliveryPolicyRow): boolean {
  return validateTradingPolicyRow(row).length === 0;
}

/** Field name to combined message map, for field-level rendering. */
export function tradingPolicyRowErrorMap(row: TradingDeliveryPolicyRow): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { field, message } of validateTradingPolicyRow(row)) {
    map[field] = map[field] ? `${map[field]} ${message}` : message;
  }
  return map;
}
