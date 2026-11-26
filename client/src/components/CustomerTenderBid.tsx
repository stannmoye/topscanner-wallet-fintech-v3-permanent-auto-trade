import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import "./tender-bid.css";
import {
  Banknote, Building2, Calendar, ChevronRight, Clock, ExternalLink, FileText,
  Filter, Globe2, Info, Landmark, MapPin, RefreshCw, Search, ShieldCheck, Tag, X,
} from "lucide-react";

/**
 * Customer Tender Bid desk (Stage 3, read-only).
 *
 * Renders only real tenders recorded by the ingestion worker (`customer.tender`
 * endpoints) — never a placeholder or a synthesised row. The catalogue is
 * narrowable by country, industry, tender type, status, closing-soon and
 * contract-value band, and each tender opens a pop-up holding the full record
 * (long description scrolls inside the pop-up) plus every source link.
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

type Tender = any;

export function CustomerTenderBid({ push }: { push: (message: string) => void }) {
  const overview = trpc.customer.tender.overview.useQuery(undefined, { refetchInterval: 60000 });
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [tenderType, setTenderType] = useState("");
  const [status, setStatus] = useState("");
  const [closingSoon, setClosingSoon] = useState(false);
  const [band, setBand] = useState("any");
  const [openId, setOpenId] = useState<number | null>(null);

  const tenders: Tender[] = overview.data?.tenders || [];
  const facets = overview.data?.facets;

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
      <div className="tb-summary-tile"><span className="tb-summary-icon"><Globe2 size={17}/></span><div><small>Countries covered</small><strong>{overview.isLoading ? "…" : (facets?.countries.length || 0)}</strong></div></div>
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
            {tender.sourceCount > 1 && <span className="tb-multi-source">{tender.sourceCount} sources</span>}
            <button type="button" className="tb-view" onClick={() => openDetail(tender)}>View details<ChevronRight size={14}/></button>
          </footer>
        </article>;
      })}
    </section>}

    <p className="tb-disclaimer"><Info size={14}/><span>Contract and qualification amounts are configured/contractual values taken from each tender's published source record. They are not a market quote and do not guarantee an award. Every tender links to its original source.</span></p>

    {openId != null && <TenderDetailModal tenderId={openId} onClose={() => setOpenId(null)} onMessage={push}/>}
  </div>;
}

function TenderDetailModal({ tenderId, onClose, onMessage }: { tenderId: number; onClose: () => void; onMessage: (message: string) => void }) {
  const detail = trpc.customer.tender.detail.useQuery({ tenderId }, { enabled: Number.isFinite(tenderId) });
  const tender: Tender | null | undefined = detail.data;
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
