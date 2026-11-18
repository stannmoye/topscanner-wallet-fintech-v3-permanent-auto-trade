import { describe, expect, it } from "vitest";
import { generatePublicTradeId, PUBLIC_TRADE_ID_PATTERN, reserveUniquePublicTradeId } from "./public-trade-id";

describe("public trade IDs", () => {
  it("generates the required 12-character uppercase alphanumeric payload", () => {
    const id = generatePublicTradeId(() => 35);

    expect(id).toBe("TX-ZZZZ-ZZZZ-ZZZZ");
    expect(PUBLIC_TRADE_ID_PATTERN.test(id)).toBe(true);
  });

  it("retries a registry collision before returning the reserved ID", async () => {
    const candidates = ["TX-AAAA-AAAA-AAAA", "TX-BBBB-BBBB-BBBB"];
    const attempted: string[] = [];
    const id = await reserveUniquePublicTradeId(
      async candidate => {
        attempted.push(candidate);
        return candidate !== candidates[0];
      },
      () => candidates[attempted.length]!,
    );

    expect(attempted).toEqual(candidates);
    expect(id).toBe(candidates[1]);
  });

  it("fails closed when the ID generator returns malformed values", async () => {
    await expect(reserveUniquePublicTradeId(async () => true, () => "invalid")).rejects.toThrow(
      "Generated public trade ID does not match the required format.",
    );
  });
});
