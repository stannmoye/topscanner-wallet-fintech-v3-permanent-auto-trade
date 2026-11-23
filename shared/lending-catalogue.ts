/**
 * Lending desk — the lending-only catalogue of loan opportunities and the live
 * borrower-auction model.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server and, as a resilience fallback, in the customer's
 * browser. It defines the LENDING-ONLY taxonomy (the fourteen loan types the
 * desk carries), the shared classifiers and interest maths, the live-auction
 * helpers, the desk analytics and a small, honest DISCOVERY layer.
 *
 * The desk is two-sided:
 *   - a BORROWER posts a bid on the interest rate they will pay for a loan, and
 *     competes in a live, server-timed auction; the highest bid when the
 *     countdown expires wins the allocation, and the loan amount is disbursed to
 *     the winner once the administrator's conditions are met; and
 *   - a LENDER / investor funds loans and earns the borrower's interest.
 *
 * The desk is strictly about lending. There is no free, keyless public register
 * that publishes *investable* loan opportunities, so the real, fundable
 * instruments are published by an administrator in the LOAN layer
 * (server/lendingDossiers.ts) and the borrower auction lives in the desk layer
 * (server/lending.ts). The discovery layer here only surfaces cited public
 * financial-inclusion references (from the keyless World Bank Open Data
 * financial-inclusion feed) as un-priced candidates so the desk is never empty;
 * it never invents funding economics.
 *
 * Nothing here is invented: public sources publish no loan amount, tenure,
 * interest rate or reserve economics, so those fields stay null on discovery
 * records and read "not modelled" until an administrator publishes a loan.
 */

import { flagFor } from "./country-options";
import type { DeskEconomics } from "./investment-economics";

/** The kinds of loan the desk can carry. */
export type LoanType =
  | "PERSONAL"
  | "AUTO"
  | "MORTGAGE"
  | "BUSINESS_WORKING_CAPITAL"
  | "SME_EXPANSION"
  | "EQUIPMENT_FINANCE"
  | "INVOICE_FACTORING"
  | "TRADE_FINANCE"
  | "BRIDGE"
  | "PROJECT_FINANCE"
  | "STUDENT"
  | "MEDICAL"
  | "AGRICULTURAL"
  | "REAL_ESTATE";

/** The lending sector a loan belongs to, used to group the desk. */
export type LoanSector =
  | "CONSUMER"
  | "MORTGAGE"
  | "VEHICLE"
  | "BUSINESS"
  | "TRADE"
  | "PROJECT"
  | "EDUCATION"
  | "HEALTH"
  | "AGRICULTURE"
  | "REAL_ESTATE"
  | "OTHER";

/** Where a loan is in its lifecycle. */
export type LoanStage =
  | "DRAFT"
  | "BIDDING"
  | "ALLOCATED"
  | "DISBURSED"
  | "REPAYING"
  | "SETTLED"
  | "DEFAULTED"
  | "WITHDRAWN";

/** The live-auction state of a loan, derived from its countdown and status. */
export type LoanAuctionStatus = "SCHEDULED" | "OPEN" | "CLOSING_SOON" | "CLOSED" | "ALLOCATED" | "CANCELLED";

export type LendingRiskGrade = "PRIME" | "BALANCED" | "SPECULATIVE" | "HIGH_RISK";

/** How a loan resolves for its lenders. */
export type LendingOutcome = "REPAID" | "REPAID_LATE" | "DEFAULT" | "WRITE_OFF";

/** How often a borrower repays. */
export type RepaymentFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL" | "BULLETIN";

/** A condition the borrower must satisfy before a won loan is disbursed. */
export type DisbursementConditionType =
  | "KYC_VERIFIED"
  | "COLLATERAL_PLEDGED"
  | "INSURANCE"
  | "GUARANTOR"
  | "DOWN_PAYMENT"
  | "DOCUMENTATION"
  | "ESCROW_ACCOUNT"
  | "REPAYMENT_MANDATE"
  | "CREDIT_CHECK"
  | "RESIDENCY"
  | "BANK_ACCOUNT"
  | "INCOME_PROOF"
  | "BUSINESS_REGISTRATION"
  | "TAX_COMPLIANCE"
  | "OTHER";

/** The lifecycle of a single disbursement condition. */
export type DisbursementConditionStatus = "PENDING" | "MET" | "WAIVED";

/** The lifecycle of a borrower's bid in the live auction. */
export type BorrowerBidStatus = "ACTIVE" | "OUTBID" | "WON" | "DISBURSED" | "EXPIRED" | "CANCELLED";

/** Which side of the desk a booking sits on. */
export type LendingSide = "BORROWER" | "LENDER";

/** The territory a loan serves. */
export type LendingTerritoryBand = "LOCAL" | "REGIONAL" | "NATIONAL" | "GLOBAL";

/** The atlas region a loan belongs to. */
export type LendingRegion =
  | "AFRICA"
  | "LATIN_AMERICA"
  | "NORTH_AMERICA"
  | "EUROPE"
  | "SOUTH_ASIA"
  | "SOUTHEAST_ASIA"
  | "EAST_ASIA"
  | "OCEANIA"
  | "MIDDLE_EAST"
  | "GLOBAL";

/** Whether a record is administrator-reviewed or a cited public reference. */
export type LendingVerificationStatus = "VERIFIED" | "REFERENCE";

export type LendingValueBand = "UNDER_10K" | "10K_100K" | "100K_1M" | "OVER_1M";

/** One disbursement condition set by the administrator before a loan pays out. */
export type DisbursementCondition = {
  type: DisbursementConditionType;
  label: string;
  /** Whether the condition must be met (vs. optional / informational). */
  required: boolean;
  status: DisbursementConditionStatus;
  detail: string | null;
  metAt: string | null;
};

/**
 * One borrower's bid in a loan's live auction. A higher `bidInterestBps` is a
 * better offer to the funding lender, so the highest bid ranks on top; the
 * borrower can raise the bid to climb the leaderboard.
 */
export type LendingBid = {
  id: string;
  loanId: string;
  /** Whether this bid belongs to the signed-in customer (server-derived). */
  isSelf: boolean;
  /** Masked, non-identifying borrower label, e.g. "Bidder #A3F1". */
  borrowerLabel: string;
  /** The interest the borrower will pay, in basis points per annum. */
  bidInterestBps: number;
  /** The amount the borrower wants to draw, in minor units of the settlement currency. */
  amountMinor: number;
  /** The tenure the borrower wants, in whole months. */
  tenureMonths: number;
  /** 1 = on top of the leaderboard. */
  rank: number;
  /** The next interest (bps) a borrower must beat to take the top spot. */
  nextRequiredBps: number | null;
  status: BorrowerBidStatus;
  /** Monthly interest payable at this bid, in minor units. */
  monthlyInterestMinor: number;
  /** Yearly interest payable at this bid, in minor units. */
  yearlyInterestMinor: number;
  /** Interest plus capital across the requested tenure, in minor units. */
  interestPlusCapitalMinor: number;
  placedAt: string;
  updatedAt: string;
};

/** An administrator-published loan opportunity with its auction and conditions. */
export type LendingLoan = {
  id: string;
  title: string;
  /** The borrower / applicant name the loan was published for, when disclosed. */
  borrower: string;
  loanType: LoanType;
  sector: LoanSector;
  purpose: string;
  territory: string;
  territoryBand: LendingTerritoryBand;
  region: LendingRegion;
  countryCode: string;
  country: string;
  flag: string;
  description: string;
  /** The principal on offer, in minor units of the settlement currency. */
  principalMinor: number | null;
  currency: string;
  /** The starting (reserve) interest rate the auction opens at, in bps per annum. */
  startingInterestBps: number | null;
  /** The minimum tenure a lender will accept, in whole months. */
  minimumTenureMonths: number | null;
  /** The maximum tenure a lender will accept, in whole months. */
  maximumTenureMonths: number | null;
  /** How often the loan is repaid. */
  repaymentFrequency: RepaymentFrequency;
  /** Monthly interest payable on the full principal at the current leading bid. */
  monthlyInterestMinor: number | null;
  /** Yearly interest payable on the full principal at the current leading bid. */
  yearlyInterestMinor: number | null;
  /** Interest plus capital over the maximum tenure, at the leading bid. */
  interestPlusCapitalMinor: number | null;
  /** The platform arrangement fee, in basis points. */
  platformFeeBps: number | null;
  riskGrade: LendingRiskGrade | null;
  /** Security offered against the loan, when published. */
  collateral: string | null;
  /** Additional terms shown to bidders and lenders. */
  highlights: string[];
  stage: LoanStage;
  /** The administrator-controlled moment bidding opens (ISO-8601), or null. */
  auctionOpensAt: string | null;
  /** The administrator-controlled countdown end (ISO-8601), or null. */
  auctionClosesAt: string | null;
  /** The live auction state, derived from the countdown and stage. */
  auctionStatus: LoanAuctionStatus;
  /** Whole seconds until the countdown ends (server-derived on the record), or null. */
  remainingSeconds: number | null;
  /** Number of live bids in the auction. */
  bidCount: number;
  /** The highest bid offered so far, in bps per annum, or null. */
  topBidBps: number | null;
  /** The leading (winning-now) borrower label, or null. */
  leadingBorrower: string | null;
  /** Whether the signed-in customer currently holds the leading bid. */
  viewerIsLeading: boolean;
  /** The customer's own bid id, when they have one. */
  viewerBidId: string | null;
  /** The interest the signed-in customer must bid to take the top spot, or null. */
  viewerNextRequiredBps: number | null;
  /** Conditions the winner must satisfy before disbursement. */
  conditions: DisbursementCondition[];
  /** The borrower who won and was allocated, once an auction resolves. */
  winnerLabel: string | null;
  source: string;
  sourceUrl: string | null;
  asOf: string;
  verified: boolean;
  /** True when the loan is open for bidding right now. */
  biddable: boolean;
  verificationStatus: LendingVerificationStatus;
  /** The loan's auto-assigned economic profile, when the desk has assigned one. */
  economics?: DeskEconomics | null;
};

/** An administrator-posted statement of how much a lender has reserved. */
export type LenderReserve = {
  id: string;
  lender: string;
  /** The reserved capacity available to borrowers, in minor units. */
  capacityMinor: number;
  /** The still-unallocated capacity, in minor units. */
  availableMinor: number;
  allocatedMinor: number;
  currency: string;
  region: LendingRegion;
  territory: string;
  countryCode: string;
  country: string;
  flag: string;
  /** The smallest loan this reserve will fund, in minor units. */
  minimumTicketMinor: number | null;
  /** The largest loan this reserve will fund, in minor units. */
  maximumTicketMinor: number | null;
  minimumTenureMonths: number | null;
  maximumTenureMonths: number | null;
  /** The lowest interest this reserve will accept, in bps per annum. */
  startingInterestBps: number | null;
  /** The loan types this reserve will fund (empty = all). */
  loanTypes: LoanType[];
  note: string | null;
  enabled: boolean;
  source: string;
  asOf: string;
  createdAt: string;
  updatedAt: string;
};

export type LendingInvestmentSource = {
  name: string;
  url: string;
  country: string;
  role: "opportunities" | "catalogue" | "context";
  status: "ok" | "degraded" | "unavailable";
  detail?: string;
};

export type LendingCatalogue = {
  loans: LendingLoan[];
  sources: LendingInvestmentSource[];
  fetchedAt: string;
  degraded: boolean;
};

/* ------------------------------------------------------------------ *
 * Taxonomy — lending-only loan types
 * ------------------------------------------------------------------ */

export const LENDING_LOAN_TYPES: readonly LoanType[] = [
  "PERSONAL",
  "AUTO",
  "MORTGAGE",
  "BUSINESS_WORKING_CAPITAL",
  "SME_EXPANSION",
  "EQUIPMENT_FINANCE",
  "INVOICE_FACTORING",
  "TRADE_FINANCE",
  "BRIDGE",
  "PROJECT_FINANCE",
  "STUDENT",
  "MEDICAL",
  "AGRICULTURAL",
  "REAL_ESTATE",
];

const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  PERSONAL: "Personal Loan",
  AUTO: "Auto Loan",
  MORTGAGE: "Mortgage",
  BUSINESS_WORKING_CAPITAL: "Business Working Capital",
  SME_EXPANSION: "SME Expansion",
  EQUIPMENT_FINANCE: "Equipment Finance",
  INVOICE_FACTORING: "Invoice Factoring",
  TRADE_FINANCE: "Trade Finance",
  BRIDGE: "Bridge Loan",
  PROJECT_FINANCE: "Project Finance",
  STUDENT: "Student Loan",
  MEDICAL: "Medical Loan",
  AGRICULTURAL: "Agricultural Loan",
  REAL_ESTATE: "Real Estate Loan",
};

const LOAN_TYPE_BLURBS: Record<LoanType, string> = {
  PERSONAL: "Unsecured consumer borrowing repaid from income.",
  AUTO: "Vehicle-backed lending with the asset as security.",
  MORTGAGE: "Long-tenure property lending secured on the title.",
  BUSINESS_WORKING_CAPITAL: "Short-cycle capital to smooth a business's cash flow.",
  SME_EXPANSION: "Growth capital for an established small or medium enterprise.",
  EQUIPMENT_FINANCE: "Asset finance for plant, machinery and tools.",
  INVOICE_FACTORING: "Advance against outstanding customer invoices.",
  TRADE_FINANCE: "Import / export and purchase-order financing.",
  BRIDGE: "Short-term finance bridging a known future receipt.",
  PROJECT_FINANCE: "Ring-fenced finance for an infrastructure or energy project.",
  STUDENT: "Education-cost borrowing repaid after study.",
  MEDICAL: "Borrowing against planned or emergency medical costs.",
  AGRICULTURAL: "Season-linked finance for farm inputs and equipment.",
  REAL_ESTATE: "Commercial and development property lending.",
};

export function loanTypeLabel(value: LoanType): string {
  return LOAN_TYPE_LABELS[value] ?? "Loan";
}

export function loanTypeBlurb(value: LoanType): string {
  return LOAN_TYPE_BLURBS[value] ?? "";
}

/** The loan types, grouped into the desk's four lanes for the type picker. */
export const LENDING_LOAN_TYPE_GROUPS: { label: string; detail: string; types: LoanType[] }[] = [
  {
    label: "Personal & asset",
    detail: "Consumer and asset-backed borrowing",
    types: ["PERSONAL", "AUTO", "STUDENT", "MEDICAL"],
  },
  {
    label: "Property",
    detail: "Secured property lending",
    types: ["MORTGAGE", "REAL_ESTATE"],
  },
  {
    label: "Business & trade",
    detail: "Enterprise, working-capital and trade finance",
    types: ["BUSINESS_WORKING_CAPITAL", "SME_EXPANSION", "EQUIPMENT_FINANCE", "INVOICE_FACTORING", "TRADE_FINANCE"],
  },
  {
    label: "Project & agricultural",
    detail: "Structured and season-linked finance",
    types: ["BRIDGE", "PROJECT_FINANCE", "AGRICULTURAL"],
  },
];

export const LENDING_SECTORS: readonly LoanSector[] = [
  "CONSUMER", "MORTGAGE", "VEHICLE", "BUSINESS", "TRADE", "PROJECT", "EDUCATION", "HEALTH", "AGRICULTURE", "REAL_ESTATE", "OTHER",
];

const SECTOR_LABELS: Record<LoanSector, string> = {
  CONSUMER: "Consumer", MORTGAGE: "Mortgage", VEHICLE: "Vehicle", BUSINESS: "Business", TRADE: "Trade",
  PROJECT: "Project", EDUCATION: "Education", HEALTH: "Health", AGRICULTURE: "Agriculture", REAL_ESTATE: "Real estate", OTHER: "Other",
};

export function lendingSectorLabel(value: LoanSector): string {
  return SECTOR_LABELS[value] ?? "Other";
}

export const LENDING_STAGES: readonly LoanStage[] = [
  "DRAFT", "BIDDING", "ALLOCATED", "DISBURSED", "REPAYING", "SETTLED", "DEFAULTED", "WITHDRAWN",
];

const STAGE_LABELS: Record<LoanStage, string> = {
  DRAFT: "Draft", BIDDING: "Bidding open", ALLOCATED: "Winning bid allocated", DISBURSED: "Disbursed",
  REPAYING: "Repaying", SETTLED: "Settled", DEFAULTED: "Defaulted", WITHDRAWN: "Withdrawn",
};

export function lendingStageLabel(value: LoanStage): string {
  return STAGE_LABELS[value] ?? "Loan";
}

export const LENDING_AUCTION_STATUSES: readonly LoanAuctionStatus[] = [
  "SCHEDULED", "OPEN", "CLOSING_SOON", "CLOSED", "ALLOCATED", "CANCELLED",
];

const AUCTION_STATUS_LABELS: Record<LoanAuctionStatus, string> = {
  SCHEDULED: "Opens soon", OPEN: "Live now", CLOSING_SOON: "Closing soon", CLOSED: "Countdown ended",
  ALLOCATED: "Allocated", CANCELLED: "Cancelled",
};

export function lendingAuctionStatusLabel(value: LoanAuctionStatus): string {
  return AUCTION_STATUS_LABELS[value] ?? "Auction";
}

export const LENDING_RISK_GRADES: readonly LendingRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];

const RISK_LABELS: Record<LendingRiskGrade, string> = {
  PRIME: "Prime", BALANCED: "Balanced", SPECULATIVE: "Speculative", HIGH_RISK: "High risk",
};

export function lendingRiskLabel(value: LendingRiskGrade): string {
  return RISK_LABELS[value] ?? "Unrated";
}

export const LENDING_OUTCOMES: readonly LendingOutcome[] = ["REPAID", "REPAID_LATE", "DEFAULT", "WRITE_OFF"];

const OUTCOME_LABELS: Record<LendingOutcome, string> = {
  REPAID: "Repaid in full", REPAID_LATE: "Repaid late", DEFAULT: "Defaulted", WRITE_OFF: "Written off",
};

export function lendingOutcomeLabel(value: LendingOutcome): string {
  return OUTCOME_LABELS[value] ?? "Outcome";
}

export const LENDING_REPAYMENT_FREQUENCIES: readonly RepaymentFrequency[] = [
  "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "BULLETIN",
];

const FREQUENCY_LABELS: Record<RepaymentFrequency, string> = {
  WEEKLY: "Weekly", BIWEEKLY: "Every two weeks", MONTHLY: "Monthly",
  QUARTERLY: "Quarterly", SEMI_ANNUAL: "Twice a year", ANNUAL: "Yearly", BULLETIN: "Bullet (at maturity)",
};

export function repaymentFrequencyLabel(value: RepaymentFrequency): string {
  return FREQUENCY_LABELS[value] ?? "Monthly";
}

export const LENDING_CONDITION_TYPES: readonly DisbursementConditionType[] = [
  "KYC_VERIFIED", "COLLATERAL_PLEDGED", "INSURANCE", "GUARANTOR", "DOWN_PAYMENT", "DOCUMENTATION",
  "ESCROW_ACCOUNT", "REPAYMENT_MANDATE", "CREDIT_CHECK", "RESIDENCY", "BANK_ACCOUNT", "INCOME_PROOF",
  "BUSINESS_REGISTRATION", "TAX_COMPLIANCE", "OTHER",
];

const CONDITION_LABELS: Record<DisbursementConditionType, string> = {
  KYC_VERIFIED: "Identity verified (KYC)",
  COLLATERAL_PLEDGED: "Collateral pledged",
  INSURANCE: "Insurance in force",
  GUARANTOR: "Guarantor signed",
  DOWN_PAYMENT: "Down payment received",
  DOCUMENTATION: "Documents submitted",
  ESCROW_ACCOUNT: "Escrow account opened",
  REPAYMENT_MANDATE: "Repayment mandate signed",
  CREDIT_CHECK: "Credit check passed",
  RESIDENCY: "Residency confirmed",
  BANK_ACCOUNT: "Bank account verified",
  INCOME_PROOF: "Income proof provided",
  BUSINESS_REGISTRATION: "Business registration verified",
  TAX_COMPLIANCE: "Tax compliance certificate",
  OTHER: "Additional condition",
};

export function disbursementConditionLabel(value: DisbursementConditionType): string {
  return CONDITION_LABELS[value] ?? "Condition";
}

export const LENDING_CONDITION_STATUSES: readonly DisbursementConditionStatus[] = ["PENDING", "MET", "WAIVED"];

export const LENDING_BID_STATUSES: readonly BorrowerBidStatus[] = [
  "ACTIVE", "OUTBID", "WON", "DISBURSED", "EXPIRED", "CANCELLED",
];

export const LENDING_TERRITORY_BANDS: readonly LendingTerritoryBand[] = ["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"];

const TERRITORY_LABELS: Record<LendingTerritoryBand, string> = {
  LOCAL: "Local", REGIONAL: "Regional", NATIONAL: "National", GLOBAL: "Global",
};

export function lendingTerritoryBandLabel(value: LendingTerritoryBand): string {
  return TERRITORY_LABELS[value] ?? "National";
}

export const LENDING_VALUE_BANDS: readonly LendingValueBand[] = ["UNDER_10K", "10K_100K", "100K_1M", "OVER_1M"];

const VALUE_BAND_LABELS: Record<LendingValueBand, string> = {
  UNDER_10K: "Under $10k", "10K_100K": "$10k – $100k", "100K_1M": "$100k – $1M", OVER_1M: "Over $1M",
};

export function lendingValueBandLabel(value: LendingValueBand): string {
  return VALUE_BAND_LABELS[value] ?? "Amount";
}

/** A coarse value band from a minor-unit amount, only set when an amount is known. */
export function lendingValueBandFromMinor(minor: number | null | undefined): LendingValueBand | null {
  if (minor === null || minor === undefined) return null;
  const value = Number(minor);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1_000_000) return "UNDER_10K";
  if (value < 10_000_000) return "10K_100K";
  if (value < 100_000_000) return "100K_1M";
  return "OVER_1M";
}

export const LENDING_REGION_LIST: readonly LendingRegion[] = [
  "AFRICA", "LATIN_AMERICA", "NORTH_AMERICA", "EUROPE", "SOUTH_ASIA", "SOUTHEAST_ASIA", "EAST_ASIA", "OCEANIA", "MIDDLE_EAST", "GLOBAL",
];

const REGION_LABELS: Record<LendingRegion, string> = {
  AFRICA: "Africa", LATIN_AMERICA: "Latin America", NORTH_AMERICA: "North America", EUROPE: "Europe",
  SOUTH_ASIA: "South Asia", SOUTHEAST_ASIA: "Southeast Asia", EAST_ASIA: "East Asia", OCEANIA: "Oceania",
  MIDDLE_EAST: "Middle East", GLOBAL: "Global",
};

export function lendingRegionLabel(value: LendingRegion): string {
  return REGION_LABELS[value] ?? "Global";
}

export const LENDING_REGION_CENTROIDS: Record<LendingRegion, [number, number]> = {
  AFRICA: [20, 3],
  LATIN_AMERICA: [-60, -15],
  NORTH_AMERICA: [-100, 45],
  EUROPE: [14, 52],
  SOUTH_ASIA: [78, 21],
  SOUTHEAST_ASIA: [110, 8],
  EAST_ASIA: [116, 36],
  OCEANIA: [140, -25],
  MIDDLE_EAST: [45, 28],
  GLOBAL: [10, 20],
};

const ISO2_TO_REGION: Record<string, LendingRegion> = {
  DZ: "AFRICA", AO: "AFRICA", BJ: "AFRICA", BW: "AFRICA", BF: "AFRICA", BI: "AFRICA", CM: "AFRICA", CV: "AFRICA",
  CF: "AFRICA", TD: "AFRICA", KM: "AFRICA", CG: "AFRICA", CD: "AFRICA", CI: "AFRICA", DJ: "AFRICA", EG: "AFRICA",
  GQ: "AFRICA", ER: "AFRICA", SZ: "AFRICA", ET: "AFRICA", GA: "AFRICA", GM: "AFRICA", GH: "AFRICA", GN: "AFRICA",
  GW: "AFRICA", KE: "AFRICA", LS: "AFRICA", LR: "AFRICA", LY: "AFRICA", MG: "AFRICA", MW: "AFRICA", ML: "AFRICA",
  MR: "AFRICA", MU: "AFRICA", MA: "AFRICA", MZ: "AFRICA", NA: "AFRICA", NE: "AFRICA", NG: "AFRICA", RW: "AFRICA",
  ST: "AFRICA", SN: "AFRICA", SC: "AFRICA", SL: "AFRICA", SO: "AFRICA", ZA: "AFRICA", SS: "AFRICA", SD: "AFRICA",
  TZ: "AFRICA", TG: "AFRICA", TN: "AFRICA", UG: "AFRICA", ZM: "AFRICA", ZW: "AFRICA",
  AR: "LATIN_AMERICA", BO: "LATIN_AMERICA", BR: "LATIN_AMERICA", CL: "LATIN_AMERICA", CO: "LATIN_AMERICA",
  CR: "LATIN_AMERICA", CU: "LATIN_AMERICA", DO: "LATIN_AMERICA", EC: "LATIN_AMERICA", SV: "LATIN_AMERICA",
  GT: "LATIN_AMERICA", HT: "LATIN_AMERICA", HN: "LATIN_AMERICA", JM: "LATIN_AMERICA", MX: "LATIN_AMERICA",
  NI: "LATIN_AMERICA", PA: "LATIN_AMERICA", PY: "LATIN_AMERICA", PE: "LATIN_AMERICA", PR: "LATIN_AMERICA",
  TT: "LATIN_AMERICA", UY: "LATIN_AMERICA", VE: "LATIN_AMERICA",
  CA: "NORTH_AMERICA", US: "NORTH_AMERICA",
  AL: "EUROPE", AD: "EUROPE", AT: "EUROPE", BY: "EUROPE", BE: "EUROPE", BA: "EUROPE", BG: "EUROPE", HR: "EUROPE",
  CY: "EUROPE", CZ: "EUROPE", DK: "EUROPE", EE: "EUROPE", FI: "EUROPE", FR: "EUROPE", DE: "EUROPE", GR: "EUROPE",
  HU: "EUROPE", IS: "EUROPE", IE: "EUROPE", IT: "EUROPE", LV: "EUROPE", LI: "EUROPE", LT: "EUROPE", LU: "EUROPE",
  MT: "EUROPE", MD: "EUROPE", MC: "EUROPE", ME: "EUROPE", NL: "EUROPE", MK: "EUROPE", NO: "EUROPE", PL: "EUROPE",
  PT: "EUROPE", RO: "EUROPE", RU: "EUROPE", SM: "EUROPE", RS: "EUROPE", SK: "EUROPE", SI: "EUROPE", ES: "EUROPE",
  SE: "EUROPE", CH: "EUROPE", UA: "EUROPE", GB: "EUROPE",
  AF: "SOUTH_ASIA", BD: "SOUTH_ASIA", BT: "SOUTH_ASIA", IN: "SOUTH_ASIA", MV: "SOUTH_ASIA", NP: "SOUTH_ASIA",
  PK: "SOUTH_ASIA", LK: "SOUTH_ASIA",
  BN: "SOUTHEAST_ASIA", KH: "SOUTHEAST_ASIA", ID: "SOUTHEAST_ASIA", LA: "SOUTHEAST_ASIA", MY: "SOUTHEAST_ASIA",
  MM: "SOUTHEAST_ASIA", PH: "SOUTHEAST_ASIA", SG: "SOUTHEAST_ASIA", TH: "SOUTHEAST_ASIA", TL: "SOUTHEAST_ASIA", VN: "SOUTHEAST_ASIA",
  CN: "EAST_ASIA", JP: "EAST_ASIA", KP: "EAST_ASIA", KR: "EAST_ASIA", MN: "EAST_ASIA", TW: "EAST_ASIA", HK: "EAST_ASIA",
  AU: "OCEANIA", FJ: "OCEANIA", NZ: "OCEANIA", PG: "OCEANIA", WS: "OCEANIA", SB: "OCEANIA", TO: "OCEANIA", VU: "OCEANIA",
  BH: "MIDDLE_EAST", IR: "MIDDLE_EAST", IQ: "MIDDLE_EAST", IL: "MIDDLE_EAST", JO: "MIDDLE_EAST", KW: "MIDDLE_EAST",
  LB: "MIDDLE_EAST", OM: "MIDDLE_EAST", QA: "MIDDLE_EAST", SA: "MIDDLE_EAST", SY: "MIDDLE_EAST", TR: "MIDDLE_EAST",
  AE: "MIDDLE_EAST", YE: "MIDDLE_EAST",
};

/** Resolve the atlas region for an ISO-3166 alpha-2 country code. */
export function lendingRegionOf(countryCode: string | null | undefined): LendingRegion {
  const code = String(countryCode || "").trim().toUpperCase();
  return ISO2_TO_REGION[code] ?? "GLOBAL";
}

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  US: [-98, 39], CA: [-106, 56], MX: [-102, 23], BR: [-51, -10], AR: [-64, -34], CL: [-71, -35], CO: [-74, 4],
  PE: [-75, -10], ZA: [24, -29], NG: [8, 9], KE: [38, 0], GH: [-1, 7], EG: [30, 27], MA: [-7, 32], TZ: [35, -6],
  UG: [32, 1], ET: [40, 8], GB: [-3, 55], FR: [2, 46], DE: [10, 51], ES: [-4, 40], IT: [12, 42], NL: [5, 52],
  PL: [20, 52], SE: [15, 62], NO: [8, 61], CH: [8, 47], IE: [-8, 53], PT: [-8, 39], TR: [35, 39], RU: [100, 60],
  UA: [32, 49], IN: [79, 22], PK: [69, 30], BD: [90, 24], LK: [81, 7], NP: [84, 28], CN: [104, 35], JP: [138, 36],
  KR: [128, 36], ID: [113, -1], VN: [108, 16], TH: [101, 15], PH: [122, 13], MY: [102, 4], SG: [104, 1],
  AU: [134, -25], NZ: [174, -41], AE: [54, 24], SA: [45, 24], QA: [51, 25], IL: [35, 31], ZM: [27, -15], ZW: [30, -19],
};

/** Approximate longitude/latitude for a country code, falling back to its region's centroid. */
export function lendingCountryPoint(countryCode: string | null | undefined): [number, number] {
  const code = String(countryCode || "").trim().toUpperCase();
  return COUNTRY_CENTROIDS[code] ?? LENDING_REGION_CENTROIDS[lendingRegionOf(code)];
}

/* ------------------------------------------------------------------ *
 * Classifiers
 * ------------------------------------------------------------------ */

const TYPE_PATTERNS: [LoanType, RegExp][] = [
  ["MORTGAGE", /\b(mortgage|home loan|housing loan|title|deed of trust)\b/i],
  ["REAL_ESTATE", /\b(real estate|property development|commercial property|land development)\b/i],
  ["AUTO", /\b(auto|car|vehicle|fleet|motor)\b/i],
  ["STUDENT", /\b(student|tuition|education|school fee|university)\b/i],
  ["MEDICAL", /\b(medical|hospital|health|surgery|treatment)\b/i],
  ["AGRICULTURAL", /\b(agri|farm|crop|harvest|livestock|season)\b/i],
  ["INVOICE_FACTORING", /\b(invoice|factoring|receivable|debtor book)\b/i],
  ["TRADE_FINANCE", /\b(trade finance|import|export|letter of credit|purchase order)\b/i],
  ["EQUIPMENT_FINANCE", /\b(equipment|machinery|plant|asset finance|tools)\b/i],
  ["PROJECT_FINANCE", /\b(project finance|infrastructure|ring-fence|spv)\b/i],
  ["BRIDGE", /\b(bridge|short-term|mezzanine)\b/i],
  ["SME_EXPANSION", /\b(sme|expansion|growth capital|scale-up)\b/i],
  ["BUSINESS_WORKING_CAPITAL", /\b(working capital|cash flow|overdraft|business loan)\b/i],
  ["PERSONAL", /\b(personal|consumer|salary|payday)\b/i],
];

export function classifyLoanType(input: { title?: string | null; description?: string | null; hint?: LoanType | null }): LoanType {
  if (input.hint && (LENDING_LOAN_TYPES as readonly string[]).includes(input.hint)) return input.hint;
  const haystack = `${input.title || ""} ${input.description || ""}`;
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(haystack)) return type;
  return "PERSONAL";
}

/* ------------------------------------------------------------------ *
 * Interest maths — annual basis points on principal (minor units)
 * ------------------------------------------------------------------ */

/** Interest accrued over one whole letter-month at an annual rate in basis points. */
export function monthlyInterestMinor(principalMinor: number | null | undefined, annualInterestBps: number | null | undefined): number | null {
  const principal = Number(principalMinor);
  const bps = Number(annualInterestBps);
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isFinite(bps) || bps <= 0) return null;
  return Math.round((principal * bps) / 100 / 12);
}

/** Simple interest for one whole year at an annual rate in basis points. */
export function yearlyInterestMinor(principalMinor: number | null | undefined, annualInterestBps: number | null | undefined): number | null {
  const principal = Number(principalMinor);
  const bps = Number(annualInterestBps);
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isFinite(bps) || bps <= 0) return null;
  return Math.round((principal * bps) / 10_000);
}

/**
 * Interest plus capital (the total a borrower repays) over a whole-month tenure
 * at a simple annual rate in basis points. Capital × (1 + bps/10,000 × months/12).
 */
export function interestPlusCapitalMinor(
  principalMinor: number | null | undefined,
  annualInterestBps: number | null | undefined,
  tenureMonths: number | null | undefined,
): number | null {
  const principal = Number(principalMinor);
  const bps = Number(annualInterestBps);
  const months = Number(tenureMonths);
  if (!Number.isFinite(principal) || principal <= 0) return null;
  if (!Number.isFinite(bps) || bps < 0) return null;
  if (!Number.isFinite(months) || months <= 0) return null;
  return Math.round(principal * (1 + (bps / 10_000) * (months / 12)));
}

/** The whole-month tenure a lender actually receives, or null when only one bound is set. */
export function lendingTenureRangeMonths(minimum: number | null | undefined, maximum: number | null | undefined): [number, number] | null {
  const lo = Number(minimum);
  const hi = Number(maximum);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo <= 0 || hi <= 0 || hi < lo) return null;
  return [lo, hi];
}

/** Whole seconds until an ISO timestamp, floored at zero. */
export function lendingRemainingSecondsFor(target: string | null | undefined, now: number = Date.now()): number | null {
  if (!target) return null;
  const at = Date.parse(target);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Whole days until an ISO timestamp (ceil), or null. */
export function lendingRemainingDaysFor(target: string | null): number | null {
  const seconds = lendingRemainingSecondsFor(target);
  if (seconds === null) return null;
  return Math.ceil(seconds / 86_400);
}

/* ------------------------------------------------------------------ *
 * Live-auction state — shared by the server and the countdown
 * ------------------------------------------------------------------ */

/** Whole seconds within which an open auction is shown as "closing soon". */
export const LENDING_CLOSING_SOON_SECONDS = 3600;
/** The minimum interest increment (bps) a borrower must add to overtake the leader. */
export const LENDING_MIN_BID_STEP_BPS = 5;

/**
 * Derive an auction's live status from its stage and its administrator-controlled
 * open/close timestamps. Evaluated against `now` so the server and the customer's
 * countdown always agree, regardless of a drifted wall clock.
 */
export function lendingAuctionStatusFor(input: {
  stage: LoanStage;
  auctionOpensAt?: string | null;
  auctionClosesAt?: string | null;
  now?: number;
}): LoanAuctionStatus {
  if (input.stage === "WITHDRAWN") return "CANCELLED";
  if (input.stage === "ALLOCATED" || input.stage === "DISBURSED" || input.stage === "REPAYING" || input.stage === "SETTLED" || input.stage === "DEFAULTED") {
    return "ALLOCATED";
  }
  const now = input.now ?? Date.now();
  const opens = input.auctionOpensAt ? Date.parse(input.auctionOpensAt) : Number.NaN;
  const closes = input.auctionClosesAt ? Date.parse(input.auctionClosesAt) : Number.NaN;
  if (Number.isFinite(closes) && now >= closes) return "CLOSED";
  if (Number.isFinite(opens) && now < opens) return "SCHEDULED";
  if (!Number.isFinite(closes)) return "SCHEDULED";
  const remaining = (closes - now) / 1000;
  return remaining <= LENDING_CLOSING_SOON_SECONDS ? "CLOSING_SOON" : "OPEN";
}

/** True when a loan is open for bidding right now (enabled, scheduled, not yet closed). */
export function lendingBiddableFor(input: {
  stage: LoanStage;
  auctionOpensAt?: string | null;
  auctionClosesAt?: string | null;
  enabled?: boolean;
  now?: number;
}): boolean {
  if (input.enabled === false) return false;
  const status = lendingAuctionStatusFor(input);
  return status === "OPEN" || status === "CLOSING_SOON";
}

/** The interest (bps) a borrower must bid to take the top spot, given the current leader. */
export function lendingNextRequiredBps(topBidBps: number | null | undefined, startingInterestBps: number | null | undefined): number | null {
  const top = Number(topBidBps);
  if (Number.isFinite(top) && top > 0) return top + LENDING_MIN_BID_STEP_BPS;
  const start = Number(startingInterestBps);
  if (Number.isFinite(start) && start > 0) return start;
  return null;
}

/* ------------------------------------------------------------------ *
 * Default disbursement conditions
 * ------------------------------------------------------------------ */

const DEFAULT_CONDITIONS: [DisbursementConditionType, string, boolean][] = [
  ["KYC_VERIFIED", "Identity verified (KYC)", true],
  ["DOCUMENTATION", "Loan documents submitted and countersigned", true],
  ["REPAYMENT_MANDATE", "Repayment mandate signed", true],
  ["BANK_ACCOUNT", "Disbursement bank account verified", true],
];

/** The standard condition set every loan starts with, until an admin edits it. */
export function defaultLendingDisbursementConditions(): DisbursementCondition[] {
  return DEFAULT_CONDITIONS.map(([type, label, required]) => ({
    type, label, required, status: "PENDING" as const, detail: null, metAt: null,
  }));
}

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

const STAGE_ORDER: Record<LoanStage, number> = {
  BIDDING: 0, ALLOCATED: 1, DRAFT: 2, DISBURSED: 3, REPAYING: 4, SETTLED: 5, DEFAULTED: 6, WITHDRAWN: 7,
};
const AUCTION_ORDER: Record<LoanAuctionStatus, number> = {
  OPEN: 0, CLOSING_SOON: 1, SCHEDULED: 2, CLOSED: 3, ALLOCATED: 4, CANCELLED: 5,
};
const RISK_ORDER: Record<LendingRiskGrade, number> = { PRIME: 0, BALANCED: 1, SPECULATIVE: 2, HIGH_RISK: 3 };

/** Open auctions first, then closing-soon, then stage, risk, leading interest and recency. */
export function compareLendingLoans(a: LendingLoan, b: LendingLoan): number {
  if (a.biddable !== b.biddable) return a.biddable ? -1 : 1;
  const auction = AUCTION_ORDER[a.auctionStatus] - AUCTION_ORDER[b.auctionStatus];
  if (auction !== 0) return auction;
  const stage = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
  if (stage !== 0) return stage;
  const risk = (a.riskGrade ? RISK_ORDER[a.riskGrade] : 9) - (b.riskGrade ? RISK_ORDER[b.riskGrade] : 9);
  if (risk !== 0) return risk;
  if ((a.topBidBps ?? 0) !== (b.topBidBps ?? 0)) return (b.topBidBps ?? 0) - (a.topBidBps ?? 0);
  if (a.asOf !== b.asOf) return b.asOf.localeCompare(a.asOf);
  return a.title.localeCompare(b.title);
}

/** Order live bids into the auction leaderboard: highest interest on top, earliest first. */
export function rankLendingBids<T extends { bidInterestBps: number; amountMinor: number; placedAt: string }>(bids: T[]): T[] {
  return [...bids].sort((a, b) => {
    if (b.bidInterestBps !== a.bidInterestBps) return b.bidInterestBps - a.bidInterestBps;
    if (b.amountMinor !== a.amountMinor) return b.amountMinor - a.amountMinor;
    return String(a.placedAt).localeCompare(String(b.placedAt));
  });
}

/* ------------------------------------------------------------------ *
 * Discovery layer — cited public financial-inclusion references (keyless)
 * ------------------------------------------------------------------ */

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

const WORLDBANK_BASE = "https://api.worldbank.org/v2";
const WORLD_BANK_ISO3 =
  "BRA;IND;USA;CHN;KEN;NGA;AUS;ARG;IDN;VNM;UKR;FRA;PER;COD;COL;MEX;MOZ;TZA;ZMB;GHA";
const WORLD_BANK_DATE_RANGE = "2015:2024";
const ISO3_TO_ISO2: Record<string, string> = {
  BRA: "BR", IND: "IN", USA: "US", CHN: "CN", KEN: "KE", NGA: "NG",
  AUS: "AU", ARG: "AR", IDN: "ID", VNM: "VN", UKR: "UA", FRA: "FR",
  PER: "PE", COD: "CD", COL: "CO", MEX: "MX", MOZ: "MZ", TZA: "TZ",
  ZMB: "ZM", GHA: "GH",
};

const WORLDBANK_INDICATORS: {
  code: string;
  name: string;
  unit: string;
  loanType: LoanType;
  sector: LoanSector;
}[] = [
  { code: "FX.OWN.TOTL.ZS", name: "Account ownership at a financial institution", unit: "% of population age 15+", loanType: "BUSINESS_WORKING_CAPITAL", sector: "BUSINESS" },
  { code: "FS.AST.PRVT.GD.ZS", name: "Domestic credit to the private sector by banks", unit: "% of GDP", loanType: "TRADE_FINANCE", sector: "TRADE" },
  { code: "FS.AST.DOMS.GD.ZS", name: "Domestic credit provided by the financial sector", unit: "% of GDP", loanType: "PROJECT_FINANCE", sector: "PROJECT" },
  { code: "FX.OWN.TOTL.ZS", name: "Borrowed from a financial institution", unit: "% of population age 15+", loanType: "PERSONAL", sector: "CONSUMER" },
  { code: "AG.LND.AGRI.ZS", name: "Agricultural land", unit: "% of land area", loanType: "AGRICULTURAL", sector: "AGRICULTURE" },
];

function envKey(name: string): string {
  try {
    const value = (globalThis as any)?.process?.env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function decodeEntities(value: string): string {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function fetchWorldBankIndicator(indicator: (typeof WORLDBANK_INDICATORS)[number]): Promise<LendingLoan[]> {
  const url = `${WORLDBANK_BASE}/country/${WORLD_BANK_ISO3}/indicator/${indicator.code}?format=json&per_page=100&date=${WORLD_BANK_DATE_RANGE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`World Bank responded ${response.status}`);
    const payload: any = await response.json();
    const records: any[] = Array.isArray(payload?.[1]) ? payload[1] : [];
    const mapped: LendingLoan[] = [];
    for (const record of records) {
      const value = record?.value;
      if (value === null || value === undefined || value === "") continue;
      const countryiso3 = String(record?.countryiso3code || "").toUpperCase();
      const iso2 = ISO3_TO_ISO2[countryiso3];
      if (!iso2) continue;
      const countryName = decodeEntities(String(record?.country?.value || "")).trim();
      const date = String(record?.date || "");
      if (!countryName || !date) continue;
      mapped.push({
        id: `wb-${indicator.code}-${countryiso3}-${date}`,
        title: `${indicator.name} — ${countryName} (${date})`,
        borrower: "World Bank Open Data",
        loanType: indicator.loanType,
        sector: indicator.sector,
        purpose: `A cited public lending reference surfaced from the World Bank Open Data feed. No funding economics are published for discovery references.`,
        territory: countryName,
        territoryBand: "NATIONAL",
        region: lendingRegionOf(iso2),
        countryCode: iso2,
        country: countryName,
        flag: flagFor(iso2),
        description: `${countryName} — “${indicator.name}” (${date}, ${indicator.unit}). Cited public lending context; no lending economics are published for discovery references.`,
        principalMinor: null,
        currency: "USD",
        startingInterestBps: null,
        minimumTenureMonths: null,
        maximumTenureMonths: null,
        repaymentFrequency: "MONTHLY",
        monthlyInterestMinor: null,
        yearlyInterestMinor: null,
        interestPlusCapitalMinor: null,
        platformFeeBps: null,
        riskGrade: null,
        collateral: null,
        highlights: typeof value !== "undefined" ? [`Value: ${value} ${indicator.unit}`] : [],
        stage: "BIDDING",
        auctionOpensAt: null,
        auctionClosesAt: null,
        auctionStatus: "SCHEDULED",
        remainingSeconds: null,
        bidCount: 0,
        topBidBps: null,
        leadingBorrower: null,
        viewerIsLeading: false,
        viewerBidId: null,
        viewerNextRequiredBps: null,
        conditions: defaultLendingDisbursementConditions(),
        winnerLabel: null,
        source: "World Bank Open Data",
        sourceUrl: `https://data.worldbank.org/indicator/${indicator.code}`,
        asOf: `${date}-01-01`,
        verified: false,
        biddable: false,
        verificationStatus: "REFERENCE",
      });
    }
    return mapped;
  } finally {
    clearTimeout(timer);
  }
}

let cache: { value: LendingCatalogue; expiresAt: number } | null = null;
let inflight: Promise<LendingCatalogue> | null = null;

async function buildCatalogue(): Promise<LendingCatalogue> {
  const loans: LendingLoan[] = [];
  const seen = new Set<string>();
  const results = await Promise.allSettled(WORLDBANK_INDICATORS.map((indicator) => fetchWorldBankIndicator(indicator)));
  let count = 0;
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[Lending] World Bank discovery source failed:", result.reason instanceof Error ? result.reason.message : "UnknownError");
      continue;
    }
    for (const item of result.value) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      loans.push(item);
      count += 1;
    }
  }
  const ok = count > 0;
  const sources: LendingInvestmentSource[] = [
    {
      name: "Arbitrade lending desk — administrator published",
      url: "",
      country: "XX",
      role: "opportunities",
      status: "ok",
      detail: "Loan opportunities across the fourteen lending types are published by the desk administrator with cited economics, and lender reserves show how much capacity is available to borrowers.",
    },
    {
      name: "World Bank Open Data",
      url: "https://data.worldbank.org",
      country: "XX",
      role: "catalogue",
      status: ok ? "ok" : "degraded",
      detail: ok
        ? `${count} cited public lending reference${count === 1 ? "" : "s"} surfaced across ${WORLD_BANK_ISO3.split(";").length} countries for context. References carry no funding economics.`
        : "The World Bank public lending reference feed is unavailable right now; administrator-published opportunities are unaffected.",
    },
    {
      name: "Arbitrade lending desk — desk methodology",
      url: "",
      country: "XX",
      role: "context",
      status: "ok",
      detail: "Lending only: personal, auto, mortgage, business working capital, SME expansion, equipment finance, invoice factoring, trade finance, bridge, project finance, student, medical, agricultural and real estate. No non-lending assets are carried.",
    },
  ];
  return { loans, sources, fetchedAt: new Date().toISOString(), degraded: sources.some((source) => source.status !== "ok") };
}

/** Return the live catalogue, reusing the in-memory cache for ten minutes. */
export async function getLendingCatalogue(options: { force?: boolean } = {}): Promise<LendingCatalogue> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await buildCatalogue();
      if (value.loans.length) cache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Look up a single discovery loan by its stable id. */
export async function findLendingLoan(id: string): Promise<LendingLoan | null> {
  const catalogue = await getLendingCatalogue();
  return catalogue.loans.find((item) => item.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Desk analytics — aggregated from the loans on the desk
 * ------------------------------------------------------------------ */

export type LendingAnalyticsBucket = { key: string; label: string; count: number };

export type LendingAnalytics = {
  totalLoans: number;
  openAuctions: number;
  totalPrincipalMinor: number;
  totalTopBidBps: number;
  lendersReservedMinor: number;
  byType: LendingAnalyticsBucket[];
  bySector: LendingAnalyticsBucket[];
  byRisk: LendingAnalyticsBucket[];
  byRegion: LendingAnalyticsBucket[];
  byTerritory: LendingAnalyticsBucket[];
  byAuctionStatus: LendingAnalyticsBucket[];
  byMonth: LendingAnalyticsBucket[];
};

const ISO_MONTH = /^\d{4}-\d{2}$/;

export function buildLendingAnalytics(loans: LendingLoan[]): LendingAnalytics {
  const typeCounts = new Map<LoanType, number>();
  const sectorCounts = new Map<LoanSector, number>();
  const riskCounts = new Map<string, number>();
  const regionCounts = new Map<LendingRegion, number>();
  const territoryCounts = new Map<string, number>();
  const auctionCounts = new Map<LoanAuctionStatus, number>();
  const monthCounts = new Map<string, number>();
  let openAuctions = 0;
  let totalPrincipalMinor = 0;
  let totalTopBidBps = 0;

  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const loan of loans) {
    bump(typeCounts, loan.loanType);
    bump(sectorCounts, loan.sector);
    bump(riskCounts, loan.riskGrade ?? "UNRATED");
    bump(regionCounts, loan.region);
    bump(territoryCounts, loan.territory || "Unspecified");
    bump(auctionCounts, loan.auctionStatus);
    const month = (loan.auctionOpensAt || loan.asOf || "").slice(0, 7);
    if (ISO_MONTH.test(month)) bump(monthCounts, month);
    if (loan.biddable) openAuctions += 1;
    totalPrincipalMinor += Number(loan.principalMinor || 0);
    totalTopBidBps += Number(loan.topBidBps || 0);
  }

  const buckets = <K>(map: Map<K, number>, label: (key: K) => string): LendingAnalyticsBucket[] =>
    [...map.entries()].map(([key, count]) => ({ key: String(key), label: label(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    totalLoans: loans.length,
    openAuctions,
    totalPrincipalMinor,
    totalTopBidBps,
    lendersReservedMinor: totalPrincipalMinor,
    byType: buckets(typeCounts, (key) => loanTypeLabel(key)),
    bySector: buckets(sectorCounts, (key) => lendingSectorLabel(key)),
    byRisk: buckets(riskCounts, (key) => (key === "UNRATED" ? "Unrated" : lendingRiskLabel(key as LendingRiskGrade))),
    byRegion: buckets(regionCounts, (key) => lendingRegionLabel(key)),
    byTerritory: buckets(territoryCounts, (key) => key).slice(0, 12),
    byAuctionStatus: buckets(auctionCounts, (key) => lendingAuctionStatusLabel(key)),
    byMonth: buckets(monthCounts, (key) => key).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12),
  };
}

export function __resetLendingCacheForTest() {
  cache = null;
  inflight = null;
}

export const LENDING_WORLDBANK_INDICATORS = WORLDBANK_INDICATORS;
export const LENDING_DESK_CURRENCY = "USD";
export function lendingEnvKey(name: string): string {
  return envKey(name);
}
