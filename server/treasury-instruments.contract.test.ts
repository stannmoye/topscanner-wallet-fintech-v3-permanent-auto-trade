import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const adminApp = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminTreasuryInstruments.tsx", import.meta.url), "utf8");
const countryOptions = readFileSync(new URL("../shared/country-options.ts", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/treasury-bond-catalogue.ts", import.meta.url), "utf8");
const serverStore = readFileSync(new URL("./treasuryBondInstruments.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./treasuryBonds.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerTreasuryBond.tsx", import.meta.url), "utf8");

describe("Administrator treasury-instrument publishing", () => {
  it("exposes one Finance destination that opens the dedicated publishing console", () => {
    expect(navigation).toContain('id: "treasury-instruments", target: "treasuryInstruments", label: "Treasury Instruments"');
    expect(navigation.match(/target: "treasuryInstruments"/g)).toHaveLength(1);
    // It belongs to the Finance group, not the exactly-asserted Trade Settings group.
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "treasury-instruments"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);
    expect(navigation).not.toContain('id: "trade-treasury-instruments"');

    expect(adminApp).toContain('const AdminTreasuryInstruments = lazy(() => import("@/components/AdminTreasuryInstruments")');
    expect(adminApp).toContain('section==="treasuryInstruments"&&<Suspense');
    expect(adminApp).toContain("<AdminTreasuryInstruments/>");
  });

  it("derives the country flag from the selected country and never asks the admin to type it", () => {
    expect(countryOptions).toContain("export function flagFor(countryCode: string): string");
    expect(countryOptions).toContain("127397");
    expect(countryOptions).toContain("export const COUNTRY_OPTIONS");
    expect(countryOptions).toContain("export function findCountry(");

    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    expect(adminUi).toContain("Flag preview:");
    // The admin sets interest, tenor and amount; money is sent as integer minor units.
    expect(adminUi).toContain("Interest rate (% per year)");
    expect(adminUi).toContain("Tenor (years)");
    expect(adminUi).toContain("minInvestmentMinor: Math.round(minAmountValue * 100)");
  });

  it("stores the instrument additively, enabled on publish, with an audited create path", () => {
    expect(serverStore).toContain('export const TREASURY_BOND_INSTRUMENTS_TABLE = "treasury_bond_instruments"');
    expect(serverStore).toContain("CREATE TABLE IF NOT EXISTS treasury_bond_instruments");
    expect(serverStore).toContain("enabled TINYINT(1) NOT NULL DEFAULT 1");
    expect(serverStore).toContain("export function ensureTreasuryBondInstrumentsSchema()");
    // New instruments are enabled immediately: the INSERT binds the enabled column to 1.
    expect(serverStore).toContain("VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)");
    expect(serverStore).toContain("const flag = flagFor(normalized.country.code);");
    expect(serverStore).toContain('"treasury_instrument_created"');
    expect(serverStore).toContain('"treasury_instrument_updated"');
    expect(serverStore).toContain('"treasury_instrument_enabled"');
    expect(serverStore).toContain('"treasury_instrument_disabled"');
    expect(serverStore).toContain('"treasury_instrument_deleted"');
  });

  it("fails closed on invalid input before writing anything", () => {
    const start = serverStore.indexOf("function normalizeInput(");
    const end = serverStore.indexOf("\n}", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const normalize = serverStore.slice(start, end);
    expect(normalize).toContain("if (!country) throw new Error(\"Select a supported country for this instrument\")");
    expect(normalize).toContain("if (!(TREASURY_INSTRUMENT_CATEGORIES as readonly string[]).includes(input.category)) throw new Error(\"Select a valid instrument category\")");
    expect(normalize).toContain("tenorYears > 60");
    expect(normalize).toContain("couponRatePct > 100");
    expect(normalize).toContain("Number.isSafeInteger(minInvestmentMinor)");
  });

  it("merges administrator instruments into the customer desk using the shared ordering", () => {
    expect(catalogue).toContain("export function compareTreasuryBondInstruments(");
    expect(catalogue).toContain("instruments.sort(compareTreasuryBondInstruments)");

    expect(serverDesk).toContain("import { findEnabledAdminTreasuryBondInstrument, listEnabledAdminTreasuryBondInstruments } from \"./treasuryBondInstruments\"");
    expect(serverDesk).toContain("const instruments = [...adminInstruments, ...catalogue.instruments].sort(compareTreasuryBondInstruments)");
    // A purchase resolves an administrator instrument first, then falls back to the live catalogue.
    expect(serverDesk).toContain("async function resolveInstrumentForPurchase(instrumentId: string)");
    expect(serverDesk).toContain("const instrument = await resolveInstrumentForPurchase(String(input.instrumentId || \"\"))");
  });

  it("exposes guarded admin endpoints for the full instrument lifecycle", () => {
    expect(serverRouters).toContain("treasuryInstruments: adminProcedure.query(() => listAdminTreasuryBondInstruments())");
    expect(serverRouters).toContain("createTreasuryInstrument: adminProcedure.input(createTreasuryInstrumentSchema).mutation");
    expect(serverRouters).toContain("updateTreasuryInstrument: adminProcedure.input(updateTreasuryInstrumentSchema).mutation");
    expect(serverRouters).toContain("setTreasuryInstrumentEnabled: adminProcedure.input(z.object({ instrumentId");
    expect(serverRouters).toContain("deleteTreasuryInstrument: adminProcedure.input(z.object({ instrumentId");
    expect(serverRouters).toContain("couponRatePct: z.number().min(0).max(100)");
    expect(serverRouters).toContain("minInvestmentMinor: z.number().int().min(100).max(100_000_000)");
  });

  it("funds a purchase from any single wallet or the combined balance of every wallet", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const TREASURY_BOND_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain("function planPurchaseFunding(");
    expect(serverDesk).toContain("export async function quoteTreasuryBondPurchase(");
    // Every wallet is read and locked for a purchase; the plan is persisted per position.
    expect(serverDesk).toContain("async function readWalletRows(");
    expect(serverDesk).toContain("FROM customer_balances b");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("fundingSource VARCHAR(24) NULL");
    expect(serverDesk).toContain("fundingPlanJson TEXT NULL");
    expect(serverDesk).toContain("treasury_bond_fx_debit");
    expect(serverDesk).toContain("treasury_bond_fx_credit");
    // Missing FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");

    // The router exposes the preview quote and accepts the funding source.
    expect(serverRouters).toContain('import { getTreasuryBondDashboard, purchaseTreasuryBond, quoteTreasuryBondPurchase } from "./treasuryBonds";');
    expect(serverRouters).toContain("quoteTreasuryBondPurchase(ctx.user.id, input)");
    expect(serverRouters).toContain("fundingSource: z.string().trim().min(2).max(24).optional(),");

    // The desk lets the customer choose the wallet(s) and shows the live quote.
    expect(customerUi).toContain("utils.customer.treasuryBonds.fundingQuote.fetch");
    expect(customerUi).toContain("tb-funding-options");
    expect(customerUi).toContain("All wallets combined");
    expect(customerUi).toContain("function moneyMinor(");
    expect(customerUi).toContain("amountMinor: Math.round(amount), fundingSource, idempotencyKey: crypto.randomUUID()");
  });
});
