import { describe, expect, it } from "vitest";
import {
  buildPrivacyRequestCsv,
  buildPrivacyRequestReceipt,
  privacyRequestCsvCell,
  privacyRequestCsvFilename,
  privacyRequestReceiptFilename,
} from "./privacy-requests";

describe("privacy request CSV export", () => {
  it("omits customer columns for a customer's own export", () => {
    const csv = buildPrivacyRequestCsv([
      {
        requestReference: "PRV-1",
        requestType: "Access my information",
        status: "In review",
        subject: "Access request",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        ageDays: 1,
      },
    ]);
    const [header] = csv.split("\r\n");
    expect(header).toBe("Reference,Category,Status,Subject,Submitted,Last updated,Days open");
    expect(csv).not.toContain("Customer name");
  });

  it("includes customer columns when admin queue rows carry customer identity", () => {
    const csv = buildPrivacyRequestCsv([
      {
        requestReference: "PRV-2",
        requestType: "Request deletion",
        status: "Submitted",
        subject: "Delete my records",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        ageDays: 0,
        customerName: "Ada Lovelace",
        customerEmail: "ada@example.test",
      },
    ]);
    const [header, firstRow] = csv.split("\r\n");
    expect(header).toBe("Customer name,Customer email,Reference,Category,Status,Subject,Submitted,Last updated,Days open");
    expect(firstRow).toBe("Ada Lovelace,ada@example.test,PRV-2,Request deletion,Submitted,Delete my records,2026-01-01,2026-01-01,0");
  });

  it("quotes commas, quotes and newlines, and neutralises formula prefixes", () => {
    expect(privacyRequestCsvCell('a,b')).toBe('"a,b"');
    expect(privacyRequestCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(privacyRequestCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(privacyRequestCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("uses a deterministic dated filename", () => {
    expect(privacyRequestCsvFilename(new Date("2026-11-26T08:00:00Z"))).toBe("privacy-requests-2026-11-26.csv");
  });
});

describe("privacy request receipt", () => {
  it("summarises the request and lists the visible status history", () => {
    const receipt = buildPrivacyRequestReceipt({
      requestReference: "PRV-3",
      requestType: "Correct my information",
      status: "In review",
      subject: "Fix my address",
      createdAt: "2026-02-01 10:00",
      updatedAt: "2026-02-03 09:00",
      details: "Street number is wrong.",
      events: [
        { createdAt: "2026-02-01 10:00", message: "Your privacy request has been received." },
        { createdAt: "2026-02-03 09:00", message: "Your request is being reviewed." },
      ],
    });
    expect(receipt).toContain("Reference: PRV-3");
    expect(receipt).toContain("Category: Correct my information");
    expect(receipt).toContain("Status history:");
    expect(receipt).toContain("Your request is being reviewed.");
    expect(receipt).toContain("It is not a decision on the request.");
  });

  it("produces a safe receipt filename from the reference", () => {
    expect(privacyRequestReceiptFilename("PRV-ABC/123")).toBe("privacy-request-PRV-ABC-123.txt");
    expect(privacyRequestReceiptFilename("")).toBe("privacy-request-acknowledgement.txt");
  });
});
