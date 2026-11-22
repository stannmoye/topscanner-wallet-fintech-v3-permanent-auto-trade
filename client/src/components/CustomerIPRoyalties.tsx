import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, CalendarClock, Check, ChevronLeft, ChevronRight, CircleHelp,
  Download, Globe2, Layers, Layers3, RefreshCw, ShieldCheck, Star, TrendingUp, X,
} from "lucide-react";
import {
  IP_RIGHT_TYPES,
  IP_ROYALTY_BASES,
  IP_ROYALTY_CADENCES,
  IP_ROYALTY_DOSSIER_STATUSES,
  IP_ROYALTY_RISK_GRADES,
  IP_ROYALTY_SECTORS,
  SECTOR_RIGHT_TYPES,
  basisLabel,
  buildIpRoyaltyAnalytics,
  cadenceLabel,
  getIpRoyaltiesCatalogue,
  outcomeLabel,
  rightTypeLabel,
  riskGradeLabel,
  sectorForRightType,
  sectorLabel,
  statusLabel,
  type IpRight,
  type IpRightType,
  type IpRoyaltyCadence,
  type IpRoyaltyPortfolio,
  type IpRoyaltyRiskGrade,
  type IpRoyaltySector,
  type IpRoyaltiesSource,
} from "@shared/ip-royalties-catalogue";
import "./ip-royalties.css";

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_KEY = "ip-royalties-watchlist";
const PAGE_SIZES = [6, 12, 24];

type WalletBalance = { currency: string; symbol?: string; scale: number; currencyName?: string; availableMinor: number; lockedMinor: number };

function moneyMinor(minor: number, currency = "USD", scale = 2) {
  const code = String(currency || "USD").toUpperCase();
  const digits = Math.min(8, Math.max(0, Number(scale) || 0));
  const value = Number(minor || 0) / Math.pow(10, digits);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits }).format(value);
  } catch {
    return `${code} ${value.toLocaleString(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits })}`;
  }
}

const fmtMinor = (minor: number | null | undefined, currency = "USD") => moneyMinor(Number(minor || 0), currency, 2);

function fmtPercent(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "—";
  return `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`;
}

function fmtMultiple(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "—";
  return `${(Number(bps) / 10_000).toFixed(2)}x`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return "No deadline published";
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} remaining`;
  if (days === 0) return "Closes today";
  return `Closed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
}

function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const riskClass = (grade: IpRoyaltyRiskGrade) => `ipr-badge ipr-badge--risk-${grade.toLowerCase()}`;
const statusClass = (status: string) => `ipr-badge ipr-badge--status-${String(status).toLowerCase()}`;

function SlotBar({ bps }: { bps: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(bps) || 0) / 100)));
  return <div className="ipr-progress-bar"><i style={{ width: `${pct}%` }} /></div>;
}

function rateDescription(right: IpRight) {
  if (right.royaltyBasis === "PER_UNIT" && right.perUnitMinor) return `${fmtMinor(right.perUnitMinor)} per unit`;
  if (right.royaltyRateBps !== null && right.royaltyRateBps !== undefined) return `${fmtPercent(right.royaltyRateBps)} ${right.royaltyBasis === "REVENUE_SHARE" ? "revenue share" : "of net sales"}`;
  return basisLabel(right.royaltyBasis);
}

function loadWatchlist(): string[] {
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch { return []; }
}

type PurchaseTarget = { type: "RIGHT" | "PORTFOLIO"; id: string; name: string; expectedMultipleBps: number | null };

/**
 * Customer desk for administrator-published IP-royalty opportunities. Public IP
 * registers publish ownership, not royalty economics, so a right only becomes
 * fundable when an administrator publishes sourced economics for it (the
 * DISCOVERY layer is cited but never synthesised). Commitments settle in USD and
 * may be funded from the settlement wallet, any single wallet, or all wallets
 * combined through live FX — the same internal-ledger cross-wallet engine as the
 * rest of the platform. Principal is held; royalties are credited pro-rata as
 * distributions are recorded and the principal is returned at completion.
 */
export function CustomerIPRoyalties({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.ipRoyalties.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"rights" | "portfolios" | "portfolio" | "timeline" | "analytics">("rights");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ALL");
  const [sector, setSector] = useState<"ALL" | IpRoyaltySector>("ALL");
  const [rightType, setRightType] = useState("ALL");
  const [basis, setBasis] = useState("ALL");
  const [cadence, setCadence] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [riskGrade, setRiskGrade] = useState("ALL");
  const [fundableOnly, setFundableOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sort, setSort] = useState("fundable");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [target, setTarget] = useState<PurchaseTarget | null>(null);
  const [fundingSource, setFundingSource] = useState("COMBINED");
  const [amount, setAmount] = useState(0);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteSeq = useRef(0);

  const purchase = trpc.customer.ipRoyalties.purchase.useMutation({
    onSuccess: (result: any) => {
      setTarget(null);
      setAmount(0);
      setTab("portfolio");
      void utils.customer.ipRoyalties.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.ipRoyalties.market.refetch();
      push(`+ IP Royalties commitment recorded · ${result.instrumentName} (${result.positionCode})`);
    },
    onError: (error: { message: string }) => setMessage(error.message),
  });

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);

  const rights = useMemo(() => (market.data?.rights || []) as IpRight[], [market.data]);
  const portfolios = useMemo(() => (market.data?.portfolios || []) as IpRoyaltyPortfolio[], [market.data]);
  const positions: any[] = (market.data?.positions || []) as any[];
  const wallets: WalletBalance[] = (market.data?.wallets || market.data?.balances || []) as WalletBalance[];
  const fundedWallets = wallets.filter((wallet) => Number(wallet.availableMinor || 0) > 0);
  const settlement = String(market.data?.settlementCurrency || "USD");
  const settlementWallet = wallets.find((wallet) => wallet.currency === settlement);
  const available = Number(settlementWallet?.availableMinor ?? market.data?.availableMinor ?? 0);
  const summary = market.data?.summary || {
    committedMinor: 0, activePositions: 0, completedPositions: 0, writtenOffPositions: 0,
    fundableRights: 0, modelledRights: 0, portfolios: 0, distributedMinor: 0, realisedMinor: 0, expectedAnnualDistributionMinor: 0,
  };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  // The discovery layer cites public IP registers but publishes no royalty
  // economics, so it contributes no fundable rights. When the account service is
  // unreachable we still surface those cited sources directly from the shared
  // module so the desk explains itself; nothing is ever fabricated.
  const [fallbackSources, setFallbackSources] = useState<IpRoyaltiesSource[] | null>(null);
  useEffect(() => {
    if (market.isLoading || market.isFetching || market.data) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getIpRoyaltiesCatalogue();
        if (!cancelled) setFallbackSources(catalogue.sources);
      } catch { /* leave null; the error notice already explains the state */ }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, market.data]);

  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    rights.forEach((item) => map.set(item.countryCode, item.country));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rights]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = rights.filter((item) => {
      if (country !== "ALL" && item.countryCode !== country) return false;
      if (sector !== "ALL" && sectorForRightType(item.rightType) !== sector) return false;
      if (rightType !== "ALL" && item.rightType !== rightType) return false;
      if (basis !== "ALL" && item.royaltyBasis !== basis) return false;
      if (cadence !== "ALL" && item.cadence !== cadence) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (riskGrade !== "ALL" && item.riskGrade !== riskGrade) return false;
      if (fundableOnly && !item.fundable) return false;
      if (watchlistOnly && !watchlist.includes(item.id)) return false;
      if (normalized && !`${item.rightName} ${item.licensor} ${item.licenseeSummary ?? ""} ${item.country} ${item.jurisdiction} ${item.assetClass ?? ""} ${rightTypeLabel(item.rightType)} ${item.problem}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "fundable") return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0) || b.fundedBps - a.fundedBps || a.rightName.localeCompare(b.rightName);
      if (sort === "name") return a.rightName.localeCompare(b.rightName);
      if (sort === "deadline") return (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999);
      if (sort === "ask") return (b.fundingAskMinor || 0) - (a.fundingAskMinor || 0);
      if (sort === "multiple") return (b.expectedMultipleBps || 0) - (a.expectedMultipleBps || 0);
      if (sort === "distribution") return (b.expectedAnnualDistributionMinor || 0) - (a.expectedAnnualDistributionMinor || 0);
      if (sort === "type") return rightTypeLabel(a.rightType).localeCompare(rightTypeLabel(b.rightType)) || a.rightName.localeCompare(b.rightName);
      if (sort === "country") return a.country.localeCompare(b.country) || a.rightName.localeCompare(b.rightName);
      return 0;
    });
    return sorted;
  }, [rights, query, country, sector, rightType, basis, cadence, status, riskGrade, fundableOnly, watchlistOnly, watchlist, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, country, sector, rightType, basis, cadence, status, riskGrade, fundableOnly, watchlistOnly, pageSize, tab]);

  const modelledRights = rights.filter((item) => item.fundable);
  const compareRights = rights.filter((item) => compareIds.includes(item.id));
  const activeFilters = [country !== "ALL", sector !== "ALL", rightType !== "ALL", basis !== "ALL", cadence !== "ALL", status !== "ALL", riskGrade !== "ALL", fundableOnly, watchlistOnly].filter(Boolean).length;
  const analytics = useMemo(() => buildIpRoyaltyAnalytics(rights), [rights]);
  const maxTypeCount = Math.max(1, ...analytics.byType.map((bucket) => bucket.count));

  const toggleWatch = (id: string) => setWatchlist((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= 3 ? current : [...current, id]);
  const clearFilters = () => { setCountry("ALL"); setSector("ALL"); setRightType("ALL"); setBasis("ALL"); setCadence("ALL"); setStatus("ALL"); setRiskGrade("ALL"); setFundableOnly(false); setWatchlistOnly(false); setQuery(""); };

  const openPurchase = (nextTarget: PurchaseTarget, suggested: number) => {
    setTarget(nextTarget);
    setMessage("");
    setFundingSource("COMBINED");
    setAmount(Math.max(suggested, Math.max(available, 100_000)));
  };

  // Refresh the funding quote (conversion + affordability) as the amount or
  // funding wallet changes. Debounced so typing does not hammer the FX provider.
  useEffect(() => {
    if (!target || amount <= 0) { setQuote(null); return; }
    const seq = ++quoteSeq.current;
    setQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await utils.customer.ipRoyalties.fundingQuote.fetch({ amountMinor: Math.round(amount), fundingSource });
        if (seq === quoteSeq.current) setQuote(result);
      } catch {
        if (seq === quoteSeq.current) setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoteLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [target, amount, fundingSource, utils]);

  const submitPurchase = () => {
    if (!target) return;
    if (amount <= 0) { setMessage("Enter an investment amount above zero."); return; }
    if (quote && !quote.sufficient) { setMessage(quote.message || "Insufficient combined spendable wallet balance."); return; }
    purchase.mutate({ instrumentType: target.type, instrumentId: target.id, amountMinor: Math.round(amount), fundingSource, idempotencyKey: crypto.randomUUID() });
  };

  const exportCatalogue = () => downloadCsv(
    `ip-royalties-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Right", "Right type", "Licensor", "Licensees", "Asset class", "Jurisdiction", "Country code", "Royalty basis", "Royalty rate (bps)", "Per unit (minor)", "Cadence", "Term (months)", "Minimum guarantee (minor)", "Licensee count", "Top-licensee concentration (bps)", "On-time history (bps)", "Avg collection days", "Periods observed", "Risk grade", "Capital at risk (minor)", "Expected annual distribution (minor)", "Expected multiple (bps)", "Expected duration (months)", "Funding target (minor)", "Committed (minor)", "Funded bps", "Funding deadline", "Remaining days", "Status", "Scenarios", "Source", "Source URL", "As of"],
    filtered.map((item) => [
      item.rightName, rightTypeLabel(item.rightType), item.licensor, item.licenseeSummary ?? "", item.assetClass ?? "",
      item.jurisdiction, item.countryCode, basisLabel(item.royaltyBasis), item.royaltyRateBps ?? "", item.perUnitMinor ?? "",
      cadenceLabel(item.cadence), item.termMonths ?? "", item.minimumGuaranteeMinor ?? "", item.licenseeCount ?? "",
      item.topLicenseeConcentrationBps ?? "", item.paymentHistory?.onTimeBps ?? "", item.paymentHistory?.averageCollectionDays ?? "",
      item.paymentHistory?.periodsObserved ?? "", item.riskGrade ? riskGradeLabel(item.riskGrade) : "", item.capitalAtRiskMinor ?? "",
      item.expectedAnnualDistributionMinor ?? "", item.expectedMultipleBps ?? "", item.expectedDurationMonths ?? "",
      item.fundingAskMinor ?? "", item.committedMinor, item.fundedBps, item.fundingDeadline ?? "", item.remainingDays ?? "",
      statusLabel(item.status),
      item.fundable ? item.scenarios.map((scenario) => `${scenario.label}:${fmtPercent(scenario.probabilityBps)}/${fmtMultiple(scenario.funderMultipleBps)}`).join(" ") : "Not modelled",
      item.source, item.sourceUrl ?? "", item.asOf,
    ]),
  );

  const exportPositions = () => downloadCsv(
    `ip-royalties-portfolio-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Position", "Instrument", "Type", "Right type", "Amount (minor)", "Currency", "Funding", "Status at buy", "Expected multiple (bps)", "Outcome", "Distributed (minor)", "Realised (minor)", "Opened", "Status"],
    positions.map((position) => [
      position.positionCode, position.instrumentName, position.instrumentType, position.rightType || "",
      position.amountMinor, position.currency, position.fundingSource || "", position.statusAtPurchase || "",
      position.expectedMultipleBps ?? "", position.outcome || "", position.distributedMinor ?? "", position.realisedMinor ?? "",
      formatDate(position.openedAt), position.positionStatus,
    ]),
  );

  const sources: IpRoyaltiesSource[] = (market.data?.sources as IpRoyaltiesSource[]) || fallbackSources || [];
  const fetchedAt = market.data?.fetchedAt;
  const degraded = !!market.data?.degraded;

  const timeline = useMemo(() => rights.slice().sort((a, b) => (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999)), [rights]);

  return <div className="arb-page portal-page ipr-page">
    <section className="ipr-hero" aria-label="IP Royalties desk">
      <div className="ipr-hero-grid" aria-hidden="true" />
      <div className="ipr-hero-top">
        <div className="ipr-hero-badge"><Layers3 size={15}/> IP Royalties · Licensing capital</div>
        <div className="cd-hero-sources">
          <span className={`cd-source-chip${degraded ? " is-degraded" : ""}`}>{degraded ? "Some register sources degraded" : "Live administrator economics"}</span>
          <button type="button" className="cd-refresh" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh the desk"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>
      <h1 className="ipr-hero-title">Fund licensed intellectual property — paid as royalties are collected.</h1>
      <p className="ipr-hero-sub">Every opportunity on this desk is an administrator-reviewed IP right (or a portfolio of rights) with its royalty economics sourced and dated — the licensor, the royalty basis and rate, the collection cadence, the term and the modelled distribution scenarios. Public IP registers publish ownership but never royalty rates, so nothing here is invented: a right only appears once its economics are published. Your commitment settles in USD, is drawn from any wallet you hold or from all wallets combined at the live rate, and the principal is held while royalties are collected. Recorded distributions are credited pro-rata to your wallet; at completion the principal is returned against the administrator-configured multiple, or written off.</p>
      <div className="ipr-hero-stats">
        <div className="ipr-stat"><span>Rights published</span><strong>{rights.length}</strong></div>
        <div className="ipr-stat"><span>With modelled economics</span><strong>{modelledRights.length}</strong></div>
        <div className="ipr-stat"><span>Your committed</span><strong>{fmtMinor(summary.committedMinor)}</strong></div>
        <div className="ipr-stat"><span>Distributions credited</span><strong>{fmtMinor(summary.distributedMinor)}</strong></div>
      </div>
      {sources.length > 0 && <div className="ipr-source-list">
        {sources.map((source) => <span className={`ipr-source-chip is-${source.status}`} key={source.name} title={source.detail || source.url}>
          {source.status === "ok" ? <Check size={11}/> : <AlertTriangle size={11}/>} {source.name}
        </span>)}
      </div>}
    </section>

    {market.isError && <div className="ipr-notice is-error" role="alert">
      <AlertTriangle size={16}/>
      <div><strong>The desk could not reach the account service.</strong> {market.error?.message || "Administrator-published royalties could not be loaded."} Retry to reconnect.</div>
      <button type="button" className="ipr-btn ipr-btn-sm" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {storeWarning && <div className="ipr-notice" role="status"><AlertTriangle size={16}/><div>{storeWarning}</div></div>}
    {message && !target && <div className="ipr-notice is-error" role="alert"><AlertTriangle size={16}/><div>{message}</div></div>}

    <nav className="ipr-tabs" aria-label="IP Royalties sections">
      <button type="button" className={`ipr-tab${tab === "rights" ? " is-active" : ""}`} onClick={() => setTab("rights")}>Rights open for funding <span className="ipr-tab-count">{rights.length}</span></button>
      <button type="button" className={`ipr-tab${tab === "portfolios" ? " is-active" : ""}`} onClick={() => setTab("portfolios")}>Portfolios <span className="ipr-tab-count">{portfolios.length}</span></button>
      <button type="button" className={`ipr-tab${tab === "portfolio" ? " is-active" : ""}`} onClick={() => setTab("portfolio")}>My positions <span className="ipr-tab-count">{positions.length}</span></button>
      <button type="button" className={`ipr-tab${tab === "timeline" ? " is-active" : ""}`} onClick={() => setTab("timeline")}>Distribution timeline <span className="ipr-tab-count">{timeline.length}</span></button>
      <button type="button" className={`ipr-tab${tab === "analytics" ? " is-active" : ""}`} onClick={() => setTab("analytics")}>Royalty analytics</button>
    </nav>

    {tab === "rights" && <section className="ipr-section" aria-label="IP rights catalogue">
      <nav className="ipr-tabs" aria-label="IP royalty sectors">
        <button type="button" className={`ipr-tab${sector === "ALL" ? " is-active" : ""}`} onClick={() => setSector("ALL")}>All sectors <span className="ipr-tab-count">{rights.length}</span></button>
        {IP_ROYALTY_SECTORS.map((value) => <button type="button" key={value} className={`ipr-tab${sector === value ? " is-active" : ""}`} onClick={() => setSector(value)}>
          {sectorLabel(value)} <span className="ipr-tab-count">{rights.filter((item) => sectorForRightType(item.rightType) === value).length}</span>
        </button>)}
      </nav>
      <p className="ipr-card-meta">Sectors: <strong>{sectorLabel("REGISTERED_IP")}</strong> — {SECTOR_RIGHT_TYPES.REGISTERED_IP.map(rightTypeLabel).join(", ")}; <strong>{sectorLabel("CREATIVE_MEDIA")}</strong> — {SECTOR_RIGHT_TYPES.CREATIVE_MEDIA.map(rightTypeLabel).join(", ")}; <strong>{sectorLabel("BUSINESS_TECH")}</strong> — {SECTOR_RIGHT_TYPES.BUSINESS_TECH.map(rightTypeLabel).join(", ")}.</p>

      <div className="ipr-toolbar">
        <div className="ipr-filters">
          <div className="ipr-filter"><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Right, licensor or asset" /></div>
          <div className="ipr-filter"><label>Country</label><select value={country} onChange={(e) => setCountry(e.target.value)}><option value="ALL">All countries</option>{countryOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
          <div className="ipr-filter"><label>Right type</label><select value={rightType} onChange={(e) => setRightType(e.target.value)}><option value="ALL">All right types</option>{IP_RIGHT_TYPES.map((value) => <option key={value} value={value}>{rightTypeLabel(value)}</option>)}</select></div>
          <div className="ipr-filter"><label>Royalty basis</label><select value={basis} onChange={(e) => setBasis(e.target.value)}><option value="ALL">All bases</option>{IP_ROYALTY_BASES.map((value) => <option key={value} value={value}>{basisLabel(value)}</option>)}</select></div>
          <div className="ipr-filter"><label>Cadence</label><select value={cadence} onChange={(e) => setCadence(e.target.value)}><option value="ALL">All cadences</option>{IP_ROYALTY_CADENCES.map((value) => <option key={value} value={value}>{cadenceLabel(value)}</option>)}</select></div>
          <div className="ipr-filter"><label>Risk grade</label><select value={riskGrade} onChange={(e) => setRiskGrade(e.target.value)}><option value="ALL">All grades</option>{IP_ROYALTY_RISK_GRADES.map((value) => <option key={value} value={value}>{riskGradeLabel(value)}</option>)}</select></div>
          <div className="ipr-filter"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option>{IP_ROYALTY_DOSSIER_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>
          <div className="ipr-filter"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fundable">Open for funding first</option><option value="deadline">Closing soonest</option><option value="ask">Largest funding target</option><option value="multiple">Highest expected multiple</option><option value="distribution">Largest expected distribution</option><option value="name">Right A–Z</option><option value="type">Right type A–Z</option><option value="country">Country A–Z</option></select></div>
        </div>
        <div className="ipr-toolbar-actions">
          <label className="ipr-checkbox"><input type="checkbox" checked={fundableOnly} onChange={(e) => setFundableOnly(e.target.checked)} /> Modelled economics only</label>
          <label className="ipr-checkbox"><input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)} /> Watchlist ({watchlist.length})</label>
          {activeFilters > 0 && <button type="button" className="ipr-btn ipr-btn-sm ghost" onClick={clearFilters}><X size={13}/> Clear {activeFilters}</button>}
          <button type="button" className="ipr-btn ipr-btn-sm" onClick={exportCatalogue} disabled={!filtered.length}><Download size={13}/> Export CSV</button>
          {compareIds.length > 0 && <button type="button" className="ipr-btn ipr-btn-sm" onClick={() => setCompareOpen(true)}><Layers size={13}/> Compare {compareIds.length}</button>}
        </div>
      </div>

      <div className="ipr-section-head"><span className="eyebrow">{filtered.length} of {rights.length} rights · page {currentPage} of {pageCount}</span></div>

      {market.isLoading && !rights.length && <div className="ipr-grid">{Array.from({ length: 6 }).map((_, index) => <div className="ipr-card" key={index}><div className="ipr-spinner" /> Loading published economics…</div>)}</div>}
      {!market.isLoading && !rights.length && <div className="ipr-empty"><CircleHelp size={16}/> No IP rights are published for funding right now. Public IP registers do not publish royalty economics, so a right appears here only once an administrator publishes its sourced royalty terms. Check back soon.</div>}
      {rights.length > 0 && !filtered.length && <div className="ipr-empty"><CircleHelp size={16}/> No rights match the current filters. Clear the search or widen the filters.</div>}

      <div className="ipr-grid">
        {pageRows.map((item) => {
          const watched = watchlist.includes(item.id);
          const comparing = compareIds.includes(item.id);
          return <article className={`ipr-card${item.fundable ? " is-fundable" : ""}`} key={item.id}>
            <div className="ipr-card-head">
              <div>
                <div className="ipr-card-title">{item.flag} {item.rightName}</div>
                <div className="ipr-card-meta"><span>{item.licensor}</span>{item.licenseeSummary && <span>· {item.licenseeSummary}</span>}</div>
                <div className="ipr-card-meta"><span>{item.jurisdiction}</span>{item.assetClass && <span>· {item.assetClass}</span>}</div>
              </div>
              <div className="ipr-card-actions">
                <button type="button" className={`ipr-star${watched ? " is-on" : ""}`} onClick={() => toggleWatch(item.id)} aria-pressed={watched} title={watched ? "Remove from watchlist" : "Add to watchlist"}><Star size={15}/></button>
                <button type="button" className={`ipr-star${comparing ? " is-on" : ""}`} onClick={() => toggleCompare(item.id)} aria-pressed={comparing} title={comparing ? "Remove from compare" : "Add to compare (max 3)"}><Layers size={15}/></button>
              </div>
            </div>

            <div className="ipr-badges">
              <span className="ipr-badge ipr-badge--sector">{sectorLabel(sectorForRightType(item.rightType))}</span>
              <span className="ipr-badge ipr-badge--type">{rightTypeLabel(item.rightType)}</span>
              <span className="ipr-badge ipr-badge--basis">{basisLabel(item.royaltyBasis)}</span>
              <span className="ipr-badge ipr-badge--cadence">{cadenceLabel(item.cadence)}</span>
              {item.riskGrade && <span className={riskClass(item.riskGrade)}>{riskGradeLabel(item.riskGrade)}</span>}
              <span className={statusClass(item.status)}>{statusLabel(item.status)}</span>
            </div>

            <div className="ipr-card-meta">
              <span>Rate {rateDescription(item)}</span>
              {item.termMonths ? <span>Term {item.termMonths}mo</span> : null}
              {item.minimumGuaranteeMinor ? <span>Min guarantee {fmtMinor(item.minimumGuaranteeMinor)}</span> : null}
            </div>

            <div className="ipr-card-meta">
              {item.licenseeCount ? <span>{item.licenseeCount} licensee{item.licenseeCount === 1 ? "" : "s"}</span> : null}
              {item.topLicenseeConcentrationBps !== null && item.topLicenseeConcentrationBps !== undefined ? <span>Top licensee {fmtPercent(item.topLicenseeConcentrationBps)}</span> : null}
              <span>Expected {fmtMultiple(item.expectedMultipleBps)}{item.expectedDurationMonths ? ` · ${item.expectedDurationMonths}mo` : ""}</span>
            </div>

            {item.paymentHistory && <div className="ipr-history">
              <span className="eyebrow">Payment history</span>
              <span className="ipr-history-chip"><BadgeCheck size={11}/> {fmtPercent(item.paymentHistory.onTimeBps)} on time</span>
              <span className="ipr-history-chip">{item.paymentHistory.averageCollectionDays}d avg collection</span>
              <span className="ipr-history-chip">{item.paymentHistory.periodsObserved} periods observed</span>
            </div>}

            {item.fundable ? <>
              <div className="ipr-progress">
                <div className="ipr-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
                <SlotBar bps={item.fundedBps} />
              </div>
              <div className="ipr-countdown"><CalendarClock size={12}/> {daysLabel(item.remainingDays)}{item.fundingDeadline ? ` · closes ${formatDate(item.fundingDeadline)}` : ""}</div>
              {item.scenarios.length > 0 && <div className="ipr-scenarios">
                {item.scenarios.map((scenario, index) => <div className={`ipr-scenario ipr-scenario--${scenario.label.toLowerCase().replace(/[^a-z]+/g, "-")}`} key={`${scenario.label}-${index}`}>
                  <span className="ipr-scenario-head">{scenario.label}</span>
                  <span>{fmtPercent(scenario.probabilityBps)} · {fmtMinor(scenario.expectedAnnualDistributionMinor)}/yr · {scenario.durationMonths}mo · {fmtMultiple(scenario.funderMultipleBps)}</span>
                </div>)}
              </div>}
              <div className="ipr-evalue"><TrendingUp size={12}/> Expected annual distribution <strong>{fmtMinor(item.expectedAnnualDistributionMinor ?? 0)}</strong> · stress cases are shown in full</div>
            </> : <div className="ipr-unfundable"><AlertTriangle size={13}/> Economics not yet published — this right is cited but not fundable. A right becomes fundable only once an administrator publishes its sourced royalty terms, target and scenarios.</div>}

            <p className="ipr-card-meta">{item.problem}</p>
            {item.highlights.length > 0 && <div className="ipr-badges">{item.highlights.slice(0, 4).map((value) => <span className="ipr-badge" key={value}>{value}</span>)}</div>}

            <div className="ipr-card-actions" style={{ justifyContent: "space-between" }}>
              <span className="ipr-card-meta" title={item.sourceUrl || item.source}><ShieldCheck size={11}/> {item.asOf} · {item.source}</span>
              {item.fundable
                ? <button className="ipr-btn primary" onClick={() => openPurchase({ type: "RIGHT", id: item.id, name: item.rightName, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.fundingAskMinor || 0, 100_000))}>Fund this right <ChevronRight size={14}/></button>
                : <button className="ipr-btn" disabled>Not open for funding</button>}
            </div>
          </article>;
        })}
      </div>

      {filtered.length > 0 && <div className="ipr-pagination">
        <button type="button" className="ipr-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14}/> Previous</button>
        <span className="eyebrow">Page {currentPage} of {pageCount}</span>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / page</option>)}</select>
        <button type="button" className="ipr-page-btn" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight size={14}/></button>
      </div>}
    </section>}

    {tab === "portfolios" && <section className="ipr-section" aria-label="Right portfolios">
      <div className="ipr-section-head">
        <div><span className="eyebrow">Right portfolios</span><h2>Pooled IP rights</h2><p>A portfolio is a pro-rata share of a set of IP rights. You are paid your share of the portfolio’s recorded distributions, allocated per right by the administrator’s configured weights. Pooling spreads the royalty stream across several rights; it does not guarantee a return.</p></div>
      </div>
      {!portfolios.length && <div className="ipr-empty"><Layers3 size={16}/> No portfolios are published right now.</div>}
      <div className="ipr-grid">
        {portfolios.map((portfolio) => <article className="ipr-card is-fundable" key={portfolio.id}>
          <div className="ipr-card-head">
            <div>
              <div className="ipr-card-title">{portfolio.name}</div>
              <div className="ipr-card-meta"><span>{portfolio.jurisdiction} · {rightTypeLabel(portfolio.rightType)}</span></div>
            </div>
            <span className={riskClass(portfolio.riskGrade)}>{riskGradeLabel(portfolio.riskGrade)}</span>
          </div>
          <p className="ipr-card-meta">{portfolio.summary}</p>
          <div className="ipr-card-meta">
            <span>Target {fmtMinor(portfolio.targetMinor)}</span>
            <span>Unit {fmtMinor(portfolio.unitPriceMinor)} × {portfolio.unitCount.toLocaleString()}</span>
            <span>Expected {fmtMultiple(portfolio.expectedMultipleBps)}{portfolio.expectedDurationMonths ? ` · ${portfolio.expectedDurationMonths}mo` : ""}</span>
          </div>
          {portfolio.expectedAnnualDistributionMinor !== null && portfolio.expectedAnnualDistributionMinor !== undefined && <div className="ipr-card-meta"><span>Expected distribution {fmtMinor(portfolio.expectedAnnualDistributionMinor)}/yr</span></div>}
          <div className="ipr-progress">
            <div className="ipr-progress-label"><span>Portfolio funding</span><span>{fmtPercent(portfolio.fundedBps)} of {fmtMinor(portfolio.targetMinor)}</span></div>
            <SlotBar bps={portfolio.fundedBps} />
          </div>
          <div className="ipr-alloc">
            <span>Planned allocation ({portfolio.rightIds.length} right{portfolio.rightIds.length === 1 ? "" : "s"}):</span>
            {portfolio.rightIds.map((rightId) => <span className="ipr-badge" key={rightId}>{rightId} · {fmtPercent(portfolio.allocationBpsByRight[rightId] || 0)}</span>)}
          </div>
          <div className="ipr-card-actions" style={{ justifyContent: "space-between" }}>
            <span className="ipr-card-meta"><ShieldCheck size={11}/> {portfolio.asOf} · {portfolio.source}</span>
            <button className="ipr-btn primary" onClick={() => openPurchase({ type: "PORTFOLIO", id: portfolio.id, name: portfolio.name, expectedMultipleBps: portfolio.expectedMultipleBps }, Math.max(portfolio.unitPriceMinor, 100_000))}>Fund this portfolio <ChevronRight size={14}/></button>
          </div>
        </article>)}
      </div>
    </section>}

    {tab === "portfolio" && <section className="ipr-section" aria-label="Your IP royalties portfolio">
      <div className="ipr-section-head">
        <div><span className="eyebrow">Your positions</span><h2>Commitments & distributions</h2></div>
        <div className="ipr-toolbar-actions">
          <span className="ipr-badge"><Globe2 size={12}/> Settled in {settlement} · {fmtMinor(available)} available</span>
          <button type="button" className="ipr-btn ipr-btn-sm" onClick={exportPositions} disabled={!positions.length}><Download size={13}/> Export CSV</button>
        </div>
      </div>
      <div className="ipr-hero-stats">
        <div className="ipr-stat"><strong>{fmtMinor(summary.committedMinor)}</strong><span>Committed (held)</span></div>
        <div className="ipr-stat"><strong>{summary.activePositions}</strong><span>Active positions</span></div>
        <div className="ipr-stat"><strong>{fmtMinor(summary.distributedMinor)}</strong><span>Distributions credited</span></div>
        <div className="ipr-stat"><strong>{summary.completedPositions}</strong><span>Completed</span></div>
        <div className="ipr-stat"><strong>{summary.writtenOffPositions}</strong><span>Written off</span></div>
      </div>
      {!positions.length && <div className="ipr-empty"><Layers3 size={16}/> No commitments yet. Fund a right or a portfolio to open a position — the administrator follows up on due diligence.</div>}
      {positions.length > 0 && <div style={{ overflowX: "auto" }}>
        <table className="ipr-table">
          <thead><tr><th>Position</th><th>Instrument</th><th>Type</th><th>Right type</th><th>Amount</th><th>Funding</th><th>Expected</th><th>Distributed</th><th>Outcome</th><th>Realised</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((position: any) => <tr key={position.id}>
              <td className="ipr-mono">{position.positionCode}</td>
              <td>{position.instrumentName}</td>
              <td>{position.instrumentType === "RIGHT" ? "Right share" : "Portfolio"}</td>
              <td>{position.rightType ? rightTypeLabel(position.rightType) : "—"}</td>
              <td>{fmtMinor(Number(position.amountMinor))}</td>
              <td>{position.fundingSource === "COMBINED" ? "Combined" : position.fundingSource || position.currency}</td>
              <td>{fmtMultiple(position.expectedMultipleBps)}</td>
              <td>{fmtMinor(Number(position.distributedMinor || 0))}</td>
              <td>{position.outcome ? outcomeLabel(position.outcome) : "—"}</td>
              <td>{position.realisedMinor !== null && position.realisedMinor !== undefined ? fmtMinor(Number(position.realisedMinor)) : "—"}</td>
              <td>{formatDate(position.openedAt)}</td>
              <td><span className="ipr-badge">{position.positionStatus}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>}

    {tab === "timeline" && <section className="ipr-section" aria-label="Distribution timeline">
      <div className="ipr-section-head"><div><span className="eyebrow">Distribution timeline</span><h2>Funding deadlines & collection cadence</h2><p>Royalties are collected on the licence cadence and credited pro-rata as each distribution is recorded. Funding closes on the published deadline; a deadline is never moved once committed.</p></div></div>
      {!timeline.length && <div className="ipr-empty"><CalendarClock size={16}/> No published rights yet. The timeline fills as administrators publish sourced royalty economics.</div>}
      <div className="ipr-admin-list">
        {timeline.map((item) => <div className="ipr-admin-row" key={item.id}>
          <div className="ipr-admin-row-head">
            <strong>{item.flag} {item.rightName}</strong>
            <span className="ipr-badge ipr-badge--cadence">{cadenceLabel(item.cadence)}</span>
          </div>
          <div className="ipr-card-meta">
            <span>{statusLabel(item.status)}</span>
            {item.fundingAskMinor ? <span>Target {fmtMinor(item.fundingAskMinor)} · {fmtPercent(item.fundedBps)} funded</span> : null}
            {item.remainingDays !== null && <span>{daysLabel(item.remainingDays)}</span>}
          </div>
        </div>)}
      </div>
    </section>}

    {tab === "analytics" && <section className="ipr-section" aria-label="Royalty analytics">
      <div className="ipr-section-head"><div><span className="eyebrow">Royalty analytics</span><h2>What is on the desk</h2><p>Desk-level aggregates computed only from the administrator-published rights above — how the published opportunity set splits by right type and jurisdiction, and its average funding progress and expected multiple. No figure is inferred beyond the records themselves.</p></div></div>
      {!rights.length ? <div className="ipr-empty"><CircleHelp size={16}/> No rights published yet — analytics appear once administrator economics arrive.</div> : <div className="ipr-analytics">
        <div className="ipr-analytics-card">
          <div className="ipr-analytics-split">
            <div className="ipr-analytics-stat"><b>{analytics.total}</b><span>Rights on the desk</span></div>
            <div className="ipr-analytics-stat"><b>{analytics.fundable}</b><span>Fundable now</span></div>
            <div className="ipr-analytics-stat"><b>{fmtPercent(analytics.averageFundedBps)}</b><span>Average funded</span></div>
            <div className="ipr-analytics-stat"><b>{fmtMultiple(analytics.averageExpectedMultipleBps)}</b><span>Avg expected multiple</span></div>
          </div>
        </div>

        <div className="ipr-analytics-grid">
          <div className="ipr-analytics-card">
            <h3>By sector</h3>
            {analytics.bySector.map((bucket) => <div className="ipr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ipr-bar-track"><div className="ipr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.bySector[0].count))}%` }} /></div>
              <b className="ipr-mono">{bucket.count}</b>
            </div>)}
          </div>

          <div className="ipr-analytics-card">
            <h3>By right type</h3>
            {analytics.byType.map((bucket) => <div className="ipr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ipr-bar-track"><div className="ipr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / maxTypeCount)}%` }} /></div>
              <b className="ipr-mono">{bucket.count}</b>
            </div>)}
          </div>

          <div className="ipr-analytics-card">
            <h3>By jurisdiction</h3>
            {!analytics.byJurisdiction.length && <p className="ipr-card-meta">No jurisdictions published.</p>}
            {analytics.byJurisdiction.map((bucket) => <div className="ipr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ipr-bar-track"><div className="ipr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byJurisdiction[0].count))}%` }} /></div>
              <b className="ipr-mono">{bucket.count}</b>
            </div>)}
          </div>
        </div>
      </div>}
    </section>}

    <div id="ipr-education" className="ipr-notice">
      <ShieldCheck size={16}/>
      <div>
        <strong>How the IP Royalties desk works.</strong> This desk spans three sectors — {sectorLabel("REGISTERED_IP")} (patents, trademarks and registered designs), {sectorLabel("CREATIVE_MEDIA")} (copyrights, film &amp; TV, characters and image rights) and {sectorLabel("BUSINESS_TECH")} (software, franchise and trade secrets). Music royalties, NFTs, agro investment, green energy and carbon credits have their own menus and are excluded here. Public registers (Crossref, Open Library, the Art Institute of Chicago, the iTunes catalogue, GitHub and — when keyed — PatentsView) publish ownership and catalogue identity but <em>never</em> the royalty rate or collection economics — so the <em>discovery</em> layer is cited, not synthesised, and contributes no fundable rights on its own. The <em>dossier</em> layer is an administrator’s reviewed economics for a right — licensor, royalty basis and rate, cadence, term, payment-history indicators and the modelled distribution scenarios — each figure traceable to a source URL and an as-of date. Only a published dossier is fundable. Your commitment settles in {settlement}, is drawn from any wallet you hold or from all wallets combined at the live rate, and the principal is held while royalties are collected. Recorded distributions are credited pro-rata to your wallet as internal-ledger entries; at completion the principal is returned against the administrator-configured multiple, or written off. Nothing here is a prediction, and no external transfer occurs on this desk.
      </div>
    </div>

    {compareOpen && compareRights.length > 0 && <div className="ipr-modal" onMouseDown={() => setCompareOpen(false)}>
      <div className="ipr-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ipr-modal-head"><strong>Compare {compareRights.length} rights</strong><button type="button" className="ipr-btn ipr-btn-sm ghost" onClick={() => setCompareOpen(false)}><X size={16}/></button></div>
        <div className="ipr-modal-body" style={{ overflowX: "auto" }}>
          <table className="ipr-table">
            <thead><tr><th>Field</th>{compareRights.map((item) => <th key={item.id}>{item.flag} {item.rightName}</th>)}</tr></thead>
            <tbody>
              <tr><td>Right type</td>{compareRights.map((item) => <td key={item.id}>{rightTypeLabel(item.rightType)}</td>)}</tr>
              <tr><td>Licensor</td>{compareRights.map((item) => <td key={item.id}>{item.licensor}</td>)}</tr>
              <tr><td>Licensees</td>{compareRights.map((item) => <td key={item.id}>{item.licenseeSummary || "—"}</td>)}</tr>
              <tr><td>Jurisdiction</td>{compareRights.map((item) => <td key={item.id}>{item.jurisdiction}</td>)}</tr>
              <tr><td>Royalty basis</td>{compareRights.map((item) => <td key={item.id}>{basisLabel(item.royaltyBasis)}</td>)}</tr>
              <tr><td>Rate</td>{compareRights.map((item) => <td key={item.id}>{rateDescription(item)}</td>)}</tr>
              <tr><td>Cadence</td>{compareRights.map((item) => <td key={item.id}>{cadenceLabel(item.cadence)}</td>)}</tr>
              <tr><td>Term</td>{compareRights.map((item) => <td key={item.id}>{item.termMonths ? `${item.termMonths} months` : "—"}</td>)}</tr>
              <tr><td>Minimum guarantee</td>{compareRights.map((item) => <td key={item.id}>{item.minimumGuaranteeMinor ? fmtMinor(item.minimumGuaranteeMinor) : "—"}</td>)}</tr>
              <tr><td>Licensee count</td>{compareRights.map((item) => <td key={item.id}>{item.licenseeCount ?? "—"}</td>)}</tr>
              <tr><td>Top-licensee concentration</td>{compareRights.map((item) => <td key={item.id}>{item.topLicenseeConcentrationBps !== null && item.topLicenseeConcentrationBps !== undefined ? fmtPercent(item.topLicenseeConcentrationBps) : "—"}</td>)}</tr>
              <tr><td>On-time history</td>{compareRights.map((item) => <td key={item.id}>{item.paymentHistory ? fmtPercent(item.paymentHistory.onTimeBps) : "—"}</td>)}</tr>
              <tr><td>Risk grade</td>{compareRights.map((item) => <td key={item.id}>{item.riskGrade ? riskGradeLabel(item.riskGrade) : "—"}</td>)}</tr>
              <tr><td>Capital at risk</td>{compareRights.map((item) => <td key={item.id}>{item.capitalAtRiskMinor ? fmtMinor(item.capitalAtRiskMinor) : "—"}</td>)}</tr>
              <tr><td>Expected annual distribution</td>{compareRights.map((item) => <td key={item.id}>{item.expectedAnnualDistributionMinor !== null && item.expectedAnnualDistributionMinor !== undefined ? fmtMinor(item.expectedAnnualDistributionMinor) : "—"}</td>)}</tr>
              <tr><td>Expected multiple</td>{compareRights.map((item) => <td key={item.id}>{fmtMultiple(item.expectedMultipleBps)}</td>)}</tr>
              <tr><td>Expected duration</td>{compareRights.map((item) => <td key={item.id}>{item.expectedDurationMonths ? `${item.expectedDurationMonths} months` : "—"}</td>)}</tr>
              <tr><td>Funding target</td>{compareRights.map((item) => <td key={item.id}>{item.fundingAskMinor ? fmtMinor(item.fundingAskMinor) : "—"}</td>)}</tr>
              <tr><td>Funded</td>{compareRights.map((item) => <td key={item.id}>{fmtPercent(item.fundedBps)}</td>)}</tr>
              <tr><td>Deadline</td>{compareRights.map((item) => <td key={item.id}>{item.fundingDeadline ? `${formatDate(item.fundingDeadline)} (${daysLabel(item.remainingDays)})` : "—"}</td>)}</tr>
              <tr><td>Status</td>{compareRights.map((item) => <td key={item.id}>{statusLabel(item.status)}</td>)}</tr>
              <tr><td>Fundable</td>{compareRights.map((item) => <td key={item.id}>{item.fundable ? "Yes — economics published" : "No — economics not published"}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="ipr-modal-foot"><button className="ipr-btn" onClick={() => setCompareOpen(false)}>Close</button></div>
      </div>
    </div>}

    {target && <div className="ipr-modal" onMouseDown={() => setTarget(null)}>
      <div className="ipr-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ipr-modal-head">
          <strong>{target.type === "RIGHT" ? "Fund right share" : "Fund portfolio"}</strong>
          <button type="button" className="ipr-btn ipr-btn-sm ghost" onClick={() => setTarget(null)}><X size={16}/></button>
        </div>
        <div className="ipr-modal-body">
          <div className="ipr-card-title">{target.name}</div>
          <div className="ipr-card-meta"><span>{target.type === "RIGHT" ? "Single-right share" : "Pro-rata portfolio share"}</span><span>Expected {fmtMultiple(target.expectedMultipleBps)}</span></div>

          <div className="ipr-field">
            <label>Investment amount ({settlement})</label>
            <input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))} />
            <small>You can pay from the {settlement} wallet, any single wallet, or all wallets combined.</small>
          </div>

          <div>
            <span className="eyebrow">Pay from</span>
            <div className="ipr-funding">
              <button type="button" className={`ipr-funding-option${fundingSource === "COMBINED" ? " is-selected" : ""}`} onClick={() => setFundingSource("COMBINED")}>
                <Layers3 size={14}/> <span><strong>Combined balance</strong><small>All wallets, converted at the live rate</small></span>
                {quote?.fundingSource === "COMBINED" && quote?.combinedAvailableMinor !== null && quote?.combinedAvailableMinor !== undefined && <b>{fmtMinor(quote.combinedAvailableMinor)}</b>}
              </button>
              {fundedWallets.map((wallet) => <button type="button" key={wallet.currency} className={`ipr-funding-option${fundingSource === wallet.currency ? " is-selected" : ""}`} onClick={() => setFundingSource(wallet.currency)}>
                <Globe2 size={14}/> <span><strong>{wallet.currency}</strong><small>{wallet.currencyName || "Wallet"}</small></span>
                <b>{moneyMinor(wallet.availableMinor, wallet.currency, wallet.scale)}</b>
              </button>)}
              {!fundedWallets.length && <p className="ipr-card-meta">No funded wallets detected yet.</p>}
            </div>
          </div>

          <div className="ipr-quote">
            {quoteLoading && <span>Checking funding at the live rate…</span>}
            {!quoteLoading && !quote && <span>Enter an amount to see how it will be funded.</span>}
            {!quoteLoading && quote?.sufficient && <>
              <strong><Check size={13}/> Funded by {quote.fundingSource === "COMBINED" ? "combined wallets" : quote.fundingSource}</strong>
              {quote.usdAvailableMinor > 0 && quote.convertedUsdMinor < quote.amountMinor && <div className="ipr-quote-row"><span>{settlement} wallet</span><span>{fmtMinor(Math.max(0, quote.amountMinor - quote.convertedUsdMinor))}</span></div>}
              {(quote.debits || []).map((debit: any) => <div className="ipr-quote-row" key={debit.currency}><span>{debit.currency} → {fmtMinor(debit.convertedUsdMinor)} @ {debit.rate} <em>{debit.rateProvider}</em></span><span>{moneyMinor(debit.amountMinor, debit.currency, wallets.find((wallet) => wallet.currency === debit.currency)?.scale ?? 2)}</span></div>)}
            </>}
            {!quoteLoading && quote && !quote.sufficient && <div>
              <strong><AlertTriangle size={13}/> Insufficient balance</strong>
              <span>{quote.message}{quote.combinedAvailableMinor !== null && quote.combinedAvailableMinor !== undefined ? ` Combined available: ${fmtMinor(quote.combinedAvailableMinor)}.` : ""}</span>
            </div>}
          </div>

          <div className="ipr-notice"><ShieldCheck size={15}/><div>Confirming debits your chosen wallet(s) through the existing internal ledger, holds the principal and creates a durable position. Duplicate requests are idempotent. Royalties are credited pro-rata as distributions are recorded; at completion the principal is returned against the configured multiple, or written off. No external transfer occurs on this desk.</div></div>
          {message && <div className="ipr-notice is-error" role="alert"><AlertTriangle size={15}/><div>{message}</div></div>}
        </div>
        <div className="ipr-modal-foot">
          <button className="ipr-btn" onClick={() => setTarget(null)}>Cancel</button>
          <button className="ipr-btn primary" disabled={purchase.isPending || quoteLoading || (quote ? !quote.sufficient : false)} onClick={submitPurchase}>{purchase.isPending ? "Recording commitment…" : "Confirm commitment"} <Check size={14}/></button>
        </div>
      </div>
    </div>}

    <div className="ipr-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ArrowUpRight size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{rights.length} rights · {portfolios.length} portfolios · {positions.length} positions</span>
      <span><Globe2 size={12}/> {sources.length} cited sources</span>
    </div>
  </div>;
}
