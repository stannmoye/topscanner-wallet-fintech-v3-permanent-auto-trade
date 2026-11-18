import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCurrencyUsdRate } = vi.hoisted(() => ({ fetchCurrencyUsdRate: vi.fn() }));
vi.mock("./marketProviders", () => ({
  fetchCurrencyUsdRate,
  fetchFiatRates: vi.fn(),
  fetchCryptoRates: vi.fn(),
  fetchMostActiveStocks: vi.fn(),
}));

import { getFreshTradingFxRate } from "./db";

let seq = 0;
function uniqueConfig() {
  seq += 1;
  return { code: `TST${seq}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(), scale: 2, assetType: "fiat" as const, externalCode: null };
}
const fetchResult = (rate: string) => ({ rate, provider: "test-api", sourceDate: new Date().toISOString(), fetchedAt: new Date() });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("live FX rate cache is single-flight (item 54)", () => {
  beforeEach(() => { fetchCurrencyUsdRate.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shares one in-flight fetch across concurrent callers", async () => {
    const config = uniqueConfig();
    const d = deferred<ReturnType<typeof fetchResult>>();
    fetchCurrencyUsdRate.mockReturnValueOnce(d.promise);

    const calls = [getFreshTradingFxRate(config), getFreshTradingFxRate(config), getFreshTradingFxRate(config)];
    // The pending promise is stored before the first await, so all three share one fetch.
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(1);

    d.resolve(fetchResult("0.9091"));
    const results = await Promise.all(calls);
    expect(results.map(r => r.rateUsdPerUnit)).toEqual(["0.9091", "0.9091", "0.9091"]);
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(1);
  });

  it("reuses a resolved live rate for at most the 5 second window, then refetches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const config = uniqueConfig();
    fetchCurrencyUsdRate.mockResolvedValue(fetchResult("1.25"));

    await expect(getFreshTradingFxRate(config)).resolves.toMatchObject({ rateUsdPerUnit: "1.25" });
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(1);

    // Inside the reuse window: no new fetch.
    vi.setSystemTime(1_000_000 + 4_999);
    await expect(getFreshTradingFxRate(config)).resolves.toMatchObject({ rateUsdPerUnit: "1.25" });
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(1);

    // After the window: a live rate must be fetched again (never a stored/expired value).
    vi.setSystemTime(1_000_000 + 5_001);
    fetchCurrencyUsdRate.mockResolvedValue(fetchResult("1.30"));
    await expect(getFreshTradingFxRate(config)).resolves.toMatchObject({ rateUsdPerUnit: "1.30" });
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(2);
  });

  it("never serves a stale value: an expired entry always triggers a fresh fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const config = uniqueConfig();
    fetchCurrencyUsdRate.mockResolvedValueOnce(fetchResult("1.10"));
    await getFreshTradingFxRate(config);

    vi.setSystemTime(2_000_000 + 5_000);
    fetchCurrencyUsdRate.mockResolvedValueOnce(fetchResult("1.12"));
    await expect(getFreshTradingFxRate(config)).resolves.toMatchObject({ rateUsdPerUnit: "1.12" });
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed fetch, so the next caller retries the live API", async () => {
    const config = uniqueConfig();
    fetchCurrencyUsdRate.mockRejectedValueOnce(new Error("No fresh supported fiat-to-USD API rate is available."));
    await expect(getFreshTradingFxRate(config)).rejects.toThrow(/fresh supported fiat/);

    fetchCurrencyUsdRate.mockResolvedValueOnce(fetchResult("0.8"));
    await expect(getFreshTradingFxRate(config)).resolves.toMatchObject({ rateUsdPerUnit: "0.8" });
    expect(fetchCurrencyUsdRate).toHaveBeenCalledTimes(2);
  });
});
