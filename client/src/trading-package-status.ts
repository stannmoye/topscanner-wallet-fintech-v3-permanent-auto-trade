export type TradingPackageLifecycleRow = {
  enabled?: unknown;
  expiresAt?: Date | string | null;
  archived?: unknown;
  archivedAt?: Date | string | null;
};

/** Counts package lifecycle state, not the separate informational-delivery policy flag. */
export function isEnabledTradingPackage(row: TradingPackageLifecycleRow, now: Date | number = Date.now()): boolean {
  if (row.enabled !== true && row.enabled !== 1) return false;
  if (row.archived === true || row.archived === 1 || row.archivedAt != null) return false;
  if (row.expiresAt == null) return true;
  const expiry = row.expiresAt instanceof Date ? row.expiresAt.getTime() : new Date(row.expiresAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(expiry) && Number.isFinite(nowMs) && expiry > nowMs;
}

export function countEnabledTradingPackages(
  rows: readonly TradingPackageLifecycleRow[],
  now: Date | number = Date.now(),
): number {
  return rows.reduce((count, row) => count + (isEnabledTradingPackage(row, now) ? 1 : 0), 0);
}
