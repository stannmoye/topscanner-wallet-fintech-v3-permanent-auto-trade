/**
 * Pure helpers for exporting privacy-request records and producing a
 * customer-readable acknowledgement receipt. Keeping these free of DOM access
 * makes them independently testable and reusable in both portals.
 */

export type PrivacyRequestCsvRow = {
  requestReference: string;
  requestType: string;
  status: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  customerName?: string;
  customerEmail?: string;
};

export type PrivacyRequestReceiptEvent = {
  createdAt: string;
  message?: string | null;
};

export type PrivacyRequestReceipt = {
  requestReference: string;
  requestType: string;
  status: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
  details?: string | null;
  events?: PrivacyRequestReceiptEvent[];
};

const CUSTOMER_COLUMNS = ["Customer name", "Customer email"] as const;
const BASE_COLUMNS = ["Reference", "Category", "Status", "Subject", "Submitted", "Last updated", "Days open"] as const;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Guard against spreadsheet formula injection for values that begin with a
  // trigger character, then apply RFC 4180 quoting.
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function privacyRequestCsvCell(value: unknown): string {
  return csvCell(value);
}

export function buildPrivacyRequestCsv(
  rows: ReadonlyArray<PrivacyRequestCsvRow>,
): string {
  const includeCustomer = rows.some((row) => row.customerName !== undefined || row.customerEmail !== undefined);
  const header = [...(includeCustomer ? CUSTOMER_COLUMNS : []), ...BASE_COLUMNS];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const cells: unknown[] = [
      ...(includeCustomer ? [row.customerName ?? "", row.customerEmail ?? ""] : []),
      row.requestReference,
      row.requestType,
      row.status,
      row.subject,
      row.createdAt,
      row.updatedAt,
      row.ageDays,
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

export function buildPrivacyRequestReceipt(request: PrivacyRequestReceipt): string {
  const lines: string[] = [
    "PRIVACY REQUEST ACKNOWLEDGEMENT",
    "================================",
    "",
    "Reference: " + request.requestReference,
    "Category: " + request.requestType,
    "Status: " + request.status,
    "Subject: " + request.subject,
    "Submitted: " + request.createdAt,
    "Last updated: " + request.updatedAt,
  ];
  if (request.details && request.details.trim()) {
    lines.push("", "Additional context provided:", request.details.trim());
  }
  const events = (request.events || []).filter((event) => (event.message || "").trim());
  if (events.length) {
    lines.push("", "Status history:");
    for (const event of events) lines.push("- " + event.createdAt + ": " + (event.message || "").trim());
  }
  lines.push(
    "",
    "This acknowledgement is a record of the request you submitted. It is not a decision on the request.",
    "Keep the reference above for any follow-up through the authenticated Support Centre.",
  );
  return lines.join("\n");
}

export function privacyRequestCsvFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return "privacy-requests-" + stamp + ".csv";
}

export function privacyRequestReceiptFilename(reference: string): string {
  const safe = reference.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return "privacy-request-" + (safe || "acknowledgement") + ".txt";
}
