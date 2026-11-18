/**
 * Administrator-configured wallet funding priority for cross-wallet capital
 * conversion. The saved order decides which source wallets are considered
 * first when a target wallet is short; wallet row locks remain in a separate
 * fixed currency order so funding never deadlocks.
 *
 * Default (never configured): USD first, then the remaining currencies
 * alphabetically. A malformed saved value fails closed — allocation must be
 * blocked rather than silently substituting an order the administrator did not
 * approve.
 */

export const WALLET_FUNDING_PRIORITY_SETTING_KEY = "trade.walletFundingPriority";

/** Default priority: USD first, then every other currency alphabetically. */
export const DEFAULT_WALLET_FUNDING_PRIORITY: readonly string[] = ["USD"];

export const WALLET_FUNDING_PRIORITY_MAX_ENTRIES = 50;
const CURRENCY_PATTERN = /^[A-Z0-9]{2,12}$/;

export type WalletFundingPriorityConfig = {
  order: string[];
  policyVersion: number;
  updatedBy: number | null;
  updatedAt: string | null;
  reason: string;
};

export type WalletFundingPriorityState =
  | { status: "not-configured" }
  | { status: "configured"; config: WalletFundingPriorityConfig }
  | { status: "malformed"; detail: string };

/** Normalizes and validates a proposed order. Returns null when it is invalid. */
export function normalizeWalletFundingPriorityOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > WALLET_FUNDING_PRIORITY_MAX_ENTRIES) return null;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const code = entry.trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(code)) return null;
    if (seen.has(code)) return null;
    seen.add(code);
    order.push(code);
  }
  return order;
}

/**
 * Parses the persisted setting value. An absent value is "not-configured"; an
 * unreadable or shape-invalid value is "malformed" so the caller can fail
 * closed instead of falling back to a default order.
 */
export function parseWalletFundingPriorityState(raw: string | null | undefined): WalletFundingPriorityState {
  if (raw === null || raw === undefined || raw.trim() === "") return { status: "not-configured" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "malformed", detail: "The saved wallet funding priority is not valid JSON." };
  }
  if (!value || typeof value !== "object") {
    return { status: "malformed", detail: "The saved wallet funding priority is not an object." };
  }
  const record = value as Record<string, unknown>;
  const order = normalizeWalletFundingPriorityOrder(record.order);
  if (!order) {
    return { status: "malformed", detail: "The saved wallet funding priority order is invalid." };
  }
  const policyVersion = record.policyVersion;
  if (typeof policyVersion !== "number" || !Number.isSafeInteger(policyVersion) || policyVersion < 1) {
    return { status: "malformed", detail: "The saved wallet funding priority version is invalid." };
  }
  const updatedBy = record.updatedBy;
  if (!(updatedBy === null || (typeof updatedBy === "number" && Number.isSafeInteger(updatedBy) && updatedBy > 0))) {
    return { status: "malformed", detail: "The saved wallet funding priority actor is invalid." };
  }
  const updatedAt = record.updatedAt;
  if (!(updatedAt === null || typeof updatedAt === "string")) {
    return { status: "malformed", detail: "The saved wallet funding priority timestamp is invalid." };
  }
  const reason = typeof record.reason === "string" ? record.reason : "";
  return { status: "configured", config: { order, policyVersion, updatedBy, updatedAt, reason } };
}

export function serializeWalletFundingPriority(config: WalletFundingPriorityConfig): string {
  return JSON.stringify({
    order: [...config.order],
    policyVersion: config.policyVersion,
    updatedBy: config.updatedBy,
    updatedAt: config.updatedAt,
    reason: config.reason,
  });
}

/** The configured order, or null when nothing has been configured. */
export function configuredWalletFundingOrder(state: WalletFundingPriorityState): string[] | null {
  return state.status === "configured" ? [...state.config.order] : null;
}

/**
 * Orders a set of source currencies: configured currencies first in their saved
 * relative order, then every remaining currency alphabetically. When no order
 * is configured, USD comes first and the rest follow alphabetically.
 */
export function resolveWalletFundingOrder(input: { currencies: string[]; order?: string[] | null }): string[] {
  const configured = normalizeWalletFundingPriorityOrder(input.order ?? []) ?? [];
  const priority = configured.length ? configured : [...DEFAULT_WALLET_FUNDING_PRIORITY];
  const rank = new Map<string, number>();
  priority.forEach((code, index) => { if (!rank.has(code)) rank.set(code, index); });
  const fallbackRank = priority.length;
  const unique = [...new Set(input.currencies.map(code => code.trim().toUpperCase()).filter(Boolean))];
  return unique.sort((a, b) => {
    const rankA = rank.has(a) ? rank.get(a)! : fallbackRank;
    const rankB = rank.has(b) ? rank.get(b)! : fallbackRank;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}
