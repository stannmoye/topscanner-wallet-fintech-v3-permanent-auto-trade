import { useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock3, Lock, RefreshCw, Send, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "../payout-requests.css";
import { currentWithdrawalCurrency } from "../withdrawal-navigation";

const PAYOUT_ASSETS = ["USD", "EUR", "GBP", "BTC", "ETH", "USDT"] as const;
type PayoutAsset = (typeof PAYOUT_ASSETS)[number];
type PayoutDestination = "bank_transfer" | "crypto_transfer";

// Withdrawal networks offered per crypto asset. The customer selects one so an
// administrator can verify the address against the correct chain.
const PAYOUT_NETWORKS: Record<string, string[]> = {
  BTC: ["Bitcoin"],
  ETH: ["Ethereum (ERC-20)"],
  USDT: ["Ethereum (ERC-20)", "Tron (TRC-20)", "BNB Smart Chain (BEP-20)"],
};

function firstPayoutNetwork(currency: string) {
  return PAYOUT_NETWORKS[currency]?.[0] ?? "";
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `payout-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseMinorUnits(raw: string, scale: number): number | null {
  const value = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isInteger(scale) || scale < 0 || scale > 8) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) return null;
  try {
    const factor = 10n ** BigInt(scale);
    const minor = BigInt(whole) * factor + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
    return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
  } catch {
    return null;
  }
}

function formatPayoutAmount(amountMinor: number, currency: string, scale: number) {
  const value = Number(amountMinor) / (10 ** scale);
  return `${currency} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(value)}`;
}

// The stored value stays "completed" (the lifecycle migration vocabulary); the
// customer-facing label reads "Successful" as agreed with the platform owner.
function payoutStatusLabel(status: string) {
  switch (status) {
    case "confirming": return "Confirming";
    case "processing": return "Processing";
    case "completed":
    case "paid": return "Successful";
    case "declined":
    case "rejected": return "Declined · funds released";
    case "cancelled": return "Cancelled · funds released";
    // Legacy values shown only if a record predates the lifecycle migration.
    case "pending": return "Processing";
    default: return status;
  }
}

// Confirming and processing are the open states a customer may still cancel.
function isOpenPayoutStatus(status: string) {
  return status === "confirming" || status === "processing" || status === "pending";
}

// Resolves a status to the icon tone. Legacy paid/pending are tolerated for
// records that predate the lifecycle migration.
function payoutStatusTone(status: string): "completed" | "open" | "closed" {
  if (status === "completed" || status === "paid") return "completed";
  if (isOpenPayoutStatus(status)) return "open";
  return "closed";
}

// Composes the free-text destination the server persists from the structured
// fields, so no database schema or procedure change is required.
function composeCryptoDestination(network: string, address: string) {
  return [`Network: ${network.trim()}`, `Address: ${address.trim()}`].join("\n");
}

function composeBankDestination(fields: { beneficiaryName: string; bankName: string; accountNumber: string; swiftCode: string; bankCountry: string }) {
  return [
    `Beneficiary: ${fields.beneficiaryName.trim()}`,
    `Bank: ${fields.bankName.trim()}`,
    `Account number / IBAN: ${fields.accountNumber.trim()}`,
    `SWIFT / BIC or routing number: ${fields.swiftCode.trim()}`,
    `Country: ${fields.bankCountry.trim()}`,
  ].join("\n");
}

export function CustomerPayoutRequests() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const currentCursor = cursorStack[cursorStack.length - 1];
  const balances = trpc.customer.balances.useQuery(undefined, { refetchInterval: 10_000 });
  const requests = trpc.customer.payoutRequests.useQuery(
    { cursor: currentCursor, pageSize: 50 },
    { refetchInterval: 10_000 },
  );
  const eligibility = trpc.customer.payoutEligibility.useQuery(undefined, { refetchInterval: 30_000 });
  const authenticatorStatus = trpc.customer.authenticatorStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const pinStatus = trpc.customer.withdrawalPinStatus.useQuery(undefined, { refetchInterval: 30_000 });
  // Opens pre-set to the currency the customer clicked in their wallet; falls
  // back to USD when the page is reached from the navigation menu.
  const [currency, setCurrency] = useState<PayoutAsset>(() => {
    const initial = currentWithdrawalCurrency("USD").toUpperCase();
    return (PAYOUT_ASSETS as readonly string[]).includes(initial) ? (initial as PayoutAsset) : "USD";
  });
  const [amountText, setAmountText] = useState("");
  const [network, setNetwork] = useState(() => firstPayoutNetwork(currency));
  const [walletAddress, setWalletAddress] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [swiftCode, setSwiftCode] = useState("");
  const [bankCountry, setBankCountry] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [pin, setPin] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [feedback, setFeedback] = useState("");
  const [receipt, setReceipt] = useState<any>(null);

  // Withdrawals are always available to customers. The eligibility probe is
  // informational only: a failed check must never disable the request form.
  const payoutAllowed = eligibility.data?.allowed !== false;
  const eligibilityMessage = eligibility.data?.allowed === false
    ? eligibility.data.reason || "Withdrawal requests are not available for this account."
    : "";

  const requestMutation = trpc.customer.requestPayout.useMutation({
    onSuccess: (request) => {
      setReceipt(request);
      setFeedback(`Withdrawal request ${request.requestReference} was received. The requested amount is reserved while an administrator reviews it; no transfer has been sent.`);
      setAmountText("");
      setWalletAddress("");
      setBeneficiaryName("");
      setBankName("");
      setAccountNumber("");
      setSwiftCode("");
      setBankCountry("");
      setTotpCode("");
      setPin("");
      setIdempotencyKey(newIdempotencyKey());
      setCursorStack([undefined]);
      void requests.refetch();
      void balances.refetch();
      void eligibility.refetch();
    },
    onError: (error) => setFeedback(error.message),
  });
  const cancelMutation = trpc.customer.cancelPayoutRequest.useMutation({
    onSuccess: (request) => {
      setFeedback(`Withdrawal request ${request.requestReference} was cancelled and its reserved funds were returned.`);
      setCursorStack([undefined]);
      void requests.refetch();
      void balances.refetch();
    },
    onError: (error) => setFeedback(error.message),
  });

  const currencyInfo = useMemo(
    () => (balances.data?.currencies || []).find((entry: any) => String(entry.code).toUpperCase() === currency),
    [balances.data?.currencies, currency],
  );
  const scaleFor = (code: string) => Math.max(0, Math.min(8, Number((balances.data?.currencies || []).find((item: any) => String(item.code).toUpperCase() === String(code).toUpperCase())?.scale ?? 2)));
  const wallet = (balances.data?.balances || []).find((entry: any) => String(entry.currency).toUpperCase() === currency);
  const scale = Math.max(0, Math.min(8, Number(currencyInfo?.scale ?? 2)));
  const isCryptoAsset = ["BTC", "ETH", "USDT"].includes(currency);
  const destinationType: PayoutDestination = isCryptoAsset ? "crypto_transfer" : "bank_transfer";
  const available = Number(wallet?.availableMinor ?? 0);
  const promotional = Number(wallet?.promotionalMinor ?? 0);
  const eligibleMinor = Number.isSafeInteger(available) && Number.isSafeInteger(promotional)
    ? Math.max(0, available - promotional)
    : 0;
  const amountMinor = parseMinorUnits(amountText, scale);
  const amountValid = amountMinor !== null && amountMinor > 0 && amountMinor <= eligibleMinor;
  const destinationReady = isCryptoAsset
    ? network.trim().length > 0 && walletAddress.trim().length >= 10
    : beneficiaryName.trim().length >= 2 && bankName.trim().length >= 2 && accountNumber.trim().length >= 4 && swiftCode.trim().length >= 2 && bankCountry.trim().length >= 2;
  // A 6-digit withdrawal PIN is required for every withdrawal.
  const pinValid = /^\d{6}$/.test(pin);
  const pinConfigured = pinStatus.data?.configured === true;
  const destinationDetails = isCryptoAsset
    ? composeCryptoDestination(network, walletAddress)
    : composeBankDestination({ beneficiaryName, bankName, accountNumber, swiftCode, bankCountry });
  const isBusy = requestMutation.isPending || cancelMutation.isPending;
  const formDisabled = isBusy || !payoutAllowed;
  const pageNumber = cursorStack.length;
  const payoutItems = requests.data?.items ?? [];
  const hasNextPage = requests.data?.hasMore === true && Boolean(requests.data.nextCursor);
  const now = new Date();

  const changeFormValue = (change: () => void) => {
    if (isBusy) return;
    change();
    setIdempotencyKey(newIdempotencyKey());
    setFeedback("");
  };

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payoutAllowed || !amountValid || amountMinor === null || !destinationReady || !pinValid || isBusy) return;
    setFeedback("");
    requestMutation.mutate({
      currency,
      amountMinor,
      destinationType,
      destinationDetails,
      idempotencyKey,
      pin,
      totpCode: totpCode || undefined,
    });
  };

  const cancelRequest = (requestId: number) => {
    if (isBusy || !globalThis.confirm?.("Cancel this withdrawal request and return its reserved funds to your available wallet?")) return;
    setFeedback("");
    cancelMutation.mutate({ requestId });
  };

  return (
    <section className="payout-request-panel" aria-labelledby="withdrawal-requests-heading">
      <header className="payout-request-heading">
        <div>
          <span className="payout-request-eyebrow">Manual processing · no automatic transfers</span>
          <h2 id="withdrawal-requests-heading">Withdraw funds</h2>
          <p>Request a withdrawal from an eligible non-promotional wallet balance. Enter the amount and a destination address or complete bank details. Funds are reserved until an administrator marks the request successful or declines it.</p>
        </div>
        <button className="payout-refresh" type="button" onClick={() => { void requests.refetch(); void balances.refetch(); void eligibility.refetch(); }} disabled={requests.isFetching || balances.isFetching || eligibility.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {eligibility.isLoading ? <div className="payout-eligibility-note" role="status"><Clock3 size={15} /> Checking withdrawal eligibility…</div> : !payoutAllowed ? <div className="payout-eligibility-alert" role="alert"><AlertCircle size={15} /><span>{eligibilityMessage || "Withdrawal requests are not available for this account."}</span>{eligibility.isError && <button type="button" onClick={() => void eligibility.refetch()}>Retry check</button>}</div> : null}

      <form className="payout-request-form" onSubmit={submitRequest}>
        <div className="payout-form-field">
          <label htmlFor="payout-currency">Withdrawal currency</label>
          <select id="payout-currency" value={currency} disabled={formDisabled} onChange={(event) => changeFormValue(() => { const nextCurrency = event.target.value as PayoutAsset; setCurrency(nextCurrency); setAmountText(""); setWalletAddress(""); setNetwork(firstPayoutNetwork(nextCurrency)); setBeneficiaryName(""); setBankName(""); setAccountNumber(""); setSwiftCode(""); setBankCountry(""); })}>
            {PAYOUT_ASSETS.map((asset) => <option key={asset} value={asset}>{asset}</option>)}
          </select>
          <small>CKI is not eligible for withdrawal. Swap it into a supported wallet currency first.</small>
        </div>
        <div className="payout-form-field">
          <label htmlFor="payout-amount">Amount</label>
          <input id="payout-amount" type="text" inputMode="decimal" autoComplete="off" placeholder={scale ? `0.${"0".repeat(Math.min(scale, 2))}` : "0"} value={amountText} disabled={formDisabled} onChange={(event) => changeFormValue(() => setAmountText(event.target.value))} />
          <small>Available for withdrawal: {formatPayoutAmount(eligibleMinor, currency, scale)}</small>
          {amountText && !amountValid && <small className="payout-form-error">Enter a positive amount within the available balance, using at most {scale} decimal places.</small>}
        </div>
        <div className="payout-form-field">
          <span className="payout-form-label">Destination type</span>
          <div className="payout-destination-type" id="payout-destination-type" role="status">{isCryptoAsset ? "Crypto wallet transfer" : "Bank transfer"}</div>
          <small>The destination type follows the currency. No currency conversion is performed.</small>
        </div>

        <div className="payout-form-field payout-destination-details">
          <span className="payout-form-label">{isCryptoAsset ? "Withdrawal address" : "Bank details"}</span>
          {isCryptoAsset ? (
            <div className="payout-destination-grid">
              <div className="payout-form-field">
                <label htmlFor="payout-network">Withdrawal network</label>
                <select id="payout-network" value={network} disabled={formDisabled} onChange={(event) => changeFormValue(() => setNetwork(event.target.value))}>
                  {(PAYOUT_NETWORKS[currency] || []).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="payout-form-field">
                <label htmlFor="payout-wallet-address">Wallet address</label>
                <input id="payout-wallet-address" type="text" autoComplete="off" spellCheck={false} value={walletAddress} disabled={formDisabled} placeholder={`Your ${currency} receiving address`} onChange={(event) => changeFormValue(() => setWalletAddress(event.target.value))} />
                <small>Enter the public {currency} address on the selected network. This is recorded for administrator review only.</small>
              </div>
            </div>
          ) : (
            <div className="payout-destination-grid">
              <div className="payout-form-field">
                <label htmlFor="payout-beneficiary">Beneficiary name</label>
                <input id="payout-beneficiary" type="text" autoComplete="off" value={beneficiaryName} disabled={formDisabled} placeholder="Account holder full name" onChange={(event) => changeFormValue(() => setBeneficiaryName(event.target.value))} />
              </div>
              <div className="payout-form-field">
                <label htmlFor="payout-bank-name">Bank name</label>
                <input id="payout-bank-name" type="text" autoComplete="off" value={bankName} disabled={formDisabled} placeholder="Receiving bank" onChange={(event) => changeFormValue(() => setBankName(event.target.value))} />
              </div>
              <div className="payout-form-field">
                <label htmlFor="payout-account-number">Account number or IBAN</label>
                <input id="payout-account-number" type="text" autoComplete="off" value={accountNumber} disabled={formDisabled} placeholder="Account number or IBAN" onChange={(event) => changeFormValue(() => setAccountNumber(event.target.value))} />
              </div>
              <div className="payout-form-field">
                <label htmlFor="payout-swift">SWIFT / BIC or routing number</label>
                <input id="payout-swift" type="text" autoComplete="off" value={swiftCode} disabled={formDisabled} placeholder="SWIFT / BIC or routing number" onChange={(event) => changeFormValue(() => setSwiftCode(event.target.value))} />
              </div>
              <div className="payout-form-field">
                <label htmlFor="payout-bank-country">Bank country</label>
                <input id="payout-bank-country" type="text" autoComplete="off" value={bankCountry} disabled={formDisabled} placeholder="Country of the receiving bank" onChange={(event) => changeFormValue(() => setBankCountry(event.target.value))} />
              </div>
            </div>
          )}
        </div>

        <div className="payout-summary" aria-label="Withdrawal reference and summary">
          <div className="payout-summary-head"><span className="payout-request-eyebrow">Auto-generated withdrawal record</span><h3>Withdrawal summary</h3></div>
          <dl className="payout-summary-grid">
            <div><dt>Withdrawal reference</dt><dd>{receipt?.requestReference || "Generated on confirmation"}</dd></div>
            <div><dt>Amount</dt><dd>{receipt ? formatPayoutAmount(Number(receipt.amountMinor), receipt.currency, scaleFor(receipt.currency)) : amountMinor !== null && amountMinor > 0 ? formatPayoutAmount(amountMinor, currency, scale) : "—"}</dd></div>
            <div><dt>Date &amp; time</dt><dd>{receipt?.createdAt ? new Date(receipt.createdAt).toLocaleString() : now.toLocaleString()}</dd></div>
            <div><dt>Transaction reference</dt><dd>{receipt?.externalReference || "Added by the administrator on completion"}</dd></div>
          </dl>
        </div>

        <div className="payout-form-field">
          <label htmlFor="payout-pin">Withdrawal PIN</label>
          <input id="payout-pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={pin} disabled={formDisabled} placeholder="6-digit PIN" onChange={(event) => changeFormValue(() => setPin(event.target.value.replace(/\D/g, "").slice(0, 6)))} />
          <small>Required for every withdrawal. Set, reset, or reveal your PIN under <strong>Withdrawal PIN</strong> in your account menu.</small>
          {pin && !pinValid && <small className="payout-form-error">Enter your 6-digit withdrawal PIN.</small>}
          {!pinConfigured && !pinStatus.isLoading && <small className="payout-form-error"><Lock size={12} /> No withdrawal PIN is set yet — create one under <strong>Withdrawal PIN</strong> before you can withdraw.</small>}
        </div>
        {authenticatorStatus.data?.enabled && <div className="payout-form-field">
          <label htmlFor="payout-totp-code">Authenticator code</label>
          <input id="payout-totp-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} disabled={formDisabled} onChange={(event) => changeFormValue(() => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6)))} />
          <small>Enter a current code. Each code can authorize only one new withdrawal request.</small>
        </div>}
        <div className="payout-request-warning">
          <AlertCircle size={16} />
          <span>Enter your 6-digit withdrawal PIN above. Never enter your account password, private keys, or seed phrases. The destination is recorded for administrator review; this form does not send funds.</span>
        </div>
        {feedback && <div className={/was received|was cancelled/.test(feedback) ? "payout-feedback success" : "payout-feedback"} role="status">{feedback}</div>}
        <div className="payout-submit-row">
          <button className="payout-submit" type="submit" disabled={!payoutAllowed || !amountValid || !destinationReady || !pinValid || isBusy || balances.isLoading}>
            <Send size={15} /> {requestMutation.isPending ? "Submitting withdrawal…" : "Confirm withdrawal"}
          </button>
          {balances.isError && <small className="payout-form-error">Wallet balances could not be loaded. Refresh before submitting.</small>}
        </div>
      </form>

      <div className="payout-history-heading">
        <h3>Withdrawal history</h3>
        <span aria-live="polite">Page {pageNumber}</span>
      </div>
      {requests.isLoading ? <p className="payout-empty" role="status">Loading withdrawal history…</p> : requests.isError ? <div className="payout-form-error" role="alert"><span>Withdrawal history could not be loaded. Try refreshing.</span><button className="payout-refresh" type="button" onClick={() => void requests.refetch()} disabled={requests.isFetching}>Retry</button></div> : !payoutItems.length ? <p className="payout-empty">{pageNumber === 1 ? "No withdrawal requests have been recorded." : "No withdrawal requests are available on this page."}</p> : (
        <div className="payout-request-list">
          {payoutItems.map((request) => {
            const requestScale = scaleFor(request.currency);
            const statusTone = payoutStatusTone(request.status);
            return <article className="payout-request-item" key={request.id}>
              <div className="payout-request-item-top">
                <div><strong>{formatPayoutAmount(Number(request.amountMinor), request.currency, requestScale)}</strong><small>{request.requestReference}</small></div>
                <span className={`payout-status payout-status-${request.status}`}>{statusTone === "completed" ? <CheckCircle2 size={13} /> : statusTone === "open" ? <Clock3 size={13} /> : <XCircle size={13} />}{payoutStatusLabel(request.status)}</span>
              </div>
              <div className="payout-request-item-details">
                <span>{request.destinationType === "bank_transfer" ? "Bank transfer" : "Crypto transfer"}</span>
                <time>{request.createdAt ? new Date(request.createdAt).toLocaleString() : ""}</time>
              </div>
              {request.externalReference && <p>Transaction reference: <strong>{request.externalReference}</strong></p>}
              {request.resolutionNote && <p>Administrator note: {request.resolutionNote}</p>}
              {isOpenPayoutStatus(request.status) && <button className="payout-cancel" type="button" disabled={isBusy} onClick={() => cancelRequest(Number(request.id))}><XCircle size={14} /> {cancelMutation.isPending ? "Cancelling…" : "Cancel request"}</button>}
            </article>;
          })}
        </div>
      )}
      <nav className="payout-history-pagination" aria-label="Withdrawal history pagination">
        <button
          className="payout-refresh"
          type="button"
          aria-label="Go to previous withdrawal history page"
          onClick={() => setCursorStack((stack) => stack.length > 1 ? stack.slice(0, -1) : stack)}
          disabled={pageNumber === 1 || requests.isFetching || isBusy}
        >Previous</button>
        <button
          className="payout-refresh"
          type="button"
          aria-label="Go to next withdrawal history page"
          onClick={() => {
            const nextCursor = requests.data?.nextCursor;
            if (requests.data?.hasMore && nextCursor) setCursorStack((stack) => [...stack, nextCursor]);
          }}
          disabled={!hasNextPage || requests.isFetching || isBusy}
        >Next</button>
      </nav>
    </section>
  );
}
