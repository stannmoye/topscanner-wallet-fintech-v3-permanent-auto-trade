import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import {
  interestPlusCapitalMinor,
  lendingAuctionStatusFor,
  lendingBiddableFor,
  lendingNextRequiredBps,
  lendingRemainingSecondsFor,
  monthlyInterestMinor,
  rankLendingBids,
  yearlyInterestMinor,
  type BorrowerBidStatus,
  type LenderReserve,
  type LendingBid,
  type LendingLoan,
  type LendingOutcome,
} from "@shared/lending-catalogue";
import {
  applyLendingLoanOutcome,
  ensureExampleLendingDesk,
  findAdminLendingLoan,
  LENDING_LOANS_TABLE,
  listEnabledAdminLenderReserves,
  listEnabledAdminLendingLoans,
  markLendingLoanAllocated,
  type AdminLendingLoanRow,
} from "./lendingDossiers";
import {
  FxRateUnavailableError,
  planCrossWalletFunding,
  calculateCombinedAvailableTargetMinor,
  type FxRateSnapshot,
} from "./modules/trading-wallet-fx";
import { getFreshTradingFxRate, getWalletFundingPriorityForFunding, listBalances, listCurrencies } from "./db";

type Db = mysql.PoolConnection;

/**
 * The lending desk's live layer: the borrower auction, the lender funding book
 * and the disbursement / settlement ledger.
 *
 * Two sides meet here. A BORROWER competes in a live, server-timed auction by
 * bidding the interest they will pay; the highest bid when the administrator's
 * countdown expires wins the allocation. A LENDER / investor funds a loan from
 * their own wallet (settled in USD, potentially across several wallets through
 * live FX) and earns the borrower's interest over the agreed tenure.
 *
 * Everything the customer sees about a competing bid is a masked label
 * ("Bidder #A3F1"); the real identity lives only in the bid's userId and is
 * never exposed. All timing is derived from the administrator's stored open /
 * close timestamps, never from a client clock.
 */
export const LENDING_BIDS_TABLE = "lending_bids";
export const LENDING_POSITIONS_TABLE = "lending_positions";

const CREATE_BIDS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lending_bids (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bidId VARCHAR(64) NOT NULL,
  loanId VARCHAR(80) NOT NULL,
  userId INT NOT NULL,
  borrowerLabel VARCHAR(40) NOT NULL,
  bidInterestBps INT NOT NULL,
  amountMinor BIGINT NOT NULL,
  tenureMonths INT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  rank INT NOT NULL DEFAULT 0,
  placedAt DATETIME(3) NOT NULL,
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY lending_bids_id_idx (bidId),
  KEY lending_bids_loan_idx (loanId, status),
  KEY lending_bids_user_idx (userId, loanId)
) ENGINE=InnoDB`;

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lending_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  loanId VARCHAR(80) NOT NULL,
  loanTitle VARCHAR(200) NOT NULL,
  side VARCHAR(12) NOT NULL DEFAULT 'LENDER',
  amountMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  fundingSource VARCHAR(24) NULL,
  fundingPlanJson TEXT NULL,
  expectedInterestBps INT NULL,
  tenureMonths INT NULL,
  monthlyInterestMinor BIGINT NULL,
  yearlyInterestMinor BIGINT NULL,
  interestPlusCapitalMinor BIGINT NULL,
  platformFeeBps INT NULL,
  distributedMinor BIGINT NOT NULL DEFAULT 0,
  outcome VARCHAR(16) NULL,
  realisedMinor BIGINT NULL,
  settledAt DATETIME NULL,
  positionStatus VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY lending_positions_code_idx (positionCode),
  KEY lending_positions_user_idx (userId, positionStatus),
  KEY lending_positions_loan_idx (loanId, outcome)
) ENGINE=InnoDB`;

/** Every lending booking settles in this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const LENDING_COMBINED_SOURCE = "COMBINED";
const MAX_FUNDING_MINOR = 100_000_000; // $1,000,000 ceiling per funding
const MAX_BPS = 100_000;

type WalletRow = {
  id: number;
  currency: string;
  scale: number;
  assetType: "fiat" | "crypto" | "token";
  externalCode: string | null;
  availableMinor: number;
  lockedMinor: number;
};

type FundingDebit = { currency: string; amountMinor: number; convertedUsdMinor: number; rate: FxRateSnapshot };

type FundingPlan = {
  requiredUsdMinor: number;
  usdAvailableMinor: number;
  convertedUsdMinor: number;
  debits: FundingDebit[];
  targetRate: FxRateSnapshot;
};

type BidRow = {
  bidId: string;
  loanId: string;
  userId: number;
  borrowerLabel: string;
  bidInterestBps: number;
  amountMinor: number;
  tenureMonths: number;
  status: BorrowerBidStatus;
  rank: number;
  placedAt: string;
  updatedAt: string;
};

/** A customer-facing loan with its live auction leaderboard attached. */
export type LendingLoanView = LendingLoan & { leaderboard: LendingBid[] };

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const conn = await getSharedMysqlPool().getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive bids and positions tables exist (memoized). */
export function ensureLendingDeskSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_BIDS_TABLE_SQL);
        await conn.query(CREATE_POSITIONS_TABLE_SQL);
      });
    } catch (error) {
      schemaReady = null;
      console.error("[Lending] Failed to ensure desk schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(scope: string, input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `${scope}:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

/** A stable, non-identifying label for a competing borrower. */
function maskBorrower(userId: number): string {
  const hash = crypto.createHash("sha256").update(`lending-bidder:${userId}`).digest("hex").slice(0, 4).toUpperCase();
  return `Bidder #${hash}`;
}

function bidRowToBid(row: BidRow, viewerId: number, nextRequiredBps: number | null): LendingBid {
  const principal = Number(row.amountMinor || 0);
  return {
    id: String(row.bidId),
    loanId: String(row.loanId),
    isSelf: Number(row.userId) === viewerId,
    borrowerLabel: String(row.borrowerLabel),
    bidInterestBps: Number(row.bidInterestBps || 0),
    amountMinor: principal,
    tenureMonths: Number(row.tenureMonths || 0),
    rank: Number(row.rank || 0),
    nextRequiredBps,
    status: row.status,
    monthlyInterestMinor: monthlyInterestMinor(principal, row.bidInterestBps) ?? 0,
    yearlyInterestMinor: yearlyInterestMinor(principal, row.bidInterestBps) ?? 0,
    interestPlusCapitalMinor: interestPlusCapitalMinor(principal, row.bidInterestBps, row.tenureMonths) ?? principal,
    placedAt: row.placedAt,
    updatedAt: row.updatedAt,
  };
}

async function readBidRows(conn: Db, loanId: string, forUpdate = false): Promise<BidRow[]> {
  const [rows] = await conn.query<any[]>(
    `SELECT bidId,loanId,userId,borrowerLabel,bidInterestBps,amountMinor,tenureMonths,status,rank,placedAt,updatedAt
     FROM ${LENDING_BIDS_TABLE} WHERE loanId=? ORDER BY id${forUpdate ? " FOR UPDATE" : ""}`,
    [loanId],
  );
  return rows.map((row) => ({
    bidId: String(row.bidId),
    loanId: String(row.loanId),
    userId: Number(row.userId),
    borrowerLabel: String(row.borrowerLabel),
    bidInterestBps: Number(row.bidInterestBps || 0),
    amountMinor: Number(row.amountMinor || 0),
    tenureMonths: Number(row.tenureMonths || 0),
    status: (String(row.status) as BorrowerBidStatus),
    rank: Number(row.rank || 0),
    placedAt: new Date(row.placedAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

/** Re-rank a loan's live bids: the highest interest on top, everyone else outbid. */
async function rerankLoanBids(conn: Db, loanId: string): Promise<void> {
  const live = (await readBidRows(conn, loanId)).filter((bid) => bid.status === "ACTIVE" || bid.status === "OUTBID");
  const ranked = rankLendingBids(live);
  for (let index = 0; index < ranked.length; index += 1) {
    await conn.execute(
      `UPDATE ${LENDING_BIDS_TABLE} SET status=?, rank=? WHERE bidId=?`,
      [index === 0 ? "ACTIVE" : "OUTBID", index + 1, ranked[index].bidId],
    );
  }
}

function validateBidInput(input: { amountMinor: number; tenureMonths: number; bidInterestBps: number }, loan: AdminLendingLoanRow) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter the amount you want to borrow");
  if (loan.principalMinor !== null && input.amountMinor > loan.principalMinor) throw new Error("Your bid cannot exceed the amount offered on this loan");
  if (input.amountMinor > MAX_FUNDING_MINOR) throw new Error("This amount exceeds the per-loan ceiling on the lending desk");
  if (!Number.isSafeInteger(input.tenureMonths) || input.tenureMonths <= 0) throw new Error("Enter a valid tenure in whole months");
  if (loan.minimumTenureMonths !== null && input.tenureMonths < loan.minimumTenureMonths) throw new Error(`The minimum tenure on this loan is ${loan.minimumTenureMonths} months`);
  if (loan.maximumTenureMonths !== null && input.tenureMonths > loan.maximumTenureMonths) throw new Error(`The maximum tenure on this loan is ${loan.maximumTenureMonths} months`);
  if (!Number.isSafeInteger(input.bidInterestBps) || input.bidInterestBps <= 0) throw new Error("Enter the interest you will pay in basis points");
  if (input.bidInterestBps > MAX_BPS) throw new Error("That interest rate is out of range");
  if (loan.startingInterestBps !== null && input.bidInterestBps < loan.startingInterestBps) throw new Error(`Bid at least the reserve interest of ${loan.startingInterestBps} bps`);
}

/** The interest a borrower must bid to take the lead, given a loan's current live bids. */
async function nextRequiredFor(conn: Db, loanId: string, startingInterestBps: number | null): Promise<number | null> {
  const live = (await readBidRows(conn, loanId)).filter((bid) => bid.status === "ACTIVE");
  const top = rankLendingBids(live)[0] ?? null;
  return lendingNextRequiredBps(top ? top.bidInterestBps : null, startingInterestBps);
}

/**
 * Place a borrower's first bid in a loan's live auction. The bid must beat the
 * current leader by the desk's minimum step (or open at the reserve interest).
 * Bidding is free — no wallet movement — and the whole bid set is re-ranked so
 * every customer sees the live leaderboard.
 */
export async function placeLendingBid(
  userId: number,
  input: { loanId: string; bidInterestBps: number; amountMinor: number; tenureMonths: number; idempotencyKey: string },
) {
  await ensureLendingDeskSchema();
  const loanId = String(input.loanId || "").trim();
  if (!loanId) throw new Error("Select a loan to bid on");
  const bidInterestBps = Math.round(Number(input.bidInterestBps) || 0);
  const amountMinor = Math.round(Number(input.amountMinor) || 0);
  const tenureMonths = Math.round(Number(input.tenureMonths) || 0);
  const key = idempotencyKey("lending:bid", input.idempotencyKey, userId);

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [userId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? AND enabled=1 LIMIT 1 FOR UPDATE`, [loanId]);
      if (!rows.length) throw new Error("This loan is not open for bidding");
      const loan = rows[0];
      const biddable = lendingBiddableFor({
        stage: loan.stage, auctionOpensAt: loan.auctionOpensAt ? new Date(loan.auctionOpensAt).toISOString() : null,
        auctionClosesAt: loan.auctionClosesAt ? new Date(loan.auctionClosesAt).toISOString() : null, enabled: true,
      });
      if (!biddable) throw new Error("This auction is not open for bidding right now");

      validateBidInput(
        { amountMinor, tenureMonths, bidInterestBps },
        { principalMinor: loan.principalMinor === null ? null : Number(loan.principalMinor), minimumTenureMonths: loan.minimumTenureMonths === null ? null : Number(loan.minimumTenureMonths), maximumTenureMonths: loan.maximumTenureMonths === null ? null : Number(loan.maximumTenureMonths), startingInterestBps: loan.startingInterestBps === null ? null : Number(loan.startingInterestBps) } as AdminLendingLoanRow,
      );

      const required = await nextRequiredFor(conn, loanId, loan.startingInterestBps === null ? null : Number(loan.startingInterestBps));
      if (required !== null && bidInterestBps < required) throw new Error(`Bid at least ${required} bps to take the lead on this auction`);

      const bidId = `bid-${crypto.randomBytes(6).toString("hex")}`;
      await conn.execute(
        `INSERT INTO ${LENDING_BIDS_TABLE} (bidId,loanId,userId,borrowerLabel,bidInterestBps,amountMinor,tenureMonths,status,rank,placedAt)
         VALUES (?,?,?,?,?,?,?, 'ACTIVE', 0, NOW(3))`,
        [bidId, loanId, userId, maskBorrower(userId), bidInterestBps, amountMinor, tenureMonths],
      );
      await rerankLoanBids(conn, loanId);

      const bids = await readBidRows(conn, loanId);
      const ranked = rankLendingBids(bids.filter((bid) => bid.status === "ACTIVE" || bid.status === "OUTBID"));
      const nextRequired = lendingNextRequiredBps(ranked[0]?.bidInterestBps ?? null, loan.startingInterestBps === null ? null : Number(loan.startingInterestBps));
      const mine = bids.find((bid) => bid.bidId === bidId)!;
      const result = {
        bid: bidRowToBid(mine, userId, nextRequired),
        isLeading: mine.status === "ACTIVE",
        leaderLabel: ranked[0]?.borrowerLabel ?? null,
        topBidBps: ranked[0]?.bidInterestBps ?? null,
        bidCount: bids.filter((bid) => bid.status !== "CANCELLED" && bid.status !== "EXPIRED").length,
      };
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [userId, key, "lending.bid", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/**
 * Raise an existing bid to overtake the leader. A borrower can only raise their
 * own bid and must still clear the desk's minimum step.
 */
export async function raiseLendingBid(
  userId: number,
  input: { bidId: string; bidInterestBps: number; idempotencyKey: string },
) {
  await ensureLendingDeskSchema();
  const bidId = String(input.bidId || "").trim();
  if (!bidId) throw new Error("Select your bid to raise");
  const bidInterestBps = Math.round(Number(input.bidInterestBps) || 0);
  if (!Number.isSafeInteger(bidInterestBps) || bidInterestBps <= 0 || bidInterestBps > MAX_BPS) throw new Error("Enter a valid interest rate in basis points");
  const key = idempotencyKey("lending:raise", input.idempotencyKey, userId);

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [userId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [bidRows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_BIDS_TABLE} WHERE bidId=? LIMIT 1 FOR UPDATE`, [bidId]);
      if (!bidRows.length) throw new Error("This bid no longer exists");
      const bid = bidRows[0];
      if (Number(bid.userId) !== userId) throw new Error("You can only raise your own bid");
      if (bid.status === "WON" || bid.status === "DISBURSED") throw new Error("This bid has already won its auction");
      if (bid.status === "EXPIRED" || bid.status === "CANCELLED") throw new Error("This bid is no longer live");

      const [loanRows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1 FOR UPDATE`, [String(bid.loanId)]);
      if (!loanRows.length) throw new Error("This loan no longer exists");
      const loan = loanRows[0];
      const biddable = lendingBiddableFor({
        stage: loan.stage, auctionOpensAt: loan.auctionOpensAt ? new Date(loan.auctionOpensAt).toISOString() : null,
        auctionClosesAt: loan.auctionClosesAt ? new Date(loan.auctionClosesAt).toISOString() : null, enabled: true,
      });
      if (!biddable) throw new Error("This auction is no longer open for bidding");

      const previous = Number(bid.bidInterestBps || 0);
      const required = await nextRequiredFor(conn, String(bid.loanId), loan.startingInterestBps === null ? null : Number(loan.startingInterestBps));
      if (bidInterestBps <= previous) throw new Error(`Raise your bid above your current ${previous} bps`);
      if (bidInterestBps > previous || required === null || bidInterestBps >= required) {
        // ok — either a genuine raise above the leader, or the desk has no minimum
      }

      await conn.execute(`UPDATE ${LENDING_BIDS_TABLE} SET bidInterestBps=?, status='ACTIVE', placedAt=NOW(3) WHERE bidId=?`, [bidInterestBps, bidId]);
      await rerankLoanBids(conn, String(bid.loanId));

      const bids = await readBidRows(conn, String(bid.loanId));
      const ranked = rankLendingBids(bids.filter((row) => row.status === "ACTIVE" || row.status === "OUTBID"));
      const nextRequired = lendingNextRequiredBps(ranked[0]?.bidInterestBps ?? null, loan.startingInterestBps === null ? null : Number(loan.startingInterestBps));
      const mine = bids.find((row) => row.bidId === bidId)!;
      const result = {
        bid: bidRowToBid(mine, userId, nextRequired),
        isLeading: mine.status === "ACTIVE",
        leaderLabel: ranked[0]?.borrowerLabel ?? null,
        topBidBps: ranked[0]?.bidInterestBps ?? null,
        bidCount: bids.filter((row) => row.status !== "CANCELLED" && row.status !== "EXPIRED").length,
      };
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [userId, key, "lending.raise", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/** Withdraw a live bid. The auction simply re-ranks around it. */
export async function withdrawLendingBid(userId: number, bidId: string) {
  await ensureLendingDeskSchema();
  const id = String(bidId || "").trim();
  if (!id) throw new Error("Select a bid to withdraw");
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_BIDS_TABLE} WHERE bidId=? LIMIT 1 FOR UPDATE`, [id]);
      if (!rows.length) throw new Error("This bid no longer exists");
      if (Number(rows[0].userId) !== userId) throw new Error("You can only withdraw your own bid");
      if (rows[0].status === "WON" || rows[0].status === "DISBURSED") throw new Error("This bid has already won its auction and cannot be withdrawn");
      await conn.execute(`UPDATE ${LENDING_BIDS_TABLE} SET status='CANCELLED', rank=0 WHERE bidId=?`, [id]);
      await rerankLoanBids(conn, String(rows[0].loanId));
      await conn.commit();
      return { bidId: id, withdrawn: true };
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/**
 * Resolve one auction inside an existing transaction: when the administrator's
 * countdown has expired and the loan is still bidding, the leading live bid is
 * marked WON and the loan is allocated to it. Idempotent — a loan that is not
 * still `BIDDING` (or whose countdown has not closed) is left untouched.
 */
async function resolveLendingAuctionWithConn(conn: Db, loanId: string, now: number) {
  const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1 FOR UPDATE`, [loanId]);
  if (!rows.length) return null;
  const loan = rows[0];
  if (String(loan.stage) !== "BIDDING") return null;
  const closes = loan.auctionClosesAt ? Date.parse(new Date(loan.auctionClosesAt).toISOString()) : Number.NaN;
  if (!Number.isFinite(closes) || now < closes) return null;

  const bids = (await readBidRows(conn, loanId)).filter((bid) => bid.status === "ACTIVE" || bid.status === "OUTBID");
  if (!bids.length) return null;
  const winner = rankLendingBids(bids)[0];

  await conn.execute(`UPDATE ${LENDING_BIDS_TABLE} SET status='WON', rank=1 WHERE bidId=?`, [winner.bidId]);
  await conn.execute(
    `UPDATE ${LENDING_BIDS_TABLE} SET status='EXPIRED' WHERE loanId=? AND bidId<>? AND status IN ('ACTIVE','OUTBID')`,
    [loanId, winner.bidId],
  );
  await markLendingLoanAllocated(conn, loanId, {
    winnerLabel: winner.borrowerLabel, topBidBps: winner.bidInterestBps, committedMinor: winner.amountMinor, stage: "ALLOCATED",
  });
  return { loanId, winnerBidId: winner.bidId, winnerLabel: winner.borrowerLabel, topBidBps: winner.bidInterestBps, committedMinor: winner.amountMinor };
}

/** Resolve every auction whose administrator countdown has expired. Safe to call often. */
export async function resolveClosedLendingAuctions(): Promise<void> {
  await ensureLendingDeskSchema();
  try {
    const candidates = await withConnection(async (conn) => {
      const [rows] = await conn.query<any[]>(
        `SELECT loanId FROM ${LENDING_LOANS_TABLE}
         WHERE enabled=1 AND stage='BIDDING' AND auctionClosesAt IS NOT NULL AND auctionClosesAt<=NOW(3)
         ORDER BY auctionClosesAt LIMIT 25`,
      );
      return rows.map((row) => String(row.loanId));
    });
    for (const loanId of candidates) {
      await withConnection(async (conn) => {
        await conn.beginTransaction();
        try { await resolveLendingAuctionWithConn(conn, loanId, Date.now()); await conn.commit(); }
        catch (error) { await conn.rollback(); throw error; }
      });
    }
  } catch (error) {
    console.error("[Lending] Failed to resolve closed auctions:", error instanceof Error ? error.message : "UnknownError");
  }
}

async function loadBidMap(loanIds: string[]): Promise<Map<string, BidRow[]>> {
  const map = new Map<string, BidRow[]>();
  if (!loanIds.length) return map;
  const rows = await withConnection(async (conn) => {
    const placeholders = loanIds.map(() => "?").join(",");
    const [result] = await conn.query<any[]>(
      `SELECT bidId,loanId,userId,borrowerLabel,bidInterestBps,amountMinor,tenureMonths,status,rank,placedAt,updatedAt
       FROM ${LENDING_BIDS_TABLE} WHERE loanId IN (${placeholders}) ORDER BY id`,
      loanIds,
    );
    return result;
  });
  for (const row of rows) {
    const bid: BidRow = {
      bidId: String(row.bidId), loanId: String(row.loanId), userId: Number(row.userId),
      borrowerLabel: String(row.borrowerLabel), bidInterestBps: Number(row.bidInterestBps || 0),
      amountMinor: Number(row.amountMinor || 0), tenureMonths: Number(row.tenureMonths || 0),
      status: String(row.status) as BorrowerBidStatus, rank: Number(row.rank || 0),
      placedAt: new Date(row.placedAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
    };
    const list = map.get(bid.loanId) ?? [];
    list.push(bid);
    map.set(bid.loanId, list);
  }
  return map;
}

/** Overlay a loan's live auction state (leader, top bid, the viewer's own bid) onto its record. */
function overlayLoan(loan: LendingLoan, bids: BidRow[], viewerId: number, now: number): LendingLoanView {
  const active = bids.filter((bid) => bid.status !== "CANCELLED" && bid.status !== "EXPIRED");
  const ranked = rankLendingBids(active);
  const leader = ranked[0] ?? null;
  const topBidBps = leader ? leader.bidInterestBps : null;
  const nextRequired = lendingNextRequiredBps(topBidBps, loan.startingInterestBps);
  const viewerBids = active.filter((bid) => bid.userId === viewerId).sort((a, b) => b.bidInterestBps - a.bidInterestBps);
  const viewerBid = viewerBids[0] ?? null;
  const viewerIsLeading = Boolean(viewerBid && leader && viewerBid.bidId === leader.bidId);
  const viewerNextRequired = viewerBid
    ? lendingNextRequiredBps(topBidBps, loan.startingInterestBps) ?? null
    : nextRequired;
  const leaderPrincipal = leader ? leader.amountMinor : loan.principalMinor;
  return {
    ...loan,
    auctionStatus: lendingAuctionStatusFor({ stage: loan.stage, auctionOpensAt: loan.auctionOpensAt, auctionClosesAt: loan.auctionClosesAt, now }),
    remainingSeconds: lendingRemainingSecondsFor(loan.auctionClosesAt, now),
    bidCount: active.length,
    topBidBps,
    leadingBorrower: leader ? leader.borrowerLabel : null,
    viewerIsLeading,
    viewerBidId: viewerBid ? viewerBid.bidId : null,
    viewerNextRequiredBps: viewerNextRequired,
    monthlyInterestMinor: monthlyInterestMinor(leaderPrincipal, topBidBps ?? loan.startingInterestBps),
    yearlyInterestMinor: yearlyInterestMinor(leaderPrincipal, topBidBps ?? loan.startingInterestBps),
    interestPlusCapitalMinor: interestPlusCapitalMinor(leaderPrincipal, topBidBps ?? loan.startingInterestBps, loan.maximumTenureMonths ?? loan.minimumTenureMonths),
    leaderboard: ranked.map((bid) => bidRowToBid(bid, viewerId, lendingNextRequiredBps(topBidBps, loan.startingInterestBps))),
  };
}

async function readAdminLoans(): Promise<LendingLoan[]> {
  try { return await listEnabledAdminLendingLoans(); }
  catch (error) {
    console.error("[Lending] Failed to read administrator loans:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

async function readReserves(): Promise<LenderReserve[]> {
  try { return await listEnabledAdminLenderReserves(); }
  catch (error) {
    console.error("[Lending] Failed to read lender reserves:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

async function readPositions(userId: number): Promise<any[]> {
  try {
    return await withConnection(async (conn) => {
      const [rows] = await conn.query<any[]>(
        `SELECT id, positionCode, loanId, loanTitle, side, amountMinor, currency, fundingSource, expectedInterestBps, tenureMonths,
                monthlyInterestMinor, yearlyInterestMinor, interestPlusCapitalMinor, platformFeeBps, distributedMinor,
                outcome, realisedMinor, settledAt, positionStatus, openedAt, ledgerReference
         FROM ${LENDING_POSITIONS_TABLE} WHERE userId=? ORDER BY openedAt DESC`,
        [userId],
      );
      return rows;
    });
  } catch (error) {
    console.error("[Lending] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

async function readBalances(userId: number): Promise<any[]> {
  try {
    const [balanceRows, currencies] = await Promise.all([listBalances(userId), listCurrencies()]);
    const currencyByCode = new Map(currencies.map((currency) => [String(currency.code).toUpperCase(), currency]));
    return balanceRows.map((row) => {
      const code = String(row.currency).toUpperCase();
      const currency = currencyByCode.get(code);
      return {
        currency: code,
        symbol: currency?.symbol ?? code,
        scale: currency?.scale ?? 2,
        name: currency?.name ?? code,
        currencyName: currency?.name ?? code,
        availableMinor: Number(row.availableMinor || 0),
        lockedMinor: Number(row.lockedMinor || 0),
        promotionalMinor: Number(row.promotionalMinor || 0),
        earnedMinor: Number(row.earnedMinor || 0),
      };
    });
  } catch (error) {
    console.error("[Lending] Failed to read wallet balances:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Assemble the lending desk for one customer: the administrator's live loans
 * with their auctions overlaid, the lender reserves board, that customer's
 * positions, wallet balances and a derived summary. Closed auctions resolve
 * first so a winner is reflected immediately.
 */
export async function getLendingDesk(userId: number) {
  await ensureLendingDeskSchema();
  // A fresh desk seeds its example auctions once, so customers always land on a
  // working board. A desk with any real loan is never touched.
  await ensureExampleLendingDesk();
  await resolveClosedLendingAuctions();

  const [adminLoans, reserves, positions, balances] = await Promise.all([
    readAdminLoans(), readReserves(), readPositions(userId), readBalances(userId),
  ]);

  const bidMap = await loadBidMap(adminLoans.map((loan) => loan.id));
  const now = Date.now();
  const loans = adminLoans
    .map((loan) => overlayLoan(loan, bidMap.get(loan.id) ?? [], userId, now))
    .sort((a, b) => {
      if (a.biddable !== b.biddable) return a.biddable ? -1 : 1;
      return (b.topBidBps ?? 0) - (a.topBidBps ?? 0);
    });

  const activePositions = positions.filter((position) => position.positionStatus === "ACTIVE");
  const summary = {
    published: loans.length,
    openAuctions: loans.filter((loan) => loan.biddable).length,
    closingSoon: loans.filter((loan) => loan.auctionStatus === "CLOSING_SOON").length,
    allocated: loans.filter((loan) => loan.auctionStatus === "ALLOCATED").length,
    liveBids: loans.reduce((sum, loan) => sum + loan.bidCount, 0),
    myBids: loans.filter((loan) => loan.viewerBidId).length,
    myLeading: loans.filter((loan) => loan.viewerIsLeading).length,
    committedMinor: activePositions.reduce((sum, position) => sum + Number(position.amountMinor || 0), 0),
    activePositions: activePositions.length,
    settledPositions: positions.filter((position) => position.positionStatus === "SETTLED").length,
    realisedMinor: positions.reduce((sum, position) => sum + Number(position.realisedMinor || 0), 0),
    lenderCapacityMinor: reserves.reduce((sum, reserve) => sum + Number(reserve.capacityMinor || 0), 0),
    lenderAvailableMinor: reserves.reduce((sum, reserve) => sum + Number(reserve.availableMinor || 0), 0),
  };

  const usd = balances.find((balance) => balance.currency === SETTLEMENT_CURRENCY);
  return {
    loans,
    reserves,
    positions,
    balances,
    wallets: balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    combinedSource: LENDING_COMBINED_SOURCE,
    availableMinor: Number(usd?.availableMinor || 0),
    summary,
    fetchedAt: new Date().toISOString(),
  };
}

/** One loan with its full live leaderboard, for the auction detail view. */
export async function getLendingLoanView(userId: number, loanId: string): Promise<LendingLoanView | null> {
  await ensureLendingDeskSchema();
  await ensureExampleLendingDesk();
  await resolveClosedLendingAuctions();
  const id = String(loanId || "").trim();
  if (!id) return null;
  const adminLoans = await readAdminLoans();
  const loan = adminLoans.find((item) => item.id === id);
  if (!loan) return null;
  const bidMap = await loadBidMap([id]);
  return overlayLoan(loan, bidMap.get(id) ?? [], userId, Date.now());
}

/* ------------------------------------------------------------------ *
 * Lender funding — the investor side of the desk
 * ------------------------------------------------------------------ */

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

/**
 * Lock or read every enabled, spendable wallet for a customer. Balances and the
 * currency metadata are read separately and merged in code rather than with a
 * SQL JOIN: `customer_balances` inherits the database default collation while
 * `currency_registry` is pinned to utf8mb4_unicode_ci, so joining them fails
 * with "Illegal mix of collations" on databases whose default differs.
 */
async function readWalletRows(conn: Db, userId: number, forUpdate = false): Promise<WalletRow[]> {
  const [currencyRows] = await conn.query<any[]>(
    `SELECT code, scale, assetType, externalCode FROM currency_registry WHERE enabled=true ORDER BY id`,
  );
  const [balanceRows] = await conn.query<any[]>(
    `SELECT id, currency, COALESCE(availableMinor,0) availableMinor, COALESCE(lockedMinor,0) lockedMinor
     FROM customer_balances WHERE userId=? ORDER BY currency${forUpdate ? " FOR UPDATE" : ""}`,
    [userId],
  );
  const currencyByCode = new Map<string, any>();
  for (const row of currencyRows) currencyByCode.set(String(row.code).toUpperCase(), row);
  return balanceRows
    .map((row) => {
      const code = String(row.currency).toUpperCase();
      const currency = currencyByCode.get(code);
      if (!currency) return null;
      return {
        id: Number(row.id), currency: code, scale: Number(currency.scale || 0), assetType: currency.assetType,
        externalCode: currency.externalCode ? String(currency.externalCode) : null,
        availableMinor: Number(row.availableMinor || 0), lockedMinor: Number(row.lockedMinor || 0),
      } as WalletRow;
    })
    .filter((wallet): wallet is WalletRow => wallet !== null);
}

async function loadWalletRates(wallets: WalletRow[]): Promise<Map<string, FxRateSnapshot | null>> {
  const rates = new Map<string, FxRateSnapshot | null>();
  await Promise.all(
    wallets
      .filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0)
      .map(async (wallet) => {
        try {
          rates.set(wallet.currency, await getFreshTradingFxRate({
            code: wallet.currency, scale: wallet.scale, assetType: wallet.assetType, externalCode: wallet.externalCode,
          }));
        } catch {
          rates.set(wallet.currency, null);
        }
      }),
  );
  return rates;
}

/**
 * Build the all-or-nothing funding plan for a position that settles in USD.
 * `COMBINED` spends the settlement wallet first then draws on the other funded
 * wallets in administrator priority order through live FX; a currency code funds
 * the whole position from that one wallet. Any shortfall or missing rate throws;
 * nothing is ever debited partially.
 */
function planLendingFunding(
  wallets: WalletRow[],
  rates: Map<string, FxRateSnapshot | null>,
  requiredUsdMinor: number,
  fundingSource: string,
  priorityOrder: string[] | null,
): FundingPlan {
  if (!Number.isSafeInteger(requiredUsdMinor) || requiredUsdMinor < 1) throw new Error("Enter a valid funding amount");
  if (requiredUsdMinor > MAX_FUNDING_MINOR) throw new Error("This amount exceeds the per-position ceiling on the lending desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || LENDING_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === LENDING_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === LENDING_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === LENDING_COMBINED_SOURCE ? usdAvailableMinor : 0;
  if (requiredUsdMinor <= targetAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  if (!candidates.length) throw insufficient;

  const plan = planCrossWalletFunding({
    requiredTargetMinor: requiredUsdMinor,
    targetAvailableMinor,
    targetRate,
    sourceWallets: candidates.map((wallet) => ({
      currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor, rate: rates.get(wallet.currency) ?? null,
    })),
    priorityCurrencies: source === LENDING_COMBINED_SOURCE ? priorityOrder : null,
  });

  return {
    requiredUsdMinor,
    usdAvailableMinor,
    convertedUsdMinor: plan.targetCreditMinor,
    debits: plan.sourceDebits.map((debit) => ({
      currency: debit.currency, amountMinor: debit.amountMinor, convertedUsdMinor: debit.convertedTargetMinor, rate: debit.rate,
    })),
    targetRate,
  };
}

/** Preview how funding a loan would be funded, without touching any balance. */
export async function quoteLendingFunding(
  userId: number,
  input: { loanId: string; amountMinor: number; fundingSource?: string },
) {
  const amountMinor = Math.round(Number(input.amountMinor) || 0);
  const wallets = await withConnection((conn) => readWalletRows(conn, userId));
  const rates = await loadWalletRates(wallets);
  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const targetRate = usdUnitRate(usd ? usd.scale : 2);

  let combinedAvailableMinor: number | null = null;
  try {
    combinedAvailableMinor = calculateCombinedAvailableTargetMinor({
      targetCurrency: SETTLEMENT_CURRENCY,
      targetRate,
      wallets: wallets.map((wallet) => ({
        currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor,
        rate: wallet.currency === SETTLEMENT_CURRENCY ? null : rates.get(wallet.currency) ?? null,
      })),
    });
  } catch { combinedAvailableMinor = null; }

  const priority = await getWalletFundingPriorityForFunding();
  const order = "blocked" in priority ? null : priority.order;

  try {
    const plan = planLendingFunding(wallets, rates, amountMinor, String(input.fundingSource || LENDING_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || LENDING_COMBINED_SOURCE).toUpperCase(),
      sufficient: true,
      combinedAvailableMinor,
      settlementCurrency: SETTLEMENT_CURRENCY,
      usdAvailableMinor: plan.usdAvailableMinor,
      convertedUsdMinor: plan.convertedUsdMinor,
      shortfallMinor: 0,
      debits: plan.debits.map((debit) => ({
        currency: debit.currency, amountMinor: debit.amountMinor, convertedUsdMinor: debit.convertedUsdMinor,
        rate: debit.rate.rateUsdPerUnit, rateProvider: debit.rate.provider,
      })),
      message: null as string | null,
    };
  } catch (error) {
    const rateGap = error instanceof FxRateUnavailableError;
    const shortfallMinor = combinedAvailableMinor !== null ? Math.max(0, amountMinor - combinedAvailableMinor) : amountMinor;
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || LENDING_COMBINED_SOURCE).toUpperCase(),
      sufficient: false,
      combinedAvailableMinor,
      settlementCurrency: SETTLEMENT_CURRENCY,
      usdAvailableMinor: usd ? usd.availableMinor : 0,
      convertedUsdMinor: 0,
      shortfallMinor,
      debits: [],
      message: rateGap ? (error as Error).message : "Insufficient combined spendable wallet balance at current exchange rates",
    };
  }
}

/**
 * Fund a loan from the customer's own money (the investor side). Settles in USD
 * and may be funded from the settlement wallet, a single chosen wallet, or every
 * wallet combined through live FX. The wallet ledger is debited per source
 * wallet, the amount is locked, and one durable position plus a notice is written
 * in a single transaction. Idempotent per request key.
 */
export async function fundLendingLoan(
  userId: number,
  input: { loanId: string; amountMinor: number; fundingSource?: string; idempotencyKey: string },
) {
  await ensureLendingDeskSchema();
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid funding amount");
  if (input.amountMinor > MAX_FUNDING_MINOR) throw new Error("This amount exceeds the per-position ceiling on the lending desk");

  const loanId = String(input.loanId || "").trim();
  const loan = await findAdminLendingLoan(loanId);
  if (!loan || !loan.enabled) throw new Error("This loan is not currently open on the lending desk");
  if (loan.stage === "SETTLED" || loan.stage === "DEFAULTED" || loan.stage === "WITHDRAWN") throw new Error("This loan is closed and no longer accepts funding");
  if (loan.principalMinor !== null && input.amountMinor > loan.principalMinor) throw new Error("Your funding cannot exceed the loan principal");

  const fundingSource = String(input.fundingSource || LENDING_COMBINED_SOURCE).trim().toUpperCase();
  const key = idempotencyKey("lending:fund", input.idempotencyKey, userId);
  const expectedBps = loan.startingInterestBps;
  const tenureMonths = loan.maximumTenureMonths ?? loan.minimumTenureMonths ?? 12;

  const priority = await getWalletFundingPriorityForFunding();
  if ("blocked" in priority) throw new Error(priority.blocked);
  const preWallets = await withConnection((conn) => readWalletRows(conn, userId));
  const rates = await loadWalletRates(preWallets);

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [userId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      await conn.execute(
        `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
        [userId, SETTLEMENT_CURRENCY],
      );
      const wallets = await readWalletRows(conn, userId, true);
      const plan = planLendingFunding(wallets, rates, input.amountMinor, fundingSource, priority.order);

      const now = new Date();
      const positionCode = `LN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `lending-funding:${positionCode}`;

      for (const debit of plan.debits) {
        const row = wallets.find((wallet) => wallet.currency === debit.currency);
        if (!row) throw new Error(`Source wallet ${debit.currency} disappeared during funding`);
        const [update] = await conn.execute<any>(
          `UPDATE customer_balances SET availableMinor=availableMinor-?, updatedAt=NOW() WHERE id=? AND availableMinor>=?`,
          [debit.amountMinor, row.id, debit.amountMinor],
        );
        if (Number(update.affectedRows || 0) !== 1) throw new Error(`Insufficient spendable ${debit.currency} balance to fund this position`);
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, debit.currency, -debit.amountMinor, "lending_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "lending_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "lending_cross_wallet_conversion", positionCode, targetCurrency: SETTLEMENT_CURRENCY,
              targetCreditMinor: debit.convertedUsdMinor, sourceDebitMinor: debit.amountMinor,
              fetchedAt: debit.rate.fetchedAt.toISOString(), scale: debit.rate.scale,
            }),
          ],
        );
      }

      const usdRow = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY)!;
      const minimumFromSettlement = Math.max(0, input.amountMinor - plan.convertedUsdMinor);
      const [settlementUpdate] = await conn.execute<any>(
        `UPDATE customer_balances SET availableMinor=availableMinor+?-?, lockedMinor=lockedMinor+?, updatedAt=NOW() WHERE id=? AND availableMinor>=?`,
        [plan.convertedUsdMinor, input.amountMinor, input.amountMinor, usdRow.id, minimumFromSettlement],
      );
      if (Number(settlementUpdate.affectedRows || 0) !== 1) throw new Error("Insufficient available settlement balance to complete this funding");
      await conn.execute(
        `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "lending_funding", reference],
      );

      const fundingPlanJson = JSON.stringify({
        fundingSource, settlementCurrency: SETTLEMENT_CURRENCY, requiredUsdMinor: input.amountMinor,
        settlementWalletMinor: input.amountMinor - plan.convertedUsdMinor, convertedUsdMinor: plan.convertedUsdMinor,
        sourceDebits: plan.debits.map((debit) => ({
          currency: debit.currency, amountMinor: debit.amountMinor, convertedUsdMinor: debit.convertedUsdMinor,
          rate: debit.rate.rateUsdPerUnit, rateProvider: debit.rate.provider, rateSourceDate: debit.rate.sourceDate,
        })),
        recordedAt: now.toISOString(),
      });

      await conn.execute(
        `INSERT INTO ${LENDING_POSITIONS_TABLE}
          (positionCode,userId,loanId,loanTitle,side,amountMinor,currency,fundingSource,fundingPlanJson,expectedInterestBps,tenureMonths,
           monthlyInterestMinor,yearlyInterestMinor,interestPlusCapitalMinor,platformFeeBps,positionStatus,openedAt,ledgerReference)
         VALUES (?,?,?,?, 'LENDER', ?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, loan.loanId, loan.title, input.amountMinor, SETTLEMENT_CURRENCY, fundingSource, fundingPlanJson,
          expectedBps, tenureMonths,
          monthlyInterestMinor(input.amountMinor, expectedBps), yearlyInterestMinor(input.amountMinor, expectedBps),
          interestPlusCapitalMinor(input.amountMinor, expectedBps, tenureMonths), loan.platformFeeBps, reference,
        ],
      );

      await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE loanId=?`, [input.amountMinor, loan.loanId]);

      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId, "Lending position opened",
          `Your funding of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} into “${loan.title}” was recorded through the wallet ledger, ${fundingLabel}. The amount is locked against the loan and released with its configured return when the borrower repays.`,
          `u${userId}:lending-funding:${positionCode}`, "ledger_debit", "normal",
        ],
      );

      const result = {
        positionCode, loanId: loan.loanId, loanTitle: loan.title, amountMinor: input.amountMinor,
        currency: SETTLEMENT_CURRENCY, fundingSource, expectedInterestBps: expectedBps, tenureMonths,
        fundingPlan: JSON.parse(fundingPlanJson), status: "ACTIVE" as const, openedAt: now.toISOString(), ledgerReference: reference,
      };
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [userId, key, "lending.fund", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Administration — disbursement and settlement
 * ------------------------------------------------------------------ */

/** True when every required disbursement condition is MET or WAIVED. */
function conditionsSatisfied(conditions: AdminLendingLoanRow["conditions"]): { ready: boolean; pending: string[] } {
  const pending = conditions.filter((condition) => condition.required && condition.status === "PENDING").map((condition) => condition.label);
  return { ready: pending.length === 0, pending };
}

async function findWinningBid(conn: Db, loanId: string): Promise<BidRow | null> {
  const [rows] = await conn.query<any[]>(
    `SELECT bidId,loanId,userId,borrowerLabel,bidInterestBps,amountMinor,tenureMonths,status,rank,placedAt,updatedAt
     FROM ${LENDING_BIDS_TABLE} WHERE loanId=? AND status IN ('WON','DISBURSED') ORDER BY id LIMIT 1`,
    [loanId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    bidId: String(row.bidId), loanId: String(row.loanId), userId: Number(row.userId),
    borrowerLabel: String(row.borrowerLabel), bidInterestBps: Number(row.bidInterestBps || 0),
    amountMinor: Number(row.amountMinor || 0), tenureMonths: Number(row.tenureMonths || 0),
    status: String(row.status) as BorrowerBidStatus, rank: Number(row.rank || 0),
    placedAt: new Date(row.placedAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Disburse an allocated loan to its winning borrower. The administrator's
 * disbursement conditions must all be met or waived first; then the principal is
 * credited to the winner's wallet through the ledger and the loan moves to
 * DISBURSED. Idempotent per request key; the winning borrower is resolved from
 * the auction itself, never from client input.
 */
export async function disburseLendingLoan(
  adminUserId: number,
  input: { loanId: string; idempotencyKey: string; reason?: string | null },
) {
  await ensureLendingDeskSchema();
  const loanId = String(input.loanId || "").trim();
  if (!loanId) throw new Error("Select a loan to disburse");
  const key = idempotencyKey("lending:disburse", input.idempotencyKey, adminUserId);

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [adminUserId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1 FOR UPDATE`, [loanId]);
      if (!rows.length) throw new Error("This loan no longer exists on the desk");
      const loan = rows[0];
      if (String(loan.stage) !== "ALLOCATED") throw new Error("Only an allocated loan can be disbursed");

      const conditions = Array.isArray(JSON.parse(loan.conditionsJson || "[]")) ? JSON.parse(loan.conditionsJson || "[]") : [];
      const pending = conditions.filter((condition: any) => condition?.required !== false && condition?.status === "PENDING").map((condition: any) => String(condition?.label || condition?.type));
      if (pending.length) throw new Error(`Meet the disbursement conditions first: ${pending.join(", ")}`);

      const winner = await findWinningBid(conn, loanId);
      if (!winner) throw new Error("This loan has no winning bid to disburse");
      const principal = loan.principalMinor === null ? winner.amountMinor : Number(loan.principalMinor);

      await conn.execute(
        `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
        [winner.userId, SETTLEMENT_CURRENCY],
      );
      await conn.execute(
        `UPDATE customer_balances SET availableMinor=availableMinor+?, updatedAt=NOW() WHERE userId=? AND currency=?`,
        [principal, winner.userId, SETTLEMENT_CURRENCY],
      );
      await conn.execute(
        `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,true)`,
        [winner.userId, SETTLEMENT_CURRENCY, principal, "lending_disbursement", `lending-disbursement:${loanId}`],
      );
      await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET stage='DISBURSED', updatedAt=NOW(3) WHERE loanId=?`, [loanId]);
      await conn.execute(`UPDATE ${LENDING_BIDS_TABLE} SET status='DISBURSED' WHERE loanId=? AND status='WON'`, [loanId]);

      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          winner.userId, "Loan disbursed",
          `Your winning bid on “${loan.title}” cleared its conditions and ${principal} minor units of ${SETTLEMENT_CURRENCY} were credited to your wallet. Repayment is due at ${winner.bidInterestBps} bps per annum over ${winner.tenureMonths} months.`,
          `u${winner.userId}:lending-disbursed:${loanId}`, "ledger_credit", "high",
        ],
      );

      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [adminUserId, "lending_loan_disbursed", "lending_loan", loanId, `lending_loan:${loanId}`,
         JSON.stringify({ loanId, winnerBidId: winner.bidId, principalMinor: principal, topBidBps: winner.bidInterestBps, reason: input.reason ? String(input.reason).slice(0, 400) : null })],
      );

      const result = { loanId, winnerLabel: winner.borrowerLabel, principalMinor: principal, topBidBps: winner.bidInterestBps, status: "DISBURSED" as const };
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [adminUserId, key, "lending.disburse", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/**
 * Settle a disbursed loan. For REPAID / REPAID_LATE the borrower's wallet is
 * debited (principal + interest) and every funding position is credited its
 * principal plus pro-rata interest, less the platform fee; each lender's lock is
 * released. For DEFAULT / WRITE_OFF the capital is written off — no credit is
 * fabricated. Idempotent against a double submit; historical entries are never
 * edited.
 */
export async function settleLendingLoan(
  adminUserId: number,
  input: { loanId: string; outcome: LendingOutcome; idempotencyKey: string; reason?: string | null },
) {
  await ensureLendingDeskSchema();
  const loanId = String(input.loanId || "").trim();
  if (!loanId) throw new Error("Select a loan to settle");
  if (!["REPAID", "REPAID_LATE", "DEFAULT", "WRITE_OFF"].includes(input.outcome)) throw new Error("Select a valid outcome");
  const key = idempotencyKey("lending:settle", input.idempotencyKey, adminUserId);
  const writtenOff = input.outcome === "DEFAULT" || input.outcome === "WRITE_OFF";

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [adminUserId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [rows] = await conn.query<any[]>(`SELECT * FROM ${LENDING_LOANS_TABLE} WHERE loanId=? LIMIT 1 FOR UPDATE`, [loanId]);
      if (!rows.length) throw new Error("This loan no longer exists on the desk");
      const loan = rows[0];
      if (String(loan.stage) !== "DISBURSED" && String(loan.stage) !== "REPAYING") throw new Error("Only a disbursed loan can be settled");

      const winner = await findWinningBid(conn, loanId);
      if (!winner) throw new Error("This loan has no winning bid");
      const principal = Number(loan.principalMinor === null ? winner.amountMinor : loan.principalMinor) || winner.amountMinor;
      const owed = interestPlusCapitalMinor(principal, winner.bidInterestBps, winner.tenureMonths) ?? principal;
      const feeBps = Number(loan.platformFeeBps || 0);

      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, loanTitle FROM ${LENDING_POSITIONS_TABLE} WHERE loanId=? AND outcome IS NULL FOR UPDATE`,
        [loanId],
      );
      const totalLenderMinor = positions.reduce((sum, position) => sum + Number(position.amountMinor || 0), 0);
      const loanTitle = String(loan.title || loanId);

      let repaidMinor = 0;
      let creditedToLenders = 0;
      let feeMinor = 0;

      if (!writtenOff) {
        await conn.execute(
          `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
          [winner.userId, SETTLEMENT_CURRENCY],
        );
        const [debit] = await conn.execute<any>(
          `UPDATE customer_balances SET availableMinor=availableMinor-?, updatedAt=NOW() WHERE userId=? AND currency=? AND availableMinor>=?`,
          [owed, winner.userId, SETTLEMENT_CURRENCY, owed],
        );
        if (Number(debit.affectedRows || 0) !== 1) throw new Error("The borrower has insufficient balance to repay; record a default instead");
        repaidMinor = owed;
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [winner.userId, SETTLEMENT_CURRENCY, -owed, "lending_repayment", `lending-repayment:${loanId}`],
        );

        const interestPortion = Math.max(0, owed - principal);
        feeMinor = feeBps > 0 ? Math.round((interestPortion * feeBps) / 10_000) : 0;
        creditedToLenders = owed - feeMinor;
      }

      let remainder = creditedToLenders;
      for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index];
        const amount = Number(position.amountMinor || 0);
        const ownerId = Number(position.userId);
        const share = positions.length
          ? (index === positions.length - 1 ? remainder : (totalLenderMinor > 0 ? Math.round((creditedToLenders * amount) / totalLenderMinor) : 0))
          : creditedToLenders;
        if (index < positions.length - 1) remainder -= share;

        await conn.execute(
          `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
          [ownerId, SETTLEMENT_CURRENCY],
        );
        await conn.execute(
          `UPDATE customer_balances SET availableMinor=availableMinor+?, lockedMinor=GREATEST(0, lockedMinor-?), updatedAt=NOW() WHERE userId=? AND currency=?`,
          [share, amount, ownerId, SETTLEMENT_CURRENCY],
        );
        if (share > 0) {
          await conn.execute(
            `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,true)`,
            [ownerId, SETTLEMENT_CURRENCY, share, "lending_payout", `lending-payout:${position.positionCode}`],
          );
        }
        await conn.execute(
          `UPDATE ${LENDING_POSITIONS_TABLE} SET outcome=?, realisedMinor=?, settledAt=NOW(), positionStatus=? WHERE id=?`,
          [input.outcome, share, share > 0 ? "SETTLED" : "WRITTEN_OFF", position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            share > 0 ? "Lending return credited" : "Lending capital written off",
            share > 0
              ? `“${loanTitle}” resolved as ${input.outcome === "REPAID_LATE" ? "repaid late" : "repaid"}. ${share} minor units of ${SETTLEMENT_CURRENCY} were credited to your wallet, returning your principal plus the borrower's interest, less the platform fee.`
              : `“${loanTitle}” was ${input.outcome === "DEFAULT" ? "defaulted" : "written off"}. The ${amount} minor units of ${SETTLEMENT_CURRENCY} principal were written off; no credit was made.`,
            `u${ownerId}:lending-outcome:${position.positionCode}`, share > 0 ? "ledger_credit" : "ledger_debit", "normal",
          ],
        );
      }

      const terminalStage = writtenOff ? "DEFAULTED" : "SETTLED";
      await conn.execute(`UPDATE ${LENDING_LOANS_TABLE} SET stage=?, updatedAt=NOW(3) WHERE loanId=?`, [terminalStage, loanId]);
      await applyLendingLoanOutcome(conn, loanId, input.outcome);

      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [adminUserId, "lending_loan_settled", "lending_loan", loanId, `lending_loan:${loanId}`,
         JSON.stringify({ loanId, outcome: input.outcome, repaidMinor, creditedToLenders, feeMinor, positions: positions.length, reason: input.reason ? String(input.reason).slice(0, 400) : null })],
      );

      const result = { loanId, outcome: input.outcome, stage: terminalStage, repaidMinor, creditedToLenders, feeMinor, positions: positions.length };
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [adminUserId, key, "lending.settle", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/** Loans awaiting disbursement or settlement, for the administrator console. */
export async function listLendingLoansForSettlement() {
  await ensureLendingDeskSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(
      `SELECT loanId, title, borrower, currency, principalMinor, startingInterestBps, stage, winnerLabel, committedMinor, auctionClosesAt
       FROM ${LENDING_LOANS_TABLE}
       WHERE stage IN ('ALLOCATED','DISBURSED','REPAYING') AND enabled=1
       ORDER BY updatedAt DESC LIMIT 200`,
    );
    return rows.map((row) => ({
      loanId: String(row.loanId), title: String(row.title), borrower: String(row.borrower),
      currency: String(row.currency || SETTLEMENT_CURRENCY),
      principalMinor: row.principalMinor === null ? null : Number(row.principalMinor),
      startingInterestBps: row.startingInterestBps === null ? null : Number(row.startingInterestBps),
      stage: String(row.stage), winnerLabel: row.winnerLabel ? String(row.winnerLabel) : null,
      committedMinor: Number(row.committedMinor || 0),
      auctionClosesAt: row.auctionClosesAt ? new Date(row.auctionClosesAt).toISOString() : null,
    }));
  });
}

/** The full live leaderboard for one loan, for the administrator console. */
export async function listLendingLoanBids(loanId: string) {
  await ensureLendingDeskSchema();
  const id = String(loanId || "").trim();
  if (!id) return [];
  return withConnection(async (conn) => {
    const bids = await readBidRows(conn, id);
    return rankLendingBids(bids.filter((bid) => bid.status === "ACTIVE" || bid.status === "OUTBID" || bid.status === "WON"))
      .map((bid) => bidRowToBid(bid, -1, null));
  });
}
