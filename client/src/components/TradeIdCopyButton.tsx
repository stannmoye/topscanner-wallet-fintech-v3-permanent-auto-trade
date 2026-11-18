import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";

type TradeIdCopyButtonProps = {
  tradeId: string;
  className?: string;
};

export function TradeIdCopyButton({ tradeId, className = "" }: TradeIdCopyButtonProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copyTradeId = async () => {
    try {
      await navigator.clipboard.writeText(tradeId);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className={`trade-id-copy ${className}`.trim()}>
      <code className="trade-id-copy__value">{tradeId}</code>
      <button
        className="trade-id-copy__button"
        type="button"
        aria-label={`Copy Trade ID ${tradeId}`}
        onClick={() => void copyTradeId()}
      >
        {copyState === "copied" ? <Check size={15} aria-hidden="true" /> : copyState === "failed" ? <TriangleAlert size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        <span className="trade-id-copy__button-label">{copyState === "copied" ? "Copied" : "Copy"}</span>
      </button>
      <span className="trade-id-copy__status" role="status" aria-live="polite">
        {copyState === "copied" ? "Trade ID copied" : copyState === "failed" ? "Clipboard unavailable; select the ID to copy it manually" : ""}
      </span>
    </div>
  );
}
