import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, ArrowLeft, BadgePercent, Banknote, Building2, Check, CircleHelp, Clock, Coins,
  Gavel, Landmark, RefreshCw, Scale, Search, ShieldCheck, Sparkles, Timer, TrendingUp, Trophy, Users,
  WalletCards, X, Zap, type LucideIcon,
} from "lucide-react";
import {
  LENDING_LOAN_TYPES,
  LENDING_REGION_LIST,
  LENDING_SECTORS,
  buildLendingAnalytics,
  disbursementConditionLabel,
  interestPlusCapitalMinor,
  lendingAuctionStatusLabel,
  lendingNextRequiredBps,
  lendingRegionLabel,
  lendingRiskLabel,
  lendingSectorLabel,
  lendingStageLabel,
  loanTypeBlurb,
  loanTypeLabel,
  monthlyInterestMinor,
  repaymentFrequencyLabel,
  yearlyInterestMinor,
  type LendingBid,
  type LendingLoan,
  type LoanSector,
  type LoanType,
} from "@shared/lending-catalogue";
import { createLendingAuctionAudio, lendingCountdownCue } from "./lending-auction-audio";
import "./lending.css";

// A loan as the desk returns it: the catalogue record with its live leaderboard.
type DeskLoan = LendingLoan & { leaderboard: LendingBid[] };

type WalletBalance = { currency: string; symbol?: string; scale: number; currencyName?: string; availableMinor: number; lockedMinor: number };
type LendingPosition = {
  id: number; positionCode: string; loanId: string; loanTitle: string; side: "BORROWER" | "LENDER";
  amountMinor: number; currency: string; fundingSource?: string | null; expectedInterestBps: number | null;
  tenureMonths: number | null; monthlyInterestMinor: number | null; yearlyInterestMinor: number | null;
  interestPlusCapitalMinor: number | null; platformFeeBps: number | null; outcome: string | null;
  realisedMinor: number | null; positionStatus: string; openedAt: string;
};

type LendingSoundSettings = { enabled?: boolean; volume?: number } | null | undefined;

// The auction moves, so the desk polls faster than the catalogue desks.
const MARKET_POLL_INTERVAL_MS = 15_000;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function money(minor: number | null | undefined, currency = "USD", scale = 2) {
  const value = Number(minor || 0) / Math.pow(10, Math.max(0, Number(scale) || 0));
  const digits = Math.max(0, Number(scale) || 0);
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, 2) }).format(value); }
  catch { return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`; }
}
const percent = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(2)}%`);
const tenureLabel = (minimum: number | null, maximum: number | null) => {
  if (minimum && maximum && minimum !== maximum) return `${minimum}–${maximum} mo`;
  if (minimum || maximum) return `${minimum || maximum} mo`;
  return "Not modelled";
};
function clockLabel(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
const when = (iso: string | null | undefined) => { if (!iso) return "—"; const at = Date.parse(iso); return Number.isFinite(at) ? new Date(at).toLocaleString() : "—"; };

const TYPE_ICON: Record<LoanType, LucideIcon> = {
  PERSONAL: WalletCards, AUTO: Zap, MORTGAGE: Landmark, BUSINESS_WORKING_CAPITAL: Building2,
  SME_EXPANSION: TrendingUp, EQUIPMENT_FINANCE: Coins, INVOICE_FACTORING: BadgePercent,
  TRADE_FINANCE: Scale, BRIDGE: Timer, PROJECT_FINANCE: Building2, STUDENT: Sparkles,
  MEDICAL: ShieldCheck, AGRICULTURAL: Sparkles, REAL_ESTATE: Landmark,
};

/**
 * Customer Lending desk. Two sides in one page: borrowers compete in a live,
 * server-timed interest auction (place, raise and withdraw a bid, watch the
 * masked leaderboard and the countdown), and lenders fund published loans from
 * any single wallet or the combined wallet balance. Every button only ever asks
 * the server to act; the wallet ledger is the source of truth and the countdown
 * is only ever a mirror of the server's clock.
 */
export function CustomerLending({ push, sound, soundSettings }: { push: (message: string) => void; sound?: boolean; soundSettings?: LendingSoundSettings }) {
  const deskQuery = trpc.customer.lending.desk.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
  });
  const [tab, setTab] = useState<"auctions" | "bids" | "reserves" | "positions">("auctions");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | LoanType>("ALL");
  const [sectorFilter, setSectorFilter] = useState<"ALL" | LoanSector>("ALL");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [sort, setSort] = useState<"auction" | "rate" | "amount" | "closing">("auction");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const desk = deskQuery.data;
  const loans = (desk?.loans ?? []) as DeskLoan[];
  const reserves = desk?.reserves ?? [];
  const positions = (desk?.positions ?? []) as LendingPosition[];
  const wallets = (desk?.balances ?? []) as WalletBalance[];
  const settlementCurrency = desk?.settlementCurrency ?? "USD";
  const availableMinor = Number(desk?.availableMinor ?? 0);
  const analytics = useMemo(() => buildLendingAnalytics(loans), [loans]);

  // ---- Server-anchored countdown -----------------------------------------
  // The server sends the remaining seconds it computed at fetch time; we anchor
  // that to the moment the payload arrived and only ever count DOWN from it, so
  // a drifted local clock cannot invent extra time.
  const [now, setNow] = useState(() => Date.now());
  const [anchor, setAnchor] = useState<{ at: number; base: Record<string, number> }>({ at: 0, base: {} });
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!desk) return;
    const base: Record<string, number> = {};
    for (const loan of loans) if (loan.remainingSeconds !== null && loan.remainingSeconds !== undefined) base[loan.id] = loan.remainingSeconds;
    setAnchor({ at: Date.now(), base });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk?.fetchedAt]);
  const remainingOf = (loan: DeskLoan): number | null => {
    const base = anchor.base[loan.id];
    if (base === undefined) return loan.remainingSeconds ?? null;
    return Math.max(0, base - Math.floor((now - anchor.at) / 1000));
  };

  // ---- Countdown sound ----------------------------------------------------
  const audioRef = useRef(createLendingAuctionAudio());
  const lastCueRef = useRef<Record<string, number>>({});
  const soundOn = Boolean(sound) && soundSettings?.enabled === true;
  const volume = Math.max(0, Math.min(1, Number(soundSettings?.volume ?? 0) / 100));
  const urgent = useMemo(() => {
    let best: { id: string; remaining: number } | null = null;
    for (const loan of loans) {
      if (!loan.biddable) continue;
      const remaining = remainingOf(loan);
      if (remaining === null) continue;
      if (!best || remaining < best.remaining) best = { id: loan.id, remaining };
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, now]);
  useEffect(() => {
    if (!soundOn || !urgent) return;
    const cue = lendingCountdownCue(urgent.remaining, lastCueRef.current[urgent.id] ?? null);
    if (!cue) return;
    lastCueRef.current[urgent.id] = cue.second;
    audioRef.current.play(cue.cue, volume);
  }, [soundOn, volume, urgent?.id, urgent?.remaining]);

  // ---- Derived views ------------------------------------------------------
  const myBids = useMemo(() => loans.filter((loan) => loan.viewerBidId), [loans]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = loans.filter((loan) => {
      if (typeFilter !== "ALL" && loan.loanType !== typeFilter) return false;
      if (sectorFilter !== "ALL" && loan.sector !== sectorFilter) return false;
      if (regionFilter !== "ALL" && loan.region !== regionFilter) return false;
      if (!query) return true;
      return `${loan.title} ${loan.borrower} ${loan.country} ${loan.purpose} ${loan.description}`.toLowerCase().includes(query);
    });
    const rank = { OPEN: 0, CLOSING_SOON: 1, SCHEDULED: 2, CLOSED: 3, ALLOCATED: 4, CANCELLED: 5 } as Record<string, number>;
    return [...rows].sort((a, b) => {
      if (sort === "rate") return (b.topBidBps ?? b.startingInterestBps ?? 0) - (a.topBidBps ?? a.startingInterestBps ?? 0);
      if (sort === "amount") return (b.principalMinor ?? 0) - (a.principalMinor ?? 0);
      if (sort === "closing") return (remainingOf(a) ?? 1e9) - (remainingOf(b) ?? 1e9);
      if (a.biddable !== b.biddable) return a.biddable ? -1 : 1;
      const status = (rank[a.auctionStatus] ?? 9) - (rank[b.auctionStatus] ?? 9);
      if (status !== 0) return status;
      return (b.topBidBps ?? 0) - (a.topBidBps ?? 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, search, typeFilter, sectorFilter, regionFilter, sort, now]);

  const selected = useMemo(() => loans.find((loan) => loan.id === selectedId) ?? null, [loans, selectedId]);

  // ---- Bid modal ----------------------------------------------------------
  const [bidTarget, setBidTarget] = useState<DeskLoan | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidTenure, setBidTenure] = useState("");
  const [bidRate, setBidRate] = useState("");
  const [bidNote, setBidNote] = useState("");
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidIdem, setBidIdem] = useState(newKey);
  const placeBid = trpc.customer.lending.placeBid.useMutation();
  const raiseBid = trpc.customer.lending.raiseBid.useMutation();
  const withdrawBid = trpc.customer.lending.withdrawBid.useMutation();

  const openBid = (loan: DeskLoan) => {
    const existingBid = loan.leaderboard.find((bid) => bid.isSelf);
    setBidTarget(loan);
    setBidAmount(String(Math.round((existingBid?.amountMinor ?? loan.principalMinor ?? 100000) / 1) / 100));
    setBidTenure(String(existingBid?.tenureMonths ?? loan.maximumTenureMonths ?? loan.minimumTenureMonths ?? 12));
    setBidRate(String((lendingNextRequiredBps(loan.topBidBps, loan.startingInterestBps) ?? loan.startingInterestBps ?? 0) / 100));
    setBidNote("");
    setBidError(null);
    setBidIdem(newKey());
  };

  const previewBid = useMemo(() => {
    const amount = Math.round((Number(bidAmount) || 0) * 100);
    const bps = Math.round((Number(bidRate) || 0) * 100);
    const months = Math.round(Number(bidTenure) || 0);
    return {
      amount, bps, months,
      monthly: monthlyInterestMinor(amount, bps),
      yearly: yearlyInterestMinor(amount, bps),
      total: interestPlusCapitalMinor(amount, bps, months),
    };
  }, [bidAmount, bidRate, bidTenure]);

  const submitBid = () => {
    if (!bidTarget) return;
    setBidError(null);
    const amountMinor = previewBid.amount;
    const tenureMonths = previewBid.months;
    const bidInterestBps = previewBid.bps;
    if (!(amountMinor > 0)) return setBidError("Enter the amount you want to borrow.");
    if (!(tenureMonths > 0)) return setBidError("Enter a tenure in whole months.");
    if (!(bidInterestBps > 0)) return setBidError("Enter the interest you will pay, in percent.");
    const existingBid = bidTarget.leaderboard.find((bid) => bid.isSelf);
    const onDone = (message: string) => { push(message); setBidTarget(null); setBidIdem(newKey()); void deskQuery.refetch(); };
    if (existingBid) {
      raiseBid.mutate({ bidId: existingBid.id, bidInterestBps, idempotencyKey: bidIdem }, {
        onSuccess: (result) => onDone(result.isLeading ? "Your raised bid now leads the auction." : "Bid raised. You are outbid but still live."),
        onError: (error) => setBidError(error.message),
      });
    } else {
      placeBid.mutate({ loanId: bidTarget.id, bidInterestBps, amountMinor, tenureMonths, idempotencyKey: bidIdem }, {
        onSuccess: (result) => onDone(result.isLeading ? "Your bid now leads the auction." : "Bid recorded — you can raise it to take the top spot."),
        onError: (error) => setBidError(error.message),
      });
    }
  };

  const doWithdraw = (bidId: string) => {
    withdrawBid.mutate({ bidId }, {
      onSuccess: () => { push("Bid withdrawn."); void deskQuery.refetch(); },
      onError: (error) => push(error.message),
    });
  };

  // ---- Fund modal ---------------------------------------------------------
  const [fundTarget, setFundTarget] = useState<DeskLoan | null>(null);
  const [fundAmount, setFundAmount] = useState("");
  const [fundSource, setFundSource] = useState("COMBINED");
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundIdem, setFundIdem] = useState(newKey);
  const fund = trpc.customer.lending.fund.useMutation();
  const fundMinor = Math.max(0, Math.round((Number(fundAmount) || 0) * 100));
  const quote = trpc.customer.lending.fundingQuote.useQuery(
    { loanId: fundTarget?.id ?? "", amountMinor: fundMinor, fundingSource: fundSource },
    { enabled: Boolean(fundTarget) && fundMinor > 0, refetchOnWindowFocus: false },
  );
  const openFund = (loan: DeskLoan) => {
    setFundTarget(loan);
    setFundAmount(String(Math.round(Math.min(loan.principalMinor ?? 100000, 100000) / 1) / 100));
    setFundSource("COMBINED");
    setFundError(null);
    setFundIdem(newKey());
  };
  const submitFund = () => {
    if (!fundTarget) return;
    setFundError(null);
    if (fundMinor <= 0) return setFundError("Enter the amount you want to commit.");
    fund.mutate({ loanId: fundTarget.id, amountMinor: fundMinor, fundingSource: fundSource, idempotencyKey: fundIdem }, {
      onSuccess: (result) => { push(`Committed ${money(result.amountMinor, result.currency)} into “${result.loanTitle}”.`); setFundTarget(null); setFundIdem(newKey()); void deskQuery.refetch(); },
      onError: (error) => setFundError(error.message),
    });
  };

  const summary = desk?.summary;
  const loading = deskQuery.isLoading;
  const bidBusy = placeBid.isPending || raiseBid.isPending;

  return <div className="lend-page portal-page arb-page">
    <div className="lend-hero">
      <div className="lend-hero-glow" aria-hidden="true" />
      <div className="lend-masthead">
        <div className="lend-masthead-lead">
          <div className="eyebrow">Borrower auctions · lender funding</div>
          <h1 className="lend-title">Lending</h1>
          <p className="lend-lede">Borrow competitively against other customers in a live, server-timed interest auction — the highest bid when the countdown expires wins the loan. Or fund a published loan and earn the borrower's interest. Every movement is an internal ledger entry.</p>
        </div>
        <div className="lend-masthead-side">
          <span className="lend-live-chip"><span className="lend-pulse" /> Server-timed auction</span>
          <div className="lend-sources">{deskQuery.isError
            ? <span className="lend-source-chip is-unavailable">Live desk unavailable</span>
            : <span className="lend-source-chip is-ok">Ledger-backed · {settlementCurrency}</span>}
          </div>
        </div>
      </div>
      <div className="lend-figures">
        <div className="lend-figure lend-figure--live"><span>Open auctions</span><b>{summary?.openAuctions ?? 0}</b></div>
        <div className="lend-figure lend-figure--warn"><span>Closing soon</span><b>{summary?.closingSoon ?? 0}</b></div>
        <div className="lend-figure"><span>Live bids</span><b>{summary?.liveBids ?? 0}</b></div>
        <div className="lend-figure lend-figure--lead"><span>Your bids / leading</span><b>{summary?.myBids ?? 0} / {summary?.myLeading ?? 0}</b></div>
        <div className="lend-figure"><span>Lender capacity</span><b>{money(summary?.lenderCapacityMinor ?? 0, settlementCurrency)}</b></div>
      </div>
    </div>

    <div className="lend-banner"><ShieldCheck size={16} /><span>Bidding is free and never moves a wallet. Lender funding debits and locks your chosen wallet through the ledger, and it is returned with the borrower's interest when the loan resolves. Rates are administrator-configured terms, not guaranteed returns.</span></div>

    <div className="lend-toolbar">
      <div className="lend-tabs">
        <button className={`lend-tab${tab === "auctions" ? " active" : ""}`} onClick={() => setTab("auctions")}>Auctions ({loans.length})</button>
        <button className={`lend-tab${tab === "bids" ? " active" : ""}`} onClick={() => setTab("bids")}>My bids ({myBids.length})</button>
        <button className={`lend-tab${tab === "reserves" ? " active" : ""}`} onClick={() => setTab("reserves")}>Lender reserves ({reserves.length})</button>
        <button className={`lend-tab${tab === "positions" ? " active" : ""}`} onClick={() => setTab("positions")}>My positions ({positions.length})</button>
      </div>
      <div className="lend-filters">
        <button className="secondary-button" onClick={() => void deskQuery.refetch()} disabled={deskQuery.isFetching}><RefreshCw size={14} className={deskQuery.isFetching ? "spin" : ""} /> Refresh</button>
        {tab === "auctions" && <>
          <label className="lend-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loans" aria-label="Search loans" /></label>
          <select className="lend-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} aria-label="Loan type">
            <option value="ALL">All types</option>
            {LENDING_LOAN_TYPES.map((type) => <option key={type} value={type}>{loanTypeLabel(type)}</option>)}
          </select>
          <select className="lend-select" value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value as typeof sectorFilter)} aria-label="Sector">
            <option value="ALL">All sectors</option>
            {LENDING_SECTORS.map((sector) => <option key={sector} value={sector}>{lendingSectorLabel(sector)}</option>)}
          </select>
          <select className="lend-select" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} aria-label="Region">
            <option value="ALL">All regions</option>
            {LENDING_REGION_LIST.map((region) => <option key={region} value={region}>{lendingRegionLabel(region)}</option>)}
          </select>
          <select className="lend-select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort">
            <option value="auction">Auction order</option>
            <option value="closing">Closing soonest</option>
            <option value="rate">Highest rate</option>
            <option value="amount">Largest amount</option>
          </select>
        </>}
      </div>
    </div>

    {loading && <div className="lend-empty"><RefreshCw size={18} className="spin" /><strong>Loading the lending desk…</strong><span>Reading published loans, live auctions and your positions.</span></div>}

    {!loading && selected && <DetailView loan={selected} remaining={remainingOf(selected)} onClose={() => setSelectedId(null)} onBid={() => openBid(selected)} onFund={() => openFund(selected)} onWithdraw={doWithdraw} withdrawing={withdrawBid.isPending} />}

    {!loading && tab === "auctions" && <div className="lend-board">
      {filtered.map((loan) => <LoanCard key={loan.id} loan={loan} remaining={remainingOf(loan)} settlementCurrency={settlementCurrency}
        onSelect={() => setSelectedId(loan.id)} onBid={() => openBid(loan)} onFund={() => openFund(loan)} onWithdraw={doWithdraw} withdrawing={withdrawBid.isPending} />)}
      {!filtered.length && <div className="lend-empty"><Gavel size={20} /><strong>No loans match your filters.</strong><span>Try clearing the search, or check back when the administrator publishes the next auction.</span></div>}
    </div>}

    {!loading && tab === "bids" && <div className="lend-board">
      {myBids.map((loan) => <LoanCard key={loan.id} loan={loan} remaining={remainingOf(loan)} settlementCurrency={settlementCurrency}
        onSelect={() => setSelectedId(loan.id)} onBid={() => openBid(loan)} onFund={() => openFund(loan)} onWithdraw={doWithdraw} withdrawing={withdrawBid.isPending} />)}
      {!myBids.length && <div className="lend-empty"><Trophy size={20} /><strong>You have no live bids.</strong><span>Open an auction and place a bid to compete for the allocation.</span></div>}
    </div>}

    {!loading && tab === "reserves" && <div className="lend-panel">
      <div className="lend-panel-head"><div><div className="eyebrow">Administrator-posted lender capacity</div><h2>Lender reserves</h2></div><span>{reserves.length} reserve{reserves.length === 1 ? "" : "s"} · {money(summary?.lenderAvailableMinor ?? 0, settlementCurrency)} unallocated</span></div>
      <div className="lend-reserves">
        {reserves.map((reserve) => <div className="lend-reserve-card" key={reserve.id}>
          <header><strong>{reserve.flag} {reserve.lender}</strong><span className="lend-tag">{lendingRegionLabel(reserve.region)}</span></header>
          <div className="lend-reserve-metrics">
            <div><span>Capacity</span><b>{money(reserve.capacityMinor, reserve.currency)}</b></div>
            <div><span>Available</span><b>{money(reserve.availableMinor, reserve.currency)}</b></div>
            <div><span>Allocated</span><b>{money(reserve.allocatedMinor, reserve.currency)}</b></div>
            <div><span>Ticket range</span><b>{reserve.minimumTicketMinor === null && reserve.maximumTicketMinor === null ? "Open" : `${reserve.minimumTicketMinor === null ? "—" : money(reserve.minimumTicketMinor, reserve.currency)} – ${reserve.maximumTicketMinor === null ? "—" : money(reserve.maximumTicketMinor, reserve.currency)}`}</b></div>
            <div><span>Tenure</span><b>{tenureLabel(reserve.minimumTenureMonths, reserve.maximumTenureMonths)}</b></div>
            <div><span>From rate</span><b>{percent(reserve.startingInterestBps)}</b></div>
          </div>
          <div className="lend-loan-tags">
            {reserve.loanTypes.length ? reserve.loanTypes.map((type) => <span className="lend-tag" key={type}>{loanTypeLabel(type)}</span>) : <span className="lend-tag">All loan types</span>}
          </div>
          {reserve.note && <p className="lend-loan-sub">{reserve.note}</p>}
        </div>)}
        {!reserves.length && <div className="lend-empty"><Landmark size={20} /><strong>No lender reserves are published yet.</strong><span>A reserve appears here once an administrator posts a lender's capacity.</span></div>}
      </div>
    </div>}

    {!loading && tab === "positions" && <div className="lend-panel">
      <div className="lend-panel-head"><div><div className="eyebrow">Your ledger-backed bookings</div><h2>My lending positions</h2></div><span>{positions.length} position{positions.length === 1 ? "" : "s"} · {money(summary?.committedMinor ?? 0, settlementCurrency)} active capital</span></div>
      <div className="lend-positions">
        {positions.map((position) => <div className="lend-position-row" key={position.id}>
          <div>
            <strong>{position.loanTitle}</strong>
            <small>{position.positionCode} · {money(position.amountMinor, position.currency)} · {percent(position.expectedInterestBps)} · {position.tenureMonths} mo {position.fundingSource ? `· ${position.fundingSource}` : ""}</small>
          </div>
          <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
            <span className={`lend-position-side ${position.side === "LENDER" ? "is-lender" : "is-borrower"}`}>{position.side}</span>
            <small>{position.positionStatus}{position.realisedMinor ? ` · ${money(position.realisedMinor, position.currency)} realised` : ""}</small>
          </div>
        </div>)}
        {!positions.length && <div className="lend-empty"><Coins size={20} /><strong>No lending positions yet.</strong><span>Fund a loan to open a lender position, or win an auction to receive a disbursement.</span></div>}
      </div>
    </div>}

    {!loading && <div className="lend-panel">
      <div className="lend-panel-head"><div><div className="eyebrow">Analytical only · no ledger impact</div><h2>Desk analytics</h2></div><span>{analytics.totalLoans} loans · {analytics.openAuctions} open</span></div>
      <div className="lend-figures">
        <div className="lend-figure"><span>Total principal on desk</span><b>{money(analytics.totalPrincipalMinor, settlementCurrency)}</b></div>
        <div className="lend-figure"><span>Sum of leading bids</span><b>{percent(analytics.totalTopBidBps)}</b></div>
        <div className="lend-figure"><span>Average leading bid</span><b>{analytics.totalLoans ? percent(Math.round(analytics.totalTopBidBps / analytics.totalLoans)) : "—"}</b></div>
      </div>
    </div>}

    {bidTarget && <div className="lend-modal-backdrop" onMouseDown={() => setBidTarget(null)}>
      <div className="lend-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Place a bid">
        <div className="lend-modal-kicker"><span className="lend-pulse" /> {bidTarget.leaderboard.some((bid) => bid.isSelf) ? "Raise your bid" : "Place a bid"}</div>
        <h2>{bidTarget.title}</h2>
        <p className="lend-modal-note">Bid the interest you will pay. The highest bid when the countdown expires wins the allocation. {bidTarget.viewerNextRequiredBps ? `Bid at least ${percent(bidTarget.viewerNextRequiredBps)} to take the top spot.` : ""}</p>
        <div className="lend-form-grid">
          <div className="lend-field"><label>Amount to borrow ({settlementCurrency})</label><input type="number" min="0" value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} /></div>
          <div className="lend-field"><label>Tenure (months)</label><input type="number" min="1" value={bidTenure} onChange={(event) => setBidTenure(event.target.value)} /></div>
          <div className="lend-field"><label>Interest you will pay (% p.a.)</label><input type="number" min="0" step="0.01" value={bidRate} onChange={(event) => setBidRate(event.target.value)} /></div>
        </div>
        <div className="lend-terms">
          <div className="lend-term"><span>Monthly interest</span><b>{money(previewBid.monthly, settlementCurrency)}</b></div>
          <div className="lend-term"><span>Yearly interest</span><b>{money(previewBid.yearly, settlementCurrency)}</b></div>
          <div className="lend-term"><span>Interest + capital</span><b>{money(previewBid.total, settlementCurrency)}</b></div>
          <div className="lend-term"><span>Tenure</span><b>{previewBid.months} mo</b></div>
        </div>
        {bidError && <div className="lend-error"><AlertTriangle size={14} />{bidError}</div>}
        <div className="lend-modal-note"><CircleHelp size={12} /> Bidding does not move funds. The winner is allocated the loan amount only after the administrator's disbursement conditions are met.</div>
        <div className="lend-modal-actions">
          <button className="secondary-button" onClick={() => setBidTarget(null)}>Cancel</button>
          <button className="primary-button" onClick={submitBid} disabled={bidBusy}>{bidBusy ? "Submitting…" : "Confirm bid"} <Check size={14} /></button>
        </div>
      </div>
    </div>}

    {fundTarget && <div className="lend-modal-backdrop" onMouseDown={() => setFundTarget(null)}>
      <div className="lend-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Fund a loan">
        <div className="lend-modal-kicker"><span className="lend-pulse" /> Fund through the wallet ledger</div>
        <h2>{fundTarget.title}</h2>
        <p className="lend-modal-note">Commit capital to this loan. It is debited and locked from the source you choose, then returned with the borrower's interest when the loan resolves.</p>
        <div className="lend-form-grid">
          <div className="lend-field"><label>Amount to commit ({settlementCurrency})</label><input type="number" min="0" value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} /></div>
          <div className="lend-field"><label>Funding source</label><select value={fundSource} onChange={(event) => setFundSource(event.target.value)}>
            <option value="COMBINED">Combined balance ({settlementCurrency} first, then other wallets via live FX)</option>
            {wallets.map((wallet) => <option key={wallet.currency} value={wallet.currency}>{wallet.currency} · {money(wallet.availableMinor, wallet.currency, wallet.scale)} available</option>)}
          </select></div>
        </div>
        <div className="lend-terms">
          <div className="lend-term"><span>Your spendable {settlementCurrency}</span><b>{money(availableMinor, settlementCurrency)}</b></div>
          <div className="lend-term"><span>Commitment</span><b>{money(fundMinor, settlementCurrency)}</b></div>
        </div>
        {fundMinor > 0 && quote.data && <div className="lend-modal-note">
          {quote.data.sufficient
            ? <>Funded {quote.data.debits.length ? <>from {quote.data.debits.map((debit) => `${debit.currency} ${money(debit.amountMinor, debit.currency)}`).join(", ")} alongside {settlementCurrency}</> : <>from your {settlementCurrency} balance</>}. No partial funding: either the whole amount is debited or nothing is.</>
            : <span style={{ color: "var(--lend-red)" }}>{quote.data.message || "Insufficient spendable balance at current exchange rates."}</span>}
        </div>}
        {fundError && <div className="lend-error"><AlertTriangle size={14} />{fundError}</div>}
        <div className="lend-modal-actions">
          <button className="secondary-button" onClick={() => setFundTarget(null)}>Cancel</button>
          <button className="primary-button" onClick={submitFund} disabled={fund.isPending || (quote.data ? !quote.data.sufficient : false)}>{fund.isPending ? "Posting ledger…" : "Confirm commitment"} <Check size={14} /></button>
        </div>
      </div>
    </div>}
  </div>;
}

/* ------------------------------- Loan card ------------------------------- */
function LoanCard({ loan, remaining, settlementCurrency, onSelect, onBid, onFund, onWithdraw, withdrawing }: {
  loan: DeskLoan; remaining: number | null; settlementCurrency: string;
  onSelect: () => void; onBid: () => void; onFund: () => void; onWithdraw: (bidId: string) => void; withdrawing: boolean;
}) {
  const Icon = TYPE_ICON[loan.loanType] ?? Gavel;
  const live = loan.auctionStatus === "OPEN" || loan.auctionStatus === "CLOSING_SOON";
  const soon = loan.auctionStatus === "CLOSING_SOON";
  const clockClass = soon ? "lend-clock--soon" : live ? "lend-clock--live" : "lend-clock--closed";
  const own = loan.leaderboard.find((bid) => bid.isSelf);
  return <article className={`lend-loan-card${live ? " is-live" : ""}${soon ? " is-soon" : ""}${loan.viewerIsLeading ? " is-mine" : ""}`}>
    <div className="lend-loan-head">
      <div>
        <h3 className="lend-loan-title"><Icon size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />{loan.title}</h3>
        <p className="lend-loan-sub">{loan.flag} {loan.borrower} · {loanTypeLabel(loan.loanType)} · {loan.country}</p>
      </div>
      <span className={`lend-tag ${soon ? "lend-tag--warn" : live ? "lend-tag--live" : ""}`}>{lendingAuctionStatusLabel(loan.auctionStatus)}</span>
    </div>
    <div className="lend-loan-tags">
      <span className="lend-tag">{lendingSectorLabel(loan.sector)}</span>
      {loan.riskGrade && <span className="lend-tag">{lendingRiskLabel(loan.riskGrade)}</span>}
      <span className="lend-tag">{lendingRegionLabel(loan.region)}</span>
      {loan.viewerIsLeading && <span className="lend-tag lend-tag--lead"><Trophy size={11} /> You lead</span>}
      {own && !loan.viewerIsLeading && <span className="lend-tag lend-tag--live">Your bid live</span>}
    </div>
    <div className={clockClass ? `lend-clock ${clockClass}` : "lend-clock"}>
      <span className="lend-clock-digits lend-mono">{live ? clockLabel(remaining) : lendingAuctionStatusLabel(loan.auctionStatus)}</span>
      <span className="lend-clock-label">{live ? "Until bids close" : loan.auctionClosesAt ? `Closed ${when(loan.auctionClosesAt)}` : "No countdown set"}</span>
    </div>
    <div className="lend-terms">
      <div className="lend-term"><span>Principal</span><b>{money(loan.principalMinor, settlementCurrency)}</b></div>
      <div className="lend-term"><span>Reserve / top rate</span><b>{percent(loan.topBidBps ?? loan.startingInterestBps)}</b></div>
      <div className="lend-term"><span>Tenure</span><b>{tenureLabel(loan.minimumTenureMonths, loan.maximumTenureMonths)}</b></div>
      <div className="lend-term"><span>Repayment</span><b>{repaymentFrequencyLabel(loan.repaymentFrequency)}</b></div>
      <div className="lend-term"><span>Monthly interest</span><b>{money(loan.monthlyInterestMinor, settlementCurrency)}</b></div>
      <div className="lend-term"><span>Interest + capital</span><b>{money(loan.interestPlusCapitalMinor, settlementCurrency)}</b></div>
    </div>
    <div className="lend-leader">
      <div className="lend-leader-head"><span>Leaderboard · {loan.bidCount} live bid{loan.bidCount === 1 ? "" : "s"}</span>{loan.viewerNextRequiredBps ? <span>Lead at {percent(loan.viewerNextRequiredBps)}</span> : null}</div>
      {loan.leaderboard.slice(0, 3).map((bid) => <LeaderRow key={bid.id} bid={bid} settlementCurrency={settlementCurrency} />)}
      {!loan.leaderboard.length && <div className="lend-leader-empty">No bids yet — open this auction to take the top spot at the reserve rate.</div>}
    </div>
    <div className="lend-actions">
      <button className="secondary-button" onClick={onSelect}>Details <ArrowLeft size={13} style={{ transform: "rotate(180deg)" }} /></button>
      {live && <button className="primary-button" onClick={onBid}>{own ? "Raise bid" : "Place bid"} <Gavel size={13} /></button>}
      {own && live && <button className="secondary-button" onClick={() => onWithdraw(own.id)} disabled={withdrawing}>Withdraw</button>}
      {loan.auctionStatus !== "CANCELLED" && <button className="secondary-button" onClick={onFund}>Fund <Banknote size={13} /></button>}
    </div>
  </article>;
}

function LeaderRow({ bid, settlementCurrency }: { bid: LendingBid; settlementCurrency: string }) {
  return <div className={`lend-leader-row${bid.rank === 1 ? " is-top" : ""}${bid.isSelf ? " is-self" : ""}`}>
    <span className="lend-leader-rank">{bid.rank}</span>
    <span className="lend-leader-name"><strong>{bid.borrowerLabel}</strong>{bid.isSelf && <em className="lend-leader-self">YOU</em>}</span>
    <span className="lend-leader-amt lend-mono">{money(bid.amountMinor, settlementCurrency)} · {bid.tenureMonths}mo</span>
    <span className="lend-leader-rate lend-mono">{percent(bid.bidInterestBps)}</span>
  </div>;
}

/* ------------------------------- Detail view ------------------------------ */
function DetailView({ loan, remaining, onClose, onBid, onFund, onWithdraw, withdrawing }: {
  loan: DeskLoan; remaining: number | null; onClose: () => void; onBid: () => void; onFund: () => void;
  onWithdraw: (bidId: string) => void; withdrawing: boolean;
}) {
  const live = loan.auctionStatus === "OPEN" || loan.auctionStatus === "CLOSING_SOON";
  const soon = loan.auctionStatus === "CLOSING_SOON";
  const own = loan.leaderboard.find((bid) => bid.isSelf);
  return <section className="lend-detail" aria-label={`${loan.title} auction`}>
    <div className="lend-detail-head">
      <div>
        <div className="eyebrow">{loan.flag} {loan.country} · {lendingStageLabel(loan.stage)}</div>
        <h2 className="lend-loan-title">{loan.title}</h2>
        <p className="lend-loan-sub">{loan.borrower} · {loanTypeLabel(loan.loanType)} — {loanTypeBlurb(loan.loanType)}</p>
      </div>
      <div className="lend-actions">
        <button className="secondary-button" onClick={onClose}><ArrowLeft size={14} /> Back to board</button>
      </div>
    </div>
    <div className="lend-detail-grid">
      <div className="lend-detail-block">
        <span>Countdown</span>
        <div className={`lend-clock ${soon ? "lend-clock--soon" : live ? "lend-clock--live" : "lend-clock--closed"}`}>
          <span className="lend-clock-digits lend-mono">{live ? clockLabel(remaining) : lendingAuctionStatusLabel(loan.auctionStatus)}</span>
          <span className="lend-clock-label">{loan.auctionOpensAt ? `Opened ${when(loan.auctionOpensAt)}` : "Open"} · {loan.auctionClosesAt ? `closes ${when(loan.auctionClosesAt)}` : "no close set"}</span>
        </div>
      </div>
      <div className="lend-detail-block">
        <span>Loan terms</span>
        <div className="lend-terms">
          <div className="lend-term"><span>Principal</span><b>{money(loan.principalMinor, loan.currency)}</b></div>
          <div className="lend-term"><span>Starting rate</span><b>{percent(loan.startingInterestBps)}</b></div>
          <div className="lend-term"><span>Leading rate</span><b>{percent(loan.topBidBps ?? loan.startingInterestBps)}</b></div>
          <div className="lend-term"><span>Tenure</span><b>{tenureLabel(loan.minimumTenureMonths, loan.maximumTenureMonths)}</b></div>
          <div className="lend-term"><span>Monthly interest</span><b>{money(loan.monthlyInterestMinor, loan.currency)}</b></div>
          <div className="lend-term"><span>Yearly interest</span><b>{money(loan.yearlyInterestMinor, loan.currency)}</b></div>
          <div className="lend-term"><span>Interest + capital</span><b>{money(loan.interestPlusCapitalMinor, loan.currency)}</b></div>
          <div className="lend-term"><span>Platform fee</span><b>{percent(loan.platformFeeBps)}</b></div>
        </div>
      </div>
      <div className="lend-detail-block">
        <span>Live leaderboard · {loan.bidCount} bid{loan.bidCount === 1 ? "" : "s"}</span>
        <div className="lend-leader">
          {loan.leaderboard.map((bid) => <LeaderRow key={bid.id} bid={bid} settlementCurrency={loan.currency} />)}
          {!loan.leaderboard.length && <div className="lend-leader-empty">No bids yet.</div>}
        </div>
        {loan.leadingBorrower && <p className="lend-loan-sub">Leading borrower: {loan.leadingBorrower}{loan.viewerIsLeading ? " (you)" : ""}</p>}
      </div>
      <div className="lend-detail-block">
        <span>Disbursement conditions</span>
        <div className="lend-conditions">
          {loan.conditions.length ? loan.conditions.map((condition) => <div className={`lend-condition ${condition.status === "MET" || condition.status === "WAIVED" ? "is-met" : "is-pending"}`} key={condition.type}>
            <span>{condition.required ? "Required" : "Optional"}</span>
            <strong style={{ fontWeight: 600 }}>{disbursementConditionLabel(condition.type)}</strong>
            <span className="lend-condition-state">{condition.status}</span>
          </div>) : <div className="lend-leader-empty">No conditions set yet.</div>}
        </div>
      </div>
    </div>
    {loan.description && <p className="lend-lede">{loan.description}</p>}
    <div className="lend-actions">
      {live && <button className="primary-button" onClick={onBid}>{own ? "Raise your bid" : "Place a bid"} <Gavel size={14} /></button>}
      {own && live && <button className="secondary-button" onClick={() => onWithdraw(own.id)} disabled={withdrawing}>Withdraw my bid</button>}
      {loan.auctionStatus !== "CANCELLED" && <button className="secondary-button" onClick={onFund}>Fund this loan <Banknote size={14} /></button>}
      {loan.viewerNextRequiredBps && live && <span className="lend-badge lend-badge--lead"><Users size={12} /> Bid {percent(loan.viewerNextRequiredBps)} to lead</span>}
    </div>
  </section>;
}
