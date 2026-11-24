import { useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Customer Withdrawal PIN panel.
 *
 * The PIN is a 6-digit number that is required for every withdrawal from any
 * wallet. It is displayed masked (`******`) until the customer clicks
 * “Reveal PIN”, and the customer can set or reset it at any time. The PIN is
 * stored so both the customer (here) and an administrator (admin console) can
 * view it.
 */

const MASKED_PIN = "******";

export function CustomerWithdrawalPinPanel({ push }: { push: (message: string) => void }) {
  const utils = trpc.useUtils();
  const status = trpc.customer.withdrawalPinStatus.useQuery(undefined, { refetchOnWindowFocus: true });

  const [revealedPin, setRevealedPin] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"success" | "error">("success");

  const configured = status.data?.configured === true;
  const pinValid = /^\d{6}$/.test(pin);
  const pinsMatch = pin === confirmPin && pinValid;

  const saveMutation = trpc.customer.setWithdrawalPin.useMutation({
    onSuccess: () => {
      setFeedbackKind("success");
      setFeedback("Your 6-digit withdrawal PIN has been saved. It is now required for every withdrawal.");
      setPin("");
      setConfirmPin("");
      setRevealedPin(null);
      void status.refetch();
      push("Withdrawal PIN updated");
    },
    onError: (error) => {
      setFeedbackKind("error");
      setFeedback(error.message);
    },
  });

  const revealPin = async () => {
    setRevealError("");
    if (revealedPin) {
      setRevealedPin(null);
      return;
    }
    setRevealing(true);
    try {
      const value = await utils.customer.revealWithdrawalPin.fetch();
      if (value) setRevealedPin(value);
      else setRevealError("You have not set a withdrawal PIN yet. Create one below.");
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : "Your withdrawal PIN could not be revealed.");
    } finally {
      setRevealing(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pinsMatch || saveMutation.isPending) return;
    setFeedback("");
    saveMutation.mutate({ pin });
  };

  const lastUpdated = status.data?.updatedAt ? new Date(status.data.updatedAt).toLocaleString() : null;

  return (
    <div className="settings-card customer-withdrawal-pin" aria-label="Withdrawal PIN">
      <div className="customer-password-guide-head">
        <span className="customer-password-guide-icon"><Lock size={16} /></span>
        <div>
          <span className="eyebrow">Withdrawal PIN</span>
          <h2>{configured ? "Your withdrawal PIN" : "Set your withdrawal PIN"}</h2>
        </div>
      </div>
      <p>
        A 6-digit PIN is required for every withdrawal from any wallet. Enter it each time you request a
        withdrawal. You can reset it here whenever you want.
      </p>

      <div className="customer-withdrawal-pin-display" aria-live="polite">
        <span className="customer-withdrawal-pin-label">Your PIN</span>
        <code className="customer-withdrawal-pin-value">{revealedPin ?? MASKED_PIN}</code>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void revealPin()}
          disabled={revealing || (!configured && !revealedPin)}
        >
          {revealing ? "Revealing…" : revealedPin ? <><EyeOff size={14} /> Hide PIN</> : <><Eye size={14} /> Reveal PIN</>}
        </button>
      </div>
      {!configured && !status.isLoading && <small className="customer-withdrawal-pin-error">No withdrawal PIN is set. Create one below before requesting a withdrawal.</small>}
      {revealError && <small className="customer-withdrawal-pin-error" role="alert">{revealError}</small>}
      {lastUpdated && <small className="customer-withdrawal-pin-meta">Last changed {lastUpdated}.</small>}

      <form className="customer-withdrawal-pin-form" onSubmit={submit}>
        <span className="eyebrow">{configured ? "Reset your PIN" : "Create your PIN"}</span>
        <div className="form-two">
          <label>
            New 6-digit PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              value={pin}
              disabled={saveMutation.isPending}
              onChange={(event) => { setPin(event.target.value.replace(/\D/g, "").slice(0, 6)); setFeedback(""); }}
            />
          </label>
          <label>
            Confirm 6-digit PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              value={confirmPin}
              disabled={saveMutation.isPending}
              onChange={(event) => { setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6)); setFeedback(""); }}
            />
          </label>
        </div>
        {pin && !pinValid && <small className="customer-withdrawal-pin-error">Your PIN must be exactly 6 digits.</small>}
        {pinValid && confirmPin && !pinsMatch && <small className="customer-withdrawal-pin-error">The two PINs do not match.</small>}
        {feedback && (
          <div className={feedbackKind === "error" ? "customer-withdrawal-pin-feedback is-error" : "customer-withdrawal-pin-feedback is-success"} role={feedbackKind === "error" ? "alert" : "status"}>
            {feedbackKind === "error" ? feedback : <><CheckCircle2 size={14} /> {feedback}</>}
          </div>
        )}
        <div className="customer-withdrawal-pin-actions">
          <button className="primary-button" type="submit" disabled={!pinsMatch || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving PIN…" : configured ? <><RefreshCw size={14} /> Reset withdrawal PIN</> : "Save withdrawal PIN"}
          </button>
        </div>
      </form>

      <div className="test-notice">
        <ShieldCheck size={14} />
        <span>Keep your PIN private. This PIN is required for every withdrawal and can be reset here at any time.</span>
      </div>
    </div>
  );
}

export default CustomerWithdrawalPinPanel;
