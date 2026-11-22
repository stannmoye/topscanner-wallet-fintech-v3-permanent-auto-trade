import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminAgroInvestment.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerAgroInvestment.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/agro-investment.css", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/agro-investment-catalogue.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./agroInvestmentDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./agroInvestments.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Agro Investment desk", () => {
  it("exposes one Finance destination that opens the dedicated agriculture console", () => {
    expect(navigation).toContain('id: "agro-investment", target: "agroInvestmentDossiers", label: "Agro Investment"');
    expect(navigation.match(/target: "agroInvestmentDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "agro-investment"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminAgroInvestment = lazy(() => import("@/components/AdminAgroInvestment")');
    expect(app).toContain('section==="agroInvestmentDossiers"&&<Suspense');
    expect(app).toContain("<AdminAgroInvestment/>");
  });

  it("replaces the generic customer placeholder with the live Agro Investment desk", () => {
    expect(app).toContain('const CustomerAgroInvestment = lazy(() => import("@/components/CustomerAgroInvestment")');
    expect(app).toContain('section==="agro-investment"&&<Suspense');
    expect(app).toContain("<CustomerAgroInvestment push={push}/>");
    // The generic placeholder must explicitly exclude agro-investment now.
    expect(app).toContain('item.id!=="music-royalties"&&item.id!=="agro-investment")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "agro-investment"');

    expect(customerUi).toContain("trpc.customer.agroInvestment.market.useQuery");
    // Customers purchase an agriculture opportunity: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.agroInvestment.purchase.useMutation");
    expect(customerUi).not.toContain("agroInvestment.commit");
    expect(customerUi).toContain("idempotencyKey: crypto.randomUUID()");
    // The investment button debits the wallet on submit.
    expect(customerUi).toContain("Confirm & debit wallet");
    expect(customerUi).toContain("Your wallet will be debited on submit");
  });

  it("carries fourteen agriculture-only types — crops, livestock, dairy, aquaculture, land, inputs, agritech and processing", () => {
    expect(catalogue).toContain("export const AGRO_INVESTMENT_TYPES");
    // The 14 agriculture-only types the brief asked for.
    for (const type of [
      '"ROW_CROP"', '"ORCHARD_VINEYARD"', '"LIVESTOCK"', '"DAIRY"', '"POULTRY"', '"AQUACULTURE"',
      '"GREENHOUSE"', '"FARMLAND"', '"IRRIGATION_WATER"', '"FARM_MACHINERY"', '"STORAGE_LOGISTICS"',
      '"AGRI_INPUTS"', '"AGRITECH"', '"AGRI_PROCESSING"',
    ]) expect(catalogue).toContain(type);
    // Grouped once and shared by both UIs.
    expect(catalogue).toContain("export const AGRO_TYPE_GROUPS");
    expect(catalogue).toContain('"Crops & Land"');
    expect(catalogue).toContain('"Livestock & Fisheries"');
    expect(catalogue).toContain('"Infrastructure & Inputs"');
    expect(catalogue).toContain('"Technology & Processing"');
    expect(catalogue).toContain("export const AGRO_SECTORS");
    expect(catalogue).toContain("export const AGRO_STAGES");
    expect(catalogue).toContain("export const AGRO_DOSSIER_STATUSES");
    expect(catalogue).toContain("export const AGRO_RISK_GRADES");
    expect(catalogue).toContain("export const AGRO_OUTCOMES");
    expect(catalogue).toContain("export const AGRO_TERRITORY_BANDS");
    expect(catalogue).toContain("export const AGRO_VALUE_BANDS");
    expect(catalogue).toContain("export function classifyAgroType(");
    // Both desks render the grouped picker / lanes.
    expect(adminUi).toContain("AgroTypeOptions");
    expect(adminUi).toContain("AGRO_TYPE_GROUPS.map");
    expect(customerUi).toContain("AGRO_TYPE_GROUPS.map");
    expect(customerUi).toContain("AGRO_INVESTMENT_TYPES.map");
    // The AI classification and the whole catalogue stay strictly agriculture-only.
    expect(catalogue).toContain("the agriculture-only catalogue");
  });

  it("lets customers invest in crops and land through a dedicated season reel", () => {
    expect(customerUi).toContain('const FIELD_TYPES: AgroInvestmentType[] = ["ROW_CROP", "ORCHARD_VINEYARD", "GREENHOUSE", "FARMLAND"]');
    expect(customerUi).toContain("seasonReel");
    expect(customerUi).toContain('aria-label="Crops and land opportunities"');
    expect(customerUi).toContain("Crops &amp; land");
    // The season tab paginates only fundable crops-and-land opportunities.
    expect(customerUi).toContain('filtered.filter((item) => item.fundable && FIELD_TYPES.includes(item.agroType))');
  });

  it("discovers honest, cited public agriculture data and invents no deal economics", () => {
    expect(catalogue).toContain("export async function getAgroInvestmentCatalogue(");
    expect(catalogue).toContain("export async function findAgroOpportunity(");
    expect(catalogue).toContain("export function buildAgroAnalytics(");
    expect(catalogue).toContain('export const AGRO_DESK_CURRENCY = "USD"');
    expect(catalogue).toContain("export type AgroInvestmentSource");
    expect(catalogue).toContain('status: "ok" | "degraded" | "unavailable"');
    // Discovery drains only the free, keyless World Bank Open Data API; nothing is synthesized.
    expect(catalogue).toContain('const WORLDBANK_BASE = "https://api.worldbank.org/v2"');
    // Discovery contributes cited candidates only: every candidate is fundable:false.
    expect(catalogue).toContain("fundable: false");
    // The shared provider must stay environment-neutral so it also runs as the browser fallback.
    expect(catalogue).not.toContain("process.env");
    expect(catalogue).not.toContain("node:");
    // Every listed opportunity — including a cited reference — is investable, so the
    // invest button is always live; the reference still states its economics are unset.
    expect(customerUi).toContain("Cited catalogue reference — the administrator has not yet published");
    expect(customerUi).toContain("<Coins size={14}/> Invest now");
    expect(customerUi).not.toContain('"Invest now" : "Not open"');
  });

  it("keeps economics admin-sourced: an opportunity is fundable only once a sourced dossier is published", () => {
    expect(catalogue).toContain("export function defaultAgroMilestones(");
    expect(catalogue).toContain('"WRITE_OFF"');
    // Only a FUNDING record with a modelled, sourced funding target is fundable.
    expect(adminUi).toContain('row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome');
    expect(adminUi).toContain("Not modelled — customers can still invest");
    expect(serverDossiers).toContain('"A modelled opportunity must cite its source URL so the economics can be verified"');
  });

  it("stores administrator dossiers additively with an audited lifecycle", () => {
    expect(serverDossiers).toContain('export const AGRO_DOSSIERS_TABLE = "agro_investment_dossiers"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS agro_investment_dossiers");
    expect(serverDossiers).toContain("export function ensureAgroInvestmentDossierSchema()");
    expect(serverDossiers).toContain("export function dossierRowToOpportunity(");
    expect(serverDossiers).toContain('"agro_dossier_created"');
    expect(serverDossiers).toContain('"agro_dossier_updated"');
    expect(serverDossiers).toContain('"agro_dossier_enabled"');
    expect(serverDossiers).toContain('"agro_dossier_disabled"');
    expect(serverDossiers).toContain('"agro_dossier_status_changed"');
    expect(serverDossiers).toContain('"agro_milestone_reached"');
    expect(serverDossiers).toContain('"agro_dossier_deleted"');
    expect(serverDossiers).toContain('"agro_investment_dossier"');
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
    // Administrator-entered weights are integer basis points and are validated to sum to 100%.
    expect(serverDossiers).toContain("Scenario probabilities must sum to exactly 100%");
    expect(serverDossiers).toContain("Milestone release weights must sum to exactly 100% of escrow");
  });

  it("records a funded position through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const AGRO_POSITIONS_TABLE = "agro_investment_positions"');
    expect(serverDesk).toContain("export function ensureAgroInvestmentSchema()");
    expect(serverDesk).toContain('"agro_investment_purchase"');
    expect(serverDesk).toContain('"agro_investment_distribution"');
    expect(serverDesk).toContain('"agro_investment_payout"');
    expect(serverDesk).toContain("SELECT resultJson");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("v5_idempotency_keys");
    // The purchase debits the customer wallet through the guarded balance UPDATE.
    expect(serverDesk).toContain("lockedMinor=lockedMinor+?");
    expect(serverDesk).toContain("INSERT INTO customer_balances");
    // Every listed opportunity is investable: a cited discovery reference resolves on
    // its own record instead of being rejected as "not open for investment".
    expect(serverDesk).toContain("instrumentId: discovery.id");
    expect(serverDesk).not.toContain("so it is not open for investment");
  });

  it("funds a position from any single wallet or the combined balance of every wallet, failing closed", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const AGRO_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain('"agro_investment_fx_debit"');
    expect(serverDesk).toContain('"agro_investment_fx_credit"');
    // Missing or insufficient FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
  });

  it("credits distributions pro-rata and lets an administrator settle or write off an instrument", () => {
    // The desk lists instruments that still carry open positions, for the settlement console.
    expect(serverDesk).toContain("export type AgroOpenInstrument");
    expect(serverDesk).toContain("export async function listAgroOpenInstruments(");
    expect(serverDesk).toContain("WHERE outcome IS NULL");
    expect(serverDesk).toContain("GROUP BY instrumentId");
    // A distribution is credited pro-rata to every open position.
    expect(serverDesk).toContain("export async function recordAgroDistribution(");
    expect(serverDesk).toContain('"agro_investment_distribution"');
    // Settlement pays principal × multiple or writes it off, releasing locked principal.
    expect(serverDesk).toContain("export async function settleAgroInstrument(");
    expect(serverDesk).toContain("outcome IS NULL FOR UPDATE");
    expect(serverDesk).toContain("lockedMinor=GREATEST(0, lockedMinor-?)");
    expect(serverDesk).toContain('"agro_investment_payout"');
    // The admin console exposes the distribution + settlement console calling the new endpoints.
    expect(adminUi).toContain("trpc.adminOperations.agroOpenInstruments.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.recordAgroDistribution.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.settleAgroInstrument.useMutation");
    expect(adminUi).toContain("Settle &amp; write off");
    expect(adminUi).toContain("Funder multiple (×)");
  });

  it("gives the admin console a type picker, derived flags and the full agriculture taxonomy", () => {
    expect(adminUi).toContain("trpc.adminOperations.agroDossiers.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createAgroDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateAgroDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setAgroDossierEnabled.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setAgroDossierStatus.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.reachAgroMilestone.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.deleteAgroDossier.useMutation");
    // The country flag is derived from the selected country, never typed by the admin.
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    // Scenario probabilities and milestone releases are entered as percentages and stored as bps.
    expect(adminUi).toContain("probabilityBps: toBpsFromPercent(item.probabilityPercent)");
    expect(adminUi).toContain("releaseBps: toBpsFromPercent(item.releasePercent)");
    expect(adminUi).toContain("AGRO_SECTORS");
    expect(adminUi).toContain("AGRO_STAGES");
    expect(adminUi).toContain("AGRO_DOSSIER_STATUSES");
    expect(adminUi).toContain("AGRO_RISK_GRADES");
    expect(adminUi).toContain("AGRO_OUTCOMES");
    expect(adminUi).toContain("AGRO_TERRITORY_BANDS");
  });

  it("gives the customer desk pagination plus sector, type, status, stage, risk and territory filters", () => {
    expect(customerUi).toContain("const PAGE_SIZES = [6, 12, 24]");
    expect(customerUi).toContain("ag-pagination");
    expect(customerUi).toContain("Previous</button>");
    expect(customerUi).toContain("Page {currentPage} of {pageCount}");
    expect(customerUi).toContain("const pageRows = scoped.slice(");
    expect(customerUi).toContain("AGRO_SECTORS.map");
    expect(customerUi).toContain("AGRO_STAGES.map");
    expect(customerUi).toContain("AGRO_RISK_GRADES.map");
    expect(customerUi).toContain("AGRO_TERRITORY_BANDS.map");
    expect(customerUi).toContain("fundableOnly");
    expect(customerUi).toContain("watchlistOnly");
    // Extra features: watchlist, CSV export and a live funding quote.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("function downloadCsv(");
    expect(customerUi).toContain("utils.customer.agroInvestment.fundingQuote.fetch");
    expect(customerUi).toContain("ag-funding-option");
    expect(customerUi).toContain("Combined balance");
    // The distinct hero identity plus the modelled scenarios are rendered.
    expect(customerUi).toContain('className="ag-hero"');
    expect(customerUi).toContain('className="ag-scenarios"');
  });

  it("blends the desk into the portal theme instead of owning a fixed palette", () => {
    expect(customerUi).toContain('import "./agro-investment.css"');
    expect(adminUi).toContain('import "./agro-investment.css"');
    // Surfaces, borders, text, headings, gold, red and water all derive from the
    // active portal theme tokens so the desk blends with every theme (incl. light).
    expect(styles).toContain("--ag-surface: var(--arb-color-surface)");
    expect(styles).toContain("--ag-surface-2: var(--arb-color-surface-raised)");
    expect(styles).toContain("--ag-white: var(--arb-color-text)");
    expect(styles).toContain("--ag-muted: var(--arb-color-text-muted)");
    expect(styles).toContain("--ag-water: var(--arb-color-info)");
    expect(styles).toContain("--ag-gold: var(--arb-color-warning)");
    expect(styles).toContain("--ag-red: var(--arb-color-danger)");
    expect(styles).toContain("--ag-green-heading: var(--arb-color-accent)");
    expect(styles).toContain("color-mix(in srgb, var(--arb-color-border)");
    // The page background is the theme canvas, not an opaque fixed navy island.
    expect(styles).toContain("var(--arb-color-canvas)");
    // The desk must not re-introduce its own fixed navy palette.
    expect(styles).not.toContain("--ag-navy-950");
    // Green section headings, a gold investment button and its own spinner.
    expect(styles).toContain(".ag-section-head h2");
    expect(styles).toContain(".ag-title");
    expect(styles).toContain(".ag-btn--invest");
    expect(styles).toContain("@keyframes ag-spin");
    expect(styles).toContain(".ag-btn--danger");
    // The gold investment button uses the theme's on-colour for contrast.
    expect(styles).toContain("color: var(--arb-color-canvas)");
  });

  it("ships the desk artwork as self-contained inline SVG so the images always load", () => {
    // The season and lane imagery is embedded in the bundle as SVG data URIs,
    // so it never depends on an authenticated external image service that
    // fails in production and leaves broken <img> elements.
    expect(customerUi).toContain("data:image/svg+xml");
    expect(customerUi).toContain("const agArt = (body: string)");
    expect(customerUi).not.toContain("core-normal.trae.ai");
    expect(customerUi).not.toContain("text_to_image");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain('import { getAgroInvestmentDashboard, listAgroOpenInstruments, purchaseAgroOpportunity, quoteAgroPurchase, recordAgroDistribution, settleAgroInstrument } from "./agroInvestments";');
    expect(serverRouters).toContain("agroInvestment: router({");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getAgroInvestmentDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain('title: "Agro Investment recorded"');
    expect(serverRouters).toContain("agroDossiers: adminProcedure.query(() => listAdminAgroDossiers())");
    expect(serverRouters).toContain("createAgroDossier: adminProcedure.input(createAgroDossierSchema).mutation");
    expect(serverRouters).toContain("updateAgroDossier: adminProcedure.input(updateAgroDossierSchema).mutation");
    expect(serverRouters).toContain("setAgroDossierEnabled: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("setAgroDossierStatus: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("reachAgroMilestone: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("deleteAgroDossier: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("agroOpenInstruments: adminProcedure.query(() => listAgroOpenInstruments())");
    expect(serverRouters).toContain("recordAgroDistribution: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("settleAgroInstrument: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("mutation(({ ctx, input }) => settleAgroInstrument(ctx.user!.id, input))");
    // The 14-value agriculture-only type enum plus the bounded scenario/milestone arrays.
    expect(serverRouters).toContain('agroType: z.enum(["ROW_CROP", "ORCHARD_VINEYARD", "LIVESTOCK", "DAIRY", "POULTRY", "AQUACULTURE", "GREENHOUSE", "FARMLAND", "IRRIGATION_WATER", "FARM_MACHINERY", "STORAGE_LOGISTICS", "AGRI_INPUTS", "AGRITECH", "AGRI_PROCESSING"])');
    expect(serverRouters).toContain("scenarios: z.array(agroScenarioSchema).max(3).nullable().optional()");
    expect(serverRouters).toContain("milestones: z.array(agroMilestoneSchema).max(10).nullable().optional()");
  });
});
