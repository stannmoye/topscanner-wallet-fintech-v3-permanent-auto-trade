import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { adjustCustomerBalance, createNotification, createTicket, getDb, getFreshTradingFxRate } from "../../db";
import { customerBalances, currencyRegistry, tenderBidEvents, tenderBids, tenders, users } from "../../../drizzle/schema";
import { deriveTenderStatus } from "./normalise";
import { calculateCombinedBalanceSnapshot, type FxRateSnapshot } from "../trading-wallet-fx";
import type { TenderBidStatus } from "./provider";

/**
 * Tender Bid — bidding (Stage 4).
 *
 * The customer bids on a real, open tender; the server re-checks the bidding
 * window and the qualification amount, values the customer's eligible balance
 * across every wallet at a fresh FX rate, and fails closed whenever a value is
 * missing. A bid is only recorded when the balance qualifies — otherwise the
 * customer is prompted to deposit and nothing is written.
 *
 * Placing a bid moves no money. The administrative charge (equal to the
 * configured qualification amount) is applied manually by an administrator
 * through the existing classified manual-adjustment ledger path, so every charge
 * is a classified, reversible, audited internal-ledger entry. Reversals are
 * compensating entries; historical rows are never edited.
 */

/** Upper bound on the bids read in one queue/context request. */
export const TENDER_BID_QUEUE_MAX_ROWS = 500;

/** Every tender charge settles in USD minor units, matching the configured amount. */
const SETTLEMENT_CURRENCY = "USD";

type WalletRow = {
  currency: string;
  scale: number;
  assetType: "fiat" | "crypto" | "token";
  externalCode: string | null;
  availableMinor: number;
};

type TenderRow = typeof tenders.$inferSelect;
type BidRow = typeof tenderBids.$inferSelect;

export type TenderBidView = {
  id: number;
  tenderId: number;
  status: TenderBidStatus;
  qualificationAmountUsdMinor: number;
  chargeAmountUsdMinor: number | null;
  chargeLedgerId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TenderBidContext = {
  bids: TenderBidView[];
  /** Combined eligible balance across all wallets in USD minor units, or null when it cannot be valued. */
  eligibleUsdMinor: number | null;
  valuationAvailable: boolean;
};

export type TenderBidQueueRow = TenderBidView & {
  tenderTitle: string;
  tenderCountry: string;
  tenderSourceUrl: string;
  customerName: string | null;
  customerEmail: string | null;
  /** Eligible balance the customer held when they bid, or null when it was not valued. */
  balanceAtBidUsdMinor: number | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fmtUsd(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A recorded award outcome survives; every other status is derived from the bidding window. */
function liveTenderStatus(row: TenderRow): string {
  if (row.status === "awarded") return "awarded";
  return deriveTenderStatus({ bidOpenAt: iso(row.bidOpenAt), bidCloseAt: iso(row.bidCloseAt) });
}

function usdUnitRate(scale: number): FxRateSnapshot {
  return {
    currency: SETTLEMENT_CURRENCY,
    scale,
    rateUsdPerUnit: "1",
    provider: "platform-parity",
    sourceDate: new Date().toISOString().slice(0, 10),
    fetchedAt: new Date(),
  };
}

function toBidView(row: BidRow): TenderBidView {
  return {
    id: Number(row.id),
    tenderId: Number(row.tenderId),
    status: row.status as TenderBidStatus,
    qualificationAmountUsdMinor: Number(row.qualificationAmountUsdMinor),
    chargeAmountUsdMinor: row.chargeAmountUsdMinor == null ? null : Number(row.chargeAmountUsdMinor),
    chargeLedgerId: row.chargeLedgerId == null ? null : Number(row.chargeLedgerId),
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

/**
 * Read every enabled wallet for a customer. Balances and currency metadata are
 * read separately and merged in code rather than with a SQL join: `customer_balances`
 * inherits the database default collation while `currency_registry` is pinned to
 * utf8mb4_unicode_ci, so joining them fails with "Illegal mix of collations" on
 * databases whose default differs.
 */
async function readWalletRows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number): Promise<WalletRow[]> {
  const [balanceRows, currencyRows] = await Promise.all([
    db.select({ currency: customerBalances.currency, availableMinor: customerBalances.availableMinor })
      .from(customerBalances).where(eq(customerBalances.userId, userId)),
    db.select({ code: currencyRegistry.code, scale: currencyRegistry.scale, assetType: currencyRegistry.assetType, externalCode: currencyRegistry.externalCode })
      .from(currencyRegistry).where(eq(currencyRegistry.enabled, true)),
  ]);
  const byCode = new Map(currencyRows.map((currency) => [String(currency.code).toUpperCase(), currency]));
  const wallets: WalletRow[] = [];
  for (const row of balanceRows) {
    const code = String(row.currency).toUpperCase();
    const currency = byCode.get(code);
    if (!currency) continue;
    wallets.push({
      currency: code,
      scale: Number(currency.scale || 0),
      assetType: currency.assetType as WalletRow["assetType"],
      externalCode: currency.externalCode ? String(currency.externalCode) : null,
      availableMinor: Number(row.availableMinor || 0),
    });
  }
  return wallets;
}

/** A fresh-rate resolver: USD is platform parity; every other wallet is a live quote, or null when unavailable. */
function freshRateResolver(wallets: WalletRow[]) {
  return async (currency: string, scale: number): Promise<FxRateSnapshot | null> => {
    if (currency === SETTLEMENT_CURRENCY) return usdUnitRate(scale);
    const wallet = wallets.find((entry) => entry.currency === currency);
    if (!wallet) return null;
    try {
      return await getFreshTradingFxRate({ code: currency, scale, assetType: wallet.assetType, externalCode: wallet.externalCode });
    } catch {
      return null;
    }
  };
}

/**
 * Value the customer's combined eligible balance in USD. Any positive foreign
 * balance without a fresh quote makes the total unknown (fail closed) rather than
 * silently under-counting it.
 */
async function valueEligible(wallets: WalletRow[], requiredMinor: number) {
  const usdWallet = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const targetScale = usdWallet ? usdWallet.scale : 2;
  const snapshot = await calculateCombinedBalanceSnapshot({
    targetCurrency: SETTLEMENT_CURRENCY,
    targetScale,
    requiredMinor,
    wallets: wallets.map((wallet) => ({ currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor })),
    getFreshRate: freshRateResolver(wallets),
  });
  if (snapshot.balanceStatus === "unknown") {
    return { availableUsdMinor: null, sufficient: false, shortfallUsdMinor: requiredMinor };
  }
  return {
    availableUsdMinor: snapshot.availableMinor,
    sufficient: snapshot.balanceStatus === "sufficient",
    shortfallUsdMinor: snapshot.shortfallMinor,
  };
}

// Best-effort, post-commit administrator alert mirroring notifyAdminsOfPayoutRequest.
async function notifyAdminsOfTenderBid(bid: BidRow, tender: TenderRow, availableUsdMinor: number | null) {
  try {
    const db = await getDb();
    if (!db) return;
    const customer = (await db.select({ name: users.name, email: users.email })
      .from(users).where(eq(users.id, Number(bid.userId))).limit(1))[0];
    const balance = availableUsdMinor == null ? "not valued" : fmtUsd(availableUsdMinor);
    const body = `Tender bid #${bid.id} from ${customer?.name || "a customer"} (${customer?.email || "no email on file"}, account ${bid.userId}) on “${tender.title}” (${tender.countryCode || "—"}). Qualification amount: ${fmtUsd(Number(bid.qualificationAmountUsdMinor))}. Eligible balance at bid time: ${balance}. Review it in the Tender Bids queue and apply the charge or decline it.`;
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    const results = await Promise.allSettled(admins.map((admin) => createNotification(admin.id, "New tender bid", body, {
      eventKey: `tender-bid:${bid.id}:admin:${admin.id}`,
      category: "transaction",
      priority: "high",
      href: "/admin",
    })));
    if (results.some((result) => result.status === "rejected")) console.error("[Notifications] One or more admin tender-bid notices failed after commit.");
  } catch (error) {
    console.error("[Notifications] Admin tender-bid notices failed after commit:", error instanceof Error ? error.name : "UnknownError");
  }
}

// Best-effort, post-commit support ticket so a bid also lands in the administrator ticket desk.
async function openTenderBidTicket(bid: BidRow, tender: TenderRow, availableUsdMinor: number | null) {
  try {
    const balance = availableUsdMinor == null ? "not valued" : fmtUsd(availableUsdMinor);
    const subject = `Tender bid #${bid.id} · ${tender.title}`.slice(0, 200);
    const body = [
      "TENDER BID — ADMINISTRATOR REVIEW REQUIRED", "",
      "A customer placed a bid on a tender. No funds have moved; the qualification charge is applied manually by an administrator and no award is guaranteed.", "",
      `Bid: #${bid.id}`,
      `Tender: ${tender.title}`,
      `Country: ${tender.countryCode || "—"}`,
      `Qualification amount: ${fmtUsd(Number(bid.qualificationAmountUsdMinor))}`,
      `Eligible balance at bid time: ${balance}`, "",
      "Review it in the administrator Tender Bids queue and apply the charge or decline it.",
    ].join("\n");
    await createTicket(bid.userId, { subject, body, priority: "high", category: "account" });
  } catch (error) {
    console.error("[Support] Tender-bid ticket creation failed after commit:", error instanceof Error ? error.name : "UnknownError");
  }
}

function validateIdempotencyKey(value: string): string {
  const raw = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(raw)) throw new Error("A valid idempotency key is required.");
  return raw;
}

/**
 * Place a customer's bid on an open tender. Fail-closed and idempotent: the
 * tender must be open with a configured qualification amount, and the customer's
 * combined eligible balance (all wallets, USD, fresh FX) must cover it. On a
 * shortfall the bid is NOT recorded and the required amount is returned so the
 * client can prompt a deposit. A customer may hold at most one bid per tender.
 */
export async function placeTenderBid(userId: number, input: { tenderId: number; idempotencyKey: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const tenderId = Number(input.tenderId);
  if (!Number.isSafeInteger(tenderId) || tenderId <= 0) throw new Error("Select a tender to bid on.");
  const rawKey = validateIdempotencyKey(input.idempotencyKey);
  const idempotencyKey = `tender-bid:${userId}:${crypto.createHash("sha256").update(rawKey).digest("hex")}`;

  const tender = (await db.select().from(tenders).where(eq(tenders.id, tenderId)).limit(1))[0];
  if (!tender) throw new Error("This tender is no longer available.");
  const qualificationUsdMinor = tender.qualificationAmountUsdMinor == null ? null : Number(tender.qualificationAmountUsdMinor);
  if (qualificationUsdMinor == null || !Number.isSafeInteger(qualificationUsdMinor) || qualificationUsdMinor <= 0) {
    throw new Error("The qualification amount for this tender has not been configured yet, so bidding is not open.");
  }
  const status = liveTenderStatus(tender);
  if (status !== "open" && status !== "closing") throw new Error("Bidding is not open on this tender.");

  // Idempotent: a customer holds at most one bid per tender (unique key).
  const existing = (await db.select().from(tenderBids)
    .where(and(eq(tenderBids.userId, userId), eq(tenderBids.tenderId, tenderId))).limit(1))[0];
  if (existing) {
    return {
      status: "placed" as const,
      bid: toBidView(existing),
      requiredUsdMinor: qualificationUsdMinor,
      availableUsdMinor: null,
      alreadyPlaced: true,
    };
  }

  const wallets = await readWalletRows(db, userId);
  const valuation = await valueEligible(wallets, qualificationUsdMinor);
  if (!valuation.sufficient) {
    return {
      status: "insufficient_balance" as const,
      requiredUsdMinor: qualificationUsdMinor,
      availableUsdMinor: valuation.availableUsdMinor,
      shortfallUsdMinor: valuation.shortfallUsdMinor,
      message: valuation.availableUsdMinor == null
        ? "Your eligible balance could not be valued at a current exchange rate. Deposit funds and try again."
        : "Your eligible balance does not cover the qualification amount. Deposit funds to qualify for this tender.",
    };
  }

  let created = true;
  let bidRow: BidRow;
  try {
    bidRow = await db.transaction(async (tx) => {
      const inserted = await tx.insert(tenderBids).values({
        tenderId,
        userId,
        status: "placed",
        qualificationAmountUsdMinor: qualificationUsdMinor,
        idempotencyKey,
      });
      const bidId = Number(inserted[0].insertId);
      await tx.insert(tenderBidEvents).values({
        bidId,
        type: "placed",
        payloadJson: JSON.stringify({
          qualificationAmountUsdMinor: qualificationUsdMinor,
          availableUsdMinor: valuation.availableUsdMinor,
          tenderStatus: status,
          placedAt: new Date().toISOString(),
        }),
      });
      return {
        id: bidId, tenderId, userId, status: "placed" as TenderBidStatus,
        qualificationAmountUsdMinor: qualificationUsdMinor, chargeAmountUsdMinor: null, chargeLedgerId: null,
        idempotencyKey, createdAt: new Date(), updatedAt: new Date(),
      } as BidRow;
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "ER_DUP_ENTRY" || /duplicate/i.test(message)) {
      const duplicate = (await db.select().from(tenderBids)
        .where(and(eq(tenderBids.userId, userId), eq(tenderBids.tenderId, tenderId))).limit(1))[0];
      if (!duplicate) throw error;
      created = false;
      bidRow = duplicate;
    } else {
      throw error;
    }
  }

  if (created) {
    await notifyAdminsOfTenderBid(bidRow, tender, valuation.availableUsdMinor);
    await openTenderBidTicket(bidRow, tender, valuation.availableUsdMinor);
    try {
      await createNotification(userId, "Tender bid placed", `Your bid on “${tender.title}” was recorded with a ${fmtUsd(qualificationUsdMinor)} qualification amount. An administrator will review it and apply the charge or decline it. No funds leave your wallet until the charge is applied, and no award is guaranteed.`, {
        eventKey: `tender-bid-placed:${bidRow.id}`,
        category: "transaction",
        priority: "normal",
      });
    } catch (error) {
      console.error("[Notifications] Tender-bid placed notice failed after commit:", error instanceof Error ? error.name : "UnknownError");
    }
  }

  return {
    status: "placed" as const,
    bid: toBidView(bidRow),
    requiredUsdMinor: qualificationUsdMinor,
    availableUsdMinor: valuation.availableUsdMinor,
    alreadyPlaced: !created,
  };
}

/** The customer's own bids plus their combined eligible balance, for the desk's bid panel. */
export async function getTenderBidContext(userId: number): Promise<TenderBidContext> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(tenderBids)
    .where(eq(tenderBids.userId, userId))
    .orderBy(desc(tenderBids.createdAt), desc(tenderBids.id))
    .limit(TENDER_BID_QUEUE_MAX_ROWS);
  const wallets = await readWalletRows(db, userId);
  const valuation = await valueEligible(wallets, 0);
  return {
    bids: rows.map(toBidView),
    eligibleUsdMinor: valuation.availableUsdMinor,
    valuationAvailable: valuation.availableUsdMinor != null,
  };
}

function parseBalanceFromEvent(payload: unknown): number | null {
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!parsed || typeof parsed !== "object") return null;
    const value = (parsed as { availableUsdMinor?: unknown }).availableUsdMinor;
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  } catch {
    return null;
  }
}

/** The administrator Tender Bids queue: every bid with customer, tender and balance at bid time. */
export async function listTenderBidsForAdmin(): Promise<{ bids: TenderBidQueueRow[]; total: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select({
    bid: tenderBids,
    tenderTitle: tenders.title,
    tenderCountry: tenders.countryCode,
    tenderSourceUrl: tenders.sourceUrl,
    customerName: users.name,
    customerEmail: users.email,
  })
    .from(tenderBids)
    .innerJoin(tenders, eq(tenderBids.tenderId, tenders.id))
    .leftJoin(users, eq(tenderBids.userId, users.id))
    .orderBy(desc(tenderBids.createdAt), desc(tenderBids.id))
    .limit(TENDER_BID_QUEUE_MAX_ROWS);

  const ids = rows.map((row) => Number(row.bid.id));
  const placedEvents = ids.length
    ? await db.select({ bidId: tenderBidEvents.bidId, payloadJson: tenderBidEvents.payloadJson })
      .from(tenderBidEvents)
      .where(and(inArray(tenderBidEvents.bidId, ids), eq(tenderBidEvents.type, "placed")))
    : [];
  const balanceByBid = new Map<number, number | null>();
  for (const event of placedEvents) balanceByBid.set(Number(event.bidId), parseBalanceFromEvent(event.payloadJson));

  return {
    bids: rows.map((row) => ({
      ...toBidView(row.bid),
      tenderTitle: row.tenderTitle,
      tenderCountry: row.tenderCountry,
      tenderSourceUrl: row.tenderSourceUrl,
      customerName: row.customerName ?? null,
      customerEmail: row.customerEmail ?? null,
      balanceAtBidUsdMinor: balanceByBid.get(Number(row.bid.id)) ?? null,
    })),
    total: rows.length,
  };
}

/** Load one bid or fail closed so an administrator action never targets a missing record. */
async function loadBid(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, bidId: number): Promise<BidRow> {
  const bid = (await db.select().from(tenderBids).where(eq(tenderBids.id, bidId)).limit(1))[0];
  if (!bid) throw new Error("This bid no longer exists.");
  return bid;
}

/**
 * Apply the administrative charge: a classified manual debit of the configured
 * qualification amount from the customer's USD wallet through the existing
 * ledger path (`ordinary_debit` → `admin_debit`), then mark the bid `charged` and
 * record the ledger id. Idempotent — a replay returns the already-charged bid.
 */
export async function applyTenderBidCharge(adminId: number, input: { bidId: number; idempotencyKey: string; reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const bidId = Number(input.bidId);
  if (!Number.isSafeInteger(bidId) || bidId <= 0) throw new Error("Select a bid to charge.");
  const reason = String(input.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Provide an administrator reason of 3–500 characters.");
  const rawKey = validateIdempotencyKey(input.idempotencyKey);

  const bid = await loadBid(db, bidId);
  if (bid.status === "charged" || bid.status === "won" || bid.status === "lost") {
    return { status: bid.status as TenderBidStatus, bid: toBidView(bid), alreadyApplied: true };
  }
  if (bid.status !== "placed" && bid.status !== "charge_pending") throw new Error("Only a placed bid can be charged.");
  const chargeUsdMinor = Number(bid.qualificationAmountUsdMinor);
  if (!Number.isSafeInteger(chargeUsdMinor) || chargeUsdMinor <= 0) throw new Error("This bid has no chargeable qualification amount.");

  const chargeKey = `tender-charge:${bidId}:${crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 32)}`;
  const ledger = await adjustCustomerBalance(adminId, {
    userId: Number(bid.userId),
    currency: SETTLEMENT_CURRENCY,
    amountMinor: chargeUsdMinor,
    mode: "debit",
    debitClassification: "ordinary_debit",
    reason,
    idempotencyKey: chargeKey,
  });

  const updated = await db.transaction(async (tx) => {
    const locked = (await tx.select().from(tenderBids).where(eq(tenderBids.id, bidId)).limit(1).for("update"))[0];
    if (!locked) throw new Error("This bid no longer exists.");
    if (locked.status === "charged" || locked.status === "won" || locked.status === "lost") return locked;
    await tx.update(tenderBids)
      .set({ status: "charged", chargeAmountUsdMinor: chargeUsdMinor, chargeLedgerId: ledger.ledgerId, updatedAt: new Date() })
      .where(eq(tenderBids.id, bidId));
    await tx.insert(tenderBidEvents).values({
      bidId,
      type: "charged",
      payloadJson: JSON.stringify({ ledgerId: ledger.ledgerId, chargeUsdMinor, currency: SETTLEMENT_CURRENCY, reason }),
    });
    return { ...locked, status: "charged" as TenderBidStatus, chargeAmountUsdMinor: chargeUsdMinor, chargeLedgerId: ledger.ledgerId } as BidRow;
  });

  return { status: "charged" as const, bid: toBidView(updated), ledgerId: ledger.ledgerId, alreadyApplied: false };
}

/**
 * Decline a bid: mark it `cancelled` with a reason and move no money. A charged
 * bid cannot be declined — it is reversed through its compensating ledger entry
 * or resolved with an outcome instead.
 */
export async function declineTenderBid(_adminId: number, input: { bidId: number; reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const bidId = Number(input.bidId);
  if (!Number.isSafeInteger(bidId) || bidId <= 0) throw new Error("Select a bid to decline.");
  const reason = String(input.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Provide a decline reason of 3–500 characters.");

  const bid = await loadBid(db, bidId);
  if (bid.status === "cancelled") return { status: "cancelled" as TenderBidStatus, bid: toBidView(bid), alreadyDeclined: true };
  if (bid.status === "charged" || bid.status === "won" || bid.status === "lost") throw new Error("A charged bid cannot be declined; reverse the charge or record an outcome instead.");
  if (bid.status !== "placed" && bid.status !== "charge_pending") throw new Error("Only a placed bid can be declined.");

  const updated = await db.transaction(async (tx) => {
    const locked = (await tx.select().from(tenderBids).where(eq(tenderBids.id, bidId)).limit(1).for("update"))[0];
    if (!locked) throw new Error("This bid no longer exists.");
    if (locked.status === "cancelled") return locked;
    await tx.update(tenderBids).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tenderBids.id, bidId));
    await tx.insert(tenderBidEvents).values({ bidId, type: "cancelled", payloadJson: JSON.stringify({ reason }) });
    return { ...locked, status: "cancelled" as TenderBidStatus } as BidRow;
  });

  try {
    await createNotification(Number(bid.userId), "Tender bid declined", `Your bid #${bidId} was declined by an administrator. Reason: ${reason}. No charge was applied to your wallet.`, {
      eventKey: `tender-bid-declined:${bidId}`,
      category: "transaction",
      priority: "normal",
    });
  } catch (error) {
    console.error("[Notifications] Tender-bid decline notice failed after commit:", error instanceof Error ? error.name : "UnknownError");
  }

  return { status: "cancelled" as const, bid: toBidView(updated), alreadyDeclined: false };
}

/** Record the administration outcome of a charged bid: `won` or `lost`. */
export async function recordTenderBidOutcome(_adminId: number, input: { bidId: number; outcome: "won" | "lost"; reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const bidId = Number(input.bidId);
  if (!Number.isSafeInteger(bidId) || bidId <= 0) throw new Error("Select a bid to record an outcome for.");
  if (input.outcome !== "won" && input.outcome !== "lost") throw new Error("Select a valid outcome (won or lost).");
  const reason = String(input.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Provide an administrator reason of 3–500 characters.");

  const bid = await loadBid(db, bidId);
  if (bid.status === input.outcome) return { status: input.outcome as TenderBidStatus, bid: toBidView(bid), alreadyApplied: true };
  if (bid.status !== "charged") throw new Error("Only a charged bid can receive an outcome.");

  const updated = await db.transaction(async (tx) => {
    const locked = (await tx.select().from(tenderBids).where(eq(tenderBids.id, bidId)).limit(1).for("update"))[0];
    if (!locked) throw new Error("This bid no longer exists.");
    if (locked.status !== "charged") throw new Error("Only a charged bid can receive an outcome.");
    await tx.update(tenderBids).set({ status: input.outcome, updatedAt: new Date() }).where(eq(tenderBids.id, bidId));
    await tx.insert(tenderBidEvents).values({ bidId, type: input.outcome, payloadJson: JSON.stringify({ reason }) });
    return { ...locked, status: input.outcome as TenderBidStatus } as BidRow;
  });

  try {
    await createNotification(Number(bid.userId), input.outcome === "won" ? "Tender bid won" : "Tender bid not awarded", input.outcome === "won"
      ? `Your bid #${bidId} was recorded as won. Reason: ${reason}.`
      : `Your bid #${bidId} closed without an award. Reason: ${reason}.`, {
      eventKey: `tender-bid-outcome:${bidId}`,
      category: "transaction",
      priority: input.outcome === "won" ? "high" : "normal",
    });
  } catch (error) {
    console.error("[Notifications] Tender-bid outcome notice failed after commit:", error instanceof Error ? error.name : "UnknownError");
  }

  return { status: input.outcome as TenderBidStatus, bid: toBidView(updated), alreadyApplied: false };
}
