import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const db = read("./db.ts");
const router = read("./routers.ts");
const startup = read("./_core/index.ts");
const ui = read("../client/src/components/AdminOperationsPages.tsx");
const runner = read("../scripts/apply-portal-migrations.mjs");
const installer = read("../installer/migration-recovery-status.mjs");
const journal = JSON.parse(read("../drizzle/meta/_journal.json"));

describe("global Trade timing policy contract", () => {
  it("serializes versioned updates and writes policy plus immutable audit data in one transaction", () => {
    expect(db).toContain('const TRADE_SETTLEMENT_POLICY_VERSION_KEY = "trade.timingPolicyVersion"');
    expect(db).toContain("if (current.policyVersion !== expectedPolicyVersion) throw new TradeTimingPolicyVersionConflictError()");
    expect(db).toContain("await db.transaction(async tx => {");
    expect(db).toContain(".where(inArray(appSettings.settingKey, keys)).for(\"update\")");
    expect(db).toContain('action: "trade_global_timing_policy_updated"');
    expect(db).toContain("reason: auditReason");
    expect(db).toContain("metadataJson: JSON.stringify({ old: current, new: saved })");
    expect(db).toContain("const persisted = await getTradeSettlementPolicy()");
    expect(db).toContain("Trade timing save committed, but a fresh database read did not confirm every value and the new policy version");
  });

  it("keeps the policy read write-free and repairs invalid legacy delay via an explicit maintenance step", () => {
    const readStart = db.indexOf("export async function getTradeSettlementPolicy");
    const readEnd = db.indexOf("export async function repairLegacyTradeSettlementPolicy");
    expect(readStart).toBeGreaterThan(-1);
    expect(readEnd).toBeGreaterThan(readStart);
    const readPath = db.slice(readStart, readEnd);
    // The read path must not write: no transaction, no insert/update, no audit entry.
    expect(readPath).not.toContain(".transaction(");
    expect(readPath).not.toContain("v5AuditEvents");
    expect(readPath).not.toContain(".insert(");
    expect(readPath).not.toContain(".update(");
    expect(readPath).toContain('settings.set("trade.settlementDelaySeconds", "0")');
    expect(readPath).toContain("const rows = db ? await db.select().from(appSettings).where(inArray(appSettings.settingKey, keys)) : [];");

    const repairStart = db.indexOf("export async function repairLegacyTradeSettlementPolicy");
    const repairEnd = db.indexOf('const TRADE_SETTLEMENT_POLICY_VERSION_KEY = "trade.timingPolicyVersion"', repairStart);
    expect(repairEnd).toBeGreaterThan(repairStart);
    const repair = db.slice(repairStart, repairEnd);
    expect(repair).toContain("Invalid persisted settlement review delay repaired to the immediate-settlement default of 0 seconds during the settlement policy maintenance step.");
    expect(repair).toContain('settingKey: "trade.settlementDelaySeconds"');
    expect(repair).toContain('settingValue: "0"');
    expect(repair).toContain('action: "trade_global_timing_policy_repaired"');
    expect(repair).toContain('entityId: "settlement-review-delay"');
    expect(repair).toContain('.limit(1).for("update")');
    expect(repair).toContain("const lockedNumber = Number(lockedValue)");
    expect(repair).toContain("return db.transaction(async tx => {");
    // The explicit maintenance step is wired at server startup, not inside the read.
    expect(startup).toContain("repairLegacyTradeSettlementPolicy()");
  });

  it("requires an administrator reason and expected version at the API boundary", () => {
    expect(router).toContain("reason: z.string().trim().min(5).max(500), expectedPolicyVersion: z.number().int().min(1)");
    expect(router).toContain("input.trade.reason, input.trade.expectedPolicyVersion");
    expect(router).toContain('code: "CONFLICT", message: error.message');
    expect(router).toContain("settlementDelaySeconds: z.number().int().min(0).max(604800)");
    expect(router).toContain("Trade timing settings must be saved on their own.");
  });

  it("shows the audit reason and verifies persisted values plus the incremented version", () => {
    expect(ui).toContain("Reason for this global policy change (required)");
    expect(ui).toContain("reason:tradeReason.trim(),expectedPolicyVersion");
    expect(ui).toContain("Number(stored?.policyVersion)===expectedPolicyVersion+1");
    expect(ui).toContain("fresh server read did not confirm every saved value");
    expect(ui).toContain("hydratedSettings.current");
    expect(ui).toContain('min="0" max="10080"');
  });

  it("registers migration 0099 in the journal, portal runner, and installer recovery list", () => {
    const tag = "0099_trading_global_timing_policy_version";
    expect(journal.entries.some((entry:any) => entry.tag === tag)).toBe(true);
    const timingIndex = journal.entries.findIndex((entry:any) => entry.tag === tag);
    expect(journal.entries[timingIndex + 1]?.tag).toBe("0100_global_trade_master_controls");
    expect(journal.entries[timingIndex + 2]?.tag).toBe("0101_package_fee_policy_versions");
    expect(runner).toContain(`"${tag}.sql"`);
    expect(installer).toContain(`"${tag}.sql"`);
    expect(read("../drizzle/0099_trading_global_timing_policy_version.sql")).toContain("trade.timingPolicyVersion");
  });
});
