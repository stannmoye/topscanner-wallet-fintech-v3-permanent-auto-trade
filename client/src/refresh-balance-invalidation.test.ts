import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

// The single "Refresh balance" handler in the customer opportunities page.
const refreshHandlerLine =
  app.split("\n").find((line) => line.includes("const refreshBalance=")) ?? "";

describe("refresh balance re-fetches balances and FX (item 39)", () => {
  it("invalidates the balances summary, which is the query carrying the live FX conversion", () => {
    // The balance summary is the payload that carries the `conversions` (live FX)
    // evidence rendered by the dashboard, so invalidating balances re-quotes FX.
    expect(app).toContain("const conversions:any[]=Array.isArray((summary as any)?.conversions)");
    expect(refreshHandlerLine).toContain("utils.customer.balances.invalidate()");
  });

  it("still invalidates the opportunity feed so eligibility re-evaluates", () => {
    expect(refreshHandlerLine).toContain("utils.customer.opportunities.invalidate()");
  });

  it("no longer invalidates only the opportunity feed", () => {
    // Regression guard: the old handler refreshed opportunities alone and left the
    // stale "rate unavailable" balance/FX value on screen.
    expect(refreshHandlerLine).not.toContain("try{await utils.customer.opportunities.invalidate();}finally");
    expect(refreshHandlerLine).toContain("Promise.all");
  });

  it("awaits both invalidations before clearing the refreshing state", () => {
    const pass = refreshHandlerLine.indexOf("try{await Promise.all([");
    const balances = refreshHandlerLine.indexOf("utils.customer.balances.invalidate()");
    const opportunities = refreshHandlerLine.indexOf("utils.customer.opportunities.invalidate()");
    const clear = refreshHandlerLine.indexOf("setBalanceRefreshing(false)");
    expect(pass).toBeGreaterThanOrEqual(0);
    expect(balances).toBeGreaterThan(pass);
    expect(opportunities).toBeGreaterThan(pass);
    expect(clear).toBeGreaterThan(opportunities);
  });

  it("keeps the refresh control wired to the handler", () => {
    expect(app).toContain('onClick={()=>void refreshBalance()}');
  });
});
