// Bridges the customer wallet tiles to the dedicated withdrawal page.
//
// The customer portal switches sections through the "arbitrade:customer-navigate"
// browser event. A wallet tile therefore only records the currency it was opened
// for and dispatches that event; the withdrawal page reads the currency when it
// mounts. Keeping this in one small module avoids threading a new prop through
// the (very large) portal shell.
export const WITHDRAW_SECTION = "withdraw";

let selectedWithdrawalCurrency: string | null = null;

// Records the currency a wallet tile was opened for and asks the portal to show
// the withdrawal page.
export function requestWalletWithdrawal(currency: string) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (code) selectedWithdrawalCurrency = code;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("arbitrade:customer-navigate", { detail: WITHDRAW_SECTION }));
  }
}

// Reads (without clearing) the currency chosen by the most recent wallet tile so
// the withdrawal page opens pre-set to it. Defaults to USD when opened from the
// navigation menu instead of a specific wallet.
export function currentWithdrawalCurrency(fallback = "USD") {
  return selectedWithdrawalCurrency || fallback;
}
