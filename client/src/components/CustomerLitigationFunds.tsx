import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, ArrowUpRight, CalendarClock, Check, ChevronLeft, ChevronRight, CircleHelp, Download,
  Gavel, Globe2, Layers, RefreshCw, Scale, ShieldCheck, Star, TrendingUp, Wallet, X,
} from "lucide-react";
import {
  getLitigationFundsCatalogue,
  stageLabel,
  buildLitigationAnalytics,
  LITIGATION_CASE_CLASSES,
  caseClassLabel,
  valueBandLabel,
  partyKindLabel,
  isInsolvency,
  type LitigationBundle,
  type LitigationCase,
  type LitigationMilestone,
  type LitigationRiskGrade,
  type LitigationScenario,
} from "@shared/litigation-funds-catalogue";
import "./litigation-funds.css";

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_KEY = "litigation-funds-watchlist";
const PAGE_SIZES = [6, 12, 24];

const STATUS_LABELS: Record<string, string> = {
  FUNDING: "Funding", ESCROW: "In escrow", ACTIVE: "Active",
  RESOLVED: "Resolved", WITHDRAWN: "Withdrawn",
};
const STATUS_ORDER = ["FUNDING", "ESCROW", "ACTIVE", "RESOLVED", "WITHDRAWN"];
const STAGE_OPTIONS = ["FILED", "DISCOVERY", "MEDIATION", "TRIAL", "JUDGMENT", "ENFORCEMENT", "DISTRIBUTION"];
const MERIT_OPTIONS = ["A", "B", "C", "D", "E"];
const RISK_LABELS: Record<LitigationRiskGrade, string> = {
  PRIME: "Prime", BALANCED: "Balanced", SPECULATIVE: "Speculative", HIGH_RISK: "High risk",
};
const OUTCOME_LABELS: Record<string, string> = { SETTLE: "Settle", WIN: "Win at trial", LOSE: "Lose" };

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

const fmtMinor = (minor: number, currency = "USD") => moneyMinor(minor, currency, 2);

function fmtPercent(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "—";
  return `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`;
}

function fmtMultiple(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "—";
  return `${(Number(bps) / 10_000).toFixed(2)}x`;
}

/** Default investable floor when a case or bundle publishes no explicit minimum (USD 1,000 in minor units). */
const MIN_INVESTMENT_MINOR = 100_000;
/** Profit implied by an amount at the expected multiple (integer basis points). */
const profitMinor = (amountMinor: number | null | undefined, multipleBps: number | null | undefined) =>
  multipleBps === null || multipleBps === undefined ? null : Math.round((Number(amountMinor || 0) * (Number(multipleBps) - 10_000)) / 10_000);
const fmtProfit = (amountMinor: number | null | undefined, multipleBps: number | null | undefined) => {
  const profit = profitMinor(amountMinor, multipleBps);
  return profit === null ? "—" : `${profit >= 0 ? "+" : ""}${fmtMinor(profit)}`;
};

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

function meritClass(grade: string | null) { return grade ? `lf-badge lf-badge--merit-${grade.toLowerCase()}` : "lf-badge"; }
function statusClass(status: string) { return `lf-badge lf-badge--status-${String(status).toLowerCase()}`; }
function riskClass(grade: LitigationRiskGrade) { return `lf-badge lf-badge--risk-${grade.toLowerCase()}`; }

function SlotBar({ bps }: { bps: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(bps) || 0) / 100)));
  return <div className="lf-progress-bar"><i style={{ width: `${pct}%` }} /></div>;
}

function ScenarioList({ scenarios }: { scenarios: LitigationScenario[] }) {
  if (!scenarios.length) return null;
  return <div className="lf-scenarios">
    {scenarios.map((scenario) => <div className={`lf-scenario lf-scenario--${scenario.outcome.toLowerCase()}`} key={scenario.outcome}>
      <span className="lf-scenario-head">{OUTCOME_LABELS[scenario.outcome] || scenario.outcome}</span>
      <span>{fmtPercent(scenario.probabilityBps)} · {fmtMinor(scenario.grossRecoveryMinor)} · {scenario.durationMonths}mo · {fmtMultiple(scenario.funderMultipleBps)}</span>
      <span className="lf-mono">{fmtPercent(scenario.probabilityBps)}</span>
    </div>)}
  </div>;
}

function MilestoneStrip({ milestones }: { milestones: LitigationMilestone[] }) {
  if (!milestones.length) return null;
  return <div className="lf-milestones">
    {milestones.map((milestone) => <span className={`lf-milestone${milestone.status === "REACHED" ? " is-reached" : ""}`} key={milestone.stage} title={`${fmtPercent(milestone.releaseBps)} of escrow releases at this milestone`}>
      {milestone.label}
    </span>)}
  </div>;
}

function loadWatchlist(): string[] {
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch { return []; }
}

type PurchaseTarget = { type: "CASE" | "BUNDLE"; id: string; name: string; expectedMultipleBps: number | null };

export function CustomerLitigationFunds({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.litigationFunds.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"cases" | "bundles" | "portfolio" | "timeline" | "analytics">("cases");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ALL");
  const [claimType, setClaimType] = useState("ALL");
  const [caseClass, setCaseClass] = useState("ALL");
  const [merit, setMerit] = useState("ALL");
  const [stage, setStage] = useState("ALL");
  const [status, setStatus] = useState("ALL");
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

  const purchase = trpc.customer.litigationFunds.purchase.useMutation({
    onSuccess: (result: any) => {
      setTarget(null);
      setAmount(0);
      setTab("portfolio");
      void utils.customer.litigationFunds.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.litigationFunds.market.refetch();
      push(`+ Litigation Funds commitment recorded · ${result.instrumentName} (${result.positionCode})`);
    },
    onError: (error: { message: string }) => setMessage(error.message),
  });

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);

  const serverCases = useMemo(() => (market.data?.cases || []) as LitigationCase[], [market.data]);
  const hasServerCases = serverCases.length > 0;

  // Resilience fallback: the discovery sources are CORS-enabled, so if the
  // account service cannot reach them the desk fetches the same verified
  // catalogue directly in the customer's browser. Administrator-published
  // dossiers are not present here; nothing is ever fabricated.
  const [fallback, setFallback] = useState<{ cases: LitigationCase[]; sources: any[]; fetchedAt: string; degraded: boolean } | null>(null);
  const [fallbackError, setFallbackError] = useState("");
  useEffect(() => {
    if (market.isLoading || market.isFetching || hasServerCases) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getLitigationFundsCatalogue();
        if (cancelled) return;
        if (catalogue.cases.length) {
          setFallback({ cases: catalogue.cases, sources: catalogue.sources, fetchedAt: catalogue.fetchedAt, degraded: catalogue.degraded });
          setFallbackError("");
        } else {
          setFallbackError("The public legal-record sources did not return any cases.");
        }
      } catch (error) {
        if (!cancelled) setFallbackError(error instanceof Error ? error.message : "Live legal-record data could not be loaded");
      }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, hasServerCases]);

  const usingFallback = !hasServerCases && !!fallback?.cases.length;
  const cases: LitigationCase[] = hasServerCases ? serverCases : (fallback?.cases || []);
  const contactingSources = !market.isLoading && !market.isError && !hasServerCases && !cases.length && !usingFallback && !fallbackError;
  const bundles: LitigationBundle[] = (market.data?.bundles || []) as LitigationBundle[];
  const positions: any[] = (market.data?.positions || []) as any[];
  const wallets: WalletBalance[] = (market.data?.wallets || market.data?.balances || []) as WalletBalance[];
  const fundedWallets = wallets.filter((wallet) => Number(wallet.availableMinor || 0) > 0);
  const settlement = String(market.data?.settlementCurrency || "USD");
  const settlementWallet = wallets.find((wallet) => wallet.currency === settlement);
  const available = Number(settlementWallet?.availableMinor ?? market.data?.availableMinor ?? 0);
  const summary = market.data?.summary || { committedMinor: 0, activePositions: 0, settledPositions: 0, writtenOffPositions: 0, fundableCases: 0, bundles: 0, realisedMinor: 0 };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    cases.forEach((item) => map.set(item.countryCode, item.country));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [cases]);
  const claimTypeOptions = useMemo(() => Array.from(new Set(cases.map((item) => item.claimType).filter(Boolean))).sort(), [cases]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = cases.filter((item) => {
      if (country !== "ALL" && item.countryCode !== country) return false;
      if (claimType !== "ALL" && item.claimType !== claimType) return false;
      if (caseClass !== "ALL" && item.caseClass !== caseClass) return false;
      if (merit !== "ALL" && item.meritGrade !== merit) return false;
      if (stage !== "ALL" && item.stage !== stage) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (fundableOnly && !item.fundable) return false;
      if (watchlistOnly && !watchlist.includes(item.id)) return false;
      if (normalized && !`${item.caseName} ${item.claimant} ${item.defendant} ${item.country} ${item.court} ${item.claimType} ${item.causeOfAction ?? ""} ${item.caseNumber ?? ""} ${item.problem}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "fundable") return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0) || b.fundedBps - a.fundedBps || a.caseName.localeCompare(b.caseName);
      if (sort === "name") return a.caseName.localeCompare(b.caseName);
      if (sort === "deadline") return (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999);
      if (sort === "damages") return (b.estimatedDamagesMinor || 0) - (a.estimatedDamagesMinor || 0);
      if (sort === "merit") return (a.meritGrade || "Z").localeCompare(b.meritGrade || "Z");
      if (sort === "country") return a.country.localeCompare(b.country) || a.caseName.localeCompare(b.caseName);
      if (sort === "filed") return (b.filedAt || "").localeCompare(a.filedAt || "");
      return 0;
    });
    return sorted;
  }, [cases, query, country, claimType, caseClass, merit, stage, status, fundableOnly, watchlistOnly, watchlist, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, country, claimType, caseClass, merit, stage, status, fundableOnly, watchlistOnly, pageSize, tab]);

  const modelledCases = cases.filter((item) => item.fundable);
  const compareCases = cases.filter((item) => compareIds.includes(item.id));
  const activeFilters = [country !== "ALL", claimType !== "ALL", caseClass !== "ALL", merit !== "ALL", stage !== "ALL", status !== "ALL", fundableOnly, watchlistOnly].filter(Boolean).length;
  const analytics = useMemo(() => buildLitigationAnalytics(cases), [cases]);
  const maxClassCount = Math.max(1, ...analytics.byClass.map((bucket) => bucket.count));

  const toggleWatch = (id: string) => setWatchlist((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= 3 ? current : [...current, id]);
  const clearFilters = () => { setCountry("ALL"); setClaimType("ALL"); setCaseClass("ALL"); setMerit("ALL"); setStage("ALL"); setStatus("ALL"); setFundableOnly(false); setWatchlistOnly(false); setQuery(""); };

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
        const result = await utils.customer.litigationFunds.fundingQuote.fetch({ amountMinor: Math.round(amount), fundingSource });
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
    `litigation-funds-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Case", "Claimant", "Claimant kind", "Defendant", "Defendant kind", "Case class", "Claim type", "Cause of action", "Case / docket number", "Filed date", "Jurisdiction", "Country code", "Court", "Court detail", "Claim-value band", "Merit", "Stage", "Status", "Estimated damages (minor)", "Capital at risk (minor)", "Expected multiple (bps)", "Expected duration (months)", "Funding target (minor)", "Committed (minor)", "Funded bps", "Remaining days", "Listed parties", "Outcome", "Source URL", "As of"],
    filtered.map((item) => [
      item.caseName, item.claimant, partyKindLabel(item.claimantKind), item.defendant, partyKindLabel(item.defendantKind),
      caseClassLabel(item.caseClass), item.claimType, item.causeOfAction ?? "", item.caseNumber ?? "", item.filedAt ?? "",
      item.jurisdiction, item.countryCode, item.court, item.courtDetail ?? "", item.claimValueBand ? valueBandLabel(item.claimValueBand) : "",
      item.meritGrade ?? "", stageLabel(item.stage), STATUS_LABELS[item.status] || item.status,
      item.estimatedDamagesMinor ?? "", item.capitalAtRiskMinor ?? "", item.expectedMultipleBps ?? "", item.expectedDurationMonths ?? "",
      item.fundingAskMinor ?? "", item.committedMinor, item.fundedBps, item.remainingDays ?? "",
      item.listedParties.map((party) => `${party.role}:${party.listedName}${party.ticker ? ` (${party.ticker}${party.exchange ? `, ${party.exchange}` : ""})` : ""}`).join(" "),
      item.fundable ? (item.scenarios.map((scenario) => `${scenario.outcome}:${fmtPercent(scenario.probabilityBps)}`).join(" ")) : "Not modelled",
      item.sourceUrl ?? "", item.asOf,
    ]),
  );

  const exportPositions = () => downloadCsv(
    `litigation-funds-portfolio-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Position", "Instrument", "Type", "Claim type", "Amount (minor)", "Currency", "Funding", "Stage at buy", "Expected multiple (bps)", "Outcome", "Realised (minor)", "Opened", "Status"],
    positions.map((position) => [
      position.positionCode, position.instrumentName, position.instrumentType, position.claimType || "",
      position.amountMinor, position.currency, position.fundingSource || "", position.stageAtPurchase || "",
      position.expectedMultipleBps ?? "", position.outcome || "", position.realisedMinor ?? "",
      formatDate(position.openedAt), position.positionStatus,
    ]),
  );

  const sources = usingFallback ? (fallback?.sources || []) : (market.data?.sources || []);
  const fetchedAt = usingFallback ? fallback?.fetchedAt : market.data?.fetchedAt;
  const degraded = usingFallback ? !!fallback?.degraded : !!market.data?.degraded;

  const timeline = useMemo(() => {
    return cases
      .filter((item) => item.milestones.length > 0 || item.fundable)
      .slice()
      .sort((a, b) => (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999));
  }, [cases]);

  return <div className="arb-page portal-page lf-page">
    <section className="lf-hero" aria-label="Litigation Funds desk">
      <div className="lf-hero-grid" aria-hidden="true" />
      <div className="lf-hero-top">
        <div className="lf-hero-badge"><Gavel size={15}/> Litigation Funds · Case-linked capital</div>
        <div className="cd-hero-sources">
          <span className={`cd-source-chip${degraded ? " is-degraded" : ""}`}>{degraded ? "Some legal-record sources degraded" : usingFallback ? "Live data (browser fallback)" : "Live legal-record data"}</span>
          <button type="button" className="cd-refresh" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh case records"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>
      <h1 className="lf-hero-title">Fund real, cited legal claims — at risk, against milestones.</h1>
      <p className="lf-hero-sub">Every case on the desk is a real public court filing or enforcement notice, cited to its source — and every one of them is open to fund. No administrator approval is needed: your commitment is drawn straight from your wallet, or from all of your wallets combined through live FX. Administrators independently publish the reviewed economics — merit, damages, capital at risk and the modelled settle / win / lose outcomes — which set the configured funder multiple. Your money is held in escrow and released as the case passes each stage; a favourable outcome repays principal plus the configured multiple and a loss writes the capital off.</p>
      <div className="lf-hero-stats">
        <div className="lf-stat"><span>Cases listed</span><strong>{cases.length}</strong></div>
        <div className="lf-stat"><span>Reviewed economics</span><strong>{modelledCases.length}</strong></div>
        <div className="lf-stat"><span>Your committed</span><strong>{fmtMinor(summary.committedMinor)}</strong></div>
        <div className="lf-stat"><span>Your realised</span><strong>{fmtMinor(summary.realisedMinor)}</strong></div>
      </div>
      {sources.length > 0 && <div className="lf-source-list">
        {sources.map((source: any) => <span className={`lf-source-chip is-${source.status}`} key={source.name} title={source.detail || source.url}>
          {source.status === "ok" ? <Check size={11}/> : <AlertTriangle size={11}/>} {source.name}
        </span>)}
      </div>}
    </section>

    {market.isError && !usingFallback && <div className="lf-notice is-error" role="alert">
      <AlertTriangle size={16}/>
      <div><strong>The desk could not reach the account service.</strong> {market.error?.message || "Live legal-record data could not be loaded."} Contacting the official sources directly…</div>
      <button type="button" className="lf-btn lf-btn-sm" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {usingFallback && <div className="lf-notice" role="status">
      <Globe2 size={16}/>
      <div><strong>Live case records loaded directly from the public sources.</strong> Administrator dossiers are not available in this fallback; commitments resume when the service reconnects.</div>
    </div>}

    {storeWarning && <div className="lf-notice" role="status"><AlertTriangle size={16}/><div>{storeWarning}</div></div>}
    {message && !target && <div className="lf-notice is-error" role="alert"><AlertTriangle size={16}/><div>{message}</div></div>}

    <nav className="lf-tabs" aria-label="Litigation Funds sections">
      <button type="button" className={`lf-tab${tab === "cases" ? " is-active" : ""}`} onClick={() => setTab("cases")}>Cases open for funding <span className="lf-tab-count">{cases.length}</span></button>
      <button type="button" className={`lf-tab${tab === "bundles" ? " is-active" : ""}`} onClick={() => setTab("bundles")}>Bundles <span className="lf-tab-count">{bundles.length}</span></button>
      <button type="button" className={`lf-tab${tab === "portfolio" ? " is-active" : ""}`} onClick={() => setTab("portfolio")}>Portfolio <span className="lf-tab-count">{positions.length}</span></button>
      <button type="button" className={`lf-tab${tab === "timeline" ? " is-active" : ""}`} onClick={() => setTab("timeline")}>Case timeline <span className="lf-tab-count">{timeline.length}</span></button>
      <button type="button" className={`lf-tab${tab === "analytics" ? " is-active" : ""}`} onClick={() => setTab("analytics")}>Litigation analytics</button>
    </nav>

    {tab === "cases" && <section className="lf-section" aria-label="Case catalogue">
      <div className="lf-toolbar">
        <div className="lf-filters">
          <div className="lf-filter"><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Case, party, court or claim" /></div>
          <div className="lf-filter"><label>Country</label><select value={country} onChange={(e) => setCountry(e.target.value)}><option value="ALL">All countries</option>{countryOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
          <div className="lf-filter"><label>Case class</label><select value={caseClass} onChange={(e) => setCaseClass(e.target.value)}><option value="ALL">All case classes</option>{LITIGATION_CASE_CLASSES.map((value) => <option key={value} value={value}>{caseClassLabel(value)}</option>)}</select></div>
          <div className="lf-filter"><label>Claim type</label><select value={claimType} onChange={(e) => setClaimType(e.target.value)}><option value="ALL">All claim types</option>{claimTypeOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="lf-filter"><label>Merit grade</label><select value={merit} onChange={(e) => setMerit(e.target.value)}><option value="ALL">All grades</option>{MERIT_OPTIONS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></div>
          <div className="lf-filter"><label>Stage</label><select value={stage} onChange={(e) => setStage(e.target.value)}><option value="ALL">All stages</option>{STAGE_OPTIONS.map((value) => <option key={value} value={value}>{stageLabel(value as any)}</option>)}</select></div>
          <div className="lf-filter"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option>{STATUS_ORDER.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></div>
          <div className="lf-filter"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fundable">Open for funding first</option><option value="deadline">Closing soonest</option><option value="filed">Most recently filed</option><option value="merit">Highest merit</option><option value="damages">Largest claim</option><option value="name">Case name A–Z</option><option value="country">Country A–Z</option></select></div>
        </div>
        <div className="lf-toolbar-actions">
          <label className="cd-checkbox"><input type="checkbox" checked={fundableOnly} onChange={(e) => setFundableOnly(e.target.checked)} /> Reviewed economics only</label>
          <label className="cd-checkbox"><input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)} /> Watchlist ({watchlist.length})</label>
          {activeFilters > 0 && <button type="button" className="lf-btn lf-btn-sm ghost" onClick={clearFilters}><X size={13}/> Clear {activeFilters}</button>}
          <button type="button" className="lf-btn lf-btn-sm" onClick={exportCatalogue} disabled={!filtered.length}><Download size={13}/> Export CSV</button>
          {compareIds.length > 0 && <button type="button" className="lf-btn lf-btn-sm" onClick={() => setCompareOpen(true)}><Layers size={13}/> Compare {compareIds.length}</button>}
        </div>
      </div>

      <div className="lf-section-head"><span className="eyebrow">{filtered.length} of {cases.length} cases · page {currentPage} of {pageCount}</span></div>

      {(market.isLoading || contactingSources) && !cases.length && <div className="lf-grid">{Array.from({ length: 6 }).map((_, index) => <div className="lf-card" key={index}><div className="lf-spinner" /> Loading live case record…</div>)}</div>}
      {cases.length > 0 && !filtered.length && <div className="lf-empty"><CircleHelp size={16}/> No cases match the current filters. Clear the search or widen the filters.</div>}

      <div className="lf-grid">
        {pageRows.map((item) => {
          const watched = watchlist.includes(item.id);
          const comparing = compareIds.includes(item.id);
          return <article className={`lf-card${item.fundable ? " is-fundable" : ""}`} key={item.id}>
            <div className="lf-card-head">
              <div>
                <div className="lf-card-title">{item.flag} {item.caseName}</div>
                <div className="lf-card-meta"><span>{item.claimant} <em className="lf-mono">{partyKindLabel(item.claimantKind)}</em> <em>v</em> {item.defendant} <em className="lf-mono">{partyKindLabel(item.defendantKind)}</em></span></div>
                <div className="lf-card-meta"><span>{item.jurisdiction} · {item.court}{item.courtDetail ? ` · ${item.courtDetail}` : ""}</span></div>
              </div>
              <div className="lf-card-actions">
                <button type="button" className={`lf-star${watched ? " is-on" : ""}`} onClick={() => toggleWatch(item.id)} aria-pressed={watched} title={watched ? "Remove from watchlist" : "Add to watchlist"}><Star size={15}/></button>
                <button type="button" className={`lf-star${comparing ? " is-on" : ""}`} onClick={() => toggleCompare(item.id)} aria-pressed={comparing} title={comparing ? "Remove from compare" : "Add to compare (max 3)"}><Layers size={15}/></button>
              </div>
            </div>

            <div className="lf-badges">
              {item.meritGrade && <span className={meritClass(item.meritGrade)}>Merit {item.meritGrade}</span>}
              <span className={`lf-badge lf-badge--class${isInsolvency(item) ? " lf-badge--insolvency" : ""}`}>{caseClassLabel(item.caseClass)}</span>
              <span className="lf-badge lf-badge--stage">{stageLabel(item.stage)}</span>
              <span className={statusClass(item.status)}>{STATUS_LABELS[item.status] || item.status}</span>
              <span className="lf-badge">{item.claimType}</span>
              {item.claimValueBand && <span className="lf-badge">{valueBandLabel(item.claimValueBand)} claim</span>}
            </div>

            <div className="lf-card-meta">
              {item.causeOfAction && <span><Scale size={11}/> {item.causeOfAction}</span>}
              {item.caseNumber && <span className="lf-mono">No. {item.caseNumber}</span>}
              {item.filedAt && <span>Filed {formatDate(item.filedAt)}</span>}
            </div>

            <div className="lf-card-meta">
              <span>Claim {item.estimatedDamagesMinor ? fmtMinor(item.estimatedDamagesMinor) : "not published"}</span>
              <span>Capital at risk {item.capitalAtRiskMinor ? fmtMinor(item.capitalAtRiskMinor) : "—"}</span>
              <span>Expected {fmtMultiple(item.expectedMultipleBps)}{item.expectedDurationMonths ? ` · ${item.expectedDurationMonths}mo` : ""}</span>
            </div>

            {item.listedParties.length > 0 && <div className="lf-listed-row">
              <span className="eyebrow">Listed parties</span>
              {item.listedParties.map((party) => <span className="lf-listed-chip" key={`${party.role}-${party.partyName}`} title={`${party.role === "CLAIMANT" ? "Claimant" : "Defendant"} · listed as ${party.listedName}`}>
                <TrendingUp size={11}/> {party.ticker ? `${party.ticker} · ` : ""}{party.listedName}{party.exchange ? ` (${party.exchange})` : ""} <em className="lf-mono">{party.role === "CLAIMANT" ? "claimant" : "defendant"}</em>
              </span>)}
            </div>}

            {isInsolvency(item) && <div className="lf-notice lf-insolvency-note">
              <Layers size={14}/>
              <div><strong>Insolvency record.</strong> This is an estate, administration or winding-up — a company that is <em>running bankrupt</em>, not a company suing or defending a claim. It is shown here clearly labelled so the two are never confused.</div>
            </div>}

            {item.fundable ? <>
              <div className="lf-progress">
                <div className="lf-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
                <SlotBar bps={item.fundedBps} />
              </div>
              <div className="lf-countdown"><CalendarClock size={12}/> {daysLabel(item.remainingDays)}{item.fundingDeadline ? ` · closes ${formatDate(item.fundingDeadline)}` : ""}</div>
              <ScenarioList scenarios={item.scenarios} />
              <div className="lf-evalue"><TrendingUp size={12}/> Probability-weighted expected recovery <strong>{item.expectedValueMinor !== null ? fmtMinor(item.expectedValueMinor) : "—"}</strong> · full loss scenario is shown</div>
              <MilestoneStrip milestones={item.milestones} />
            </> : <div className="lf-unfundable"><AlertTriangle size={13}/> Reviewed economics not yet published — you can still fund this case. It is a real, cited record; the administrator’s merit, damages and settle / win / lose multiple are pending, so the repayment multiple is not yet fixed. Your commitment is held in escrow and a loss writes the capital off.</div>}

            <p className="lf-card-meta">{item.problem}</p>
            {item.highlights.length > 0 && <div className="lf-badges">{item.highlights.slice(0, 4).map((value) => <span className="lf-badge" key={value}>{value}</span>)}</div>}

            <div className="lf-econ">
              <span>You can invest from <b>{fmtMinor(Math.max(item.fundingAskMinor || 0, MIN_INVESTMENT_MINOR))}</b></span>
              <span>Projected profit <b className="lf-profit">{fmtProfit(Math.max(item.fundingAskMinor || 0, MIN_INVESTMENT_MINOR), item.expectedMultipleBps)}</b></span>
            </div>
            <div className="lf-card-actions" style={{ justifyContent: "space-between" }}>
              <span className="lf-card-meta" title={item.sourceUrl || item.source}><Scale size={11}/> {item.asOf} · {item.source}{item.verified ? " · desk-verified" : " · discovery"}</span>
              <button className="lf-btn primary" onClick={() => openPurchase({ type: "CASE", id: item.id, name: item.caseName, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.fundingAskMinor || 0, 100_000))}>Fund this case <ChevronRight size={14}/></button>
            </div>
          </article>;
        })}
      </div>

      {filtered.length > 0 && <div className="lf-pagination">
        <button type="button" className="lf-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14}/> Previous</button>
        <span className="eyebrow">Page {currentPage} of {pageCount}</span>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / page</option>)}</select>
        <button type="button" className="lf-page-btn" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight size={14}/></button>
      </div>}
    </section>}

    {tab === "bundles" && <section className="lf-section" aria-label="Case bundles">
      <div className="lf-section-head">
        <div><span className="eyebrow">Case bundles</span><h2>Pooled claims</h2><p>A bundle is a pro-rata share of a set of cases. You are paid your share of the bundle’s <strong>realised</strong> recoveries, allocated per case by the administrator’s configured weights. Pooling spreads the risk; it does not guarantee a return.</p></div>
      </div>
      {!bundles.length && <div className="lf-empty"><Layers size={16}/> No bundles are published right now.</div>}
      <div className="lf-grid">
        {bundles.map((bundle) => {
          const fundedBps = bundle.targetMinor > 0 ? Math.min(10_000, Math.round((bundle.committedMinor * 10_000) / bundle.targetMinor)) : 0;
          return <article className="lf-card is-fundable" key={bundle.id}>
            <div className="lf-card-head">
              <div>
                <div className="lf-card-title">{bundle.name}</div>
                <div className="lf-card-meta"><span>{bundle.jurisdiction} · {bundle.claimType}</span></div>
              </div>
              <span className={riskClass(bundle.riskGrade)}>{RISK_LABELS[bundle.riskGrade]}</span>
            </div>
            <p className="lf-card-meta">{bundle.summary}</p>
            <div className="lf-card-meta">
              <span>Target {fmtMinor(bundle.targetMinor)}</span>
              <span>Unit {fmtMinor(bundle.unitPriceMinor)} × {bundle.unitCount.toLocaleString()}</span>
              <span>Expected {fmtMultiple(bundle.expectedMultipleBps)}{bundle.expectedDurationMonths ? ` · ${bundle.expectedDurationMonths}mo` : ""}</span>
            </div>
            <div className="lf-progress">
              <div className="lf-progress-label"><span>Bundle funding</span><span>{fmtPercent(fundedBps)} of {fmtMinor(bundle.targetMinor)}</span></div>
              <SlotBar bps={fundedBps} />
            </div>
            <div className="lf-bundle-alloc">
              <span>Planned allocation ({bundle.caseIds.length} case{bundle.caseIds.length === 1 ? "" : "s"}):</span>
              {bundle.caseIds.map((caseId) => <span className="lf-badge" key={caseId}>{caseId} · {fmtPercent(bundle.allocationBpsByCase[caseId] || 0)}</span>)}
              {!bundle.caseIds.length && <span>Allocation weights are set by the administrator.</span>}
            </div>
            <div className="lf-econ">
              <span>You can invest from <b>{fmtMinor(Math.max(bundle.unitPriceMinor, MIN_INVESTMENT_MINOR))}</b></span>
              <span>Projected profit <b className="lf-profit">{fmtProfit(Math.max(bundle.unitPriceMinor, MIN_INVESTMENT_MINOR), bundle.expectedMultipleBps)}</b></span>
            </div>
            <div className="lf-card-actions" style={{ justifyContent: "space-between" }}>
              <span className="lf-card-meta"><Scale size={11}/> {bundle.asOf} · {bundle.source}</span>
              <button className="lf-btn primary" onClick={() => openPurchase({ type: "BUNDLE", id: bundle.id, name: bundle.name, expectedMultipleBps: bundle.expectedMultipleBps }, Math.max(bundle.unitPriceMinor, 100_000))}>Fund this bundle <ChevronRight size={14}/></button>
            </div>
          </article>;
        })}
      </div>
    </section>}

    {tab === "portfolio" && <section className="lf-section" aria-label="Your litigation funds portfolio">
      <div className="lf-section-head">
        <div><span className="eyebrow">Your portfolio</span><h2>Commitments & escrow</h2></div>
        <div className="lf-toolbar-actions">
          <span className="lf-badge"><Wallet size={12}/> Settled in {settlement} · {fmtMinor(available)} available</span>
          <button type="button" className="lf-btn lf-btn-sm" onClick={exportPositions} disabled={!positions.length}><Download size={13}/> Export CSV</button>
        </div>
      </div>
      <div className="lf-hero-stats">
        <div className="lf-stat"><strong>{fmtMinor(summary.committedMinor)}</strong><span>Committed (escrow)</span></div>
        <div className="lf-stat"><strong>{summary.activePositions}</strong><span>Active positions</span></div>
        <div className="lf-stat"><strong>{summary.settledPositions}</strong><span>Settled</span></div>
        <div className="lf-stat"><strong>{summary.writtenOffPositions}</strong><span>Written off</span></div>
        <div className="lf-stat"><strong>{fmtMinor(summary.realisedMinor)}</strong><span>Realised payouts</span></div>
      </div>
      {!positions.length && <div className="lf-empty"><Wallet size={16}/> No commitments yet. Fund a modelled case or bundle to open a position — the administrator follows up on due diligence.</div>}
      {positions.length > 0 && <div style={{ overflowX: "auto" }}>
        <table className="lf-table">
          <thead><tr><th>Position</th><th>Instrument</th><th>Type</th><th>Amount</th><th>Funding</th><th>Expected</th><th>Outcome</th><th>Realised</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((position: any) => <tr key={position.id}>
              <td className="lf-mono">{position.positionCode}</td>
              <td>{position.instrumentName}</td>
              <td>{position.instrumentType === "CASE" ? "Case share" : "Bundle"}</td>
              <td>{fmtMinor(Number(position.amountMinor))}</td>
              <td>{position.fundingSource === "COMBINED" ? "Combined" : position.fundingSource || position.currency}</td>
              <td>{fmtMultiple(position.expectedMultipleBps)}</td>
              <td>{position.outcome ? (OUTCOME_LABELS[position.outcome] || position.outcome) : "—"}</td>
              <td>{position.realisedMinor !== null && position.realisedMinor !== undefined ? fmtMinor(Number(position.realisedMinor)) : "—"}</td>
              <td>{formatDate(position.openedAt)}</td>
              <td><span className="lf-badge">{position.positionStatus}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>}

    {tab === "timeline" && <section className="lf-section" aria-label="Case timeline">
      <div className="lf-section-head"><div><span className="eyebrow">Case timeline</span><h2>Milestone calendar</h2><p>Escrow is released against milestones as a case progresses: Filed → Discovery → Mediation → Trial → Judgment → Enforcement → Distribution. A reached milestone is never un-done.</p></div></div>
      {!timeline.length && <div className="lf-empty"><CalendarClock size={16}/> No modelled cases with milestones are published yet.</div>}
      <div className="lf-admin-list">
        {timeline.map((item) => {
          const reached = item.milestones.filter((milestone) => milestone.status === "REACHED").length;
          return <div className="lf-admin-row" key={item.id}>
            <div className="lf-admin-row-head">
              <strong>{item.flag} {item.caseName}</strong>
              <span className="lf-badge lf-badge--stage">{stageLabel(item.stage)}</span>
            </div>
            <div className="lf-card-meta"><span>{reached} of {item.milestones.length || 0} milestones reached</span>{item.remainingDays !== null && <span>{daysLabel(item.remainingDays)}</span>}</div>
            <MilestoneStrip milestones={item.milestones} />
          </div>;
        })}
      </div>
    </section>}

    {tab === "analytics" && <section className="lf-section" aria-label="Litigation analytics">
      <div className="lf-section-head"><div><span className="eyebrow">Litigation analytics</span><h2>What is on the desk</h2><p>Desk-level aggregates computed only from the cited records above — how many are companies litigating a claim, how many are insolvency estates, and where the activity concentrates. No figure is inferred beyond the records themselves.</p></div></div>
      {!cases.length ? <div className="lf-empty"><CircleHelp size={16}/> No case records loaded yet — analytics appear once the cited records arrive.</div> : <div className="lf-analytics">
        <div className="lf-analytics-card">
          <div className="lf-analytics-split">
            <div className="lf-analytics-stat"><b>{analytics.totalCases}</b><span>Records on the desk</span></div>
            <div className="lf-analytics-stat"><b>{analytics.litigationCases}</b><span>Companies in court (litigation)</span></div>
            <div className="lf-analytics-stat"><b>{analytics.insolvencyCases}</b><span>Insolvency estates</span></div>
            <div className="lf-analytics-stat"><b>{fmtPercent(analytics.insolvencyBps)}</b><span>Insolvency share</span></div>
            <div className="lf-analytics-stat"><b>{analytics.listedPartyCount}</b><span>Listed-company parties</span></div>
          </div>
          <div>
            <span className="eyebrow">Litigation vs insolvency</span>
            <div className="lf-bar-track" style={{ marginTop: 6 }}>
              <div className="lf-bar-fill lf-bar-fill--insolvency" style={{ width: `${analytics.totalCases ? Math.round((analytics.insolvencyCases * 100) / analytics.totalCases) : 0}%` }} />
            </div>
            <small>{analytics.litigationCases} litigating · {analytics.insolvencyCases} insolvent</small>
          </div>
        </div>

        <div className="lf-analytics-grid">
          <div className="lf-analytics-card">
            <h3>By case class</h3>
            {analytics.byClass.map((bucket) => <div className="lf-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="lf-bar-track"><div className={`lf-bar-fill${bucket.key === "INSOLVENCY" ? " lf-bar-fill--insolvency" : ""}`} style={{ width: `${Math.round((bucket.count * 100) / maxClassCount)}%` }} /></div>
              <b className="lf-mono">{bucket.count}</b>
            </div>)}
          </div>

          <div className="lf-analytics-card">
            <h3>By jurisdiction</h3>
            {!analytics.byJurisdiction.length && <p className="lf-card-meta">No jurisdictions published.</p>}
            {analytics.byJurisdiction.map((bucket) => <div className="lf-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="lf-bar-track"><div className="lf-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byJurisdiction[0].count))}%` }} /></div>
              <b className="lf-mono">{bucket.count}</b>
            </div>)}
          </div>

          <div className="lf-analytics-card">
            <h3>Claim-value bands</h3>
            {!analytics.byValueBand.length && <p className="lf-card-meta">No published claim amounts to band.</p>}
            {analytics.byValueBand.map((bucket) => <div className="lf-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="lf-bar-track"><div className="lf-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, Math.max(...analytics.byValueBand.map((entry) => entry.count))))}%` }} /></div>
              <b className="lf-mono">{bucket.count}</b>
            </div>)}
          </div>

          <div className="lf-analytics-card">
            <h3>Filings by month</h3>
            {!analytics.byFilingMonth.length && <p className="lf-card-meta">No filed dates published.</p>}
            {analytics.byFilingMonth.map((bucket) => <div className="lf-bar-row" key={bucket.key}>
              <span className="lf-mono">{bucket.label}</span>
              <div className="lf-bar-track"><div className="lf-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byFilingMonth[0].count))}%` }} /></div>
              <b className="lf-mono">{bucket.count}</b>
            </div>)}
          </div>
        </div>

        <div className="lf-analytics-card">
          <h3>Most active companies</h3>
          {!analytics.mostActiveCompanies.length && <p className="lf-card-meta">No company parties identified from the records.</p>}
          {analytics.mostActiveCompanies.length > 0 && <div style={{ overflowX: "auto" }}>
            <table className="lf-table">
              <thead><tr><th>Company</th><th>Role</th><th>Cited records</th><th>Listing</th></tr></thead>
              <tbody>
                {analytics.mostActiveCompanies.map((company) => <tr key={company.name}>
                  <td>{company.name}</td>
                  <td>{company.role === "MIXED" ? "Claimant & defendant" : company.role === "CLAIMANT" ? "Claimant" : "Defendant"}</td>
                  <td className="lf-mono">{company.count}</td>
                  <td>{company.ticker ? <span className="lf-badge lf-badge--listed">{company.ticker}{company.exchange ? ` · ${company.exchange}` : ""}</span> : <span className="lf-card-meta">Not publicly listed</span>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        </div>
      </div>}
    </section>}

    <div id="lf-education" className="lf-notice">
      <ShieldCheck size={16}/>
      <div>
        <strong>How the Litigation Funds desk works.</strong> Every card is a real, cited public court filing or enforcement notice, and <em>every case on the desk is open for funding</em> — no administrator approval is required. The <em>discovery</em> layer is that cited record. The <em>dossier</em> layer is an administrator’s reviewed economics for the case — merit, damages, capital at risk and the modelled settle / win / lose scenarios — each figure traceable to a source URL and an as-of date; when published it fixes the configured funder multiple and the full loss scenario is always shown. Cases without reviewed economics can still be funded, but their repayment multiple is not yet fixed, so a reader sees that plainly. Your commitment settles in {settlement}, is drawn from any wallet you hold or from all wallets combined at the live rate, is held in escrow and released against milestones, and is paid or written off when the case resolves. Nothing here is a prediction, and no external transfer occurs on this desk.
      </div>
    </div>

    {compareOpen && compareCases.length > 0 && <div className="lf-modal" onMouseDown={() => setCompareOpen(false)}>
      <div className="lf-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lf-modal-head"><strong>Compare {compareCases.length} cases</strong><button type="button" className="lf-btn lf-btn-sm ghost" onClick={() => setCompareOpen(false)}><X size={16}/></button></div>
        <div className="lf-modal-body" style={{ overflowX: "auto" }}>
          <table className="lf-table">
            <thead><tr><th>Field</th>{compareCases.map((item) => <th key={item.id}>{item.flag} {item.caseName}</th>)}</tr></thead>
            <tbody>
              <tr><td>Case class</td>{compareCases.map((item) => <td key={item.id}>{caseClassLabel(item.caseClass)}{isInsolvency(item) ? " (insolvency)" : ""}</td>)}</tr>
              <tr><td>Claim type</td>{compareCases.map((item) => <td key={item.id}>{item.claimType}</td>)}</tr>
              <tr><td>Claimant (kind)</td>{compareCases.map((item) => <td key={item.id}>{item.claimant} · {partyKindLabel(item.claimantKind)}</td>)}</tr>
              <tr><td>Defendant (kind)</td>{compareCases.map((item) => <td key={item.id}>{item.defendant} · {partyKindLabel(item.defendantKind)}</td>)}</tr>
              <tr><td>Cause of action</td>{compareCases.map((item) => <td key={item.id}>{item.causeOfAction || "—"}</td>)}</tr>
              <tr><td>Case / docket no.</td>{compareCases.map((item) => <td key={item.id} className="lf-mono">{item.caseNumber || "—"}</td>)}</tr>
              <tr><td>Filed</td>{compareCases.map((item) => <td key={item.id}>{item.filedAt ? formatDate(item.filedAt) : "—"}</td>)}</tr>
              <tr><td>Jurisdiction</td>{compareCases.map((item) => <td key={item.id}>{item.jurisdiction}</td>)}</tr>
              <tr><td>Court</td>{compareCases.map((item) => <td key={item.id}>{item.court}{item.courtDetail ? ` · ${item.courtDetail}` : ""}</td>)}</tr>
              <tr><td>Claim-value band</td>{compareCases.map((item) => <td key={item.id}>{item.claimValueBand ? valueBandLabel(item.claimValueBand) : "—"}</td>)}</tr>
              <tr><td>Listed parties</td>{compareCases.map((item) => <td key={item.id}>{item.listedParties.length ? item.listedParties.map((party) => `${party.ticker || party.listedName} (${party.role.toLowerCase()})`).join(", ") : "—"}</td>)}</tr>
              <tr><td>Merit</td>{compareCases.map((item) => <td key={item.id}>{item.meritGrade || "—"}</td>)}</tr>
              <tr><td>Stage</td>{compareCases.map((item) => <td key={item.id}>{stageLabel(item.stage)}</td>)}</tr>
              <tr><td>Status</td>{compareCases.map((item) => <td key={item.id}>{STATUS_LABELS[item.status] || item.status}</td>)}</tr>
              <tr><td>Est. damages</td>{compareCases.map((item) => <td key={item.id}>{item.estimatedDamagesMinor ? fmtMinor(item.estimatedDamagesMinor) : "—"}</td>)}</tr>
              <tr><td>Capital at risk</td>{compareCases.map((item) => <td key={item.id}>{item.capitalAtRiskMinor ? fmtMinor(item.capitalAtRiskMinor) : "—"}</td>)}</tr>
              <tr><td>Expected multiple</td>{compareCases.map((item) => <td key={item.id}>{fmtMultiple(item.expectedMultipleBps)}</td>)}</tr>
              <tr><td>Expected duration</td>{compareCases.map((item) => <td key={item.id}>{item.expectedDurationMonths ? `${item.expectedDurationMonths} months` : "—"}</td>)}</tr>
              <tr><td>Funding target</td>{compareCases.map((item) => <td key={item.id}>{item.fundingAskMinor ? fmtMinor(item.fundingAskMinor) : "—"}</td>)}</tr>
              <tr><td>Funded</td>{compareCases.map((item) => <td key={item.id}>{fmtPercent(item.fundedBps)}</td>)}</tr>
              <tr><td>Deadline</td>{compareCases.map((item) => <td key={item.id}>{item.fundingDeadline ? `${formatDate(item.fundingDeadline)} (${daysLabel(item.remainingDays)})` : "—"}</td>)}</tr>
              <tr><td>Expected value</td>{compareCases.map((item) => <td key={item.id}>{item.expectedValueMinor !== null ? fmtMinor(item.expectedValueMinor) : "Not modelled"}</td>)}</tr>
              <tr><td>Investable</td>{compareCases.map((item) => <td key={item.id}>{item.fundable ? "Yes — economics published" : "Yes — economics pending"}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="lf-modal-foot"><button className="lf-btn" onClick={() => setCompareOpen(false)}>Close</button></div>
      </div>
    </div>}

    {target && <div className="lf-modal" onMouseDown={() => setTarget(null)}>
      <div className="lf-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lf-modal-head">
          <strong>{target.type === "CASE" ? "Fund case share" : "Fund bundle"}</strong>
          <button type="button" className="lf-btn lf-btn-sm ghost" onClick={() => setTarget(null)}><X size={16}/></button>
        </div>
        <div className="lf-modal-body">
          <div className="lf-card-title">{target.name}</div>
          <div className="lf-card-meta"><span>{target.type === "CASE" ? "Single-case share" : "Pro-rata bundle share"}</span><span>Expected {fmtMultiple(target.expectedMultipleBps)}</span></div>

          <div className="lf-field">
            <label>Investment amount ({settlement})</label>
            <input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))} />
            <small>You can pay from the {settlement} wallet, any single wallet, or all wallets combined.</small>
          </div>

          <div>
            <span className="eyebrow">Pay from</span>
            <div className="lf-funding">
              <button type="button" className={`lf-funding-option${fundingSource === "COMBINED" ? " is-selected" : ""}`} onClick={() => setFundingSource("COMBINED")}>
                <Wallet size={14}/> <span><strong>Combined balance</strong><small>All wallets, converted at the live rate</small></span>
                {quote?.fundingSource === "COMBINED" && quote?.combinedAvailableMinor !== null && <b>{fmtMinor(quote.combinedAvailableMinor)}</b>}
              </button>
              {fundedWallets.map((wallet) => <button type="button" key={wallet.currency} className={`lf-funding-option${fundingSource === wallet.currency ? " is-selected" : ""}`} onClick={() => setFundingSource(wallet.currency)}>
                <Wallet size={14}/> <span><strong>{wallet.currency}</strong><small>{wallet.currencyName || "Wallet"}</small></span>
                <b>{moneyMinor(wallet.availableMinor, wallet.currency, wallet.scale)}</b>
              </button>)}
              {!fundedWallets.length && <p className="lf-card-meta">No funded wallets detected yet.</p>}
            </div>
          </div>

          <div className="lf-quote">
            {quoteLoading && <span>Checking funding at the live rate…</span>}
            {!quoteLoading && !quote && <span>Enter an amount to see how it will be funded.</span>}
            {!quoteLoading && quote?.sufficient && <>
              <strong><Check size={13}/> Funded by {quote.fundingSource === "COMBINED" ? "combined wallets" : quote.fundingSource}</strong>
              {quote.usdAvailableMinor > 0 && quote.convertedUsdMinor < quote.amountMinor && <div className="lf-quote-row"><span>{settlement} wallet</span><span>{fmtMinor(Math.max(0, quote.amountMinor - quote.convertedUsdMinor))}</span></div>}
              {(quote.debits || []).map((debit: any) => <div className="lf-quote-row" key={debit.currency}><span>{debit.currency} → {fmtMinor(debit.convertedUsdMinor)} @ {debit.rate} <em>{debit.rateProvider}</em></span><span>{moneyMinor(debit.amountMinor, debit.currency, wallets.find((wallet) => wallet.currency === debit.currency)?.scale ?? 2)}</span></div>)}
            </>}
            {!quoteLoading && quote && !quote.sufficient && <div>
              <strong><AlertTriangle size={13}/> Insufficient balance</strong>
              <span>{quote.message}{quote.combinedAvailableMinor !== null ? ` Combined available: ${fmtMinor(quote.combinedAvailableMinor)}.` : ""}</span>
            </div>}
          </div>

          <div className="lf-notice"><ShieldCheck size={15}/><div>Confirming debits your chosen wallet(s) through the existing internal ledger, locks the amount in escrow and creates a durable position. Duplicate requests are idempotent. A favourable outcome repays principal plus the configured multiple; a loss writes the capital off. No external transfer occurs on this desk.</div></div>
          {message && <div className="lf-notice is-error" role="alert"><AlertTriangle size={15}/><div>{message}</div></div>}
        </div>
        <div className="lf-modal-foot">
          <button className="lf-btn" onClick={() => setTarget(null)}>Cancel</button>
          <button className="lf-btn primary" disabled={purchase.isPending || quoteLoading || (quote ? !quote.sufficient : false)} onClick={submitPurchase}>{purchase.isPending ? "Recording commitment…" : "Confirm commitment"} <Check size={14}/></button>
        </div>
      </div>
    </div>}

    <div className="lf-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ArrowUpRight size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{cases.length} cases · {bundles.length} bundles · {positions.length} positions</span>
      <span><Globe2 size={12}/> {sources.length} cited sources</span>
    </div>
  </div>;
}
