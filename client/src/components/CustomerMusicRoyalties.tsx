import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { visibilityAwareRefetchInterval } from "@/visibility-aware-polling";
import {
  AlertTriangle, BadgeCheck, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Coins, Disc3, Download, Guitar, Headphones, Layers3, Mic2, Music2, Music4, PartyPopper,
  Radio, RefreshCw, ShieldCheck, Sparkles, Star, Ticket, TrendingUp, Trophy, Users, X,
  type LucideIcon,
} from "lucide-react";
import {
  MUSIC_DOSSIER_STATUSES,
  MUSIC_GENRES,
  MUSIC_INVESTMENT_TYPES,
  MUSIC_RISK_GRADES,
  MUSIC_STAGES,
  MUSIC_TERRITORY_BANDS,
  MUSIC_TYPE_GROUPS,
  buildMusicAnalytics,
  genreLabel,
  getMusicRoyaltiesCatalogue,
  musicTypeBlurb,
  musicTypeLabel,
  outcomeLabel,
  riskGradeLabel,
  stageLabel,
  statusLabel,
  type MusicGenre,
  type MusicInvestmentType,
  type MusicOpportunity,
  type MusicRiskGrade,
  type MusicRoyaltiesSource,
} from "@shared/music-royalties-catalogue";
import "./music-royalties.css";

const MARKET_POLL_INTERVAL_MS = 90_000;
const WATCHLIST_KEY = "music-royalties-watchlist";
const PAGE_SIZES = [6, 12, 24];

/* The desk's own stage-and-studio imagery, drawn as self-contained inline SVG
   data URIs in a deep-navy and gold palette. Because it is embedded in the
   bundle it always renders in the portal — the desk never depends on an external
   image-generation service that needs authentication and fails in production. */
const MR_ART_BG = `<defs>
  <linearGradient id="mrbg" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="#12356e"/><stop offset="0.55" stop-color="#0a2148"/><stop offset="1" stop-color="#061733"/></linearGradient>
  <radialGradient id="mrglow" cx="0.5" cy="-0.05" r="1.1"><stop offset="0" stop-color="#d9a63d" stop-opacity="0.32"/><stop offset="1" stop-color="#d9a63d" stop-opacity="0"/></radialGradient>
  <linearGradient id="mrgold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0cd7e"/><stop offset="1" stop-color="#d9a63d"/></linearGradient>
</defs>
<rect width="400" height="260" fill="url(#mrbg)"/>
<rect width="400" height="260" fill="url(#mrglow)"/>
<g stroke="#8fb6f4" stroke-opacity="0.08" stroke-width="1">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<line x1="0" y1="${i * 26}" x2="400" y2="${i * 26}"/>`).join("")}</g>`;

const mrArt = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">${MR_ART_BG}${body}</svg>`)}`;

const STAGE_HERO_ART = mrArt(`
  <path d="M150 -10 L190 150 L60 150 Z" fill="#f0cd7e" fill-opacity="0.14"/>
  <path d="M250 -10 L340 150 L200 150 Z" fill="#5b93f0" fill-opacity="0.16"/>
  <line x1="200" y1="40" x2="200" y2="168" stroke="#f0cd7e" stroke-width="3" stroke-opacity="0.9"/>
  <circle cx="200" cy="34" r="8" fill="url(#mrgold)"/>
  <path d="M0 205 Q120 176 200 196 T400 190 L400 260 L0 260 Z" fill="#04101f" fill-opacity="0.92"/>
  <g fill="#0a2148">${[40, 80, 120, 160, 200, 240, 280, 320, 360].map((x, i) => `<circle cx="${x}" cy="${212 + (i % 2) * 6}" r="14"/>`).join("")}</g>
  <g fill="#f0cd7e" fill-opacity="0.85"><circle cx="150" cy="60" r="2"/><circle cx="250" cy="52" r="1.6"/><circle cx="205" cy="92" r="1.6"/><circle cx="120" cy="120" r="1.4"/><circle cx="290" cy="112" r="1.4"/></g>`);

const TYPE_GROUP_ART: Record<string, string> = {
  "Live & Events": mrArt(`
    <path d="M0 46 Q100 74 200 46 T400 46" fill="none" stroke="#8fb6f4" stroke-opacity="0.5" stroke-width="2"/>
    <g>${[60, 120, 180, 240, 300, 350].map((x, i) => `<path d="M${x} 46 L${x + 14} ${62 + (i % 2) * 6} L${x + 28} 46 Z" fill="${i % 2 ? "#d9a63d" : "#5b93f0"}" fill-opacity="0.85"/>`).join("")}</g>
    <rect x="120" y="150" width="160" height="70" rx="10" fill="#0a2148" stroke="#d9a63d" stroke-opacity="0.6"/>
    <line x1="200" y1="150" x2="200" y2="220" stroke="#8fb6f4" stroke-opacity="0.5" stroke-dasharray="5 5"/>
    <circle cx="200" cy="185" r="10" fill="none" stroke="#f0cd7e" stroke-width="2"/>
    <path d="M150 236 h100" stroke="#f0cd7e" stroke-width="3" stroke-linecap="round"/>`),
  "Artists & Releases": mrArt(`
    <circle cx="150" cy="128" r="74" fill="#04101f"/>
    <circle cx="150" cy="128" r="74" fill="none" stroke="#8fb6f4" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="150" cy="128" r="52" fill="none" stroke="#8fb6f4" stroke-opacity="0.25" stroke-width="1.5"/>
    <circle cx="150" cy="128" r="30" fill="none" stroke="#8fb6f4" stroke-opacity="0.2" stroke-width="1.5"/>
    <circle cx="150" cy="128" r="14" fill="url(#mrgold)"/>
    <g stroke="#f0cd7e" stroke-width="3" stroke-linecap="round" stroke-opacity="0.9">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<line x1="${250 + i * 16}" y1="${128 - (6 + ((i * 7) % 18))}" x2="${250 + i * 16}" y2="${128 + (6 + ((i * 7) % 18))}"/>`).join("")}</g>`),
  "Rights & Catalogue": mrArt(`
    <rect x="96" y="60" width="150" height="150" rx="8" fill="#0a2148" stroke="#8fb6f4" stroke-opacity="0.35"/>
    <rect x="116" y="40" width="150" height="150" rx="8" fill="#0e2a5a" stroke="#8fb6f4" stroke-opacity="0.4"/>
    <g stroke="#8fb6f4" stroke-opacity="0.4" stroke-width="4" stroke-linecap="round">
      <line x1="136" y1="78" x2="246" y2="78"/><line x1="136" y1="98" x2="226" y2="98"/><line x1="136" y1="118" x2="246" y2="118"/><line x1="136" y1="138" x2="206" y2="138"/>
    </g>
    <circle cx="252" cy="178" r="26" fill="url(#mrgold)"/>
    <path d="M242 198 l-6 26 16-10 16 10 -6-26" fill="#d9a63d"/>
    <path d="M244 178 l6 7 12-15" fill="none" stroke="#1a1204" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),
  "Brands & Commercial": mrArt(`
    <path d="M118 96 l20 30 -20 30 34-10 10 32 20-34 34 10 -20-30 20-30 -34 10 -10-32 -20 34 Z" fill="#0e2a5a" stroke="#d9a63d" stroke-opacity="0.7" stroke-width="2"/>
    <circle cx="150" cy="128" r="24" fill="none" stroke="#f0cd7e" stroke-width="2"/>
    <path d="M140 118 l10-5 10 5 7 18 -9 4 -4-10 -4 10 -9-4 Z" fill="#5b93f0" fill-opacity="0.4" stroke="#8fb6f4" stroke-opacity="0.6"/>
    <rect x="240" y="72" width="90" height="60" rx="6" fill="#0a2148" stroke="#8fb6f4" stroke-opacity="0.4"/>
    <path d="M240 92 h90 M240 112 h90" stroke="#f0cd7e" stroke-opacity="0.8" stroke-width="3"/>
    <path d="M240 72 l90 20" stroke="#f0cd7e" stroke-opacity="0.5" stroke-width="2"/>`),
};

const TYPE_ICON: Record<MusicInvestmentType, LucideIcon> = {
  SHOW_CONCERT: Mic2,
  FESTIVAL: PartyPopper,
  TOUR: Ticket,
  NEW_ARTIST: Sparkles,
  NEW_ALBUM: Disc3,
  ENDORSEMENT_DEAL: BadgeCheck,
  BRAND_LABEL: Trophy,
  MASTER_RIGHTS: Music4,
  PUBLISHING_CATALOGUE: Music2,
  SYNC_LICENSING: Headphones,
  MERCHANDISE: Guitar,
  MUSIC_VIDEO: Radio,
  CATALOGUE_ACQUISITION: Layers3,
  ROYALTY_STREAM: TrendingUp,
};

const LIVE_TYPES: MusicInvestmentType[] = ["SHOW_CONCERT", "FESTIVAL", "TOUR"];

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

const riskTone = (grade: MusicRiskGrade | null) => (grade ? grade.toLowerCase() : "unrated");

function SlotBar({ bps }: { bps: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(bps) || 0) / 100)));
  return <div className="mr-progress-bar"><i style={{ width: `${pct}%` }} /></div>;
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
 * Customer desk for Music Royalties. This desk is music-only and every fundable
 * instrument is an administrator-published music dossier — a show or concert, a
 * festival, a tour, a new artist or album, an endorsement deal, a brand label, a
 * master or publishing right, a sync deal, merchandise, a music video, a
 * catalogue acquisition or a royalty stream. Public music catalogues (the iTunes
 * search index) publish titles and artists but never deal economics, so the
 * discovery layer is cited, not synthesised, and carries no investment button:
 * only an administrator-published dossier with sourced economics is fundable.
 * Commitments settle in USD and may be funded from the settlement wallet, any
 * single wallet, or all wallets combined through live FX — the same
 * internal-ledger cross-wallet engine as the rest of the platform. The principal
 * is held and released against the opportunity's published milestones.
 */
export function CustomerMusicRoyalties({ push }: { push: (message: string) => void }) {
  const market = trpc.customer.musicRoyalties.market.useQuery(undefined, {
    refetchInterval: (query) => visibilityAwareRefetchInterval(MARKET_POLL_INTERVAL_MS, query.state.fetchFailureCount),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"reel" | "live" | "positions" | "timeline" | "analytics">("reel");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("ALL");
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

  const purchase = trpc.customer.musicRoyalties.purchase.useMutation({
    onSuccess: (result: any) => {
      setTarget(null);
      setAmount(0);
      setTab("positions");
      void utils.customer.musicRoyalties.market.invalidate();
      void utils.customer.balances.invalidate();
      void utils.customer.musicRoyalties.market.refetch();
      push(`+ Music Royalties investment recorded · ${result.instrumentName} (${result.positionCode})`);
    },
    onError: (error: { message: string }) => setMessage(error.message),
  });

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);

  const opportunities = useMemo(() => (market.data?.opportunities || []) as MusicOpportunity[], [market.data]);
  const positions: any[] = (market.data?.positions || []) as any[];
  const wallets: WalletBalance[] = (market.data?.wallets || market.data?.balances || []) as WalletBalance[];
  const fundedWallets = wallets.filter((wallet) => Number(wallet.availableMinor || 0) > 0);
  const settlement = String(market.data?.settlementCurrency || "USD");
  const settlementWallet = wallets.find((wallet) => wallet.currency === settlement);
  const available = Number(settlementWallet?.availableMinor ?? market.data?.availableMinor ?? 0);
  const summary = market.data?.summary || {
    committedMinor: 0, activePositions: 0, settledPositions: 0, writtenOffPositions: 0,
    fundableOpportunities: 0, showsAndConcerts: 0, published: 0, realisedMinor: 0, distributedMinor: 0,
  };
  const storeWarning = String((market.data as any)?.storeWarning || "");

  // The discovery layer cites the public iTunes catalogue but publishes no deal
  // economics; an administrator dossier supplies those. When the account service
  // is unreachable we still surface the cited sources directly from the shared
  // module so the desk explains itself; nothing is ever fabricated.
  const [fallbackSources, setFallbackSources] = useState<MusicRoyaltiesSource[] | null>(null);
  useEffect(() => {
    if (market.isLoading || market.isFetching || market.data) return;
    let cancelled = false;
    (async () => {
      try {
        const catalogue = await getMusicRoyaltiesCatalogue();
        if (!cancelled) setFallbackSources(catalogue.sources);
      } catch { /* leave null; the error notice already explains the state */ }
    })();
    return () => { cancelled = true; };
  }, [market.isLoading, market.isFetching, market.data]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = opportunities.filter((item) => {
      if (genre !== "ALL" && item.genre !== genre) return false;
      if (type !== "ALL" && item.musicType !== type) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (stage !== "ALL" && item.stage !== stage) return false;
      if (riskGrade !== "ALL" && item.riskGrade !== riskGrade) return false;
      if (territory !== "ALL" && item.territoryBand !== territory) return false;
      if (fundableOnly && !item.fundable) return false;
      if (watchlistOnly && !watchlist.includes(item.id)) return false;
      if (normalized && !`${item.title} ${item.artist} ${item.label ?? ""} ${item.territory} ${item.country} ${item.description} ${musicTypeLabel(item.musicType)} ${genreLabel(item.genre)}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sort === "fundable") return (b.fundable ? 1 : 0) - (a.fundable ? 1 : 0) || b.fundedBps - a.fundedBps || a.title.localeCompare(b.title);
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "deadline") return (a.remainingDays ?? 9_999) - (b.remainingDays ?? 9_999);
      if (sort === "ask") return (b.fundingAskMinor || 0) - (a.fundingAskMinor || 0);
      if (sort === "multiple") return (b.expectedMultipleBps || 0) - (a.expectedMultipleBps || 0);
      if (sort === "event") return (a.eventDate || "9999").localeCompare(b.eventDate || "9999");
      if (sort === "type") return musicTypeLabel(a.musicType).localeCompare(musicTypeLabel(b.musicType)) || a.title.localeCompare(b.title);
      if (sort === "genre") return genreLabel(a.genre).localeCompare(genreLabel(b.genre)) || a.title.localeCompare(b.title);
      return 0;
    });
    return sorted;
  }, [opportunities, query, genre, type, status, stage, riskGrade, territory, fundableOnly, watchlistOnly, watchlist, sort]);

  const fundable = opportunities.filter((item) => item.fundable);
  // The "Live stage" reel: upcoming shows, concerts, festivals and tours — the
  // surface the desk leads with for investing in upcoming shows and concerts.
  const liveReel = useMemo(
    () => fundable.filter((item) => LIVE_TYPES.includes(item.musicType)).sort((a, b) => (a.eventDate || "9999").localeCompare(b.eventDate || "9999") || b.fundedBps - a.fundedBps),
    [fundable],
  );

  // On the Live stage tab only fundable shows, concerts, festivals and tours are
  // paginated, so the page count always matches what that tab can show.
  const scoped = useMemo(
    () => tab === "live" ? filtered.filter((item) => item.fundable && LIVE_TYPES.includes(item.musicType)) : filtered,
    [filtered, tab],
  );
  const pageCount = Math.max(1, Math.ceil(scoped.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = scoped.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, genre, type, status, stage, riskGrade, territory, fundableOnly, watchlistOnly, pageSize, tab]);

  const activeFilters = [genre !== "ALL", type !== "ALL", status !== "ALL", stage !== "ALL", riskGrade !== "ALL", territory !== "ALL", fundableOnly, watchlistOnly].filter(Boolean).length;
  const analytics = useMemo(() => buildMusicAnalytics(opportunities), [opportunities]);
  const maxTypeCount = Math.max(1, ...analytics.byType.map((bucket) => bucket.count));

  const toggleWatch = (id: string) => setWatchlist((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const clearFilters = () => { setGenre("ALL"); setType("ALL"); setStatus("ALL"); setStage("ALL"); setRiskGrade("ALL"); setTerritory("ALL"); setFundableOnly(false); setWatchlistOnly(false); setQuery(""); };

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
        const result = await utils.customer.musicRoyalties.fundingQuote.fetch({ amountMinor: Math.round(amount), fundingSource });
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
    `music-royalties-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Title", "Artist", "Type", "Genre", "Label", "Territory", "Territory band", "Country code", "Deal type", "Stage", "Status", "Risk grade", "Revenue share (bps)", "Expected multiple (bps)", "Expected duration (months)", "Projected revenue (minor)", "Capital at risk (minor)", "Funding target (minor)", "Committed (minor)", "Funded bps", "Minimum investment (minor)", "Unit price (minor)", "Event date", "Funding deadline", "Remaining days", "Fundable", "Source", "Source URL", "As of"],
    filtered.map((item) => [
      item.title, item.artist, musicTypeLabel(item.musicType), genreLabel(item.genre), item.label ?? "", item.territory, item.territoryBand,
      item.countryCode, item.dealType ?? "", stageLabel(item.stage), statusLabel(item.status), item.riskGrade ? riskGradeLabel(item.riskGrade) : "",
      item.revenueSharesBps ?? "", item.expectedMultipleBps ?? "", item.expectedDurationMonths ?? "", item.projectedRevenueMinor ?? "",
      item.capitalAtRiskMinor ?? "", item.fundingAskMinor ?? "", item.committedMinor, item.fundedBps, item.minimumInvestmentMinor ?? "",
      item.unitPriceMinor ?? "", item.eventDate ?? "", item.fundingDeadline ?? "", item.remainingDays ?? "", item.fundable ? "Yes" : "No",
      item.source, item.sourceUrl ?? "", item.asOf,
    ]),
  );

  const exportPositions = () => downloadCsv(
    `music-royalties-positions-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Position", "Instrument", "Type", "Genre", "Amount (minor)", "Currency", "Funding", "Units", "Status at buy", "Expected multiple (bps)", "Outcome", "Distributed (minor)", "Realised (minor)", "Opened", "Status"],
    positions.map((position) => [
      position.positionCode, position.instrumentName, position.musicType || "", position.genre || "",
      position.amountMinor, position.currency, position.fundingSource || "", position.units ?? "", position.statusAtPurchase || "",
      position.expectedMultipleBps ?? "", position.outcome || "", position.distributedMinor ?? "", position.realisedMinor ?? "",
      formatDate(position.openedAt), position.positionStatus,
    ]),
  );

  const sources: MusicRoyaltiesSource[] = (market.data?.sources as MusicRoyaltiesSource[]) || fallbackSources || [];
  const fetchedAt = market.data?.fetchedAt;
  const degraded = !!market.data?.degraded;

  const renderCard = (item: MusicOpportunity, rank: number, media?: string) => {
    const watched = watchlist.includes(item.id);
    const open = openId === item.id;
    const TypeIcon = TYPE_ICON[item.musicType];
    return <article className={`mr-card${item.fundable ? " is-fundable" : " is-reference"}${open ? " is-open" : ""}`} key={item.id}>
      <div className="mr-card-media">
        <img src={media || STAGE_HERO_ART} alt="" loading="lazy" />
        <span className="mr-card-rank">{String(rank).padStart(2, "0")}</span>
        <span className="mr-card-glyph" aria-hidden="true"><TypeIcon size={16}/></span>
        <span className={`mr-chip mr-chip--status-${String(item.status).toLowerCase()}`}>{statusLabel(item.status)}</span>
      </div>
      <div className="mr-card-body">
        <div className="mr-card-head">
          <h3 className="mr-card-title">{item.flag} {item.title}</h3>
          <button type="button" className={`mr-star${watched ? " is-on" : ""}`} onClick={() => toggleWatch(item.id)} aria-pressed={watched} title={watched ? "Remove from watchlist" : "Add to watchlist"}><Star size={15}/></button>
        </div>
        <div className="mr-card-sub"><Users size={12}/> {item.artist}{item.label ? ` · ${item.label}` : ""}</div>
        <div className="mr-tags">
          <span className="mr-chip mr-chip--type">{musicTypeLabel(item.musicType)}</span>
          <span className="mr-chip mr-chip--genre">{genreLabel(item.genre)}</span>
          {item.riskGrade && <span className={`mr-chip mr-chip--risk-${riskTone(item.riskGrade)}`}>{riskGradeLabel(item.riskGrade)}</span>}
          {item.dealType && <span className="mr-chip mr-chip--deal">{item.dealType}</span>}
        </div>
        <div className="mr-facts">
          <span>Stage <b>{stageLabel(item.stage)}</b></span>
          <span>Territory <b>{item.territory}</b></span>
          <span>Expected <b>{fmtMultiple(item.expectedMultipleBps)}</b></span>
          {item.eventDate ? <span>Event <b>{formatDate(item.eventDate)}</b></span> : null}
        </div>

        {item.fundable
          ? <div className="mr-progress">
              <div className="mr-progress-label"><span>Funding progress</span><span>{fmtPercent(item.fundedBps)} of {fmtMinor(item.fundingAskMinor ?? 0)}</span></div>
              <SlotBar bps={item.fundedBps} />
              <div className="mr-countdown"><CalendarClock size={12}/> {daysLabel(item.remainingDays)}{item.fundingDeadline ? ` · closes ${formatDate(item.fundingDeadline)}` : ""}</div>
            </div>
          : <div className="mr-reference-note"><AlertTriangle size={13}/> Catalogue reference only — no published economics, so it is not open for investment. This is a real, cited record; an administrator publishes the sourced economics that make an opportunity fundable.</div>}

        {open && <div className="mr-dossier">
          <div className="mr-dossier-grid">
            <div className="mr-dossier-block"><h4>Opportunity</h4><p>{item.description}</p></div>
            <div className="mr-dossier-block"><h4>Participation {item.dealType ? `· ${item.dealType}` : ""}</h4><p>{item.revenueSharesBps !== null && item.revenueSharesBps !== undefined ? `Investor share ${fmtPercent(item.revenueSharesBps)} of gross revenue. ` : ""}{item.expectedMultipleBps !== null ? `Expected ${fmtMultiple(item.expectedMultipleBps)}` : "Repayment multiple not published"}{item.expectedDurationMonths ? ` over ${item.expectedDurationMonths} months` : ""}.</p></div>
            <div className="mr-dossier-block"><h4>Terms</h4><p>{item.minimumInvestmentMinor ? `Minimum ${fmtMinor(item.minimumInvestmentMinor)}. ` : ""}{item.unitPriceMinor ? `Unit ${fmtMinor(item.unitPriceMinor)}. ` : ""}{item.projectedRevenueMinor ? `Projected revenue ${fmtMinor(item.projectedRevenueMinor)}. ` : ""}{item.capitalAtRiskMinor ? `Capital at risk ${fmtMinor(item.capitalAtRiskMinor)}.` : ""}</p></div>
            <div className="mr-dossier-block"><h4>Source</h4><p title={item.sourceUrl || item.source}><ShieldCheck size={11}/> {item.asOf} · {item.source}</p></div>
          </div>
          {item.scenarios.length > 0 && <div className="mr-scenarios">
            {item.scenarios.map((scenario, index) => <div className={`mr-scenario mr-scenario--${scenario.outcome.toLowerCase()}`} key={`${scenario.outcome}-${index}`}>
              <span className="mr-scenario-head">{scenario.label}</span>
              <span>{fmtPercent(scenario.probabilityBps)} · {fmtMinor(scenario.grossRevenueMinor)} gross · {scenario.durationMonths}mo · {fmtMultiple(scenario.funderMultipleBps)}</span>
            </div>)}
          </div>}
          {item.milestones.length > 0 && <div className="mr-milestones">
            <span className="mr-eyebrow">Milestones &amp; escrow release</span>
            <div className="mr-milestone-track">{item.milestones.map((milestone, index) => <span className={`mr-milestone${milestone.status === "REACHED" ? " is-reached" : ""}`} key={`${milestone.stage}-${index}`}>{milestone.label} · {fmtPercent(milestone.releaseBps)}</span>)}</div>
          </div>}
          {item.highlights.length > 0 && <div className="mr-tags">{item.highlights.slice(0, 5).map((value) => <span className="mr-chip" key={value}>{value}</span>)}</div>}
        </div>}
      </div>
      <div className="mr-card-foot">
        <button type="button" className="mr-link" onClick={() => setOpenId(open ? null : item.id)} aria-expanded={open}>{open ? "Hide details" : "View details"} <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none" }}/></button>
        <button type="button" className="mr-btn mr-btn--invest" disabled={!item.fundable} title={item.fundable ? "Invest in this opportunity" : "Reference records are not open for investment — wait for the administrator to publish its economics"} onClick={() => item.fundable && openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.minimumInvestmentMinor || 0, 100_000))}>
          <Coins size={14}/> {item.fundable ? "Invest now" : "Not open"}
        </button>
      </div>
    </article>;
  };

  return <div className="arb-page portal-page mr-page">
    <header className="mr-hero" aria-label="Music Royalties desk">
      <div className="mr-hero-glow" aria-hidden="true" />
      <div className="mr-masthead">
        <div className="mr-masthead-lead">
          <span className="mr-eyebrow mr-eyebrow--gold">Music Royalties · Creative capital</span>
          <h1 className="mr-title">Invest in music — shows, artists, records and rights.</h1>
          <p className="mr-lede">Every entry below is music-only: a concert or festival, a tour, a new artist or album, an endorsement deal, a brand or record label, a master or publishing right, a sync deal, merchandise, a music video, a catalogue acquisition or a royalty stream — {MUSIC_INVESTMENT_TYPES.length} fundable types. You can invest in upcoming shows and concerts, and an administrator can publish any new music opportunity by selecting its type. Public music catalogues publish titles and artists but never deal economics, so nothing here is invented: an opportunity is open for investment only once an administrator publishes its sourced economics. Commitments settle in {settlement}, draw from any wallet you hold or from all wallets combined at the live rate, and the principal is held against the opportunity's published milestones.</p>
        </div>
        <div className="mr-masthead-side">
          <div className="mr-sources">
            <span className={`mr-source-chip${degraded ? " is-degraded" : " is-ok"}`}>{degraded ? "Some catalogue sources degraded" : "Live administrator economics"}</span>
            {sources.map((source) => <span className={`mr-source-chip is-${source.status}`} key={source.name} title={source.detail || source.url}>
              {source.status === "ok" ? <Check size={11}/> : <AlertTriangle size={11}/>} {source.name}
            </span>)}
          </div>
          <button type="button" className="mr-btn mr-btn--ghost mr-btn--sm" onClick={() => market.refetch()} disabled={market.isFetching} aria-label="Refresh the desk"><RefreshCw size={13} className={market.isFetching ? "spin" : ""}/> {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : "Refresh"}</button>
        </div>
      </div>

      {liveReel.length > 0 && <div className="mr-marquee" aria-label="Upcoming shows and concerts">
        <span className="mr-marquee-label"><Radio size={12}/> Live &amp; upcoming</span>
        <div className="mr-marquee-track">
          {liveReel.slice(0, 6).map((item) => <button type="button" key={item.id} className="mr-marquee-item" onClick={() => { setTab("live"); setOpenId(item.id); }}>
            <b>{item.flag} {item.title}</b><small>{musicTypeLabel(item.musicType)} · {item.eventDate ? formatDate(item.eventDate) : daysLabel(item.remainingDays)}</small>
          </button>)}
        </div>
      </div>}

      <div className="mr-figures">
        <div className="mr-figure mr-figure--blue"><b>{summary.published}</b><span>Published opportunities</span></div>
        <div className="mr-figure mr-figure--gold"><b>{summary.showsAndConcerts}</b><span>Shows, concerts &amp; tours</span></div>
        <div className="mr-figure mr-figure--green"><b>{fmtMinor(summary.committedMinor)}</b><span>Your committed</span></div>
        <div className="mr-figure mr-figure--red"><b>{fmtMinor(summary.distributedMinor)}</b><span>Distributed to you</span></div>
      </div>
    </header>

    {market.isError && <div className="mr-notice is-error" role="alert">
      <AlertTriangle size={16}/>
      <div><strong>The desk could not reach the account service.</strong> {market.error?.message || "Administrator-published music opportunities could not be loaded."} Retry to reconnect.</div>
      <button type="button" className="mr-btn mr-btn--ghost mr-btn--sm" onClick={() => market.refetch()}>Retry</button>
    </div>}

    {storeWarning && <div className="mr-notice" role="status"><AlertTriangle size={16}/><div>{storeWarning}</div></div>}
    {message && !target && <div className="mr-notice is-error" role="alert"><AlertTriangle size={16}/><div>{message}</div></div>}

    <nav className="mr-tabs" aria-label="Music Royalties workspace">
      <button type="button" className={`mr-tab${tab === "reel" ? " is-active" : ""}`} onClick={() => setTab("reel")}><Layers3 size={14}/> Opportunity board <span className="mr-tab-count">{opportunities.length}</span></button>
      <button type="button" className={`mr-tab${tab === "live" ? " is-active" : ""}`} onClick={() => setTab("live")}><Mic2 size={14}/> Live stage <span className="mr-tab-count">{liveReel.length}</span></button>
      <button type="button" className={`mr-tab${tab === "positions" ? " is-active" : ""}`} onClick={() => setTab("positions")}><Coins size={14}/> My investments <span className="mr-tab-count">{positions.length}</span></button>
      <button type="button" className={`mr-tab${tab === "timeline" ? " is-active" : ""}`} onClick={() => setTab("timeline")}><CalendarClock size={14}/> Calendar <span className="mr-tab-count">{fundable.length}</span></button>
      <button type="button" className={`mr-tab${tab === "analytics" ? " is-active" : ""}`} onClick={() => setTab("analytics")}><TrendingUp size={14}/> Desk analytics</button>
    </nav>

    {(tab === "reel" || tab === "live") && <section className="mr-section" aria-label="Music opportunity board">
      <div className="mr-lanes" aria-label="Music investment types">
        <button type="button" className={`mr-lane${type === "ALL" && genre === "ALL" ? " is-active" : ""}`} aria-pressed={type === "ALL" && genre === "ALL"} onClick={() => { setType("ALL"); setGenre("ALL"); }}>
          <span className="mr-lane-media"><img src={STAGE_HERO_ART} alt="" loading="lazy"/><Music2 size={16} className="mr-lane-glyph"/></span>
          <span className="mr-lane-body"><strong>All music</strong><small>The whole desk · {MUSIC_INVESTMENT_TYPES.length} types</small></span>
          <span className="mr-lane-count">{opportunities.length}</span>
        </button>
        {MUSIC_TYPE_GROUPS.map((group) => {
          const count = opportunities.filter((item) => group.types.includes(item.musicType)).length;
          const active = group.types.includes(type as MusicInvestmentType);
          return <button type="button" key={group.label} className={`mr-lane${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => setType(active ? "ALL" : group.types[0])}>
            <span className="mr-lane-media"><img src={TYPE_GROUP_ART[group.label]} alt="" loading="lazy"/><Sparkles size={16} className="mr-lane-glyph"/></span>
            <span className="mr-lane-body"><strong>{group.label}</strong><small>{group.detail}</small><em className="mr-lane-types">{group.types.map((value) => musicTypeLabel(value)).join(" · ")}</em></span>
            <span className="mr-lane-count">{count}</span>
          </button>;
        })}
      </div>

      <div className="mr-toolbar">
        <div className="mr-filters">
          <div className="mr-filter"><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, artist, label or type"/></div>
          <div className="mr-filter"><label>Type</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="ALL">All {MUSIC_INVESTMENT_TYPES.length} types</option>{MUSIC_INVESTMENT_TYPES.map((value) => <option key={value} value={value}>{musicTypeLabel(value)}</option>)}</select></div>
          <div className="mr-filter"><label>Genre</label><select value={genre} onChange={(e) => setGenre(e.target.value)}><option value="ALL">All genres</option>{MUSIC_GENRES.map((value) => <option key={value} value={value}>{genreLabel(value as MusicGenre)}</option>)}</select></div>
          <div className="mr-filter"><label>Territory</label><select value={territory} onChange={(e) => setTerritory(e.target.value)}><option value="ALL">All territories</option>{MUSIC_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</select></div>
          <div className="mr-filter"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option>{MUSIC_DOSSIER_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>
          <div className="mr-filter"><label>Stage</label><select value={stage} onChange={(e) => setStage(e.target.value)}><option value="ALL">All stages</option>{MUSIC_STAGES.map((value) => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></div>
          <div className="mr-filter"><label>Risk</label><select value={riskGrade} onChange={(e) => setRiskGrade(e.target.value)}><option value="ALL">All grades</option>{MUSIC_RISK_GRADES.map((value) => <option key={value} value={value}>{riskGradeLabel(value)}</option>)}</select></div>
          <div className="mr-filter"><label>Sort</label><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fundable">Open for investment first</option><option value="deadline">Closing soonest</option><option value="event">Event date soonest</option><option value="ask">Largest funding target</option><option value="multiple">Highest expected multiple</option><option value="name">Title A–Z</option><option value="type">Type A–Z</option><option value="genre">Genre A–Z</option></select></div>
        </div>
        <div className="mr-toolbar-actions">
          <label className="mr-checkbox"><input type="checkbox" checked={fundableOnly} onChange={(e) => setFundableOnly(e.target.checked)}/> Open for investment only</label>
          <label className="mr-checkbox"><input type="checkbox" checked={watchlistOnly} onChange={(e) => setWatchlistOnly(e.target.checked)}/> Watchlist ({watchlist.length})</label>
          <button type="button" className="mr-btn mr-btn--ghost mr-btn--sm" onClick={exportCatalogue} disabled={!filtered.length}><Download size={13}/> Export CSV</button>
          {activeFilters > 0 && <button type="button" className="mr-btn mr-btn--ghost mr-btn--sm" onClick={clearFilters}><X size={13}/> Clear {activeFilters}</button>}
        </div>
      </div>

      {tab === "live" && <div className="mr-section-head">
        <div><span className="mr-eyebrow mr-eyebrow--gold">Live stage</span><h2>Upcoming shows &amp; concerts</h2><p>Only administrator-published shows, concerts, festivals and tours with sourced economics appear here — the live opportunities you can invest in. Order by event date to see what is coming up next.</p></div>
      </div>}

      {market.isLoading && !opportunities.length && <div className="mr-grid">{Array.from({ length: 6 }).map((_, index) => <div className="mr-card is-skeleton" key={index}><div className="mr-card-media" /><div className="mr-card-body"><div className="mr-card-sub"><span className="mr-spinner" /> Loading music opportunities…</div></div></div>)}</div>}
      {!market.isLoading && !opportunities.length && <div className="mr-empty"><CircleHelp size={16}/> No music opportunities are on the desk right now. An administrator publishes shows, concerts and other music opportunities by type; check back soon.</div>}
      {opportunities.length > 0 && !scoped.length && <div className="mr-empty"><CircleHelp size={16}/> {tab === "live" ? "No upcoming shows, concerts, festivals or tours are open for investment right now." : "No opportunities match the current filters. Clear the search or widen the filters."}</div>}

      {scoped.length > 0 && <div className="mr-grid">{pageRows.map((item, index) => renderCard(item, (currentPage - 1) * pageSize + index + 1, tab === "live" ? TYPE_GROUP_ART["Live & Events"] : undefined))}</div>}

      {scoped.length > 0 && <div className="mr-pagination">
        <button type="button" className="mr-page-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14}/> Previous</button>
        <span className="mr-eyebrow">Page {currentPage} of {pageCount} · {scoped.length} of {opportunities.length}</span>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / page</option>)}</select>
        <button type="button" className="mr-page-btn" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight size={14}/></button>
      </div>}
    </section>}

    {tab === "positions" && <section className="mr-section" aria-label="Your music royalties investments">
      <div className="mr-section-head">
        <div><span className="mr-eyebrow mr-eyebrow--gold">Your investments</span><h2>Music commitments &amp; distributions</h2></div>
        <div className="mr-toolbar-actions">
          <span className="mr-chip"><ShieldCheck size={12}/> Settled in {settlement} · {fmtMinor(available)} available</span>
          <button type="button" className="mr-btn mr-btn--ghost mr-btn--sm" onClick={exportPositions} disabled={!positions.length}><Download size={13}/> Export CSV</button>
        </div>
      </div>
      <div className="mr-hero-stats">
        <div className="mr-stat"><strong>{fmtMinor(summary.committedMinor)}</strong><span>Committed (held)</span></div>
        <div className="mr-stat"><strong>{summary.activePositions}</strong><span>Active positions</span></div>
        <div className="mr-stat mr-stat--green"><strong>{fmtMinor(summary.distributedMinor)}</strong><span>Distributions credited</span></div>
        <div className="mr-stat"><strong>{summary.settledPositions}</strong><span>Settled</span></div>
        <div className="mr-stat mr-stat--red"><strong>{summary.writtenOffPositions}</strong><span>Written off</span></div>
      </div>
      {!positions.length && <div className="mr-empty"><Coins size={16}/> No music investments yet. Fund a show, artist, record or right to open a position — the amount is debited from your wallet and held against the opportunity.</div>}
      {positions.length > 0 && <div className="mr-table-wrap">
        <table className="mr-table">
          <thead><tr><th>Position</th><th>Opportunity</th><th>Type</th><th>Genre</th><th>Amount</th><th>Funding</th><th>Expected</th><th>Distributed</th><th>Outcome</th><th>Realised</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((position: any) => <tr key={position.id}>
              <td className="mr-mono">{position.positionCode}</td>
              <td>{position.instrumentName}</td>
              <td>{position.musicType ? musicTypeLabel(position.musicType) : "—"}</td>
              <td>{position.genre ? genreLabel(position.genre) : "—"}</td>
              <td>{fmtMinor(Number(position.amountMinor))}</td>
              <td>{position.fundingSource === "COMBINED" ? "Combined" : position.fundingSource || position.currency}</td>
              <td>{fmtMultiple(position.expectedMultipleBps)}</td>
              <td>{fmtMinor(Number(position.distributedMinor || 0))}</td>
              <td>{position.outcome ? outcomeLabel(position.outcome) : "—"}</td>
              <td>{position.realisedMinor !== null && position.realisedMinor !== undefined ? fmtMinor(Number(position.realisedMinor)) : "—"}</td>
              <td>{formatDate(position.openedAt)}</td>
              <td><span className="mr-chip">{position.positionStatus}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>}

    {tab === "timeline" && <section className="mr-section" aria-label="Music calendar">
      <div className="mr-section-head"><div><span className="mr-eyebrow mr-eyebrow--gold">Calendar</span><h2>Event dates &amp; funding deadlines</h2><p>Shows, concerts, tours and releases with their event dates, alongside the funding deadline for each open opportunity. A deadline is never moved once an investment is committed.</p></div></div>
      {!fundable.length && <div className="mr-empty"><CalendarClock size={16}/> No open opportunities yet. The calendar fills as administrators publish music opportunities with sourced economics.</div>}
      <div className="mr-calendar">
        {fundable.slice().sort((a, b) => (a.eventDate || a.fundingDeadline || "9999").localeCompare(b.eventDate || b.fundingDeadline || "9999")).map((item, index) => <div className="mr-calendar-row" key={item.id}>
          <span className="mr-calendar-rank">{String(index + 1).padStart(2, "0")}</span>
          <div className="mr-calendar-main">
            <strong>{item.flag} {item.title}</strong>
            <div className="mr-card-sub"><Music2 size={12}/> {musicTypeLabel(item.musicType)} · {genreLabel(item.genre)} · {item.territory}</div>
          </div>
          <div className="mr-calendar-dates">
            {item.eventDate ? <span className="mr-chip mr-chip--event"><CalendarClock size={11}/> Event {formatDate(item.eventDate)}</span> : null}
            <span className="mr-chip">{daysLabel(item.remainingDays)}</span>
          </div>
          <button type="button" className="mr-btn mr-btn--invest mr-btn--sm" onClick={() => openPurchase({ id: item.id, name: item.title, expectedMultipleBps: item.expectedMultipleBps }, Math.max(item.minimumInvestmentMinor || 0, 100_000))}><Coins size={13}/> Invest</button>
        </div>)}
      </div>
    </section>}

    {tab === "analytics" && <section className="mr-section" aria-label="Music analytics">
      <div className="mr-section-head"><div><span className="mr-eyebrow mr-eyebrow--gold">Desk analytics</span><h2>What is on the desk</h2><p>Desk-level aggregates computed only from the music opportunities above — how the opportunity set splits by type, genre, territory and stage, and how much is raising. No figure is inferred beyond the records themselves.</p></div></div>
      {!opportunities.length ? <div className="mr-empty"><CircleHelp size={16}/> No opportunities published yet — analytics appear once administrator economics arrive.</div> : <div className="mr-analytics">
        <div className="mr-analytics-card mr-analytics-split">
          <div className="mr-analytics-stat"><b>{analytics.totalOpportunities}</b><span>Opportunities</span></div>
          <div className="mr-analytics-stat"><b>{analytics.fundableCount}</b><span>Open for investment</span></div>
          <div className="mr-analytics-stat mr-analytics-stat--gold"><b>{analytics.showsAndConcerts}</b><span>Shows &amp; concerts</span></div>
          <div className="mr-analytics-stat mr-analytics-stat--green"><b>{fmtMinor(analytics.raisingMinor)}</b><span>Total raising</span></div>
          <div className="mr-analytics-stat"><b>{fmtMinor(analytics.committedMinor)}</b><span>Committed on desk</span></div>
        </div>

        <div className="mr-analytics-grid">
          <div className="mr-analytics-card">
            <h3>By type</h3>
            {analytics.byType.map((bucket) => <div className="mr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="mr-bar-track"><div className="mr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / maxTypeCount)}%` }} /></div>
              <b className="mr-mono">{bucket.count}</b>
            </div>)}
          </div>
          <div className="mr-analytics-card">
            <h3>By genre</h3>
            {analytics.byGenre.map((bucket) => <div className="mr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="mr-bar-track"><div className="mr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byGenre[0].count))}%` }} /></div>
              <b className="mr-mono">{bucket.count}</b>
            </div>)}
          </div>
          <div className="mr-analytics-card">
            <h3>By territory</h3>
            {!analytics.byTerritory.length && <p className="mr-card-meta">No territories published.</p>}
            {analytics.byTerritory.map((bucket) => <div className="mr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="mr-bar-track"><div className="mr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byTerritory[0].count))}%` }} /></div>
              <b className="mr-mono">{bucket.count}</b>
            </div>)}
          </div>
          <div className="mr-analytics-card">
            <h3>By stage</h3>
            {analytics.byStage.map((bucket) => <div className="mr-bar-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="mr-bar-track"><div className="mr-bar-fill" style={{ width: `${Math.round((bucket.count * 100) / Math.max(1, analytics.byStage[0].count))}%` }} /></div>
              <b className="mr-mono">{bucket.count}</b>
            </div>)}
          </div>
        </div>
      </div>}
    </section>}

    <div id="mr-education" className="mr-notice mr-education">
      <ShieldCheck size={16}/>
      <div>
        <strong>How the Music Royalties desk works.</strong> This desk is music-only across {MUSIC_INVESTMENT_TYPES.length} investment types — {MUSIC_TYPE_GROUPS.map((group) => `${group.label} (${group.types.map((value) => musicTypeLabel(value)).join(", ")})`).join("; ")}. IP royalties, NFTs, agro investment, green energy and carbon credits have their own menus and are excluded here. You can invest in upcoming shows and concerts; an administrator publishes any new music opportunity by selecting its type, and every displayed figure is administrator-supplied and cited. The discovery layer (the keyless iTunes search index) publishes titles and artists but never deal economics, so a cited catalogue reference is <em>not</em> open for investment — only an administrator-published dossier with sourced economics is, and the investment button is enabled only for those. Your commitment settles in {settlement}, is drawn from any wallet you hold or from all wallets combined at the live rate, the wallet is debited on submit, and the principal is held against the opportunity. Recorded distributions are credited pro-rata to your wallet as internal-ledger entries; at settlement the principal is released against the administrator-configured multiple, or written off. Nothing here is a prediction, and no external transfer occurs on this desk.
      </div>
    </div>

    {target && <div className="mr-modal" onMouseDown={() => setTarget(null)}>
      <div className="mr-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mr-modal-head">
          <strong><Coins size={15}/> Invest in a music opportunity</strong>
          <button type="button" className="mr-btn mr-btn--ghost mr-btn--sm" onClick={() => setTarget(null)}><X size={16}/></button>
        </div>
        <div className="mr-modal-body">
          <div className="mr-card-title">{target.name}</div>
          <div className="mr-card-meta"><span>Funded through the wallet ledger</span><span>Expected {fmtMultiple(target.expectedMultipleBps)}</span></div>

          <div className="mr-field">
            <label>Investment amount ({settlement})</label>
            <input type="number" min="1" step="100" value={(amount / 100).toString()} onChange={(e) => setAmount(Math.round((Number(e.target.value) || 0) * 100))} />
            <small>Your wallet will be debited on submit. You can pay from the {settlement} wallet, any single wallet, or all wallets combined.</small>
          </div>

          <div>
            <span className="mr-eyebrow">Pay from</span>
            <div className="mr-funding">
              <button type="button" className={`mr-funding-option${fundingSource === "COMBINED" ? " is-selected" : ""}`} onClick={() => setFundingSource("COMBINED")}>
                <Layers3 size={14}/> <span><strong>Combined balance</strong><small>All wallets, converted at the live rate</small></span>
                {quote?.fundingSource === "COMBINED" && quote?.combinedAvailableMinor !== null && quote?.combinedAvailableMinor !== undefined && <b>{fmtMinor(quote.combinedAvailableMinor)}</b>}
              </button>
              {fundedWallets.map((wallet) => <button type="button" key={wallet.currency} className={`mr-funding-option${fundingSource === wallet.currency ? " is-selected" : ""}`} onClick={() => setFundingSource(wallet.currency)}>
                <Coins size={14}/> <span><strong>{wallet.currency}</strong><small>{wallet.currencyName || "Wallet"}</small></span>
                <b>{moneyMinor(wallet.availableMinor, wallet.currency, wallet.scale)}</b>
              </button>)}
              {!fundedWallets.length && <p className="mr-card-meta">No funded wallets detected yet.</p>}
            </div>
          </div>

          <div className="mr-quote">
            {quoteLoading && <span>Checking funding at the live rate…</span>}
            {!quoteLoading && !quote && <span>Enter an amount to see how it will be funded.</span>}
            {!quoteLoading && quote?.sufficient && <>
              <strong className="mr-ok"><Check size={13}/> Funded by {quote.fundingSource === "COMBINED" ? "combined wallets" : quote.fundingSource}</strong>
              {quote.usdAvailableMinor > 0 && quote.convertedUsdMinor < quote.amountMinor && <div className="mr-quote-row"><span>{settlement} wallet</span><span>{fmtMinor(Math.max(0, quote.amountMinor - quote.convertedUsdMinor))}</span></div>}
              {(quote.debits || []).map((debit: any) => <div className="mr-quote-row" key={debit.currency}><span>{debit.currency} → {fmtMinor(debit.convertedUsdMinor)} @ {debit.rate} <em>{debit.rateProvider}</em></span><span>{moneyMinor(debit.amountMinor, debit.currency, wallets.find((wallet) => wallet.currency === debit.currency)?.scale ?? 2)}</span></div>)}
            </>}
            {!quoteLoading && quote && !quote.sufficient && <div>
              <strong className="mr-bad"><AlertTriangle size={13}/> Insufficient balance</strong>
              <span>{quote.message}{quote.combinedAvailableMinor !== null && quote.combinedAvailableMinor !== undefined ? ` Combined available: ${fmtMinor(quote.combinedAvailableMinor)}.` : ""}</span>
            </div>}
          </div>

          <div className="mr-notice"><ShieldCheck size={15}/><div>Confirming debits your chosen wallet(s) through the existing internal ledger, holds the principal and creates a durable position. Duplicate requests are idempotent. Recorded distributions are credited pro-rata as they are published; at settlement the principal is released against the administrator-configured multiple, or written off. No external transfer occurs on this desk.</div></div>
          {message && <div className="mr-notice is-error" role="alert"><AlertTriangle size={15}/><div>{message}</div></div>}
        </div>
        <div className="mr-modal-foot">
          <button className="mr-btn mr-btn--ghost" onClick={() => setTarget(null)}>Cancel</button>
          <button className="mr-btn mr-btn--invest" disabled={purchase.isPending || quoteLoading || (quote ? !quote.sufficient : false)} onClick={submitPurchase}>{purchase.isPending ? "Recording investment…" : "Confirm & debit wallet"} <Check size={14}/></button>
        </div>
      </div>
    </div>}

    <div className="mr-card-meta" style={{ flexWrap: "wrap" }}>
      <span><ShieldCheck size={12}/> {fundedWallets.length} funded wallet{fundedWallets.length === 1 ? "" : "s"} · {settlement} available {fmtMinor(available)}</span>
      <span>{opportunities.length} opportunities · {fundable.length} open · {positions.length} positions</span>
      <span><BadgeCheck size={12}/> {sources.length} cited sources</span>
    </div>
  </div>;
}
