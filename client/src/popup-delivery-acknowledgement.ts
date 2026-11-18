export type PopupAcknowledgementResult = "acknowledged" | "retry" | "cancelled";

/** Terminal states for the whole acknowledgement job (item 34). */
export type PopupAcknowledgementOutcome = "acknowledged" | "unconfirmed" | "cancelled";

/**
 * Whole-job retry budget. The acknowledgement must never retry forever: it stops
 * after a bounded number of attempts or a bounded wall-clock budget, backs off
 * between attempts, and reports a terminal state the UI can show ("Could not
 * confirm delivery"). A popup can be re-opened on the next connection, but the
 * client must not keep the promise of a receipt alive indefinitely.
 */
export const POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS = {
  /** Maximum acknowledgement attempts (receipt + render rounds). */
  maxAttempts: 6,
  /** Maximum wall-clock time for the whole job, in milliseconds. */
  maxDurationMs: 45_000,
  /** First back-off delay between attempts, in milliseconds. */
  baseDelayMs: 1_000,
  /** Back-off ceiling between attempts, in milliseconds. */
  maxDelayMs: 15_000,
} as const;

/** Exponential back-off between acknowledgement attempts, capped at maxDelayMs. */
export function popupAcknowledgementBackoffMs(attemptIndex: number): number {
  const { baseDelayMs, maxDelayMs } = POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS;
  if (!Number.isSafeInteger(attemptIndex) || attemptIndex < 0) return baseDelayMs;
  return Math.min(baseDelayMs * 2 ** attemptIndex, maxDelayMs);
}

/**
 * Receipt and rendering are separate idempotent acknowledgements. A transport
 * error is ambiguous: the server may have committed before the response was
 * lost, so repeat both operations with the same delivery identity/token.
 * This helper intentionally has no failure transition.
 */
export async function acknowledgePopupDelivery(input: {
  received: () => Promise<unknown>;
  rendered: () => Promise<unknown>;
  isCurrent: () => boolean;
  maxAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<PopupAcknowledgementResult> {
  const maxAttempts = input.maxAttempts ?? 3;
  const wait = input.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError("Popup acknowledgement attempts must be an integer from 1 to 10.");
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!input.isCurrent()) return "cancelled";
    try {
      await input.received();
      await input.rendered();
      return "acknowledged";
    } catch {
      if (attempt + 1 >= maxAttempts) return "retry";
      await wait(Math.min(250 * 2 ** attempt, 2_000));
    }
  }
  return "retry";
}

/**
 * Runs the acknowledgement as one bounded job. Each attempt is an idempotent
 * receipt + render round; between attempts the job waits with exponential
 * back-off. It gives up after {@link POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxAttempts}
 * attempts or once the wall-clock budget is exhausted, calls `onGiveUp` exactly
 * once, and returns `"unconfirmed"`. It never throws and never reports `FAILED`.
 */
export async function runPopupDeliveryAcknowledgement(input: {
  received: () => Promise<unknown>;
  rendered: () => Promise<unknown>;
  isCurrent: () => boolean;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  onGiveUp?: (info: { attempts: number; elapsedMs: number }) => void;
}): Promise<PopupAcknowledgementOutcome> {
  const now = input.now ?? (() => Date.now());
  const wait = input.wait ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  let attempts = 0;
  while (attempts < POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxAttempts) {
    if (!input.isCurrent()) return "cancelled";
    attempts += 1;
    const roundResult = await acknowledgePopupDelivery({
      received: input.received,
      rendered: input.rendered,
      isCurrent: input.isCurrent,
      maxAttempts: 1,
      wait,
    });
    if (roundResult === "acknowledged") return "acknowledged";
    // Stop immediately once the popup is no longer current, without a needless
    // back-off wait before the next loop iteration notices the cancellation.
    if (roundResult === "cancelled" || !input.isCurrent()) return "cancelled";
    const elapsedMs = now() - startedAt;
    if (attempts >= POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxAttempts || elapsedMs >= POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxDurationMs) break;
    const remainingBudgetMs = Math.max(0, POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxDurationMs - elapsedMs);
    await wait(Math.min(popupAcknowledgementBackoffMs(attempts - 1), remainingBudgetMs));
  }
  input.onGiveUp?.({ attempts, elapsedMs: now() - startedAt });
  return "unconfirmed";
}
