import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, BadgeCheck, CalendarClock, Check, CircleHelp, Coins, Compass,
  Download, Droplets, Factory, Flame, Gauge, Layers3, Leaf, MapPin, Mountain, PlugZap,
  Recycle, RefreshCw, ShieldCheck, Sparkles, Star, Sun, TrendingUp, Waves, Wind, X, Zap,
  type LucideIcon,
} from "lucide-react";
import {
  GREEN_ENERGY_DOSSIER_STATUSES,
  GREEN_ENERGY_REGION_CENTROIDS,
  GREEN_ENERGY_REGION_LIST,
  GREEN_ENERGY_SECTORS,
  GREEN_ENERGY_STANDARDS,
  GREEN_ENERGY_TERRITORY_BANDS,
  GREEN_ENERGY_TYPE_GROUPS,
  GREEN_ENERGY_TYPES,
  buildGreenEnergyAnalytics,
  getGreenEnergyInvestmentCatalogue,
  greenEnergyCountryPoint,
  greenEnergyOutcomeLabel,
  greenEnergyRegionLabel,
  greenEnergyRiskLabel,
  greenEnergySectorLabel,
  greenEnergyStageLabel,
  greenEnergyStandardLabel,
  greenEnergyStatusLabel,
  greenEnergyTerritoryBandLabel,
  greenEnergyTypeBlurb,
  greenEnergyTypeLabel,
  type GreenEnergyInvestmentSource,
  type GreenEnergyOpportunity,
  type GreenEnergyRegion,
  type GreenEnergySector,
  type GreenEnergyType,
} from "@shared/green-energy-catalogue";
import { currencyMinorToUsdMinor, type DeskEconomics } from "@shared/investment-economics";
import "./green-energy.css";

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_KEY = "green-energy-watchlist";

const TYPE_ICON: Record<GreenEnergyType, LucideIcon> = {
  SOLAR_PV: Sun,
  CONCENTRATED_SOLAR: Flame,
  ONSHORE_WIND: Wind,
  OFFSHORE_WIND: Waves,
  HYDROPOWER: Droplets,
  GEOTHERMAL: Mountain,
  TIDAL_WAVE: Waves,
  BIOMASS_BIOENERGY: Leaf,
  BATTERY_STORAGE: Zap,
  GREEN_HYDROGEN: Gauge,
  WASTE_TO_ENERGY: Recycle,
  GRID_INFRASTRUCTURE: PlugZap,
  ENERGY_EFFICIENCY: Factory,
  EV_CHARGING: Zap,
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
const fmtCapacity = (mw: number | null | undefined) => (mw === null || mw === undefined ? "—" : `${Number(mw).toLocaleString(undefined, { maximumFractionDigits: 0 })} MW`);
/** Default investable floor when an opportunity publishes no explicit minimum (USD 500 in minor units). */
const GREEN_ENERGY_MIN_INVESTMENT_MINOR = 50_000;
/** The amount a customer may start from on a given opportunity. */
const investableFloor = (opportunity: Pick<GreenEnergyOpportunity, "minimumInvestmentMinor">) => Math.max(opportunity.minimumInvestmentMinor || 0, GREEN_ENERGY_MIN_INVESTMENT_MINOR);
/** A USD settlement-currency seed for the invest form from a presentation-currency ticket minimum. */
const usdSeed = (ticketMinMinor: number | null | undefined, currency: string) =>
  Math.max(GREEN_ENERGY_MIN_INVESTMENT_MINOR, currencyMinorToUsdMinor(Number(ticketMinMinor || 0), currency) || 0);
/** Profit implied by an amount at the opportunity's expected multiple (integer basis points). */
const profitMinor = (amountMinor: number | null | undefined, multipleBps: number | null | undefined) =>
  multipleBps === null || multipleBps === undefined ? null : Math.round((Number(amountMinor || 0) * (Number(multipleBps) - 10_000)) / 10_000);
/** Projected return = principal + profit at the expected multiple. */
const returnMinor = (amountMinor: number | null | undefined, multipleBps: number | null | undefined) =>
  multipleBps === null || multipleBps === undefined ? null : Number(amountMinor || 0) + (profitMinor(amountMinor, multipleBps) || 0);
const fmtProfit = (amountMinor: number | null | undefined, multipleBps: number | null | undefined) => {
  const profit = profitMinor(amountMinor, multipleBps);
  return profit === null ? "—" : `${profit >= 0 ? "+" : ""}${fmtMinor(profit)}`;
};
/**
 * Resolve an opportunity's auto-assigned economic profile into display values:
 * the investable amount band, the profit rate, the term and close date, the
 * platform fee and the settlement-delay bolt-on. Missing pieces fall back to the
 * opportunity's own published fields so an administrator figure is never masked.
 */
function economicsView(item: GreenEnergyOpportunity, settlement: string) {
  const econ = item.economics ?? null;
  const currency = econ?.currency || settlement;
  const scale = econ?.currencyScale ?? 2;
  const ticketMinMinor = econ?.ticketMinMinor ?? investableFloor(item);
  const targetMinor = econ?.fundingTargetMinor ?? item.fundingAskMinor ?? null;
  const profitBps = econ?.profitBps ?? (item.expectedMultipleBps !== null && item.expectedMultipleBps !== undefined ? item.expectedMultipleBps - 10_000 : null);
  const termDays = econ?.termDays ?? null;
  const closeDate = econ?.closeDate ?? item.fundingDeadline ?? null;
  return {
    econ,
    currency,
    scale,
    ticketMinMinor,
    targetMinor,
    profitBps,
    termDays,
    closeDate,
    realiseDate: econ?.maturityDate ?? (closeDate && termDays !== null ? addDaysIso(closeDate, termDays) : null),
    platformFeeBps: econ?.platformFeeBps ?? null,
    settlementDelayDays: econ?.settlementDelayDays ?? null,
  };
}
/** Add a whole number of days to a YYYY-MM-DD date, returning the same format (or null on bad input). */
function addDaysIso(value: string, days: number): string | null {
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}
/** Format a minor-unit amount in the opportunity's own currency and scale. */
const fmtEcon = (minor: number | null | undefined, currency: string, scale: number) => moneyMinor(Number(minor || 0), currency, scale);
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
type PurchaseTarget = { id: string; name: string; expectedMultipleBps: number | null; economics?: DeskEconomics | null };

/**
 * Green Energy desk — an ATLAS workspace.
 *
 * This is the desk's own structure and differs from every other vertical: a
 * region rail on the left, a map-style pin canvas in the middle where each pin
 * is one opportunity coloured by its verification status (VERIFIED for an
 * administrator-published instrument, REFERENCE for a cited public reference),
 * and a slide-out project dossier on the right. The pin board beneath lists the
 * same records as cards. Every listed opportunity is investable: commitments
 * settle in USD and may be funded from the settlement wallet, any single wallet,
 * or all wallets combined through live FX. Public sources (keyless Eurostat and
 * World Bank feeds) publish green-energy context — generation, capacity and grid
 * statistics — but never deal economics, so the discovery layer is cited, not
 * synthesised, and the principal is held against the opportunity's milestones.
 */
export function CustomerGreenEnergy({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.greenEnergy.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"atlas" | "positions" | "analytics">("atlas");
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<"ALL" | GreenEnergyRegion>("ALL");
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

  const purchase = trpc.customer.greenEnergy.purchase.useMutation({
    onSuccess: (result: any) => {
      setTarget(null);
      setAmount(0);
      setTab("positions");
      void utils.customer.greenEnergy.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.greenEnergy.market.refetch();
      push(`+ Green Energy recorded · ${result.instrumentName} (${result.positionCode})`);
    },
    onError: (error: { message: string }) => setMessage(error.message),
  });

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);

  const opportunities = useMemo(() => (market.data?.opportunities || []) as GreenEnergyOpportunity[], [market.data]);
  const positions: any[] = (market.data?.positions || []) as any[];
  const wallets: WalletBalance[] = (market.data?.wallets || market.data?.balances || []) as WalletBalance[];
  const fundedWallets = wallets.filter((wallet) => Number(wallet.availableMinor || 0) > 0);
  const settlement = String(market.data?.settlementCurrency || "USD");
  const settlementWallet = wallets.find((wallet) => wallet.currency === settlement);
  const available = Number(settlementWallet?.availableMinor ?? market.data?.availableMinor ?? 0);
  const summary = market.data?.summary || {
    committedMinor: 0, activePositions: 0, settledPositions: 0, writtenOffPositions: 0,
    fundableOpportunities: 0, generationCount: 0, published: 0, realisedMinor: 0, distributedMinor: 0,
  };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  // The discovery layer cites the keyless public feeds but publishes no deal
  // economics; an administrator dossier supplies those. When the account
  // service is unreachable we still surface the cited sources directly from the
  // shared module so the desk explains itself; nothing is ever fabricated.
  const [fallbackSources, setFallbackSources] = useState<GreenEnergyInvestmentSource[] | null>(null);
  useEffect(() => {
    if (market.isLoading || market.isFetching || market.data) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getGreenEnergyInvestmentCatalogue();
        if (!cancelled) setFallbackSources(catalogue.sources);
      } catch { /* leave null; the error notice already explains the state */ }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, market.data]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = opportunities.filter((item) => {
      if (region !== "ALL" && item.region !== region) return false;
      if (type !== "ALL" && item.energyType !== type) return false;
      if (standard !== "ALL" && (item.standard ?? "UNVERIFIED") !== standard) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (sector !== "ALL" && item.sector !== sector) return false;
      if (territory !== "ALL" && item.territoryBand !== territory) return false;
      if (fundableOnly && !item.fundable) return false;
      if (watchlistOnly && !watchlist.includes(item.id)) return false;
      if (normalized && !`${item.title} ${item.operator} ${item.offtaker ?? ""} ${item.territory} ${item.country} ${item.description} ${greenEnergyTypeLabel(item.energyType)} ${greenEnergySectorLabel(item.sector)} ${greenEnergyRegionLabel(item.region)}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "fundable") return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0) || b.fundedBps - a.fundedBps || a.title.localeCompare(b.title);
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "deadline") return (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999);
      if (sort === "capacity") return (b.capacityMw || 0) - (a.capacityMw || 0);
      if (sort === "tariff") return (b.tariffPerMwhMinor || 0) - (a.tariffPerMwhMinor || 0);
      if (sort === "multiple") return (b.expectedMultipleBps || 0) - (a.expectedMultipleBps || 0);
      if (sort === "type") return greenEnergyTypeLabel(a.energyType).localeCompare(greenEnergyTypeLabel(b.energyType)) || a.title.localeCompare(b.title);
      if (sort === "region") return greenEnergyRegionLabel(a.region).localeCompare(greenEnergyRegionLabel(b.region)) || a.title.localeCompare(b.title);
      return 0;
    });
    return sorted;
  }, [opportunities, query, region, type, standard, status, sector, territory, fundableOnly, watchlistOnly, watchlist, sort]);

  const regionCounts = useMemo(() => {
    const counts = new Map<GreenEnergyRegion, number>();
    for (const item of opportunities) counts.set(item.region, (counts.get(item.region) ?? 0) + 1);
    return counts;
  }, [opportunities]);
  const maxRegionCount = Math.max(1, ...GREEN_ENERGY_REGION_LIST.map((value) => regionCounts.get(value) ?? 0));

  // Pins plotted at each opportunity's country coordinate. Multiple projects in
  // one country are fanned out slightly so every pin stays clickable.
  const pins = useMemo(() => {
    const seen = new Map<string, number>();
    return filtered.map((item) => {
      const [lon, lat] = greenEnergyCountryPoint(item.countryCode);
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
  const analytics = useMemo(() => buildGreenEnergyAnalytics(opportunities), [opportunities]);
  const sources: GreenEnergyInvestmentSource[] = (market.data?.sources as GreenEnergyInvestmentSource[]) || fallbackSources || [];
  const fetchedAt = market.data?.fetchedAt;
  const degraded = !!market.data?.degraded;

  const toggleWatch = (id: string) => setWatchlist((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const clearFilters = () => { setRegion("ALL"); setType("ALL"); setStandard("ALL"); setStatus("ALL"); setSector("ALL"); setTerritory("ALL"); setFundableOnly(false); setWatchlistOnly(false); setQuery(""); };

  const openPurchase = (nextTarget: PurchaseTarget, suggested: number) => {
    setTarget(nextTarget);
    setMessage("");
    setFundingSource("COMBINED");
    setAmount(Math.max(suggested, GREEN_ENERGY_MIN_INVESTMENT_MINOR));
  };

  // Refresh the funding quote (conversion + affordability) as the amount or
  // funding wallet changes. Debounced so typing does not hammer the FX provider.
  useEffect(() => {
    if (!target || amount <= 0) { setQuote(null); return; }
    const seq = ++quoteSeq.current;
    setQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await utils.customer.greenEnergy.fundingQuote.fetch({ amountMinor: Math.round(amount), fundingSource });
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
    `green-energy-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Title", "Operator", "Type", "Sector", "Standard", "Verification", "Region", "Territory", "Territory band", "Country code", "Deal type", "Stage", "Status", "Risk grade", "Capacity (MW)", "Tariff per MWh (minor)", "Revenue share (bps)", "Expected multiple (bps)", "Expected duration (months)", "Projected revenue (minor)", "Capital at risk (minor)", "Funding target (minor)", "Committed (minor)", "Funded bps", "Minimum investment (minor)", "Unit price (minor)", "Validation date", "Funding deadline", "Remaining days", "Fundable", "Source", "Source URL", "As of"],
    filtered.map((item) => [
      item.title, item.operator, greenEnergyTypeLabel(item.energyType), greenEnergySectorLabel(item.sector), item.standard ? greenEnergyStandardLabel(item.standard) : "Not yet verified",
      item.verificationStatus, greenEnergyRegionLabel(item.region), item.territory, item.territoryBand, item.countryCode, item.dealType ?? "",
      greenEnergyStageLabel(item.stage), greenEnergyStatusLabel(item.status), item.riskGrade ? greenEnergyRiskLabel(item.riskGrade) : "",
      item.capacityMw ?? "", item.tariffPerMwhMinor ?? "", item.revenueSharesBps ?? "", item.expectedMultipleBps ?? "",
      item.expectedDurationMonths ?? "", item.projectedRevenueMinor ?? "", item.capitalAtRiskMinor ?? "", item.fundingAskMinor ?? "",
      item.committedMinor, item.fundedBps, item.minimumInvestmentMinor ?? "", item.unitPriceMinor ?? "", item.eventDate ?? "",
      item.fundingDeadline ?? "", item.remainingDays ?? "", item.fundable ? "Yes" : "No", item.source, item.sourceUrl ?? "", item.asOf,
    ]),
  );

  const exportPositions = () => downloadCsv(
    `green-energy-positions-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Position", "Instrument", "Type", "Standard", "Amount (minor)", "Currency", "Funding", "Units", "Status at buy", "Expected multiple (bps)", "Outcome", "Distributed (minor)", "Realised (minor)", "Opened", "Status"],
    positions.map((position) => [
      position.positionCode, position.instrumentName, position.energyType || "", position.standard || "",
      position.amountMinor, position.currency, position.fundingSource || "", position.units ?? "", position.statusAtPurchase || "",
      position.expectedMultipleBps ?? "", position.outcome || "", position.distributedMinor ?? "", position.realisedMinor ?? "",
      formatDate(position.openedAt), position.positionStatus,
    ]),
  );

  const renderPinCard = (item: GreenEnergyOpportunity) => {
    const TypeIcon = TYPE_ICON[item.energyType];
    const verified = item.verificationStatus === "VERIFIED";
    const watched = watchlist.includes(item.id);
    const minimum = investableFloor(item);
    const view = economicsView(item, settlement);
    return <div className={`ge-pin-card${selectedId === item.id ? " is-active" : ""}`} key={item.id} role="button" tabIndex={0} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(item.id); } }}>
      <div className="ge-pin-card-top">
        <span className="ge-pin-glyph"><TypeIcon size={15}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{item.flag} {item.title}</h3>
          <div className="ge-pin-card-meta"><span>{item.operator}</span></div>
        </div>
        <span className="ge-star" role="presentation" onClick={(event) => { event.stopPropagation(); toggleWatch(item.id); }} aria-hidden="true"><Star size={15} className={watched ? "" : ""} fill={watched ? "currentColor" : "none"}/></span>
      </div>
      <div className="ge-dossier-tags">
        <span className={`ge-chip ${verified ? "ge-chip--verified" : "ge-chip--reference"}`}><BadgeCheck size={11}/> {verified ? "Verified" : "Reference"}</span>
        <span className="ge-chip ge-chip--type">{greenEnergyTypeLabel(item.energyType)}</span>
        <span className="ge-chip ge-chip--standard">{item.standard ? greenEnergyStandardLabel(item.standard) : "Unverified"}</span>
        <span className="ge-chip">{greenEnergyRegionLabel(item.region)}</span>
      </div>
      <div className="ge-pin-card-meta">
        <span>Capacity <b>{fmtCapacity(item.capacityMw)}</b></span>
        <span>Tariff <b>{item.tariffPerMwhMinor ? fmtMinor(item.tariffPerMwhMinor) : "—"}</b></span>
        <span>Expected <b>{fmtMultiple(item.expectedMultipleBps)}</b></span>
      </div>
      <div className="ge-pin-card-econ">
        <span>You can invest from <b>{fmtMinor(minimum)}</b></span>
        <span>Projected profit on {fmtMinor(minimum)} <b className="ge-profit">{fmtProfit(minimum, item.expectedMultipleBps)}</b></span>
      </div>
      <div className="ge-econ-panel" aria-label="Economic profile">
        <div className="ge-econ-row">
          <div className="ge-econ-item"><span>Currency</span><b>{view.currency}</b></div>
          <div className="ge-econ-item"><span>Invest from</span><b>{fmtEcon(view.ticketMinMinor, view.currency, view.scale)}</b></div>
          <div className="ge-econ-item"><span>Funding target</span><b>{view.targetMinor !== null ? fmtEcon(view.targetMinor, view.currency, view.scale) : "—"}</b></div>
        </div>
        <div className="ge-econ-row">
          <div className="ge-econ-item"><span>Profit at maturity</span><b className="ge-profit">{view.profitBps !== null ? `+${fmtPercent(view.profitBps)}` : "—"}</b></div>
          <div className="ge-econ-item"><span>Term</span><b>{view.termDays !== null ? `${view.termDays} days` : "—"}</b></div>
          <div className="ge-econ-item"><span>Platform fee</span><b>{view.platformFeeBps !== null ? fmtPercent(view.platformFeeBps) : "—"}</b></div>
        </div>
        <div className="ge-econ-row">
          <div className="ge-econ-item"><span>Investment closes</span><b>{formatDate(view.closeDate)}</b></div>
          <div className="ge-econ-item"><span>Profit realised</span><b>{view.realiseDate ? formatDate(view.realiseDate) : "—"}</b></div>
          <div className="ge-econ-item"><span>Payout</span><b className={view.settlementDelayDays !== null ? "ge-delay" : "ge-ok"}>{view.settlementDelayDays !== null ? `up to +${view.settlementDelayDays}d delay` : "On schedule"}</b></div>
        </div>
        {view.settlementDelayDays !== null && <div className="ge-econ-delay"><CalendarClock size={12}/> Settlement for this opportunity is scheduled with a system-delay allowance of up to {view.settlementDelayDays} day{view.settlementDelayDays === 1 ? "" : "s"}; the payout lands on the administrator's settlement run.</div>}
      </div>
      {item.fundable && <div className="ge-progress">
        <div className="ge-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
        <div className="ge-progress-bar"><i style={{ width: `${Math.max(0, Math.min(100, Math.round(item.fundedBps / 100)))}%` }} /></div>
      </div>}
      <div className="ge-pin-card-invest">
        <button type="button" className="ge-btn ge-btn--invest" onClick={(event) => { event.stopPropagation(); openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps, economics: view.econ }, usdSeed(view.ticketMinMinor, view.currency)); }}><Coins size={14}/> Invest now</button>
      </div>
    </div>;
  };

  const renderDossier = (item: GreenEnergyOpportunity) => {
    const TypeIcon = TYPE_ICON[item.energyType];
    const verified = item.verificationStatus === "VERIFIED";
    const view = economicsView(item, settlement);
    return <aside className="ge-dossier-drawer" aria-label="Project dossier">
      <div className="ge-dossier-head">
        <div>
          <div className="ge-eyebrow">{verified ? "Verified instrument" : "Cited reference"}</div>
          <h3>{item.flag} {item.title}</h3>
          <div className="ge-dossier-sub">{item.operator}{item.offtaker ? ` · ${item.offtaker}` : ""}</div>
        </div>
        <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={() => setSelectedId(null)} aria-label="Close dossier"><X size={15}/></button>
      </div>
      <div className="ge-dossier-tags">
        <span className={`ge-chip ${verified ? "ge-chip--verified" : "ge-chip--reference"}`}><BadgeCheck size={11}/> {verified ? "Verified" : "Reference"}</span>
        <span className="ge-chip ge-chip--type"><TypeIcon size={11}/> {greenEnergyTypeLabel(item.energyType)}</span>
        <span className="ge-chip ge-chip--standard">{item.standard ? greenEnergyStandardLabel(item.standard) : "Not yet verified"}</span>
        <span className={`ge-chip ge-chip--status-${String(item.status).toLowerCase()}`}>{greenEnergyStatusLabel(item.status)}</span>
        {item.riskGrade && <span className={`ge-chip ge-chip--risk-${String(item.riskGrade).toLowerCase()}`}>{greenEnergyRiskLabel(item.riskGrade)}</span>}
      </div>
      <div className="ge-dossier-stats">
        <div className="ge-dossier-stat"><span>Region</span><b>{greenEnergyRegionLabel(item.region)}</b></div>
        <div className="ge-dossier-stat"><span>Territory</span><b>{item.territory}</b></div>
        <div className="ge-dossier-stat"><span>Planned capacity</span><b>{fmtCapacity(item.capacityMw)}</b></div>
        <div className="ge-dossier-stat"><span>Tariff per MWh</span><b>{item.tariffPerMwhMinor ? fmtMinor(item.tariffPerMwhMinor) : "—"}</b></div>
        <div className="ge-dossier-stat"><span>Expected multiple</span><b>{fmtMultiple(item.expectedMultipleBps)}</b></div>
        <div className="ge-dossier-stat"><span>You can invest from</span><b>{fmtMinor(investableFloor(item))}</b></div>
        <div className="ge-dossier-stat"><span>Projected profit at minimum</span><b className="ge-profit">{fmtProfit(investableFloor(item), item.expectedMultipleBps)}</b></div>
        <div className="ge-dossier-stat"><span>Stage</span><b>{greenEnergyStageLabel(item.stage)}</b></div>
      </div>
      <div className="ge-econ-panel" aria-label="Economic profile">
        <div className="ge-econ-row">
          <div className="ge-econ-item"><span>Currency</span><b>{view.currency}</b></div>
          <div className="ge-econ-item"><span>Invest from</span><b>{fmtEcon(view.ticketMinMinor, view.currency, view.scale)}</b></div>
          <div className="ge-econ-item"><span>Funding target</span><b>{view.targetMinor !== null ? fmtEcon(view.targetMinor, view.currency, view.scale) : "—"}</b></div>
        </div>
        <div className="ge-econ-row">
          <div className="ge-econ-item"><span>Profit at maturity</span><b className="ge-profit">{view.profitBps !== null ? `+${fmtPercent(view.profitBps)}` : "—"}</b></div>
          <div className="ge-econ-item"><span>Term</span><b>{view.termDays !== null ? `${view.termDays} days` : "—"}</b></div>
          <div className="ge-econ-item"><span>Platform fee</span><b>{view.platformFeeBps !== null ? fmtPercent(view.platformFeeBps) : "—"}</b></div>
        </div>
        <div className="ge-econ-row">
          <div className="ge-econ-item"><span>Investment closes</span><b>{formatDate(view.closeDate)}</b></div>
          <div className="ge-econ-item"><span>Profit realised</span><b>{view.realiseDate ? formatDate(view.realiseDate) : "—"}</b></div>
          <div className="ge-econ-item"><span>Payout</span><b className={view.settlementDelayDays !== null ? "ge-delay" : "ge-ok"}>{view.settlementDelayDays !== null ? `up to +${view.settlementDelayDays}d delay` : "On schedule"}</b></div>
        </div>
        {view.settlementDelayDays !== null && <div className="ge-econ-delay"><CalendarClock size={12}/> Settlement for this opportunity is scheduled with a system-delay allowance of up to {view.settlementDelayDays} day{view.settlementDelayDays === 1 ? "" : "s"}; the payout lands on the administrator's settlement run.</div>}
      </div>
      {item.fundable
        ? <div className="ge-progress">
            <div className="ge-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
            <div className="ge-progress-bar"><i style={{ width: `${Math.max(0, Math.min(100, Math.round(item.fundedBps / 100)))}%` }} /></div>
            <div className="ge-card-meta"><span><CalendarClock size={11}/> {daysLabel(item.remainingDays)}{item.fundingDeadline ? ` · closes ${formatDate(item.fundingDeadline)}` : ""}</span></div>
          </div>
        : <div className="ge-reference-note"><AlertTriangle size={13}/> Cited catalogue reference — the administrator has not yet published its funding economics, so it carries no funding target. You can still invest now; the position settles on the administrator-configured multiple.</div>}

      <div className="ge-dossier-block"><h4>Opportunity</h4><p>{item.description}</p></div>
      <div className="ge-dossier-block"><h4>Method</h4><p>{greenEnergyTypeBlurb(item.energyType)}</p></div>
      {item.expectedMultipleBps !== null && <div className="ge-dossier-block"><h4>Participation</h4><p>{item.revenueSharesBps !== null && item.revenueSharesBps !== undefined ? `Investor share ${fmtPercent(item.revenueSharesBps)} of gross revenue. ` : ""}Expected {fmtMultiple(item.expectedMultipleBps)}{item.expectedDurationMonths ? ` over ${item.expectedDurationMonths} months` : ""}.</p></div>}
      <div className="ge-dossier-block"><h4>Source</h4><p title={item.sourceUrl || item.source}><ShieldCheck size={11}/> {item.asOf} · {item.source}</p></div>

      {item.scenarios.length > 0 && <div className="ge-scenarios">
        {item.scenarios.map((scenario, index) => <div className={`ge-scenario ge-scenario--${scenario.outcome.toLowerCase()}`} key={`${scenario.outcome}-${index}`}>
          <span className="ge-scenario-head">{scenario.label}</span>
          <span>{fmtPercent(scenario.probabilityBps)} · {fmtMinor(scenario.grossRevenueMinor)} gross · {scenario.durationMonths}mo · {fmtMultiple(scenario.funderMultipleBps)}</span>
        </div>)}
      </div>}
      {item.milestones.length > 0 && <div className="ge-dossier-block"><h4>Milestones &amp; escrow release</h4><div className="ge-milestone-track">{item.milestones.map((milestone, index) => <span className={`ge-milestone${milestone.status === "REACHED" ? " is-reached" : ""}`} key={`${milestone.stage}-${index}`}>{milestone.label} · {fmtPercent(milestone.releaseBps)}</span>)}</div></div>}
      {item.highlights.length > 0 && <div className="ge-dossier-tags">{item.highlights.slice(0, 5).map((value) => <span className="ge-chip" key={value}>{value}</span>)}</div>}

      <div className="ge-admin-actions">
        <button type="button" className="ge-btn ge-btn--invest" onClick={() => openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps, economics: view.econ }, usdSeed(view.ticketMinMinor, view.currency))}><Coins size={14}/> Invest now from {fmtMinor(investableFloor(item))}</button>
        <button type="button" className={`ge-btn ge-btn--ghost ge-btn--sm`} onClick={() => toggleWatch(item.id)}><Star size={13} fill={watchlist.includes(item.id) ? "currentColor" : "none"}/> {watchlist.includes(item.id) ? "Watching" : "Watch"}</button>
      </div>
    </aside>;
  };

  return <div className="arb-page portal-page ge-page">
    <header className="ge-hero" aria-label="Green Energy desk">
      <div className="ge-hero-glow" aria-hidden="true" />
      <div className="ge-masthead">
        <div className="ge-masthead-lead">
          <span className="ge-eyebrow ge-eyebrow--teal">Green Energy · Generation &amp; infrastructure assets</span>
          <h1 className="ge-title">Invest in green energy — solar, wind, storage and grid projects on a world atlas.</h1>
          <p className="ge-lede">Every entry below is green-energy-only across {GREEN_ENERGY_TYPES.length} generation and infrastructure types — solar photovoltaic, concentrated solar, onshore wind, offshore wind, hydropower, geothermal, tidal &amp; wave, biomass &amp; bioenergy, battery storage, green hydrogen, waste-to-energy, grid infrastructure, energy efficiency and EV charging. Navigate the atlas by region, read each project's verification status at a glance, and open its dossier for the sourced economics. Public green-energy sources publish grid and generation context but never deal economics, so nothing here is invented: an administrator-published dossier carries the funding target and settlement multiple. Commitments settle in {settlement}, draw from any wallet you hold or from all wallets combined at the live rate, and the principal is held against the project's published milestones.</p>
        </div>
        <div className="ge-masthead-side">
          <div className="ge-sources">
            <span className={`ge-source-chip${degraded ? " is-degraded" : " is-ok"}`}>{degraded ? "Some catalogue sources degraded" : "Live administrator economics"}</span>
            {sources.map((source) => <span className={`ge-source-chip is-${source.status}`} key={source.name} title={source.detail || source.url}>
              {source.status === "ok" ? <Check size={11}/> : <AlertTriangle size={11}/>} {source.name}
            </span>)}
          </div>
          <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh the desk"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>

      <div className="ge-figures">
        <div className="ge-figure ge-figure--teal"><b>{summary.published}</b><span>Published opportunities</span></div>
        <div className="ge-figure ge-figure--green"><b>{analytics.capacityMw ? `${Math.round(analytics.capacityMw).toLocaleString()} MW` : "0 MW"}</b><span>Planned capacity on desk</span></div>
        <div className="ge-figure ge-figure--gold"><b>{fmtMinor(summary.committedMinor)}</b><span>Your committed</span></div>
        <div className="ge-figure ge-figure--red"><b>{fmtMinor(summary.distributedMinor)}</b><span>Distributed to you</span></div>
      </div>
    </header>

    {market.isError && <div className="ge-notice is-error" role="alert">
      <AlertTriangle size={16}/>
      <div><strong>The desk could not reach the account service.</strong> {market.error?.message || "Administrator-published green energy opportunities could not be loaded."} Retry to reconnect.</div>
      <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {storeWarning && <div className="ge-notice" role="status"><AlertTriangle size={16}/><div>{storeWarning}</div></div>}
    {message && !target && <div className="ge-notice is-error" role="alert"><AlertTriangle size={16}/><div>{message}</div></div>}

    <nav className="ge-tabs" aria-label="Green Energy workspace">
      <button type="button" className={`ge-tab${tab === "atlas" ? " is-active" : ""}`} onClick={() => setTab("atlas")}><Compass size={14}/> Atlas <span className="ge-tab-count">{opportunities.length}</span></button>
      <button type="button" className={`ge-tab${tab === "positions" ? " is-active" : ""}`} onClick={() => setTab("positions")}><Coins size={14}/> My investments <span className="ge-tab-count">{positions.length}</span></button>
      <button type="button" className={`ge-tab${tab === "analytics" ? " is-active" : ""}`} onClick={() => setTab("analytics")}><TrendingUp size={14}/> Desk analytics</button>
    </nav>

    {tab === "atlas" && <section className="ge-section" aria-label="Green energy atlas">
      <div className="ge-toolbar">
        <div className="ge-filters">
          <div className="ge-filter"><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, operator, standard or region"/></div>
          <div className="ge-filter"><label>Type</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="ALL">All {GREEN_ENERGY_TYPES.length} types</option>{GREEN_ENERGY_TYPE_GROUPS.map((group) => <optgroup label={group.label} key={group.label}>{group.types.map((value) => <option key={value} value={value}>{greenEnergyTypeLabel(value)}</option>)}</optgroup>)}</select></div>
          <div className="ge-filter"><label>Standard</label><select value={standard} onChange={(e) => setStandard(e.target.value)}><option value="ALL">All standards</option>{GREEN_ENERGY_STANDARDS.map((value) => <option key={value} value={value}>{greenEnergyStandardLabel(value)}</option>)}<option value="UNVERIFIED">Not yet verified</option></select></div>
          <div className="ge-filter"><label>Sector</label><select value={sector} onChange={(e) => setSector(e.target.value)}><option value="ALL">All sectors</option>{GREEN_ENERGY_SECTORS.map((value) => <option key={value} value={value}>{greenEnergySectorLabel(value as GreenEnergySector)}</option>)}</select></div>
          <div className="ge-filter"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option>{GREEN_ENERGY_DOSSIER_STATUSES.map((value) => <option key={value} value={value}>{greenEnergyStatusLabel(value)}</option>)}</select></div>
          <div className="ge-filter"><label>Territory</label><select value={territory} onChange={(e) => setTerritory(e.target.value)}><option value="ALL">All territories</option>{GREEN_ENERGY_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{greenEnergyTerritoryBandLabel(value)}</option>)}</select></div>
          <div className="ge-filter"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fundable">Open for investment first</option><option value="deadline">Closing soonest</option><option value="capacity">Largest planned capacity</option><option value="tariff">Highest tariff per MWh</option><option value="multiple">Highest expected multiple</option><option value="name">Title A–Z</option><option value="type">Type A–Z</option><option value="region">Region A–Z</option></select></div>
        </div>
        <div className="ge-toolbar-actions">
          <label className="ge-checkbox"><input type="checkbox" checked={fundableOnly} onChange={(e) => setFundableOnly(e.target.checked)}/> Open for investment only</label>
          <label className="ge-checkbox"><input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)}/> Watchlist ({watchlist.length})</label>
          <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={exportCatalogue} disabled={!filtered.length}><Download size={13}/> Export CSV</button>
          {activeFilters > 0 && <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={clearFilters}><X size={13}/> Clear {activeFilters}</button>}
        </div>
      </div>

      <div className="ge-atlas-shell">
        <div className="ge-region-rail" role="group" aria-label="Green Energy regions">
          <div className="ge-region-rail-head">Regions</div>
          <button type="button" className={`ge-region-btn${region === "ALL" ? " is-active" : ""}`} aria-pressed={region === "ALL"} onClick={() => setRegion("ALL")}>
            <span>All regions<small>Every plotted project</small></span>
            <span className="ge-region-count">{opportunities.length}</span>
          </button>
          {GREEN_ENERGY_REGION_LIST.map((value) => {
            const count = regionCounts.get(value) ?? 0;
            return <button type="button" key={value} className={`ge-region-btn${region === value ? " is-active" : ""}`} aria-pressed={region === value} onClick={() => setRegion(region === value ? "ALL" : value)}>
              <span>{greenEnergyRegionLabel(value)}<small>{count} project{count === 1 ? "" : "s"}</small></span>
              <span className="ge-region-count">{count}</span>
              <span className="ge-region-bar"><i style={{ width: `${Math.round((count * 100) / maxRegionCount)}%` }} /></span>
            </button>;
          })}
        </div>

        <div className="ge-atlas-canvas">
          <svg className="ge-atlas-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="World atlas of green energy opportunities">
            {GRAT_LATS.map((lat) => { const p = project(-180, lat); const q = project(180, lat); return <line key={`lat-${lat}`} className="ge-grat" x1={p.x} y1={p.y} x2={q.x} y2={q.y}/>; })}
            {GRAT_LONS.map((lon) => { const p = project(lon, 90); const q = project(lon, -90); return <line key={`lon-${lon}`} className="ge-grat" x1={p.x} y1={p.y} x2={q.x} y2={q.y}/>; })}
            {CONTINENTS.map((points, index) => <path key={index} className="ge-land" d={polyPath(points)}/>)}
            {GREEN_ENERGY_REGION_LIST.map((value) => {
              const [lon, lat] = GREEN_ENERGY_REGION_CENTROIDS[value];
              const p = project(lon, lat);
              const active = region === value;
              return <text key={value} className={`ge-region-label${active ? " is-active" : ""}`} x={p.x} y={p.y} textAnchor="middle">{greenEnergyRegionLabel(value)}</text>;
            })}
            {pins.map((pin) => <g key={pin.item.id} className="ge-pin" onClick={() => setSelectedId(pin.item.id)} role="button" tabIndex={0} aria-label={`${pin.item.title}, ${pin.verified ? "verified" : "reference"}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(pin.item.id); } }}>
              {!pin.verified && <circle className="ge-pin-halo" cx={pin.x} cy={pin.y} r={7}/>}
              <circle className={`ge-pin-dot ${pin.verified ? "is-verified" : "is-reference"}${selectedId === pin.item.id ? " is-selected" : ""}`} cx={pin.x} cy={pin.y} r={selectedId === pin.item.id ? 7 : 5}/>
            </g>)}
          </svg>
          <div className="ge-atlas-legend">
            <span className="ge-legend-row"><span className="ge-legend-dot is-verified"/> Verified instrument</span>
            <span className="ge-legend-row"><span className="ge-legend-dot is-reference"/> Cited reference</span>
            <span className="ge-legend-row"><MapPin size={11}/> {pins.length} plotted of {opportunities.length}</span>
          </div>
          {!market.isLoading && !pins.length && <div className="ge-atlas-empty">{opportunities.length ? "No projects match the current filters. Clear a filter or pick another region." : "No green energy projects are plotted yet. An administrator publishes verified green energy opportunities by type; cited public references appear as soon as a feed responds."}</div>}
          {market.isLoading && !opportunities.length && <div className="ge-atlas-empty"><span className="ge-spinner"/> Loading green energy projects…</div>}
        </div>

        {selected ? renderDossier(selected) : <aside className="ge-dossier-drawer" aria-label="Project dossier placeholder">
          <div className="ge-dossier-head"><div><div className="ge-eyebrow">Project dossier</div><h3>Select a pin</h3></div></div>
          <p className="ge-dossier-sub">Click a pin on the atlas — or a card below — to open the project's verified dossier: method, standard, planned capacity, modelled outcomes, milestones and its cited source. Nothing is shown for a project until its record is loaded.</p>
          <div className="ge-dossier-block"><h4>How to invest</h4><p>Every project is investable. Press <strong>Invest now</strong> on any card below — or inside a project's dossier — enter the amount you want to place, and confirm to debit your wallet. Each card states the amount you can invest from and the profit you would realise at the project's expected multiple.</p></div>
          <div className="ge-dossier-block"><h4>How to read the atlas</h4><p>Pins are coloured by verification status. A green pin is an administrator-published instrument with sourced economics; a gold pin is a cited public reference that can still be invested in but carries no funding target.</p></div>
        </aside>}
      </div>

      <div className="ge-section-head">
        <div><span className="ge-eyebrow ge-eyebrow--teal">Pin board</span><h2>{filtered.length} project{filtered.length === 1 ? "" : "s"} {region === "ALL" ? "across all regions" : `in ${greenEnergyRegionLabel(region as GreenEnergyRegion)}`}</h2><p>The same records the atlas plots, as cards. Sort, filter or search here and the map follows.</p></div>
        <span className="ge-chip"><BadgeCheck size={12}/> {opportunities.filter((item) => item.verificationStatus === "VERIFIED").length} verified · {opportunities.filter((item) => item.verificationStatus === "REFERENCE").length} reference</span>
      </div>
      {!filtered.length && !market.isLoading && <div className="ge-empty"><CircleHelp size={16}/> No green energy projects match the current filters.</div>}
      {filtered.length > 0 && <div className="ge-pinboard">{filtered.map(renderPinCard)}</div>}
    </section>}

    {tab === "positions" && <section className="ge-section" aria-label="Your green energy positions">
      <div className="ge-section-head">
        <div><span className="ge-eyebrow ge-eyebrow--teal">Your investments</span><h2>Green energy commitments &amp; distributions</h2></div>
        <div className="ge-toolbar-actions">
          <span className="ge-chip"><ShieldCheck size={12}/> Settled in {settlement} · {fmtMinor(available)} available</span>
          <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={exportPositions} disabled={!positions.length}><Download size={13}/> Export CSV</button>
        </div>
      </div>
      <div className="ge-analytics-split">
        <div className="ge-analytics-stat"><b>{fmtMinor(summary.committedMinor)}</b><span>Committed (held)</span></div>
        <div className="ge-analytics-stat"><b>{summary.activePositions}</b><span>Active positions</span></div>
        <div className="ge-analytics-stat ge-analytics-stat--green"><b>{fmtMinor(summary.distributedMinor)}</b><span>Distributions credited</span></div>
        <div className="ge-analytics-stat"><b>{summary.settledPositions}</b><span>Settled</span></div>
        <div className="ge-analytics-stat ge-analytics-stat--teal"><b>{summary.writtenOffPositions}</b><span>Written off</span></div>
      </div>
      {!positions.length && <div className="ge-empty"><Coins size={16}/> No green energy investments yet. Fund a verified generation, storage or grid project to open a position — the amount is debited from your wallet and held against the project.</div>}
      {positions.length > 0 && <div className="ge-table-wrap">
        <table className="ge-table">
          <thead><tr><th>Position</th><th>Project</th><th>Type</th><th>Standard</th><th>Amount</th><th>Funding</th><th>Expected</th><th>Distributed</th><th>Outcome</th><th>Realised</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((position: any) => <tr key={position.id}>
              <td className="ge-mono">{position.positionCode}</td>
              <td>{position.instrumentName}</td>
              <td>{position.energyType ? greenEnergyTypeLabel(position.energyType) : "—"}</td>
              <td>{position.standard ? greenEnergyStandardLabel(position.standard) : "—"}</td>
              <td>{fmtMinor(Number(position.amountMinor))}</td>
              <td>{position.fundingSource === "COMBINED" ? "Combined" : position.fundingSource || position.currency}</td>
              <td>{fmtMultiple(position.expectedMultipleBps)}</td>
              <td>{fmtMinor(Number(position.distributedMinor || 0))}</td>
              <td>{position.outcome ? greenEnergyOutcomeLabel(position.outcome) : "—"}</td>
              <td>{position.realisedMinor !== null && position.realisedMinor !== undefined ? fmtMinor(Number(position.realisedMinor)) : "—"}</td>
              <td>{formatDate(position.openedAt)}</td>
              <td><span className="ge-chip">{position.positionStatus}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>}

    {tab === "analytics" && <section className="ge-section" aria-label="Green Energy desk analytics">
      <div className="ge-section-head"><div><span className="ge-eyebrow ge-eyebrow--teal">Desk analytics</span><h2>What is on the atlas</h2><p>Desk-level aggregates computed only from the green energy project records above — how the set splits by type, sector, verification standard, region, territory and stage, and how much capacity and capital they carry. No figure is inferred beyond the records themselves.</p></div></div>
      {!opportunities.length ? <div className="ge-empty"><CircleHelp size={16}/> No projects published yet — analytics appear once administrator economics arrive.</div> : <div className="ge-analytics">
        <div className="ge-analytics-split">
          <div className="ge-analytics-stat"><b>{analytics.totalOpportunities}</b><span>Projects</span></div>
          <div className="ge-analytics-stat"><b>{analytics.fundableCount}</b><span>Open for investment</span></div>
          <div className="ge-analytics-stat ge-analytics-stat--green"><b>{analytics.generationCount}</b><span>Generation projects</span></div>
          <div className="ge-analytics-stat ge-analytics-stat--teal"><b>{Math.round(analytics.capacityMw).toLocaleString()} MW</b><span>Planned capacity</span></div>
          <div className="ge-analytics-stat"><b>{fmtMinor(analytics.raisingMinor)}</b><span>Total raising</span></div>
          <div className="ge-analytics-stat"><b>{fmtMinor(analytics.committedMinor)}</b><span>Committed on desk</span></div>
        </div>

        <div className="ge-analytics-grid">
          <div className="ge-analytics-card"><h3>By verification standard</h3>
            {analytics.byStandard.map((bucket) => <div className="ge-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="ge-bar-track"><div className="ge-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byStandard[0].count))}%` }} /></div><b className="ge-mono">{bucket.count}</b></div>)}
          </div>
          <div className="ge-analytics-card"><h3>By region</h3>
            {analytics.byRegion.map((bucket) => <div className="ge-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="ge-bar-track"><div className="ge-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byRegion[0].count))}%` }} /></div><b className="ge-mono">{bucket.count}</b></div>)}
          </div>
          <div className="ge-analytics-card"><h3>By type</h3>
            {analytics.byType.map((bucket) => <div className="ge-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="ge-bar-track"><div className="ge-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byType[0].count))}%` }} /></div><b className="ge-mono">{bucket.count}</b></div>)}
          </div>
          <div className="ge-analytics-card"><h3>By sector</h3>
            {analytics.bySector.map((bucket) => <div className="ge-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="ge-bar-track"><div className="ge-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.bySector[0].count))}%` }} /></div><b className="ge-mono">{bucket.count}</b></div>)}
          </div>
          <div className="ge-analytics-card"><h3>By stage</h3>
            {analytics.byStage.map((bucket) => <div className="ge-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="ge-bar-track"><div className="ge-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byStage[0].count))}%` }} /></div><b className="ge-mono">{bucket.count}</b></div>)}
          </div>
          <div className="ge-analytics-card"><h3>By territory</h3>
            {!analytics.byTerritory.length && <p className="ge-card-meta">No territories published.</p>}
            {analytics.byTerritory.map((bucket) => <div className="ge-bar-row" key={bucket.key}><span>{bucket.label}</span><div className="ge-bar-track"><div className="ge-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byTerritory[0].count))}%` }} /></div><b className="ge-mono">{bucket.count}</b></div>)}
          </div>
        </div>
      </div>}
    </section>}

    <div id="ge-education" className="ge-notice ge-education">
      <ShieldCheck size={16}/>
      <div>
        <strong>How the Green Energy desk works.</strong> This desk is green-energy-only across {GREEN_ENERGY_TYPES.length} generation and infrastructure types — {GREEN_ENERGY_TYPE_GROUPS.map((group) => `${group.label} (${group.types.map((value) => greenEnergyTypeLabel(value)).join(", ")})`).join("; ")}. IP royalties, NFTs, music royalties, carbon credit and agro investment have their own menus and are excluded here. Every listed project is investable; an administrator publishes any new green energy opportunity by selecting its type and standard, and every displayed figure is administrator-supplied and cited. The discovery layer (the keyless Eurostat and World Bank feeds) publishes green-energy context — generation, capacity and grid statistics — but never deal economics; a cited reference can still be invested in, and an administrator-published dossier adds the sourced funding target and settlement multiple. Your commitment settles in {settlement}, is drawn from any wallet you hold or from all wallets combined at the live rate, the wallet is debited on submit, and the principal is held against the project. Recorded distributions are credited pro-rata to your wallet as internal-ledger entries; at settlement the principal is released against the administrator-configured multiple, or written off. Nothing here is a prediction, and no external transfer occurs on this desk.
      </div>
    </div>

    {selected && <div className="ge-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ShieldCheck size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{opportunities.length} projects · {fundable.length} open · {positions.length} positions</span>
      <span><BadgeCheck size={12}/> {sources.length} cited sources</span>
    </div>}

    {target && <div className="ge-modal" onMouseDown={() => setTarget(null)}>
      <div className="ge-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ge-modal-head">
          <strong><Coins size={15}/> Invest in a green energy project</strong>
          <button type="button" className="ge-btn ge-btn--ghost ge-btn--sm" onClick={() => setTarget(null)}><X size={16}/></button>
        </div>
        <div className="ge-modal-body">
          <div className="ge-card-title" style={{ fontWeight: 700 }}>{target.name}</div>
          <div className="ge-card-meta">
            <span>Funded through the wallet ledger</span>
            <span>Expected {fmtMultiple(target.expectedMultipleBps)}</span>
            {target.economics && <span className="ge-profit">+{fmtPercent(target.economics.profitBps)} profit</span>}
          </div>

          {target.economics && <div className="ge-econ-panel ge-econ-panel--modal" aria-label="Economic profile">
            <div className="ge-econ-row">
              <div className="ge-econ-item"><span>Currency</span><b>{target.economics.currency}</b></div>
              <div className="ge-econ-item"><span>Invest from</span><b>{fmtEcon(target.economics.ticketMinMinor, target.economics.currency, target.economics.currencyScale)}</b></div>
              <div className="ge-econ-item"><span>Funding target</span><b>{fmtEcon(target.economics.fundingTargetMinor, target.economics.currency, target.economics.currencyScale)}</b></div>
            </div>
            <div className="ge-econ-row">
              <div className="ge-econ-item"><span>Profit at maturity</span><b className="ge-profit">+{fmtPercent(target.economics.profitBps)}</b></div>
              <div className="ge-econ-item"><span>Term</span><b>{target.economics.termDays} days</b></div>
              <div className="ge-econ-item"><span>Platform fee</span><b>{fmtPercent(target.economics.platformFeeBps)}</b></div>
            </div>
            <div className="ge-econ-row">
              <div className="ge-econ-item"><span>Investment closes</span><b>{formatDate(target.economics.closeDate)}</b></div>
              <div className="ge-econ-item"><span>Profit realised</span><b>{formatDate(target.economics.maturityDate)}</b></div>
              <div className="ge-econ-item"><span>Payout</span><b className={target.economics.settlementDelayDays !== null ? "ge-delay" : "ge-ok"}>{target.economics.settlementDelayDays !== null ? `up to +${target.economics.settlementDelayDays}d delay` : "On schedule"}</b></div>
            </div>
            <p className="ge-econ-note">Displayed in {target.economics.currency} for reference; your commitment settles in {settlement} through the wallet ledger at the live rate.</p>
          </div>}

          <div className="ge-field">
            <label>Investment amount ({settlement})</label>
            <input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))} />
            <small>Your wallet will be debited on submit. You can pay from the {settlement} wallet, any single wallet, or all wallets combined.</small>
          </div>

          {target.expectedMultipleBps !== null && amount > 0 && <div className="ge-invest-figures">
            <div className="ge-invest-figure"><span>You invest</span><b>{fmtMinor(amount)}</b></div>
            <div className="ge-invest-figure"><span>Projected return at {fmtMultiple(target.expectedMultipleBps)}</span><b>{fmtMinor(returnMinor(amount, target.expectedMultipleBps))}</b></div>
            <div className="ge-invest-figure ge-invest-figure--profit"><span>Projected profit you will realise</span><b className="ge-profit">{fmtProfit(amount, target.expectedMultipleBps)}</b></div>
          </div>}

          <div>
            <span className="ge-eyebrow">Pay from</span>
            <div className="ge-funding">
              <button type="button" className={`ge-funding-option${fundingSource === "COMBINED" ? " is-selected" : ""}`} onClick={() => setFundingSource("COMBINED")}>
                <Layers3 size={14}/> <span><strong>Combined balance</strong><small>All wallets, converted at the live rate</small></span>
                {quote?.fundingSource === "COMBINED" && quote?.combinedAvailableMinor !== null && quote?.combinedAvailableMinor !== undefined && <b>{fmtMinor(quote.combinedAvailableMinor)}</b>}
              </button>
              {fundedWallets.map((wallet) => <button type="button" key={wallet.currency} className={`ge-funding-option${fundingSource === wallet.currency ? " is-selected" : ""}`} onClick={() => setFundingSource(wallet.currency)}>
                <Coins size={14}/> <span><strong>{wallet.currency}</strong><small>{wallet.currencyName || "Wallet"}</small></span>
                <b>{moneyMinor(wallet.availableMinor, wallet.currency, wallet.scale)}</b>
              </button>)}
              {!fundedWallets.length && <p className="ge-card-meta">No funded wallets detected yet.</p>}
            </div>
          </div>

          <div className="ge-quote">
            {quoteLoading && <span>Checking funding at the live rate…</span>}
            {!quoteLoading && !quote && <span>Enter an amount to see how it will be funded.</span>}
            {!quoteLoading && quote?.sufficient && <>
              <strong className="ge-ok"><Check size={13}/> Funded by {quote.fundingSource === "COMBINED" ? "combined wallets" : quote.fundingSource}</strong>
              {quote.usdAvailableMinor > 0 && quote.convertedUsdMinor < quote.amountMinor && <div className="ge-quote-row"><span>{settlement} wallet</span><span>{fmtMinor(Math.max(0, quote.amountMinor - quote.convertedUsdMinor))}</span></div>}
              {(quote.debits || []).map((debit: any) => <div className="ge-quote-row" key={debit.currency}><span>{debit.currency} → {fmtMinor(debit.convertedUsdMinor)} @ {debit.rate} <em>{debit.rateProvider}</em></span><span>{moneyMinor(debit.amountMinor, debit.currency, wallets.find((wallet) => wallet.currency === debit.currency)?.scale ?? 2)}</span></div>)}
            </>}
            {!quoteLoading && quote && !quote.sufficient && <div>
              <strong className="ge-bad"><AlertTriangle size={13}/> Insufficient balance</strong>
              <span>{quote.message}{quote.combinedAvailableMinor !== null && quote.combinedAvailableMinor !== undefined ? ` Combined available: ${fmtMinor(quote.combinedAvailableMinor)}.` : ""}</span>
            </div>}
          </div>

          <div className="ge-notice"><ShieldCheck size={15}/><div>Confirming debits your chosen wallet(s) through the existing internal ledger, holds the principal and creates a durable position. Duplicate requests are idempotent. Recorded distributions are credited pro-rata as they are published; at settlement the principal is released against the administrator-configured multiple, or written off. No external transfer occurs on this desk.</div></div>
          {message && <div className="ge-notice is-error" role="alert"><AlertTriangle size={15}/><div>{message}</div></div>}
        </div>
        <div className="ge-modal-foot">
          <button className="ge-btn ge-btn--ghost" onClick={() => setTarget(null)}>Cancel</button>
          <button className="ge-btn ge-btn--invest" disabled={purchase.isPending || quoteLoading || (quote ? !quote.sufficient : false)} onClick={submitPurchase}>{purchase.isPending ? "Recording investment…" : "Confirm & debit wallet"} <Check size={14}/></button>
        </div>
      </div>
    </div>}

    <div className="ge-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ShieldCheck size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{opportunities.length} projects · {fundable.length} open · {positions.length} positions</span>
      <span><BadgeCheck size={12}/> {sources.length} cited sources</span>
      <span><Sparkles size={12}/> Atlas desk · region rail, pin map and dossier</span>
    </div>
  </div>;
}
