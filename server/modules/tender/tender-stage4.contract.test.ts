import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TENDER_BID_STATUSES } from "./provider";
import { TENDER_BID_QUEUE_MAX_ROWS } from "./bidding";

/**
 * Stage 4 contract — the Tender Bid bidding flow is fail-closed, idempotent and
 * ledger-disciplined, wired end to end (bidding module → tRPC → customer bid
 * panel), and it resolves the spec's open item for the administrator-charge
 * ledger classification.
 *
 * The service is asserted on its source (it needs a live database, which the
 * contract harness does not provide) so the guarantees that matter — configured
 * amount required, open window only, no bid recorded on a shortfall, a single
 * classified audited charge per bid, admin notification — are pinned.
 *
 * Spec §11 Stage 4 "Done when": a bid notifies admins; the charge posts a
 * classified ledger entry; insufficient balance prompts a deposit and records no
 * bid. Spec §12 guardrails and §13 (open item) are asserted below.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** Strip comments so negative substring assertions test code, not prose. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const bidding = read("./bidding.ts");
const biddingCode = stripComments(bidding);
const db = read("../../db.ts");
const routers = read("../../routers.ts");
const component = readFileSync(new URL("../../../client/src/components/CustomerTenderBid.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../../client/src/components/tender-bid.css", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../drizzle/0125_tender_bid.sql", import.meta.url), "utf8");

describe("Tender Bid Stage 4 — bidding service is fail-closed", () => {
  it("requires a database, a configured qualification amount and an open window", () => {
    expect(bidding).toContain('throw new Error("Database is not available")');
    // No configured amount ⇒ no bid (fail closed).
    expect(bidding).toContain("qualificationUsdMinor == null");
    expect(bidding).toContain("has not been configured yet, so bidding is not open.");
    // Only an open/closing tender can be bid on.
    expect(bidding).toContain('if (status !== "open" && status !== "closing")');
  });

  it("values the combined eligible balance from a fresh FX quote and fails closed on an unknown rate", () => {
    expect(bidding).toContain("calculateCombinedBalanceSnapshot");
    expect(bidding).toContain("getFreshTradingFxRate");
    // A foreign wallet without a fresh quote makes the total unknown → no bid.
    expect(bidding).toContain('if (snapshot.balanceStatus === "unknown")');
    expect(bidding).toContain("availableUsdMinor: null");
  });

  it("records no bid when the balance is short and returns the required amount for the deposit prompt", () => {
    expect(bidding).toContain('status: "insufficient_balance" as const');
    expect(bidding).toContain("requiredUsdMinor");
    expect(bidding).toContain("shortfallUsdMinor");
    // The bid row is only written after the sufficiency gate, so a shortfall
    // can never create a bid.
    const gate = bidding.indexOf('if (!valuation.sufficient)');
    const insert = bidding.indexOf(".insert(tenderBids)");
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
  });
});

describe("Tender Bid Stage 4 — ids, idempotency and one bid per tender", () => {
  it("bounds the queue and exposes the full bid status set", () => {
    expect(TENDER_BID_QUEUE_MAX_ROWS).toBeGreaterThan(0);
    expect(bidding).toContain(".limit(TENDER_BID_QUEUE_MAX_ROWS)");
    for (const status of ["placed", "charge_pending", "charged", "won", "lost", "cancelled"]) {
      expect(TENDER_BID_STATUSES).toContain(status);
    }
  });

  it("is idempotent: a hashed key plus a unique (userId, tenderId) and a duplicate-key fallback", () => {
    expect(bidding).toContain('crypto.createHash("sha256")');
    expect(bidding).toContain("eq(tenderBids.userId, userId), eq(tenderBids.tenderId, tenderId)");
    expect(bidding).toContain('code === "ER_DUP_ENTRY"');
    // The uniqueness is enforced in the schema/migration, not only in code.
    expect(migration).toContain("tender_bids_user_tender_uq");
    expect(migration).toContain("tender_bids_idempotency_uq");
  });

  it("locks the bid row for update before an administrative transition", () => {
    expect(bidding).toContain('.for("update")');
  });
});

describe("Tender Bid Stage 4 — administrator charge is a classified audited ledger entry", () => {
  it("posts the charge through the classified manual-adjustment ledger path", () => {
    expect(bidding).toContain("adjustCustomerBalance(");
    expect(bidding).toContain('mode: "debit"');
    // Spec §13 open item: the administrator charge is an ordinary debit, whose
    // ledger entry type resolves to `admin_debit`.
    expect(bidding).toContain('debitClassification: "ordinary_debit"');
    expect(db).toContain("`admin_${input.mode}`");
    expect(biddingCode).not.toContain("Math.random");
  });

  it("records the ledger id on the bid and audits the transition", () => {
    expect(bidding).toContain('status: "charged"');
    expect(bidding).toContain("chargeAmountUsdMinor: chargeUsdMinor, chargeLedgerId: ledger.ledgerId");
    expect(bidding).toContain("tenderBidEvents");
    expect(bidding).toContain('type: "charged"');
  });

  it("notifies administrators and opens a durable ticket on a new bid", () => {
    expect(bidding).toContain("async function notifyAdminsOfTenderBid");
    expect(bidding).toContain("createNotification(admin.id, \"New tender bid\"");
    expect(bidding).toContain("async function openTenderBidTicket");
    expect(bidding).toContain("createTicket(bid.userId");
    // Only a newly-created bid alerts, so a duplicate replay does not re-notify.
    expect(bidding).toContain("if (created) {");
    expect(bidding).toContain("await notifyAdminsOfTenderBid(bidRow, tender, valuation.availableUsdMinor)");
  });

  it("declines without moving money and only an outcome is recorded on a charged bid", () => {
    expect(bidding).toContain("export async function declineTenderBid");
    expect(bidding).toContain('status: "cancelled"');
    expect(bidding).toContain('"A charged bid cannot be declined; reverse the charge or record an outcome instead."');
    expect(bidding).toContain("export async function recordTenderBidOutcome");
    expect(bidding).toContain('if (bid.status !== "charged") throw new Error("Only a charged bid can receive an outcome.")');
  });
});

describe("Tender Bid Stage 4 — server wiring", () => {
  it("exposes the customer bid context and the idempotent placeBid mutation", () => {
    expect(routers).toContain('import { applyTenderBidCharge, declineTenderBid, getTenderBidContext, listTenderBidsForAdmin, placeTenderBid, recordTenderBidOutcome } from "./modules/tender/bidding";');
    expect(routers).toContain("bidContext: protectedProcedure.query(({ ctx }) => getTenderBidContext(ctx.user.id))");
    expect(routers).toContain("placeBid: protectedProcedure.input(z.object({");
    expect(routers).toContain("mutation(({ ctx, input }) => placeTenderBid(ctx.user.id, input))");
    expect(routers).toContain("idempotencyKey: z.string().min(8).max(160),");
  });

  it("exposes the administrator Tender Bids queue with charge, decline and outcome actions", () => {
    expect(routers).toContain("tenderBids: router({");
    expect(routers).toContain("list: adminProcedure.query(() => listTenderBidsForAdmin())");
    expect(routers).toContain("mutation(({ ctx, input }) => applyTenderBidCharge(ctx.user.id, input))");
    expect(routers).toContain("mutation(({ ctx, input }) => declineTenderBid(ctx.user.id, input))");
    expect(routers).toContain("mutation(({ ctx, input }) => recordTenderBidOutcome(ctx.user.id, input))");
    expect(routers).toContain('outcome: z.enum(["won", "lost"])');
  });
});

describe("Tender Bid Stage 4 — customer bid panel", () => {
  it("reads the customer's bids and eligible balance, and places a bid", () => {
    expect(component).toContain("trpc.customer.tender.bidContext.useQuery");
    expect(component).toContain("trpc.customer.tender.placeBid.useMutation");
    expect(component).toContain("newIdempotencyKey");
  });

  it("shows a Bid button when qualified and a deposit prompt when short", () => {
    expect(component).toContain("tb-bid-button");
    expect(component).toContain("tb-bid-deposit-button");
    expect(component).toContain("Add funds to qualify");
    // The deposit prompt links into the existing funding flow.
    expect(component).toContain('"arbitrade:customer-navigate", { detail: "wallet" }');
  });

  it("shows a server-driven status chip and never guesses a USD value client-side", () => {
    expect(component).toContain("tb-bid-chip");
    expect(component).toContain("BID_STATUS_LABELS");
    // Fail-closed stays server-side: the panel renders only what the server valued.
    expect(component).not.toContain("getFreshTradingFxRate");
    expect(component).not.toContain("calculateCombinedBalanceSnapshot");
  });

  it("labels the bid as interest only, with no wallet movement until the charge and no guaranteed award", () => {
    expect(component).toContain("No funds leave your wallet until an administrator applies the charge");
    expect(component).toContain("no award is guaranteed");
    expect(component).toContain("Valuation unavailable");
  });
});

describe("Tender Bid Stage 4 — themed bid-panel styles", () => {
  it("defines the bid-panel surfaces on the portal theme tokens", () => {
    for (const cls of ["tb-bid-panel", "tb-bid-chip", "tb-bid-figures", "tb-bid-button", "tb-bid-deposit", "tb-bid-deposit-button", "tb-bid-note"]) {
      expect(css).toContain(`.${cls}`);
    }
    expect(css).toContain(".tb-bid-chip-placed");
    expect(css).toContain(".tb-bid-chip-charged");
    expect(css).toContain(".tb-bid-chip-cancelled");
  });
});
