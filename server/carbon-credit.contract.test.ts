import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminCarbonCredit.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerCarbonCredit.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/carbon-credit.css", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/carbon-credit-catalogue.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./carbonCreditDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./carbonCredits.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Carbon Credit desk", () => {
  it("exposes one Finance destination that opens the dedicated carbon console", () => {
    expect(navigation).toContain('id: "carbon-credit", target: "carbonCreditDossiers", label: "Carbon Credit"');
    expect(navigation.match(/target: "carbonCreditDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "carbon-credit"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminCarbonCredit = lazy(() => import("@/components/AdminCarbonCredit")');
    expect(app).toContain('section==="carbonCreditDossiers"&&<Suspense');
    expect(app).toContain("<AdminCarbonCredit/>");
  });

  it("replaces the generic customer placeholder with the live Carbon Credit desk", () => {
    expect(app).toContain('const CustomerCarbonCredit = lazy(() => import("@/components/CustomerCarbonCredit")');
    expect(app).toContain('section==="carbon-credit"&&<Suspense');
    expect(app).toContain("<CustomerCarbonCredit push={push}/>");
    // The generic placeholder must explicitly exclude carbon-credit now.
    expect(app).toContain('item.id!=="carbon-credit")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "carbon-credit"');

    expect(customerUi).toContain("trpc.customer.carbonCredit.market.useQuery");
    // Customers purchase a carbon opportunity: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.carbonCredit.purchase.useMutation");
    expect(customerUi).not.toContain("carbonCredit.commit");
    expect(customerUi).toContain("idempotencyKey: crypto.randomUUID()");
  });

  it("carries fourteen carbon-only types — nature-based, removals, waste, energy and industry", () => {
    expect(catalogue).toContain("export const CARBON_CREDIT_TYPES");
    // The 14 carbon-only types the brief asked for.
    for (const type of [
      '"REFORESTATION"', '"FOREST_CONSERVATION"', '"SOIL_CARBON"', '"BLUE_CARBON"', '"COOKSTOVES"', '"BIOCHAR"',
      '"DIRECT_AIR_CAPTURE"', '"BECCS"', '"ENHANCED_WEATHERING"', '"OCEAN_ALKALINITY"', '"RENEWABLE_ENERGY"',
      '"METHANE_CAPTURE"', '"WASTE_MANAGEMENT"', '"INDUSTRIAL_EFFICIENCY"',
    ]) expect(catalogue).toContain(type);
    // Grouped once and shared by both UIs.
    expect(catalogue).toContain("export const CARBON_TYPE_GROUPS");
    expect(catalogue).toContain('"Nature-based"');
    expect(catalogue).toContain('"Community & waste"');
    expect(catalogue).toContain('"Engineered removals"');
    expect(catalogue).toContain('"Energy & industry"');
    expect(catalogue).toContain("export const CARBON_SECTORS");
    expect(catalogue).toContain("export const CARBON_STANDARDS");
    expect(catalogue).toContain("export const CARBON_STAGES");
    expect(catalogue).toContain("export const CARBON_DOSSIER_STATUSES");
    expect(catalogue).toContain("export const CARBON_RISK_GRADES");
    expect(catalogue).toContain("export const CARBON_OUTCOMES");
    expect(catalogue).toContain("export const CARBON_TERRITORY_BANDS");
    expect(catalogue).toContain("export const CARBON_VALUE_BANDS");
    expect(catalogue).toContain("export function classifyCarbonType(");
    // Both desks render the grouped picker / atlas filters.
    expect(adminUi).toContain("CarbonTypeOptions");
    expect(adminUi).toContain("CARBON_TYPE_GROUPS.map");
    expect(customerUi).toContain("CARBON_TYPE_GROUPS.map");
    expect(customerUi).toContain("CARBON_CREDIT_TYPES.length");
    // The AI classification and the whole catalogue stay strictly carbon-only.
    expect(catalogue).toContain("the carbon-only catalogue");
  });

  it("discovers honest, cited public carbon data and invents no deal economics", () => {
    expect(catalogue).toContain("export async function getCarbonInvestmentCatalogue(");
    expect(catalogue).toContain("export async function findCarbonOpportunity(");
    expect(catalogue).toContain("export function buildCarbonAnalytics(");
    expect(catalogue).toContain('export const CARBON_DESK_CURRENCY = "USD"');
    expect(catalogue).toContain("export type CarbonInvestmentSource");
    expect(catalogue).toContain('status: "ok" | "degraded" | "unavailable"');
    // Discovery drains two free, keyless public carbon feeds; nothing is synthesized.
    expect(catalogue).toContain('const WORLDBANK_BASE = "https://api.worldbank.org/v2"');
    expect(catalogue).toContain('const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"');
    expect(catalogue).toContain('export const CARBON_EUROSTAT_DATASETS = EUROSTAT_DATASETS');
    // The two providers are drained concurrently and degrade independently, so a block
    // at one still leaves the other's cited references on the desk.
    expect(catalogue).toContain("Promise.allSettled");
    expect(catalogue).toContain('name: "Eurostat (ESTAT)"');
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
    expect(catalogue).toContain("export function defaultCarbonMilestones(");
    expect(catalogue).toContain('"WRITE_OFF"');
    // Only a FUNDING record with a modelled, sourced funding target is fundable.
    expect(adminUi).toContain('row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome');
    expect(adminUi).toContain("Not modelled — customers can still invest");
    expect(serverDossiers).toContain('"A modelled opportunity must cite its source URL so the economics can be verified"');
  });

  it("lets a customer invest straight from a pin-board card and states the investable amount and projected profit", () => {
    // The Invest button lives on every pin-board card, not only inside the dossier,
    // so a customer can purchase without first opening a project.
    expect(customerUi).toContain('className="cc-pin-card-invest"');
    expect(customerUi).toContain('className="cc-pin-card-econ"');
    // The card states the amount that can be invested and the profit it realises.
    expect(customerUi).toContain("You can invest from");
    expect(customerUi).toContain("Projected profit on");
    // The dossier stats repeat both figures for the selected project.
    expect(customerUi).toContain("<span>You can invest from</span>");
    expect(customerUi).toContain("<span>Projected profit at minimum</span>");
    // The purchase modal shows the projected return and profit for the chosen amount.
    expect(customerUi).toContain('className="cc-invest-figures"');
    expect(customerUi).toContain("Projected profit you will realise");
    expect(styles).toContain(".cc-pin-card-invest");
    expect(styles).toContain(".cc-profit");
  });

  it("reads the customer's existing wallets without a cross-collation join", () => {
    // customer_balances inherits the database-default collation while
    // currency_registry is pinned to utf8mb4_unicode_ci, so a SQL JOIN on
    // currency=code fails with "Illegal mix of collations". The desk reads the
    // two separately — through the platform's own wallet readers — and merges in
    // code, so the existing wallets always load (and never hide behind the
    // desk's own position store).
    expect(serverDesk).toContain("listBalances(userId)");
    expect(serverDesk).toContain("listCurrencies()");
    expect(serverDesk).not.toContain("JOIN currency_registry");
    expect(serverDesk).not.toContain("LEFT JOIN customer_balances");
    expect(serverDesk).toContain("Failed to read wallet balances");
    expect(serverDesk).toContain("Failed to read position store");
    expect(serverDesk).toContain("could not be loaded right now. The live catalogue below is unaffected.");
  });

  it("stores administrator dossiers additively with an audited lifecycle", () => {
    expect(serverDossiers).toContain('export const CARBON_DOSSIERS_TABLE = "carbon_credit_dossiers"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS carbon_credit_dossiers");
    expect(serverDossiers).toContain("export function ensureCarbonCreditDossierSchema()");
    expect(serverDossiers).toContain("export function dossierRowToOpportunity(");
    expect(serverDossiers).toContain('"carbon_dossier_created"');
    expect(serverDossiers).toContain('"carbon_dossier_updated"');
    expect(serverDossiers).toContain('"carbon_dossier_enabled"');
    expect(serverDossiers).toContain('"carbon_dossier_disabled"');
    expect(serverDossiers).toContain('"carbon_dossier_status_changed"');
    expect(serverDossiers).toContain('"carbon_milestone_reached"');
    expect(serverDossiers).toContain('"carbon_dossier_deleted"');
    expect(serverDossiers).toContain('"carbon_credit_dossier"');
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
    // Administrator-entered weights are integer basis points and are validated to sum to 100%.
    expect(serverDossiers).toContain("Scenario probabilities must sum to exactly 100%");
    expect(serverDossiers).toContain("Milestone release weights must sum to exactly 100% of escrow");
  });

  it("records a funded position through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const CARBON_POSITIONS_TABLE = "carbon_credit_positions"');
    expect(serverDesk).toContain("export function ensureCarbonCreditSchema()");
    expect(serverDesk).toContain('"carbon_credit_purchase"');
    expect(serverDesk).toContain('"carbon_credit_distribution"');
    expect(serverDesk).toContain('"carbon_credit_payout"');
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
    expect(serverDesk).toContain('export const CARBON_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain('"carbon_credit_fx_debit"');
    expect(serverDesk).toContain('"carbon_credit_fx_credit"');
    // Missing or insufficient FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
    // The customer desk offers the combined-balance funding option alongside per-wallet choices.
    expect(customerUi).toContain("Combined balance");
    expect(customerUi).toContain("cc-funding-option");
    expect(customerUi).toContain("utils.customer.carbonCredit.fundingQuote.fetch");
  });

  it("credits distributions pro-rata and lets an administrator settle or write off an instrument", () => {
    // The desk lists instruments that still carry open positions, for the settlement console.
    expect(serverDesk).toContain("export type CarbonOpenInstrument");
    expect(serverDesk).toContain("export async function listCarbonOpenInstruments(");
    expect(serverDesk).toContain("WHERE outcome IS NULL");
    expect(serverDesk).toContain("GROUP BY instrumentId");
    // A distribution is credited pro-rata to every open position.
    expect(serverDesk).toContain("export async function recordCarbonDistribution(");
    // Settlement pays principal × multiple or writes it off, releasing locked principal.
    expect(serverDesk).toContain("export async function settleCarbonInstrument(");
    expect(serverDesk).toContain("outcome IS NULL FOR UPDATE");
    expect(serverDesk).toContain("lockedMinor=GREATEST(0, lockedMinor-?)");
    // The admin console exposes the distribution + settlement console calling the new endpoints.
    expect(adminUi).toContain("trpc.adminOperations.carbonOpenInstruments.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.recordCarbonDistribution.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.settleCarbonInstrument.useMutation");
    expect(adminUi).toContain("CARBON_OUTCOMES.map");
    expect(adminUi).toContain("Settle as ");
  });

  it("gives the admin console a type picker, derived atlas region and the full carbon taxonomy", () => {
    expect(adminUi).toContain("trpc.adminOperations.carbonDossiers.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createCarbonDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateCarbonDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setCarbonDossierEnabled.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setCarbonDossierStatus.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.reachCarbonMilestone.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.deleteCarbonDossier.useMutation");
    // The country flag is derived from the selected country, never typed by the admin.
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    // The atlas region is derived from the chosen country, never picked by the admin.
    expect(adminUi).toContain("carbonRegionLabel(carbonRegionOf(");
    // Scenario probabilities and milestone releases are entered as percentages and stored as bps.
    expect(adminUi).toContain("probabilityBps: toBpsFromPercent(item.probabilityPercent)");
    expect(adminUi).toContain("releaseBps: toBpsFromPercent(item.releasePercent)");
    // Carbon-specific fields: credit type, verification standard, credit volume and price per tonne.
    expect(adminUi).toContain("CARBON_STANDARDS");
    expect(adminUi).toContain("CARBON_SECTORS");
    expect(adminUi).toContain("CARBON_STAGES");
    expect(adminUi).toContain("CARBON_RISK_GRADES");
    expect(adminUi).toContain("CARBON_TERRITORY_BANDS");
    expect(adminUi).toContain("creditVolumeTonnes");
    expect(adminUi).toContain("pricePerTonneMinor");
  });

  it("renders the desk as a world atlas with a region rail and a slide-out dossier", () => {
    // A self-contained equirectangular atlas — the desk plots each project as a pin.
    expect(customerUi).toContain("const project = (lon: number, lat: number)");
    expect(customerUi).toContain("const MAP_W = 1000");
    expect(customerUi).toContain("const MAP_H = 500");
    expect(customerUi).toContain("CONTINENTS");
    expect(customerUi).toContain("carbonCountryPoint");
    // The three-part atlas structure: region rail | pin canvas | dossier drawer.
    expect(customerUi).toContain('className="cc-atlas-shell"');
    expect(customerUi).toContain('className="cc-region-rail"');
    expect(customerUi).toContain('className="cc-atlas-canvas"');
    expect(customerUi).toContain('className="cc-dossier-drawer"');
    // Pins are coloured by verification status, with a pulsing halo on cited references.
    expect(customerUi).toContain("cc-pin-dot");
    expect(customerUi).toContain("cc-pin-halo");
    expect(customerUi).toContain("verified ? \"is-verified\" : \"is-reference\"");
    expect(customerUi).toContain('className="cc-hero"');
    // The three tabs: atlas, my investments (positions) and desk analytics.
    expect(customerUi).toContain('const [tab, setTab] = useState<"atlas" | "positions" | "analytics">("atlas")');
    expect(customerUi).toContain("buildCarbonAnalytics");
    // Extra features: watchlist and CSV export.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("function downloadCsv(");
  });

  it("blends the desk into the portal theme instead of owning a fixed palette", () => {
    expect(customerUi).toContain('import "./carbon-credit.css"');
    expect(adminUi).toContain('import "./carbon-credit.css"');
    // Surfaces, borders, text, headings, verification, reference and danger all derive
    // from the active portal theme tokens so the desk blends with every theme.
    expect(styles).toContain("--cc-surface: var(--arb-color-surface)");
    expect(styles).toContain("--cc-surface-2: var(--arb-color-surface-raised)");
    expect(styles).toContain("--cc-white: var(--arb-color-text)");
    expect(styles).toContain("--cc-muted: var(--arb-color-text-muted)");
    expect(styles).toContain("--cc-teal: var(--arb-color-info)");
    expect(styles).toContain("--cc-verified: var(--arb-color-accent)");
    expect(styles).toContain("--cc-reference: var(--arb-color-warning)");
    expect(styles).toContain("--cc-red: var(--arb-color-danger)");
    expect(styles).toContain("color-mix(in srgb, var(--arb-color-border)");
    // The page background is the theme canvas, not an opaque fixed island.
    expect(styles).toContain("var(--arb-color-canvas)");
    // The desk must not re-introduce its own fixed palette.
    expect(styles).not.toContain("--cc-navy");
    // The atlas shell, land fill, own spinner and the drawer slide-in animation.
    expect(styles).toContain(".cc-atlas-shell");
    expect(styles).toContain(".cc-land");
    expect(styles).toContain("@keyframes cc-spin");
    expect(styles).toContain("@keyframes cc-drawer-in");
    expect(styles).toContain("@keyframes cc-pin-pulse");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain('import { getCarbonInvestmentDashboard, listCarbonOpenInstruments, purchaseCarbonOpportunity, quoteCarbonPurchase, recordCarbonDistribution, settleCarbonInstrument } from "./carbonCredits";');
    expect(serverRouters).toContain("carbonCredit: router({");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getCarbonInvestmentDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain('title: "Carbon Credit recorded"');
    expect(serverRouters).toContain("carbonDossiers: adminProcedure.query(() => listAdminCarbonDossiers())");
    expect(serverRouters).toContain("createCarbonDossier: adminProcedure.input(createCarbonDossierSchema).mutation");
    expect(serverRouters).toContain("updateCarbonDossier: adminProcedure.input(updateCarbonDossierSchema).mutation");
    expect(serverRouters).toContain("setCarbonDossierEnabled: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("setCarbonDossierStatus: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("reachCarbonMilestone: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("deleteCarbonDossier: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("carbonOpenInstruments: adminProcedure.query(() => listCarbonOpenInstruments())");
    expect(serverRouters).toContain("recordCarbonDistribution: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("settleCarbonInstrument: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("mutation(({ ctx, input }) => settleCarbonInstrument(ctx.user!.id, input))");
    // The 14-value carbon-only type enum plus the bounded scenario/milestone arrays.
    expect(serverRouters).toContain('creditType: z.enum(["REFORESTATION", "FOREST_CONSERVATION", "SOIL_CARBON", "BLUE_CARBON", "COOKSTOVES", "BIOCHAR", "DIRECT_AIR_CAPTURE", "BECCS", "ENHANCED_WEATHERING", "OCEAN_ALKALINITY", "RENEWABLE_ENERGY", "METHANE_CAPTURE", "WASTE_MANAGEMENT", "INDUSTRIAL_EFFICIENCY"])');
    expect(serverRouters).toContain("scenarios: z.array(carbonScenarioSchema).max(3).nullable().optional()");
    expect(serverRouters).toContain("milestones: z.array(carbonMilestoneSchema).max(10).nullable().optional()");
  });
});
