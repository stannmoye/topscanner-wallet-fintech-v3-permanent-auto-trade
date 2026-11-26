import { TENDER_STATUSES } from "./provider";

/**
 * Tender Bid — administrator corrections (Stage 5).
 *
 * A single, explicit catalogue of the tender fields an administrator may edit
 * through the Tender corrections menu. It is shared by three callers so they can
 * never disagree:
 *
 * - the corrections service, which validates a submitted value against the field
 *   kind and the column budget;
 * - the ingestion worker, which reads the stored override keys and must leave
 *   exactly those fields untouched so a correction survives re-ingestion;
 * - the customer read seam, which treats an administrator-pinned `status` as
 *   authoritative instead of deriving it from the clock.
 *
 * The stored override map (`tenders.overridesJson`) is `{ field: sourceValue }`,
 * where `sourceValue` is the value the field held when it was first overridden —
 * i.e. the last value ingestion produced (or `null` when the source never set the
 * field). Keeping the captured value means an administrator can revert any
 * source-derived field to the source value without re-fetching the provider.
 */

/** How a field's value is edited and validated. */
export type TenderCorrectionKind = "text" | "textarea" | "url" | "integer" | "datetime" | "enum";

export type TenderCorrectionField = {
  /** Drizzle column property name on `tenders`. */
  field: string;
  label: string;
  kind: TenderCorrectionKind;
  /** A required field cannot be cleared. */
  required: boolean;
  /**
   * True when ingestion writes the field each cycle, so an override must be
   * preserved and can be reverted to the captured source value. The
   * administrator-owned qualification fields are false: ingestion never touches
   * them, so there is no source value to revert to.
   */
  sourceDerived: boolean;
  /** Maximum character length, matching the database column budget. */
  maxLength?: number;
  options?: readonly string[];
  hint: string;
};

export const TENDER_CORRECTION_FIELDS: readonly TenderCorrectionField[] = [
  { field: "title", label: "Title", kind: "text", required: true, sourceDerived: true, maxLength: 500, hint: "The tender headline. Required." },
  { field: "buyer", label: "Buyer / authority", kind: "text", required: false, sourceDerived: true, maxLength: 300, hint: "Issuing authority. Blank clears it." },
  { field: "buyerType", label: "Buyer type", kind: "text", required: false, sourceDerived: true, maxLength: 80, hint: "e.g. ministry, agency, private." },
  { field: "industry", label: "Industry", kind: "text", required: false, sourceDerived: true, maxLength: 120, hint: "Canonical industry." },
  { field: "tenderType", label: "Tender type", kind: "text", required: false, sourceDerived: true, maxLength: 80, hint: "e.g. goods, works, services." },
  { field: "procedure", label: "Procedure", kind: "text", required: false, sourceDerived: true, maxLength: 120, hint: "Procurement procedure." },
  { field: "countryCode", label: "Country code", kind: "text", required: true, sourceDerived: true, maxLength: 8, hint: "ISO 3166-1 alpha-2, e.g. GB." },
  { field: "summary", label: "Summary", kind: "text", required: false, sourceDerived: true, maxLength: 1000, hint: "Short summary shown on the card." },
  { field: "descriptionText", label: "Description", kind: "textarea", required: false, sourceDerived: true, maxLength: 60_000, hint: "Long-form description shown in the customer pop-up." },
  { field: "sourceUrl", label: "Source link", kind: "url", required: true, sourceDerived: true, maxLength: 768, hint: "https:// link to the notice." },
  { field: "status", label: "Status", kind: "enum", required: true, sourceDerived: true, options: TENDER_STATUSES, hint: "An administrator-set status is shown to customers as-is." },
  { field: "bidOpenAt", label: "Bidding opens", kind: "datetime", required: false, sourceDerived: true, hint: "Blank clears it; the customer status then derives from the window." },
  { field: "bidCloseAt", label: "Bidding closes", kind: "datetime", required: false, sourceDerived: true, hint: "Bidding expires." },
  { field: "payoutAt", label: "Expected payout", kind: "datetime", required: false, sourceDerived: true, hint: "Expected payment date." },
  { field: "publishedAt", label: "Published", kind: "datetime", required: false, sourceDerived: true, hint: "Publication date." },
  { field: "contractAmountMinor", label: "Contract amount (native minor units)", kind: "integer", required: false, sourceDerived: true, hint: "Native amount in minor units (e.g. cents). Blank clears it." },
  { field: "contractCurrency", label: "Contract currency", kind: "text", required: false, sourceDerived: true, maxLength: 12, hint: "ISO 4217 code, e.g. GBP." },
  { field: "contractAmountUsdMinor", label: "Contract amount (USD minor units)", kind: "integer", required: false, sourceDerived: true, hint: "USD value in minor units, or blank when it could not be valued." },
  { field: "qualificationPctBps", label: "Qualification percentage (basis points)", kind: "integer", required: false, sourceDerived: false, hint: "Administrator-configured basis points applied to the USD contract value." },
  { field: "qualificationAmountUsdMinor", label: "Qualification amount (USD minor units)", kind: "integer", required: false, sourceDerived: false, hint: "Administrator-configured charge. Blank disables bidding (fail closed)." },
];

export const TENDER_CORRECTION_FIELD_MAP: ReadonlyMap<string, TenderCorrectionField> = new Map(
  TENDER_CORRECTION_FIELDS.map((entry) => [entry.field, entry] as const),
);

/**
 * Column property names ingestion writes. An administrator override on any of
 * these must be omitted from the ingestion update set so it survives re-ingestion.
 */
export const TENDER_SOURCE_DERIVED_FIELDS: ReadonlySet<string> = new Set(
  TENDER_CORRECTION_FIELDS.filter((entry) => entry.sourceDerived).map((entry) => entry.field),
);

export type TenderOverrides = Record<string, unknown>;

/** Read the stored override map, keeping only known fields. Tolerates null/legacy values. */
export function readTenderOverrides(value: unknown): TenderOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const overrides: TenderOverrides = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (TENDER_CORRECTION_FIELD_MAP.has(key) && entry !== undefined) overrides[key] = entry;
  }
  return overrides;
}

/** True when `field` is a known field and the row carries an override for it. */
export function hasTenderFieldOverride(value: unknown, field: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!TENDER_CORRECTION_FIELD_MAP.has(field)) return false;
  return Object.prototype.hasOwnProperty.call(value as Record<string, unknown>, field);
}

export type TenderCorrectionParse =
  | { ok: true; columnValue: unknown; jsonValue: unknown }
  | { ok: false; error: string };

/**
 * Validate a submitted field value and return both the value to write to the
 * column and its JSON-friendly form to store in the override map / history.
 * Fails closed: an unknown field, a malformed number or date, an out-of-range
 * enum, an over-long string, a non-http(s) link and a cleared required field are
 * all rejected rather than coerced.
 */
export function parseTenderCorrection(field: string, raw: unknown): TenderCorrectionParse {
  const spec = TENDER_CORRECTION_FIELD_MAP.get(field);
  if (!spec) return { ok: false, error: "This field cannot be corrected." };
  const value = raw === null || raw === undefined ? "" : String(raw).trim();

  if (!value) {
    if (spec.required) return { ok: false, error: `${spec.label} is required and cannot be cleared.` };
    return { ok: true, columnValue: null, jsonValue: null };
  }

  if (spec.kind === "datetime") {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return { ok: false, error: `${spec.label} must be a valid date and time.` };
    const date = new Date(ms);
    return { ok: true, columnValue: date, jsonValue: date.toISOString() };
  }

  if (spec.kind === "integer") {
    if (!/^-?\d+$/.test(value)) return { ok: false, error: `${spec.label} must be a whole number.` };
    const num = Number(value);
    if (!Number.isSafeInteger(num)) return { ok: false, error: `${spec.label} is out of range.` };
    return { ok: true, columnValue: num, jsonValue: num };
  }

  if (spec.kind === "enum") {
    if (!spec.options || !spec.options.includes(value)) {
      return { ok: false, error: `${spec.label} must be one of: ${(spec.options ?? []).join(", ")}.` };
    }
    return { ok: true, columnValue: value, jsonValue: value };
  }

  // text / textarea / url
  if (spec.maxLength && value.length > spec.maxLength) {
    return { ok: false, error: `${spec.label} is limited to ${spec.maxLength} characters.` };
  }
  if (spec.kind === "url" && !/^https?:\/\//i.test(value)) {
    return { ok: false, error: `${spec.label} must be an http(s) link.` };
  }
  return { ok: true, columnValue: value, jsonValue: value };
}

/** The JSON-friendly form of a stored column value: ISO string for dates, number for integers, string otherwise. */
export function tenderFieldToJson(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const spec = TENDER_CORRECTION_FIELD_MAP.get(field);
  if (!spec) return null;
  if (spec.kind === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (spec.kind === "integer") {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : null;
  }
  return String(value);
}

/** The column value to write for a JSON-friendly override value (dates become Date, integers numbers). */
export function tenderFieldFromJson(field: string, value: unknown): unknown {
  const spec = TENDER_CORRECTION_FIELD_MAP.get(field);
  if (!spec) return null;
  if (value === null || value === undefined) return null;
  if (spec.kind === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (spec.kind === "integer") {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : null;
  }
  return String(value);
}

/** A display string for the audit history: ISO for dates, plain text otherwise. */
export function tenderFieldDisplay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}
