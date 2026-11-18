import { describe, expect, it } from "vitest";
import {
  FAIL_CLOSED_TRADE_GLOBAL_CONTROLS,
  TRADE_GLOBAL_CONTROL_KEYS,
  TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY,
  automaticFinancialExecutionEnabled,
  parseTradeGlobalControlPolicy,
  type TradeGlobalControlStatus,
} from "./trading-global-policy";

/** Minimal valid legacy record: the six delivery masters plus a policy version. */
function legacyPolicy(overrides: Record<string, unknown> = {}) {
  return {
    tierPolicyMasterEnabled: true,
    informationalPopupDeliveryEnabled: true,
    companyRotationEnabled: true,
    randomizedTimingEnabled: true,
    burstDeliveryEnabled: true,
    requirePreviousSettlement: false,
    policyVersion: 1,
    updatedBy: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("automatic financial execution global control", () => {
  it("registers the financial-execution key among every persisted global control", () => {
    expect(TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY).toBe("automaticFinancialExecutionEnabled");
    expect(TRADE_GLOBAL_CONTROL_KEYS).toContain(TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY);
    expect(FAIL_CLOSED_TRADE_GLOBAL_CONTROLS.automaticFinancialExecutionEnabled).toBe(false);
  });

  it("defaults the switch ON for a legacy record that predates the key", () => {
    const parsed = parseTradeGlobalControlPolicy(legacyPolicy());
    expect(parsed).not.toBeNull();
    expect(parsed?.automaticFinancialExecutionEnabled).toBe(true);
  });

  it("honours an explicit boolean and rejects a non-boolean value as malformed", () => {
    expect(parseTradeGlobalControlPolicy(legacyPolicy({ automaticFinancialExecutionEnabled: false }))?.automaticFinancialExecutionEnabled).toBe(false);
    expect(parseTradeGlobalControlPolicy(legacyPolicy({ automaticFinancialExecutionEnabled: true }))?.automaticFinancialExecutionEnabled).toBe(true);
    expect(parseTradeGlobalControlPolicy(legacyPolicy({ automaticFinancialExecutionEnabled: "true" }))).toBeNull();
    expect(parseTradeGlobalControlPolicy(legacyPolicy({ automaticFinancialExecutionEnabled: 1 }))).toBeNull();
  });

  it("still rejects a record missing one of the six required delivery masters", () => {
    const record = legacyPolicy();
    delete (record as Record<string, unknown>).burstDeliveryEnabled;
    expect(parseTradeGlobalControlPolicy(record)).toBeNull();
  });

  it("fails closed when the policy is missing, unavailable or malformed", () => {
    expect(automaticFinancialExecutionEnabled(null)).toBe(false);
    expect(automaticFinancialExecutionEnabled(undefined)).toBe(false);
    const unavailable: TradeGlobalControlStatus = { ...FAIL_CLOSED_TRADE_GLOBAL_CONTROLS, policyVersion: 1, updatedBy: null, updatedAt: null, available: false, migrationDiagnostic: null };
    expect(automaticFinancialExecutionEnabled(unavailable)).toBe(false);
  });

  it("allows automatic execution only for an available record whose value is ON", () => {
    const on: TradeGlobalControlStatus = { ...legacyPolicy({ automaticFinancialExecutionEnabled: true }), available: true, migrationDiagnostic: null } as TradeGlobalControlStatus;
    const off: TradeGlobalControlStatus = { ...legacyPolicy({ automaticFinancialExecutionEnabled: false }), available: true, migrationDiagnostic: null } as TradeGlobalControlStatus;
    expect(automaticFinancialExecutionEnabled(on)).toBe(true);
    expect(automaticFinancialExecutionEnabled(off)).toBe(false);
  });
});
