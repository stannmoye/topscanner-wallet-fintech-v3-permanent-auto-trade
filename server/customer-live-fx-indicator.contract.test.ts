import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const marketProvidersSource = readFileSync(new URL("./marketProviders.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const customerAppSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const customerReferenceCss = readFileSync(new URL("../client/src/customer-reference.css", import.meta.url), "utf8");

const balanceSummaryStart = databaseSource.indexOf("export async function getCustomerBalanceSummary(");
const balanceSummaryEnd = databaseSource.indexOf("\n", balanceSummaryStart);
const balanceSummarySource = databaseSource.slice(balanceSummaryStart, balanceSummaryEnd);

describe("live FX conversion indicator (item 18)", () => {
  it("names the fiat and crypto freshness windows and checks them against the provider timestamp", () => {
    // Fiat primary feed is the ECB via Frankfurter; the acceptance window must cover
    // the TARGET weekend/holiday gap. The daily fallback is held to 24 hours and
    // crypto stays strict to the minute.
    expect(marketProvidersSource).toContain("const FIAT_ECB_RATE_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;");
    expect(marketProvidersSource).toContain("const FIAT_FALLBACK_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;");
    expect(marketProvidersSource).toContain("const CRYPTO_RATE_MAX_AGE_MS = 5 * 60 * 1000;");
    expect(marketProvidersSource).toContain("const RATE_FUTURE_TOLERANCE_MS = 60_000;");
    // Every branch compares the provider's own timestamp against the named window.
    expect(marketProvidersSource).toContain("Date.now() - sourceMs <= FIAT_ECB_RATE_MAX_AGE_MS");
    expect(marketProvidersSource).toContain("Date.now() - sourceMs > FIAT_FALLBACK_RATE_MAX_AGE_MS");
    expect(marketProvidersSource).toContain("Date.now() - sourceMs > CRYPTO_RATE_MAX_AGE_MS");
    expect(marketProvidersSource).toContain("sourceMs > Date.now() + RATE_FUTURE_TOLERANCE_MS");
    // No inline magic numbers remain in the freshness conditions.
    expect(marketProvidersSource).not.toContain("Date.now() - sourceMs <= 4 * 24 * 60 * 60 * 1000");
    expect(marketProvidersSource).not.toContain("Date.now() - sourceMs > 5 * 60 * 1000");
  });

  it("surfaces a minimal per-wallet conversion descriptor only when a real live rate is used", () => {
    expect(balanceSummaryStart).toBeGreaterThan(-1);
    // Minimal customer-facing fields only.
    expect(balanceSummarySource).toContain("const conversions:Array<{from:string;to:string;rate:string;provider:string;updatedAt:string|null}>");
    expect(balanceSummarySource).toContain("conversions.push({from:code,to:\"USD\",rate:String(snapshot.rateUsdPerUnit),provider:String(snapshot.provider||\"\")");
    // Only non-USD wallets that actually hold a balance and have a live rate.
    expect(balanceSummarySource).toContain("if(code!==\"USD\"&&hasBalance&&snapshot&&rate>0)");
    // The summary returns the descriptor list alongside the existing USD totals.
    expect(balanceSummarySource).toContain("totalUsd:availableUsd+lockedUsd,conversions}};");
    // The rate is fed by the live resolver, never the stored registry value.
    expect(balanceSummarySource).toContain("snapshot=await resolveLiveCurrencyUsdRate(c)");
  });

  it("renders the customer indicator as a live region carrying only formatted values", () => {
    expect(customerAppSource).toContain("className=\"customer-fx-indicator\"");
    expect(customerAppSource).toContain("role=\"status\" aria-live=\"polite\"");
    expect(customerAppSource).toContain("Converting ${c.from} to ${c.to} at live rate");
    // No raw policy or internal objects reach the indicator.
    expect(customerAppSource).not.toContain("customer-fx-indicator\".concat(JSON.stringify");
  });

  it("ships styling for the indicator in the customer stylesheet", () => {
    expect(customerReferenceCss).toContain(".customer-ledger-panel .customer-fx-indicator{");
  });
});
