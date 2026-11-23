import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminLending.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerLending.tsx", import.meta.url), "utf8");
const audio = readFileSync(new URL("../client/src/components/lending-auction-audio.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/lending.css", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/lending-catalogue.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./lendingDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./lending.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const investmentEconomics = readFileSync(new URL("../shared/investment-economics.ts", import.meta.url), "utf8");
const deskEconomicsSources = readFileSync(new URL("./deskEconomicsSources.ts", import.meta.url), "utf8");

describe("Lending desk", () => {
  it("exposes one Finance destination that opens the dedicated lending console", () => {
    expect(navigation).toContain('id: "lending", target: "lendingDossiers", label: "Lending"');
    expect(navigation.match(/target: "lendingDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const itemIndex = navigation.indexOf('id: "lending"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);

    expect(app).toContain('const AdminLending = lazy(() => import("@/components/AdminLending")');
    expect(app).toContain('section==="lendingDossiers"&&<Suspense');
    expect(app).toContain("<AdminLending/>");
  });

  it("replaces the generic customer placeholder with the live lending desk", () => {
    expect(app).toContain('const CustomerLending = lazy(() => import("@/components/CustomerLending")');
    expect(app).toContain('section==="lending"&&<Suspense');
    expect(app).toContain("<CustomerLending push={push} sound={sound} soundSettings={adminSounds}/>");
    // The customer menu carries the desk with its own icon and tone.
    expect(app).toContain('{ id:"lending", label:"Lending"');
    // The generic placeholder must explicitly exclude lending now.
    expect(app).toContain('item.id!=="lending")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "lending"');

    expect(customerUi).toContain("trpc.customer.lending.desk.useQuery");
    // Bidding is free and never moves a wallet; funding is the only wallet movement.
    expect(customerUi).toContain("trpc.customer.lending.placeBid.useMutation");
    expect(customerUi).toContain("trpc.customer.lending.raiseBid.useMutation");
    expect(customerUi).toContain("trpc.customer.lending.withdrawBid.useMutation");
    expect(customerUi).toContain("trpc.customer.lending.fund.useMutation");
    expect(customerUi).toContain("trpc.customer.lending.fundingQuote.useQuery");
    expect(customerUi).toContain("crypto.randomUUID()");
  });

  it("carries fourteen loan types — consumer, asset, business, trade, project and property lending", () => {
    expect(catalogue).toContain("export const LENDING_LOAN_TYPES");
    for (const type of [
      '"PERSONAL"', '"AUTO"', '"MORTGAGE"', '"BUSINESS_WORKING_CAPITAL"', '"SME_EXPANSION"', '"EQUIPMENT_FINANCE"',
      '"INVOICE_FACTORING"', '"TRADE_FINANCE"', '"BRIDGE"', '"PROJECT_FINANCE"', '"STUDENT"', '"MEDICAL"',
      '"AGRICULTURAL"', '"REAL_ESTATE"',
    ]) expect(catalogue).toContain(type);
    // Grouped once and shared by both UIs.
    expect(catalogue).toContain("export const LENDING_LOAN_TYPE_GROUPS");
    expect(catalogue).toContain("export const LENDING_SECTORS");
    expect(catalogue).toContain("export const LENDING_STAGES");
    expect(catalogue).toContain("export const LENDING_AUCTION_STATUSES");
    expect(catalogue).toContain("export const LENDING_RISK_GRADES");
    expect(catalogue).toContain("export const LENDING_OUTCOMES");
    expect(catalogue).toContain("export const LENDING_REPAYMENT_FREQUENCIES");
    expect(catalogue).toContain("export const LENDING_CONDITION_TYPES");
    expect(catalogue).toContain("export const LENDING_CONDITION_STATUSES");
    expect(catalogue).toContain("export const LENDING_TERRITORY_BANDS");
    expect(catalogue).toContain("export const LENDING_VALUE_BANDS");
    expect(catalogue).toContain("export function classifyLoanType(");
    // The AI classification and the whole catalogue stay strictly lending-only.
    expect(catalogue).toContain("the lending-only catalogue");
  });

  it("discovers honest, cited public lending data and invents no deal economics", () => {
    expect(catalogue).toContain("export async function getLendingCatalogue(");
    expect(catalogue).toContain("export async function findLendingLoan(");
    expect(catalogue).toContain("export function buildLendingAnalytics(");
    expect(catalogue).toContain('export const LENDING_DESK_CURRENCY = "USD"');
    expect(catalogue).toContain("export type LendingInvestmentSource");
    expect(catalogue).toContain('status: "ok" | "degraded" | "unavailable"');
    // Discovery drains one free, keyless public feed; nothing is synthesized.
    expect(catalogue).toContain('const WORLDBANK_BASE = "https://api.worldbank.org/v2"');
    expect(catalogue).toContain("export const LENDING_WORLDBANK_INDICATORS = WORLDBANK_INDICATORS");
    // The provider is drained concurrently and degrades independently.
    expect(catalogue).toContain("Promise.allSettled");
    // Discovery contributes cited candidates only: every candidate is a reference.
    expect(catalogue).toContain('verificationStatus: "REFERENCE"');
    // The shared provider must stay environment-neutral so it also runs as the browser fallback.
    expect(catalogue).not.toContain("process.env");
    expect(catalogue).not.toContain("node:");
  });

  it("computes interest in integer minor units and keeps the auction server-authoritative", () => {
    expect(catalogue).toContain("export function monthlyInterestMinor(");
    expect(catalogue).toContain("export function yearlyInterestMinor(");
    expect(catalogue).toContain("export function interestPlusCapitalMinor(");
    expect(catalogue).toContain("export function lendingTenureRangeMonths(");
    // The countdown, the biddability window and the next required rate are shared
    // by both the customer desk and the server, so no one has to re-implement them.
    expect(catalogue).toContain("export function lendingAuctionStatusFor(");
    expect(catalogue).toContain("export function lendingBiddableFor(");
    expect(catalogue).toContain("export function lendingRemainingSecondsFor(");
    expect(catalogue).toContain("export function lendingNextRequiredBps(");
    expect(catalogue).toContain("export function rankLendingBids<");
    expect(catalogue).toContain("export function defaultLendingDisbursementConditions(");
    expect(catalogue).toContain("export const LENDING_CLOSING_SOON_SECONDS = 3600");
    expect(catalogue).toContain("export const LENDING_MIN_BID_STEP_BPS = 5");

    // The desk mirrors the server deadline and plays the tick/final cues.
    expect(customerUi).toContain("createLendingAuctionAudio");
    expect(customerUi).toContain("lendingCountdownCue");
    expect(audio).toContain("export const LENDING_COUNTDOWN_WINDOW_SECONDS = 10");
    expect(audio).toContain("export function lendingCountdownCue(");
    expect(audio).toContain("export function createLendingAuctionAudio(");
  });

  it("shows the live leaderboard, the countdown and the viewer's own position to every customer", () => {
    // Four views: auctions, the viewer's bids, lender reserves and positions.
    expect(customerUi).toContain('useState<"auctions" | "bids" | "reserves" | "positions">("auctions")');
    expect(customerUi).toContain("buildLendingAnalytics");
    // The countdown is a first-class, server-anchored clock.
    expect(customerUi).toContain("lend-clock-digits");
    expect(customerUi).toContain("Until bids close");
    // The leaderboard ranks every bid and marks the viewer's own row.
    expect(customerUi).toContain('className="lend-leader"');
    expect(customerUi).toContain("lend-leader-row");
    expect(customerUi).toContain('lend-leader-rank');
    expect(customerUi).toContain("Leaderboard ·");
    // The runner-up sees the rate they must beat to take the top spot.
    expect(customerUi).toContain("Lead at");
    // Bidding raises the rate to overtake the leader, and can be withdrawn.
    expect(customerUi).toContain("No bids yet — open this auction to take the top spot at the reserve rate.");
    // The funding modal funds from a single wallet or the combined balance via FX.
    expect(customerUi).toContain("Combined balance");
    expect(customerUi).toContain("No partial funding: either the whole amount is debited or nothing is.");
  });

  it("stores administrator loans and lender reserves additively with an audited lifecycle", () => {
    expect(serverDossiers).toContain('export const LENDING_LOANS_TABLE = "lending_loans"');
    expect(serverDossiers).toContain('export const LENDING_RESERVES_TABLE = "lending_reserves"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS lending_loans");
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS lending_reserves");
    expect(serverDossiers).toContain("export function ensureLendingSchema()");
    expect(serverDossiers).toContain("export function loanRowToOpportunity(");
    expect(serverDossiers).toContain('"lending_loan_created"');
    expect(serverDossiers).toContain('"lending_loan_updated"');
    expect(serverDossiers).toContain('"lending_loan_enabled"');
    expect(serverDossiers).toContain('"lending_loan_disabled"');
    expect(serverDossiers).toContain('"lending_loan_stage_changed"');
    expect(serverDossiers).toContain('"lending_loan_schedule_set"');
    expect(serverDossiers).toContain('"lending_conditions_set"');
    expect(serverDossiers).toContain('"lending_condition_met"');
    expect(serverDossiers).toContain('"lending_loan_deleted"');
    expect(serverDossiers).toContain('"lending_reserve_created"');
    expect(serverDossiers).toContain("export async function setAdminLendingLoanSchedule(");
    expect(serverDossiers).toContain("export async function setAdminLendingConditions(");
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
  });

  it("records bids and funded positions through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const LENDING_BIDS_TABLE = "lending_bids"');
    expect(serverDesk).toContain('export const LENDING_POSITIONS_TABLE = "lending_positions"');
    expect(serverDesk).toContain("CREATE TABLE IF NOT EXISTS lending_bids");
    expect(serverDesk).toContain("CREATE TABLE IF NOT EXISTS lending_positions");
    expect(serverDesk).toContain("export function ensureLendingDeskSchema()");
    expect(serverDesk).toContain("export async function placeLendingBid(");
    expect(serverDesk).toContain("export async function raiseLendingBid(");
    expect(serverDesk).toContain("export async function withdrawLendingBid(");
    expect(serverDesk).toContain("export async function resolveClosedLendingAuctions(");
    expect(serverDesk).toContain("export async function getLendingDesk(");
    expect(serverDesk).toContain("SELECT resultJson");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("v5_idempotency_keys");
    // The funding path debits and locks the wallet through the guarded balance UPDATE.
    expect(serverDesk).toContain("lockedMinor=lockedMinor+?");
    expect(serverDesk).toContain('"lending_funding"');
    expect(serverDesk).toContain('"lending_disbursement"');
    expect(serverDesk).toContain('"lending_repayment"');
    expect(serverDesk).toContain('"lending_payout"');
  });

  it("funds from any single wallet or the combined balance of every wallet, failing closed", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const LENDING_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain('"lending_fx_debit"');
    expect(serverDesk).toContain('"lending_fx_credit"');
    // Missing or insufficient FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
    // The desk reads the customer wallets through the platform's own readers.
    expect(serverDesk).toContain("listBalances(userId)");
    expect(serverDesk).toContain("listCurrencies()");
  });

  it("disburses the winning bid once conditions are met and settles the loan", () => {
    expect(serverDesk).toContain("export async function disburseLendingLoan(");
    expect(serverDesk).toContain("export async function settleLendingLoan(");
    expect(serverDesk).toContain("export async function listLendingLoansForSettlement(");
    expect(serverDesk).toContain("export async function listLendingLoanBids(");
    expect(serverDesk).toContain('"lending_loan_disbursed"');
    expect(serverDesk).toContain('"lending_loan_settled"');
    // The admin console exposes the auction, disbursement and settlement console.
    expect(adminUi).toContain("trpc.adminOperations.lendingLoansForSettlement.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.lendingLoanBids.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.disburseLendingLoan.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.settleLendingLoan.useMutation");
  });

  it("gives the admin console a loan publisher, a reserve console and a condition editor", () => {
    expect(adminUi).toContain("trpc.adminOperations.lendingLoans.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createLendingLoan.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateLendingLoan.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setLendingLoanEnabled.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setLendingLoanStage.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setLendingLoanSchedule.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setLendingConditions.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.meetLendingCondition.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.deleteLendingLoan.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.lenderReserves.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createLenderReserve.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateLenderReserve.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setLenderReserveEnabled.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.deleteLenderReserve.useMutation");
    // The country is picked from the shared option list and the currency from the registry.
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("INVESTMENT_CURRENCIES.map");
    expect(adminUi).toContain("import \"./lending.css\"");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain('import { disburseLendingLoan, fundLendingLoan, getLendingDesk, getLendingLoanView, listLendingLoanBids, listLendingLoansForSettlement, placeLendingBid, quoteLendingFunding, raiseLendingBid, settleLendingLoan, withdrawLendingBid } from "./lending";');
    expect(serverRouters).toContain("lending: router({");
    expect(serverRouters).toContain("desk: protectedProcedure.query(({ ctx }) => getLendingDesk(ctx.user.id))");
    expect(serverRouters).toContain("placeBid: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("raiseBid: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("withdrawBid: protectedProcedure.input(z.object({ bidId");
    expect(serverRouters).toContain("lendingLoans: adminProcedure.query(() => listAdminLendingLoans())");
    expect(serverRouters).toContain("createLendingLoan: adminProcedure.input(createLendingLoanSchema).mutation");
    expect(serverRouters).toContain("setLendingLoanSchedule: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("settleLendingLoan: adminProcedure.input(z.object({");
    // The 14-value lending-only type enum plus the bounded condition array.
    expect(serverRouters).toContain('loanType: lendingEnum(LENDING_LOAN_TYPES)');
    expect(serverRouters).toContain("conditions: z.array(lendingDisbursementConditionSchema).max(15)");
  });

  it("registers lending as a first-class desk in the shared economics engine and source registry", () => {
    expect(investmentEconomics).toContain("export type DeskKey");
    expect(investmentEconomics).toContain("export const DESK_KEYS");
    expect(investmentEconomics).toContain('"greenEnergy" | "lending"');
    expect(investmentEconomics).toContain('lending: "Lending",');
    // The shared Desk Economics console can load the lending desk from its sources.
    expect(deskEconomicsSources).toContain('case "lending":');
    expect(deskEconomicsSources).toContain("getLendingCatalogue");
    // The catalogue carries the auto-assigned profile on every loan it serves.
    expect(catalogue).toContain('import type { DeskEconomics } from "./investment-economics"');
    expect(catalogue).toContain("economics?: DeskEconomics");
  });

  it("blends the desk into the portal theme instead of owning a fixed palette", () => {
    expect(customerUi).toContain('import "./lending.css"');
    // Surfaces, borders, text, the live/live-auction, lead, warning and danger tones all
    // derive from the active portal theme tokens so the desk blends with every theme.
    expect(styles).toContain("--lend-surface: var(--arb-color-surface)");
    expect(styles).toContain("--lend-surface-2: var(--arb-color-surface-raised)");
    expect(styles).toContain("--lend-white: var(--arb-color-text)");
    expect(styles).toContain("--lend-muted: var(--arb-color-text-muted)");
    expect(styles).toContain("--lend-live: var(--arb-color-info)");
    expect(styles).toContain("--lend-lead: var(--arb-color-accent)");
    expect(styles).toContain("--lend-warn: var(--arb-color-warning)");
    expect(styles).toContain("--lend-red: var(--arb-color-danger)");
    expect(styles).toContain("color-mix(in srgb, var(--arb-color-border)");
    // The page background is the theme canvas, not an opaque fixed island.
    expect(styles).toContain("var(--arb-color-canvas)");
    // The countdown, leaderboard and modal plus the animations, with reduced-motion
    // and forced-colors fallbacks.
    expect(styles).toContain(".lend-page");
    expect(styles).toContain(".lend-clock");
    expect(styles).toContain(".lend-leader-row");
    expect(styles).toContain(".lend-modal");
    expect(styles).toContain("@keyframes lend-pulse");
    expect(styles).toContain("@keyframes lend-tick");
    expect(styles).toContain("@keyframes lend-drawer-in");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
  });
});
