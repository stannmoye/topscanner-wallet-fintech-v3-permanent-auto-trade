import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

const start = dbSource.indexOf("export async function listTradeSettlementIntegrityIssues(");
const end = dbSource.indexOf("\nexport async function listWalletLedgerReconciliation(", start);
const implementation = dbSource.slice(start, end);

describe("settlement integrity query collation safety", () => {
  it("finds the settlement integrity scan", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
  });

  it("pins an explicit collation on cross-table string comparisons so the joined scan never fails with an illegal mix of collations", () => {
    // `trade_positions` was created without an explicit collation (inheriting the
    // database default), while `trade_reward_reservations` and
    // `trade_settlement_reference_claims` are created explicitly as
    // utf8mb4_unicode_ci. Comparing the two columns with a bare `<>` therefore
    // raises "Illegal mix of collations" (-4031) and the whole admin query 500s.
    expect(implementation).toContain(
      "${tradePositions.settlementReference} COLLATE utf8mb4_unicode_ci <> ${tradeSettlementReferenceClaims.settlementReference} COLLATE utf8mb4_unicode_ci",
    );
    expect(implementation).toContain(
      "${tradeRewardReservations.currency} COLLATE utf8mb4_unicode_ci <> ${tradePositions.currency} COLLATE utf8mb4_unicode_ci",
    );
    // The bare, unqualified comparisons must no longer be present.
    expect(implementation).not.toContain(
      "${tradePositions.settlementReference} <> ${tradeSettlementReferenceClaims.settlementReference}",
    );
    expect(implementation).not.toContain(
      "${tradeRewardReservations.currency} <> ${tradePositions.currency}",
    );
  });

  it("stays a read-only scan that keeps pagination", () => {
    expect(implementation).toContain("limit(safeLimit + 1)");
    expect(implementation).toContain("nextBeforeTradeId");
    expect(implementation).not.toContain("tx.update(");
    expect(implementation).not.toContain("tx.insert(");
    expect(implementation).not.toContain("tx.delete(");
  });
});

describe("tRPC error cause visibility", () => {
  it("logs the underlying database cause server-side without changing the client response", () => {
    const middlewareStart = serverSource.indexOf('"/api/trpc"');
    expect(middlewareStart).toBeGreaterThanOrEqual(0);
    const middleware = serverSource.slice(middlewareStart, middlewareStart + 2000);
    expect(middleware).toContain("onError({ error, path, type })");
    expect(middleware).toContain(".cause");
    expect(middleware).toContain("sanitizeWorkerErrorMessage");
  });
});
