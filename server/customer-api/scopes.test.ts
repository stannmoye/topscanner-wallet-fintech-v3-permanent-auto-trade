import { describe, expect, it } from "vitest";
import {
  ApiScopeError,
  ALL_SCOPES,
  READ_SCOPES,
  SCOPE_DESCRIPTIONS,
  WRITE_SCOPES,
  hasScope,
  isKnownScope,
  normalizeStoredScopes,
  validateIssuableScopes,
} from "./scopes";

describe("customer API scope registry", () => {
  it("knows every declared read and write scope", () => {
    for (const scope of ALL_SCOPES) {
      expect(isKnownScope(scope)).toBe(true);
      expect(SCOPE_DESCRIPTIONS[scope]).toBeTruthy();
    }
    expect(isKnownScope("wallets:delete")).toBe(false);
    expect(isKnownScope(42)).toBe(false);
  });

  it("issues read scopes for a new key", () => {
    expect(validateIssuableScopes(["wallets:read", "ledger:read"])).toEqual(["wallets:read", "ledger:read"]);
  });

  it("rejects unknown, duplicate, empty and phase-2 scopes", () => {
    expect(() => validateIssuableScopes([])).toThrow(ApiScopeError);
    expect(() => validateIssuableScopes("wallets:read")).toThrow(ApiScopeError);
    expect(() => validateIssuableScopes(["nope:read"])).toThrow(/Unknown scope/);
    expect(() => validateIssuableScopes(["wallets:read", "wallets:read"])).toThrow(/Duplicate scope/);
    for (const writeScope of WRITE_SCOPES) {
      expect(() => validateIssuableScopes([writeScope])).toThrow(/not available yet/);
    }
  });

  it("filters stored scopes to the recognised ones and checks grants", () => {
    expect(normalizeStoredScopes(["wallets:read", "bogus", 7])).toEqual(["wallets:read"]);
    expect(normalizeStoredScopes("not-an-array")).toEqual([]);
    expect(hasScope(["wallets:read"], "wallets:read")).toBe(true);
    expect(hasScope(["wallets:read"], "payouts:read")).toBe(false);
    expect(READ_SCOPES).not.toContain("payouts:write");
  });
});
