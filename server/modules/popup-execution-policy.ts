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
  const eventStatus = String(input.eventStatus ?? "").trim().toUpperCase();
  // Item 23: a missing or blank execution status is NOT treated as READY. An
  // event whose execution state was never recorded must never be claimed for
  // automatic financial allocation; only an explicit READY/RETRYING is eligible.
  const executionStatus = String(input.executionStatus ?? "").trim().toUpperCase();

  // Browser-side delivery acknowledgements must never decide allocation.
  // DISMISSED is presentation-only and must not cancel server-owned execution.
  return ["DELIVERED", "NOTICED", "OPENED", "DISMISSED"].includes(eventStatus)
    && ["READY", "RETRYING"].includes(executionStatus);
}
