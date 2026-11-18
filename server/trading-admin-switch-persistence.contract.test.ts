import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const database = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

/**
 * Item 14 audit: every administrator Trade switch must (a) persist to the
 * database, (b) reload the last saved value through a matching read query, and
 * (c) be read by a runtime consumer that changes behaviour. Behaviour itself is
 * asserted by each switch's own contract/integration suite; this file proves the
 * save + fresh read + runtime-consumer wiring exists for each switch.
 */
describe("administrator Trade switch persistence, reload and runtime consumption", () => {
  it("persists the six delivery masters plus automatic financial execution through one audited, versioned mutation", () => {
    expect(router).toContain("globalTradeControls: adminProcedure.query(() => getTradeGlobalControls())");
    expect(router).toContain("updateGlobalTradeControl: adminProcedure.input");
    expect(router).toContain('"automaticFinancialExecutionEnabled"');
    expect(router).toContain("setTradeGlobalControl(input, ctx.user.id)");
    expect(database).toContain("export async function getTradeGlobalControls():Promise<TradeGlobalControlStatus> {");
    expect(database).toContain("export async function setTradeGlobalControl(input:{key:TradeGlobalControlKey;");
    expect(database).toContain('action:"trade_global_control_updated"');
    expect(database).toContain("TradeGlobalControlVersionConflictError");
    // Runtime consumers: delivery masters and the financial-execution gate.
    expect(database).toContain("if(!globalPolicy?.tierPolicyMasterEnabled) return false;");
    expect(database).toContain("const AUTOMATIC_FINANCIAL_EXECUTION_ENABLED=automaticFinancialExecutionEnabled(globalPolicy);");
    expect(database).toContain('if(!automaticFinancialExecutionEnabled(await getTradeGlobalControls())) throw new Error("Automatic trade allocation is disabled by the administrator");');
  });

  it("persists the new-allocation pause with an audited reason and applies it in the allocation runtime", () => {
    expect(router).toContain("tradeAllocationControls: adminProcedure.query(() => getTradeAllocationControls())");
    expect(router).toContain("updateTradeAllocationControls: adminProcedure.input");
    expect(database).toContain('const TRADE_ALLOCATION_CONTROL_KEY = "trading.allocations.paused";');
    expect(database).toContain('action: input.allocationsPaused ? "trading_new_allocations_paused" : "trading_new_allocations_resumed"');
    expect(database).toContain("if(allocationControls.allocationsPaused) {");
  });

  it("persists the opportunity generation control with a versioned audit and reads it in the generation worker", () => {
    expect(router).toContain("opportunityGenerationControl: adminProcedure.query(() => getOpportunityGenerationControl())");
    expect(router).toContain("updateOpportunityGenerationControl: adminProcedure.input");
    expect(database).toContain('const OPPORTUNITY_GENERATION_CONTROL_KEY="trade.opportunityGeneration.control";');
    expect(database).toContain('action:"automatic_opportunity_generation_control_updated"');
    expect(database).toContain("const generationControl=await getOpportunityGenerationControl();");
  });

  it("persists the shared delivery retry policy with a versioned audit and reloads it", () => {
    expect(router).toContain("deliveryRetryPolicy: adminProcedure.query(() => getDeliveryRetryPolicy())");
    expect(router).toContain("updateDeliveryRetryPolicy: adminProcedure.input");
    expect(database).toContain("DELIVERY_RETRY_POLICY_SETTING_KEY");
    expect(database).toContain("export async function getDeliveryRetryPolicy():Promise<PersistedDeliveryRetryPolicy> {");
    expect(database).toContain("export async function updateDeliveryRetryPolicy(input:{expectedVersion:number;");
    expect(database).toContain("parseDeliveryRetryPolicy");
  });

  it("persists per-tier enabled, automaticDelivery and automaticTradingEnabled and applies them in the delivery runtime", () => {
    expect(router).toContain("updatePackagePolicies: adminProcedure.input");
    expect(database).toContain('action:"trading_tier_financial_execution_enabled"');
    expect(database).toContain("automaticTradingEnabled:true");
    expect(database).toContain("hasConfiguredTradingOfferPolicy");
    expect(database).toContain("globalPolicy.available&&globalPolicy.tierPolicyMasterEnabled&&globalPolicy.informationalPopupDeliveryEnabled");
  });
});
