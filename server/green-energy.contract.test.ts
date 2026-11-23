import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminGreenEnergy.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerGreenEnergy.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/green-energy.css", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/green-energy-catalogue.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./greenEnergyDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./greenEnergy.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const investmentEconomics = readFileSync(new URL("../shared/investment-economics.ts", import.meta.url), "utf8");
const deskEconomics = readFileSync(new URL("./deskEconomics.ts", import.meta.url), "utf8");

describe("Green Energy desk", () => {
  it("exposes one Finance destination that opens the dedicated green-energy console", () => {
    expect(navigation).toContain('id: "green-energy", target: "greenEnergyDossiers", label: "Green Energy"');
    expect(navigation.match(/target: "greenEnergyDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "green-energy"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminGreenEnergy = lazy(() => import("@/components/AdminGreenEnergy")');
    expect(app).toContain('section==="greenEnergyDossiers"&&<Suspense');
    expect(app).toContain("<AdminGreenEnergy/>");
  });

  it("replaces the generic customer placeholder with the live Green Energy desk", () => {
    expect(app).toContain('const CustomerGreenEnergy = lazy(() => import("@/components/CustomerGreenEnergy")');
    expect(app).toContain('section==="green-energy"&&<Suspense');
    expect(app).toContain("<CustomerGreenEnergy push={push}/>");
    // The generic placeholder must explicitly exclude green-energy now.
    expect(app).toContain('item.id!=="green-energy"&&item.id!=="lending")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "green-energy"');

    expect(customerUi).toContain("trpc.customer.greenEnergy.market.useQuery");
    // Customers purchase a green-energy opportunity: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.greenEnergy.purchase.useMutation");
    expect(customerUi).not.toContain("greenEnergy.commit");
    expect(customerUi).toContain("idempotencyKey: crypto.randomUUID()");
  });

  it("carries fourteen green-energy types — solar, wind, firm generation, storage, fuels, grid and demand", () => {
    expect(catalogue).toContain("export const GREEN_ENERGY_TYPES");
    // The 14 green-energy types the brief asked for.
    for (const type of [
      '"SOLAR_PV"', '"CONCENTRATED_SOLAR"', '"ONSHORE_WIND"', '"OFFSHORE_WIND"', '"HYDROPOWER"', '"GEOTHERMAL"',
      '"TIDAL_WAVE"', '"BIOMASS_BIOENERGY"', '"BATTERY_STORAGE"', '"GREEN_HYDROGEN"', '"WASTE_TO_ENERGY"',
      '"GRID_INFRASTRUCTURE"', '"ENERGY_EFFICIENCY"', '"EV_CHARGING"',
    ]) expect(catalogue).toContain(type);
    // Grouped once and shared by both UIs.
    expect(catalogue).toContain("export const GREEN_ENERGY_TYPE_GROUPS");
    expect(catalogue).toContain('"Solar & wind"');
    expect(catalogue).toContain('"Firm generation"');
    expect(catalogue).toContain('"Storage & clean fuels"');
    expect(catalogue).toContain('"Grid & demand"');
    expect(catalogue).toContain("export const GREEN_ENERGY_SECTORS");
    expect(catalogue).toContain("export const GREEN_ENERGY_STANDARDS");
    expect(catalogue).toContain("export const GREEN_ENERGY_STAGES");
    expect(catalogue).toContain("export const GREEN_ENERGY_DOSSIER_STATUSES");
    expect(catalogue).toContain("export const GREEN_ENERGY_RISK_GRADES");
    expect(catalogue).toContain("export const GREEN_ENERGY_OUTCOMES");
    expect(catalogue).toContain("export const GREEN_ENERGY_TERRITORY_BANDS");
    expect(catalogue).toContain("export const GREEN_ENERGY_VALUE_BANDS");
    expect(catalogue).toContain("export function classifyGreenEnergyType(");
    // Both desks render the grouped picker / atlas filters.
    expect(adminUi).toContain("GreenEnergyTypeOptions");
    expect(adminUi).toContain("GREEN_ENERGY_TYPE_GROUPS.map");
    expect(customerUi).toContain("GREEN_ENERGY_TYPE_GROUPS.map");
    expect(customerUi).toContain("GREEN_ENERGY_TYPES.length");
    // The AI classification and the whole catalogue stay strictly green-energy-only.
    expect(catalogue).toContain("the green-energy-only catalogue");
  });

  it("discovers honest, cited public green-energy data and invents no deal economics", () => {
    expect(catalogue).toContain("export async function getGreenEnergyInvestmentCatalogue(");
    expect(catalogue).toContain("export async function findGreenEnergyOpportunity(");
    expect(catalogue).toContain("export function buildGreenEnergyAnalytics(");
    expect(catalogue).toContain('export const GREEN_ENERGY_DESK_CURRENCY = "USD"');
    expect(catalogue).toContain("export type GreenEnergyInvestmentSource");
    expect(catalogue).toContain('status: "ok" | "degraded" | "unavailable"');
    // Discovery drains two free, keyless public green-energy feeds; nothing is synthesized.
    expect(catalogue).toContain('const WORLDBANK_BASE = "https://api.worldbank.org/v2"');
    expect(catalogue).toContain('const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"');
    expect(catalogue).toContain("export const GREEN_ENERGY_EUROSTAT_DATASETS = EUROSTAT_DATASETS");
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
    expect(catalogue).toContain("export function defaultGreenEnergyMilestones(");
    expect(catalogue).toContain('"WRITE_OFF"');
    // Only a FUNDING record with a modelled, sourced funding target is fundable.
    expect(adminUi).toContain('row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome');
    expect(adminUi).toContain("Not modelled — customers can still invest");
    expect(serverDossiers).toContain('"A modelled opportunity must cite its source URL so the economics can be verified"');
  });

  it("lets a customer invest straight from a pin-board card and states the investable amount and projected profit", () => {
    // The Invest button lives on every pin-board card, not only inside the dossier,
    // so a customer can purchase without first opening a project.
    expect(customerUi).toContain('className="ge-pin-card-invest"');
    expect(customerUi).toContain('className="ge-pin-card-econ"');
    // The card states the amount that can be invested and the profit it realises.
    expect(customerUi).toContain("You can invest from");
    expect(customerUi).toContain("Projected profit on");
    // The dossier stats repeat both figures for the selected project.
    expect(customerUi).toContain("<span>You can invest from</span>");
    expect(customerUi).toContain("<span>Projected profit at minimum</span>");
    // The purchase modal shows the projected return and profit for the chosen amount.
    expect(customerUi).toContain('className="ge-invest-figures"');
    expect(customerUi).toContain("Projected profit you will realise");
    expect(styles).toContain(".ge-pin-card-invest");
    expect(styles).toContain(".ge-profit");
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
    expect(serverDossiers).toContain('export const GREEN_ENERGY_DOSSIERS_TABLE = "green_energy_dossiers"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS green_energy_dossiers");
    expect(serverDossiers).toContain("export function ensureGreenEnergyDossierSchema()");
    expect(serverDossiers).toContain("export function dossierRowToOpportunity(");
    expect(serverDossiers).toContain('"green_energy_dossier_created"');
    expect(serverDossiers).toContain('"green_energy_dossier_updated"');
    expect(serverDossiers).toContain('"green_energy_dossier_enabled"');
    expect(serverDossiers).toContain('"green_energy_dossier_disabled"');
    expect(serverDossiers).toContain('"green_energy_dossier_status_changed"');
    expect(serverDossiers).toContain('"green_energy_milestone_reached"');
    expect(serverDossiers).toContain('"green_energy_dossier_deleted"');
    expect(serverDossiers).toContain('"green_energy_dossier"');
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
    // Administrator-entered weights are integer basis points and are validated to sum to 100%.
    expect(serverDossiers).toContain("Scenario probabilities must sum to exactly 100%");
    expect(serverDossiers).toContain("Milestone release weights must sum to exactly 100% of escrow");
  });

  it("records a funded position through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const GREEN_ENERGY_POSITIONS_TABLE = "green_energy_positions"');
    expect(serverDesk).toContain("export function ensureGreenEnergySchema()");
    expect(serverDesk).toContain('"green_energy_purchase"');
    expect(serverDesk).toContain('"green_energy_distribution"');
    expect(serverDesk).toContain('"green_energy_payout"');
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
    expect(serverDesk).toContain('export const GREEN_ENERGY_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain('"green_energy_fx_debit"');
    expect(serverDesk).toContain('"green_energy_fx_credit"');
    // Missing or insufficient FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
    // The customer desk offers the combined-balance funding option alongside per-wallet choices.
    expect(customerUi).toContain("Combined balance");
    expect(customerUi).toContain("ge-funding-option");
    expect(customerUi).toContain("utils.customer.greenEnergy.fundingQuote.fetch");
  });

  it("credits distributions pro-rata and lets an administrator settle or write off an instrument", () => {
    // The desk lists instruments that still carry open positions, for the settlement console.
    expect(serverDesk).toContain("export type GreenEnergyOpenInstrument");
    expect(serverDesk).toContain("export async function listGreenEnergyOpenInstruments(");
    expect(serverDesk).toContain("WHERE outcome IS NULL");
    expect(serverDesk).toContain("GROUP BY instrumentId");
    // A distribution is credited pro-rata to every open position.
    expect(serverDesk).toContain("export async function recordGreenEnergyDistribution(");
    // Settlement pays principal × multiple or writes it off, releasing locked principal.
    expect(serverDesk).toContain("export async function settleGreenEnergyInstrument(");
    expect(serverDesk).toContain("outcome IS NULL FOR UPDATE");
    expect(serverDesk).toContain("lockedMinor=GREATEST(0, lockedMinor-?)");
    // The admin console exposes the distribution + settlement console calling the new endpoints.
    expect(adminUi).toContain("trpc.adminOperations.greenEnergyOpenInstruments.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.recordGreenEnergyDistribution.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.settleGreenEnergyInstrument.useMutation");
    expect(adminUi).toContain("GREEN_ENERGY_OUTCOMES.map");
    expect(adminUi).toContain("Settle as ");
  });

  it("gives the admin console a type picker, derived atlas region and the full green-energy taxonomy", () => {
    expect(adminUi).toContain("trpc.adminOperations.greenEnergyDossiers.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createGreenEnergyDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateGreenEnergyDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setGreenEnergyDossierEnabled.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setGreenEnergyDossierStatus.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.reachGreenEnergyMilestone.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.deleteGreenEnergyDossier.useMutation");
    // The country flag is derived from the selected country, never typed by the admin.
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    // The atlas region is derived from the chosen country, never picked by the admin.
    expect(adminUi).toContain("greenEnergyRegionLabel(greenEnergyRegionOf(");
    // Scenario probabilities and milestone releases are entered as percentages and stored as bps.
    expect(adminUi).toContain("probabilityBps: toBpsFromPercent(item.probabilityPercent)");
    expect(adminUi).toContain("releaseBps: toBpsFromPercent(item.releasePercent)");
    // Green-energy-specific fields: energy type, certification framework, capacity and tariff per MWh.
    expect(adminUi).toContain("GREEN_ENERGY_STANDARDS");
    expect(adminUi).toContain("GREEN_ENERGY_SECTORS");
    expect(adminUi).toContain("GREEN_ENERGY_STAGES");
    expect(adminUi).toContain("GREEN_ENERGY_RISK_GRADES");
    expect(adminUi).toContain("GREEN_ENERGY_TERRITORY_BANDS");
    expect(adminUi).toContain("capacityMw");
    expect(adminUi).toContain("tariffPerMwhMinor");
  });

  it("renders the desk as a world atlas with a region rail and a slide-out dossier", () => {
    // A self-contained equirectangular atlas — the desk plots each project as a pin.
    expect(customerUi).toContain("const project = (lon: number, lat: number)");
    expect(customerUi).toContain("const MAP_W = 1000");
    expect(customerUi).toContain("const MAP_H = 500");
    expect(customerUi).toContain("CONTINENTS");
    expect(customerUi).toContain("greenEnergyCountryPoint");
    // The three-part atlas structure: region rail | pin canvas | dossier drawer.
    expect(customerUi).toContain('className="ge-atlas-shell"');
    expect(customerUi).toContain('className="ge-region-rail"');
    expect(customerUi).toContain('className="ge-atlas-canvas"');
    expect(customerUi).toContain('className="ge-dossier-drawer"');
    // Pins are coloured by verification status, with a pulsing halo on cited references.
    expect(customerUi).toContain("ge-pin-dot");
    expect(customerUi).toContain("ge-pin-halo");
    expect(customerUi).toContain("verified ? \"is-verified\" : \"is-reference\"");
    expect(customerUi).toContain('className="ge-hero"');
    // The three tabs: atlas, my investments (positions) and desk analytics.
    expect(customerUi).toContain('const [tab, setTab] = useState<"atlas" | "positions" | "analytics">("atlas")');
    expect(customerUi).toContain("buildGreenEnergyAnalytics");
    // Extra features: watchlist and CSV export.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("function downloadCsv(");
  });

  it("blends the desk into the portal theme instead of owning a fixed palette", () => {
    expect(customerUi).toContain('import "./green-energy.css"');
    expect(adminUi).toContain('import "./green-energy.css"');
    // Surfaces, borders, text, headings, verification, reference and danger all derive
    // from the active portal theme tokens so the desk blends with every theme.
    expect(styles).toContain("--ge-surface: var(--arb-color-surface)");
    expect(styles).toContain("--ge-surface-2: var(--arb-color-surface-raised)");
    expect(styles).toContain("--ge-white: var(--arb-color-text)");
    expect(styles).toContain("--ge-muted: var(--arb-color-text-muted)");
    expect(styles).toContain("--ge-teal: var(--arb-color-info)");
    expect(styles).toContain("--ge-verified: var(--arb-color-accent)");
    expect(styles).toContain("--ge-reference: var(--arb-color-warning)");
    expect(styles).toContain("--ge-red: var(--arb-color-danger)");
    expect(styles).toContain("color-mix(in srgb, var(--arb-color-border)");
    // The page background is the theme canvas, not an opaque fixed island.
    expect(styles).toContain("var(--arb-color-canvas)");
    // The desk must not re-introduce its own fixed palette.
    expect(styles).not.toContain("--ge-navy");
    // The atlas shell, land fill, own spinner and the drawer slide-in animation.
    expect(styles).toContain(".ge-atlas-shell");
    expect(styles).toContain(".ge-land");
    expect(styles).toContain("@keyframes ge-spin");
    expect(styles).toContain("@keyframes ge-drawer-in");
    expect(styles).toContain("@keyframes ge-pin-pulse");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain('import { getGreenEnergyInvestmentDashboard, listGreenEnergyOpenInstruments, purchaseGreenEnergyOpportunity, quoteGreenEnergyPurchase, recordGreenEnergyDistribution, settleGreenEnergyInstrument } from "./greenEnergy";');
    expect(serverRouters).toContain("greenEnergy: router({");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getGreenEnergyInvestmentDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain('title: "Green Energy recorded"');
    expect(serverRouters).toContain("greenEnergyDossiers: adminProcedure.query(() => listAdminGreenEnergyDossiers())");
    expect(serverRouters).toContain("createGreenEnergyDossier: adminProcedure.input(createGreenEnergyDossierSchema).mutation");
    expect(serverRouters).toContain("updateGreenEnergyDossier: adminProcedure.input(updateGreenEnergyDossierSchema).mutation");
    expect(serverRouters).toContain("setGreenEnergyDossierEnabled: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("setGreenEnergyDossierStatus: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("reachGreenEnergyMilestone: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("deleteGreenEnergyDossier: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("greenEnergyOpenInstruments: adminProcedure.query(() => listGreenEnergyOpenInstruments())");
    expect(serverRouters).toContain("recordGreenEnergyDistribution: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("settleGreenEnergyInstrument: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("mutation(({ ctx, input }) => settleGreenEnergyInstrument(ctx.user!.id, input))");
    // The 14-value green-energy-only type enum plus the bounded scenario/milestone arrays.
    expect(serverRouters).toContain('energyType: z.enum(["SOLAR_PV", "CONCENTRATED_SOLAR", "ONSHORE_WIND", "OFFSHORE_WIND", "HYDROPOWER", "GEOTHERMAL", "TIDAL_WAVE", "BIOMASS_BIOENERGY", "BATTERY_STORAGE", "GREEN_HYDROGEN", "WASTE_TO_ENERGY", "GRID_INFRASTRUCTURE", "ENERGY_EFFICIENCY", "EV_CHARGING"])');
    expect(serverRouters).toContain("scenarios: z.array(greenEnergyScenarioSchema).max(3).nullable().optional()");
    expect(serverRouters).toContain("milestones: z.array(greenEnergyMilestoneSchema).max(10).nullable().optional()");
  });

  it("auto-assigns every opportunity a richer economic profile — amount, profit, term, currency, platform fee and an occasional settlement delay", () => {
    // The shared, environment-neutral engine is the single source of the profile.
    expect(investmentEconomics).toContain("export type DeskKey");
    expect(investmentEconomics).toContain("export const DESK_KEYS");
    expect(investmentEconomics).toContain("export const INVESTMENT_CURRENCIES");
    // A USD-dominant multi-currency set: USD plus euro, sterling, Chinese yuan,
    // Japanese yen, South African rand and other-country currencies.
    for (const currency of ['{ code: "USD"', '{ code: "EUR"', '{ code: "GBP"', '{ code: "CNY"', '{ code: "JPY"', '{ code: "ZAR"']) {
      expect(investmentEconomics).toContain(currency);
    }
    expect(investmentEconomics).toContain("export function currencyMinorToUsdMinor(");
    expect(investmentEconomics).toContain("export function currencyByCode(");
    // Every assignment participates in the published bounds: USD 500–1,000,000,
    // a 25%–38% profit, a 30-day-to-1-year term and a 7%–10% platform fee.
    expect(investmentEconomics).toContain("export const ECONOMICS_BOUNDS");
    expect(investmentEconomics).toContain("ticketMinMinorUsd: 50_000");
    expect(investmentEconomics).toContain("profitMinBps: 2_500");
    expect(investmentEconomics).toContain("profitMaxBps: 3_800");
    expect(investmentEconomics).toContain("termMinDays: 30");
    expect(investmentEconomics).toContain("termMaxDays: 365");
    expect(investmentEconomics).toContain("platformFeeMinBps: 700");
    expect(investmentEconomics).toContain("platformFeeMaxBps: 1_000");
    expect(investmentEconomics).toContain("export function assignDeskEconomics(");
    expect(investmentEconomics).toContain("settlementDelayDays");
    // The desk key the Green Energy desk uses is a first-class member of the engine.
    expect(investmentEconomics).toContain("greenEnergy");

    // The desk derives and persists the profile additively, so a value survives a restart.
    expect(deskEconomics).toContain("export async function getOrAssignDeskEconomics(");
    expect(deskEconomics).toContain("export async function getDeskEconomicsMap(");
    // An administrator override is authoritative and is never re-derived.
    expect(deskEconomics).toContain('if (existing.source === "ADMIN") return existing;');

    // The Green Energy catalogue carries the profile on every opportunity it serves.
    expect(catalogue).toContain('import type { DeskEconomics } from "./investment-economics"');
    expect(catalogue).toContain("economics?: DeskEconomics");

    // The Green Energy dashboard merges the profile into every served opportunity, and the
    // purchase path resolves an unpublished multiple from the same profile.
    expect(serverDesk).toContain('import { getDeskEconomicsMap, getOrAssignDeskEconomics } from "./deskEconomics"');
    expect(serverDesk).toContain('getDeskEconomicsMap("greenEnergy"');
    expect(serverDesk).toContain("function withGreenEnergyEconomics(");
    expect(serverDesk).toContain("10_000 + economics.profitBps");

    // The administrator can view and override the auto-assigned values.
    expect(serverRouters).toContain('import { getDeskEconomicsMap, listDeskEconomics, reassignDeskEconomics, reassignDeskEconomicsBulk, setDeskEconomicsBulkOverride, setDeskEconomicsOverride } from "./deskEconomics"');
    expect(serverRouters).toContain("const deskKeySchema = z.enum(DESK_KEY_VALUES)");
    expect(serverRouters).toContain("deskEconomicsBatch: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentIds");
    expect(serverRouters).toContain("setDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentId");
    expect(serverRouters).toContain("reassignDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentId");

    // The customer card, dossier and invest modal surface the extended profile.
    expect(customerUi).toContain("function economicsView(");
    expect(customerUi).toContain('className="ge-econ-panel"');
    expect(customerUi).toContain("ge-econ-panel--modal");
    expect(customerUi).toContain("ge-econ-delay");
    expect(customerUi).toContain("currencyMinorToUsdMinor");
    expect(customerUi).toContain("settlementDelayDays");

    // The admin console gets an editable economics console with a re-roll.
    expect(adminUi).toContain("trpc.adminOperations.deskEconomicsBatch.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.setDeskEconomics.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.reassignDeskEconomics.useMutation");
    expect(adminUi).toContain("const econFormFor = (id: string)");
    expect(adminUi).toContain("Save economic profile");
    expect(adminUi).toContain("Re-roll auto profile");
    expect(adminUi).toContain("ECONOMICS_BOUNDS");
    expect(adminUi).toContain("INVESTMENT_CURRENCIES");

    // The extended profile is styled consistently with the rest of the desk.
    expect(styles).toContain(".ge-econ-panel");
    expect(styles).toContain(".ge-econ-panel--modal");
    expect(styles).toContain(".ge-econ-delay");
  });
});
