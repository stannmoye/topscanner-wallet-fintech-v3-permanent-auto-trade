/**
 * Item 40 — minimal customer feed payload.
 *
 * The customer feed must never expose the raw administrator-managed policy
 * objects. Every field a customer receives must already be a customer-facing
 * scalar (an amount, a rate, a label, a status). These object-valued fields are
 * removed defensively at the router boundary so that a future change at the data
 * source cannot silently re-leak the whole policy structure to the browser.
 */
export const CUSTOMER_FEED_INTERNAL_OBJECT_FIELDS = ["packagePolicy", "packageFeePolicy"] as const;

/**
 * Return a shallow copy of a customer-feed value without any internal
 * object-valued policy field. Non-object and array values are returned as-is.
 */
export function stripCustomerFeedInternalObjects<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const safe: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of CUSTOMER_FEED_INTERNAL_OBJECT_FIELDS) delete safe[field];
  return safe as T;
}
