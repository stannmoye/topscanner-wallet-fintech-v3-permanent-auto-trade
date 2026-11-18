import { describe, expect, it } from "vitest";
import { invertDecimalRate } from "../shared/money";

describe("exact FX rate inversion (item 8)", () => {
  it("reciprocates rates with exact decimal math at a fixed 12 decimal places", () => {
    expect(invertDecimalRate("1")).toBe("1.000000000000");
    expect(invertDecimalRate("2")).toBe("0.500000000000");
    expect(invertDecimalRate("4")).toBe("0.250000000000");
    // Repeating decimals round half-up at the 12th decimal place.
    expect(invertDecimalRate("3")).toBe("0.333333333333");
    expect(invertDecimalRate("7")).toBe("0.142857142857");
    expect(invertDecimalRate("6")).toBe("0.166666666667");
  });

  it("never returns a binary float reciprocal", () => {
    // A stored float inversion of the EUR quote looked like 1.0998922105633648;
    // the exact result is a fixed-width 12-decimal string and never equals 1/x.
    const inverted = invertDecimalRate("0.9091");
    expect(inverted).toMatch(/^1\.0999[0-9]{8}$/);
    expect(inverted).not.toBe(String(1 / 0.9091));
    expect(inverted).toHaveLength("1.".length + 12);
    expect(invertDecimalRate("1.1")).toBe("0.909090909091");
  });

  it("rejects non-positive, non-finite and out-of-range inputs", () => {
    expect(() => invertDecimalRate("0")).toThrow("finite and positive");
    expect(() => invertDecimalRate("-2")).toThrow("finite and positive");
    expect(() => invertDecimalRate("Infinity")).toThrow("finite and positive");
    expect(() => invertDecimalRate("not-a-number")).toThrow();
    expect(() => invertDecimalRate("1", 31)).toThrow("Invalid decimal places");
    expect(() => invertDecimalRate("1", 1.5)).toThrow("Invalid decimal places");
  });
});
