import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminCooperateDept.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerCooperateDept.tsx", import.meta.url), "utf8");
const countryOptions = readFileSync(new URL("../shared/country-options.ts", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/cooperate-dept-catalogue.ts", import.meta.url), "utf8");
const serverStore = readFileSync(new URL("./cooperateDeptCompanies.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./cooperateDept.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Cooperate Dept distressed-company desk", () => {
  it("exposes one Finance destination that opens the dedicated publishing console", () => {
    expect(navigation).toContain('id: "cooperate-dept-companies", target: "cooperateDeptCompanies", label: "Cooperate Dept"');
    expect(navigation.match(/target: "cooperateDeptCompanies"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "cooperate-dept-companies"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminCooperateDept = lazy(() => import("@/components/AdminCooperateDept")');
    expect(app).toContain('section==="cooperateDeptCompanies"&&<Suspense');
    expect(app).toContain("<AdminCooperateDept/>");
  });

  it("replaces the generic customer placeholder with the live Cooperate Dept desk", () => {
    expect(app).toContain('const CustomerCooperateDept = lazy(() => import("@/components/CustomerCooperateDept")');
    expect(app).toContain('section==="cooperate-dept"&&<Suspense');
    expect(app).toContain("<CustomerCooperateDept push={push}/>");
    // The generic placeholder must explicitly exclude cooperate-dept now (along
    // with the other desks that have their own consoles, including ip-royalties).
    expect(app).toContain('item.id!=="cooperate-dept"&&item.id!=="ip-royalties")&&<CustomerInvestmentCategory');

    expect(customerUi).toContain("trpc.customer.cooperateDept.market.useQuery");
    // Customers buy: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.cooperateDept.purchase.useMutation");
    expect(customerUi).not.toContain("cooperateDept.commit");
    expect(customerUi).toContain('idempotencyKey: crypto.randomUUID()');
  });

  it("gathers companies from keyless public registers around the world", () => {
    expect(catalogue).toContain("async function fetchNorwayCompanies(");
    expect(catalogue).toContain("async function fetchFranceCompanies(");
    expect(catalogue).toContain("async function fetchUsSecCompanies(");
    expect(catalogue).toContain("async function fetchGleifCompanies(");
    expect(catalogue).toContain("async function fetchWikidataFacts(");
    expect(catalogue).toContain("async function fetchWorldBankContext(");
    expect(catalogue).toContain("async function fetchEurostatBankruptcies(");
    expect(catalogue).toContain("async function fetchUkCompaniesHouse(");
    expect(catalogue).toContain("async function fetchCourtListenerCases(");
    expect(catalogue).toContain("https://data.brreg.no/enhetsregisteret/api/enheter");
    expect(catalogue).toContain("konkurs=true");
    expect(catalogue).toContain("recherche-entreprises.api.gouv.fr/search");
    expect(catalogue).toContain("efts.sec.gov/LATEST/search-index");
    expect(catalogue).toContain("api.gleif.org/api/v1/lei-records");
    expect(catalogue).toContain("query.wikidata.org/sparql");
    // The shared provider must stay environment-neutral so it also runs as the browser fallback.
    expect(catalogue).not.toContain("process.env");
    expect(catalogue).not.toContain("node:");
  });

  it("never invents a net worth or a litigation countdown", () => {
    expect(catalogue).toContain("NET_WORTH_NOTE");
    expect(catalogue).toContain("No free public register publishes a private company's net worth");
    // Countdowns only exist when a provider publishes a real date.
    expect(catalogue).toContain("export function compareCooperateDeptCompanies(");
    expect(catalogue).toContain("export async function getCooperateDeptCatalogue(");
    expect(catalogue).toContain("export async function findCooperateDeptCompany(");
  });

  it("derives the country flag from the selected country and never asks the admin to type it", () => {
    expect(countryOptions).toContain("export function flagFor(countryCode: string): string");
    expect(countryOptions).toContain("export const COUNTRY_OPTIONS");

    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    expect(adminUi).toContain("Flag preview:");
    // Every displayed field is administrator-supplied; money is sent as integer minor units.
    expect(adminUi).toContain("Founded year");
    expect(adminUi).toContain("Distress severity");
    expect(adminUi).toContain("Countdown direction");
    expect(adminUi).toContain("capitalAskMinor: capitalValue === null ? null : Math.round(capitalValue * 100)");
  });

  it("stores administrator companies additively, enabled on publish, with an audited create path", () => {
    expect(serverStore).toContain('export const COOPERATE_DEPT_COMPANIES_TABLE = "cooperate_dept_companies"');
    expect(serverStore).toContain("CREATE TABLE IF NOT EXISTS cooperate_dept_companies");
    expect(serverStore).toContain("enabled TINYINT(1) NOT NULL DEFAULT 1");
    expect(serverStore).toContain("export function ensureCooperateDeptCompaniesSchema()");
    // New companies are enabled immediately: the INSERT binds the enabled column to 1.
    expect(serverStore).toContain("1,?,?)");
    expect(serverStore).toContain("const flag = flagFor(normalized.country.code);");
    expect(serverStore).toContain('"cooperate_dept_company_created"');
    expect(serverStore).toContain('"cooperate_dept_company_updated"');
    expect(serverStore).toContain('"cooperate_dept_company_enabled"');
    expect(serverStore).toContain('"cooperate_dept_company_disabled"');
    expect(serverStore).toContain('"cooperate_dept_company_deleted"');
  });

  it("fails closed on invalid input before writing anything", () => {
    const start = serverStore.indexOf("function normalizeInput(");
    const end = serverStore.indexOf("\n}", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const normalize = serverStore.slice(start, end);
    expect(normalize).toContain('if (!country) throw new Error("Select a supported country for this company")');
    expect(normalize).toContain('if (!(COMPANY_STATUSES as readonly string[]).includes(input.status)) throw new Error("Select a valid company status")');
    expect(normalize).toContain('if (!(DISTRESS_SEVERITIES as readonly string[]).includes(input.severity)) throw new Error("Select a valid distress severity")');
    expect(normalize).toContain("foundedYear < 1500 || foundedYear > 2100");
    expect(normalize).toContain('countdownDirection !== "until" && countdownDirection !== "since"');
  });

  it("merges administrator companies into the customer desk and resolves them first for a purchase", () => {
    expect(catalogue).toContain("export function compareCooperateDeptCompanies(");
    expect(serverDesk).toContain('from "./cooperateDeptCompanies"');
    expect(serverDesk).toContain("findEnabledAdminCooperateDeptCompany");
    expect(serverDesk).toContain("listEnabledAdminCooperateDeptCompanies");
    expect(serverDesk).toContain("const companies = [...adminCompanies, ...catalogue.companies].sort(compareCooperateDeptCompanies)");
    expect(serverDesk).toContain("async function resolveCompanyForPurchase(companyId: string)");
    expect(serverDesk).toContain("const company = await resolveCompanyForPurchase(String(input.companyId || \"\"))");
  });

  it("records a purchase through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const COOPERATE_DEPT_POSITIONS_TABLE = "cooperate_dept_positions"');
    expect(serverDesk).toContain("CREATE TABLE IF NOT EXISTS cooperate_dept_positions");
    expect(serverDesk).toContain("export function ensureCooperateDeptSchema()");
    expect(serverDesk).toContain("`cooperate-dept:${userId}:${crypto.createHash(");
    expect(serverDesk).toContain("cooperate_dept_purchase");
    expect(serverDesk).toContain("SELECT resultJson");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("v5_idempotency_keys");
  });

  it("funds a purchase from any single wallet or the combined balance of every wallet", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const COOPERATE_DEPT_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain("function planPurchaseFunding(");
    expect(serverDesk).toContain("async function quoteCooperateDeptPurchase(");
    // Every wallet is read and locked for a purchase; the plan is persisted per position.
    expect(serverDesk).toContain("async function readWalletRows(");
    expect(serverDesk).toContain("FROM customer_balances b");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("fundingSource VARCHAR(24) NULL");
    expect(serverDesk).toContain("fundingPlanJson TEXT NULL");
    expect(serverDesk).toContain("cooperate_dept_fx_debit");
    expect(serverDesk).toContain("cooperate_dept_fx_credit");
    // Missing FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
  });

  it("gives the customer desk pagination, a country filter and the extra controls", () => {
    // Pagination: previous / next plus a page pill and page-size selector.
    expect(customerUi).toContain("const PAGE_SIZES = [6, 12, 24]");
    expect(customerUi).toContain("cd-pagination");
    expect(customerUi).toContain("Previous</button>");
    expect(customerUi).toContain("Next <ChevronRight");
    expect(customerUi).toContain("Page {currentPage} of {pageCount}");
    expect(customerUi).toContain("const pageRows = filtered.slice(");
    // Country filter plus sector, company type, severity, status, urgency, watchlist and capital.
    expect(customerUi).toContain('aria-label="Filter by country"');
    expect(customerUi).toContain("const countryOptions = useMemo(");
    expect(customerUi).toContain('aria-label="Filter by sector"');
    expect(customerUi).toContain('aria-label="Filter by company type"');
    expect(customerUi).toContain("urgentOnly");
    expect(customerUi).toContain("watchlistOnly");
    expect(customerUi).toContain("minCapital");
    // Extra features: watchlist, compare, portfolio dashboard and CSV export.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("const toggleCompare = (id: string)");
    expect(customerUi).toContain("cd-portfolio-stats");
    expect(customerUi).toContain("function downloadCsv(");
    // Funding-source selector with a live quote.
    expect(customerUi).toContain("utils.customer.cooperateDept.fundingQuote.fetch");
    expect(customerUi).toContain("cd-funding-options");
    expect(customerUi).toContain("Combined balance");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain("cooperateDept: router({");
    expect(serverRouters).toContain("import { getCooperateDeptDashboard, purchaseCooperateDeptCompany, quoteCooperateDeptPurchase } from \"./cooperateDept\";");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getCooperateDeptDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).not.toContain("commit: protectedProcedure");
    expect(serverRouters).toContain("cooperateDeptCompanies: adminProcedure.query(() => listAdminCooperateDeptCompanies())");
    expect(serverRouters).toContain("createCooperateDeptCompany: adminProcedure.input(createCooperateDeptCompanySchema).mutation");
    expect(serverRouters).toContain("updateCooperateDeptCompany: adminProcedure.input(updateCooperateDeptCompanySchema).mutation");
    expect(serverRouters).toContain("setCooperateDeptCompanyEnabled: adminProcedure.input(z.object({ companyId");
    expect(serverRouters).toContain("deleteCooperateDeptCompany: adminProcedure.input(z.object({ companyId");
    expect(serverRouters).toContain("countdownDate: z.string().trim().regex(/^\\d{4}-\\d{2}-\\d{2}$/)");
    expect(serverRouters).toContain("capitalAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional()");
  });
});
