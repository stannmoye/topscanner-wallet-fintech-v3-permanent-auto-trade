import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const moneySource = readFileSync(new URL("../shared/money.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

describe("currency conversion bounds and rate availability (item 55)", () => {
  it("never inflates a converted amount inside the low-level converter", () => {
    expect(moneySource).toContain("return Math.round((usdUnits / usdRate) * Math.pow(10, scale));");
    expect(moneySource).not.toContain("Math.max(1, Math.round((usdUnits / usdRate)");
  });

  it("applies the explicit one-unit floor only where a minimum is meant", () => {
    const start = databaseSource.indexOf("function packageUsdUnitsToNativeMinor(");
    const end = databaseSource.indexOf("\n", start);
    const helper = databaseSource.slice(start, end);
    expect(helper).toContain('bound:"minimum"|"maximum"');
    expect(helper).toContain('bound==="minimum"?Math.max(1,converted):converted');
    // Every package-bound call site names its role explicitly.
    expect(databaseSource).toContain('Number(packageCurrencyRate.rateUsdPerUnit),"minimum")');
    expect(databaseSource).toContain('Number(packageCurrencyRate.rateUsdPerUnit),"maximum")');
    expect(databaseSource).toContain('offerLiveRateUsd,"minimum")');
    expect(databaseSource).toContain('offerLiveRateUsd,"maximum")');
    expect(databaseSource).toContain('tradeCandidateRateUsd,"minimum")');
    expect(databaseSource).toContain('tradeCandidateRateUsd,"maximum")');
    expect(databaseSource).toContain('publicationRateUsd, "minimum")');
    expect(databaseSource).toContain('publicationRateUsd, "maximum")');
    // The createTrade preflight floors the minimum explicitly and leaves the maximum pure.
    expect(databaseSource).toContain("Math.max(1,usdUnitsToNativeMinor(Number(packagePolicy.minimumTradeUnits)");
    expect(databaseSource).toContain("Math.max(packageMinimumNative,usdUnitsToNativeMinor(Number(packagePolicy.maximumTradeUnits)");
  });

  it("returns an unavailable flag instead of a silent zero when a rate is missing or zero", () => {
    const start = databaseSource.indexOf("export async function getCustomerBalanceSummary(");
    const end = databaseSource.indexOf("\n", start);
    const summary = databaseSource.slice(start, end);
    expect(summary).toContain('if(!Number.isFinite(rate)||rate<=0){rate=0;if(code!=="USD"&&hasBalance)ratesUnavailable=true;}');
    expect(summary).toContain("conversions,ratesUnavailable}};");
  });
});
