import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateAutomaticTradeCredit } from "./modules/automatic-trade-lifecycle-math";

const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

const settleStart = source.indexOf("export async function processAutomaticMarketSettlements(");
const settleEnd = source.indexOf("\nexport async function ", settleStart + 1);
const settle = source.slice(settleStart, settleEnd);

const creditStart = source.indexOf("export async function processConfirmedTradeCredits(");
const creditEnd = source.indexOf("\nexport async function catchUpDueAutomaticSettlements(", creditStart);
const credit = source.slice(creditStart, creditEnd);

const catchUpStart = source.indexOf("export async function catchUpDueAutomaticSettlements(");
const catchUpEnd = source.indexOf("\nexport async function ", catchUpStart + 1);
const catchUp = source.slice(catchUpStart, catchUpEnd);

describe("automatic pop-up settlement is deterministic and loss-free (item 19)", () => {
  it("settles only from the return fixed at allocation and never consults a market price", () => {
    expect(settleStart).toBeGreaterThanOrEqual(0);
    expect(settleEnd).toBeGreaterThan(settleStart);
    expect(settle).toContain('const settlementResultSource="allocation_snapshot"');
    expect(settle).toContain("expectedRewardMinor");
    expect(settle).toContain("configuredProfitRateBps");
    // No market snapshot lookup drives the result, and the exit snapshot fields
    // are explicitly nulled so a network outage cannot change the credit.
    expect(settle).not.toContain("marketSnapshots");
    expect(settle).toContain("const exitMarketSnapshotId:number|null=null");
    expect(settle).toContain("const exitPriceUsd:string|null=null");
    expect(settle).toContain("const settlementObservedAt:Date|null=null");
    // The market-waiting state no longer exists.
    expect(settle).not.toContain("waitingForMarket");
  });

  it("credits allocation-snapshot settlements exactly like the older automatic sources", () => {
    expect(creditStart).toBeGreaterThanOrEqual(0);
    expect(creditEnd).toBeGreaterThan(creditStart);
    expect(credit).toContain('trade.settlementResultSource==="allocation_snapshot"');
  });

  it("stays idempotent across restarts, crashes and duplicate workers", () => {
    // Row lock per trade, unique settlement-reference claim, and a conditional
    // terminal transition on walletUpdatedAt are the exactly-once guards.
    expect(settle).toContain('.limit(1).for("update")');
    expect(settle).toContain("tradeSettlementReferenceClaims");
    expect(settle).toContain('code==="ER_DUP_ENTRY"');
    expect(credit).toContain("isNull(tradePositions.walletUpdatedAt)");
    expect(credit).toContain('.limit(1).for("update")');
  });
});

describe("bounded startup catch-up for overdue settlements (item 19)", () => {
  it("runs the reconciliation -> settlement -> credit chain with a bounded limit", () => {
    expect(catchUpStart).toBeGreaterThanOrEqual(0);
    expect(catchUpEnd).toBeGreaterThan(catchUpStart);
    expect(catchUp).toContain("reconcileAllDueTradesAwaitingConfirmation()");
    expect(catchUp).toContain("processAutomaticMarketSettlements({limit})");
    expect(catchUp).toContain("processConfirmedTradeCredits({limit})");
    expect(catchUp).toContain("Math.min(250");
  });

  it("is invoked once at server startup alongside the periodic 30-second sweep", () => {
    expect(server).toContain("catchUpDueAutomaticSettlements");
    expect(server).toContain("catchUpDueAutomaticSettlements({ limit: 250 })");
    expect(server).toContain('registerWorkerInterval(() => { void runTradeCycle().catch(() => undefined); }, 30_000)');
  });
});

describe("late credit equals on-time credit (item 19)", () => {
  it("derives the same principal and configured return from the allocation snapshot", () => {
    const onTime = calculateAutomaticTradeCredit({ capitalMinor: 10_000, profitRateBps: 250, currency: "USD" });
    const lateAfterRestart = calculateAutomaticTradeCredit({ capitalMinor: 10_000, profitRateBps: 250, currency: "USD" });
    expect(lateAfterRestart).toEqual(onTime);
    expect(onTime.totalCreditedMinor).toBe(10_250);
  });
});
