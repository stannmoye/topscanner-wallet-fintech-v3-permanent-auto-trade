import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminMusicRoyalties.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/CustomerMusicRoyalties.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/music-royalties.css", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../shared/music-royalties-catalogue.ts", import.meta.url), "utf8");
const serverDossiers = readFileSync(new URL("./musicRoyaltyDossiers.ts", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./musicRoyalties.ts", import.meta.url), "utf8");
const serverRouters = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Music Royalties desk", () => {
  it("exposes one Finance destination that opens the dedicated music console", () => {
    expect(navigation).toContain('id: "music-royalties", target: "musicRoyaltyDossiers", label: "Music Royalties"');
    expect(navigation.match(/target: "musicRoyaltyDossiers"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const miningIndex = navigation.indexOf('id: "mining"');
    const itemIndex = navigation.indexOf('id: "music-royalties"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);
    expect(itemIndex).toBeLessThan(miningIndex);

    expect(app).toContain('const AdminMusicRoyalties = lazy(() => import("@/components/AdminMusicRoyalties")');
    expect(app).toContain('section==="musicRoyaltyDossiers"&&<Suspense');
    expect(app).toContain("<AdminMusicRoyalties/>");
  });

  it("replaces the generic customer placeholder with the live Music Royalties desk", () => {
    expect(app).toContain('const CustomerMusicRoyalties = lazy(() => import("@/components/CustomerMusicRoyalties")');
    expect(app).toContain('section==="music-royalties"&&<Suspense');
    expect(app).toContain("<CustomerMusicRoyalties push={push}/>");
    // The generic placeholder must explicitly exclude music-royalties now.
    expect(app).toContain('item.id!=="ip-royalties"&&item.id!=="music-royalties")&&<CustomerInvestmentCategory');
    // The customer menu reaches the desk through the shared slide menu.
    expect(slideMenu).toContain('target: "music-royalties"');

    expect(customerUi).toContain("trpc.customer.musicRoyalties.market.useQuery");
    // Customers purchase a music opportunity: the desk says "purchase", never "commit".
    expect(customerUi).toContain("trpc.customer.musicRoyalties.purchase.useMutation");
    expect(customerUi).not.toContain("musicRoyalties.commit");
    expect(customerUi).toContain("idempotencyKey: crypto.randomUUID()");
    // The investment button debits the wallet on submit.
    expect(customerUi).toContain("Confirm & debit wallet");
    expect(customerUi).toContain("Your wallet will be debited on submit");
  });

  it("carries at least twelve music-only types — shows, concerts, artists, albums, endorsements, labels and rights", () => {
    expect(catalogue).toContain("export const MUSIC_INVESTMENT_TYPES");
    // The 14 music-only types the brief asked for.
    for (const type of [
      '"SHOW_CONCERT"', '"FESTIVAL"', '"TOUR"', '"NEW_ARTIST"', '"NEW_ALBUM"', '"ENDORSEMENT_DEAL"',
      '"BRAND_LABEL"', '"MASTER_RIGHTS"', '"PUBLISHING_CATALOGUE"', '"SYNC_LICENSING"', '"MERCHANDISE"',
      '"MUSIC_VIDEO"', '"CATALOGUE_ACQUISITION"', '"ROYALTY_STREAM"',
    ]) expect(catalogue).toContain(type);
    // Grouped once and shared by both UIs.
    expect(catalogue).toContain("export const MUSIC_TYPE_GROUPS");
    expect(catalogue).toContain('"Live & Events"');
    expect(catalogue).toContain('"Artists & Releases"');
    expect(catalogue).toContain('"Rights & Catalogue"');
    expect(catalogue).toContain('"Brands & Commercial"');
    expect(catalogue).toContain("export const MUSIC_GENRES");
    expect(catalogue).toContain("export const MUSIC_STAGES");
    expect(catalogue).toContain("export const MUSIC_DOSSIER_STATUSES");
    expect(catalogue).toContain("export const MUSIC_RISK_GRADES");
    expect(catalogue).toContain("export const MUSIC_OUTCOMES");
    expect(catalogue).toContain("export const MUSIC_TERRITORY_BANDS");
    expect(catalogue).toContain("export const MUSIC_VALUE_BANDS");
    expect(catalogue).toContain("export function classifyMusicType(");
    // Both desks render the grouped picker / lanes.
    expect(adminUi).toContain("MusicTypeOptions");
    expect(adminUi).toContain("MUSIC_TYPE_GROUPS.map");
    expect(customerUi).toContain("MUSIC_TYPE_GROUPS.map");
    expect(customerUi).toContain("MUSIC_INVESTMENT_TYPES.map");
    // The AI classification and the whole catalogue stay strictly music-only.
    expect(catalogue).toContain("Music Royalties desk — the music-only catalogue");
  });

  it("lets customers invest in upcoming shows and concerts through a dedicated live reel", () => {
    expect(customerUi).toContain('const LIVE_TYPES: MusicInvestmentType[] = ["SHOW_CONCERT", "FESTIVAL", "TOUR"]');
    expect(customerUi).toContain("liveReel");
    expect(customerUi).toContain('aria-label="Upcoming shows and concerts"');
    expect(customerUi).toContain("Upcoming shows &amp; concerts");
    // The live tab paginates only fundable live opportunities.
    expect(customerUi).toContain('filtered.filter((item) => item.fundable && LIVE_TYPES.includes(item.musicType))');
  });

  it("discovers honest, cited public music catalogues and invents no deal economics", () => {
    expect(catalogue).toContain("export async function getMusicRoyaltiesCatalogue(");
    expect(catalogue).toContain("export async function findMusicOpportunity(");
    expect(catalogue).toContain("export function buildMusicAnalytics(");
    expect(catalogue).toContain('export const MUSIC_DESK_CURRENCY = "USD"');
    expect(catalogue).toContain("export type MusicRoyaltiesSource");
    expect(catalogue).toContain('status: "ok" | "degraded" | "unavailable"');
    // Discovery drains only the free, keyless Apple iTunes Search API; nothing is synthesized.
    expect(catalogue).toContain('const ITUNES_SEARCH = "https://itunes.apple.com/search"');
    // Discovery contributes cited candidates only: every candidate is fundable:false.
    expect(catalogue).toContain("fundable: false");
    // The shared provider must stay environment-neutral so it also runs as the browser fallback.
    expect(catalogue).not.toContain("process.env");
    expect(catalogue).not.toContain("node:");
    // The customer desk states plainly that a cited reference is not open for investment.
    expect(customerUi).toContain("Catalogue reference only — no published economics");
    expect(customerUi).toContain('item.fundable ? "Invest now" : "Not open"');
  });

  it("keeps economics admin-sourced: an opportunity is fundable only once a sourced dossier is published", () => {
    expect(catalogue).toContain("export function defaultMusicMilestones(");
    expect(catalogue).toContain('"WRITE_OFF"');
    // Only a FUNDING record with a modelled, sourced funding target is fundable.
    expect(adminUi).toContain('row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome');
    expect(adminUi).toContain("Not modelled — customers cannot invest until the outcomes and a funding target are published with a cited source.");
    expect(serverDossiers).toContain('"A modelled opportunity must cite its source URL so the economics can be verified"');
  });

  it("stores administrator dossiers additively with an audited lifecycle", () => {
    expect(serverDossiers).toContain('export const MUSIC_DOSSIERS_TABLE = "music_royalty_dossiers"');
    expect(serverDossiers).toContain("CREATE TABLE IF NOT EXISTS music_royalty_dossiers");
    expect(serverDossiers).toContain("export function ensureMusicRoyaltyDossierSchema()");
    expect(serverDossiers).toContain("export function dossierRowToOpportunity(");
    expect(serverDossiers).toContain('"music_dossier_created"');
    expect(serverDossiers).toContain('"music_dossier_updated"');
    expect(serverDossiers).toContain('"music_dossier_enabled"');
    expect(serverDossiers).toContain('"music_dossier_disabled"');
    expect(serverDossiers).toContain('"music_dossier_status_changed"');
    expect(serverDossiers).toContain('"music_milestone_reached"');
    expect(serverDossiers).toContain('"music_dossier_deleted"');
    expect(serverDossiers).toContain('"music_royalty_dossier"');
    expect(serverDossiers).toContain("INSERT INTO v5_audit_events");
    // Administrator-entered weights are integer basis points and are validated to sum to 100%.
    expect(serverDossiers).toContain("Scenario probabilities must sum to exactly 100%");
    expect(serverDossiers).toContain("Milestone release weights must sum to exactly 100% of escrow");
  });

  it("records a funded position through the audited wallet ledger with idempotency", () => {
    expect(serverDesk).toContain('export const MUSIC_POSITIONS_TABLE = "music_royalty_positions"');
    expect(serverDesk).toContain("export function ensureMusicRoyaltiesSchema()");
    expect(serverDesk).toContain("music_royalties_purchase");
    expect(serverDesk).toContain("music_royalties_distribution");
    expect(serverDesk).toContain("music_royalties_payout");
    expect(serverDesk).toContain("SELECT resultJson");
    expect(serverDesk).toContain("FOR UPDATE");
    expect(serverDesk).toContain("v5_idempotency_keys");
    // The purchase debits the customer wallet through the guarded balance UPDATE.
    expect(serverDesk).toContain("lockedMinor=lockedMinor+?");
    expect(serverDesk).toContain("INSERT INTO customer_balances");
  });

  it("funds a position from any single wallet or the combined balance of every wallet, failing closed", () => {
    // The desk reuses the shared cross-wallet FX engine so nothing is hard-coded.
    expect(serverDesk).toContain('from "./modules/trading-wallet-fx"');
    expect(serverDesk).toContain("planCrossWalletFunding");
    expect(serverDesk).toContain("calculateCombinedAvailableTargetMinor");
    expect(serverDesk).toContain("getFreshTradingFxRate");
    expect(serverDesk).toContain("getWalletFundingPriorityForFunding");
    expect(serverDesk).toContain('export const MUSIC_COMBINED_SOURCE = "COMBINED"');
    expect(serverDesk).toContain("music_royalties_fx_debit");
    expect(serverDesk).toContain("music_royalties_fx_credit");
    // Missing or insufficient FX fails closed rather than silently skipping a wallet.
    expect(serverDesk).toContain("Insufficient combined spendable wallet balance at current exchange rates");
  });

  it("credits distributions pro-rata and lets an administrator settle or write off an instrument", () => {
    // The desk lists instruments that still carry open positions, for the settlement console.
    expect(serverDesk).toContain("export type MusicOpenInstrument");
    expect(serverDesk).toContain("export async function listMusicOpenInstruments(");
    expect(serverDesk).toContain("WHERE outcome IS NULL");
    expect(serverDesk).toContain("GROUP BY instrumentId");
    // A distribution is credited pro-rata to every open position.
    expect(serverDesk).toContain("export async function recordMusicDistribution(");
    expect(serverDesk).toContain("music_royalties_distribution");
    // Settlement pays principal × multiple or writes it off, releasing locked principal.
    expect(serverDesk).toContain("export async function settleMusicInstrument(");
    expect(serverDesk).toContain("outcome IS NULL FOR UPDATE");
    expect(serverDesk).toContain("lockedMinor=GREATEST(0, lockedMinor-?)");
    expect(serverDesk).toContain('"music_royalties_payout"');
    // The admin console exposes the distribution + settlement console calling the new endpoints.
    expect(adminUi).toContain("trpc.adminOperations.musicOpenInstruments.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.recordMusicDistribution.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.settleMusicInstrument.useMutation");
    expect(adminUi).toContain("Settle &amp; write off");
    expect(adminUi).toContain("Funder multiple (×)");
  });

  it("gives the admin console a type picker, derived flags and the full music taxonomy", () => {
    expect(adminUi).toContain("trpc.adminOperations.musicDossiers.useQuery");
    expect(adminUi).toContain("trpc.adminOperations.createMusicDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.updateMusicDossier.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setMusicDossierEnabled.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.setMusicDossierStatus.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.reachMusicMilestone.useMutation");
    expect(adminUi).toContain("trpc.adminOperations.deleteMusicDossier.useMutation");
    // The country flag is derived from the selected country, never typed by the admin.
    expect(adminUi).toContain("COUNTRY_OPTIONS.map");
    expect(adminUi).toContain("{flagFor(country.code)} {country.name} ({country.code})");
    // Scenario probabilities and milestone releases are entered as percentages and stored as bps.
    expect(adminUi).toContain("probabilityBps: toBpsFromPercent(item.probabilityPercent)");
    expect(adminUi).toContain("releaseBps: toBpsFromPercent(item.releasePercent)");
    expect(adminUi).toContain("MUSIC_GENRES");
    expect(adminUi).toContain("MUSIC_STAGES");
    expect(adminUi).toContain("MUSIC_DOSSIER_STATUSES");
    expect(adminUi).toContain("MUSIC_RISK_GRADES");
    expect(adminUi).toContain("MUSIC_OUTCOMES");
    expect(adminUi).toContain("MUSIC_TERRITORY_BANDS");
  });

  it("gives the customer desk pagination plus genre, type, status, stage, risk and territory filters", () => {
    expect(customerUi).toContain("const PAGE_SIZES = [6, 12, 24]");
    expect(customerUi).toContain("mr-pagination");
    expect(customerUi).toContain("Previous</button>");
    expect(customerUi).toContain("Page {currentPage} of {pageCount}");
    expect(customerUi).toContain("const pageRows = scoped.slice(");
    expect(customerUi).toContain("MUSIC_GENRES.map");
    expect(customerUi).toContain("MUSIC_STAGES.map");
    expect(customerUi).toContain("MUSIC_RISK_GRADES.map");
    expect(customerUi).toContain("MUSIC_TERRITORY_BANDS.map");
    expect(customerUi).toContain("fundableOnly");
    expect(customerUi).toContain("watchlistOnly");
    // Extra features: watchlist, CSV export and a live funding quote.
    expect(customerUi).toContain("WATCHLIST_KEY");
    expect(customerUi).toContain("function downloadCsv(");
    expect(customerUi).toContain("utils.customer.musicRoyalties.fundingQuote.fetch");
    expect(customerUi).toContain("mr-funding-option");
    expect(customerUi).toContain("Combined balance");
    // The distinct stage identity plus the modelled scenarios are rendered.
    expect(customerUi).toContain('className="mr-hero"');
    expect(customerUi).toContain('className="mr-scenarios"');
  });

  it("blends the desk into the portal theme instead of owning a fixed palette", () => {
    expect(customerUi).toContain('import "./music-royalties.css"');
    expect(adminUi).toContain('import "./music-royalties.css"');
    // Surfaces, borders, text, headings, gold, red and green all derive from the
    // active portal theme tokens so the desk blends with every theme (incl. light).
    expect(styles).toContain("--mr-surface: var(--arb-color-surface)");
    expect(styles).toContain("--mr-surface-2: var(--arb-color-surface-raised)");
    expect(styles).toContain("--mr-white: var(--arb-color-text)");
    expect(styles).toContain("--mr-muted: var(--arb-color-text-muted)");
    expect(styles).toContain("--mr-blue-heading: var(--arb-color-info)");
    expect(styles).toContain("--mr-gold: var(--arb-color-warning)");
    expect(styles).toContain("--mr-red: var(--arb-color-danger)");
    expect(styles).toContain("--mr-green: var(--arb-color-accent)");
    expect(styles).toContain("color-mix(in srgb, var(--arb-color-border)");
    // The page background is the theme canvas, not an opaque fixed navy island.
    expect(styles).toContain("var(--arb-color-canvas)");
    // The desk must not re-introduce its own fixed navy palette.
    expect(styles).not.toContain("--mr-navy-950");
    expect(styles).not.toContain("#04101f");
    // Blue section headings, a gold investment button and its own spinner.
    expect(styles).toContain(".mr-section-head h2");
    expect(styles).toContain(".mr-title");
    expect(styles).toContain(".mr-btn--invest");
    expect(styles).toContain("@keyframes mr-spin");
    expect(styles).toContain(".mr-btn--danger");
    // The gold investment button uses the theme's on-colour for contrast.
    expect(styles).toContain("color: var(--arb-color-canvas)");
  });

  it("exposes guarded customer and admin endpoints for the full lifecycle", () => {
    expect(serverRouters).toContain('import { getMusicRoyaltiesDashboard, listMusicOpenInstruments, purchaseMusicOpportunity, quoteMusicPurchase, recordMusicDistribution, settleMusicInstrument } from "./musicRoyalties";');
    expect(serverRouters).toContain("musicRoyalties: router({");
    expect(serverRouters).toContain("market: protectedProcedure.query(({ ctx }) => getMusicRoyaltiesDashboard(ctx.user.id))");
    expect(serverRouters).toContain("fundingQuote: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain("purchase: protectedProcedure.input(z.object({");
    expect(serverRouters).toContain('title: "Music Royalties investment recorded"');
    expect(serverRouters).toContain("musicDossiers: adminProcedure.query(() => listAdminMusicDossiers())");
    expect(serverRouters).toContain("createMusicDossier: adminProcedure.input(createMusicDossierSchema).mutation");
    expect(serverRouters).toContain("updateMusicDossier: adminProcedure.input(updateMusicDossierSchema).mutation");
    expect(serverRouters).toContain("setMusicDossierEnabled: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("setMusicDossierStatus: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("reachMusicMilestone: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("deleteMusicDossier: adminProcedure.input(z.object({ dossierId");
    expect(serverRouters).toContain("musicOpenInstruments: adminProcedure.query(() => listMusicOpenInstruments())");
    expect(serverRouters).toContain("recordMusicDistribution: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("settleMusicInstrument: adminProcedure.input(z.object({");
    expect(serverRouters).toContain("mutation(({ ctx, input }) => settleMusicInstrument(ctx.user!.id, input))");
    // The 14-value music-only type enum plus the bounded scenario/milestone arrays.
    expect(serverRouters).toContain('musicType: z.enum(["SHOW_CONCERT", "FESTIVAL", "TOUR", "NEW_ARTIST", "NEW_ALBUM", "ENDORSEMENT_DEAL", "BRAND_LABEL", "MASTER_RIGHTS", "PUBLISHING_CATALOGUE", "SYNC_LICENSING", "MERCHANDISE", "MUSIC_VIDEO", "CATALOGUE_ACQUISITION", "ROYALTY_STREAM"])');
    expect(serverRouters).toContain("scenarios: z.array(musicScenarioSchema).max(3).nullable().optional()");
    expect(serverRouters).toContain("milestones: z.array(musicMilestoneSchema).max(10).nullable().optional()");
  });
});
