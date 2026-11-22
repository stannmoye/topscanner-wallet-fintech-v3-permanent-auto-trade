import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, BadgeCheck, CalendarClock, Check, CircleHelp, Coins, Compass,
  Download, Factory, Flame, Gauge, Layers3, Leaf, MapPin, Mountain, Recycle, RefreshCw,
  ShieldCheck, Sparkles, Sprout, Star, TrendingUp, Waves, Wind, X, Zap,
  type LucideIcon,
} from "lucide-react";
import {
  CARBON_CREDIT_TYPES,
  CARBON_DOSSIER_STATUSES,
  CARBON_REGION_CENTROIDS,
  CARBON_REGION_LIST,
  CARBON_SECTORS,
  CARBON_STANDARDS,
  CARBON_TERRITORY_BANDS,
  CARBON_TYPE_GROUPS,
  buildCarbonAnalytics,
  carbonCountryPoint,
  carbonOutcomeLabel,
  carbonRegionLabel,
  carbonRiskLabel,
  carbonSectorLabel,
  carbonStageLabel,
  carbonStandardLabel,
  carbonStatusLabel,
  carbonTerritoryBandLabel,
  carbonTypeBlurb,
  carbonTypeLabel,
  getCarbonInvestmentCatalogue,
  type CarbonCreditType,
  type CarbonInvestmentSource,
  type CarbonOpportunity,
  type CarbonRegion,
  type CarbonSector,
} from "@shared/carbon-credit-catalogue";
import "./carbon-credit.css";

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_KEY = "carbon-credit-watchlist";

const TYPE_ICON: Record<CarbonCreditType, LucideIcon> = {
  REFORESTATION: Sprout,
  FOREST_CONSERVATION: Leaf,
  SOIL_CARBON: Layers3,
  BLUE_CARBON: Waves,
  COOKSTOVES: Flame,
  BIOCHAR: Recycle,
  DIRECT_AIR_CAPTURE: Wind,
  BECCS: Factory,
  ENHANCED_WEATHERING: Mountain,
  OCEAN_ALKALINITY: Waves,
  RENEWABLE_ENERGY: Zap,
  METHANE_CAPTURE: Gauge,
  WASTE_MANAGEMENT: Recycle,
  INDUSTRIAL_EFFICIENCY: Factory,
};

/* ----------------------------- Atlas geometry -----------------------------
   The atlas is a self-contained equirectangular world: coarse continent
   silhouettes plus a graticule drawn from the shared centroids, with each
   opportunity plotted as a pin at its country coordinate (falling back to the
   region centroid). Nothing here is fetched — the map is derived from the same
   catalogue records the pin board lists, so a pin and its card always agree. */
type LonLat = [number, number];
const MAP_W = 1000;
const MAP_H = 500;
const project = (lon: number, lat: number) => ({ x: ((lon + 180) / 360) * MAP_W, y: ((90 - lat) / 180) * MAP_H });
const polyPath = (points: LonLat[]) => "M" + points.map(([lon, lat]) => { const p = project(lon, lat); return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(" L ") + " Z";

const CONTINENTS: LonLat[][] = [
  [[-168, 66], [-150, 70], [-125, 70], [-95, 72], [-75, 68], [-60, 58], [-52, 48], [-65, 45], [-70, 42], [-75, 35], [-81, 25], [-90, 29], [-97, 26], [-105, 22], [-115, 30], [-124, 40], [-124, 48], [-135, 58], [-155, 58]],
  [[-45, 60], [-20, 70], [-18, 82], [-45, 84], [-60, 78], [-55, 65]],
  [[-81, 8], [-70, 11], [-60, 10], [-50, 0], [-35, -6], [-38, -15], [-48, -25], [-58, -38], [-65, -45], [-70, -54], [-75, -50], [-72, -35], [-71, -20], [-75, -5], [-79, 2]],
  [[-17, 15], [-16, 22], [-10, 30], [0, 36], [10, 37], [11, 33], [20, 32], [32, 31], [35, 25], [43, 12], [51, 12], [48, 2], [41, -10], [40, -20], [35, -24], [32, -29], [25, -34], [18, -35], [12, -18], [9, -2], [2, 5], [-8, 5], [-13, 9]],
  [[-10, 36], [-9, 43], [-2, 48], [2, 51], [5, 58], [10, 58], [12, 55], [18, 58], [25, 60], [30, 60], [40, 60], [40, 48], [30, 45], [22, 40], [12, 38], [3, 42]],
  [[40, 48], [45, 42], [55, 40], [65, 38], [75, 32], [80, 22], [90, 22], [98, 12], [105, 10], [110, 20], [120, 32], [122, 40], [130, 43], [140, 45], [145, 50], [160, 60], [170, 62], [180, 66], [180, 70], [60, 72], [40, 68], [40, 60]],
  [[113, -22], [122, -17], [130, -12], [137, -12], [142, -11], [147, -19], [153, -25], [150, -37], [140, -38], [130, -32], [120, -34], [115, -34]],
];
const GRAT_LONS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
const GRAT_LATS = [-60, -30, 0, 30, 60];

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
const fmtPercent = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`);
const fmtMultiple = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 10_000).toFixed(2)}x`);
const fmtTonnes = (tonnes: number | null | undefined) => (tonnes === null || tonnes === undefined ? "—" : `${Number(tonnes).toLocaleString(undefined, { maximumFractionDigits: 0 })} tCO₂e`);
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
function loadWatchlist(): string[] {
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch { return []; }
}
type PurchaseTarget = { id: string; name: string; expectedMultipleBps: number | null };

/**
 * Carbon Credit desk — an ATLAS workspace.
 *
 * This is the desk's own structure and differs from every other vertical: a
 * region rail on the left, a map-style pin canvas in the middle where each pin
 * is one opportunity coloured by its verification status (VERIFIED for an
 * administrator-published instrument, REFERENCE for a cited public reference),
 * and a slide-out project dossier on the right. The pin board beneath lists the
 * same records as cards. Every listed opportunity is investable: commitments
 * settle in USD and may be funded from the settlement wallet, any single wallet,
 * or all wallets combined through live FX. Public sources (keyless Eurostat and
 * World Bank feeds) publish carbon context — emission, forest and renewable
 * statistics — but never deal economics, so the discovery layer is cited, not
 * synthesised, and the principal is held against the opportunity's milestones.
 */
export function CustomerCarbonCredit({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.carbonCredit.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"atlas" | "positions" | "analytics">("atlas");
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<"ALL" | CarbonRegion>("ALL");
  const [type, setType] = useState("ALL");
  const [standard, setStandard] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [territory, setTerritory] = useState("ALL");
  const [fundableOnly, setFundableOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sort, setSort] = useState("fundable");
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<PurchaseTarget | null>(null);
  const [fundingSource, setFundingSource] = useState("COMBINED");
  const [amount, setAmount] = useState(0);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteSeq = useRef(0);

  const purchase = trpc.customer.carbonCredit.purchase.useMutation({
    onSuccess: (result: any) => {
      setTarget(null);
      setAmount(0);
      setTab("positions");
      void utils.customer.carbonCredit.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.carbonCredit.market.refetch();
      push(`+ Carbon Credit recorded · ${result.instrumentName} (${result.positionCode})`);
    },
    onError: (error: { message: string }) => setMessage(error.message),
  });

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);

  const opportunities = useMemo(() => (market.data?.opportunities || []) as CarbonOpportunity[], [market.data]);
  const positions: any[] = (market.data?.positions || []) as any[];
  const wallets: WalletBalance[] = (market.data?.wallets || market.data?.balances || []) as WalletBalance[];
  const fundedWallets = wallets.filter((wallet) => Number(wallet.availableMinor || 0) > 0);
  const settlement = String(market.data?.settlementCurrency || "USD");
  const settlementWallet = wallets.find((wallet) => wallet.currency === settlement);
  const available = Number(settlementWallet?.availableMinor ?? market.data?.availableMinor ?? 0);
  const summary = market.data?.summary || {
    committedMinor: 0, activePositions: 0, settledPositions: 0, writtenOffPositions: 0,
    fundableOpportunities: 0, natureBased: 0, published: 0, realisedMinor: 0, distributedMinor: 0,
  };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  // The discovery layer cites the keyless public feeds but publishes no deal
  // economics; an administrator dossier supplies those. When the account
  // service is unreachable we still surface the cited sources directly from the
  // shared module so the desk explains itself; nothing is ever fabricated.
  const [fallbackSources, setFallbackSources] = useState<CarbonInvestmentSource[] | null>(null);
  useEffect(() => {
    if (market.isLoading || market.isFetching || market.data) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getCarbonInvestmentCatalogue();
        if (!cancelled) setFallbackSources(catalogue.sources);
      } catch { /* leave null; the error notice already explains the state */ }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, market.data]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = opportunities.filter((item) => {
      if (region !== "ALL" && item.region !== region) return false;
      if (type !== "ALL" && item.creditType !== type) return false;
      if (standard !== "ALL" && (item.standard ?? "UNVERIFIED") !== standard) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (sector !== "ALL" && item.sector !== sector) return false;
      if (territory !== "ALL" && item.territoryBand !== territory) return false;
      if (fundableOnly && !item.fundable) return false;
      if (watchlistOnly && !watchlist.includes(item.id)) return false;
      if (normalized && !`${item.title} ${item.operator} ${item.offtaker ?? ""} ${item.territory} ${item.country} ${item.description} ${carbonTypeLabel(item.creditType)} ${carbonSectorLabel(item.sector)} ${carbonRegionLabel(item.region)}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "fundable") return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0) || b.fundedBps - a.fundedBps || a.title.localeCompare(b.title);
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "deadline") return (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999);
      if (sort === "tonnage") return (b.creditVolumeTonnes || 0) - (a.creditVolumeTonnes || 0);
      if (sort === "price") return (b.pricePerTonneMinor || 0) - (a.pricePerTonneMinor || 0);
      if (sort === "multiple") return (b.expectedMultipleBps || 0) - (a.expectedMultipleBps || 0);
      if (sort === "type") return carbonTypeLabel(a.creditType).localeCompare(carbonTypeLabel(b.creditType)) || a.title.localeCompare(b.title);
      if (sort === "region") return carbonRegionLabel(a.region).localeCompare(carbonRegionLabel(b.region)) || a.title.localeCompare(b.title);
      return 0;
    });
    return sorted;
  }, [opportunities, query, region, type, standard, status, sector, territory, fundableOnly, watchlistOnly, watchlist, sort]);

  const regionCounts = useMemo(() => {
    const counts = new Map<CarbonRegion, number>();
    for (const item of opportunities) counts.set(item.region, (counts.get(item.region) ?? 0) + 1);
    return counts;
  }, [opportunities]);
  const maxRegionCount = Math.max(1, ...CARBON_REGION_LIST.map((value) => regionCounts.get(value) ?? 0));

  // Pins plotted at each opportunity's country coordinate. Multiple projects in
  // one country are fanned out slightly so every pin stays clickable.
  const pins = useMemo(() => {
    const seen = new Map<string, number>();
    return filtered.map((item) => {
      const [lon, lat] = carbonCountryPoint(item.countryCode);
      const index = seen.get(item.countryCode) ?? 0;
      seen.set(item.countryCode, index + 1);
      const angle = index * 0.9;
      const radius = index === 0 ? 0 : 6 + index * 1.5;
      const p = project(lon, lat);
      return {
        item,
        x: p.x + Math.cos(angle) * radius,
        y: p.y + Math.sin(angle) * radius,
        verified: item.verificationStatus === "VERIFIED",
      };
    });
  }, [filtered]);

  const selected = useMemo(() => opportunities.find((item) => item.id === selectedId) ?? null, [opportunities, selectedId]);
  const fundable = opportunities.filter((item) => item.fundable);
  const activeFilters = [region !== "ALL", type !== "ALL", standard !== "ALL", status !== "ALL", sector !== "ALL", territory !== "ALL", fundableOnly, watchlistOnly].filter(Boolean).length;
  const analytics = useMemo(() => buildCarbonAnalytics(opportunities), [opportunities]);
  const sources: CarbonInvestmentSource[] = (market.data?.sources as CarbonInvestmentSource[]) || fallbackSources || [];
  const fetchedAt = market.data?.fetchedAt;
  const degraded = !!market.data?.degraded;

  const toggleWatch = (id: string) => setWatchlist((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const clearFilters = () => { setRegion("ALL"); setType("ALL"); setStandard("ALL"); setStatus("ALL"); setSector("ALL"); setTerritory("ALL"); setFundableOnly(false); setWatchlistOnly(false); setQuery(""); };

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
        const result = await utils.customer.carbonCredit.fundingQuote.fetch({ amountMinor: Math.round(amount), fundingSource });
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
    purchase.mutate({ instrumentId: target.id, amountMinor: Math.round(amount), fundingSource, idempotencyKey: crypto.randomUUID() });
  };

  const exportCatalogue = () => downloadCsv(
    `carbon-credit-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Title", "Operator", "Type", "Sector", "Standard", "Verification", "Region", "Territory", "Territory band", "Country code", "Deal type", "Stage", "Status", "Risk grade", "Credit volume (tCO2e)", "Price per tonne (minor)", "Revenue share (bps)", "Expected multiple (bps)", "Expected duration (months)", "Projected revenue (minor)", "Capital at risk (minor)", "Funding target (minor)", "Committed (minor)", "Funded bps", "Minimum investment (minor)", "Unit price (minor)", "Validation date", "Funding deadline", "Remaining days", "Fundable", "Source", "Source URL", "As of"],
    filtered.map((item) => [
      item.title, item.operator, carbonTypeLabel(item.creditType), carbonSectorLabel(item.sector), item.standard ? carbonStandardLabel(item.standard) : "Not yet verified",
      item.verificationStatus, carbonRegionLabel(item.region), item.territory, item.territoryBand, item.countryCode, item.dealType ?? "",
      carbonStageLabel(item.stage), carbonStatusLabel(item.status), item.riskGrade ? carbonRiskLabel(item.riskGrade) : "",
      item.creditVolumeTonnes ?? "", item.pricePerTonneMinor ?? "", item.revenueSharesBps ?? "", item.expectedMultipleBps ?? "",
      item.expectedDurationMonths ?? "", item.projectedRevenueMinor ?? "", item.capitalAtRiskMinor ?? "", item.fundingAskMinor ?? "",
      item.committedMinor, item.fundedBps, item.minimumInvestmentMinor ?? "", item.unitPriceMinor ?? "", item.eventDate ?? "",
      item.fundingDeadline ?? "", item.remainingDays ?? "", item.fundable ? "Yes" : "No", item.source, item.sourceUrl ?? "", item.asOf,
    ]),
  );

  const exportPositions = () => downloadCsv(
    `carbon-credit-positions-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Position", "Instrument", "Type", "Standard", "Amount (minor)", "Currency", "Funding", "Units", "Status at buy", "Expected multiple (bps)", "Outcome", "Distributed (minor)", "Realised (minor)", "Opened", "Status"],
    positions.map((position) => [
      position.positionCode, position.instrumentName, position.creditType || "", position.standard || "",
      position.amountMinor, position.currency, position.fundingSource || "", position.units ?? "", position.statusAtPurchase || "",
      position.expectedMultipleBps ?? "", position.outcome || "", position.distributedMinor ?? "", position.realisedMinor ?? "",
      formatDate(position.openedAt), position.positionStatus,
    ]),
  );

  const renderPinCard = (item: CarbonOpportunity) => {
    const TypeIcon = TYPE_ICON[item.creditType];
    const verified = item.verificationStatus === "VERIFIED";
    const watched = watchlist.includes(item.id);
    return <button type="button" className={`cc-pin-card${selectedId === item.id ? " is-active" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
      <div className="cc-pin-card-top">
        <span className="cc-pin-glyph"><TypeIcon size={15}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{item.flag} {item.title}</h3>
          <div className="cc-pin-card-meta"><span>{item.operator}</span></div>
        </div>
        <span className="cc-star" role="presentation" onClick={(event) => { event.stopPropagation(); toggleWatch(item.id); }} aria-hidden="true"><Star size={15} className={watched ? "" : ""} fill={watched ? "currentColor" : "none"}/></span>
      </div>
      <div className="cc-dossier-tags">
        <span className={`cc-chip ${verified ? "cc-chip--verified" : "cc-chip--reference"}`}><BadgeCheck size={11}/> {verified ? "Verified" : "Reference"}</span>
        <span className="cc-chip cc-chip--type">{carbonTypeLabel(item.creditType)}</span>
        <span className="cc-chip cc-chip--standard">{item.standard ? carbonStandardLabel(item.standard) : "Unverified"}</span>
        <span className="cc-chip">{carbonRegionLabel(item.region)}</span>
      </div>
      <div className="cc-pin-card-meta">
        <span>Issuance <b>{fmtTonnes(item.creditVolumeTonnes)}</b></span>
        <span>Per tonne <b>{item.pricePerTonneMinor ? fmtMinor(item.pricePerTonneMinor) : "—"}</b></span>
        <span>Expected <b>{fmtMultiple(item.expectedMultipleBps)}</b></span>
      </div>
      {item.fundable && <div className="cc-progress">
        <div className="cc-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
        <div className="cc-progress-bar"><i style={{ width: `${Math.max(0, Math.min(100, Math.round(item.fundedBps / 100)))}%` }} /></div>
      </div>}
    </button>;
  };

  const renderDossier = (item: CarbonOpportunity) => {
    const TypeIcon = TYPE_ICON[item.creditType];
    const verified = item.verificationStatus === "VERIFIED";
    return <aside className="cc-dossier-drawer" aria-label="Project dossier">
      <div className="cc-dossier-head">
        <div>
          <div className="cc-eyebrow">{verified ? "Verified instrument" : "Cited reference"}</div>
          <h3>{item.flag} {item.title}</h3>
          <div className="cc-dossier-sub">{item.operator}{item.offtaker ? ` · ${item.offtaker}` : ""}</div>
        </div>
        <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={() => setSelectedId(null)} aria-label="Close dossier"><X size={15}/></button>
      </div>
      <div className="cc-dossier-tags">
        <span className={`cc-chip ${verified ? "cc-chip--verified" : "cc-chip--reference"}`}><BadgeCheck size={11}/> {verified ? "Verified" : "Reference"}</span>
        <span className="cc-chip cc-chip--type"><TypeIcon size={11}/> {carbonTypeLabel(item.creditType)}</span>
        <span className="cc-chip cc-chip--standard">{item.standard ? carbonStandardLabel(item.standard) : "Not yet verified"}</span>
        <span className={`cc-chip cc-chip--status-${String(item.status).toLowerCase()}`}>{carbonStatusLabel(item.status)}</span>
        {item.riskGrade && <span className={`cc-chip cc-chip--risk-${String(item.riskGrade).toLowerCase()}`}>{carbonRiskLabel(item.riskGrade)}</span>}
      </div>
      <div className="cc-dossier-stats">
        <div className="cc-dossier-stat"><span>Region</span><b>{carbonRegionLabel(item.region)}</b></div>
        <div className="cc-dossier-stat"><span>Territory</span><b>{item.territory}</b></div>
        <div className="cc-dossier-stat"><span>Expected issuance</span><b>{fmtTonnes(item.creditVolumeTonnes)}</b></div>
        <div className="cc-dossier-stat"><span>Price per tonne</span><b>{item.pricePerTonneMinor ? fmtMinor(item.pricePerTonneMinor) : "—"}</b></div>
        <div className="cc-dossier-stat"><span>Expected multiple</span><b>{fmtMultiple(item.expectedMultipleBps)}</b></div>
        <div className="cc-dossier-stat"><span>Stage</span><b>{carbonStageLabel(item.stage)}</b></div>
      </div>
      {item.fundable
        ? <div className="cc-progress">
            <div className="cc-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
            <div className="cc-progress-bar"><i style={{ width: `${Math.max(0, Math.min(100, Math.round(item.fundedBps / 100)))}%` }} /></div>
            <div className="cc-card-meta"><span><CalendarClock size={11}/> {daysLabel(item.remainingDays)}{item.fundingDeadline ? ` · closes ${formatDate(item.fundingDeadline)}` : ""}</span></div>
          </div>
        : <div className="cc-reference-note"><AlertTriangle size={13}/> Cited catalogue reference — the administrator has not yet published its funding economics, so it carries no funding target. You can still invest now; the position settles on the administrator-configured multiple.</div>}

      <div className="cc-dossier-block"><h4>Opportunity</h4><p>{item.description}</p></div>
      <div className="cc-dossier-block"><h4>Method</h4><p>{carbonTypeBlurb(item.creditType)}</p></div>
      {item.expectedMultipleBps !== null && <div className="cc-dossier-block"><h4>Participation</h4><p>{item.revenueSharesBps !== null && item.revenueSharesBps !== undefined ? `Investor share ${fmtPercent(item.revenueSharesBps)} of gross revenue. ` : ""}Expected {fmtMultiple(item.expectedMultipleBps)}{item.expectedDurationMonths ? ` over ${item.expectedDurationMonths} months` : ""}.</p></div>}
      <div className="cc-dossier-block"><h4>Source</h4><p title={item.sourceUrl || item.source}><ShieldCheck size={11}/> {item.asOf} · {item.source}</p></div>

      {item.scenarios.length > 0 && <div className="cc-scenarios">
        {item.scenarios.map((scenario, index) => <div className={`cc-scenario cc-scenario--${scenario.outcome.toLowerCase()}`} key={`${scenario.outcome}-${index}`}>
          <span className="cc-scenario-head">{scenario.label}</span>
          <span>{fmtPercent(scenario.probabilityBps)} · {fmtMinor(scenario.grossRevenueMinor)} gross · {scenario.durationMonths}mo · {fmtMultiple(scenario.funderMultipleBps)}</span>
        </div>)}
      </div>}
      {item.milestones.length > 0 && <div className="cc-dossier-block"><h4>Milestones &amp; escrow release</h4><div className="cc-milestone-track">{item.milestones.map((milestone, index) => <span className={`cc-milestone${milestone.status === "REACHED" ? " is-reached" : ""}`} key={`${milestone.stage}-${index}`}>{milestone.label} · {fmtPercent(milestone.releaseBps)}</span>)}</div></div>}
      {item.highlights.length > 0 && <div className="cc-dossier-tags">{item.highlights.slice(0, 5).map((value) => <span className="cc-chip" key={value}>{value}</span>)}</div>}

      <div className="cc-admin-actions">
        <button type="button" className="cc-btn cc-btn--invest" onClick={() => openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.minimumInvestmentMinor || 0, 100_000))}><Coins size={14}/> Invest now</button>
        <button type="button" className={`cc-btn cc-btn--ghost cc-btn--sm`} onClick={() => toggleWatch(item.id)}><Star size={13} fill={watchlist.includes(item.id) ? "currentColor" : "none"}/> {watchlist.includes(item.id) ? "Watching" : "Watch"}</button>
      </div>
    </aside>;
  };

  return <div className="arb-page portal-page cc-page">
    <header className="cc-hero" aria-label="Carbon Credit desk">
      <div className="cc-hero-glow" aria-hidden="true" />
      <div className="cc-masthead">
        <div className="cc-masthead-lead">
          <span className="cc-eyebrow cc-eyebrow--teal">Carbon Credit · Verified environmental assets</span>
          <h1 className="cc-title">Invest in carbon — verified removals, avoidance and nature-based projects on a world atlas.</h1>
          <p className="cc-lede">Every entry below is carbon-only across {CARBON_CREDIT_TYPES.length} credit types — reforestation, forest conservation, soil carbon, blue carbon, cookstoves, biochar, direct air capture, BECCS, enhanced weathering, ocean alkalinity, renewable energy, methane capture, waste management and industrial efficiency. Navigate the atlas by region, read each project's verification status at a glance, and open its dossier for the sourced economics. Public carbon sources publish climate context but never deal economics, so nothing here is invented: an administrator-published dossier carries the funding target and settlement multiple. Commitments settle in {settlement}, draw from any wallet you hold or from all wallets combined at the live rate, and the principal is held against the project's published milestones.</p>
        </div>
        <div className="cc-masthead-side">
          <div className="cc-sources">
            <span className={`cc-source-chip${degraded ? " is-degraded" : " is-ok"}`}>{degraded ? "Some catalogue sources degraded" : "Live administrator economics"}</span>
            {sources.map((source) => <span className={`cc-source-chip is-${source.status}`} key={source.name} title={source.detail || source.url}>
              {source.status === "ok" ? <Check size={11}/> : <AlertTriangle size={11}/>} {source.name}
            </span>)}
          </div>
          <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh the desk"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>

      <div className="cc-figures">
        <div className="cc-figure cc-figure--teal"><b>{summary.published}</b><span>Published opportunities</span></div>
        <div className="cc-figure cc-figure--green"><b>{analytics.tonnage ? `${Math.round(analytics.tonnage).toLocaleString()} t` : "0 t"}</b><span>Expected issuance on desk</span></div>
        <div className="cc-figure cc-figure--gold"><b>{fmtMinor(summary.committedMinor)}</b><span>Your committed</span></div>
        <div className="cc-figure cc-figure--red"><b>{fmtMinor(summary.distributedMinor)}</b><span>Distributed to you</span></div>
      </div>
    </header>

    {market.isError && <div className="cc-notice is-error" role="alert">
      <AlertTriangle size={16}/>
      <div><strong>The desk could not reach the account service.</strong> {market.error?.message || "Administrator-published carbon opportunities could not be loaded."} Retry to reconnect.</div>
      <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {storeWarning && <div className="cc-notice" role="status"><AlertTriangle size={16}/><div>{storeWarning}</div></div>}
    {message && !target && <div className="cc-notice is-error" role="alert"><AlertTriangle size={16}/><div>{message}</div></div>}

    <nav className="cc-tabs" aria-label="Carbon Credit workspace">
      <button type="button" className={`cc-tab${tab === "atlas" ? " is-active" : ""}`} onClick={() => setTab("atlas")}><Compass size={14}/> Atlas <span className="cc-tab-count">{opportunities.length}</span></button>
      <button type="button" className={`cc-tab${tab === "positions" ? " is-active" : ""}`} onClick={() => setTab("positions")}><Coins size={14}/> My investments <span className="cc-tab-count">{positions.length}</span></button>
      <button type="button" className={`cc-tab${tab === "analytics" ? " is-active" : ""}`} onClick={() => setTab("analytics")}><TrendingUp size={14}/> Desk analytics</button>
    </nav>

    {tab === "atlas" && <section className="cc-section" aria-label="Carbon atlas">
      <div className="cc-toolbar">
        <div className="cc-filters">
          <div className="cc-filter"><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, operator, standard or region"/></div>
          <div className="cc-filter"><label>Type</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="ALL">All {CARBON_CREDIT_TYPES.length} types</option>{CARBON_TYPE_GROUPS.map((group) => <optgroup label={group.label} key={group.label}>{group.types.map((value) => <option key={value} value={value}>{carbonTypeLabel(value)}</option>)}</optgroup>)}</select></div>
          <div className="cc-filter"><label>Standard</label><select value={standard} onChange={(e) => setStandard(e.target.value)}><option value="ALL">All standards</option>{CARBON_STANDARDS.map((value) => <option key={value} value={value}>{carbonStandardLabel(value)}</option>)}<option value="UNVERIFIED">Not yet verified</option></select></div>
          <div className="cc-filter"><label>Sector</label><select value={sector} onChange={(e) => setSector(e.target.value)}><option value="ALL">All sectors</option>{CARBON_SECTORS.map((value) => <option key={value} value={value}>{carbonSectorLabel(value as CarbonSector)}</option>)}</select></div>
          <div className="cc-filter"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option>{CARBON_DOSSIER_STATUSES.map((value) => <option key={value} value={value}>{carbonStatusLabel(value)}</option>)}</select></div>
          <div className="cc-filter"><label>Territory</label><select value={territory} onChange={(e) => setTerritory(e.target.value)}><option value="ALL">All territories</option>{CARBON_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{carbonTerritoryBandLabel(value)}</option>)}</select></div>
          <div className="cc-filter"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fundable">Open for investment first</option><option value="deadline">Closing soonest</option><option value="tonnage">Largest expected issuance</option><option value="price">Highest price per tonne</option><option value="multiple">Highest expected multiple</option><option value="name">Title A–Z</option><option value="type">Type A–Z</option><option value="region">Region A–Z</option></select></div>
        </div>
        <div className="cc-toolbar-actions">
          <label className="cc-checkbox"><input type="checkbox" checked={fundableOnly} onChange={(e) => setFundableOnly(e.target.checked)}/> Open for investment only</label>
          <label className="cc-checkbox"><input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)}/> Watchlist ({watchlist.length})</label>
          <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={exportCatalogue} disabled={!filtered.length}><Download size={13}/> Export CSV</button>
          {activeFilters > 0 && <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={clearFilters}><X size={13}/> Clear {activeFilters}</button>}
        </div>
      </div>

      <div className="cc-atlas-shell">
        <div className="cc-region-rail" role="group" aria-label="Carbon regions">
          <div className="cc-region-rail-head">Regions</div>
          <button type="button" className={`cc-region-btn${region === "ALL" ? " is-active" : ""}`} aria-pressed={region === "ALL"} onClick={() => setRegion("ALL")}>
            <span>All regions<small>Every plotted project</small></span>
            <span className="cc-region-count">{opportunities.length}</span>
          </button>
          {CARBON_REGION_LIST.map((value) => {
            const count = regionCounts.get(value) ?? 0;
            return <button type="button" key={value} className={`cc-region-btn${region === value ? " is-active" : ""}`} aria-pressed={region === value} onClick={() => setRegion(region === value ? "ALL" : value)}>
              <span>{carbonRegionLabel(value)}<small>{count} project{count === 1 ? "" : "s"}</small></span>
              <span className="cc-region-count">{count}</span>
              <span className="cc-region-bar"><i style={{ width: `${Math.round((count * 100) / maxRegionCount)}%` }} /></span>
            </button>;
          })}
        </div>

        <div className="cc-atlas-canvas">
          <svg className="cc-atlas-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="World atlas of carbon opportunities">
            {GRAT_LATS.map((lat) => { const p = project(-180, lat); const q = project(180, lat); return <line key={`lat-${lat}`} className="cc-grat" x1={p.x} y1={p.y} x2={q.x} y2={q.y}/>; })}
            {GRAT_LONS.map((lon) => { const p = project(lon, 90); const q = project(lon, -90); return <line key={`lon-${lon}`} className="cc-grat" x1={p.x} y1={p.y} x2={q.x} y2={q.y}/>; })}
            {CONTINENTS.map((points, index) => <path key={index} className="cc-land" d={polyPath(points)}/>)}
            {CARBON_REGION_LIST.map((value) => {
              const [lon, lat] = CARBON_REGION_CENTROIDS[value];
              const p = project(lon, lat);
              const active = region === value;
              return <text key={value} className={`cc-region-label${active ? " is-active" : ""}`} x={p.x} y={p.y} textAnchor="middle">{carbonRegionLabel(value)}</text>;
            })}
            {pins.map((pin) => <g key={pin.item.id} className="cc-pin" onClick={() => setSelectedId(pin.item.id)} role="button" tabIndex={0} aria-label={`${pin.item.title}, ${pin.verified ? "verified" : "reference"}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(pin.item.id); } }}>
              {!pin.verified && <circle className="cc-pin-halo" cx={pin.x} cy={pin.y} r={7}/>}
              <circle className={`cc-pin-dot ${pin.verified ? "is-verified" : "is-reference"}${selectedId === pin.item.id ? " is-selected" : ""}`} cx={pin.x} cy={pin.y} r={selectedId === pin.item.id ? 7 : 5}/>
            </g>)}
          </svg>
          <div className="cc-atlas-legend">
            <span className="cc-legend-row"><span className="cc-legend-dot is-verified"/> Verified instrument</span>
            <span className="cc-legend-row"><span className="cc-legend-dot is-reference"/> Cited reference</span>
            <span className="cc-legend-row"><MapPin size={11}/> {pins.length} plotted of {opportunities.length}</span>
          </div>
          {!market.isLoading && !pins.length && <div className="cc-atlas-empty">{opportunities.length ? "No projects match the current filters. Clear a filter or pick another region." : "No carbon projects are plotted yet. An administrator publishes verified carbon opportunities by type; cited public references appear as soon as a feed responds."}</div>}
          {market.isLoading && !opportunities.length && <div className="cc-atlas-empty"><span className="cc-spinner"/> Loading carbon projects…</div>}
        </div>

        {selected ? renderDossier(selected) : <aside className="cc-dossier-drawer" aria-label="Project dossier placeholder">
          <div className="cc-dossier-head"><div><div className="cc-eyebrow">Project dossier</div><h3>Select a pin</h3></div></div>
          <p className="cc-dossier-sub">Click a pin on the atlas — or a card below — to open the project's verified dossier: method, standard, expected issuance, modelled outcomes, milestones and its cited source. Nothing is shown for a project until its record is loaded.</p>
          <div className="cc-dossier-block"><h4>How to read the atlas</h4><p>Pins are coloured by verification status. A green pin is an administrator-published instrument with sourced economics; a gold pin is a cited public reference that can still be invested in but carries no funding target.</p></div>
        </aside>}
      </div>

      <div className="cc-section-head">
        <div><span className="cc-eyebrow cc-eyebrow--teal">Pin board</span><h2>{filtered.length} project{filtered.length === 1 ? "" : "s"} {region === "ALL" ? "across all regions" : `in ${carbonRegionLabel(region as CarbonRegion)}`}</h2><p>The same records the atlas plots, as cards. Sort, filter or search here and the map follows.</p></div>
        <span className="cc-chip"><BadgeCheck size={12}/> {opportunities.filter((item) => item.verificationStatus === "VERIFIED").length} verified · {opportunities.filter((item) => item.verificationStatus === "REFERENCE").length} reference</span>
      </div>
      {!filtered.length && !market.isLoading && <div className="cc-empty"><CircleHelp size={16}/> No carbon projects match the current filters.</div>}
      {filtered.length > 0 && <div className="cc-pinboard">{filtered.map(renderPinCard)}</div>}
    </section>}

    {tab === "positions" && <section className="cc-section" aria-label="Your carbon credit positions">
      <div className="cc-section-head">
        <div><span className="cc-eyebrow cc-eyebrow--teal">Your investments</span><h2>Carbon commitments &amp; distributions</h2></div>
        <div className="cc-toolbar-actions">
          <span className="cc-chip"><ShieldCheck size={12}/> Settled in {settlement} · {fmtMinor(available)} available</span>
          <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={exportPositions} disabled={!positions.length}><Download size={13}/> Export CSV</button>
        </div>
      </div>
      <div className="cc-analytics-split">
        <div className="cc-analytics-stat"><b>{fmtMinor(summary.committedMinor)}</b><span>Committed (held)</span></div>
        <div className="cc-analytics-stat"><b>{summary.activePositions}</b><span>Active positions</span></div>
        <div className="cc-analytics-stat cc-analytics-stat--green"><b>{fmtMinor(summary.distributedMinor)}</b><span>Distributions credited</span></div>
        <div className="cc-analytics-stat"><b>{summary.settledPositions}</b><span>Settled</span></div>
        <div className="cc-analytics-stat cc-analytics-stat--teal"><b>{summary.writtenOffPositions}</b><span>Written off</span></div>
      </div>
      {!positions.length && <div className="cc-empty"><Coins size={16}/> No carbon investments yet. Fund a verified removal, avoidance or nature-based project to open a position — the amount is debited from your wallet and held against the project.</div>}
      {positions.length > 0 && <div className="cc-table-wrap">
        <table className="cc-table">
          <thead><tr><th>Position</th><th>Project</th><th>Type</th><th>Standard</th><th>Amount</th><th>Funding</th><th>Expected</th><th>Distributed</th><th>Outcome</th><th>Realised</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((position: any) => <tr key={position.id}>
              <td className="cc-mono">{position.positionCode}</td>
              <td>{position.instrumentName}</td>
              <td>{position.creditType ? carbonTypeLabel(position.creditType) : "—"}</td>
              <td>{position.standard ? carbonStandardLabel(position.standard) : "—"}</td>
              <td>{fmtMinor(Number(position.amountMinor))}</td>
              <td>{position.fundingSource === "COMBINED" ? "Combined" : position.fundingSource || position.currency}</td>
              <td>{fmtMultiple(position.expectedMultipleBps)}</td>
              <td>{fmtMinor(Number(position.distributedMinor || 0))}</td>
              <td>{position.outcome ? carbonOutcomeLabel(position.outcome) : "—"}</td>
              <td>{position.realisedMinor !== null && position.realisedMinor !== undefined ? fmtMinor(Number(position.realisedMinor)) : "—"}</td>
              <td>{formatDate(position.openedAt)}</td>
              <td><span className="cc-chip">{position.positionStatus}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>}

    {tab === "analytics" && <section className="cc-section" aria-label="Carbon desk analytics">
      <div className="cc-section-head"><div><span className="cc-eyebrow cc-eyebrow--teal">Desk analytics</span><h2>What is on the atlas</h2><p>Desk-level aggregates computed only from the carbon project records above — how the set splits by type, sector, verification standard, region, territory and stage, and how much issuance and capital they carry. No figure is inferred beyond the records themselves.</p></div></div>
      {!opportunities.length ? <div className="cc-empty"><CircleHelp size={16}/> No projects published yet — analytics appear once administrator economics arrive.</div> : <div className="cc-analytics">
        <div className="cc-analytics-split">
          <div className="cc-analytics-stat"><b>{analytics.totalOpportunities}</b><span>Projects</span></div>
          <div className="cc-analytics-stat"><b>{analytics.fundableCount}</b><span>Open for investment</span></div>
          <div className="cc-analytics-stat cc-analytics-stat--green"><b>{analytics.natureBased}</b><span>Nature-based</span></div>
          <div className="cc-analytics-stat cc-analytics-stat--teal"><b>{Math.round(analytics.tonnage).toLocaleString()} t</b><span>Expected issuance</span></div>
          <div className="cc-analytics-stat"><b>{fmtMinor(analytics.raisingMinor)}</b><span>Total raising</span></div>
          <div className="cc-analytics-stat"><b>{fmtMinor(analytics.committedMinor)}</b><span>Committed on desk</span></div>
        </div>

        <div className="cc-analytics-grid">
          <div className="cc-analytics-card"><h3>By verification standard</h3>
            {analytics.byStandard.map((bucket) => <div className="cc-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byStandard[0].count))}%` }} /></div><b className="cc-mono">{bucket.count}</b></div>)}
          </div>
          <div className="cc-analytics-card"><h3>By region</h3>
            {analytics.byRegion.map((bucket) => <div className="cc-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byRegion[0].count))}%` }} /></div><b className="cc-mono">{bucket.count}</b></div>)}
          </div>
          <div className="cc-analytics-card"><h3>By type</h3>
            {analytics.byType.map((bucket) => <div className="cc-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byType[0].count))}%` }} /></div><b className="cc-mono">{bucket.count}</b></div>)}
          </div>
          <div className="cc-analytics-card"><h3>By sector</h3>
            {analytics.bySector.map((bucket) => <div className="cc-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.bySector[0].count))}%` }} /></div><b className="cc-mono">{bucket.count}</b></div>)}
          </div>
          <div className="cc-analytics-card"><h3>By stage</h3>
            {analytics.byStage.map((bucket) => <div className="cc-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byStage[0].count))}%` }} /></div><b className="cc-mono">{bucket.count}</b></div>)}
          </div>
          <div className="cc-analytics-card"><h3>By territory</h3>
            {!analytics.byTerritory.length && <p className="cc-card-meta">No territories published.</p>}
            {analytics.byTerritory.map((bucket) => <div className="cc-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byTerritory[0].count))}%` }} /></div><b className="cc-mono">{bucket.count}</b></div>)}
          </div>
        </div>
      </div>}
    </section>}

    <div id="cc-education" className="cc-notice cc-education">
      <ShieldCheck size={16}/>
      <div>
        <strong>How the Carbon Credit desk works.</strong> This desk is carbon-only across {CARBON_CREDIT_TYPES.length} credit types — {CARBON_TYPE_GROUPS.map((group) => `${group.label} (${group.types.map((value) => carbonTypeLabel(value)).join(", ")})`).join("; ")}. IP royalties, NFTs, music royalties, green energy and agro investment have their own menus and are excluded here. Every listed project is investable; an administrator publishes any new carbon opportunity by selecting its type and standard, and every displayed figure is administrator-supplied and cited. The discovery layer (the keyless Eurostat and World Bank feeds) publishes carbon context — emissions, forest cover and renewable shares — but never deal economics; a cited reference can still be invested in, and an administrator-published dossier adds the sourced funding target and settlement multiple. Your commitment settles in {settlement}, is drawn from any wallet you hold or from all wallets combined at the live rate, the wallet is debited on submit, and the principal is held against the project. Recorded distributions are credited pro-rata to your wallet as internal-ledger entries; at settlement the principal is released against the administrator-configured multiple, or written off. Nothing here is a prediction, and no external transfer occurs on this desk.
      </div>
    </div>

    {selected && <div className="cc-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ShieldCheck size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{opportunities.length} projects · {fundable.length} open · {positions.length} positions</span>
      <span><BadgeCheck size={12}/> {sources.length} cited sources</span>
    </div>}

    {target && <div className="cc-modal" onMouseDown={() => setTarget(null)}>
      <div className="cc-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cc-modal-head">
          <strong><Coins size={15}/> Invest in a carbon project</strong>
          <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={() => setTarget(null)}><X size={16}/></button>
        </div>
        <div className="cc-modal-body">
          <div className="cc-card-title" style={{ fontWeight: 700 }}>{target.name}</div>
          <div className="cc-card-meta"><span>Funded through the wallet ledger</span><span>Expected {fmtMultiple(target.expectedMultipleBps)}</span></div>

          <div className="cc-field">
            <label>Investment amount ({settlement})</label>
            <input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))} />
            <small>Your wallet will be debited on submit. You can pay from the {settlement} wallet, any single wallet, or all wallets combined.</small>
          </div>

          <div>
            <span className="cc-eyebrow">Pay from</span>
            <div className="cc-funding">
              <button type="button" className={`cc-funding-option${fundingSource === "COMBINED" ? " is-selected" : ""}`} onClick={() => setFundingSource("COMBINED")}>
                <Layers3 size={14}/> <span><strong>Combined balance</strong><small>All wallets, converted at the live rate</small></span>
                {quote?.fundingSource === "COMBINED" && quote?.combinedAvailableMinor !== null && quote?.combinedAvailableMinor !== undefined && <b>{fmtMinor(quote.combinedAvailableMinor)}</b>}
              </button>
              {fundedWallets.map((wallet) => <button type="button" key={wallet.currency} className={`cc-funding-option${fundingSource === wallet.currency ? " is-selected" : ""}`} onClick={() => setFundingSource(wallet.currency)}>
                <Coins size={14}/> <span><strong>{wallet.currency}</strong><small>{wallet.currencyName || "Wallet"}</small></span>
                <b>{moneyMinor(wallet.availableMinor, wallet.currency, wallet.scale)}</b>
              </button>)}
              {!fundedWallets.length && <p className="cc-card-meta">No funded wallets detected yet.</p>}
            </div>
          </div>

          <div className="cc-quote">
            {quoteLoading && <span>Checking funding at the live rate…</span>}
            {!quoteLoading && !quote && <span>Enter an amount to see how it will be funded.</span>}
            {!quoteLoading && quote?.sufficient && <>
              <strong className="cc-ok"><Check size={13}/> Funded by {quote.fundingSource === "COMBINED" ? "combined wallets" : quote.fundingSource}</strong>
              {quote.usdAvailableMinor > 0 && quote.convertedUsdMinor < quote.amountMinor && <div className="cc-quote-row"><span>{settlement} wallet</span><span>{fmtMinor(Math.max(0, quote.amountMinor - quote.convertedUsdMinor))}</span></div>}
              {(quote.debits || []).map((debit: any) => <div className="cc-quote-row" key={debit.currency}><span>{debit.currency} → {fmtMinor(debit.convertedUsdMinor)} @ {debit.rate} <em>{debit.rateProvider}</em></span><span>{moneyMinor(debit.amountMinor, debit.currency, wallets.find((wallet) => wallet.currency === debit.currency)?.scale ?? 2)}</span></div>)}
            </>}
            {!quoteLoading && quote && !quote.sufficient && <div>
              <strong className="cc-bad"><AlertTriangle size={13}/> Insufficient balance</strong>
              <span>{quote.message}{quote.combinedAvailableMinor !== null && quote.combinedAvailableMinor !== undefined ? ` Combined available: ${fmtMinor(quote.combinedAvailableMinor)}.` : ""}</span>
            </div>}
          </div>

          <div className="cc-notice"><ShieldCheck size={15}/><div>Confirming debits your chosen wallet(s) through the existing internal ledger, holds the principal and creates a durable position. Duplicate requests are idempotent. Recorded distributions are credited pro-rata as they are published; at settlement the principal is released against the administrator-configured multiple, or written off. No external transfer occurs on this desk.</div></div>
          {message && <div className="cc-notice is-error" role="alert"><AlertTriangle size={15}/><div>{message}</div></div>}
        </div>
        <div className="cc-modal-foot">
          <button className="cc-btn cc-btn--ghost" onClick={() => setTarget(null)}>Cancel</button>
          <button className="cc-btn cc-btn--invest" disabled={purchase.isPending || quoteLoading || (quote ? !quote.sufficient : false)} onClick={submitPurchase}>{purchase.isPending ? "Recording investment…" : "Confirm & debit wallet"} <Check size={14}/></button>
        </div>
      </div>
    </div>}

    <div className="cc-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ShieldCheck size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{opportunities.length} projects · {fundable.length} open · {positions.length} positions</span>
      <span><BadgeCheck size={12}/> {sources.length} cited sources</span>
      <span><Sparkles size={12}/> Atlas desk · region rail, pin map and dossier</span>
    </div>
  </div>;
}
