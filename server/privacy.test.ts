import { describe, expect, it } from "vitest";
import {
  PRIVACY_REQUEST_REVIEW_TARGET_DAYS,
  canTransitionPrivacyRequest,
  countPrivacyRequestsByStatus,
  nextPrivacyVersion,
  privacyRequestAgeDays,
  privacyRequestAgingBand,
  privacyRequestAgingLabel,
  privacyRequestGroupCounts,
  privacyRequestIsOpen,
  privacyRequestStatusGroup,
  privacyRequestStatusMessage,
  type PrivacyRequestStatus,
} from "../shared/privacy";

describe("privacy policy versioning", () => {
  it("increments minor versions without overwriting a prior published version", () => {
    expect(nextPrivacyVersion("1.0")).toBe("1.1");
    expect(nextPrivacyVersion("1.9")).toBe("1.10");
    expect(nextPrivacyVersion("2.4")).toBe("2.5");
  });

  it("starts a clean version sequence when no valid published version exists", () => {
    expect(nextPrivacyVersion(null)).toBe("1.0");
    expect(nextPrivacyVersion("draft-0001")).toBe("1.0");
  });
});

describe("privacy request workflow", () => {
  it("allows a submitted request to enter review or be cancelled, but not skip to completion", () => {
    expect(canTransitionPrivacyRequest("submitted", "in_review")).toBe(true);
    expect(canTransitionPrivacyRequest("submitted", "cancelled")).toBe(true);
    expect(canTransitionPrivacyRequest("submitted", "completed")).toBe(false);
  });

  it("requires a supported transition out of identity check", () => {
    expect(canTransitionPrivacyRequest("identity_check", "awaiting_customer")).toBe(true);
    expect(canTransitionPrivacyRequest("identity_check", "completed")).toBe(false);
  });

  it("keeps terminal privacy-request states terminal", () => {
    expect(canTransitionPrivacyRequest("completed", "in_review")).toBe(false);
    expect(canTransitionPrivacyRequest("declined", "in_review")).toBe(false);
    expect(canTransitionPrivacyRequest("cancelled", "in_review")).toBe(false);
    expect(canTransitionPrivacyRequest("completed", "completed")).toBe(true);
  });

  it("provides a customer-safe message for every workflow status", () => {
    for (const status of ["submitted", "identity_check", "in_review", "awaiting_customer", "completed", "declined", "cancelled"] as const) {
      expect(privacyRequestStatusMessage(status).length).toBeGreaterThan(15);
    }
  });
});

describe("privacy request reporting helpers", () => {
  it("classifies terminal statuses as closed and every other status as open", () => {
    for (const status of ["completed", "declined", "cancelled"] as PrivacyRequestStatus[]) {
      expect(privacyRequestStatusGroup(status)).toBe("closed");
      expect(privacyRequestIsOpen(status)).toBe(false);
    }
    for (const status of ["submitted", "identity_check", "in_review", "awaiting_customer"] as PrivacyRequestStatus[]) {
      expect(privacyRequestStatusGroup(status)).toBe("open");
      expect(privacyRequestIsOpen(status)).toBe(true);
    }
  });

  it("counts open and closed requests and every status bucket", () => {
    const rows = [
      { status: "submitted" as PrivacyRequestStatus },
      { status: "in_review" as PrivacyRequestStatus },
      { status: "completed" as PrivacyRequestStatus },
      { status: "cancelled" as PrivacyRequestStatus },
    ];
    expect(privacyRequestGroupCounts(rows)).toEqual({ total: 4, open: 2, closed: 2 });
    const byStatus = countPrivacyRequestsByStatus(rows);
    expect(byStatus.submitted).toBe(1);
    expect(byStatus.in_review).toBe(1);
    expect(byStatus.completed).toBe(1);
    expect(byStatus.cancelled).toBe(1);
    expect(byStatus.awaiting_customer).toBe(0);
  });

  it("computes whole-day age without producing negative or NaN values", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    expect(privacyRequestAgeDays("2026-03-10T08:00:00Z", now)).toBe(0);
    expect(privacyRequestAgeDays("2026-03-01T08:00:00Z", now)).toBe(9);
    expect(privacyRequestAgeDays("2026-04-01T08:00:00Z", now)).toBe(0);
    expect(privacyRequestAgeDays(null, now)).toBe(0);
    expect(privacyRequestAgeDays("not-a-date", now)).toBe(0);
  });

  it("bands request ageing against the accountable review target", () => {
    expect(privacyRequestAgingBand(0)).toBe("on_track");
    expect(privacyRequestAgingBand(14)).toBe("on_track");
    expect(privacyRequestAgingBand(Math.floor(PRIVACY_REQUEST_REVIEW_TARGET_DAYS / 2))).toBe("due_soon");
    expect(privacyRequestAgingBand(PRIVACY_REQUEST_REVIEW_TARGET_DAYS)).toBe("overdue");
    expect(privacyRequestAgingBand(-4)).toBe("on_track");
    expect(privacyRequestAgingLabel(0)).toBe("Received today");
    expect(privacyRequestAgingLabel(1)).toBe("1 day since submission");
    expect(privacyRequestAgingLabel(5)).toBe("5 days since submission");
  });
});
