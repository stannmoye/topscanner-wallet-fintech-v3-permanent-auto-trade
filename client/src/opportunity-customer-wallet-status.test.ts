import { describe, expect, it } from "vitest";
import {
  resolveWalletStatusAmounts,
  walletStatusesNeedAlternation,
} from "./customer-wallet-status";

describe("customer wallet ribbon status amounts", () => {
  it("keeps a pending withdrawal and the active popup trade amount distinct", () => {
    const amounts = resolveWalletStatusAmounts(
      {
        currency: "USD",
        lockedMinor: 40000,
        pendingWithdrawalMinor: 40000,
      },
      { currency: "USD", amountMinor: 10000 },
    );

    expect(amounts).toEqual({
      pendingWithdrawalMinor: 40000,
      tradeLockedMinor: 10000,
    });
    expect(walletStatusesNeedAlternation(amounts)).toBe(true);
  });

  it("uses the ledger trade lock when no matching popup trade is active", () => {
    const amounts = resolveWalletStatusAmounts(
      {
        currency: "USD",
        lockedMinor: 50000,
        pendingWithdrawalMinor: 40000,
      },
      { currency: "EUR", amountMinor: 10000 },
    );

    expect(amounts).toEqual({
      pendingWithdrawalMinor: 40000,
      tradeLockedMinor: 10000,
    });
    expect(walletStatusesNeedAlternation(amounts)).toBe(true);
  });
});
