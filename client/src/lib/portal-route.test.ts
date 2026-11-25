import { describe, expect, it } from "vitest";
import { buildPortalHref, parsePortalRoute } from "./portal-route";

describe("portal route URL persistence", () => {
  it("parses the persisted section and focus", () => {
    expect(parsePortalRoute("?section=wallet&focus=ledger")).toEqual({ section: "wallet", focus: "ledger" });
  });

  it("returns nulls when no section or focus is present", () => {
    expect(parsePortalRoute("")).toEqual({ section: null, focus: null });
    expect(parsePortalRoute("?kyc_token=abc")).toEqual({ section: null, focus: null });
  });

  it("mirrors the active section into the URL and preserves unrelated parameters", () => {
    const href = buildPortalHref("https://host/customer?kyc_token=abc#frag", "wallet", null, "dashboard");
    expect(href).toBe("/customer?kyc_token=abc&section=wallet#frag");
  });

  it("omits the section parameter when it matches the portal default", () => {
    const href = buildPortalHref("https://host/customer?section=wallet", "dashboard", null, "dashboard");
    expect(href).toBe("/customer");
  });

  it("persists and clears the administrator focus alongside the section", () => {
    const withFocus = buildPortalHref("https://host/ops-console-7f3a", "transactionReview", "ledger", "overview");
    expect(withFocus).toBe("/ops-console-7f3a?section=transactionReview&focus=ledger");
    const withoutFocus = buildPortalHref(`https://host${withFocus}`, "customers", null, "overview");
    expect(withoutFocus).toBe("/ops-console-7f3a?section=customers");
  });

  it("round-trips the section it writes", () => {
    const href = buildPortalHref("https://host/customer", "lending", null, "dashboard");
    expect(parsePortalRoute(href.split("?")[1] ?? "")).toEqual({ section: "lending", focus: null });
  });
});
