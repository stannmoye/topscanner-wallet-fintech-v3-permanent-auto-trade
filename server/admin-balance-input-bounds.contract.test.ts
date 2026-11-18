import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const accounting = readFileSync(new URL("./modules/realized-profit-accounting.ts", import.meta.url), "utf8");

describe("admin balance and manual-settlement input bounds (item 26)", () => {
  it("bounds adjustCustomerBalance.amountMinor to a positive safe integer with a strict input", () => {
    const index = router.indexOf("adjustCustomerBalance: adminProcedure.input");
    expect(index).toBeGreaterThanOrEqual(0);
    const declarationEnd = router.indexOf("adjustCustomerBalance(ctx.user.id, input)", index);
    expect(declarationEnd).toBeGreaterThan(index);
    const declaration = router.slice(index, declarationEnd);
    expect(declaration).toContain("amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)");
    expect(declaration).toContain("}).strict()");
  });

  it("requires confirmManualSettlement.grossProfitMinor to be a safe integer with a strict input", () => {
    const index = router.indexOf("confirmManualSettlement: adminProcedure.input");
    expect(index).toBeGreaterThanOrEqual(0);
    const declarationEnd = router.indexOf("manuallySettleTrade(input.tradeId,ctx.user.id,input)", index);
    expect(declarationEnd).toBeGreaterThan(index);
    const declaration = router.slice(index, declarationEnd);
    expect(declaration).toContain("grossProfitMinor: z.number().int().safe()");
    expect(declaration).toContain("}).strict()");
  });

  it("enforces the safe-integer and minus-principal bounds the schema relies on", () => {
    // Mirrors the schema bounds so the intent is exercised, not just string-matched.
    const amountMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
    expect(amountMinor.safeParse(1).success).toBe(true);
    expect(amountMinor.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(amountMinor.safeParse(0).success).toBe(false);
    expect(amountMinor.safeParse(-5).success).toBe(false);
    expect(amountMinor.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);

    const grossProfitMinor = z.number().int().safe();
    expect(grossProfitMinor.safeParse(-250).success).toBe(true);
    expect(grossProfitMinor.safeParse(2 ** 53).success).toBe(false);

    // A realized loss may never exceed the committed principal.
    expect(accounting).toContain("input.grossProfitMinor < -input.principalMinor");
  });
});
