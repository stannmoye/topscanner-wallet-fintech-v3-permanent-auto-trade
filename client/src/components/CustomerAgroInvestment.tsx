import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, BadgeCheck, Beef, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Coins, Cpu, Download, Droplets, Egg, Factory, Fish, FlaskConical, Flower2, Grape,
  Layers3, Leaf, Map as MapIcon, Milk, RefreshCw, ShieldCheck, Sparkles, Sprout, Star, Tractor,
  TrendingUp, Warehouse, Wheat, X,
  type LucideIcon,
} from "lucide-react";
import {
  AGRO_DOSSIER_STATUSES,
  AGRO_INVESTMENT_TYPES,
  AGRO_RISK_GRADES,
  AGRO_SECTORS,
  AGRO_STAGES,
  AGRO_TERRITORY_BANDS,
  AGRO_TYPE_GROUPS,
  agroTypeLabel,
  buildAgroAnalytics,
  getAgroInvestmentCatalogue,
  outcomeLabel,
  riskGradeLabel,
  sectorLabel,
  stageLabel,
  statusLabel,
  type AgroInvestmentSource,
  type AgroInvestmentType,
  type AgroOpportunity,
  type AgroRiskGrade,
  type AgroSector,
} from "@shared/agro-investment-catalogue";
import "./agro-investment.css";

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_KEY = "agro-investment-watchlist";
const PAGE_SIZES = [6, 12, 24];

/* The desk's own farm-and-field imagery, drawn as self-contained inline SVG
   data URIs in a green-and-gold palette. Because it is embedded in the bundle
   it always renders in the portal — the desk never depends on an external
   image-generation service that needs authentication and fails in production. */
const AG_ART_BG = `<defs>
  <linearGradient id="agbg" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="#2f6b3a"/><stop offset="0.55" stop-color="#1c4a2c"/><stop offset="1" stop-color="#0f2d1c"/></linearGradient>
  <radialGradient id="agglow" cx="0.5" cy="-0.05" r="1.1"><stop offset="0" stop-color="#e0b33c" stop-opacity="0.34"/><stop offset="1" stop-color="#e0b33c" stop-opacity="0"/></radialGradient>
  <linearGradient id="aggold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d47e"/><stop offset="1" stop-color="#dda93a"/></linearGradient>
  <linearGradient id="agsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb2e0" stop-opacity="0.32"/><stop offset="1" stop-color="#7fb2e0" stop-opacity="0"/></linearGradient>
</defs>
<rect width="400" height="260" fill="url(#agbg)"/>
<rect width="400" height="260" fill="url(#agglow)"/>
<rect width="400" height="150" fill="url(#agsky)"/>
<g stroke="#bfe0a8" stroke-opacity="0.08" stroke-width="1">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<line x1="0" y1="${i * 26}" x2="400" y2="${i * 26}"/>`).join("")}</g>`;

const agArt = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">${AG_ART_BG}${body}</svg>`)}`;

const FIELD_HERO_ART = agArt(`
  <path d="M0 168 Q100 150 200 164 T400 158 L400 260 L0 260 Z" fill="#1b3a22"/>
  <g stroke="#e0b33c" stroke-width="2" stroke-opacity="0.9">${[20, 60, 100, 140, 180, 220, 260, 300, 340, 380].map((x) => `<line x1="${x}" y1="256" x2="${x + 6}" y2="182"/>`).join("")}</g>
  <g fill="url(#aggold)">${[40, 120, 200, 280, 360].map((x, i) => `<circle cx="${x}" cy="${180 - (i % 2) * 8}" r="4"/>`).join("")}</g>
  <circle cx="322" cy="52" r="26" fill="url(#aggold)" fill-opacity="0.9"/>
  <g fill="#2f6b3a"><path d="M60 176 l6-34 6 34 -6-6 Z"/><path d="M96 170 l6-30 6 30 -6-5 Z"/><path d="M132 176 l6-34 6 34 -6-6 Z"/></g>`);

const TYPE_GROUP_ART: Record<string, string> = {
  "Crops & Land": agArt(`
    <path d="M0 176 Q120 154 200 168 T400 162 L400 260 L0 260 Z" fill="#1b3a22"/>
    <g stroke="#e0b33c" stroke-width="2" stroke-opacity="0.85">${[24, 64, 104, 144, 184, 224, 264, 304, 344, 384].map((x) => `<line x1="${x}" y1="256" x2="${x + 6}" y2="188"/>`).join("")}</g>
    <circle cx="316" cy="54" r="28" fill="url(#aggold)" fill-opacity="0.92"/>
    <path d="M120 150 l8-46 8 46 -8-8 Z" fill="#3f8a4a"/>
    <path d="M150 150 l8-46 8 46 -8-8 Z" fill="#4f9c56"/>
    <path d="M180 150 l8-46 8 46 -8-8 Z" fill="#3f8a4a"/>`),
  "Livestock & Fisheries": agArt(`
    <path d="M0 182 Q140 160 400 176 L400 260 L0 260 Z" fill="#1b3a22"/>
    <path d="M60 150 q22-26 44 0 q22-26 44 0 l-6 20 q-16-10 -32 0 q-16-10 -32 0 Z" fill="#e9dcbf"/>
    <circle cx="94" cy="146" r="12" fill="#e9dcbf"/>
    <path d="M82 138 l-6-10 M106 138 l6-10" stroke="#e9dcbf" stroke-width="4" stroke-linecap="round"/>
    <path d="M250 186 q18 10 34 0 q10 14 -4 22 q-16 8 -30 0 q-12-8 0-22 Z" fill="#7fb2e0" fill-opacity="0.78"/>
    <circle cx="284" cy="190" r="7" fill="#7fb2e0" fill-opacity="0.78"/>
    <path d="M270 214 q14 10 30 0" stroke="#7fb2e0" stroke-opacity="0.6" stroke-width="2" fill="none"/>`),
  "Infrastructure & Inputs": agArt(`
    <circle cx="86" cy="118" r="34" fill="none" stroke="#7fb2e0" stroke-opacity="0.7" stroke-width="3"/>
    <path d="M86 84 q-10 34 0 68 q10-34 0-68 Z" fill="#7fb2e0" fill-opacity="0.35"/>
    <path d="M120 118 q-34-10 -68 0 q34 10 68 0 Z" fill="#7fb2e0" fill-opacity="0.2"/>
    <rect x="150" y="150" width="46" height="30" rx="5" fill="#2f6b3a" stroke="#e0b33c" stroke-opacity="0.7"/>
    <circle cx="164" cy="184" r="12" fill="#12261a" stroke="#e0b33c" stroke-opacity="0.7"/>
    <circle cx="186" cy="184" r="12" fill="#12261a" stroke="#e0b33c" stroke-opacity="0.7"/>
    <path d="M196 150 l30-16 0 16" fill="#e0b33c" fill-opacity="0.7"/>
    <g fill="#e0b33c" fill-opacity="0.85">${[230, 262, 294, 326].map((x) => `<rect x="${x}" y="${168 - ((x / 32) % 3) * 12}" width="20" height="60" rx="4"/>`).join("")}</g>`),
  "Technology & Processing": agArt(`
    <rect x="120" y="86" width="160" height="104" rx="10" fill="#1b3a22" stroke="#e0b33c" stroke-opacity="0.6"/>
    <g stroke="#bfe0a8" stroke-opacity="0.6" stroke-width="2">${[1, 2, 3].map((i) => `<line x1="140" y1="${110 + i * 20}" x2="260" y2="${110 + i * 20}"/>`).join("")}</g>
    <circle cx="160" cy="110" r="6" fill="#e0b33c"/>
    <circle cx="188" cy="130" r="4" fill="#7fb2e0"/>
    <circle cx="216" cy="150" r="4" fill="#7fb2e0"/>
    <path d="M300 90 l26 0 0 26 -26 0 Z" fill="#e0b33c" fill-opacity="0.5"/>
    <path d="M60 170 l44 0 0-40 44 0" fill="none" stroke="#7fb2e0" stroke-opacity="0.6" stroke-width="3"/>
    <circle cx="60" cy="170" r="7" fill="#7fb2e0" fill-opacity="0.7"/>`),
};

const TYPE_ICON: Record<AgroInvestmentType, LucideIcon> = {
  ROW_CROP: Wheat,
  ORCHARD_VINEYARD: Grape,
  LIVESTOCK: Beef,
  DAIRY: Milk,
  POULTRY: Egg,
  AQUACULTURE: Fish,
  GREENHOUSE: Flower2,
  FARMLAND: MapIcon,
  IRRIGATION_WATER: Droplets,
  FARM_MACHINERY: Tractor,
  STORAGE_LOGISTICS: Warehouse,
  AGRI_INPUTS: FlaskConical,
  AGRITECH: Cpu,
  AGRI_PROCESSING: Factory,
};

/**
 * The "Crops & Land" field reel: the staple production types an investor can
 * back directly — row crops, orchards and vineyards, greenhouse and farmland —
 * led with because they are the seasonal, harvest-driven opportunities the desk
 * is built around. Matches the "Crops & Land" lane.
 */
const FIELD_TYPES: AgroInvestmentType[] = ["ROW_CROP", "ORCHARD_VINEYARD", "GREENHOUSE", "FARMLAND"];

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

const riskTone = (grade: AgroRiskGrade | null) => (grade ? grade.toLowerCase() : "unrated");

function SlotBar({ bps }: { bps: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(bps) || 0) / 100)));
  return <div className="ag-progress-bar"><i style={{ width: `${pct}%` }} /></div>;
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
 * Customer desk for Agro Investment. This desk is agriculture-only and every
 * listed opportunity is investable — row crops, orchard & vineyard, livestock,
 * dairy, poultry, aquaculture, greenhouse, farmland, irrigation & water, farm
 * machinery, storage & logistics, agri inputs, agritech or processing. Public
 * sources (the keyless World Bank Open Data feed) publish agriculture context
 * but never deal economics, so the discovery layer is cited, not synthesised; an
 * administrator-published dossier adds the sourced funding target and settlement
 * multiple, but a customer can invest in any listed opportunity. Commitments
 * settle in USD and may be funded from the settlement wallet, any single wallet,
 * or all wallets combined through live FX — the same internal-ledger cross-wallet
 * engine as the rest of the platform. The principal is held and released against
 * the opportunity's published milestones.
 */
export function CustomerAgroInvestment({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.agroInvestment.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"board" | "season" | "positions" | "timeline" | "analytics">("board");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [stage, setStage] = useState("ALL");
  const [riskGrade, setRiskGrade] = useState("ALL");
  const [territory, setTerritory] = useState("ALL");
  const [fundableOnly, setFundableOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sort, setSort] = useState("fundable");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const [openId, setOpenId] = useState<string | null>(null);
  const [target, setTarget] = useState<PurchaseTarget | null>(null);
  const [fundingSource, setFundingSource] = useState("COMBINED");
  const [amount, setAmount] = useState(0);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteSeq = useRef(0);

  const purchase = trpc.customer.agroInvestment.purchase.useMutation({
    onSuccess: (result: any) => {
      setTarget(null);
      setAmount(0);
      setTab("positions");
      void utils.customer.agroInvestment.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.agroInvestment.market.refetch();
      push(`+ Agro Investment recorded · ${result.instrumentName} (${result.positionCode})`);
    },
    onError: (error: { message: string }) => setMessage(error.message),
  });

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);

  const opportunities = useMemo(() => (market.data?.opportunities || []) as AgroOpportunity[], [market.data]);
  const positions: any[] = (market.data?.positions || []) as any[];
  const wallets: WalletBalance[] = (market.data?.wallets || market.data?.balances || []) as WalletBalance[];
  const fundedWallets = wallets.filter((wallet) => Number(wallet.availableMinor || 0) > 0);
  const settlement = String(market.data?.settlementCurrency || "USD");
  const settlementWallet = wallets.find((wallet) => wallet.currency === settlement);
  const available = Number(settlementWallet?.availableMinor ?? market.data?.availableMinor ?? 0);
  const summary = market.data?.summary || {
    committedMinor: 0, activePositions: 0, settledPositions: 0, writtenOffPositions: 0,
    fundableOpportunities: 0, cropsAndLand: 0, published: 0, realisedMinor: 0, distributedMinor: 0,
  };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  // The discovery layer cites the public World Bank and Eurostat feeds but
  // publishes no deal economics; an administrator dossier supplies those. When
  // the account service is unreachable we still surface the cited sources
  // directly from the shared module so the desk explains itself; nothing is
  // ever fabricated.
  const [fallbackSources, setFallbackSources] = useState<AgroInvestmentSource[] | null>(null);
  useEffect(() => {
    if (market.isLoading || market.isFetching || market.data) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getAgroInvestmentCatalogue();
        if (!cancelled) setFallbackSources(catalogue.sources);
      } catch { /* leave null; the error notice already explains the state */ }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, market.data]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = opportunities.filter((item) => {
      if (sector !== "ALL" && item.sector !== sector) return false;
      if (type !== "ALL" && item.agroType !== type) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (stage !== "ALL" && item.stage !== stage) return false;
      if (riskGrade !== "ALL" && item.riskGrade !== riskGrade) return false;
      if (territory !== "ALL" && item.territoryBand !== territory) return false;
      if (fundableOnly && !item.fundable) return false;
      if (watchlistOnly && !watchlist.includes(item.id)) return false;
      if (normalized && !`${item.title} ${item.operator} ${item.offtaker ?? ""} ${item.territory} ${item.country} ${item.description} ${agroTypeLabel(item.agroType)} ${sectorLabel(item.sector)}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "fundable") return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0) || b.fundedBps - a.fundedBps || a.title.localeCompare(b.title);
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "deadline") return (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999);
      if (sort === "ask") return (b.fundingAskMinor || 0) - (a.fundingAskMinor || 0);
      if (sort === "multiple") return (b.expectedMultipleBps || 0) - (a.expectedMultipleBps || 0);
      if (sort === "season") return (a.eventDate || "9999").localeCompare(b.eventDate || "9999");
      if (sort === "type") return agroTypeLabel(a.agroType).localeCompare(agroTypeLabel(b.agroType)) || a.title.localeCompare(b.title);
      if (sort === "sector") return sectorLabel(a.sector).localeCompare(sectorLabel(b.sector)) || a.title.localeCompare(b.title);
      return 0;
    });
    return sorted;
  }, [opportunities, query, sector, type, status, stage, riskGrade, territory, fundableOnly, watchlistOnly, watchlist, sort]);

  const fundable = opportunities.filter((item) => item.fundable);
  // The "Crops & Land" reel: the staple production opportunities — row crops,
  // orchards & vineyards, greenhouse and farmland — the desk leads with.
  const seasonReel = useMemo(
    () => fundable.filter((item) => FIELD_TYPES.includes(item.agroType)).sort((a, b) => (a.eventDate || "9999").localeCompare(b.eventDate || "9999") || b.fundedBps - a.fundedBps),
    [fundable],
  );

  // On the Crops & Land tab only fundable crops-and-land opportunities are
  // paginated, so the page count always matches what that tab can show.
  const scoped = useMemo(
    () => tab === "season" ? filtered.filter((item) => item.fundable && FIELD_TYPES.includes(item.agroType)) : filtered,
    [filtered, tab],
  );
  const pageCount = Math.max(1, Math.ceil(scoped.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = scoped.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, sector, type, status, stage, riskGrade, territory, fundableOnly, watchlistOnly, pageSize, tab]);

  const activeFilters = [sector !== "ALL", type !== "ALL", status !== "ALL", stage !== "ALL", riskGrade !== "ALL", territory !== "ALL", fundableOnly, watchlistOnly].filter(Boolean).length;
  const analytics = useMemo(() => buildAgroAnalytics(opportunities), [opportunities]);
  const maxTypeCount = Math.max(1, ...analytics.byType.map((bucket) => bucket.count));

  const toggleWatch = (id: string) => setWatchlist((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const clearFilters = () => { setSector("ALL"); setType("ALL"); setStatus("ALL"); setStage("ALL"); setRiskGrade("ALL"); setTerritory("ALL"); setFundableOnly(false); setWatchlistOnly(false); setQuery(""); };

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
        const result = await utils.customer.agroInvestment.fundingQuote.fetch({ amountMinor: Math.round(amount), fundingSource });
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
    `agro-investment-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Title", "Operator", "Type", "Sector", "Offtaker", "Territory", "Territory band", "Country code", "Deal type", "Stage", "Status", "Risk grade", "Revenue share (bps)", "Expected multiple (bps)", "Expected duration (months)", "Projected revenue (minor)", "Capital at risk (minor)", "Funding target (minor)", "Committed (minor)", "Funded bps", "Minimum investment (minor)", "Unit price (minor)", "Season date", "Funding deadline", "Remaining days", "Fundable", "Source", "Source URL", "As of"],
    filtered.map((item) => [
      item.title, item.operator, agroTypeLabel(item.agroType), sectorLabel(item.sector), item.offtaker ?? "", item.territory, item.territoryBand,
      item.countryCode, item.dealType ?? "", stageLabel(item.stage), statusLabel(item.status), item.riskGrade ? riskGradeLabel(item.riskGrade) : "",
      item.revenueSharesBps ?? "", item.expectedMultipleBps ?? "", item.expectedDurationMonths ?? "", item.projectedRevenueMinor ?? "",
      item.capitalAtRiskMinor ?? "", item.fundingAskMinor ?? "", item.committedMinor, item.fundedBps, item.minimumInvestmentMinor ?? "",
      item.unitPriceMinor ?? "", item.eventDate ?? "", item.fundingDeadline ?? "", item.remainingDays ?? "", item.fundable ? "Yes" : "No",
      item.source, item.sourceUrl ?? "", item.asOf,
    ]),
  );

  const exportPositions = () => downloadCsv(
    `agro-investment-positions-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Position", "Instrument", "Type", "Sector", "Amount (minor)", "Currency", "Funding", "Units", "Status at buy", "Expected multiple (bps)", "Outcome", "Distributed (minor)", "Realised (minor)", "Opened", "Status"],
    positions.map((position) => [
      position.positionCode, position.instrumentName, position.agroType || "", position.sector || "",
      position.amountMinor, position.currency, position.fundingSource || "", position.units ?? "", position.statusAtPurchase || "",
      position.expectedMultipleBps ?? "", position.outcome || "", position.distributedMinor ?? "", position.realisedMinor ?? "",
      formatDate(position.openedAt), position.positionStatus,
    ]),
  );

  const sources: AgroInvestmentSource[] = (market.data?.sources as AgroInvestmentSource[]) || fallbackSources || [];
  const fetchedAt = market.data?.fetchedAt;
  const degraded = !!market.data?.degraded;

  const renderCard = (item: AgroOpportunity, rank: number, media?: string) => {
    const watched = watchlist.includes(item.id);
    const open = openId === item.id;
    const TypeIcon = TYPE_ICON[item.agroType];
    return <article className={`ag-card${item.fundable ? " is-fundable" : " is-reference"}${open ? " is-open" : ""}`} key={item.id}>
      <div className="ag-card-media">
        <img src={media || FIELD_HERO_ART} alt="" loading="lazy" />
        <span className="ag-card-rank">{String(rank).padStart(2, "0")}</span>
        <span className="ag-card-glyph" aria-hidden="true"><TypeIcon size={16}/></span>
        <span className={`ag-chip ag-chip--status-${String(item.status).toLowerCase()}`}>{statusLabel(item.status)}</span>
      </div>
      <div className="ag-card-body">
        <div className="ag-card-head">
          <h3 className="ag-card-title">{item.flag} {item.title}</h3>
          <button type="button" className={`ag-star${watched ? " is-on" : ""}`} onClick={() => toggleWatch(item.id)} aria-pressed={watched} title={watched ? "Remove from watchlist" : "Add to watchlist"}><Star size={15}/></button>
        </div>
        <div className="ag-card-sub"><Sprout size={12}/> {item.operator}{item.offtaker ? ` · ${item.offtaker}` : ""}</div>
        <div className="ag-tags">
          <span className="ag-chip ag-chip--type">{agroTypeLabel(item.agroType)}</span>
          <span className="ag-chip ag-chip--sector">{sectorLabel(item.sector)}</span>
          {item.riskGrade && <span className={`ag-chip ag-chip--risk-${riskTone(item.riskGrade)}`}>{riskGradeLabel(item.riskGrade)}</span>}
          {item.dealType && <span className="ag-chip ag-chip--deal">{item.dealType}</span>}
        </div>
        <div className="ag-facts">
          <span>Stage <b>{stageLabel(item.stage)}</b></span>
          <span>Territory <b>{item.territory}</b></span>
          <span>Expected <b>{fmtMultiple(item.expectedMultipleBps)}</b></span>
          {item.eventDate ? <span>Season <b>{formatDate(item.eventDate)}</b></span> : null}
        </div>

        {item.fundable
          ? <div className="ag-progress">
              <div className="ag-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
              <SlotBar bps={item.fundedBps} />
              <div className="ag-countdown"><CalendarClock size={12}/> {daysLabel(item.remainingDays)}{item.fundingDeadline ? ` · closes ${formatDate(item.fundingDeadline)}` : ""}</div>
            </div>
          : <div className="ag-reference-note"><AlertTriangle size={13}/> Cited catalogue reference — the administrator has not yet published its funding economics, so it carries no funding target or modelled multiple. You can still invest now; the position settles on the administrator-configured multiple.</div>}

        {open && <div className="ag-dossier">
          <div className="ag-dossier-grid">
            <div className="ag-dossier-block"><h4>Opportunity</h4><p>{item.description}</p></div>
            <div className="ag-dossier-block"><h4>Participation {item.dealType ? `· ${item.dealType}` : ""}</h4><p>{item.revenueSharesBps !== null && item.revenueSharesBps !== undefined ? `Investor share ${fmtPercent(item.revenueSharesBps)} of gross revenue. ` : ""}{item.expectedMultipleBps !== null ? `Expected ${fmtMultiple(item.expectedMultipleBps)}` : "Repayment multiple not published"}{item.expectedDurationMonths ? ` over ${item.expectedDurationMonths} months` : ""}.</p></div>
            <div className="ag-dossier-block"><h4>Terms</h4><p>{item.minimumInvestmentMinor ? `Minimum ${fmtMinor(item.minimumInvestmentMinor)}. ` : ""}{item.unitPriceMinor ? `Unit ${fmtMinor(item.unitPriceMinor)}. ` : ""}{item.projectedRevenueMinor ? `Projected revenue ${fmtMinor(item.projectedRevenueMinor)}. ` : ""}{item.capitalAtRiskMinor ? `Capital at risk ${fmtMinor(item.capitalAtRiskMinor)}.` : ""}</p></div>
            <div className="ag-dossier-block"><h4>Source</h4><p title={item.sourceUrl || item.source}><ShieldCheck size={11}/> {item.asOf} · {item.source}</p></div>
          </div>
          {item.scenarios.length > 0 && <div className="ag-scenarios">
            {item.scenarios.map((scenario, index) => <div className={`ag-scenario ag-scenario--${scenario.outcome.toLowerCase()}`} key={`${scenario.outcome}-${index}`}>
              <span className="ag-scenario-head">{scenario.label}</span>
              <span>{fmtPercent(scenario.probabilityBps)} · {fmtMinor(scenario.grossRevenueMinor)} gross · {scenario.durationMonths}mo · {fmtMultiple(scenario.funderMultipleBps)}</span>
            </div>)}
          </div>}
          {item.milestones.length > 0 && <div className="ag-milestones">
            <span className="ag-eyebrow">Milestones &amp; escrow release</span>
            <div className="ag-milestone-track">{item.milestones.map((milestone, index) => <span className={`ag-milestone${milestone.status === "REACHED" ? " is-reached" : ""}`} key={`${milestone.stage}-${index}`}>{milestone.label} · {fmtPercent(milestone.releaseBps)}</span>)}</div>
          </div>}
          {item.highlights.length > 0 && <div className="ag-tags">{item.highlights.slice(0, 5).map((value) => <span className="ag-chip" key={value}>{value}</span>)}</div>}
        </div>}
      </div>
      <div className="ag-card-foot">
        <button type="button" className="ag-link" onClick={() => setOpenId(open ? null : item.id)} aria-expanded={open}>{open ? "Hide details" : "View details"} <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none" }}/></button>
        <button type="button" className="ag-btn ag-btn--invest" onClick={() => openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.minimumInvestmentMinor || 0, 100_000))}>
          <Coins size={14}/> Invest now
        </button>
      </div>
    </article>;
  };

  return <div className="arb-page portal-page ag-page">
    <header className="ag-hero" aria-label="Agro Investment desk">
      <div className="ag-hero-glow" aria-hidden="true" />
      <div className="ag-masthead">
        <div className="ag-masthead-lead">
          <span className="ag-eyebrow ag-eyebrow--gold">Agro Investment · Production capital</span>
          <h1 className="ag-title">Invest in agriculture — crops, livestock, land and agribusiness.</h1>
          <p className="ag-lede">Every entry below is agriculture-only: row crops, orchards &amp; vineyards, livestock, dairy, poultry, aquaculture, greenhouse, farmland, irrigation &amp; water, farm machinery, storage &amp; logistics, agri inputs, agritech or processing — {AGRO_INVESTMENT_TYPES.length} fundable types. You can invest in production and crop opportunities, and an administrator can publish any new agriculture opportunity by selecting its type. Public agriculture sources publish context but never deal economics, so nothing here is invented: every listed opportunity can be invested in, and an administrator-published dossier adds the sourced funding target and settlement multiple. Commitments settle in {settlement}, draw from any wallet you hold or from all wallets combined at the live rate, and the principal is held against the opportunity's published milestones.</p>
        </div>
        <div className="ag-masthead-side">
          <div className="ag-sources">
            <span className={`ag-source-chip${degraded ? " is-degraded" : " is-ok"}`}>{degraded ? "Some catalogue sources degraded" : "Live administrator economics"}</span>
            {sources.map((source) => <span className={`ag-source-chip is-${source.status}`} key={source.name} title={source.detail || source.url}>
              {source.status === "ok" ? <Check size={11}/> : <AlertTriangle size={11}/>} {source.name}
            </span>)}
          </div>
          <button type="button" className="ag-btn ag-btn--ghost ag-btn--sm" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh the desk"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>

      {seasonReel.length > 0 && <div className="ag-marquee" aria-label="Crops and land opportunities">
        <span className="ag-marquee-label"><Leaf size={12}/> Crops &amp; land</span>
        <div className="ag-marquee-track">
          {seasonReel.slice(0, 6).map((item) => <button type="button" key={item.id} className="ag-marquee-item" onClick={() => { setTab("season"); setOpenId(item.id); }}>
            <b>{item.flag} {item.title}</b><small>{agroTypeLabel(item.agroType)} · {item.eventDate ? formatDate(item.eventDate) : daysLabel(item.remainingDays)}</small>
          </button>)}
        </div>
      </div>}

      <div className="ag-figures">
        <div className="ag-figure ag-figure--green"><b>{summary.published}</b><span>Published opportunities</span></div>
        <div className="ag-figure ag-figure--gold"><b>{summary.cropsAndLand}</b><span>Crops &amp; land opportunities</span></div>
        <div className="ag-figure ag-figure--blue"><b>{fmtMinor(summary.committedMinor)}</b><span>Your committed</span></div>
        <div className="ag-figure ag-figure--red"><b>{fmtMinor(summary.distributedMinor)}</b><span>Distributed to you</span></div>
      </div>
    </header>

    {market.isError && <div className="ag-notice is-error" role="alert">
      <AlertTriangle size={16}/>
      <div><strong>The desk could not reach the account service.</strong> {market.error?.message || "Administrator-published agriculture opportunities could not be loaded."} Retry to reconnect.</div>
      <button type="button" className="ag-btn ag-btn--ghost ag-btn--sm" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {storeWarning && <div className="ag-notice" role="status"><AlertTriangle size={16}/><div>{storeWarning}</div></div>}
    {message && !target && <div className="ag-notice is-error" role="alert"><AlertTriangle size={16}/><div>{message}</div></div>}

    <nav className="ag-tabs" aria-label="Agro Investment workspace">
      <button type="button" className={`ag-tab${tab === "board" ? " is-active" : ""}`} onClick={() => setTab("board")}><Layers3 size={14}/> Opportunity board <span className="ag-tab-count">{opportunities.length}</span></button>
      <button type="button" className={`ag-tab${tab === "season" ? " is-active" : ""}`} onClick={() => setTab("season")}><Wheat size={14}/> Crops &amp; land <span className="ag-tab-count">{seasonReel.length}</span></button>
      <button type="button" className={`ag-tab${tab === "positions" ? " is-active" : ""}`} onClick={() => setTab("positions")}><Coins size={14}/> My investments <span className="ag-tab-count">{positions.length}</span></button>
      <button type="button" className={`ag-tab${tab === "timeline" ? " is-active" : ""}`} onClick={() => setTab("timeline")}><CalendarClock size={14}/> Season calendar <span className="ag-tab-count">{fundable.length}</span></button>
      <button type="button" className={`ag-tab${tab === "analytics" ? " is-active" : ""}`} onClick={() => setTab("analytics")}><TrendingUp size={14}/> Desk analytics</button>
    </nav>

    {(tab === "board" || tab === "season") && <section className="ag-section" aria-label="Agriculture opportunity board">
      <div className="ag-lanes" aria-label="Agriculture investment types">
        <button type="button" className={`ag-lane${type === "ALL" && sector === "ALL" ? " is-active" : ""}`} aria-pressed={type === "ALL" && sector === "ALL"} onClick={() => { setType("ALL"); setSector("ALL"); }}>
          <span className="ag-lane-media"><img src={FIELD_HERO_ART} alt="" loading="lazy"/><Sprout size={16} className="ag-lane-glyph"/></span>
          <span className="ag-lane-body"><strong>All agriculture</strong><small>The whole desk · {AGRO_INVESTMENT_TYPES.length} types</small></span>
          <span className="ag-lane-count">{opportunities.length}</span>
        </button>
        {AGRO_TYPE_GROUPS.map((group) => {
          const count = opportunities.filter((item) => group.types.includes(item.agroType)).length;
          const active = group.types.includes(type as AgroInvestmentType);
          return <button type="button" key={group.label} className={`ag-lane${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => setType(active ? "ALL" : group.types[0])}>
            <span className="ag-lane-media"><img src={TYPE_GROUP_ART[group.label]} alt="" loading="lazy"/><Sparkles size={16} className="ag-lane-glyph"/></span>
            <span className="ag-lane-body"><strong>{group.label}</strong><small>{group.detail}</small><em className="ag-lane-types">{group.types.map((value) => agroTypeLabel(value)).join(" · ")}</em></span>
            <span className="ag-lane-count">{count}</span>
          </button>;
        })}
      </div>

      <div className="ag-toolbar">
        <div className="ag-filters">
          <div className="ag-filter"><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, operator, offtaker or type"/></div>
          <div className="ag-filter"><label>Type</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="ALL">All {AGRO_INVESTMENT_TYPES.length} types</option>{AGRO_INVESTMENT_TYPES.map((value) => <option key={value} value={value}>{agroTypeLabel(value)}</option>)}</select></div>
          <div className="ag-filter"><label>Sector</label><select value={sector} onChange={(e) => setSector(e.target.value)}><option value="ALL">All sectors</option>{AGRO_SECTORS.map((value) => <option key={value} value={value}>{sectorLabel(value as AgroSector)}</option>)}</select></div>
          <div className="ag-filter"><label>Territory</label><select value={territory} onChange={(e) => setTerritory(e.target.value)}><option value="ALL">All territories</option>{AGRO_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</select></div>
          <div className="ag-filter"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option>{AGRO_DOSSIER_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>
          <div className="ag-filter"><label>Stage</label><select value={stage} onChange={(e) => setStage(e.target.value)}><option value="ALL">All stages</option>{AGRO_STAGES.map((value) => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></div>
          <div className="ag-filter"><label>Risk</label><select value={riskGrade} onChange={(e) => setRiskGrade(e.target.value)}><option value="ALL">All grades</option>{AGRO_RISK_GRADES.map((value) => <option key={value} value={value}>{riskGradeLabel(value)}</option>)}</select></div>
          <div className="ag-filter"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fundable">Open for investment first</option><option value="deadline">Closing soonest</option><option value="season">Season date soonest</option><option value="ask">Largest funding target</option><option value="multiple">Highest expected multiple</option><option value="name">Title A–Z</option><option value="type">Type A–Z</option><option value="sector">Sector A–Z</option></select></div>
        </div>
        <div className="ag-toolbar-actions">
          <label className="ag-checkbox"><input type="checkbox" checked={fundableOnly} onChange={(e) => setFundableOnly(e.target.checked)}/> Open for investment only</label>
          <label className="ag-checkbox"><input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)}/> Watchlist ({watchlist.length})</label>
          <button type="button" className="ag-btn ag-btn--ghost ag-btn--sm" onClick={exportCatalogue} disabled={!filtered.length}><Download size={13}/> Export CSV</button>
          {activeFilters > 0 && <button type="button" className="ag-btn ag-btn--ghost ag-btn--sm" onClick={clearFilters}><X size={13}/> Clear {activeFilters}</button>}
        </div>
      </div>

      {tab === "season" && <div className="ag-section-head">
        <div><span className="ag-eyebrow ag-eyebrow--gold">Crops &amp; land</span><h2>Crop, orchard, greenhouse &amp; farmland opportunities</h2><p>Only administrator-published row-crop, orchard &amp; vineyard, greenhouse and farmland opportunities with sourced economics appear here — the seasonal production opportunities you can invest in. Order by season date to see what is coming up next.</p></div>
      </div>}

      {market.isLoading && !opportunities.length && <div className="ag-grid">{Array.from({ length: 6 }).map((_, index) => <div className="ag-card is-skeleton" key={index}><div className="ag-card-media" /><div className="ag-card-body"><div className="ag-card-sub"><span className="ag-spinner" /> Loading agriculture opportunities…</div></div></div>)}</div>}
      {!market.isLoading && !opportunities.length && <div className="ag-empty"><CircleHelp size={16}/> No agriculture opportunities are on the desk right now. An administrator publishes crop, livestock and other agriculture opportunities by type; check back soon.</div>}
      {opportunities.length > 0 && !scoped.length && <div className="ag-empty"><CircleHelp size={16}/> {tab === "season" ? "No crops-and-land opportunities are open for investment right now." : "No opportunities match the current filters. Clear the search or widen the filters."}</div>}

      {scoped.length > 0 && <div className="ag-grid">{pageRows.map((item, index) => renderCard(item, (currentPage - 1) * pageSize + index + 1, tab === "season" ? TYPE_GROUP_ART["Crops & Land"] : undefined))}</div>}

      {scoped.length > 0 && <div className="ag-pagination">
        <button type="button" className="ag-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14}/> Previous</button>
        <span className="ag-eyebrow">Page {currentPage} of {pageCount} · {scoped.length} of {opportunities.length}</span>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / page</option>)}</select>
        <button type="button" className="ag-page-btn" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight size={14}/></button>
      </div>}
    </section>}

    {tab === "positions" && <section className="ag-section" aria-label="Your agro investment positions">
      <div className="ag-section-head">
        <div><span className="ag-eyebrow ag-eyebrow--gold">Your investments</span><h2>Agriculture commitments &amp; distributions</h2></div>
        <div className="ag-toolbar-actions">
          <span className="ag-chip"><ShieldCheck size={12}/> Settled in {settlement} · {fmtMinor(available)} available</span>
          <button type="button" className="ag-btn ag-btn--ghost ag-btn--sm" onClick={exportPositions} disabled={!positions.length}><Download size={13}/> Export CSV</button>
        </div>
      </div>
      <div className="ag-hero-stats">
        <div className="ag-stat"><strong>{fmtMinor(summary.committedMinor)}</strong><span>Committed (held)</span></div>
        <div className="ag-stat"><strong>{summary.activePositions}</strong><span>Active positions</span></div>
        <div className="ag-stat ag-stat--green"><strong>{fmtMinor(summary.distributedMinor)}</strong><span>Distributions credited</span></div>
        <div className="ag-stat"><strong>{summary.settledPositions}</strong><span>Settled</span></div>
        <div className="ag-stat ag-stat--red"><strong>{summary.writtenOffPositions}</strong><span>Written off</span></div>
      </div>
      {!positions.length && <div className="ag-empty"><Coins size={16}/> No agriculture investments yet. Fund a crop, livestock, land or agribusiness opportunity to open a position — the amount is debited from your wallet and held against the opportunity.</div>}
      {positions.length > 0 && <div className="ag-table-wrap">
        <table className="ag-table">
          <thead><tr><th>Position</th><th>Opportunity</th><th>Type</th><th>Sector</th><th>Amount</th><th>Funding</th><th>Expected</th><th>Distributed</th><th>Outcome</th><th>Realised</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((position: any) => <tr key={position.id}>
              <td className="ag-mono">{position.positionCode}</td>
              <td>{position.instrumentName}</td>
              <td>{position.agroType ? agroTypeLabel(position.agroType) : "—"}</td>
              <td>{position.sector ? sectorLabel(position.sector) : "—"}</td>
              <td>{fmtMinor(Number(position.amountMinor))}</td>
              <td>{position.fundingSource === "COMBINED" ? "Combined" : position.fundingSource || position.currency}</td>
              <td>{fmtMultiple(position.expectedMultipleBps)}</td>
              <td>{fmtMinor(Number(position.distributedMinor || 0))}</td>
              <td>{position.outcome ? outcomeLabel(position.outcome) : "—"}</td>
              <td>{position.realisedMinor !== null && position.realisedMinor !== undefined ? fmtMinor(Number(position.realisedMinor)) : "—"}</td>
              <td>{formatDate(position.openedAt)}</td>
              <td><span className="ag-chip">{position.positionStatus}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>}

    {tab === "timeline" && <section className="ag-section" aria-label="Agriculture season calendar">
      <div className="ag-section-head"><div><span className="ag-eyebrow ag-eyebrow--gold">Season calendar</span><h2>Planting &amp; harvest windows and funding deadlines</h2><p>Crop, orchard, greenhouse and farmland opportunities with their season dates, alongside the funding deadline for each open opportunity. A deadline is never moved once an investment is committed.</p></div></div>
      {!fundable.length && <div className="ag-empty"><CalendarClock size={16}/> No open opportunities yet. The calendar fills as administrators publish agriculture opportunities with sourced economics.</div>}
      <div className="ag-calendar">
        {fundable.slice().sort((a, b) => (a.eventDate || a.fundingDeadline || "9999").localeCompare(b.eventDate || b.fundingDeadline || "9999")).map((item, index) => <div className="ag-calendar-row" key={item.id}>
          <span className="ag-calendar-rank">{String(index + 1).padStart(2, "0")}</span>
          <div className="ag-calendar-main">
            <strong>{item.flag} {item.title}</strong>
            <div className="ag-card-sub"><Wheat size={12}/> {agroTypeLabel(item.agroType)} · {sectorLabel(item.sector)} · {item.territory}</div>
          </div>
          <div className="ag-calendar-dates">
            {item.eventDate ? <span className="ag-chip ag-chip--event"><CalendarClock size={11}/> Season {formatDate(item.eventDate)}</span> : null}
            <span className="ag-chip">{daysLabel(item.remainingDays)}</span>
          </div>
          <button type="button" className="ag-btn ag-btn--invest ag-btn--sm" onClick={() => openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.minimumInvestmentMinor || 0, 100_000))}><Coins size={13}/> Invest</button>
        </div>)}
      </div>
    </section>}

    {tab === "analytics" && <section className="ag-section" aria-label="Agriculture analytics">
      <div className="ag-section-head"><div><span className="ag-eyebrow ag-eyebrow--gold">Desk analytics</span><h2>What is on the desk</h2><p>Desk-level aggregates computed only from the agriculture opportunities above — how the opportunity set splits by type, sector, territory and stage, and how much is raising. No figure is inferred beyond the records themselves.</p></div></div>
      {!opportunities.length ? <div className="ag-empty"><CircleHelp size={16}/> No opportunities published yet — analytics appear once administrator economics arrive.</div> : <div className="ag-analytics">
        <div className="ag-analytics-card ag-analytics-split">
          <div className="ag-analytics-stat"><b>{analytics.totalOpportunities}</b><span>Opportunities</span></div>
          <div className="ag-analytics-stat"><b>{analytics.fundableCount}</b><span>Open for investment</span></div>
          <div className="ag-analytics-stat ag-analytics-stat--gold"><b>{analytics.cropsAndLand}</b><span>Crops &amp; land</span></div>
          <div className="ag-analytics-stat ag-analytics-stat--green"><b>{fmtMinor(analytics.raisingMinor)}</b><span>Total raising</span></div>
          <div className="ag-analytics-stat"><b>{fmtMinor(analytics.committedMinor)}</b><span>Committed on desk</span></div>
        </div>

        <div className="ag-analytics-grid">
          <div className="ag-analytics-card">
            <h3>By type</h3>
            {analytics.byType.map((bucket) => <div className="ag-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ag-bar-track"><div className="ag-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / maxTypeCount)}%` }} /></div>
              <b className="ag-mono">{bucket.count}</b>
            </div>)}
          </div>
          <div className="ag-analytics-card">
            <h3>By sector</h3>
            {analytics.bySector.map((bucket) => <div className="ag-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ag-bar-track"><div className="ag-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.bySector[0].count))}%` }} /></div>
              <b className="ag-mono">{bucket.count}</b>
            </div>)}
          </div>
          <div className="ag-analytics-card">
            <h3>By territory</h3>
            {!analytics.byTerritory.length && <p className="ag-card-meta">No territories published.</p>}
            {analytics.byTerritory.map((bucket) => <div className="ag-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ag-bar-track"><div className="ag-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byTerritory[0].count))}%` }} /></div>
              <b className="ag-mono">{bucket.count}</b>
            </div>)}
          </div>
          <div className="ag-analytics-card">
            <h3>By stage</h3>
            {analytics.byStage.map((bucket) => <div className="ag-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="ag-bar-track"><div className="ag-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byStage[0].count))}%` }} /></div>
              <b className="ag-mono">{bucket.count}</b>
            </div>)}
          </div>
        </div>
      </div>}
    </section>}

    <div id="ag-education" className="ag-notice ag-education">
      <ShieldCheck size={16}/>
      <div>
        <strong>How the Agro Investment desk works.</strong> This desk is agriculture-only across {AGRO_INVESTMENT_TYPES.length} investment types — {AGRO_TYPE_GROUPS.map((group) => `${group.label} (${group.types.map((value) => agroTypeLabel(value)).join(", ")})`).join("; ")}. IP royalties, NFTs, music royalties, green energy and carbon credits have their own menus and are excluded here. You can invest in crop and production opportunities; an administrator publishes any new agriculture opportunity by selecting its type, and every displayed figure is administrator-supplied and cited. The discovery layer (the keyless World Bank Open Data feed) publishes agriculture context but never deal economics; every listed opportunity — including a cited reference — can be invested in, and an administrator-published dossier adds the sourced funding target and settlement multiple. Your commitment settles in {settlement}, is drawn from any wallet you hold or from all wallets combined at the live rate, the wallet is debited on submit, and the principal is held against the opportunity. Recorded distributions are credited pro-rata to your wallet as internal-ledger entries; at settlement the principal is released against the administrator-configured multiple, or written off. Nothing here is a prediction, and no external transfer occurs on this desk.
      </div>
    </div>

    {target && <div className="ag-modal" onMouseDown={() => setTarget(null)}>
      <div className="ag-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ag-modal-head">
          <strong><Coins size={15}/> Invest in an agriculture opportunity</strong>
          <button type="button" className="ag-btn ag-btn--ghost ag-btn--sm" onClick={() => setTarget(null)}><X size={16}/></button>
        </div>
        <div className="ag-modal-body">
          <div className="ag-card-title">{target.name}</div>
          <div className="ag-card-meta"><span>Funded through the wallet ledger</span><span>Expected {fmtMultiple(target.expectedMultipleBps)}</span></div>

          <div className="ag-field">
            <label>Investment amount ({settlement})</label>
            <input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))} />
            <small>Your wallet will be debited on submit. You can pay from the {settlement} wallet, any single wallet, or all wallets combined.</small>
          </div>

          <div>
            <span className="ag-eyebrow">Pay from</span>
            <div className="ag-funding">
              <button type="button" className={`ag-funding-option${fundingSource === "COMBINED" ? " is-selected" : ""}`} onClick={() => setFundingSource("COMBINED")}>
                <Layers3 size={14}/> <span><strong>Combined balance</strong><small>All wallets, converted at the live rate</small></span>
                {quote?.fundingSource === "COMBINED" && quote?.combinedAvailableMinor !== null && quote?.combinedAvailableMinor !== undefined && <b>{fmtMinor(quote.combinedAvailableMinor)}</b>}
              </button>
              {fundedWallets.map((wallet) => <button type="button" key={wallet.currency} className={`ag-funding-option${fundingSource === wallet.currency ? " is-selected" : ""}`} onClick={() => setFundingSource(wallet.currency)}>
                <Coins size={14}/> <span><strong>{wallet.currency}</strong><small>{wallet.currencyName || "Wallet"}</small></span>
                <b>{moneyMinor(wallet.availableMinor, wallet.currency, wallet.scale)}</b>
              </button>)}
              {!fundedWallets.length && <p className="ag-card-meta">No funded wallets detected yet.</p>}
            </div>
          </div>

          <div className="ag-quote">
            {quoteLoading && <span>Checking funding at the live rate…</span>}
            {!quoteLoading && !quote && <span>Enter an amount to see how it will be funded.</span>}
            {!quoteLoading && quote?.sufficient && <>
              <strong className="ag-ok"><Check size={13}/> Funded by {quote.fundingSource === "COMBINED" ? "combined wallets" : quote.fundingSource}</strong>
              {quote.usdAvailableMinor > 0 && quote.convertedUsdMinor < quote.amountMinor && <div className="ag-quote-row"><span>{settlement} wallet</span><span>{fmtMinor(Math.max(0, quote.amountMinor - quote.convertedUsdMinor))}</span></div>}
              {(quote.debits || []).map((debit: any) => <div className="ag-quote-row" key={debit.currency}><span>{debit.currency} → {fmtMinor(debit.convertedUsdMinor)} @ {debit.rate} <em>{debit.rateProvider}</em></span><span>{moneyMinor(debit.amountMinor, debit.currency, wallets.find((wallet) => wallet.currency === debit.currency)?.scale ?? 2)}</span></div>)}
            </>}
            {!quoteLoading && quote && !quote.sufficient && <div>
              <strong className="ag-bad"><AlertTriangle size={13}/> Insufficient balance</strong>
              <span>{quote.message}{quote.combinedAvailableMinor !== null && quote.combinedAvailableMinor !== undefined ? ` Combined available: ${fmtMinor(quote.combinedAvailableMinor)}.` : ""}</span>
            </div>}
          </div>

          <div className="ag-notice"><ShieldCheck size={15}/><div>Confirming debits your chosen wallet(s) through the existing internal ledger, holds the principal and creates a durable position. Duplicate requests are idempotent. Recorded distributions are credited pro-rata as they are published; at settlement the principal is released against the administrator-configured multiple, or written off. No external transfer occurs on this desk.</div></div>
          {message && <div className="ag-notice is-error" role="alert"><AlertTriangle size={15}/><div>{message}</div></div>}
        </div>
        <div className="ag-modal-foot">
          <button className="ag-btn ag-btn--ghost" onClick={() => setTarget(null)}>Cancel</button>
          <button className="ag-btn ag-btn--invest" disabled={purchase.isPending || quoteLoading || (quote ? !quote.sufficient : false)} onClick={submitPurchase}>{purchase.isPending ? "Recording investment…" : "Confirm & debit wallet"} <Check size={14}/></button>
        </div>
      </div>
    </div>}

    <div className="ag-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ShieldCheck size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{opportunities.length} opportunities · {fundable.length} open · {positions.length} positions</span>
      <span><BadgeCheck size={12}/> {sources.length} cited sources</span>
    </div>
  </div>;
}
