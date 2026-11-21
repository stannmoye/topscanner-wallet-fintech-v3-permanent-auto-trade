import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarClock, Check, ChevronRight, CircleHelp, Factory,
  Filter, Globe2, Landmark, MapPin, RefreshCw, Scale, ShieldCheck, Siren, TrendingUp, UserRound, Users, Wallet, X,
} from "lucide-react";
import {
  getCooperateDeptCatalogue,
  type CompanyCountdown,
  type CooperateDeptCompany,
  type DistressSeverity,
} from "@shared/cooperate-dept-catalogue";
import "./cooperate-dept.css";

const MARKET_POLL_INTERVAL_MS = 90_000;

const SEVERITY_META: Record<DistressSeverity, { label: string; className: string; rank: number }> = {
  CRITICAL: { label: "Critical", className: "cd-sev-critical", rank: 0 },
  HIGH: { label: "High", className: "cd-sev-high", rank: 1 },
  ELEVATED: { label: "Elevated", className: "cd-sev-elevated", rank: 2 },
  WATCH: { label: "Watch", className: "cd-sev-watch", rank: 3 },
};

const STATUS_LABELS: Record<string, string> = {
  INSOLVENT: "Insolvent", WINDING_UP: "Winding up", DISTRESSED: "Distressed",
  DISSOLVED: "Dissolved", SEEKING_ACQUIRER: "Seeking acquirer", STARTUP: "Startup",
};

const OWNERSHIP_OPTIONS: { id: "SHARES" | "FULL_OWNERSHIP" | "ASSET_PURCHASE"; label: string }[] = [
  { id: "SHARES", label: "Acquire shares" },
  { id: "FULL_OWNERSHIP", label: "Full ownership" },
  { id: "ASSET_PURCHASE", label: "Asset purchase" },
];

function fmtMinor(minor: number, currency = "USD") {
  const code = String(currency || "USD").toUpperCase();
  const value = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${code} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function foundedLabel(company: CooperateDeptCompany) {
  if (!company.foundedYear) return "—";
  if (company.foundedMonth) {
    const date = new Date(Date.UTC(company.foundedYear, company.foundedMonth - 1, 1));
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  }
  return String(company.foundedYear);
}

/** Human-readable age or remaining time; the unit shrinks as the target nears. */
function humanizeDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remDays = days - years * 365 - months * 30;
  if (years > 0) return `${years}y ${months}mo ${remDays}d`;
  if (months > 0) return `${months}mo ${remDays}d ${hours}h`;
  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function CountdownBlock({ countdown }: { countdown: CompanyCountdown }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const target = Date.parse(countdown.targetDate);
  if (!Number.isFinite(target)) return null;
  const delta = countdown.direction === "until" ? target - now : now - target;
  const pending = countdown.direction === "until" && delta > 0;
  const passed = countdown.direction === "until" && delta <= 0;
  const prefix = countdown.direction === "until" ? (passed ? "Date reached · " : "In ") : "Elapsed ";
  const value = pending || countdown.direction === "since" ? `${prefix}${humanizeDuration(delta)}` : "Now due";
  return <div className={`cd-countdown${pending ? " is-pending" : ""}`}>
    <span className="cd-countdown-label"><CalendarClock size={13}/> {countdown.label} · {countdown.direction === "until" ? "countdown" : "age"}</span>
    <strong className="cd-countdown-value">{value}</strong>
    <span className="cd-countdown-target">Target date {formatDate(countdown.targetDate)} · {countdown.source}</span>
  </div>;
}

function EducationSection() {
  const items = [
    { q: "What is the Cooperate Dept?", a: <p>The Cooperate Dept surfaces companies — start-ups and established firms alike — that need outside capital to be acquired, recapitalised or rescued. Each record is pulled from a free public register or published by the desk administrator, and every figure carries the source and the date it was observed.</p> },
    { q: "Where does the data come from?", a: <><p>Live records come from free, public data sources around the world:</p><ul><li>Norway — Brønnøysund Register Centre (bankruptcies and winding-up)</li><li>France — recherche-entreprises.api.gouv.fr (ceased companies)</li><li>United States — SEC EDGAR full-text search and submissions</li><li>Global — GLEIF LEI records (inactive legal entities)</li><li>United Kingdom — Companies House, United States — CourtListener (when configured)</li><li>Enrichment — Wikidata, World Bank and Eurostat context</li></ul></> },
    { q: "Why is net worth shown as a note, not a number?", a: <p>No free public register publishes a private company's net worth, enterprise value or shareholder equity. Rather than invent a figure, each record explains the gap. The desk administrator can request audited accounts and enter a verified capital requirement once one exists.</p> },
    { q: "What does the countdown mean?", a: <p>A countdown is only ever built from a real dated event — a declared bankruptcy date, a formal closure date, a filing date, or a court date the administrator has entered. Because most registers publish events in the past, the counter usually shows the <strong>age</strong> of the event. When an administrator enters a future date, the card shows a live <strong>countdown</strong> instead. It is a factual clock, not a prediction.</p> },
    { q: "How does a commitment work?", a: <p>Reserving an interest debits your USD wallet through the platform's internal ledger, locks the amount as a commitment, and records a durable position. No external transfer happens here; the desk administrator contacts you to progress due diligence and the legal agreement.</p> },
  ];
  return <section className="cd-education" aria-label="Cooperate Dept education">
    <div><span className="eyebrow">Understand before you commit</span><h2>Distressed & acquisition targets, explained</h2><p>What the desk shows, where the numbers come from, and what a commitment does.</p></div>
    <div>
      {items.map((item) => <details className="cd-faq" key={item.q}><summary>{item.q}</summary><div>{item.a}</div></details>)}
    </div>
  </section>;
}

export function CustomerCooperateDept({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.cooperateDept.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [region, setRegion] = useState("ALL");
  const [sort, setSort] = useState("severity");
  const [selected, setSelected] = useState<CooperateDeptCompany | null>(null);
  const [basis, setBasis] = useState<"SHARES" | "FULL_OWNERSHIP" | "ASSET_PURCHASE">("SHARES");
  const [amount, setAmount] = useState(0);
  const [message, setMessage] = useState("");

  const commit = trpc.customer.cooperateDept.commit.useMutation({
    onSuccess: (result: any) => {
      setSelected(null);
      setAmount(0);
      void utils.customer.cooperateDept.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.cooperateDept.market.refetch();
      push(`+ Commitment recorded · ${result.companyName} reserved through the wallet ledger`);
    },
    onError: (error) => setMessage(error.message),
  });

  const serverCompanies = useMemo(() => (market.data?.companies || []) as CooperateDeptCompany[], [market.data]);
  const hasServerCompanies = serverCompanies.length > 0;

  // Resilience fallback: the public data sources are CORS-enabled, so if the
  // account service cannot reach them the desk fetches the same verified
  // catalogue directly in the customer's browser. Nothing is ever fabricated.
  const [fallback, setFallback] = useState<{ companies: CooperateDeptCompany[]; sources: any[]; fetchedAt: string; degraded: boolean } | null>(null);
  const [fallbackError, setFallbackError] = useState("");

  useEffect(() => {
    if (market.isLoading || market.isFetching || hasServerCompanies) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getCooperateDeptCatalogue();
        if (cancelled) return;
        if (catalogue.companies.length) {
          setFallback({ companies: catalogue.companies, sources: catalogue.sources, fetchedAt: catalogue.fetchedAt, degraded: catalogue.degraded });
          setFallbackError("");
        } else {
          setFallbackError("The public registers did not return any companies.");
        }
      } catch (error) {
        if (!cancelled) setFallbackError(error instanceof Error ? error.message : "Live company data could not be loaded");
      }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, hasServerCompanies]);

  const usingFallback = !hasServerCompanies && !!fallback?.companies.length;
  const companies: CooperateDeptCompany[] = hasServerCompanies ? serverCompanies : (fallback?.companies || []);
  const contactingSources = !market.isLoading && !market.isError && !hasServerCompanies && !companies.length && !usingFallback && !fallbackError;
  const positions: any[] = (market.data?.positions || []) as any[];
  const available = Number(market.data?.availableMinor || 0);
  const summary = market.data?.summary || { committedMinor: 0, activeCommitments: 0, completedCommitments: 0, countries: 0, criticalCompanies: 0, imminentLitigation: 0 };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  const regions = useMemo(() => {
    const map = new Map<string, string>();
    companies.forEach((company) => map.set(company.countryCode, company.country));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [companies]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = companies.filter((company) => {
      if (severity !== "ALL" && company.severity !== severity) return false;
      if (status !== "ALL" && company.status !== status) return false;
      if (region !== "ALL" && company.countryCode !== region) return false;
      if (normalized && !`${company.name} ${company.country} ${company.city || ""} ${company.sectors.join(" ")} ${company.problem}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "severity") return SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank || a.name.localeCompare(b.name);
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "founded-desc") return (b.foundedYear || 0) - (a.foundedYear || 0);
      if (sort === "capital") return (Number(b.capitalAskMinor || 0)) - (Number(a.capitalAskMinor || 0));
      return 0;
    });
    return sorted;
  }, [companies, query, severity, status, region, sort]);

  const criticalCount = companies.filter((company) => company.severity === "CRITICAL").length;
  const countryCount = new Set(companies.map((company) => company.country)).size;
  const urgent = useMemo(
    () => companies.filter((company) => company.countdown).slice().sort((a, b) => SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank).slice(0, 12),
    [companies],
  );

  const openCommit = (company: CooperateDeptCompany) => {
    setSelected(company);
    setMessage("");
    setBasis("SHARES");
    setAmount(Math.min(available, Math.max(company.capitalAskMinor || 0, 100_000)));
  };

  const submitCommit = () => {
    if (!selected) return;
    if (amount <= 0) { setMessage("Enter a commitment amount above zero."); return; }
    if (amount > available) { setMessage(`Insufficient available USD balance. You have ${fmtMinor(available)}.`); return; }
    commit.mutate({ companyId: selected.id, amountMinor: Math.round(amount), ownershipBasis: basis, idempotencyKey: crypto.randomUUID() });
  };

  const sources = usingFallback ? (fallback?.sources || []) : (market.data?.sources || []);
  const fetchedAt = usingFallback ? fallback?.fetchedAt : market.data?.fetchedAt;
  const degraded = usingFallback ? !!fallback?.degraded : !!market.data?.degraded;

  return <div className="arb-page portal-page cd-page">
    <section className="cd-hero" aria-label="Cooperate Dept desk">
      <div className="cd-hero-grid" aria-hidden="true" />
      <div className="cd-hero-top">
        <div className="cd-hero-badge"><Siren size={15}/> COOPERATE DEPT · DISTRESS & ACQUISITION</div>
        <div className="cd-hero-sources">
          <span className={`cd-source-chip${degraded ? " is-degraded" : ""}`}><span className="pulse"/> {degraded ? "Some registers degraded" : usingFallback ? "Live data (browser fallback)" : "Live register data"}</span>
          <button type="button" className="cd-refresh" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh company data"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>
      <div className="cd-hero-body">
        <div className="cd-hero-copy">
          <span className="eyebrow">Buy them, save them, own them</span>
          <h1>Distressed companies that need investors.</h1>
          <p>Companies under the department that need capital to be acquired, recapitalised or rescued — from brand-new start-ups to established firms in insolvency. Every record is pulled from a free public register around the world, or published by the desk administrator, and each figure is tagged with its source and the date it was seen.</p>
          <div className="cd-hero-actions">
            <button className="primary-button" onClick={() => document.getElementById("cd-catalogue")?.scrollIntoView({ behavior: "smooth" })}>Review companies <ArrowUpRight size={14}/></button>
            <button className="secondary-button" onClick={() => document.getElementById("cd-education")?.scrollIntoView({ behavior: "smooth" })}><CircleHelp size={14}/> How the desk works</button>
          </div>
          <div className="cd-hero-alert"><AlertTriangle size={15}/> <span><strong>Red means act soon.</strong> A red card is a company already in, or heading for, insolvency or litigation. Countdowns run only from real dated events.</span></div>
        </div>
        <div className="cd-hero-stats">
          <div className="cd-stat"><span>Companies listed</span><strong>{companies.length}</strong><small>{countryCount} countries</small></div>
          <div className="cd-stat"><span>Critical (red)</span><strong className="is-critical">{criticalCount}</strong><small>bankruptcy / Chapter 11</small></div>
          <div className="cd-stat"><span>Your committed</span><strong>{fmtMinor(summary.committedMinor)}</strong><small>{summary.activeCommitments} active commitments</small></div>
          <div className="cd-stat"><span>Litigation within 90d</span><strong className={summary.imminentLitigation ? "is-critical" : ""}>{summary.imminentLitigation}</strong><small>dated events</small></div>
        </div>
      </div>
      <div className="cd-ticker" aria-label="Most urgent companies ticker">
        <div className="cd-ticker-track">
          {urgent.map((company) => <span className="cd-ticker-item" key={company.id}><b>{SEVERITY_META[company.severity].label.toUpperCase()}</b> {company.flag} {company.name}{company.countdown ? ` · ${company.countdown.direction === "until" ? "due" : "since"} ${formatDate(company.countdown.targetDate)}` : ""}</span>)}
          {!urgent.length && <span className="cd-ticker-item">{market.isLoading ? "Loading live company registers…" : "Live company data unavailable"}</span>}
        </div>
      </div>
    </section>

    {sources.length > 0 && <div className="cd-source-strip">
      <span className="cd-source-strip-label"><Globe2 size={13}/> Data sources ({sources.length})</span>
      {sources.map((source: any) => <span className={`cd-source-pill${source.status === "ok" ? " is-ok" : " is-down"}`} key={source.name} title={source.detail || source.url}>{source.status === "ok" ? <Check size={12}/> : <AlertTriangle size={12}/>} {source.name}</span>)}
    </div>}

    {market.isError && !usingFallback && <div className="cd-alert cd-alert-error" role="status">
      <AlertTriangle size={16}/>
      <div className="cd-alert-body"><strong>The desk could not reach the account service.</strong><p>{market.error?.message || "Live company data could not be loaded."} Contacting the official registers directly…</p></div>
      <button type="button" className="secondary-button" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {usingFallback && <div className="cd-alert cd-alert-info" role="status">
      <Globe2 size={16}/>
      <div className="cd-alert-body"><strong>Live companies loaded directly from the public registers.</strong><p>The account service could not reach the data providers, so the catalogue was fetched securely in your browser. Commitments resume automatically when the service reconnects.</p></div>
      <button type="button" className="secondary-button" onClick={() => market.refetch()}>Reconnect</button>
    </div>}

    {!market.isLoading && !market.isError && !usingFallback && !companies.length && fallbackError && <div className="cd-alert cd-alert-warn" role="status">
      <AlertTriangle size={16}/>
      <div className="cd-alert-body"><strong>Live company data is temporarily unavailable.</strong><p>{fallbackError}</p></div>
      <button type="button" className="secondary-button" onClick={() => { setFallbackError(""); market.refetch(); }}>Retry</button>
    </div>}

    {storeWarning && <div className="cd-alert cd-alert-warn" role="status"><AlertTriangle size={16}/><div className="cd-alert-body"><p>{storeWarning}</p></div></div>}

    <section id="cd-catalogue" className="cd-catalogue" aria-label="Company catalogue">
      <div className="cd-catalogue-head">
        <div><span className="eyebrow">Live catalogue</span><h2>Companies seeking investors</h2><p>Every card shows the distress level, the dated event driving the countdown, the current financial status and what an investor could take. Net worth is explained, never invented.</p></div>
      </div>

      <div className="cd-toolbar">
        <div className="cd-search"><Filter size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies, sectors, cities or problems" aria-label="Search companies" /></div>
        <div className="cd-filter"><Siren size={14}/><select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity"><option value="ALL">All severities</option>{(["CRITICAL","HIGH","ELEVATED","WATCH"] as DistressSeverity[]).map((id) => <option key={id} value={id}>{SEVERITY_META[id].label}</option>)}</select></div>
        <div className="cd-filter"><Scale size={14}/><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="ALL">All statuses</option>{Object.keys(STATUS_LABELS).map((id) => <option key={id} value={id}>{STATUS_LABELS[id]}</option>)}</select></div>
        <div className="cd-filter"><Globe2 size={14}/><select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Filter by country"><option value="ALL">All countries</option>{regions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
        <div className="cd-filter"><TrendingUp size={14}/><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort companies"><option value="severity">Most severe first</option><option value="name">Name A–Z</option><option value="founded-desc">Newest founded</option><option value="capital">Largest capital ask</option></select></div>
      </div>

      {(market.isLoading || contactingSources) && !companies.length && <div className="cd-grid">{Array.from({ length: 6 }).map((_, index) => <div className="cd-card cd-card-skeleton" key={index}>Loading live company…</div>)}</div>}
      {companies.length > 0 && !filtered.length && <div className="cd-empty-inline"><CircleHelp size={15}/> No companies match the current filters. Try clearing the search or widening the filters.</div>}

      <div className="cd-grid">
        {filtered.map((company) => <article className={`cd-card sev-${company.severity.toLowerCase()}`} key={company.id}>
          <div className="cd-card-top">
            <span className="cd-card-flag" aria-hidden="true">{company.flag}</span>
            <div className="cd-card-title">
              <strong>{company.name}</strong>
              <span>{company.city ? `${company.city}${company.state ? `, ${company.state}` : ""} · ` : ""}{company.country} · {STATUS_LABELS[company.status] || company.status}</span>
            </div>
            <span className={`cd-sev-badge ${SEVERITY_META[company.severity].className}`}>{SEVERITY_META[company.severity].label}</span>
          </div>

          {company.countdown && <CountdownBlock countdown={company.countdown} />}

          <div className="cd-metrics">
            <div className="cd-metric"><span>Financial status</span><b className={company.severity === "CRITICAL" ? "neg" : ""}>{company.financialStatus}</b></div>
            <div className="cd-metric"><span>Founded</span><b>{foundedLabel(company)}</b></div>
            <div className="cd-metric"><span>Company type</span><b>{company.companyType}</b></div>
            <div className="cd-metric"><span>Staff</span><b>{company.staffCount !== null && company.staffCount !== undefined ? company.staffCount.toLocaleString() : company.staffRange || "—"}</b></div>
            <div className="cd-metric"><span>Regulator</span><b>{company.regulator || "—"}</b></div>
            <div className="cd-metric"><span>Capital sought</span><b>{company.capitalAskMinor ? fmtMinor(company.capitalAskMinor) : "On request"}</b></div>
          </div>

          <p className="cd-problem">{company.problem}</p>

          <div className="cd-tags">
            <span className="cd-tag"><Building2 size={11}/> {company.ownershipOpportunity}</span>
            {company.sectors.slice(0, 3).map((sector) => <span className="cd-tag" key={sector}>{sector}</span>)}
            {company.founderNames.length > 0 && <span className="cd-tag"><UserRound size={11}/> {company.founderNames[0]}{company.founderNames.length > 1 ? ` +${company.founderNames.length - 1}` : ""}</span>}
          </div>

          <div className="cd-card-foot">
            <span className="cd-card-asof" title={company.sourceUrl || company.source}><MapPin size={11}/> {company.asOf} · {company.source}{company.verified ? " · desk-verified" : ""}</span>
            <button className="cd-buy" onClick={() => openCommit(company)}>Review &amp; commit <ChevronRight size={14}/></button>
          </div>
        </article>)}
      </div>
    </section>

    <section className="cd-panel" aria-label="Your commitments">
      <div className="cd-panel-head"><div><span className="eyebrow">Your commitments</span><h3>Reserved interests</h3></div><span className="cd-tag"><Wallet size={12}/> Settled in USD</span></div>
      {positions.length === 0 && <div className="cd-empty-inline">No commitments yet. Review a company and reserve an interest to start — the desk administrator follows up on due diligence.</div>}
      {positions.length > 0 && <div className="cd-positions-table">
        <div className="cd-positions-row cd-positions-head"><span>Position</span><span>Company</span><span>Basis</span><span>Amount</span><span>Opened</span><span>Status</span></div>
        {positions.map((position: any) => <div className="cd-positions-row" key={position.id}>
          <span className="cd-mono">{position.positionCode}</span>
          <span>{position.companyName}</span>
          <span>{OWNERSHIP_OPTIONS.find((option) => option.id === position.ownershipBasis)?.label || position.ownershipBasis}</span>
          <span>{fmtMinor(Number(position.amountMinor))}</span>
          <span>{formatDate(position.openedAt)}</span>
          <span className="cd-tag">{position.status}</span>
        </div>)}
      </div>}
    </section>

    <div id="cd-education"><EducationSection /></div>

    <div className="cd-disclaimer"><ShieldCheck size={15}/><span>Company records are compiled from free public registers (Brønnøysund Register Centre, recherche-entreprises.api.gouv.fr, SEC EDGAR, GLEIF, Companies House and CourtListener) plus administrator-published entries, enriched with Wikidata, World Bank and Eurostat context. Distress signals and countdowns are derived only from real dated events and are not predictions. No free source publishes a private company's net worth — request audited accounts before committing. Commitments are recorded as internal-ledger positions in your USD wallet; no external transfer occurs on this desk.</span></div>

    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
      <div className="op-modal cd-commit-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close"><X size={18}/></button>
        <div className="modal-kicker"><Siren size={13}/> REVIEW &amp; COMMIT</div>
        <h2>{selected.flag} {selected.name}</h2>
        <p className="cd-modal-sub">{selected.legalName && selected.legalName !== selected.name ? `${selected.legalName} · ` : ""}{selected.city ? `${selected.city}, ` : ""}{selected.country} · {STATUS_LABELS[selected.status] || selected.status} · {SEVERITY_META[selected.severity].label} distress</p>

        {selected.countdown && <CountdownBlock countdown={selected.countdown} />}

        <div className="cd-modal-grid">
          <div><span>Financial status</span><strong>{selected.financialStatus}</strong></div>
          <div><span>Founded</span><strong>{foundedLabel(selected)}</strong></div>
          <div><span>Company type</span><strong>{selected.companyType}</strong></div>
          <div><span>Staff</span><strong>{selected.staffCount !== null && selected.staffCount !== undefined ? selected.staffCount.toLocaleString() : selected.staffRange || "—"}</strong></div>
          <div><span>Regulator</span><strong>{selected.regulator || "—"}</strong></div>
          <div><span>Regulator status</span><strong>{selected.regulatorStatus || "—"}</strong></div>
          <div><span>Sectors</span><strong>{selected.sectors.length ? selected.sectors.join(", ") : "—"}</strong></div>
          <div><span>Capital sought</span><strong>{selected.capitalAskMinor ? fmtMinor(selected.capitalAskMinor) : "On request"}</strong></div>
        </div>

        {(selected.founderNames.length > 0 || selected.keyPeople.length > 0) && <div className="cd-modal-grid">
          <div><span>Founders</span><strong>{selected.founderNames.length ? selected.founderNames.join(", ") : "Not published"}</strong></div>
          <div><span>Key people</span><strong>{selected.keyPeople.length ? selected.keyPeople.join(", ") : "Not published"}</strong></div>
        </div>}

        <p className="cd-note"><Factory size={12}/> {selected.problem}</p>
        <div className="cd-networth"><Landmark size={12}/> {selected.netWorthNote}</div>

        {selected.highlights.length > 0 && <div className="cd-tags" style={{ marginTop: 10 }}>{selected.highlights.map((item) => <span className="cd-tag" key={item}>{item}</span>)}</div>}

        <div style={{ marginTop: 14 }}>
          <span className="eyebrow">What would you take?</span>
          <div className="cd-basis-options">
            {OWNERSHIP_OPTIONS.map((option) => <button type="button" key={option.id} className={`cd-basis-option${basis === option.id ? " is-on" : ""}`} aria-pressed={basis === option.id} onClick={() => setBasis(option.id)}>{option.label}</button>)}
          </div>
        </div>

        <div className="amount-field"><label>Commitment amount (USD)</label><div><span>$</span><input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))}/></div><small>Available wallet: {fmtMinor(available)} · the amount is locked as a commitment in the ledger.</small></div>

        {message && <div className="auth-error"><CircleHelp size={14}/>{message}</div>}
        <div className="modal-footnote"><ShieldCheck size={14}/> Confirmation debits your USD wallet through the existing ledger, locks the amount and creates a durable commitment position. Duplicate requests are idempotent. The desk administrator will contact you to progress due diligence.</div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setSelected(null)}>Cancel</button><button className="primary-button" disabled={commit.isPending} onClick={submitCommit}>{commit.isPending ? "Reserving interest…" : "Confirm commitment"} <Check size={14}/></button></div>
      </div>
    </div>}

    <div className="cd-utility">
      <div className="cd-utility-item"><Wallet size={14}/> Settlement wallet: <strong>USD</strong> · available {fmtMinor(available)}</div>
      <div className="cd-utility-item"><Users size={14}/> {companies.length} companies · {positions.length} your commitments</div>
      <div className="cd-utility-item"><Siren size={14}/> {criticalCount} at critical (red) distress</div>
      <div className="cd-utility-item"><Globe2 size={14}/> {sources.length} data sources worldwide</div>
    </div>
  </div>;
}
