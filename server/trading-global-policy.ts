export const TRADE_GLOBAL_CONTROL_SETTINGS_KEY = "trade.globalControls";
export const TRADE_GLOBAL_CONTROL_MIGRATION_DIAGNOSTIC_KEY = "trade.globalControls.migrationDiagnostic";

export const TRADE_GLOBAL_MASTER_KEYS = [
  "tierPolicyMasterEnabled",
  "informationalPopupDeliveryEnabled",
  "companyRotationEnabled",
  "randomizedTimingEnabled",
  "burstDeliveryEnabled",
  "requirePreviousSettlement",
] as const;

/**
 * The automatic financial-execution gate lives in the same persisted
 * `trade.globalControls` record as the six delivery masters. It was added after
 * those masters, so rows written before it existed omit the key; the parser
 * treats a missing value as ON (today's behaviour) and only an explicit OFF or
 * an unreadable/malformed policy blocks automatic execution.
 */
export const TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY = "automaticFinancialExecutionEnabled" as const;

/** Every persisted global Trade control, including the financial-execution gate. */
export const TRADE_GLOBAL_CONTROL_KEYS = [
  ...TRADE_GLOBAL_MASTER_KEYS,
  TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY,
] as const;

export type TradeGlobalMasterKey = typeof TRADE_GLOBAL_MASTER_KEYS[number];
export type TradeGlobalControlKey = typeof TRADE_GLOBAL_CONTROL_KEYS[number];
export type TradeGlobalMasterValues = Record<TradeGlobalMasterKey, boolean>;
export type TradeGlobalControlValues = TradeGlobalMasterValues & Record<typeof TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY, boolean>;
export type TradeGlobalControlPolicy = TradeGlobalControlValues & {
  policyVersion: number;
  updatedBy: number | null;
  updatedAt: string | null;
};
export type TradeGlobalControlStatus = TradeGlobalControlPolicy & {
  available: boolean;
  migrationDiagnostic: Record<string, unknown> | null;
};

export const FAIL_CLOSED_TRADE_GLOBAL_CONTROLS: TradeGlobalControlValues = {
  tierPolicyMasterEnabled: false,
  informationalPopupDeliveryEnabled: false,
  companyRotationEnabled: false,
  randomizedTimingEnabled: false,
  burstDeliveryEnabled: false,
  requirePreviousSettlement: true,
  automaticFinancialExecutionEnabled: false,
};

export type LegacyPackageControlRow = {
  packageName: string;
  policyEnabled: boolean;
  automaticDelivery: boolean;
  companyRotationEnabled: boolean;
  randomizationEnabled: boolean;
  burstEnabled: boolean;
  requirePreviousSettlement: boolean;
};

export type LegacyControlMigrationPreview = {
  policy: TradeGlobalMasterValues;
  sourcePolicyCount: number;
  offPackages: Record<TradeGlobalMasterKey, string[]>;
  conflicts: Record<TradeGlobalMasterKey, boolean>;
};

/**
 * Mirrors migration 0100's restrictive precedence. An existing false on any
 * legacy copy keeps the corresponding global master OFF until an
 * administrator explicitly changes it. Package lifecycle `packages.enabled`
 * remains a separate per-tier gate. The previous-settlement prerequisite is
 * seeded ON globally; only an authorized, reasoned global-policy update may
 * change it after migration.
 */
export function previewLegacyTradeGlobalControls(rows: readonly LegacyPackageControlRow[]): LegacyControlMigrationPreview {
  const deliveryKeys = [
    ["informationalPopupDeliveryEnabled", "automaticDelivery"],
    ["companyRotationEnabled", "companyRotationEnabled"],
    ["randomizedTimingEnabled", "randomizationEnabled"],
    ["burstDeliveryEnabled", "burstEnabled"],
  ] as const;
  const policy: TradeGlobalMasterValues = {
    tierPolicyMasterEnabled: rows.length > 0 && rows.every(row => row.policyEnabled === true),
    informationalPopupDeliveryEnabled: rows.length > 0 && rows.every(row => row.automaticDelivery === true),
    companyRotationEnabled: rows.length > 0 && rows.every(row => row.companyRotationEnabled === true),
    randomizedTimingEnabled: rows.length > 0 && rows.every(row => row.randomizationEnabled === true),
    burstDeliveryEnabled: rows.length > 0 && rows.every(row => row.burstEnabled === true),
    requirePreviousSettlement: true,
  };
  const offPackages = {} as LegacyControlMigrationPreview["offPackages"];
  const conflicts = {} as LegacyControlMigrationPreview["conflicts"];
  offPackages.tierPolicyMasterEnabled = rows.filter(row => row.policyEnabled === false).map(row => row.packageName).sort();
  conflicts.tierPolicyMasterEnabled = rows.some(row => row.policyEnabled === false) && rows.some(row => row.policyEnabled === true);
  for (const [masterKey, legacyKey] of deliveryKeys) {
    offPackages[masterKey] = rows.filter(row => row[legacyKey] === false).map(row => row.packageName).sort();
    conflicts[masterKey] = rows.some(row => row[legacyKey] === false) && rows.some(row => row[legacyKey] === true);
  }
  offPackages.requirePreviousSettlement = rows.filter(row => row.requirePreviousSettlement === false).map(row => row.packageName).sort();
  conflicts.requirePreviousSettlement = rows.some(row => row.requirePreviousSettlement === false) && rows.some(row => row.requirePreviousSettlement === true);
  return { policy, sourcePolicyCount: rows.length, offPackages, conflicts };
}

export function parseTradeGlobalControlPolicy(raw: unknown): TradeGlobalControlPolicy | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (TRADE_GLOBAL_MASTER_KEYS.some(key => typeof record[key] !== "boolean")) return null;
  // Backward compatibility: the financial-execution gate was added after the
  // original six masters. A row without it keeps automatic execution ON (the
  // previous hard-coded behaviour); a present but non-boolean value is malformed.
  const financialRaw = record[TRADE_GLOBAL_FINANCIAL_EXECUTION_KEY];
  if (financialRaw !== undefined && typeof financialRaw !== "boolean") return null;
  const automaticFinancialExecutionEnabled = financialRaw === undefined ? true : (financialRaw as boolean);
  const policyVersion = Number(record.policyVersion);
  if (!Number.isSafeInteger(policyVersion) || policyVersion < 1) return null;
  const updatedBy = record.updatedBy === null || record.updatedBy === undefined ? null : Number(record.updatedBy);
  if (updatedBy !== null && (!Number.isSafeInteger(updatedBy) || updatedBy < 1)) return null;
  const updatedAt = record.updatedAt === null || record.updatedAt === undefined ? null : String(record.updatedAt);
  return {
    tierPolicyMasterEnabled: record.tierPolicyMasterEnabled as boolean,
    informationalPopupDeliveryEnabled: record.informationalPopupDeliveryEnabled as boolean,
    companyRotationEnabled: record.companyRotationEnabled as boolean,
    randomizedTimingEnabled: record.randomizedTimingEnabled as boolean,
    burstDeliveryEnabled: record.burstDeliveryEnabled as boolean,
    requirePreviousSettlement: record.requirePreviousSettlement as boolean,
    automaticFinancialExecutionEnabled,
    policyVersion,
    updatedBy,
    updatedAt,
  };
}

/**
 * Missing or malformed global policy fails closed. A valid saved OFF value
 * bypasses only the prior-unsettled-trade prerequisite for future allocations.
 */
export function requiresPreviousSettlementForAllocation(controls?: TradeGlobalControlStatus | TradeGlobalMasterValues | null): boolean {
  if (!controls) return true;
  if ("available" in controls && controls.available !== true) return true;
  return controls.requirePreviousSettlement !== false;
}

/**
 * Automatic financial execution fails closed. A missing, unavailable or
 * malformed global policy returns false, and so does an explicit OFF. Only an
 * explicit ON read from the persisted policy allows an automatic capital lock.
 */
export function automaticFinancialExecutionEnabled(controls?: TradeGlobalControlStatus | TradeGlobalControlValues | null): boolean {
  if (!controls) return false;
  if ("available" in controls && controls.available !== true) return false;
  return controls.automaticFinancialExecutionEnabled === true;
}
