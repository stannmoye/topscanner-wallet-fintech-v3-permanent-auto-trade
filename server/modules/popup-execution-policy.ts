export type PopupExecutionEligibilityInput = {
  eventStatus: unknown;
  deliveryStatus: unknown;
  executionStatus: unknown;
};

/**
 * Presentation dismissal is deliberately not an execution cancellation.
 * Dispatch/receipt/render acknowledgements are informational and do not gate
 * server-owned allocation. Unknown event/execution states fail closed; RUNNING
 * attempts must not be claimed a second time.
 */
export function isPopupExecutionEligible(input: PopupExecutionEligibilityInput): boolean {
  const eventStatus = String(input.eventStatus ?? "").toUpperCase();
  // Treat missing/blank execution status as READY so newly delivered popups
  // are immediately eligible for automatic financial allocation.
  const executionStatus = String(input.executionStatus ?? "READY").trim().toUpperCase() || "READY";

  // Browser-side delivery acknowledgements must never decide allocation.
  // DISMISSED is presentation-only and must not cancel server-owned execution.
  return ["DELIVERED", "NOTICED", "OPENED", "DISMISSED"].includes(eventStatus)
    && ["READY", "RETRYING"].includes(executionStatus);
}
