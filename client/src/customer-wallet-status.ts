export type ActivePopupTradeCapital = {
  currency: string;
  amountMinor: number;
} | null;

export type WalletStatusRow = {
  currency?: unknown;
  lockedMinor?: unknown;
  pendingWithdrawalMinor?: unknown;
};

export function resolveWalletStatusAmounts(
  row: WalletStatusRow,
  activeTrade: ActivePopupTradeCapital,
) {
  const pendingWithdrawalMinor = Math.max(0, Number(row.pendingWithdrawalMinor || 0));
  const ledgerTradeLockedMinor = Math.max(
    0,
    Number(row.lockedMinor || 0) - pendingWithdrawalMinor,
  );
  const rowCurrency = String(row.currency || "").trim().toUpperCase();
  const popupTradeMinor =
    activeTrade &&
    activeTrade.currency === rowCurrency &&
    Number.isSafeInteger(activeTrade.amountMinor) &&
    activeTrade.amountMinor > 0
      ? activeTrade.amountMinor
      : 0;

  return {
    pendingWithdrawalMinor,
    tradeLockedMinor: popupTradeMinor || ledgerTradeLockedMinor,
  };
}

export function walletStatusesNeedAlternation(amounts: {
  pendingWithdrawalMinor: number;
  tradeLockedMinor: number;
}) {
  return amounts.pendingWithdrawalMinor > 0 && amounts.tradeLockedMinor > 0;
}
