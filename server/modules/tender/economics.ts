import { proportionalMinorAmount } from "../../../shared/money";

/**
 * Tender Bid — contract-value inclusion range and qualification-amount bounds.
 *
 * These are the owner-locked figures from `docs/TENDER_BID_SPECIFICATION.md` §2
 * and §7. The percentage itself is never hard-coded: it is supplied by the
 * administrator (basis points) and this module only applies it and clamps the
 * result. All amounts are integer USD minor units.
 */
export const TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR = 100_000 * 100;
export const TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR = 250_000_000 * 100;

export const TENDER_QUALIFICATION_FLOOR_USD_MINOR = 1_000 * 100;
export const TENDER_QUALIFICATION_CEILING_USD_MINOR = 600_000 * 100;

/** Whole basis points: a configured percentage of the contract value. */
export const TENDER_QUALIFICATION_PCT_BPS_MAX = 10_000;

/**
 * Whether a known USD contract value falls inside the owner-locked inclusion
 * range. Returns `null` when the value is unknown, so callers can distinguish
 * "outside the range" from "no USD value yet" — an unknown value is never
 * treated as out of range (the tender is kept, it simply cannot be filtered).
 */
export function isContractValueInInclusionRange(contractUsdMinor: number | null | undefined): boolean | null {
  if (contractUsdMinor == null || !Number.isSafeInteger(contractUsdMinor)) return null;
  return contractUsdMinor >= TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR
    && contractUsdMinor <= TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR;
}

/**
 * Compute the qualification amount as the administrator-configured percentage of
 * the USD contract value, clamped to the owner-locked $1,000–$600,000 band.
 * Returns `null` when the contract value or percentage is missing or malformed —
 * fail closed, never a guessed amount.
 */
export function computeQualificationAmountUsdMinor(
  contractUsdMinor: number | null | undefined,
  qualificationPctBps: number | null | undefined,
): number | null {
  if (contractUsdMinor == null || !Number.isSafeInteger(contractUsdMinor) || contractUsdMinor <= 0) return null;
  if (qualificationPctBps == null || !Number.isInteger(qualificationPctBps) || qualificationPctBps <= 0) return null;
  if (qualificationPctBps > TENDER_QUALIFICATION_PCT_BPS_MAX) return null;
  const proportional = proportionalMinorAmount(contractUsdMinor, qualificationPctBps, TENDER_QUALIFICATION_PCT_BPS_MAX);
  return Math.min(TENDER_QUALIFICATION_CEILING_USD_MINOR, Math.max(TENDER_QUALIFICATION_FLOOR_USD_MINOR, proportional));
}
