import type { TenderStatus } from "./provider";

/**
 * Tender Bid — shared normalisation used by every source adapter.
 *
 * Sources disagree on almost everything: date formats, whether an amount is a
 * string with thousand separators, whether a title is a plain string or a
 * multilingual object, and how a category is encoded (CPV, NAICS, a portal code).
 * These helpers collapse those differences without inventing values — anything
 * that cannot be read is returned as `null`, never guessed, so a tender with an
 * unreadable amount simply has no USD value rather than a fabricated one.
 */

/** Database column lengths; normalised values are truncated to fit. */
export const TENDER_COLUMN_LIMITS = {
  externalId: 191,
  dedupeGroup: 64,
  countryCode: 8,
  title: 500,
  buyer: 300,
  buyerType: 80,
  industry: 120,
  tenderType: 80,
  procedure: 120,
  contractCurrency: 12,
  summary: 1000,
  sourceUrl: 768,
} as const;

/** A tender is "closing soon" when its bidding window ends within this horizon. */
export const TENDER_CLOSING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/** The first non-empty, trimmed string among the candidates, or null. */
export function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/** Collapse runs of whitespace and control characters into single spaces. */
export function normaliseWhitespace(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return collapsed || null;
}

/** Truncate a value to a database column limit without throwing. */
export function truncate(value: string | null, max: number): string | null {
  if (value == null) return null;
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Parse a source date into an ISO-8601 string, or null when it is absent or
 * unreadable. Accepts ISO strings, `YYYY-MM-DD`, `MM/DD/YYYY`, and epoch
 * seconds or milliseconds.
 */
export function toIsoString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristically treat small numbers as epoch seconds and larger ones as milliseconds.
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const usStyle = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usStyle) {
    const date = new Date(Date.UTC(Number(usStyle[3]), Number(usStyle[1]) - 1, Number(usStyle[2])));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : raw.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Read a numeric value from a number, a numeric string, or a multilingual object of either. */
export function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,\s]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // BBC/Nordic-style multilingual objects: prefer the plain value, then English.
    const record = value as Record<string, unknown>;
    for (const key of ["value", "amount", "eng", "en", "total"]) {
      const nested = firstNumber(record[key]);
      if (nested != null) return nested;
    }
    for (const nested of Object.values(record)) {
      const result = firstNumber(nested);
      if (result != null) return result;
    }
  }
  return null;
}

/** Read a human string from a string, a list of strings, or a multilingual object. */
export function firstLocalisedString(value: unknown): string | null {
  const direct = pickString(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstLocalisedString(item);
      if (result) return result;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["eng", "en", "value", "text", "title", "name"]) {
      const result = firstLocalisedString(record[key]);
      if (result) return result;
    }
    for (const nested of Object.values(record)) {
      const result = firstLocalisedString(nested);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Convert a whole-currency-unit amount into integer minor units, or null when the
 * amount cannot be read or is negative. The result is quantised once, half-up.
 */
export function toMinorUnits(amount: unknown, scale = 2): number | null {
  const value = firstNumber(amount);
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const minor = Math.round(value * Math.pow(10, scale));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Normalise a currency code to an upper-case ISO-4217-style token, or null. */
export function normaliseCurrencyCode(value: unknown): string | null {
  const code = pickString(value);
  if (!code) return null;
  const upper = code.toUpperCase();
  return /^[A-Z]{2,10}$/.test(upper) ? upper : null;
}

/**
 * Derive the customer-visible status from the bidding window. An awarded tender
 * is always `awarded`; otherwise the clock decides between `upcoming`, `open`,
 * `closing`, and `closed`. A tender with no readable window is treated as `open`
 * (published and not known to be closed) rather than being hidden.
 */
export function deriveTenderStatus(
  input: { bidOpenAt?: string | null; bidCloseAt?: string | null; awardedAt?: string | null },
  now: Date = new Date(),
): TenderStatus {
  if (input.awardedAt) return "awarded";
  const nowMs = now.getTime();
  const openMs = input.bidOpenAt ? Date.parse(input.bidOpenAt) : Number.NaN;
  const closeMs = input.bidCloseAt ? Date.parse(input.bidCloseAt) : Number.NaN;
  if (Number.isFinite(closeMs) && nowMs > closeMs) return "closed";
  if (Number.isFinite(openMs) && nowMs < openMs) return "upcoming";
  if (Number.isFinite(closeMs) && closeMs - nowMs <= TENDER_CLOSING_SOON_MS) return "closing";
  return "open";
}

/** CPV division (first two digits) to a canonical industry label. */
const CPV_DIVISIONS: Record<string, string> = {
  "03": "Agriculture, farming, fishing and forestry",
  "09": "Petroleum products, fuel and energy",
  "14": "Mining and basic metals",
  "15": "Food, beverages and tobacco",
  "18": "Clothing, footwear and accessories",
  "19": "Leather and textile fabrics",
  "22": "Printed matter and related products",
  "24": "Chemical products",
  "30": "Office and computing machinery",
  "31": "Electrical machinery and equipment",
  "32": "Radio, television and communication equipment",
  "33": "Medical equipment and pharmaceuticals",
  "34": "Transport equipment",
  "35": "Security, fire-fighting and defence equipment",
  "37": "Musical instruments and sports goods",
  "38": "Laboratory, optical and precision equipment",
  "39": "Furniture and furnishings",
  "41": "Collected and purified water",
  "42": "Industrial machinery",
  "43": "Machinery for mining and construction",
  "44": "Construction structures and materials",
  "45": "Construction work",
  "48": "Software packages and information systems",
  "50": "Repair and maintenance services",
  "51": "Installation services",
  "55": "Hotel, restaurant and retail services",
  "60": "Transport services",
  "63": "Supporting transport and travel services",
  "64": "Telecommunications services",
  "65": "Public utilities",
  "66": "Financial and insurance services",
  "70": "Real estate services",
  "71": "Architectural, engineering and inspection services",
  "72": "IT services and software development",
  "73": "Research and development services",
  "75": "Administration, defence and social security",
  "76": "Services related to oil and gas",
  "79": "Business, legal, marketing and security services",
  "80": "Education and training services",
  "85": "Health and social work services",
  "90": "Sewage, refuse and environmental services",
  "92": "Recreational, cultural and sporting services",
  "98": "Other community, social and personal services",
};

/** NAICS sector (first two digits) to a canonical industry label. */
const NAICS_SECTORS: Record<string, string> = {
  "11": "Agriculture, forestry, fishing and hunting",
  "21": "Mining, quarrying and oil and gas extraction",
  "22": "Utilities",
  "23": "Construction",
  "31": "Manufacturing",
  "32": "Manufacturing",
  "33": "Manufacturing",
  "42": "Wholesale trade",
  "44": "Retail trade",
  "45": "Retail trade",
  "48": "Transportation and warehousing",
  "49": "Transportation and warehousing",
  "51": "Information",
  "52": "Finance and insurance",
  "53": "Real estate and rental and leasing",
  "54": "Professional, scientific and technical services",
  "55": "Management of companies and enterprises",
  "56": "Administrative and support services",
  "61": "Educational services",
  "62": "Health care and social assistance",
  "71": "Arts, entertainment and recreation",
  "72": "Accommodation and food services",
  "81": "Other services",
  "92": "Public administration",
};

/** Map a CPV code (8 digits, optional check digit) to a canonical industry label. */
export function cpvToIndustry(code: unknown): string | null {
  const cleaned = pickString(code)?.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const padded = cleaned.padStart(2, "0");
  return CPV_DIVISIONS[padded.slice(0, 2)] ?? null;
}

/** Map a NAICS code to a canonical industry label. */
export function naicsToIndustry(code: unknown): string | null {
  const cleaned = pickString(code)?.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  return NAICS_SECTORS[cleaned.padStart(2, "0").slice(0, 2)] ?? null;
}

/**
 * Resolve a canonical industry from whatever the source provides, in priority
 * order. Falls back to a trimmed free-text hint (a portal's own category name)
 * and finally null, so the field is never empty-but-fake.
 */
export function canonicalIndustry(input: {
  cpv?: unknown;
  naics?: unknown;
  categoryName?: unknown;
}): string | null {
  const fromCpv = cpvToIndustry(input.cpv);
  if (fromCpv) return truncate(fromCpv, TENDER_COLUMN_LIMITS.industry);
  const fromNaics = naicsToIndustry(input.naics);
  if (fromNaics) return truncate(fromNaics, TENDER_COLUMN_LIMITS.industry);
  const hint = normaliseWhitespace(input.categoryName);
  return hint ? truncate(hint, TENDER_COLUMN_LIMITS.industry) : null;
}
