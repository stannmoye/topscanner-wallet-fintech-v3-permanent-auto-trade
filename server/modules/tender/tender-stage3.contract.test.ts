import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TENDER_DESK_MAX_ROWS } from "./customerDesk";
import { TENDER_STATUSES } from "./provider";

/**
 * Stage 3 contract — the customer Tender Bid desk is a read-only view over real
 * ingested tenders, wired end to end (store → tRPC → customer section) and with
 * the placeholder retired.
 *
 * The reader is asserted on its source (it needs a live database, which the
 * contract harness does not provide) so the guarantees that matter — join to the
 * source registry, dedupe grouping, live status, real-data-only — are pinned.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** Strip comments so negative substring assertions test code, not prose. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const desk = read("./customerDesk.ts");
const deskCode = stripComments(desk);
const routers = read("../../routers.ts");
const app = readFileSync(new URL("../../../client/src/App.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("../../../client/src/components/CustomerTenderBid.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("../../../client/src/components/CustomerSlideMenu.tsx", import.meta.url), "utf8");

describe("Tender Bid Stage 3 — customer desk read seam", () => {
  it("reads only real ingested tenders, joined to their source registry row", () => {
    expect(desk).toContain("from(tenders)");
    expect(desk).toContain("innerJoin(tenderSources");
    expect(desk).toContain("eq(tenders.sourceId, tenderSources.id)");
    expect(desk).toContain("sourceUrl");
  });

  it("is read-only — it never writes a tender or an administrator-owned field", () => {
    expect(deskCode).not.toContain("onDuplicateKeyUpdate");
    expect(deskCode).not.toContain("db.insert");
    expect(deskCode).not.toContain("db.update");
    expect(deskCode).not.toContain("db.delete(");
  });

  it("bounds the read and fails closed when no database is available", () => {
    expect(TENDER_DESK_MAX_ROWS).toBeGreaterThan(0);
    expect(desk).toContain(".limit(TENDER_DESK_MAX_ROWS)");
    expect(desk).toContain('throw new Error("Database is not available")');
  });

  it("shows one tender per dedupe group and derives status live from the window", () => {
    expect(desk).toContain("dedupeGroup");
    expect(desk).toContain("deriveTenderStatus");
    // A recorded award outcome survives; every other status comes from the clock.
    expect(desk).toContain('if (row.status === "awarded") return "awarded";');
    expect(desk).toContain(".orderBy(desc(tenders.publishedAt), desc(tenders.id))");
  });

  it("reports a missing USD value rather than guessing one", () => {
    // USD is only ever read from the stored column, never recomputed here.
    expect(desk).toContain("contractAmountUsdMinor: safeInteger(row.contractAmountUsdMinor)");
    expect(deskCode).not.toContain("nativeMinorToUsdMinor");
    expect(deskCode).not.toContain("getFreshTradingFxRate");
  });

  it("exposes the full customer-visible status set and the detail reader", () => {
    expect(TENDER_STATUSES).toContain("closing");
    expect(desk).toContain("export async function getTenderDeskOverview");
    expect(desk).toContain("export async function getCustomerTender");
    expect(desk).toContain("descriptionText");
  });
});

describe("Tender Bid Stage 3 — server wiring", () => {
  it("exposes a protected customer.tender router over the read seam", () => {
    expect(routers).toContain('import { getCustomerTender, getTenderDeskOverview } from "./modules/tender/customerDesk";');
    expect(routers).toContain("tender: router({");
    expect(routers).toContain("overview: protectedProcedure.query(() => getTenderDeskOverview())");
    expect(routers).toContain("detail: protectedProcedure.input(z.object({ tenderId: z.number().int().positive() })).query(({ input }) => getCustomerTender(input.tenderId))");
  });
});

describe("Tender Bid Stage 3 — customer desk replaces the placeholder", () => {
  it("lazily mounts a dedicated desk for the tender-bid section", () => {
    expect(app).toContain('const CustomerTenderBid = lazy(() => import("@/components/CustomerTenderBid").then((module) => ({ default: module.CustomerTenderBid })));');
    expect(app).toContain('{section==="tender-bid"&&<Suspense');
    expect(app).toContain("<CustomerTenderBid push={push}/>");
  });

  it("excludes tender-bid from the generic placeholder and keeps it a valid section", () => {
    expect(app).toContain('item.id!=="tender-bid"');
    expect(app).toContain('"kyc","activity","notifications","advanced","support","yield","tender-bid"');
  });

  it("retires the 'planned / not live' labelling in the workspace strip", () => {
    expect(slideMenu).toContain('detail: "Live government and private tenders", target: "tender-bid"');
    expect(slideMenu).not.toMatch(/target: "tender-bid",[^\n]*planned: true/);
  });

  it("renders live tenders and opens the long description in the pop-up", () => {
    expect(component).toContain("trpc.customer.tender.overview.useQuery");
    expect(component).toContain("trpc.customer.tender.detail.useQuery");
    expect(component).toContain("descriptionText");
    expect(component).toContain("tb-modal-description");
  });

  it("shows source attribution and labels amounts as configured values, not a market quote", () => {
    expect(component).toContain("sources");
    expect(component).toContain("not a market quote");
    expect(component).toContain("No tenders to display yet");
  });
});
