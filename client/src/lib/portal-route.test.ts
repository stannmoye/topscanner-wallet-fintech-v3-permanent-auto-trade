import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPortalHref, parsePortalRoute, pushPortalRoute, writePortalRoute } from "./portal-route";

/** Stubs a minimal browser window/history so the URL effects can be asserted without a DOM. */
function stubBrowser(href: string) {
  const url = new URL(href);
  const replaceState = vi.fn();
  const pushState = vi.fn();
  vi.stubGlobal("window", {
    location: { href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { state: null, replaceState, pushState },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return { replaceState, pushState };
}

afterEach(() => vi.unstubAllGlobals());

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

  it("replaces the current entry when the persisted route must be normalised", () => {
    const { replaceState, pushState } = stubBrowser("https://host/customer?section=wallet");
    writePortalRoute("dashboard", null, "dashboard");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/customer");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("pushes a history entry for in-app navigation so Back/Forward works", () => {
    const { replaceState, pushState } = stubBrowser("https://host/customer");
    pushPortalRoute("wallet", null, "dashboard");
    expect(pushState).toHaveBeenCalledWith(null, "", "/customer?section=wallet");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("does not touch history when the URL already matches", () => {
    const { replaceState, pushState } = stubBrowser("https://host/customer?section=wallet");
    pushPortalRoute("wallet", null, "dashboard");
    replaceState.mockClear();
    pushPortalRoute("wallet", null, "dashboard");
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });
});
