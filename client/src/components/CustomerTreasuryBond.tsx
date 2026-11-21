import { useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, ArrowUpRight, BarChart3, BookOpen, Calculator, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock, Coins, Filter, Globe2, Info, Landmark, Percent, PieChart, RefreshCw, Scale,
  Search, ShieldCheck, Sparkles, Star, TrendingUp, Wallet, X,
} from "lucide-react";
import { getTreasuryBondCatalogue, type TreasuryBondInstrument } from "@shared/treasury-bond-catalogue";
import "./treasury-bond.css";

// The desk renders the shared catalogue instrument shape verbatim; aliasing keeps
// the component's local naming while guaranteeing the browser fallback and the
// server response can never drift apart.
type TreasuryInstrument = TreasuryBondInstrument;

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_STORAGE_KEY = "arbitrade_treasury_bond_watchlist";

const CATEGORY_LABELS: Record<string, string> = {
  ALL: "All", BILL: "Bills", NOTE: "Notes", BOND: "Bonds", TIPS: "Inflation-linked", FRN: "Floating rate",
  BENCHMARK: "Benchmarks", SOVEREIGN: "Sovereign",
};
const TENOR_BUCKETS: { id: string; label: string; test: (years: number) => boolean }[] = [
  { id: "ALL", label: "Any tenor", test: () => true },
  { id: "SHORT", label: "Short · under 2y", test: (y) => y < 2 },
  { id: "MEDIUM", label: "Medium · 2–10y", test: (y) => y >= 2 && y <= 10 },
  { id: "LONG", label: "Long · over 10y", test: (y) => y > 10 },
];
const SORT_OPTIONS = [
  { id: "yield", label: "Highest interest" },
  { id: "lowest", label: "Lowest interest" },
  { id: "tenor-asc", label: "Shortest tenor" },
  { id: "tenor-desc", label: "Longest tenor" },
  { id: "minimum", label: "Lowest minimum" },
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

function fmtPct(value: number, digits = 3) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function useWatchlist() {
  const [ids, setIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
  }, [ids]);
  const has = (id: string) => ids.includes(id);
  const toggle = (id: string) => setIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  return { ids, has, toggle };
}

function Sparkline({ points, tone = "mint" }: { points: { t: string; v: number }[]; tone?: string }) {
  if (!points || points.length < 2) return <div className="tb-spark tb-spark-empty">Not enough history</div>;
  const width = 220, height = 54, pad = 4;
  const values = points.map((p) => p.v);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = height - pad - ((p.v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return <svg className={`tb-spark tb-spark-${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    <polyline points={`${pad},${height - pad} ${coords.join(" ")} ${width - pad},${height - pad}`} className="tb-spark-area" />
    <polyline points={coords.join(" ")} className="tb-spark-line" />
  </svg>;
}

function YieldCurveChart({ instruments }: { instruments: TreasuryInstrument[] }) {
  const curve = instruments.filter((i) => i.category === "BENCHMARK").slice().sort((a, b) => a.tenorYears - b.tenorYears);
  if (curve.length < 2) return null;
  const maxRate = Math.max(...curve.map((i) => i.couponRatePct)) * 1.12;
  return <div className="tb-curve">
    <div className="tb-curve-head"><div><span className="eyebrow">Live euro area AAA benchmark curve</span><h3>Euro area risk-free yield curve</h3></div><span className="tb-curve-source"><Globe2 size={13}/> ECB Data Portal</span></div>
    <div className="tb-curve-plot" role="img" aria-label="Euro area benchmark government bond yield curve by maturity">
      {curve.map((point) => {
        const pct = Math.max(4, Math.round((point.couponRatePct / maxRate) * 100));
        return <div className="tb-curve-bar" key={point.id} title={`${point.tenorLabel}: ${fmtPct(point.couponRatePct)}`}>
          <span className="tb-curve-value">{fmtPct(point.couponRatePct, 2)}</span>
          <div className="tb-curve-column"><i style={{ height: `${pct}%` }} /></div>
          <span className="tb-curve-label">{point.tenorLabel.replace(" ", "")}</span>
        </div>;
      })}
    </div>
  </div>;
}

function ProfitCalculator({ ratePct, years, minMinor, currency }: { ratePct: number; years: number; minMinor: number; currency: string }) {
  const [amount, setAmount] = useState(Math.max(minMinor, 100_000));
  const safeAmount = Math.max(minMinor, Math.round(amount || 0));
  const profit = Math.floor((safeAmount * Math.max(0, ratePct) * Math.max(0, years)) / 100);
  return <div className="tb-calculator">
    <div className="tb-calculator-head"><Calculator size={15}/><strong>Profit calculator</strong></div>
    <label className="tb-calculator-input">Investment amount
      <input type="number" min={minMinor} step="1000" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
    </label>
    <div className="tb-calculator-row"><div><span>Interest rate</span><strong>{fmtPct(ratePct)} <small>p.a.</small></strong></div><div><span>Tenor</span><strong>{years >= 1 ? `${years} yr` : `${Math.round(years * 12)} mo`}</strong></div></div>
    <div className="tb-calculator-row"><div><span>Interest to earn</span><strong className="tb-positive">{fmtMinor(profit, currency)}</strong></div><div><span>Value at maturity</span><strong>{fmtMinor(safeAmount + profit, currency)}</strong></div></div>
    <small className="tb-calculator-note"><Info size={12}/> Simple-interest illustration based on the published rate held to maturity. Not a guarantee of return.</small>
  </div>;
}

function EducationSection() {
  const [open, setOpen] = useState<string | null>("what");
  const items: { id: string; q: string; a: ReactNode }[] = [
    {
      id: "what",
      q: "What is a treasury bond?",
      a: <><p>A treasury bond is a debt security issued by a national government to raise money. When you buy one, you effectively lend the government a fixed amount of capital for an agreed term. In return the government pays you interest (a “coupon”) at a stated rate, and repays the original amount (the “face value”) when the bond matures.</p><p>Treasury departments issue a family of instruments that differ mainly by maturity:</p><ul><li><strong>Bills</strong> — very short-dated (weeks to one year), sold at a discount and redeemed at face value.</li><li><strong>Notes</strong> — medium-dated (2–10 years) paying a fixed semi-annual coupon.</li><li><strong>Bonds</strong> — long-dated (20–30 years), the classic “long bond”.</li><li><strong>Inflation-linked (TIPS)</strong> — principal and interest adjust with an official inflation index.</li><li><strong>Floating-rate notes</strong> — the coupon resets with short-term reference rates.</li><li><strong>Sovereign bonds</strong> — the same idea issued by other national governments, in their own currency.</li></ul></>,
    },
    {
      id: "riskfree",
      q: "Why are treasury bonds called a “risk-free” investment?",
      a: <><p>Treasury bonds are described as risk-free because they are backed by the <strong>full faith and credit</strong> of the issuing sovereign government. A government has unique powers — above all the ability to tax and, for debt in its own currency, to raise revenue — that make default on local-currency obligations extremely unlikely. For that reason the treasury yield in each market is used as the <strong>“risk-free rate”</strong>, the benchmark against which every other investment is measured.</p><p>It is important to be precise about what “risk-free” means:</p><ul><li>It refers to <strong>credit (default) risk</strong>, and holds when the bond is held to maturity.</li><li>It does <strong>not</strong> remove other risks: <strong>inflation</strong> can erode real returns, <strong>interest-rate</strong> moves change the market price before maturity, <strong>liquidity</strong> and <strong>reinvestment</strong> risks still apply, and foreign sovereign bonds carry <strong>currency (FX)</strong> risk.</li><li>It is a relative statement — a government’s credit quality can be downgraded, and not every government carries the same rating.</li></ul><p>In short: treasuries are the lowest-credit-risk fixed-income instrument in their market, not a promise of profit.</p></>,
    },
    {
      id: "yield",
      q: "How do interest, yield and price relate?",
      a: <><p>The <strong>coupon</strong> is the fixed interest rate printed on the bond. The <strong>yield</strong> is the return you actually earn given the price you pay. When bond prices fall, yields rise, and vice-versa. Bills are quoted as a discount from face value rather than a coupon, but the same principle applies. The figures on this desk are the published benchmark rates and average interest rates from the issuing authorities and central-bank data portals.</p></>,
    },
    {
      id: "ladder",
      q: "What is a bond ladder?",
      a: <><p>A ladder spreads your capital across several maturities — for example 1, 2, 5 and 10 years — instead of a single term. As each rung matures you reinvest it at the then-current rate, which smooths the effect of interest-rate cycles and keeps regular liquidity available. The portfolio insights panel on this page shows the maturity profile of your own holdings so you can see the shape of your ladder.</p></>,
    },
    {
      id: "use",
      q: "How do I purchase on this desk?",
      a: <><p>Choose any instrument, open it, enter the amount you want to invest (at least the published minimum), review the interest to earn and the value at maturity, then confirm. The purchase debits your USD wallet through the platform’s internal ledger, locks the principal, and records a durable position with the published rate, source and observation date captured at the moment of purchase.</p></>,
    },
  ];
  return <section className="tb-education" aria-label="Treasury bond education">
    <div className="tb-education-head"><div><span className="eyebrow">Understand before you invest</span><h2>Treasury bonds, explained</h2><p>What they are, why they anchor the world’s “risk-free” rate, and the risks that remain.</p></div><span className="tb-education-mark"><BookOpen size={20}/></span></div>
    <div className="tb-faq">
      {items.map((item) => <div className={`tb-faq-item${open === item.id ? " is-open" : ""}`} key={item.id}>
        <button type="button" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
          <span>{item.q}</span>{open === item.id ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        </button>
        {open === item.id && <div className="tb-faq-answer">{item.a}</div>}
      </div>)}
    </div>
  </section>;
}

export function CustomerTreasuryBond({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.treasuryBonds.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();
  const watchlist = useWatchlist();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [region, setRegion] = useState("ALL");
  const [tenor, setTenor] = useState("ALL");
  const [sort, setSort] = useState("yield");
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [selected, setSelected] = useState<TreasuryInstrument | null>(null);
  const [amount, setAmount] = useState(0);
  const [message, setMessage] = useState("");
  const [trendId, setTrendId] = useState<string>("");

  const purchase = trpc.customer.treasuryBonds.purchase.useMutation({
    onSuccess: (result: any) => {
      setSelected(null);
      setAmount(0);
      void utils.customer.treasuryBonds.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.treasuryBonds.market.refetch();
      push(`+ Treasury bond purchased · ${result.instrumentName} principal reserved through the wallet ledger`);
    },
    onError: (error) => setMessage(error.message),
  });

  const serverInstruments = useMemo(() => (market.data?.instruments || []) as TreasuryInstrument[], [market.data]);
  const hasServerInstruments = serverInstruments.length > 0;

  // Resilience fallback: both public data sources are CORS-enabled, so if the
  // account service (or its network egress) cannot reach them, the desk fetches
  // the exact same verified catalogue directly in the customer's browser. No
  // data is ever fabricated — a failed fetch stays a visible, retryable state.
  const [fallback, setFallback] = useState<{ instruments: TreasuryInstrument[]; sources: any[]; fetchedAt: string; degraded: boolean } | null>(null);
  const [fallbackError, setFallbackError] = useState("");

  useEffect(() => {
    if (market.isLoading || market.isFetching || hasServerInstruments) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getTreasuryBondCatalogue();
        if (cancelled) return;
        if (catalogue.instruments.length) {
          setFallback({ instruments: catalogue.instruments as TreasuryInstrument[], sources: catalogue.sources, fetchedAt: catalogue.fetchedAt, degraded: catalogue.degraded });
          setFallbackError("");
        } else {
          setFallbackError("The public data sources did not return any instruments.");
        }
      } catch (error) {
        if (!cancelled) setFallbackError(error instanceof Error ? error.message : "Live market data could not be loaded");
      }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, hasServerInstruments]);

  const usingFallback = !hasServerInstruments && !!fallback?.instruments.length;
  const instruments: TreasuryInstrument[] = hasServerInstruments ? serverInstruments : (fallback?.instruments || []);
  // True while the browser fallback is still contacting the public data sources.
  const contactingSources = !market.isLoading && !market.isError && !hasServerInstruments && !instruments.length && !usingFallback && !fallbackError;
  const positions: any[] = (market.data?.positions || []) as any[];
  const available = Number(market.data?.availableMinor || 0);
  const summary = market.data?.summary || { investedMinor: 0, expectedProfitMinor: 0, activePositions: 0, completedPositions: 0, countries: 0, averageRatePct: 0 };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  const regions = useMemo(() => {
    const map = new Map<string, string>();
    instruments.forEach((i) => map.set(i.countryCode, i.country));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [instruments]);

  // Feature: rate history trend chart over real published series.
  const trendCandidates = useMemo(() => instruments.filter((i) => i.history.length >= 3), [instruments]);
  const trendInstrument = trendCandidates.find((i) => i.id === trendId) || trendCandidates.find((i) => i.id === "us-treasury-notes") || trendCandidates[0];

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const bucket = TENOR_BUCKETS.find((t) => t.id === tenor) || TENOR_BUCKETS[0];
    const rows = instruments.filter((i) => {
      if (category !== "ALL" && i.category !== category) return false;
      if (region !== "ALL" && i.countryCode !== region) return false;
      if (!bucket.test(i.tenorYears)) return false;
      if (onlyWatch && !watchlist.ids.includes(i.id)) return false;
      if (normalized && !`${i.name} ${i.country} ${i.issuer} ${i.category} ${i.riskLabel}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "yield") return b.couponRatePct - a.couponRatePct;
      if (sort === "lowest") return a.couponRatePct - b.couponRatePct;
      if (sort === "tenor-asc") return a.tenorYears - b.tenorYears;
      if (sort === "tenor-desc") return b.tenorYears - a.tenorYears;
      if (sort === "minimum") return a.minInvestmentMinor - b.minInvestmentMinor;
      return 0;
    });
    return sorted;
  }, [instruments, query, category, region, tenor, sort, onlyWatch, watchlist.ids]);

  const bestYield = instruments.reduce((best, i) => (i.couponRatePct > best.couponRatePct ? i : best), instruments[0]);
  const averageYield = instruments.length ? instruments.reduce((sum, i) => sum + i.couponRatePct, 0) / instruments.length : 0;
  const countryCount = new Set(instruments.map((i) => i.country)).size;

  const compareRows = instruments.filter((i) => compare.includes(i.id));

  // Feature: portfolio insights — allocation across countries and tenors.
  const activePositions = positions.filter((p) => p.status === "ACTIVE");
  const byCountry = useMemo(() => {
    const map = new Map<string, number>();
    activePositions.forEach((p) => map.set(String(p.country || "Other"), (map.get(String(p.country || "Other")) || 0) + Number(p.principalMinor || 0)));
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(map.entries()).map(([label, value]) => ({ label, value, pct: Math.round((value / total) * 100) })).sort((a, b) => b.value - a.value);
  }, [activePositions]);
  const maturityLadder = useMemo(() => activePositions.slice().sort((a, b) => new Date(a.maturityAt).getTime() - new Date(b.maturityAt).getTime()), [activePositions]);

  const toggleCompare = (id: string) => setCompare((current) => current.includes(id) ? current.filter((x) => x !== id) : current.length < 3 ? [...current, id] : current);

  const openPurchase = (instrument: TreasuryInstrument) => {
    setSelected(instrument);
    setMessage("");
    setAmount(Math.max(instrument.minInvestmentMinor, Math.min(available, instrument.minInvestmentMinor * 2)));
  };

  const projectedProfit = selected ? Math.floor((Math.max(0, amount) * selected.couponRatePct * selected.tenorYears) / 100) : 0;

  const submitPurchase = () => {
    if (!selected) return;
    if (amount < selected.minInvestmentMinor) { setMessage(`Minimum purchase is ${fmtMinor(selected.minInvestmentMinor)}`); return; }
    if (amount > available) { setMessage(`Insufficient available USD balance. You have ${fmtMinor(available)}.`); return; }
    purchase.mutate({ instrumentId: selected.id, amountMinor: Math.round(amount), idempotencyKey: crypto.randomUUID() });
  };

  const sources = usingFallback ? (fallback?.sources || []) : (market.data?.sources || []);
  const fetchedAt = usingFallback ? fallback?.fetchedAt : market.data?.fetchedAt;
  const degraded = usingFallback ? !!fallback?.degraded : !!market.data?.degraded;

  return <div className="arb-page portal-page tb-page">
    <section className="tb-hero" aria-label="Treasury bond desk">
      <div className="tb-hero-grid" aria-hidden="true" />
      <div className="tb-hero-top">
        <div className="tb-hero-badge"><Landmark size={15}/> TREASURY BOND DESK</div>
        <div className="tb-hero-sources">
          <span className={`tb-source-chip${degraded ? " is-degraded" : ""}`}><span className="pulse"/> {degraded ? "Some feeds degraded" : usingFallback ? "Live data (browser fallback)" : "Live market data"}</span>
          <button type="button" className="tb-refresh" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh market data"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>
      <div className="tb-hero-body">
        <div className="tb-hero-copy">
          <h1>Treasury bonds, backed by sovereign governments.</h1>
          <p>Browse live US Treasury and international sovereign bond rates pulled directly from public data sources, review the interest, the amount required and the profit you could earn, and purchase in a few clicks — every position recorded through your wallet ledger.</p>
          <div className="tb-hero-actions">
            <button className="primary-button" onClick={() => document.getElementById("tb-catalogue")?.scrollIntoView({ behavior: "smooth" })}>Explore bonds <ArrowUpRight size={14}/></button>
            <button className="secondary-button" onClick={() => document.getElementById("tb-education")?.scrollIntoView({ behavior: "smooth" })}><BookOpen size={14}/> What is a treasury bond?</button>
          </div>
          <div className="tb-hero-riskfree"><ShieldCheck size={15}/> <span><strong>Considered the market’s “risk-free” rate</strong> — backed by the full faith and credit of the issuing government. Held to maturity, credit risk is treated as the lowest available.</span></div>
        </div>
        <div className="tb-hero-stats">
          <div className="tb-stat"><span>Live instruments</span><strong>{instruments.length}</strong><small>{countryCount} jurisdictions</small></div>
          <div className="tb-stat"><span>Best interest</span><strong>{bestYield ? fmtPct(bestYield.couponRatePct, 2) : "—"}</strong><small>{bestYield ? bestYield.country : "loading"}</small></div>
          <div className="tb-stat"><span>Average rate</span><strong>{instruments.length ? fmtPct(averageYield, 2) : "—"}</strong><small>across the desk</small></div>
          <div className="tb-stat"><span>Your invested</span><strong>{fmtMinor(summary.investedMinor)}</strong><small>{summary.activePositions} active positions</small></div>
        </div>
      </div>
      <div className="tb-ticker" aria-label="Live treasury rates ticker">
        <div className="tb-ticker-track">
          {(instruments.length ? instruments : []).slice(0, 18).map((i) => <span className="tb-ticker-item" key={i.id}><b>{instruments.length ? fmtPct(i.couponRatePct, 2) : ""}</b> {i.flag} {i.name.replace("Euro Area AAA Government Benchmark · ", "EU AAA ")}</span>)}
          {!instruments.length && <span className="tb-ticker-item">{market.isLoading ? "Loading live treasury rates…" : "Live rates unavailable"}</span>}
        </div>
      </div>
    </section>

    {sources.length > 0 && <div className="tb-source-strip">
      <span className="tb-source-strip-label"><BarChart3 size={13}/> Data sources</span>
      {sources.map((s: any) => <span className={`tb-source-pill${s.status === "ok" ? " is-ok" : " is-down"}`} key={s.name} title={s.detail || s.url}>{s.status === "ok" ? <Check size={12}/> : <AlertTriangle size={12}/>} {s.name}</span>)}
    </div>}

    {market.isError && !usingFallback && <div className="tb-alert tb-alert-error" role="status">
      <AlertTriangle size={16}/>
      <div className="tb-alert-body"><strong>The desk could not reach the account service.</strong><p>{market.error?.message || "Live market data could not be loaded."} Contacting the official data sources directly…</p></div>
      <button type="button" className="secondary-button" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {usingFallback && <div className="tb-alert tb-alert-info" role="status">
      <Globe2 size={16}/>
      <div className="tb-alert-body"><strong>Live rates loaded directly from the official data sources.</strong><p>The account service could not reach the market data feeds, so the catalogue was fetched securely in your browser (both sources allow it). Positions and purchases resume automatically when the service reconnects.</p></div>
      <button type="button" className="secondary-button" onClick={() => market.refetch()}>Reconnect</button>
    </div>}

    {!market.isLoading && !market.isError && !usingFallback && !instruments.length && fallbackError && <div className="tb-alert tb-alert-warn" role="status">
      <Info size={16}/>
      <div className="tb-alert-body"><strong>Live market data is temporarily unavailable.</strong><p>{fallbackError}</p></div>
      <button type="button" className="secondary-button" onClick={() => { setFallbackError(""); market.refetch(); }}>Retry</button>
    </div>}

    {storeWarning && <div className="tb-alert tb-alert-warn" role="status"><AlertTriangle size={16}/><div className="tb-alert-body"><p>{storeWarning}</p></div></div>}

    <div className="tb-charts">
      <YieldCurveChart instruments={instruments} />
      <div className="tb-trend">
        <div className="tb-trend-head">
          <div><span className="eyebrow">Published rate history</span><h3>Rate trend</h3></div>
          <select value={trendInstrument?.id || ""} onChange={(e) => setTrendId(e.target.value)} aria-label="Choose instrument for rate trend">
            {trendCandidates.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        {trendInstrument ? <>
          <div className="tb-trend-value"><strong>{fmtPct(trendInstrument.couponRatePct, 3)}</strong><span>as of {trendInstrument.asOf}</span></div>
          <Sparkline points={trendInstrument.history} tone={trendInstrument.category.toLowerCase()} />
          <small className="tb-trend-source">{trendInstrument.source} · {trendInstrument.history.length} observations</small>
        </> : <div className="tb-empty-inline">{market.isLoading ? "Loading rate history…" : "Rate history unavailable for the current catalogue."}</div>}
      </div>
    </div>

    <section id="tb-catalogue" className="tb-catalogue" aria-label="Treasury bond catalogue">
      <div className="tb-catalogue-head">
        <div><span className="eyebrow">Live catalogue</span><h2>Available treasury &amp; sovereign bonds</h2><p>Every rate is the latest published figure from its official source, with the amount required, the interest and the projected profit shown for each instrument.</p></div>
        <div className="tb-watch-toggle">
          <button type="button" className={onlyWatch ? "is-on" : ""} onClick={() => setOnlyWatch((v) => !v)} aria-pressed={onlyWatch}><Star size={14}/> Watchlist <b>{watchlist.ids.length}</b></button>
        </div>
      </div>

      <div className="tb-toolbar">
        <div className="tb-search"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bonds, issuers or countries" aria-label="Search treasury bonds" /></div>
        <div className="tb-filter"><Filter size={14}/><select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Filter by country"><option value="ALL">All countries</option>{regions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
        <div className="tb-filter"><Landmark size={14}/><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by instrument type">{Object.keys(CATEGORY_LABELS).map((id) => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}</select></div>
        <div className="tb-filter"><Clock size={14}/><select value={tenor} onChange={(e) => setTenor(e.target.value)} aria-label="Filter by tenor">{TENOR_BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
        <div className="tb-filter"><TrendingUp size={14}/><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort instruments">{SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
      </div>

      {compare.length > 0 && <div className="tb-compare-bar">
        <span><Scale size={14}/> {compare.length} selected for comparison</span>
        <div className="tb-compare-actions">
          <button className="secondary-button" onClick={() => setShowCompare(true)} disabled={compare.length < 2}>Compare</button>
          <button className="text-button" onClick={() => setCompare([])}>Clear</button>
        </div>
      </div>}

      {(market.isLoading || contactingSources) && !instruments.length && <div className="tb-grid">{Array.from({ length: 6 }).map((_, i) => <div className="tb-card tb-card-skeleton" key={i}><div className="tb-card-loading">Loading live instrument…</div></div>)}</div>}
      {instruments.length > 0 && !filtered.length && <div className="tb-empty-inline"><Info size={15}/> No instruments match the current filters. Try clearing the search or widening the filters.</div>}

      <div className="tb-grid">
        {filtered.map((instrument) => {
          const isWatched = watchlist.has(instrument.id);
          const inCompare = compare.includes(instrument.id);
          return <article className={`tb-card tb-cat-${instrument.category.toLowerCase()}`} key={instrument.id}>
            <div className="tb-card-top">
              <span className="tb-card-flag" aria-hidden="true">{instrument.flag}</span>
              <div className="tb-card-title"><strong>{instrument.name}</strong><span>{instrument.country} · {instrument.issuer}</span></div>
              <div className="tb-card-actions">
                <button type="button" className={`tb-icon-btn${isWatched ? " is-on" : ""}`} onClick={() => watchlist.toggle(instrument.id)} aria-pressed={isWatched} aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}><Star size={15}/></button>
                <button type="button" className={`tb-icon-btn${inCompare ? " is-on" : ""}`} onClick={() => toggleCompare(instrument.id)} aria-pressed={inCompare} aria-label="Add to comparison"><Scale size={15}/></button>
              </div>
            </div>
            <div className="tb-card-rate">
              <div><span>Interest rate</span><strong>{fmtPct(instrument.couponRatePct, 3)}</strong><small>{instrument.couponFrequency}</small></div>
              <span className="tb-card-cat">{CATEGORY_LABELS[instrument.category] || instrument.category}</span>
            </div>
            <div className="tb-card-metrics">
              <div><span>Tenor</span><b>{instrument.tenorLabel}</b></div>
              <div><span>Amount required</span><b>{fmtMinor(instrument.minInvestmentMinor)}</b></div>
              <div><span>Profit on {fmtMinor(instrument.minInvestmentMinor)}</span><b className="tb-positive">{fmtMinor(Math.floor((instrument.minInvestmentMinor * instrument.couponRatePct * instrument.tenorYears) / 100))}</b></div>
              <div><span>Credit quality</span><b>{instrument.creditQuality}</b></div>
            </div>
            <p className="tb-card-summary">{instrument.summary}</p>
            <div className="tb-card-foot">
              <span className="tb-card-asof" title={instrument.sourceSeries}><Clock size={11}/> {instrument.asOf} · {instrument.source}</span>
              <button className="primary-button tb-buy" onClick={() => openPurchase(instrument)}>Purchase <ChevronRight size={14}/></button>
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className="tb-portfolio" aria-label="Your treasury bond portfolio">
      <div className="tb-portfolio-head"><div><span className="eyebrow">Your holdings</span><h2>Portfolio &amp; maturity ladder</h2><p>Positions you have purchased on this desk, with the interest locked, the expected profit and the maturity profile.</p></div><span className="tb-portfolio-chip"><PieChart size={14}/> {summary.activePositions} active</span></div>
      <div className="customer-metric-grid">
        <div><span>Invested principal</span><strong>{fmtMinor(summary.investedMinor)}</strong><b>Locked in the ledger</b></div>
        <div><span>Expected profit</span><strong className="tb-positive">{fmtMinor(summary.expectedProfitMinor)}</strong><b>At maturity (illustrative)</b></div>
        <div><span>Average rate</span><strong>{summary.averageRatePct ? fmtPct(summary.averageRatePct, 2) : "—"}</strong><b>Weighted by position</b></div>
        <div><span>Countries</span><strong>{summary.countries}</strong><b>Sovereign issuers</b></div>
      </div>

      <div className="tb-portfolio-columns">
        <div className="tb-panel">
          <div className="tb-panel-head"><div><span className="eyebrow">Allocation</span><h3>Exposure by country</h3></div><Globe2 size={16}/></div>
          {byCountry.length ? byCountry.map((row) => <div className="tb-alloc-row" key={row.label}>
            <div className="tb-alloc-label"><strong>{row.label}</strong><span>{fmtMinor(row.value)}</span></div>
            <div className="tb-alloc-bar"><i style={{ width: `${row.pct}%` }} /></div>
            <b>{row.pct}%</b>
          </div>) : <div className="tb-empty-inline">Allocation appears after your first purchase.</div>}
        </div>
        <div className="tb-panel">
          <div className="tb-panel-head"><div><span className="eyebrow">Ladder</span><h3>Maturity timeline</h3></div><Clock size={16}/></div>
          {maturityLadder.length ? <ol className="tb-ladder">{maturityLadder.map((p: any) => <li key={p.id}><span className="tb-ladder-dot" /><div><strong>{p.instrumentName}</strong><span>{fmtMinor(Number(p.principalMinor))} · matures {formatDate(p.maturityAt)}</span></div><em>+{fmtMinor(Number(p.expectedProfitMinor))}</em></li>)}</ol> : <div className="tb-empty-inline">Your maturity ladder will appear here once you hold a bond.</div>}
        </div>
      </div>

      {positions.length > 0 && <div className="tb-panel tb-positions">
        <div className="tb-panel-head"><div><span className="eyebrow">Positions</span><h3>Purchased bonds</h3></div><span>{positions.length} total</span></div>
        <div className="tb-position-table">
          <div className="tb-position-row tb-position-head"><span>Position</span><span>Instrument</span><span>Principal</span><span>Rate</span><span>Expected profit</span><span>Matures</span><span>Status</span></div>
          {positions.map((p: any) => <div className="tb-position-row" key={p.id}><span className="tb-mono">{p.positionCode}</span><span>{p.instrumentName}</span><span>{fmtMinor(Number(p.principalMinor))}</span><span>{(Number(p.couponRateBps) / 100).toFixed(3)}%</span><span className="tb-positive">{fmtMinor(Number(p.expectedProfitMinor))}</span><span>{formatDate(p.maturityAt)}</span><span className={`tb-status tb-status-${String(p.status).toLowerCase()}`}>{p.status}</span></div>)}
        </div>
      </div>}
    </section>

    <div id="tb-education"><EducationSection /></div>

    <div className="tb-disclaimer"><ShieldCheck size={15}/><span>Rates, prices and yields shown are published reference figures from official public data sources (U.S. Treasury Fiscal Data, the ECB Data Portal, Eurostat and the OECD) and are not offers to sell securities. Purchases on this desk are recorded as internal-ledger positions in your USD wallet. Projections use simple interest and are illustrations, not guarantees. “Risk-free” describes credit quality relative to other issuers and does not remove inflation, interest-rate, liquidity or currency risk.</span></div>

    {showCompare && compareRows.length >= 2 && <div className="modal-backdrop" onMouseDown={() => setShowCompare(false)}>
      <div className="op-modal tb-compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={() => setShowCompare(false)} aria-label="Close comparison"><X size={18}/></button>
        <div className="modal-kicker"><Scale size={13}/> SIDE-BY-SIDE COMPARISON</div>
        <h2>Compare treasury bonds</h2>
        <div className="tb-compare-grid" style={{ gridTemplateColumns: `minmax(140px,1fr) repeat(${compareRows.length}, minmax(120px,1fr))` }}>
          <div className="tb-compare-cell tb-compare-key">Instrument</div>
          {compareRows.map((i) => <div className="tb-compare-cell tb-compare-val" key={i.id}><span className="tb-card-flag">{i.flag}</span> {i.name}</div>)}
          <div className="tb-compare-cell tb-compare-key">Interest rate</div>
          {compareRows.map((i) => <div className="tb-compare-cell" key={i.id}>{fmtPct(i.couponRatePct, 3)}</div>)}
          <div className="tb-compare-cell tb-compare-key">Tenor</div>
          {compareRows.map((i) => <div className="tb-compare-cell" key={i.id}>{i.tenorLabel}</div>)}
          <div className="tb-compare-cell tb-compare-key">Amount required</div>
          {compareRows.map((i) => <div className="tb-compare-cell" key={i.id}>{fmtMinor(i.minInvestmentMinor)}</div>)}
          <div className="tb-compare-cell tb-compare-key">Profit on minimum</div>
          {compareRows.map((i) => <div className="tb-compare-cell tb-positive" key={i.id}>{fmtMinor(Math.floor((i.minInvestmentMinor * i.couponRatePct * i.tenorYears) / 100))}</div>)}
          <div className="tb-compare-cell tb-compare-key">Credit quality</div>
          {compareRows.map((i) => <div className="tb-compare-cell" key={i.id}>{i.creditQuality}</div>)}
          <div className="tb-compare-cell tb-compare-key">Source</div>
          {compareRows.map((i) => <div className="tb-compare-cell tb-compare-small" key={i.id}>{i.source}</div>)}
        </div>
        <div className="modal-footnote"><Info size={13}/> Illustrative simple-interest figures based on published rates.</div>
      </div>
    </div>}

    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
      <div className="op-modal tb-purchase-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close purchase"><X size={18}/></button>
        <div className="modal-kicker"><Landmark size={13}/> CONFIRM TREASURY BOND PURCHASE</div>
        <h2>{selected.flag} {selected.name}</h2>
        <p className="tb-modal-sub">{selected.country} · {selected.issuer} · rate {fmtPct(selected.couponRatePct, 3)} p.a. as of {selected.asOf}</p>
        <div className="tb-modal-grid">
          <div><span>Interest rate</span><strong>{fmtPct(selected.couponRatePct, 3)}</strong></div>
          <div><span>Tenor</span><strong>{selected.tenorLabel}</strong></div>
          <div><span>Amount required</span><strong>{fmtMinor(selected.minInvestmentMinor)}</strong></div>
          <div><span>Payment</span><strong>{selected.couponFrequency}</strong></div>
        </div>
        <div className="amount-field"><label>Purchase amount (USD)</label><div><span>$</span><input type="number" min={selected.minInvestmentMinor / 100} step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))}/></div><small>Available wallet: {fmtMinor(available)} · minimum {fmtMinor(selected.minInvestmentMinor)}</small></div>
        <div className="tb-modal-projection">
          <div><span>Principal</span><strong>{fmtMinor(Math.max(0, amount))}</strong></div>
          <div><span>Interest to earn</span><strong className="tb-positive">{fmtMinor(projectedProfit)}</strong></div>
          <div><span>Value at maturity</span><strong>{fmtMinor(Math.max(0, amount) + projectedProfit)}</strong></div>
        </div>
        <ProfitCalculator ratePct={selected.couponRatePct} years={selected.tenorYears} minMinor={selected.minInvestmentMinor} currency="USD" />
        {message && <div className="auth-error"><CircleHelp size={14}/>{message}</div>}
        <div className="modal-footnote"><ShieldCheck size={14}/> Confirmation debits your USD wallet through the existing ledger and creates a durable position. Duplicate requests are idempotent.</div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setSelected(null)}>Cancel</button><button className="primary-button" disabled={purchase.isPending} onClick={submitPurchase}>{purchase.isPending ? "Reserving principal…" : "Confirm purchase"} <Check size={14}/></button></div>
      </div>
    </div>}

    <div className="tb-utility"><div className="tb-utility-item"><Wallet size={14}/> Settlement wallet: <strong>USD</strong> · available {fmtMinor(available)}</div><div className="tb-utility-item"><Coins size={14}/> {instruments.length} instruments · {positions.length} your positions</div><div className="tb-utility-item"><Percent size={14}/> Average desk rate {instruments.length ? fmtPct(averageYield, 2) : "—"}</div><div className="tb-utility-item"><Sparkles size={14}/> Purchase, watchlist, compare, calculator &amp; ladder tools included</div></div>
  </div>;
}
