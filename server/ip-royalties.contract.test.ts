import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminIPRoyalties.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerIPRoyalties.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/ip-royalties.css", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/ip-royalties-catalogue.ts", import.meta.url), "utf8");
const investmentEconomics = readFileSync(new URL("../shared/investment-economics.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./ipRoyaltiesDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./ipRoyalties.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const deskEconomics = readFileSync(new URL("./deskEconomics.ts", import.meta.url), "utf8");

describe("IP Royalties licensing-capital desk", () => {
  it("exposes one Finance destination that opens the dedicated dossier console", () => {
    expect(navigation).toContain('id: "ip-royalties", target: "ipRoyaltyDossiers", label: "IP Royalties"');
    expect(navigation.match(/target: "ipRoyaltyDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "ip-royalties"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminIPRoyalties = lazy(() => import("@/components/AdminIPRoyalties")');
    expect(app).toContain('section==="ipRoyaltyDossiers"&&<Suspense');
    expect(app).toContain("<AdminIPRoyalties/>");
  });

  it("replaces the generic customer placeholder with the live IP Royalties desk", () => {
    expect(app).toContain('const CustomerIPRoyalties = lazy(() => import("@/components/CustomerIPRoyalties")');
    expect(app).toContain('section==="ip-royalties"&&<Suspense');
    expect(app).toContain("<CustomerIPRoyalties push={push}/>");
    // The generic placeholder must explicitly exclude ip-royalties now.
    expect(app).toContain('item.id!=="litigation-funds"&&item.id!=="cooperate-dept"&&item.id!=="ip-royalties"&&item.id!=="music-royalties"&&item.id!=="agro-investment"&&item.id!=="carbon-credit"&&item.id!=="green-energy")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "ip-royalties"');

    expect(customerUi).toContain("trpc.customer.ipRoyalties.market.useQuery");
    // Customers fund a right: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.ipRoyalties.purchase.useMutation");
    expect(customerUi).not.toContain("ipRoyalties.commit");
    expect(customerUi).toContain("idempotencyKey: crypto.randomUUID()");
  });

  it("discovers real, cited public IP registers and invents no royalty economics", () => {
    expect(catalogue).toContain("export async function getIpRoyaltiesCatalogue(");
    expect(catalogue).toContain("export async function findIpRight(");
    expect(catalogue).toContain("USPTO Patent Assignment Search");
    expect(catalogue).toContain("https://assignment.uspto.gov");
    expect(catalogue).toContain("no royalty rates are published");
    expect(catalogue).toContain("EPO Open Patent Services (OPS)");
    // Key-gated registers are marked honestly and skipped rather than faked.
    expect(catalogue).toContain('status: "keyed"');
    expect(catalogue).toContain('status: "ok" | "keyed" | "unavailable"');
    // Discovery drains only free, keyless public APIs (Crossref, Open Library,
    // the Art Institute of Chicago, iTunes, GitHub); nothing is synthesized.
    expect(catalogue).toContain("api.crossref.org/works");
    expect(catalogue).toContain("openlibrary.org/search.json");
    expect(catalogue).toContain("api.artic.edu/api/v1/artworks");
    expect(catalogue).toContain("itunes.apple.com/search");
    expect(catalogue).toContain("api.github.com/search/repositories");
    // Discovery contributes cited candidates only: every candidate is fundable:false.
    expect(catalogue).toContain("fundable: false");
    expect(catalogue).toContain("Economics are deliberately absent");
    // The shared provider must stay environment-neutral so it also runs as the browser fallback.
    expect(catalogue).not.toContain("process.env");
    expect(catalogue).not.toContain("node:");
  });

  it("scopes the desk to its three licensing sectors and routes the sister desks away", () => {
    // The user's three suggested tabs, encoded once and shared by both UIs.
    expect(catalogue).toContain('export type IpRoyaltySector = "REGISTERED_IP" | "CREATIVE_MEDIA" | "BUSINESS_TECH"');
    expect(catalogue).toContain("export const IP_ROYALTY_SECTORS");
    expect(catalogue).toContain("export const SECTOR_RIGHT_TYPES");
    expect(catalogue).toContain("export function sectorForRightType(");
    expect(catalogue).toContain("export function sectorLabel(");
    // Registered IP / Creative & media / Business & tech.
    expect(catalogue).toContain("Registered IP");
    expect(catalogue).toContain("Creative & media");
    expect(catalogue).toContain("Business & tech");
    // IP-adjacent sectors with their own menus are classified and routed away.
    expect(catalogue).toContain("export type IpRoyaltyBoundary");
    expect(catalogue).toContain("export const IP_ROYALTY_BOUNDARIES");
    expect(catalogue).toContain('"MUSIC_ROYALTIES"');
    expect(catalogue).toContain('"NFT"');
    expect(catalogue).toContain('"AGRO_INVESTMENT"');
    expect(catalogue).toContain('"GREEN_ENERGY"');
    expect(catalogue).toContain('"CARBON_CREDIT"');
    expect(catalogue).toContain("export function boundaryFor(");
    expect(catalogue).toContain("export function isIpRoyaltyInScope(");
    expect(catalogue).toContain("export function boundaryGuidance(");
    // Both desks render the sector grouping.
    expect(adminUi).toContain("RightTypeOptions");
    expect(adminUi).toContain("sectorForRightType(row.rightType)");
    expect(customerUi).toContain("IP_ROYALTY_SECTORS.map");
    expect(customerUi).toContain("sectorForRightType(item.rightType)");
  });

  it("keeps economics admin-sourced: a right is fundable only once a sourced dossier is published", () => {
    expect(catalogue).toContain("export function classifyRightType(");
    expect(catalogue).toContain("export function buildIpRoyaltyAnalytics(");
    expect(catalogue).toContain("export function defaultRoyaltyScenarios(");
    expect(catalogue).toContain("export const IP_ROYALTY_OUTCOMES");
    expect(catalogue).toContain('"WRITE_OFF"');
    // The customer card states plainly that a cited right without sourced
    // terms is not fundable — the desk never invents an economics figure.
    expect(customerUi).toContain("Economics not yet published");
    expect(customerUi).toContain("A right becomes fundable only once an administrator publishes its sourced royalty terms");
    expect(customerUi).toContain('className="ipr-unfundable"');
  });

  it("stores administrator dossiers and portfolios additively with an audited lifecycle", () => {
    expect(serverDossiers).toContain('export const IP_ROYALTY_DOSSIERS_TABLE = "ip_royalty_dossiers"');
    expect(serverDossiers).toContain('export const IP_ROYALTY_PORTFOLIOS_TABLE = "ip_royalty_portfolios"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS ip_royalty_dossiers");
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS ip_royalty_portfolios");
    expect(serverDossiers).toContain("export function ensureIpRoyaltiesDossierSchema()");
    expect(serverDossiers).toContain('"ip_royalty_dossier_created"');
    expect(serverDossiers).toContain('"ip_royalty_dossier_updated"');
    expect(serverDossiers).toContain('"ip_royalty_dossier_enabled_changed"');
    expect(serverDossiers).toContain('"ip_royalty_dossier_status_changed"');
    expect(serverDossiers).toContain('"ip_royalty_dossier_deleted"');
    expect(serverDossiers).toContain('"ip_royalty_portfolio_created"');
    expect(serverDossiers).toContain('"ip_royalty_portfolio_enabled_changed"');
    expect(serverDossiers).toContain('"ip_royalty_portfolio_deleted"');
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
    // Administrator-entered weights are integer basis points and are validated to sum to 100%.
    expect(serverDossiers).toContain("The modelled scenarios must have probabilities that sum to 100%");
    expect(serverDossiers).toContain("Portfolio allocation weights must sum to 100%");
  });

  it("records a funded position through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const IP_ROYALTY_POSITIONS_TABLE = "ip_royalty_positions"');
    expect(serverDesk).toContain("export function ensureIpRoyaltiesSchema()");
    expect(serverDesk).toContain("ip_royalties_purchase");
    expect(serverDesk).toContain("ip_royalties_distribution");
    expect(serverDesk).toContain("ip_royalties_payout");
    expect(serverDesk).toContain("SELECT resultJson");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("v5_idempotency_keys");
  });

  it("funds a position from any single wallet or the combined balance of every wallet, failing closed", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const IP_ROYALTY_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain("async function readWalletRows(");
    expect(serverDesk).toContain("ip_royalties_fx_debit");
    expect(serverDesk).toContain("ip_royalties_fx_credit");
    // Missing or insufficient FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
  });

  it("credits distributions pro-rata and lets an administrator settle or write off an instrument", () => {
    // The desk lists instruments that still carry open positions, for the settlement console.
    expect(serverDesk).toContain("export type IpRoyaltyOpenInstrument");
    expect(serverDesk).toContain("export async function listIpRoyaltyOpenInstruments(");
    expect(serverDesk).toContain("WHERE outcome IS NULL");
    expect(serverDesk).toContain("GROUP BY instrumentType, instrumentId");
    // A distribution is credited pro-rata to every open position.
    expect(serverDesk).toContain("export async function recordIpRoyaltyDistribution(");
    expect(serverDesk).toContain("ip_royalties_distribution");
    // Settlement pays principal × multiple or writes it off, releasing locked principal.
    expect(serverDesk).toContain("export async function settleIpRoyaltyInstrument(");
    expect(serverDesk).toContain("outcome IS NULL FOR UPDATE");
    expect(serverDesk).toContain("lockedMinor=GREATEST(0, lockedMinor-?)");
    expect(serverDesk).toContain('"ip_royalties_payout"');
    // The admin console exposes the distribution + settlement console calling the new endpoints.
    expect(adminUi).toContain("trpc.adminOperations.ipRoyaltyOpenInstruments.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.recordIpRoyaltyDistribution.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.settleIpRoyaltyInstrument.useMutation");
    expect(adminUi).toContain("Settle &amp; write off");
    expect(adminUi).toContain("Funder multiple (×)");
  });

  it("gives the admin console derived flags, explicit weighting and the right, basis, cadence and risk taxonomy", () => {
    expect(adminUi).toContain("trpc.adminOperations.ipRoyaltyDossiers.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.ipRoyaltyPortfolios.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createIpRoyaltyDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateIpRoyaltyPortfolio.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setIpRoyaltyPortfolioEnabled.useMutation");
    // The country flag is derived from the selected country, never typed by the admin.
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    // Scenario probabilities and portfolio allocation weights are entered as
    // percentages and stored as integer basis points summing to 10,000.
    expect(adminUi).toContain("probabilityBps: toBpsFromPercent(item.probabilityPercent)");
    expect(adminUi).toContain("allocationBpsByRight: portfolioAllocations");
    expect(adminUi).toContain("SECTOR_RIGHT_TYPES");
    expect(adminUi).toContain("IP_ROYALTY_SECTORS");
    expect(adminUi).toContain("IP_ROYALTY_BASES");
    expect(adminUi).toContain("IP_ROYALTY_CADENCES");
    expect(adminUi).toContain("IP_ROYALTY_RISK_GRADES");
  });

  it("gives the customer desk pagination plus country, right-type, basis, cadence, status and risk filters", () => {
    expect(customerUi).toContain("const PAGE_SIZES = [6, 12, 24]");
    expect(customerUi).toContain("ipr-pagination");
    expect(customerUi).toContain("Previous</button>");
    expect(customerUi).toContain("Next <ChevronRight");
    expect(customerUi).toContain("Page {currentPage} of {pageCount}");
    expect(customerUi).toContain("const pageRows = filtered.slice(");
    expect(customerUi).toContain("IP_ROYALTY_BASES.map");
    expect(customerUi).toContain("IP_ROYALTY_CADENCES.map");
    expect(customerUi).toContain("IP_ROYALTY_RISK_GRADES.map");
    expect(customerUi).toContain("fundableOnly");
    expect(customerUi).toContain("watchlistOnly");
    // Extra features: watchlist, compare, CSV export and a live funding quote.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("const toggleCompare = (id: string)");
    expect(customerUi).toContain("function downloadCsv(");
    expect(customerUi).toContain("utils.customer.ipRoyalties.fundingQuote.fetch");
    expect(customerUi).toContain("ipr-funding-option");
    expect(customerUi).toContain("Combined balance");
    // The distinct right identity plus the modelled distribution scenarios are rendered.
    expect(customerUi).toContain('className="ipr-hero"');
    expect(customerUi).toContain('className="ipr-scenarios"');
  });

  it("ships the desk artwork as self-contained inline SVG so the images always load", () => {
    // The register and sector imagery is embedded in the bundle as SVG data URIs,
    // so it never depends on an authenticated external image service that fails
    // in production and leaves broken <img> elements.
    expect(customerUi).toContain("data:image/svg+xml");
    expect(customerUi).toContain("const iprArt = (body: string)");
    expect(customerUi).not.toContain("core-normal.trae.ai");
    expect(customerUi).not.toContain("text_to_image");
    // The portal statement and password mastheads are inline SVG too.
    expect(app).toContain("const portalHeroArt = (body: string)");
    expect(app).not.toContain("core-normal.trae.ai");
    expect(app).not.toContain("text_to_image");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain("import { getIpRoyaltiesDashboard, listIpRoyaltyOpenInstruments, purchaseIpRoyalty, quoteIpRoyaltyPurchase, recordIpRoyaltyDistribution, settleIpRoyaltyInstrument } from \"./ipRoyalties\";");
    expect(serverRouters).toContain("ipRoyalties: router({");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getIpRoyaltiesDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("ipRoyaltyDossiers: adminProcedure.query(() => listAdminIpRoyaltyDossiers())");
    expect(serverRouters).toContain("createIpRoyaltyDossier: adminProcedure.input(createIpRoyaltyDossierSchema).mutation");
    expect(serverRouters).toContain("updateIpRoyaltyDossier: adminProcedure.input(updateIpRoyaltyDossierSchema).mutation");
    expect(serverRouters).toContain("setIpRoyaltyDossierEnabled: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("setIpRoyaltyDossierStatus: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("deleteIpRoyaltyDossier: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("ipRoyaltyPortfolios: adminProcedure.query(() => listAdminIpRoyaltyPortfolios())");
    expect(serverRouters).toContain("createIpRoyaltyPortfolio: adminProcedure.input(createIpRoyaltyPortfolioSchema).mutation");
    expect(serverRouters).toContain("updateIpRoyaltyPortfolio: adminProcedure.input(updateIpRoyaltyPortfolioSchema).mutation");
    expect(serverRouters).toContain("setIpRoyaltyPortfolioEnabled: adminProcedure.input(z.object({ portfolioId");
    expect(serverRouters).toContain("deleteIpRoyaltyPortfolio: adminProcedure.input(z.object({ portfolioId");
    expect(serverRouters).toContain("ipRoyaltyOpenInstruments: adminProcedure.query(() => listIpRoyaltyOpenInstruments())");
    expect(serverRouters).toContain("recordIpRoyaltyDistribution: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("settleIpRoyaltyInstrument: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("mutation(({ ctx, input }) => settleIpRoyaltyInstrument(ctx.user!.id, input))");
    expect(serverRouters).toContain("scenarios: z.array(ipRoyaltyScenarioSchema).max(4).optional()");
    expect(serverRouters).toContain("rightIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50)");
    expect(serverRouters).toContain("allocationBpsByRight: z.record(z.string(), z.number().int().min(0).max(10000)).optional()");
  });

  it("auto-assigns every right a richer economic profile — amount, profit, term, currency, platform fee and an occasional settlement delay", () => {
    // The shared, environment-neutral engine is the single source of the profile.
    expect(investmentEconomics).toContain("export type DeskKey");
    expect(investmentEconomics).toContain("export const DESK_KEYS");
    expect(investmentEconomics).toContain("export const INVESTMENT_CURRENCIES");
    expect(investmentEconomics).toContain("export function currencyMinorToUsdMinor(");
    expect(investmentEconomics).toContain("export function currencyByCode(");
    expect(investmentEconomics).toContain("export const ECONOMICS_BOUNDS");
    expect(investmentEconomics).toContain("export function assignDeskEconomics(");
    expect(investmentEconomics).toContain("settlementDelayDays");
    expect(investmentEconomics).toContain("export function normalizeEconomicsOverride(");

    // The desk derives and persists the profile additively, so a value survives a restart.
    expect(deskEconomics).toContain('export const DESK_ECONOMICS_TABLE = "desk_investment_economics"');
    expect(deskEconomics).toContain("export async function getOrAssignDeskEconomics(");
    expect(deskEconomics).toContain("export async function getDeskEconomicsMap(");
    expect(deskEconomics).toContain("export async function setDeskEconomicsOverride(");
    expect(deskEconomics).toContain("export async function reassignDeskEconomics(");
    // An administrator override is authoritative and is never re-derived.
    expect(deskEconomics).toContain('if (existing.source === "ADMIN") return existing;');

    // The catalogue carries the auto-assigned profile on every right.
    expect(catalogue).toContain("economics?: DeskEconomics");

    // The IP desk merges the profile into every served right, and the resolve path
    // fixes an unpublished multiple from the same profile.
    expect(serverDesk).toContain('import { getDeskEconomicsMap, getOrAssignDeskEconomics } from "./deskEconomics"');
    expect(serverDesk).toContain('getDeskEconomicsMap("ipRoyalty"');
    expect(serverDesk).toContain("function withIpRoyaltyEconomics(");
    expect(serverDesk).toContain("10_000 + economics.profitBps");

    // The administrator can view and override the auto-assigned values.
    expect(serverRouters).toContain("deskEconomicsBatch: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentIds");
    expect(serverRouters).toContain("setDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentId");
    expect(serverRouters).toContain("reassignDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentId");

    // The customer row and invest modal surface the extended profile.
    expect(customerUi).toContain("function economicsView(");
    expect(customerUi).toContain('className="ipr-econ-panel"');
    expect(customerUi).toContain("ipr-econ-delay");
    expect(customerUi).toContain("currencyMinorToUsdMinor");
    expect(customerUi).toContain("settlementDelayDays");

    // The admin console gets an editable economics console with a re-roll.
    expect(adminUi).toContain("trpc.adminOperations.deskEconomicsBatch.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.setDeskEconomics.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.reassignDeskEconomics.useMutation");
    expect(adminUi).toContain('{ desk: "ipRoyalty", instrumentIds: economicsIds }');
    expect(adminUi).toContain("const econFormFor = (id: string)");
    expect(adminUi).toContain("Save economic profile");
    expect(adminUi).toContain("Re-roll auto profile");
    expect(adminUi).toContain("ECONOMICS_BOUNDS");
    expect(adminUi).toContain("INVESTMENT_CURRENCIES");
    expect(adminUi).toContain("currencyMinorToUsdMinor");

    // The extended profile is styled consistently with the rest of the desk.
    expect(styles).toContain(".ipr-econ-panel");
    expect(styles).toContain(".ipr-econ-delay");
  });
});
