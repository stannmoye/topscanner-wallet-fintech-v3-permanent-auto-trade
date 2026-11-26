import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import "./tender-bid.css";
import {
  Banknote, Building2, Calendar, ChevronRight, Clock, ExternalLink, FileText,
  Filter, Globe2, Info, Landmark, MapPin, RefreshCw, Search, ShieldCheck, Tag, Wallet, X,
} from "lucide-react";

/**
 * Customer Tender Bid desk.
 *
 * Renders only real tenders recorded by the ingestion worker (`customer.tender`
 * endpoints) — never a placeholder or a synthesised row. The catalogue is
 * narrowable by country, industry, tender type, status, closing-soon and
 * contract-value band, and each tender opens a pop-up holding the full record
 * (long description scrolls inside the pop-up) plus every source link.
 *
 * Stage 4 adds the bid panel: the qualification amount, the customer's combined
 * eligible balance (all wallets, USD, fresh FX), and either a Bid button (when
 * the balance qualifies) or a deposit prompt (when it is short). A placed bid is
 * shown as a status chip driven by the server's `tender_bids.status`.
 *
 * Every amount is shown as a configured/contractual value; nothing implies an
 * external-market execution or a guaranteed award.
 */

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", DE: "Germany",
  FR: "France", NL: "Netherlands", BE: "Belgium", ES: "Spain", IT: "Italy",
  PL: "Poland", DK: "Denmark", FI: "Finland", IE: "Ireland", NO: "Norway",
  CH: "Switzerland", AU: "Australia", IN: "India", NG: "Nigeria", KE: "Kenya",
  ZA: "South Africa", GH: "Ghana", AE: "United Arab Emirates", SA: "Saudi Arabia",
};

const STATUS_LABELS: Record<string, string> = {
  upcoming: "Upcoming", open: "Open for bidding", closing: "Closing soon",
  closed: "Closed", awarded: "Awarded",
};

const BID_STATUS_LABELS: Record<string, string> = {
  placed: "Bid placed", charge_pending: "Charge pending", charged: "Charged",
  won: "Won", lost: "Lost", cancelled: "Cancelled",
};

const CONTRACT_BANDS: { id: string; label: string; min: number; max: number }[] = [
  { id: "any", label: "Any contract value", min: 0, max: Number.MAX_SAFE_INTEGER },
  { id: "under-1m", label: "Under $1M", min: 0, max: 1_000_000 * 100 - 1 },
  { id: "1m-10m", label: "$1M – $10M", min: 1_000_000 * 100, max: 10_000_000 * 100 },
  { id: "10m-50m", label: "$10M – $50M", min: 10_000_000 * 100, max: 50_000_000 * 100 },
  { id: "over-50m", label: "$50M and above", min: 50_000_000 * 100, max: Number.MAX_SAFE_INTEGER },
];

const countryLabel = (code: string) => COUNTRY_NAMES[code] || code || "—";

function usd(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(Number(minor))) return "Not available";
  return `$${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function native(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency) return "";
  return `${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function dateText(value: string | null | undefined): string {
  if (!value) return "Not stated";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not stated" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A fresh, non-guessable bid idempotency key (the server dedupes on it). */
function newIdempotencyKey(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : "";
  return uuid || `bid-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Ask the portal to show the wallet so a short-balance customer can deposit. */
function goToWallet(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("arbitrade:customer-navigate", { detail: "wallet" }));
}

type Tender = any;
type MyBid = any;

export function CustomerTenderBid({ push }: { push: (message: string) => void }) {
  const overview = trpc.customer.tender.overview.useQuery(undefined, { refetchInterval: 60000 });
  const bidContext = trpc.customer.tender.bidContext.useQuery(undefined, { refetchInterval: 30000 });
  const placeBid = trpc.customer.tender.placeBid.useMutation();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [tenderType, setTenderType] = useState("");
  const [status, setStatus] = useState("");
  const [closingSoon, setClosingSoon] = useState(false);
  const [band, setBand] = useState("any");
  const [openId, setOpenId] = useState<number | null>(null);
  const [biddingId, setBiddingId] = useState<number | null>(null);

  const tenders: Tender[] = overview.data?.tenders || [];
  const facets = overview.data?.facets;
  const eligibleUsdMinor = bidContext.data?.eligibleUsdMinor ?? null;
  const valuationAvailable = bidContext.data?.valuationAvailable ?? false;

  const bidsByTender = useMemo(() => {
    const map: Record<number, MyBid> = {};
    for (const bid of bidContext.data?.bids || []) map[Number(bid.tenderId)] = bid;
    return map;
  }, [bidContext.data?.bids]);

  const requestBid = (tender: Tender) => {
    setBiddingId(tender.id);
    placeBid.mutate({ tenderId: tender.id, idempotencyKey: newIdempotencyKey() }, {
      onSuccess: (result: any) => {
        setBiddingId(null);
        void bidContext.refetch();
        if (result?.status === "insufficient_balance") {
          void overview.refetch();
          push(result?.message || "Your balance does not cover the qualification amount. Deposit funds to qualify.");
          return;
        }
        push(result?.alreadyPlaced ? "Your bid on this tender is already recorded." : "Bid placed. The administrator will review it and apply the charge or decline it.");
      },
      onError: (error: any) => {
        setBiddingId(null);
        push(error?.message || "Your bid could not be placed. Please try again.");
      },
    });
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const selectedBand = CONTRACT_BANDS.find((entry) => entry.id === band) || CONTRACT_BANDS[0];
    return tenders.filter((tender) => {
      if (country && tender.countryCode !== country) return false;
      if (industry && tender.industry !== industry) return false;
      if (tenderType && tender.tenderType !== tenderType) return false;
      if (status && tender.status !== status) return false;
      if (closingSoon && tender.status !== "closing") return false;
      if (selectedBand.id !== "any") {
        // A tender whose USD value is unavailable is excluded from a band filter, never guessed.
        if (tender.contractAmountUsdMinor == null) return false;
        if (tender.contractAmountUsdMinor < selectedBand.min || tender.contractAmountUsdMinor > selectedBand.max) return false;
      }
      if (query) {
        const haystack = `${tender.title || ""} ${tender.buyer || ""} ${tender.industry || ""} ${tender.countryCode || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [tenders, search, country, industry, tenderType, status, closingSoon, band]);

  const openCount = tenders.filter((tender) => tender.status === "open" || tender.status === "closing").length;
  const closingCount = tenders.filter((tender) => tender.status === "closing").length;
  const myBidCount = bidContext.data?.bids.length || 0;
  const filtersActive = Boolean(search || country || industry || tenderType || status || closingSoon || band !== "any");

  const resetFilters = () => {
    setSearch(""); setCountry(""); setIndustry(""); setTenderType("");
    setStatus(""); setClosingSoon(false); setBand("any");
  };

  const openDetail = (tender: Tender) => { setOpenId(tender.id); };

  return <div className="arb-page portal-page tb-desk">
    <div className="portal-page-top">
      <div>
        <div className="eyebrow">Competitive allocations</div>
        <h1>Tender Bid</h1>
        <p>Browse live government and private-sector tenders collected from official procurement portals and published sources, with the contract value, bidding window and expected payment date for each.</p>
      </div>
      <span className="admin-live-chip"><span className="pulse"/> Live tender feeds</span>
    </div>

    <section className="tb-summary" aria-label="Tender desk summary">
      <div className="tb-summary-tile"><span className="tb-summary-icon"><Landmark size={17}/></span><div><small>Published tenders</small><strong>{overview.isLoading ? "…" : tenders.length}</strong></div></div>
      <div className="tb-summary-tile"><span className="tb-summary-icon"><Clock size={17}/></span><div><small>Open for bidding</small><strong>{overview.isLoading ? "…" : openCount}</strong></div></div>
      <div className="tb-summary-tile"><span className="tb-summary-icon"><Calendar size={17}/></span><div><small>Closing within 7 days</small><strong>{overview.isLoading ? "…" : closingCount}</strong></div></div>
      <div className="tb-summary-tile"><span className="tb-summary-icon"><Wallet size={17}/></span><div><small>Your bids</small><strong>{bidContext.isLoading ? "…" : myBidCount}</strong></div></div>
    </section>

    <section className="tb-filters" aria-label="Filter tenders">
      <label className="tb-search"><Search size={15}/><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, buyer or industry…" aria-label="Search tenders"/></label>
      <label className="tb-field"><span>Country</span><select value={country} onChange={(event) => setCountry(event.target.value)} aria-label="Filter by country"><option value="">All countries</option>{(facets?.countries || []).map((code: string) => <option key={code} value={code}>{countryLabel(code)}</option>)}</select></label>
      <label className="tb-field"><span>Industry</span><select value={industry} onChange={(event) => setIndustry(event.target.value)} aria-label="Filter by industry"><option value="">All industries</option>{(facets?.industries || []).map((value: string) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="tb-field"><span>Tender type</span><select value={tenderType} onChange={(event) => setTenderType(event.target.value)} aria-label="Filter by tender type"><option value="">All types</option>{(facets?.tenderTypes || []).map((value: string) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="tb-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="tb-field"><span>Contract value</span><select value={band} onChange={(event) => setBand(event.target.value)} aria-label="Filter by contract value">{CONTRACT_BANDS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
      <button type="button" className={`tb-toggle${closingSoon ? " is-on" : ""}`} aria-pressed={closingSoon} onClick={() => setClosingSoon((value) => !value)}><Filter size={14}/> Closing soon</button>
      <button type="button" className="tb-refresh" onClick={() => overview.refetch()} aria-label="Refresh tenders" title="Refresh tenders"><RefreshCw size={15}/></button>
      {filtersActive && <button type="button" className="tb-reset" onClick={resetFilters}>Reset filters</button>}
    </section>

    {overview.isError && !overview.data && <div className="tb-state" role="status">Tenders could not be loaded right now. Use Refresh to try again.</div>}
    {overview.isLoading && !overview.data && <div className="tb-state" role="status">Loading live tenders…</div>}

    {overview.data && !tenders.length && <div className="tb-state tb-empty">
      <ShieldCheck size={20}/>
      <strong>No tenders to display yet</strong>
      <span>Tenders appear here once the platform has ingested them from the enabled official and private sources. Nothing is shown until a real tender has been collected.</span>
    </div>}

    {overview.data && tenders.length > 0 && !filtered.length && <div className="tb-state" role="status">No tenders match the current filters. <button type="button" className="tb-link" onClick={resetFilters}>Reset filters</button>.</div>}

    {filtered.length > 0 && <section className="tb-grid" aria-label="Tender results">
      {filtered.map((tender) => {
        const source = tender.sources?.[0];
        const myBid: MyBid | undefined = bidsByTender[tender.id];
        return <article className="tb-card" key={tender.id}>
          <header className="tb-card-head">
            <span className={`tb-source-badge ${source?.kind === "private" ? "is-private" : "is-government"}`}>{source?.kind === "private" ? "Private source" : "Government source"}</span>
            <span className={`tb-status tb-status-${tender.status}`}>{STATUS_LABELS[tender.status] || tender.status}</span>
          </header>
          <h2 className="tb-card-title">{tender.title}</h2>
          <div className="tb-card-meta">
            <span><Building2 size={13}/>{tender.buyer || "Buyer not stated"}</span>
            <span><MapPin size={13}/>{countryLabel(tender.countryCode)}</span>
            {tender.industry && <span><Tag size={13}/>{tender.industry}</span>}
          </div>
          <div className="tb-card-figures">
            <div><small>Contract value</small><strong>{usd(tender.contractAmountUsdMinor)}</strong>{tender.contractCurrency && tender.contractCurrency !== "USD" && tender.contractAmountMinor != null && <em>{native(tender.contractAmountMinor, tender.contractCurrency)}</em>}</div>
            <div><small>Qualification amount</small><strong>{tender.qualificationConfigured ? usd(tender.qualificationAmountUsdMinor) : "Not yet configured"}</strong></div>
          </div>
          <div className="tb-card-dates">
            <span><Calendar size={13}/>Opens {dateText(tender.bidOpenAt)}</span>
            <span><Clock size={13}/>Expires {dateText(tender.bidCloseAt)}</span>
            <span><Banknote size={13}/>Expected payout {dateText(tender.payoutAt)}</span>
          </div>
          <footer className="tb-card-foot">
            {myBid && <span className={`tb-bid-chip tb-bid-chip-${myBid.status}`}>{BID_STATUS_LABELS[myBid.status] || myBid.status}</span>}
            {tender.sourceCount > 1 && <span className="tb-multi-source">{tender.sourceCount} sources</span>}
            <button type="button" className="tb-view" onClick={() => openDetail(tender)}>View details<ChevronRight size={14}/></button>
          </footer>
        </article>;
      })}
    </section>}

    <p className="tb-disclaimer"><Info size={14}/><span>Contract and qualification amounts are configured/contractual values taken from each tender's published source record. They are not a market quote and do not guarantee an award. Every tender links to its original source.</span></p>

    {openId != null && <TenderDetailModal
      tenderId={openId}
      myBid={bidsByTender[openId]}
      eligibleUsdMinor={eligibleUsdMinor}
      valuationAvailable={valuationAvailable}
      bidding={biddingId === openId}
      onBid={requestBid}
      onClose={() => setOpenId(null)}
    />}
  </div>;
}

function TenderDetailModal({ tenderId, myBid, eligibleUsdMinor, valuationAvailable, bidding, onBid, onClose }: {
  tenderId: number;
  myBid?: MyBid;
  eligibleUsdMinor: number | null;
  valuationAvailable: boolean;
  bidding: boolean;
  onBid: (tender: Tender) => void;
  onClose: () => void;
}) {
  const detail = trpc.customer.tender.detail.useQuery({ tenderId }, { enabled: Number.isFinite(tenderId) });
  const tender: Tender | null | undefined = detail.data;
  const canBid = tender?.status === "open" || tender?.status === "closing";
  const qualified = tender?.qualificationConfigured && eligibleUsdMinor != null && eligibleUsdMinor >= Number(tender.qualificationAmountUsdMinor);
  const shortfall = tender?.qualificationConfigured && eligibleUsdMinor != null
    ? Math.max(0, Number(tender.qualificationAmountUsdMinor) - eligibleUsdMinor)
    : null;
  return <div className="tb-modal-backdrop" role="presentation" onClick={onClose}>
    <div className="tb-modal" role="dialog" aria-modal="true" aria-label="Tender details" onClick={(event) => event.stopPropagation()}>
      <header className="tb-modal-head">
        <div>
          <span className="eyebrow">Tender details</span>
          <h2>{tender?.title || (detail.isLoading ? "Loading…" : "Tender unavailable")}</h2>
          {tender && <div className="tb-modal-sub">{countryLabel(tender.countryCode)} · {tender.buyer || "Buyer not stated"}{tender.tenderType ? ` · ${tender.tenderType}` : ""}</div>}
        </div>
        <button type="button" className="tb-modal-close" onClick={onClose} aria-label="Close tender details"><X size={18}/></button>
      </header>

      <div className="tb-modal-body">
        {detail.isLoading && <div className="tb-state" role="status">Loading tender…</div>}
        {detail.isError && <div className="tb-state" role="status">This tender could not be loaded. Close and try again.</div>}
        {detail.data === null && <div className="tb-state" role="status">This tender is no longer available.</div>}

        {tender && <>
          <div className={`tb-modal-status tb-status-${tender.status}`}>{STATUS_LABELS[tender.status] || tender.status}</div>

          <section className="tb-modal-figures">
            <div><small>Contract value</small><strong>{usd(tender.contractAmountUsdMinor)}</strong>{tender.contractCurrency && tender.contractAmountMinor != null && <em>Published as {native(tender.contractAmountMinor, tender.contractCurrency)}</em>}</div>
            <div><small>Qualification amount</small><strong>{tender.qualificationConfigured ? usd(tender.qualificationAmountUsdMinor) : "Not yet configured"}</strong><em>{tender.qualificationConfigured ? "Configured/contractual value" : "Set by the administrator before bidding opens"}</em></div>
          </section>

          <BidPanel
            tender={tender}
            myBid={myBid}
            eligibleUsdMinor={eligibleUsdMinor}
            valuationAvailable={valuationAvailable}
            canBid={Boolean(canBid)}
            qualified={Boolean(qualified)}
            shortfall={shortfall}
            bidding={bidding}
            onBid={() => onBid(tender)}
          />

          <section className="tb-modal-block">
            <h3>Key facts</h3>
            <dl className="tb-modal-facts">
              <div><dt>Country</dt><dd>{countryLabel(tender.countryCode)}</dd></div>
              <div><dt>Buyer</dt><dd>{tender.buyer || "Not stated"}</dd></div>
              {tender.buyerType && <div><dt>Buyer type</dt><dd>{tender.buyerType}</dd></div>}
              <div><dt>Industry</dt><dd>{tender.industry || "Not stated"}</dd></div>
              <div><dt>Tender type</dt><dd>{tender.tenderType || "Not stated"}</dd></div>
              <div><dt>Procedure</dt><dd>{tender.procedure || "Not stated"}</dd></div>
              <div><dt>Bidding opens</dt><dd>{dateText(tender.bidOpenAt)}</dd></div>
              <div><dt>Bidding expires</dt><dd>{dateText(tender.bidCloseAt)}</dd></div>
              <div><dt>Expected payout</dt><dd>{dateText(tender.payoutAt)}</dd></div>
              <div><dt>Published</dt><dd>{dateText(tender.publishedAt)}</dd></div>
              <div><dt>Last synced</dt><dd>{dateText(tender.lastSyncedAt)}</dd></div>
            </dl>
          </section>

          {(tender.summary || tender.descriptionText) && <section className="tb-modal-block">
            <h3>Tender information</h3>
            {tender.summary && <p className="tb-modal-summary">{tender.summary}</p>}
            {tender.descriptionText && <div className="tb-modal-description">{tender.descriptionText}</div>}
          </section>}

          {tender.documents?.length > 0 && <section className="tb-modal-block">
            <h3>Documents</h3>
            <ul className="tb-modal-docs">{tender.documents.map((document: any, index: number) => <li key={`${document.url}-${index}`}><FileText size={14}/><a href={document.url} target="_blank" rel="noopener noreferrer">{document.label || document.url}<ExternalLink size={12}/></a></li>)}</ul>
          </section>}

          <section className="tb-modal-block">
            <h3>Source and attribution</h3>
            <ul className="tb-modal-sources">{tender.sources.map((source: any, index: number) => <li key={`${source.key || source.url}-${index}`}><span className={`tb-source-badge ${source.kind === "private" ? "is-private" : "is-government"}`}>{source.kind === "private" ? "Private" : "Government"}</span><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink size={12}/></a></li>)}</ul>
          </section>

          <p className="tb-modal-note"><Info size={14}/><span>Amounts are configured/contractual values from the tender's source record. Review the source link before acting; no award is guaranteed.</span></p>
        </>}
      </div>
    </div>
  </div>;
}

/**
 * The bid panel. Shows the qualification amount and the customer's eligible
 * balance, then either a Bid button (qualified) or a deposit prompt (short or
 * unvalued). Once a bid exists it shows the server-driven status chip instead.
 */
function BidPanel({ tender, myBid, eligibleUsdMinor, valuationAvailable, canBid, qualified, shortfall, bidding, onBid }: {
  tender: Tender;
  myBid?: MyBid;
  eligibleUsdMinor: number | null;
  valuationAvailable: boolean;
  canBid: boolean;
  qualified: boolean;
  shortfall: number | null;
  bidding: boolean;
  onBid: () => void;
}) {
  if (!tender.qualificationConfigured) {
    return <section className="tb-bid-panel tb-bid-idle">
      <h3>Place a bid</h3>
      <p className="tb-bid-message"><Info size={14}/>The qualification amount for this tender has not been configured yet, so bidding is not open.</p>
    </section>;
  }

  if (myBid) {
    return <section className="tb-bid-panel">
      <h3>Place a bid</h3>
      <div className="tb-bid-status">
        <span className={`tb-bid-chip tb-bid-chip-${myBid.status}`}>{BID_STATUS_LABELS[myBid.status] || myBid.status}</span>
        <small>Your bid is recorded. It moves through Placed → Charge pending → Charged → Won/Lost as the administrator reviews it.</small>
      </div>
      <div className="tb-bid-figures">
        <div><small>Qualification amount</small><strong>{usd(tender.qualificationAmountUsdMinor)}</strong></div>
        <div><small>Charge applied</small><strong>{myBid.chargeAmountUsdMinor != null ? usd(myBid.chargeAmountUsdMinor) : "Not yet applied"}</strong></div>
      </div>
      <p className="tb-bid-note"><Info size={14}/>Placing a bid records your interest only. No funds leave your wallet until an administrator applies the charge, and no award is guaranteed.</p>
    </section>;
  }

  if (!canBid) {
    return <section className="tb-bid-panel tb-bid-idle">
      <h3>Place a bid</h3>
      <p className="tb-bid-message"><Info size={14}/>Bidding is not open on this tender.</p>
    </section>;
  }

  return <section className="tb-bid-panel">
    <h3>Place a bid</h3>
    <div className="tb-bid-figures">
      <div><small>Qualification amount</small><strong>{usd(tender.qualificationAmountUsdMinor)}</strong></div>
      <div><small>Your eligible balance</small><strong>{valuationAvailable && eligibleUsdMinor != null ? usd(eligibleUsdMinor) : "Valuation unavailable"}</strong></div>
    </div>
    {qualified
      ? <button type="button" className="tb-bid-button" onClick={onBid} disabled={bidding}>{bidding ? "Placing your bid…" : "Bid on this tender"}</button>
      : <div className="tb-bid-deposit">
        <p>{!valuationAvailable || eligibleUsdMinor == null
          ? `Your eligible balance could not be valued at a current exchange rate. Add funds to your wallet, then place your bid.`
          : `Your eligible balance does not cover the ${usd(tender.qualificationAmountUsdMinor)} qualification amount${shortfall ? ` (short by ${usd(shortfall)})` : ""}. Add funds to your wallet to qualify, then place your bid.`}</p>
        <button type="button" className="tb-bid-deposit-button" onClick={goToWallet}><Wallet size={15}/>Add funds to qualify</button>
      </div>}
    <p className="tb-bid-note"><Info size={14}/>Placing a bid records your interest only. No funds leave your wallet until an administrator applies the charge, and no award is guaranteed.</p>
  </section>;
}
