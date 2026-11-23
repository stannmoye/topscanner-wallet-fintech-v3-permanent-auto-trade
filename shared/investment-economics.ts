/**
 * Desk investment economics — the owner-approved auto-assignment layer.
 *
 * The platform owner has directed that every opportunity shown on the investment
 * desks (Treasury Bond, Litigation Funds, Agro Investment, IP Royalties, Music
 * Royalties, Carbon Credit and Cooperate Dept) carries a richer, more realistic
 * economic profile even before an administrator hand-authors one:
 *
 *   - an investable amount between USD 500 and USD 1,000,000,
 *   - a profit of 25%–38% (stored as integer basis points, 2,500–3,800),
 *   - a close window of 30 days to 1 year (the funding close plus the term to
 *     realising the profit),
 *   - a presentation currency drawn from a USD-dominant multi-currency set
 *     (USD, EUR, GBP, CNY, JPY, ZAR and others),
 *   - a platform fee of 7%–10% (700–1,000 bps), and
 *   - a settlement-delay bolt-on for *some* opportunities only, so a delay looks
 *     like a real exception rather than a uniform rule.
 *
 * The values are derived deterministically from the opportunity's stable id, so
 * the same opportunity always shows the same numbers (some opportunities look
 * alike), while different ids differ (some look different) — and the values are
 * quantised onto "nice" steps so repeated amounts and rates genuinely repeat.
 *
 * This module is deliberately environment-neutral (no Node-only imports) so it
 * can run on the server, in the admin console and, as a resilience fallback, in
 * the customer's browser. The server persists each assignment and lets an
 * administrator override any value; an ADMIN-sourced row is never re-derived.
 */

/** The investment desks that carry auto-assigned economics. */
export type DeskKey = "treasury" | "litigation" | "agro" | "ipRoyalty" | "music" | "cooperate" | "carbon";

export const DESK_KEYS: readonly DeskKey[] = [
  "treasury", "litigation", "agro", "ipRoyalty", "music", "cooperate", "carbon",
];

const DESK_LABELS: Record<DeskKey, string> = {
  treasury: "Treasury Bond",
  litigation: "Litigation Funds",
  agro: "Agro Investment",
  ipRoyalty: "IP Royalties",
  music: "Music Royalties",
  cooperate: "Cooperate Dept",
  carbon: "Carbon Credit",
};

export function deskLabel(desk: DeskKey): string {
  return DESK_LABELS[desk] ?? "Investment desk";
}

/** A presentation currency with an indicative USD conversion, used only to size amounts. */
export type InvestmentCurrency = {
  code: string;
  scale: number;
  symbol: string;
  /** Indicative USD value of one unit; used to anchor every amount to the USD 500–1,000,000 band. */
  usdPerUnit: number;
  /** Relative selection weight; the set sums to 100 and USD dominates. */
  weight: number;
};

/**
 * The multi-currency set. USD is deliberately dominant (weight 60), then the
 * major trade currencies, then a spread of other-country currencies exactly as
 * the brief asked. `usdPerUnit` values are indicative reference rates — they
 * only size the displayed amount and are not a live FX quote.
 */
export const INVESTMENT_CURRENCIES: readonly InvestmentCurrency[] = [
  { code: "USD", scale: 2, symbol: "$", usdPerUnit: 1, weight: 60 },
  { code: "EUR", scale: 2, symbol: "€", usdPerUnit: 1.08, weight: 9 },
  { code: "GBP", scale: 2, symbol: "£", usdPerUnit: 1.27, weight: 7 },
  { code: "CNY", scale: 2, symbol: "¥", usdPerUnit: 0.138, weight: 5 },
  { code: "JPY", scale: 0, symbol: "¥", usdPerUnit: 0.0067, weight: 4 },
  { code: "ZAR", scale: 2, symbol: "R", usdPerUnit: 0.055, weight: 3 },
  { code: "INR", scale: 2, symbol: "₹", usdPerUnit: 0.012, weight: 3 },
  { code: "AUD", scale: 2, symbol: "A$", usdPerUnit: 0.66, weight: 2 },
  { code: "CAD", scale: 2, symbol: "C$", usdPerUnit: 0.74, weight: 2 },
  { code: "CHF", scale: 2, symbol: "CHF ", usdPerUnit: 1.12, weight: 2 },
  { code: "BRL", scale: 2, symbol: "R$", usdPerUnit: 0.18, weight: 1 },
  { code: "NGN", scale: 2, symbol: "₦", usdPerUnit: 0.00065, weight: 1 },
  { code: "KES", scale: 2, symbol: "KSh ", usdPerUnit: 0.0077, weight: 1 },
];

const CURRENCY_BY_CODE = new Map(INVESTMENT_CURRENCIES.map((currency) => [currency.code, currency]));

export function currencyByCode(code: string): InvestmentCurrency | null {
  return CURRENCY_BY_CODE.get(String(code || "").toUpperCase()) ?? null;
}

/** Every bound the assignment respects. The admin console validates against the same numbers. */
export const ECONOMICS_BOUNDS = {
  ticketMinMinorUsd: 50_000, // USD 500 in minor units (cents)
  ticketMinMaxMinorUsd: 2_500_000, // USD 25,000 ceiling for a single minimum ticket
  fundingTargetMinMinorUsd: 50_000, // USD 500
  fundingTargetMaxMinorUsd: 100_000_000, // USD 1,000,000
  profitMinBps: 2_500, // 25%
  profitMaxBps: 3_800, // 38%
  profitStepBps: 25, // 0.25% — "nice" repeated rates
  termMinDays: 30,
  termMaxDays: 365,
  platformFeeMinBps: 700, // 7%
  platformFeeMaxBps: 1_000, // 10%
  platformFeeStepBps: 25,
  settlementDelayMinDays: 1,
  settlementDelayMaxDays: 21,
  /** Share of opportunities that carry a settlement delay, in bps (35%). */
  settlementDelayChanceBps: 3_500,
} as const;

/** The close windows and realisation terms the assignment draws from, so tenors repeat. */
export const CLOSE_WINDOW_DAYS: readonly number[] = [3, 5, 7, 10, 14, 21, 30, 45];
export const TERM_DAY_CHOICES: readonly number[] = [30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365];

export type EconomicsSource = "AUTO" | "ADMIN";

/** One opportunity's economic profile. All money is integer minor units of `currency`. */
export type DeskEconomics = {
  desk: DeskKey;
  instrumentId: string;
  currency: string;
  currencyScale: number;
  currencySymbol: string;
  /** The least a customer can place in the opportunity. */
  ticketMinMinor: number;
  /** The opportunity's capital target (USD 500 – 1,000,000 equivalent). */
  fundingTargetMinor: number;
  /** Profit to funders in basis points (2,500–3,800 = 25%–38%). */
  profitBps: number;
  /** Whole days from funding close to realising the profit (30–365). */
  termDays: number;
  /** Whole days from now to the funding close. */
  closeWindowDays: number;
  /** Funding close date (YYYY-MM-DD). */
  closeDate: string;
  /** Date the profit is realised (close + termDays), YYYY-MM-DD. */
  maturityDate: string;
  /** Platform fee in basis points (700–1,000 = 7%–10%). */
  platformFeeBps: number;
  /** Extra whole days a payout may be delayed by, or null when this opportunity has none. */
  settlementDelayDays: number | null;
  source: EconomicsSource;
  assignedAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-random helpers (no external crypto dependency)
 * ------------------------------------------------------------------ */

/** FNV-1a 32-bit hash of a string. */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — a small, fast, deterministic 32-bit PRNG returning [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

function addDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Log-uniform between lo and hi (inclusive), so small amounts are common and big ones still appear. */
function logUniform(rng: () => number, lo: number, hi: number): number {
  const logged = Math.log(lo) + rng() * (Math.log(hi) - Math.log(lo));
  return Math.exp(logged);
}

const roundTo = (value: number, step: number): number => Math.max(step, Math.round(value / step) * step);

/** A human-friendly rounding step for a local-currency magnitude. */
function niceStep(value: number): number {
  if (value >= 1_000_000) return 100_000;
  if (value >= 100_000) return 10_000;
  if (value >= 10_000) return 1_000;
  if (value >= 1_000) return 100;
  if (value >= 100) return 10;
  return 1;
}

function weightedCurrency(rng: () => number): InvestmentCurrency {
  const total = INVESTMENT_CURRENCIES.reduce((sum, currency) => sum + currency.weight, 0);
  let roll = rng() * total;
  for (const currency of INVESTMENT_CURRENCIES) {
    roll -= currency.weight;
    if (roll <= 0) return currency;
  }
  return INVESTMENT_CURRENCIES[0];
}

/** Convert a USD minor amount into the opportunity's currency, rounded to a nice local step. */
function usdMinorToCurrency(usdMinor: number, currency: InvestmentCurrency): number {
  const usdValue = usdMinor / 100;
  const local = usdValue / currency.usdPerUnit;
  const rounded = roundTo(local, niceStep(local));
  return Math.max(1, Math.round(rounded * Math.pow(10, currency.scale)));
}

/** Convert an amount in an opportunity's currency back to USD minor units (indicative). */
export function currencyMinorToUsdMinor(amountMinor: number, currencyCode: string): number {
  const currency = currencyByCode(currencyCode);
  if (!currency) return Math.round(Number(amountMinor) || 0);
  const units = (Number(amountMinor) || 0) / Math.pow(10, currency.scale);
  return Math.round(units * currency.usdPerUnit * 100);
}

/** Convert a USD minor amount into an opportunity's currency, rounded to a nice local step. */
export function usdMinorToCurrencyMinor(usdMinor: number, currencyCode: string): number {
  const currency = currencyByCode(currencyCode);
  if (!currency) return Math.round(Number(usdMinor) || 0);
  return usdMinorToCurrency(Number(usdMinor) || 0, currency);
}

/**
 * Add whole calendar months to a YYYY-MM-DD date, clamping to the last valid day
 * of the resulting month (e.g. 31 Jan + 1 month = 28/29 Feb). Used by the admin
 * console to extend an offer's close or payout deadline without drifting the day.
 * An unparseable input is returned unchanged.
 */
export function addMonthsToIsoDate(isoDate: string, months: number): string {
  const text = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) return text;
  const [year, month, day] = text.split("-").map((part) => Number(part));
  const base = new Date(Date.UTC(year, month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + Math.round(Number(months) || 0));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(base);
}

export type AssignEconomicsInput = {
  desk: DeskKey;
  instrumentId: string;
  /** Optional extra salt so a re-assignment can be re-rolled deliberately. */
  salt?: string;
  /** Base time for the close/maturity dates; defaults to now. */
  now?: Date;
};

/**
 * Deterministically derive an economic profile for one opportunity. The same
 * (desk, instrumentId, salt) always yields the same numbers.
 */
export function assignDeskEconomics(input: AssignEconomicsInput): DeskEconomics {
  const { desk, instrumentId } = input;
  const rng = mulberry32(hash32(`${desk}|${instrumentId}|${input.salt ?? "v1"}`));
  const base = input.now ? new Date(input.now.getTime()) : new Date();
  const bounds = ECONOMICS_BOUNDS;

  const currency = weightedCurrency(rng);

  const ticketUsdMinor = roundTo(logUniform(rng, bounds.ticketMinMinorUsd, bounds.ticketMinMaxMinorUsd), 100 * 100);
  const targetUsdMinor = roundTo(logUniform(rng, bounds.fundingTargetMinMinorUsd, bounds.fundingTargetMaxMinorUsd), 100 * 100);
  const ticketMinMinor = usdMinorToCurrency(ticketUsdMinor, currency);
  const fundingTargetMinor = Math.max(usdMinorToCurrency(targetUsdMinor, currency), ticketMinMinor);

  const profitSteps = Math.round((bounds.profitMaxBps - bounds.profitMinBps) / bounds.profitStepBps);
  const profitBps = bounds.profitMinBps + Math.round(rng() * profitSteps) * bounds.profitStepBps;

  const feeSteps = Math.round((bounds.platformFeeMaxBps - bounds.platformFeeMinBps) / bounds.platformFeeStepBps);
  const platformFeeBps = bounds.platformFeeMinBps + Math.round(rng() * feeSteps) * bounds.platformFeeStepBps;

  const termDays = TERM_DAY_CHOICES[Math.floor(rng() * TERM_DAY_CHOICES.length)] ?? bounds.termMinDays;
  const closeWindowDays = CLOSE_WINDOW_DAYS[Math.floor(rng() * CLOSE_WINDOW_DAYS.length)] ?? 7;

  const hasDelay = rng() * 10_000 < bounds.settlementDelayChanceBps;
  const settlementDelayDays = hasDelay
    ? bounds.settlementDelayMinDays + Math.floor(rng() * (bounds.settlementDelayMaxDays - bounds.settlementDelayMinDays + 1))
    : null;

  const close = addDays(base, closeWindowDays);
  const maturity = addDays(close, termDays);
  const assignedAt = base.toISOString();

  return {
    desk,
    instrumentId,
    currency: currency.code,
    currencyScale: currency.scale,
    currencySymbol: currency.symbol,
    ticketMinMinor,
    fundingTargetMinor,
    profitBps,
    termDays,
    closeWindowDays,
    closeDate: toIsoDate(close),
    maturityDate: toIsoDate(maturity),
    platformFeeBps,
    settlementDelayDays,
    source: "AUTO",
    assignedAt,
    updatedAt: assignedAt,
  };
}

export type EconomicsOverrideInput = Partial<
  Pick<
    DeskEconomics,
    | "currency"
    | "ticketMinMinor"
    | "fundingTargetMinor"
    | "profitBps"
    | "termDays"
    | "closeDate"
    | "maturityDate"
    | "platformFeeBps"
    | "settlementDelayDays"
  >
>;

/**
 * Validate and normalise an administrator override. Every field is optional (a
 * partial edit); supplied values must sit inside the published bounds. Returns
 * the cleaned patch, or throws with a human-readable reason.
 */
export function normalizeEconomicsOverride(input: EconomicsOverrideInput): EconomicsOverrideInput {
  const bounds = ECONOMICS_BOUNDS;
  const out: EconomicsOverrideInput = {};

  if (input.currency !== undefined) {
    const currency = currencyByCode(String(input.currency));
    if (!currency) throw new Error(`Unsupported presentation currency “${input.currency}”`);
    out.currency = currency.code;
  }

  const intInRange = (value: unknown, lo: number, hi: number, label: string): number => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < lo || number > hi) {
      throw new Error(`${label} must be a whole number between ${lo} and ${hi}`);
    }
    return number;
  };

  if (input.ticketMinMinor !== undefined) {
    out.ticketMinMinor = intInRange(input.ticketMinMinor, 1, bounds.fundingTargetMaxMinorUsd, "Minimum ticket (minor units)");
  }
  if (input.fundingTargetMinor !== undefined) {
    out.fundingTargetMinor = intInRange(input.fundingTargetMinor, 1, 1_000_000_000_000, "Funding target (minor units)");
  }
  if (input.profitBps !== undefined) {
    out.profitBps = intInRange(input.profitBps, bounds.profitMinBps, bounds.profitMaxBps, "Profit (basis points)");
  }
  if (input.termDays !== undefined) {
    out.termDays = intInRange(input.termDays, bounds.termMinDays, bounds.termMaxDays, "Term (days)");
  }
  if (input.platformFeeBps !== undefined) {
    out.platformFeeBps = intInRange(input.platformFeeBps, bounds.platformFeeMinBps, bounds.platformFeeMaxBps, "Platform fee (basis points)");
  }
  if (input.settlementDelayDays !== undefined && input.settlementDelayDays !== null) {
    out.settlementDelayDays = intInRange(input.settlementDelayDays, 0, 365, "Settlement delay (days)");
  } else if (input.settlementDelayDays === null) {
    out.settlementDelayDays = null;
  }
  const asDate = (value: unknown, label: string): string => {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) throw new Error(`${label} must be a YYYY-MM-DD date`);
    return text;
  };
  if (input.closeDate !== undefined) out.closeDate = asDate(input.closeDate, "Close date");
  if (input.maturityDate !== undefined) out.maturityDate = asDate(input.maturityDate, "Maturity date");

  return out;
}

/** Profit implied by an amount at the assigned profit rate (integer basis points). */
export function economicsProfitMinor(amountMinor: number, profitBps: number): number {
  return Math.round((Number(amountMinor || 0) * Number(profitBps || 0)) / 10_000);
}

/** Gross payout (principal + profit) implied by an amount at the assigned profit rate. */
export function economicsPayoutMinor(amountMinor: number, profitBps: number): number {
  return Number(amountMinor || 0) + economicsProfitMinor(amountMinor, profitBps);
}

/** Platform fee charged on the profit at the assigned fee rate (fee applies only to positive profit). */
export function economicsFeeMinor(amountMinor: number, profitBps: number, platformFeeBps: number): number {
  const profit = economicsProfitMinor(amountMinor, profitBps);
  if (profit <= 0) return 0;
  return Math.round((profit * Number(platformFeeBps || 0)) / 10_000);
}

/**
 * Whether an opportunity already publishes its own interest / coupon rate (so the
 * desk must not set a new one). A rate of zero or less means the source published
 * no rate, and the desk may assign a profit rate as usual.
 */
export function profitRateIsPublished(publishedRatePct: number | null | undefined): boolean {
  return Number(publishedRatePct || 0) > 0;
}

/**
 * The profit rate an opportunity actually offers. Some opportunities — most
 * visibly treasury and sovereign bonds, whose coupon rate comes straight from the
 * data source — already carry a published interest rate, so the desk must not set
 * a new one on them: the published rate stands and the auto-assigned profit is
 * suppressed (0 = none set). Every consumer reads the rate through this rule.
 */
export function effectiveProfitBps(
  economics: Pick<DeskEconomics, "profitBps">,
  publishedRatePct: number | null | undefined,
): number {
  return profitRateIsPublished(publishedRatePct) ? 0 : Number(economics.profitBps || 0);
}

/**
 * A deterministic per-opportunity multiplier in `[1 − span, 1 + span]`, used to
 * "scatter" a bulk edit so the selected offers end up varied rather than
 * identical. `variancePct` is the span as a percentage (0–50; values outside the
 * range are clamped). A zero span always returns exactly 1, so an opt-out never
 * perturbs a value. The result depends only on the desk, the opportunity id and
 * the caller's seed, so the same seed reproduces the same scatter while a fresh
 * seed (or none) yields new variety.
 */
export function economicsScatterFactor(desk: DeskKey, instrumentId: string, seed: string, variancePct: number): number {
  const span = Math.max(0, Math.min(50, Number(variancePct) || 0)) / 100;
  if (span <= 0) return 1;
  const rng = mulberry32(hash32(`${desk}|${instrumentId}|${seed}|scatter`));
  return 1 + (rng() * 2 - 1) * span;
}
