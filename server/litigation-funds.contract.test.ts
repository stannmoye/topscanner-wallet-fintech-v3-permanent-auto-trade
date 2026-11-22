import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminLitigationFunds.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerLitigationFunds.tsx", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/litigation-funds-catalogue.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./litigationFundDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./litigationFunds.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Litigation Funds case-linked capital desk", () => {
  it("exposes one Finance destination that opens the dedicated dossier console", () => {
    expect(navigation).toContain('id: "litigation-funds", target: "litigationFundDossiers", label: "Litigation Funds"');
    expect(navigation.match(/target: "litigationFundDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "litigation-funds"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminLitigationFunds = lazy(() => import("@/components/AdminLitigationFunds")');
    expect(app).toContain('section==="litigationFundDossiers"&&<Suspense');
    expect(app).toContain("<AdminLitigationFunds/>");
  });

  it("replaces the generic customer placeholder with the live Litigation Funds desk", () => {
    expect(app).toContain('const CustomerLitigationFunds = lazy(() => import("@/components/CustomerLitigationFunds")');
    expect(app).toContain('section==="litigation-funds"&&<Suspense');
    expect(app).toContain("<CustomerLitigationFunds push={push}/>");
    // The generic placeholder must explicitly exclude litigation-funds (and the
    // other desks that now have their own consoles, including ip-royalties).
    expect(app).toContain('item.id!=="litigation-funds"&&item.id!=="cooperate-dept"&&item.id!=="ip-royalties"&&item.id!=="music-royalties"&&item.id!=="agro-investment"&&item.id!=="carbon-credit")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "litigation-funds"');

    expect(customerUi).toContain("trpc.customer.litigationFunds.market.useQuery");
    // Customers fund a case: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.litigationFunds.purchase.useMutation");
    expect(customerUi).not.toContain("litigationFunds.commit");
    expect(customerUi).toContain("idempotencyKey: crypto.randomUUID()");
  });

  it("gathers real, cited public legal records and skips what it cannot verify", () => {
    expect(catalogue).toContain("async function fetchFederalRegisterClaims(");
    expect(catalogue).toContain("async function fetchUkCaseLawClaims(");
    expect(catalogue).toContain("async function fetchNorwayClaims(");
    expect(catalogue).toContain("async function fetchCourtListenerClaims(");
    expect(catalogue).toContain("async function fetchEurostatContext(");
    expect(catalogue).toContain("async function fetchWorldBankContext(");
    expect(catalogue).toContain("https://www.federalregister.gov/api/v1/documents.json");
    expect(catalogue).toContain("https://caselaw.nationalarchives.gov.uk/atom.xml");
    expect(catalogue).toContain("https://data.brreg.no/enhetsregisteret/api/enheter");
    // Unreachable or key-gated sources are reported honestly as unavailable, never faked.
    expect(catalogue).toContain("SEC litigation-releases RSS (skipped)");
    expect(catalogue).toContain("Frozen at 2023-07-26");
    expect(catalogue).toContain("DOJ press releases (skipped)");
    expect(catalogue).toContain('status: "unavailable"');
    // The shared provider must stay environment-neutral so it also runs as the browser fallback.
    expect(catalogue).not.toContain("process.env");
    expect(catalogue).not.toContain("node:");
  });

  it("never invents merit, damages or a multiple for an unreviewed discovery record", () => {
    expect(catalogue).toContain("export function compareLitigationCases(");
    expect(catalogue).toContain("export function expectedValueMinor(");
    expect(catalogue).toContain("export function stageLabel(");
    expect(catalogue).toContain("export function defaultMilestones(");
    expect(catalogue).toContain("export async function getLitigationFundsCatalogue(");
    expect(catalogue).toContain("export async function findLitigationCase(");
    // Scraped claims still carry null economics and no scenarios — the desk never
    // invents a merit, a damage figure or a multiple for an unreviewed record.
    expect(catalogue).toContain("meritGrade: null");
    expect(catalogue).toContain("estimatedDamagesMinor: null");
    expect(catalogue).toContain("expectedMultipleBps: null");
    expect(catalogue).toContain("scenarios: []");
  });

  it("lets a customer fund any cited case without administrator approval, from any wallet or all combined", () => {
    // The server resolves a case from the live catalogue as well as from an admin dossier.
    expect(serverDesk).toContain("const live = await findLitigationCase(");
    expect(serverDesk).toContain("findLitigationCase,");
    // The old administrator-approval gate is gone: the case only has to exist.
    expect(serverDesk).not.toContain("not open for funding");
    expect(serverDesk).not.toContain("not currently published on the Litigation Funds desk");
    // Every cited case on the desk counts as open for funding in the summary.
    expect(serverDesk).toContain("fundableCases: cases.length");
    // Funding still routes through the shared cross-wallet FX engine.
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain('export const LITIGATION_COMBINED_SOURCE = "COMBINED"');
    // The customer card always offers the funding action, with no approval prompt.
    expect(customerUi).toContain("Fund this case");
    expect(customerUi).not.toContain("cannot invest");
    expect(customerUi).not.toContain("Why can’t I invest");
  });

  it("stores administrator dossiers and bundles additively with an audited lifecycle", () => {
    expect(serverDossiers).toContain('export const LITIGATION_DOSSIERS_TABLE = "litigation_fund_dossiers"');
    expect(serverDossiers).toContain('export const LITIGATION_BUNDLES_TABLE = "litigation_fund_bundles"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS litigation_fund_dossiers");
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS litigation_fund_bundles");
    expect(serverDossiers).toContain("export function ensureLitigationFundDossierSchema()");
    expect(serverDossiers).toContain('"litigation_dossier_created"');
    expect(serverDossiers).toContain('"litigation_dossier_updated"');
    expect(serverDossiers).toContain('"litigation_dossier_enabled"');
    expect(serverDossiers).toContain('"litigation_dossier_disabled"');
    expect(serverDossiers).toContain('"litigation_dossier_status_changed"');
    expect(serverDossiers).toContain('"litigation_milestone_reached"');
    expect(serverDossiers).toContain('"litigation_dossier_deleted"');
    expect(serverDossiers).toContain('"litigation_bundle_created"');
    expect(serverDossiers).toContain('"litigation_bundle_enabled"');
    expect(serverDossiers).toContain('"litigation_bundle_deleted"');
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
  });

  it("records a funded position through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const LITIGATION_POSITIONS_TABLE = "litigation_fund_positions"');
    expect(serverDesk).toContain("export function ensureLitigationFundsSchema()");
    expect(serverDesk).toContain("litigation_funds_purchase");
    expect(serverDesk).toContain("litigation_funds_payout");
    expect(serverDesk).toContain("SELECT resultJson");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("v5_idempotency_keys");
  });

  it("funds a position from any single wallet or the combined balance of every wallet", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const LITIGATION_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain("async function quoteLitigationFundPurchase(");
    expect(serverDesk).toContain("async function readWalletRows(");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("litigation_funds_fx_debit");
    expect(serverDesk).toContain("litigation_funds_fx_credit");
    // Missing FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
  });

  it("lets an administrator settle any funded case directly with a chosen multiple", () => {
    // The desk lists cases that still carry open commitments, for the settlement console.
    expect(serverDesk).toContain("export type LitigationOpenCase");
    expect(serverDesk).toContain("export async function listLitigationOpenCases(");
    expect(serverDesk).toContain("WHERE instrumentType='CASE' AND outcome IS NULL");
    expect(serverDesk).toContain("GROUP BY instrumentId");
    // Settlement resolves a case without a dossier by paying principal × multiple or writing it off.
    expect(serverDesk).toContain("export async function settleLitigationCase(");
    expect(serverDesk).toContain("const funderMultipleBps = input.outcome === \"LOSE\" ? 0 : requestedBps");
    expect(serverDesk).toContain("outcome IS NULL FOR UPDATE");
    expect(serverDesk).toContain("lockedMinor=GREATEST(0, lockedMinor-?)");
    expect(serverDesk).toContain('"litigation_funds_payout"');
    expect(serverDesk).toContain('"litigation_case_settled"');
    // The admin console exposes the settlement console calling the new endpoint.
    expect(adminUi).toContain("trpc.adminOperations.litigationOpenCases.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.settleLitigationCase.useMutation");
    expect(adminUi).toContain("Settle open cases");
    expect(adminUi).toContain("Funder multiple (%)");
  });

  it("gives the customer desk pagination plus the country, claim-type, merit and stage filters", () => {
    expect(customerUi).toContain("const PAGE_SIZES = [6, 12, 24]");
    expect(customerUi).toContain("lf-pagination");
    expect(customerUi).toContain("Previous</button>");
    expect(customerUi).toContain("Next <ChevronRight");
    expect(customerUi).toContain("Page {currentPage} of {pageCount}");
    expect(customerUi).toContain("const pageRows = filtered.slice(");
    expect(customerUi).toContain("const MERIT_OPTIONS = [");
    expect(customerUi).toContain("const STAGE_OPTIONS = [");
    expect(customerUi).toContain("fundableOnly");
    expect(customerUi).toContain("watchlistOnly");
    // Extra features: watchlist, compare, CSV export and a live funding quote.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("const toggleCompare = (id: string)");
    expect(customerUi).toContain("function downloadCsv(");
    expect(customerUi).toContain("utils.customer.litigationFunds.fundingQuote.fetch");
    expect(customerUi).toContain("lf-funding-option");
    expect(customerUi).toContain("Combined balance");
    // The distinct case-file identity plus the modelled outcome scenarios are rendered.
    expect(customerUi).toContain('className="lf-hero"');
    expect(customerUi).toContain('className="lf-scenarios"');
    expect(customerUi).toContain('className="lf-milestones"');
  });

  it("separates a company litigating a claim from a company going bankrupt, with advanced case intelligence", () => {
    // Case-class taxonomy: INSOLVENCY is one class among many, never the whole desk.
    expect(catalogue).toContain("export type LitigationCaseClass");
    expect(catalogue).toContain("export const LITIGATION_CASE_CLASSES");
    expect(catalogue).toContain("export function caseClassLabel(");
    expect(catalogue).toContain("export function isInsolvency(");
    expect(catalogue).toContain("export function classifyCaseClass(");
    expect(catalogue).toContain("export function classifyPartyKind(");
    expect(catalogue).toContain("export function detectClaimValueBand(");
    expect(catalogue).toContain('"INSOLVENCY"');
    // Company-litigant intelligence: listed parties are tied to a ticker via SEC EDGAR.
    expect(catalogue).toContain("async function fetchEdgarClaims(");
    expect(catalogue).toContain("https://www.sec.gov/files/company_tickers_exchange.json");
    expect(catalogue).toContain("https://efts.sec.gov/LATEST/search-index");
    expect(catalogue).toContain("function listedPartiesFor(");
    // The desk-level analytics are computed only from the cited records.
    expect(catalogue).toContain("export function buildLitigationAnalytics(");
    expect(catalogue).toContain("mostActiveCompanies");
    expect(catalogue).toContain("insolvencyBps");

    // Dossiers store the new case metadata additively, tolerating the ALTER on first run.
    expect(serverDossiers).toContain("const ADD_DOSSIERS_COLUMNS_SQL");
    expect(serverDossiers).toContain("ALTER TABLE litigation_fund_dossiers ADD COLUMN caseClass VARCHAR(32) NULL");
    expect(serverDossiers).toContain("ADD COLUMN claimValueBand VARCHAR(16) NULL");

    // The admin router validates the case class explicitly.
    expect(serverRouters).toContain("caseClass: z.enum([");

    // The admin console exposes the taxonomy and the insolvency distinction.
    expect(adminUi).toContain("LITIGATION_CASE_CLASSES");
    expect(adminUi).toContain("caseClassLabel");
    expect(adminUi).toContain("isInsolvency");

    // The customer desk filters and badges by case class, surfaces listed litigants and the analytics panel.
    expect(customerUi).toContain("LITIGATION_CASE_CLASSES");
    expect(customerUi).toContain("caseClassLabel");
    expect(customerUi).toContain("lf-badge--class");
    expect(customerUi).toContain("lf-badge--insolvency");
    expect(customerUi).toContain("lf-listed-chip");
    expect(customerUi).toContain("isInsolvency");
    expect(customerUi).toContain("buildLitigationAnalytics");
    expect(customerUi).toContain("Litigation analytics");
  });

  it("derives the country flag from the selected country and never asks the admin to type it", () => {
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    // Scenario and milestone weights are entered as percentages and stored as integer basis points.
    expect(adminUi).toContain("probabilityBps: toBpsFromPercent(item.probabilityPercent)");
    expect(adminUi).toContain("releaseBps: toBpsFromPercent(item.releasePercent)");
    // Both weighted sets must sum to exactly 100% before a dossier can be published.
    expect(adminUi).toContain("scenarioBpsTotal !== 10_000");
    expect(adminUi).toContain("milestoneBpsTotal !== 10_000");
    // A modelled dossier must cite its source and carry a funding target.
    expect(adminUi).toContain('"A modelled dossier must cite its source URL. "');
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain("litigationFunds: router({");
    expect(serverRouters).toContain("import { getLitigationFundsDashboard, listLitigationOpenCases, purchaseLitigationFund, quoteLitigationFundPurchase, recordLitigationOutcome, settleLitigationCase } from \"./litigationFunds\";");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getLitigationFundsDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("litigationDossiers: adminProcedure.query(() => listAdminLitigationDossiers())");
    expect(serverRouters).toContain("createLitigationDossier: adminProcedure.input(createLitigationDossierSchema).mutation");
    expect(serverRouters).toContain("updateLitigationDossier: adminProcedure.input(updateLitigationDossierSchema).mutation");
    expect(serverRouters).toContain("setLitigationDossierEnabled: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("setLitigationDossierStatus: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("reachLitigationMilestone: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("recordLitigationOutcome: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("deleteLitigationDossier: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("litigationOpenCases: adminProcedure.query(() => listLitigationOpenCases())");
    expect(serverRouters).toContain("settleLitigationCase: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("mutation(({ ctx, input }) => settleLitigationCase(ctx.user!.id, input))");
    expect(serverRouters).toContain("litigationBundles: adminProcedure.query(() => listAdminLitigationBundles())");
    expect(serverRouters).toContain("createLitigationBundle: adminProcedure.input(createLitigationBundleSchema).mutation");
    expect(serverRouters).toContain("updateLitigationBundle: adminProcedure.input(updateLitigationBundleSchema).mutation");
    expect(serverRouters).toContain("setLitigationBundleEnabled: adminProcedure.input(z.object({ bundleId");
    expect(serverRouters).toContain("deleteLitigationBundle: adminProcedure.input(z.object({ bundleId");
    expect(serverRouters).toContain("scenarios: z.array(litigationScenarioSchema).max(3).optional()");
    expect(serverRouters).toContain("milestones: z.array(litigationMilestoneSchema).max(10).optional()");
  });
});
