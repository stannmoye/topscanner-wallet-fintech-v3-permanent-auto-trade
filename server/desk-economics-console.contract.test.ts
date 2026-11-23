import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const consoleUi = readFileSync(new URL("../client/src/components/AdminDeskEconomics.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/components/desk-economics-admin.css", import.meta.url), "utf8");
const serverDesk = readFileSync(new URL("./deskEconomics.ts", import.meta.url), "utf8");
const serverSources = readFileSync(new URL("./deskEconomicsSources.ts", import.meta.url), "utf8");
const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const investmentEconomics = readFileSync(new URL("../shared/investment-economics.ts", import.meta.url), "utf8");

describe("Cross-desk economics bulk editor", () => {
  it("exposes one Finance destination that opens the shared desk console", () => {
    expect(navigation).toContain('id: "desk-economics", target: "deskEconomics", label: "Desk Economics"');
    expect(navigation.match(/target: "deskEconomics"/g)).toHaveLength(1);
    const financeIndex = navigation.indexOf('id: "finance"');
    const itemIndex = navigation.indexOf('id: "desk-economics"');
    expect(financeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThan(financeIndex);

    expect(app).toContain('const AdminDeskEconomics = lazy(() => import("@/components/AdminDeskEconomics")');
    expect(app).toContain('section==="deskEconomics"&&<Suspense');
    expect(app).toContain("<AdminDeskEconomics/>");
  });

  it("loads any desk's offers through a desk dropdown instead of one console per desk", () => {
    // The console is desk-agnostic: one screen, a desk selector, driven by the
    // shared DeskKey list rather than seven duplicated components.
    expect(consoleUi).toContain("DESK_KEYS");
    expect(consoleUi).toContain("setDesk(event.target.value as DeskKey)");
    expect(consoleUi).toContain("trpc.adminOperations.deskEconomics.useQuery({ desk }");
    expect(consoleUi).toContain("deskLabel(desk)");
  });

  it("bulk- and single-edits the close deadline, payout date, amount and interest", () => {
    // Selecting (checkbox + highlighted row) is the one path for both single and
    // many edits: the same mutation is reused with a one-id list.
    expect(consoleUi).toContain("trpc.adminOperations.bulkSetDeskEconomics.useMutation");
    expect(consoleUi).toContain("onClick={() => toggle(row.instrumentId)}");
    expect(consoleUi).toContain("is-selected");
    expect(consoleUi).toContain("Extend close by (months)");
    expect(consoleUi).toContain("Extend payout by (months)");
    expect(consoleUi).toContain("Set funding target (USD)");
    expect(consoleUi).toContain("Set interest / profit (%)");
    expect(consoleUi).toContain("extendCloseMonths: extendClose");
    expect(consoleUi).toContain("extendMaturityMonths: extendPayout");
    expect(consoleUi).toContain("amountUsdMinor: amountMinor");
    expect(consoleUi).toContain("instrumentIds: selected");
    // A single-row quick action reuses the same bulk mutation with one id.
    expect(consoleUi).toContain("instrumentIds: [id]");
    // The visible list is capped so a large catalogue stays responsive.
    expect(consoleUi).toContain("VISIBLE_CAP");
    expect(styles).toContain(".de-table-row.is-selected");
  });

  it("applies the bulk edit server-side and always marks the row as administrator", () => {
    expect(routers).toContain("bulkSetDeskEconomics: adminProcedure.input(");
    expect(routers).toContain("amountUsdMinor: z.number().int().min(1)");
    expect(routers).toContain("extendCloseMonths: z.number().int().min(0).max(60)");
    expect(routers).toContain("extendMaturityMonths: z.number().int().min(0).max(60)");
    expect(serverDesk).toContain("export async function setDeskEconomicsBulkOverride(");
    expect(serverDesk).toContain("export type DeskEconomicsBulkOptions");
    // Each touched row goes through the single override writer so it is written
    // as ADMIN and can never be re-derived by the automatic assignment.
    expect(serverDesk).toContain("await setDeskEconomicsOverride(desk, id, next, adminUserId)");
    // The USD amount is converted into each row's own presentation currency.
    expect(serverDesk).toContain("usdMinorToCurrencyMinor(amountUsdMinor, current.currency)");
    // Deadlines shift by whole calendar months without drifting the day.
    expect(serverDesk).toContain("addMonthsToIsoDate(current.closeDate, extendCloseMonths)");
    expect(serverDesk).toContain("addMonthsToIsoDate(current.maturityDate, extendMaturityMonths)");
  });

  it("ships the shared helpers the console depends on", () => {
    expect(investmentEconomics).toContain("export function usdMinorToCurrencyMinor(");
    expect(investmentEconomics).toContain("export function addMonthsToIsoDate(");
  });

  it("loads each desk's live source so fresh catalogue items appear without a customer visit", () => {
    // Console action + endpoint.
    expect(consoleUi).toContain("trpc.adminOperations.syncDeskEconomics.useMutation");
    expect(consoleUi).toContain("Load live from source");
    expect(consoleUi).toContain("sync.mutate({ desk })");
    expect(routers).toContain("syncDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema })).mutation(");
    expect(routers).toContain('import { syncDeskEconomicsFromSource } from "./deskEconomicsSources"');

    // The server gathers the same live catalogue + enabled administrator records
    // that each customer dashboard merges, for every one of the seven desks.
    expect(serverSources).toContain("export async function listDeskSourceInstrumentIds(");
    expect(serverSources).toContain("export async function syncDeskEconomicsFromSource(");
    expect(serverSources).toContain("getTreasuryBondCatalogue");
    expect(serverSources).toContain("getLitigationFundsCatalogue");
    expect(serverSources).toContain("getAgroInvestmentCatalogue");
    expect(serverSources).toContain("getIpRoyaltiesCatalogue");
    expect(serverSources).toContain("getMusicRoyaltiesCatalogue");
    expect(serverSources).toContain("getCooperateDeptCatalogue");
    expect(serverSources).toContain("getCarbonInvestmentCatalogue");
    expect(serverSources).toContain("listEnabledAdminTreasuryBondInstruments");
    expect(serverSources).toContain("listEnabledAdminCooperateDeptCompanies");
    // A failed source fails soft instead of blanking the console.
    expect(serverSources).toContain("[DeskEconomicsSync] Failed to read");
    // The assigned profiles are read back through the same store the console lists.
    expect(serverSources).toContain("await getDeskEconomicsMap(desk, ids)");
    expect(serverSources).toContain("return listDeskEconomics(desk)");
  });
});
