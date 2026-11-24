/**
 * Customer API v1 — scope registry.
 *
 * Scopes are the least-privilege grants attached to an API key. They are
 * validated server-side against this fixed allowlist; unknown scopes are
 * rejected at key creation, so a caller can never widen its own access.
 *
 * Phase 1 issues read scopes only. The write scopes are declared here so the
 * registry is the single place that knows the full vocabulary (stored keys are
 * re-validated against it), but `validateIssuableScopes` refuses to issue them
 * until the guarded write endpoints ship.
 */

export const READ_SCOPES = [
  "wallets:read",
  "ledger:read",
  "trading:read",
  "positions:read",
  "payouts:read",
  "kyc:read",
  "notifications:read",
  "support:read",
] as const;

export const WRITE_SCOPES = [
  "support:write",
  "payouts:write",
  "positions:write",
] as const;

export const ALL_SCOPES = [...READ_SCOPES, ...WRITE_SCOPES] as const;

export type ApiScope = (typeof ALL_SCOPES)[number];
export type ApiReadScope = (typeof READ_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "wallets:read": "Balances, per-currency wallets and FX rates",
  "ledger:read": "Wallet ledger history",
  "trading:read": "Trades and opportunity history",
  "positions:read": "Investment-module positions across every desk",
  "payouts:read": "Payout requests and their status",
  "kyc:read": "KYC status and stages (no document contents)",
  "notifications:read": "Notification history",
  "support:read": "Support tickets and their messages",
  "support:write": "Create tickets and reply (phase 2 — not issued yet)",
  "payouts:write": "Request or cancel payouts (phase 2 — not issued yet)",
  "positions:write": "Module purchases and bids (phase 2 — not issued yet)",
};

const ALL_SCOPE_SET = new Set<string>(ALL_SCOPES);
const READ_SCOPE_SET = new Set<string>(READ_SCOPES);

/** Raised when a caller supplies an unknown, duplicate or not-yet-issuable scope. */
export class ApiScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiScopeError";
  }
}

/** True when the value is a scope this platform recognises (read or write). */
export function isKnownScope(value: unknown): value is ApiScope {
  return typeof value === "string" && ALL_SCOPE_SET.has(value);
}

/** Narrow a stored, trusted scope list to the recognised scopes. */
export function normalizeStoredScopes(value: unknown): ApiScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isKnownScope);
}

/**
 * Validate a scope list for a NEW key. Rejects unknown scopes, duplicates, an
 * empty selection, and phase-2 write scopes (which are not issuable in v1).
 */
export function validateIssuableScopes(input: unknown): ApiReadScope[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiScopeError("Select at least one scope for the key.");
  }
  const seen = new Set<string>();
  const result: ApiReadScope[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !ALL_SCOPE_SET.has(raw)) {
      throw new ApiScopeError(`Unknown scope: ${typeof raw === "string" ? raw : "(non-string)"}`);
    }
    if (seen.has(raw)) {
      throw new ApiScopeError(`Duplicate scope: ${raw}`);
    }
    seen.add(raw);
    if (!READ_SCOPE_SET.has(raw)) {
      throw new ApiScopeError(`Scope ${raw} is not available yet. Only read scopes can be issued in v1.`);
    }
    result.push(raw as ApiReadScope);
  }
  return result;
}

/** True when the granted scope list satisfies the required scope. */
export function hasScope(granted: readonly string[], required: ApiScope): boolean {
  return granted.includes(required);
}
