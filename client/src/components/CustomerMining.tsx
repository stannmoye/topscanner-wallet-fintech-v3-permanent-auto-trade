import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import "../factory-cockpit.css";
import { MiningCoreCanvas } from "./MiningCoreCanvas";
import { MiningOperationsFlow } from "./MiningOperationsFlow";
import { getMiningPackageTheme } from "@shared/mining-package-themes";
import {
  Activity, ArrowDownUp, ArrowRight, BarChart3, Calculator,
  ChevronDown, ChevronLeft, ChevronRight, Clock3, Cpu, Download, Info, Layers,
  RefreshCw, Scale, ShieldCheck, Sparkles, Target, TrendingUp, WalletCards, Zap,
} from "lucide-react";

const TARGET_ASSETS = ["USD", "EUR", "GBP", "BTC", "ETH", "USDT"];
const assetScaleFor = (asset: string, currencies?: any[]) =>
  Number(currencies?.find((currency: any) => currency.code === asset)?.scale ?? (["BTC", "ETH"].includes(asset) ? 8 : 2));
const requestId = () => globalThis.crypto?.randomUUID?.() || `mining-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const fmt = (value: unknown, max = 8) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: max }) : "—";
};
const durationText = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map(value => String(value).padStart(2, "0")).join(":");
};
const currencyIcons: Record<string, string> = { BTC: "₿", USD: "$", EUR: "€", GBP: "£", ETH: "◆", USDT: "₮" };
const CoinMark = ({ iconUrl, fallback = "₵" }: { iconUrl?: string | null; fallback?: string }) => iconUrl ? <img className="cm-coin-img" src={iconUrl} alt="" /> : <>{fallback}</>;

export function CustomerMining({ push }: { push: (message: string) => void }) {
  const dashboard = trpc.customer.mining.dashboard.useQuery(undefined, { refetchInterval: 5000 });
  const packages = trpc.customer.mining.packages.useQuery(undefined, { refetchInterval: 30000 });
  const boostStatus = trpc.customer.mining.boostStatus.useQuery(undefined, { refetchInterval: 5000 });
  const history = trpc.customer.mining.transactions.useQuery(undefined, { refetchInterval: 12000 });
  const walletPreferences = trpc.customer.walletPreferences.useQuery(undefined, { refetchInterval: 30000 });
  const mainWallet = trpc.customer.balances.useQuery(undefined, { refetchInterval: 10000 });

  const [now, setNow] = useState(Date.now());
  const [swapQuote, setSwapQuote] = useState<any | null>(null);
  const [swapTarget, setSwapTarget] = useState("");
  const [packageTab, setPackageTab] = useState("all");
  const [historyPage, setHistoryPage] = useState(0);
  const [prefEnabled, setPrefEnabled] = useState(false);
  const [prefTarget, setPrefTarget] = useState("USD");
  const [prefThreshold, setPrefThreshold] = useState("0");
  const [message, setMessage] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [packageSort, setPackageSort] = useState("recommended");
  const [buyPackage, setBuyPackage] = useState<any | null>(null);
  const [buyAsset, setBuyAsset] = useState("");
  const [buyQuote, setBuyQuote] = useState<any | null>(null);
  const [buyTerms, setBuyTerms] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [goalTarget, setGoalTarget] = useState("");
  const boostAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const preference = dashboard.data?.conversionPreference;
    if (preference) {
      setPrefEnabled(Boolean(preference.enabled));
      setPrefTarget(String(preference.targetDenomination || "USD"));
      setPrefThreshold(String(preference.minimumThreshold || "0"));
    }
  }, [dashboard.data?.conversionPreference?.version]);

  useEffect(() => {
    const preferredSwap = String(walletPreferences.data?.swapCurrency || "").toUpperCase();
    if (TARGET_ASSETS.includes(preferredSwap)) setSwapTarget(preferredSwap);
  }, [walletPreferences.data?.swapCurrency]);

  useEffect(() => {
    try {
      const storedGoal = window.localStorage.getItem("cm-mining-goal");
      if (storedGoal) setGoalTarget(storedGoal);
    } catch { /* storage may be unavailable in private browsing */ }
  }, []);

  const quotePurchaseMutation = trpc.customer.mining.quotePurchase.useMutation({
    onSuccess: quote => { setBuyQuote(quote); setBuyAsset(String(quote.paymentAsset || "")); setMessage(""); },
    onError: error => { setBuyQuote(null); setMessage(error.message); },
  });
  const confirmPurchaseMutation = trpc.customer.mining.confirmPurchase.useMutation({
    onSuccess: result => {
      setBuyPackage(null); setBuyQuote(null); setBuyTerms(false);
      void dashboard.refetch(); void mainWallet.refetch(); void history.refetch(); void packages.refetch();
      push(`${result.packageName} purchased · ${result.receiptReference}`);
      setMessage(`${result.packageName} is active from ${dateText(result.startsAt)}. ${fmt(result.paymentAmount, 8)} ${result.paymentAsset} was debited from your selected wallet. ${result.rewardPostingReady ? "Eligible CKI rewards are processed automatically." : "This package has no configured daily CKI rate, so no rewards accrue."}`);
    },
    onError: error => setMessage(error.message),
  });
  const boostMutation = trpc.customer.mining.activateBoost.useMutation({
    onSuccess: result => { void dashboard.refetch(); void boostStatus.refetch(); void history.refetch(); push(`Boost activated until ${dateText(result.endsAt)}`); setMessage(`Package boost active until ${dateText(result.endsAt)}. It is next available after the customer-specific cooldown.`); },
    onError: error => setMessage(error.message),
  });
  const preferenceMutation = trpc.customer.mining.updateConversionPreference.useMutation({
    onSuccess: result => { void dashboard.refetch(); setMessage(`Conversion preference saved as version ${result.version}. It applies to future reward events.`); },
    onError: error => setMessage(error.message),
  });
  const mainWalletPreferenceMutation = trpc.customer.updateWalletPreferences.useMutation({
    onSuccess: () => { void walletPreferences.refetch(); },
    onError: error => setMessage(error.message),
  });
  const swapMutation = trpc.customer.mining.confirmSwap.useMutation({
    onSuccess: result => {
      setSwapQuote(null); void dashboard.refetch(); void mainWallet.refetch(); void history.refetch();
      push(`CKI converted to ${result.destinationAsset} main wallet · ${result.receiptReference}`);
      setMessage(`${fmt(result.sourceAmount, 8)} CKI converted to ${fmt(result.destinationAmount, 8)} ${result.destinationAsset} and credited to your main wallet. This does not initiate a payout; CKI itself is not a payout currency.`);
    },
    onError: error => { setSwapQuote(null); void dashboard.refetch(); void mainWallet.refetch(); setMessage(error.message); },
  });
  const swapQuoteMutation = trpc.customer.mining.quoteSwap.useMutation({
    onSuccess: quote => {
      setSwapQuote(quote); setMessage("");
      swapMutation.mutate({ quoteId: quote.quoteId, idempotencyKey: requestId() });
    },
    onError: error => setMessage(error.message),
  });

  const data = dashboard.data;
  const tokenName = data?.tokenName ?? "";
  const tokenSymbol = data?.tokenSymbol ?? "";
  const tokenIconUrl = data?.tokenIconUrl ?? "";
  const minedTodayDisplay = data ? `+${fmt(data.todayTokens, 6)} ${tokenSymbol || "CKI"}` : dashboard.isLoading ? "Loading…" : "0 CKI";
  const packageRows = packages.data || [];
  const boost = boostStatus.data;
  const active = data?.packages || [];
  const recent = (history.data || []).slice(0, 30);
  const historyPageCount = Math.max(1, Math.ceil(recent.length / 5));
  const currentHistoryPage = Math.min(historyPage, historyPageCount - 1);
  const pagedRecent = recent.slice(currentHistoryPage * 5, (currentHistoryPage + 1) * 5);
  const latestReward = recent.find((row: any) => row.type === "reward" && row.status === "posted");
  const availableCki = Number(data?.balances?.CKI || data?.tokenBalance || 0);
  const canSwapAll = availableCki > 0 && Boolean(swapTarget);
  const mainWalletAvailable = (asset: string) => {
    const currency = mainWallet.data?.currencies?.find((item: any) => item.code === asset);
    const balance = mainWallet.data?.balances?.find((item: any) => item.currency === asset);
    const scale = Number(currency?.scale ?? 0);
    return Number(balance?.availableMinor ?? 0) / (10 ** scale);
  };
  const mainWalletScale = (asset: string) => Number(mainWallet.data?.currencies?.find((item: any) => item.code === asset)?.scale ?? 0);
  const availableUsd = mainWalletAvailable("USD");
  const dailyUsdReference = (Number(data?.estimatedDailyTokens || 0) * Number(data?.usdPerToken || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const configuredUsdReference = Number(data?.usdPerToken || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const swapExpired = swapQuote ? new Date(swapQuote.expiresAt).getTime() <= now : false;
  const activeBoostEnds = boost?.activeBoost?.endsAt ? new Date(boost.activeBoost.endsAt).getTime() : null;
  const cycleStart = boost?.cycleStart ? new Date(boost.cycleStart).getTime() : null;
  const nextBoostTime = boost?.nextEligibleAt ? new Date(boost.nextEligibleAt).getTime() : null;
  const isBoostActive = Boolean(boost?.activeBoost && activeBoostEnds && activeBoostEnds > now);
  const isCoolingDown = Boolean(!boost?.ready && !isBoostActive && cycleStart && nextBoostTime && nextBoostTime > now);
  const countdownTarget = activeBoostEnds || (isCoolingDown ? nextBoostTime : null);
  useEffect(() => {
    const shouldPlay = Boolean(boost?.activeBoost);
    if (shouldPlay) {
      const audio = boostAudioRef.current || new Audio("/audio/boost/mixkit-1093.mp3");
      boostAudioRef.current = audio;
      audio.loop = true;
      audio.volume = 0.55;
      void audio.play().catch(() => { /* browsers require a user gesture; activation click retries below */ });
    } else if (boostAudioRef.current) {
      boostAudioRef.current.pause();
      boostAudioRef.current.currentTime = 0;
    }
    return () => {
      if (boostAudioRef.current && !shouldPlay) { boostAudioRef.current.pause(); boostAudioRef.current.currentTime = 0; }
    };
  }, [boost?.activeBoost?.startedAt, boost?.activeBoost?.endsAt]);

  const boostCountdown = countdownTarget
    ? durationText(Math.max(0, Math.ceil(((activeBoostEnds || countdownTarget)! - now) / 1000)))
    : boost?.ready ? "READY NOW" : "—";
  const boostStatusLabel = isBoostActive ? "BOOST ACTIVE · ENDS IN" : boost?.ready ? "BOOST READY" : isCoolingDown ? "BOOST READY IN" : "BOOST UNAVAILABLE";
  const boostCycleCharge = isBoostActive && boost?.activeBoost?.startedAt && activeBoostEnds
    ? Math.max(0, Math.min(100, Math.round((activeBoostEnds - now) / (activeBoostEnds - new Date(boost.activeBoost.startedAt).getTime()) * 100)))
    : boost?.ready ? 100 : isCoolingDown && cycleStart && nextBoostTime
      ? Math.max(0, Math.min(100, Math.round((now - cycleStart) / (nextBoostTime - cycleStart) * 100))) : 0;
  const boostPhase = isBoostActive ? "active" : isCoolingDown ? "cooldown" : boost?.ready ? "ready" : "unavailable";
  const activeBase = Number(data?.baseThs || 0);
  const activeHashPower = activeBase + (Number(boost?.activeBoost?.bonusThs) || 0);
  const globalHashPowerDisplay = dashboard.isLoading || dashboard.isError ? "—" : fmt(data?.globalHashPowerThs, 3);
  const miningSpeedDisplay = dashboard.isLoading || dashboard.isError ? "—" : `${fmt(data?.miningSpeedMultiplier, 4)}×`;
  const currentHashRateDisplay = dashboard.isLoading || dashboard.isError ? "—" : fmt(activeHashPower, 3);
  const hasActiveHashPowerPackage = active.some((item: any) => item.status === "active" || item.status === "replaced");
  const activeBoostCapacity = active.reduce((sum: number, item: any) => sum + (Number.isFinite(Number(item.boostBonusThs)) ? Number(item.boostBonusThs) : 0), 0);
  const activePackageNames = active.length ? active.slice(0, 3).map((item: any) => item.packageName).join(" · ") + (active.length > 3 ? ` · +${active.length - 3} more` : "") : "No active package entitlement";
  const engineIsRunning = hasActiveHashPowerPackage;
  const filteredPackages = packageRows
    .filter((item: any) => {
      if (packageTab === "mine") return Boolean(item.alreadyPurchased) || active.some((current: any) => current.code === item.code);
      if (packageTab === "upgrade") return Number(item.baseThs) > activeBase;
      if (packageTab === "downgrade") return Number(item.baseThs) < activeBase;
      return true;
    })
    .filter((item: any) => {
      const query = packageSearch.trim().toLowerCase();
      if (!query) return true;
      return `${item.name ?? ""} ${item.code ?? ""}`.toLowerCase().includes(query);
    })
    .sort((a: any, b: any) => {
      if (packageSort === "price-low") return Number(a.priceAmount) - Number(b.priceAmount);
      if (packageSort === "price-high") return Number(b.priceAmount) - Number(a.priceAmount);
      if (packageSort === "hashrate") return Number(b.baseThs) - Number(a.baseThs);
      if (packageSort === "name") return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      return Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0);
    });
  const rewardAmountOf = (row: any) => Number(row?.details?.immediateTokenAmount ?? row?.details?.tokenAmount ?? 0);
  const rewardsByDay = new Map<string, number>();
  for (const row of recent) {
    if (row.type !== "reward" || String(row.status).toLowerCase() !== "posted") continue;
    const key = new Date(row.createdAt).toISOString().slice(0, 10);
    rewardsByDay.set(key, (rewardsByDay.get(key) || 0) + rewardAmountOf(row));
  }
  const dayBuckets = Array.from({ length: 7 }, (_unused, index) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - index));
    const key = day.toISOString().slice(0, 10);
    return { key, label: day.toLocaleDateString(undefined, { weekday: "short" }), value: rewardsByDay.get(key) || 0 };
  });
  const dayMax = Math.max(1, ...dayBuckets.map(bucket => bucket.value));
  const mined7d = dayBuckets.reduce((sum, bucket) => sum + bucket.value, 0);
  const projectedRemainingTotal = active.reduce((sum: number, item: any) => sum + Number(item.projectedRemainingTokens || 0), 0);
  const projectedTermTotal = active.reduce((sum: number, item: any) => sum + Number(item.projectedTermTokens || 0), 0);
  const projectedDailyTotal = active.reduce((sum: number, item: any) => sum + Number(item.effectiveDailyRewardCki || 0), 0) || Number(data?.estimatedDailyTokens || 0);
  const usdPerTokenValue = Number(data?.usdPerToken || 0);
  const projectedRemainingUsd = projectedRemainingTotal * usdPerTokenValue;
  const goalValue = Number(goalTarget || 0);
  const goalProgress = goalValue > 0 ? Math.min(100, Math.max(0, Math.round((availableCki / goalValue) * 100))) : 0;
  const goalRemaining = Math.max(0, goalValue - availableCki);
  const goalEtaDays = goalValue > 0 && goalRemaining <= 0 ? 0 : goalValue > 0 && projectedDailyTotal > 0 ? Math.ceil(goalRemaining / projectedDailyTotal) : null;
  const compareRows = packageRows.filter((item: any) => compareIds.includes(item.versionId));
  const compareSameAsset = compareRows.length > 1 && compareRows.every((item: any) => item.priceAsset === compareRows[0].priceAsset);
  const comparePricePerThs = (item: any) => {
    const ths = Number(item.baseThs || 0) + Number(item.boostBonusThs || 0);
    return ths > 0 ? Number(item.priceAmount || 0) / ths : null;
  };
  const compareBestIdx = compareSameAsset ? compareRows.reduce((best: number, item: any, index: number, list: any[]) => {
    const value = comparePricePerThs(item); const bestValue = comparePricePerThs(list[best]);
    return value != null && (bestValue == null || value < bestValue) ? index : best;
  }, 0) : -1;
  const toggleCompare = (versionId: string) => setCompareIds(prev => prev.includes(versionId) ? prev.filter(id => id !== versionId) : prev.length >= 3 ? prev : [...prev, versionId]);
  const saveGoal = (value: string) => { setGoalTarget(value); try { window.localStorage.setItem("cm-mining-goal", value); } catch { /* storage may be unavailable */ } };
  const openBuyDialog = (item: any) => {
    setMessage("");
    setBuyPackage(item);
    setBuyQuote(null);
    setBuyAsset(String(item.priceAsset || "USD").toUpperCase());
    setBuyTerms(false);
    quotePurchaseMutation.mutate({ packageVersionId: item.versionId });
  };
  const selectBuyAsset = (asset: string) => {
    if (!buyPackage) return;
    setBuyAsset(asset);
    setBuyQuote(null);
    quotePurchaseMutation.mutate({ packageVersionId: buyPackage.versionId, paymentAsset: asset });
  };
  const buyQuoteExpired = buyQuote ? new Date(buyQuote.expiresAt).getTime() <= now : false;
  const buyCanConfirm = Boolean(buyQuote && buyQuote.sufficientBalance && !buyQuoteExpired && buyTerms && !confirmPurchaseMutation.isPending && !quotePurchaseMutation.isPending);

  const startFullBalanceSwap = () => {
    if (!canSwapAll) return;
    setSwapQuote(null);
    swapQuoteMutation.mutate({ tokenAmount: String(data?.balances?.CKI ?? data?.tokenBalance ?? "0"), targetAsset: swapTarget });
  };
  const selectSwapTarget = (asset: string) => {
    setSwapTarget(asset);
    mainWalletPreferenceMutation.mutate({ swapCurrency: asset });
  };
  const activateBoost = () => { const audio = boostAudioRef.current || new Audio("/audio/boost/mixkit-1093.mp3"); boostAudioRef.current = audio; audio.loop = true; audio.volume = 0.55; void audio.play().catch(() => {}); boostMutation.mutate({ idempotencyKey: requestId() }); };
  const toggleFullscreen = () => {
    const el = document.querySelector(".cm-factory") as HTMLElement | null;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  return <div className="cm-dashboard-frame arb-page">
    <header className="cm-topbar">
      <a className="cm-brand" href="#mining-dashboard" onClick={e=>e.preventDefault()} aria-label={`${tokenName||"CoinKi"} mining dashboard home`}>
        <span className="cm-brand-mark"><CoinMark iconUrl={tokenIconUrl}/></span><span><strong>{tokenName||"CoinKi"}</strong><small>Mine Today, Build Tomorrow</small></span>
      </a>
      <div className="cm-header-summaries" aria-label="Mining wallet summary">
        <div className="cm-header-summary">
          <span>{tokenSymbol||"CKI"} BALANCE</span>
          <strong>{fmt(availableCki, 6)} {tokenSymbol||"CKI"}</strong>
        </div>
        <div className="cm-header-summary">
          <span>MINED TODAY</span>
          <strong className="cm-mined-today-value" aria-live="polite">{minedTodayDisplay}</strong>
        </div>
        <div className="cm-header-summary">
          <span>{tokenSymbol||"CKI"} RATE TO DOLLAR</span>
          <strong>1 {tokenSymbol||"CKI"} → ≈${configuredUsdReference}{data?.tokenRateLive&&<small className="cm-live-rate"> · live</small>}</strong>
        </div>
      </div>
      <div className="cm-top-actions"><div className="cm-asset-strip" aria-label="Available wallet assets">{(mainWallet.data?.currencies || []).map((currency: any) => <span className="cm-asset-chip" key={currency.code} title={currency.name}><b>{currency.code}</b><small>{currency.symbol || ""}{fmt(mainWalletAvailable(currency.code), Number(currency.scale ?? 0))}</small></span>)}</div></div>
    </header>

    <main className="cm-dashboard-main" id="mining-dashboard">
      {message && <div className="cm-message" role="status"><Info size={15}/><span>{message}</span><button type="button" onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}
      {/* Polling queries auto-refresh on an interval. Transient API outages
          (server restarts, proxy failover) must never surface raw technical
          error messages such as "Unexpected token '<!DOCTYPE'..." to the
          customer. Show a single soft refresh notice instead; the data
          recovers on the next successful poll. */}
      {(dashboard.isError || packages.isError || boostStatus.isError || history.isError || mainWallet.isError || walletPreferences.isError) && !dashboard.data && (
        <div className="cm-error cm-error--soft" role="status">Refreshing your mining dashboard…</div>
      )}

      <section className="cm-top-grid" aria-label="Mining engine status and controls">
        <article className="cm-factory scene-playing">
          <div className="cm-factory-scene cm-core-canvas-host" aria-hidden="true">
            <MiningCoreCanvas running={engineIsRunning && hasActiveHashPowerPackage} playing={true} boosted={Boolean(boost?.activeBoost)} hashPowerThs={activeHashPower} rewardPulseKey={Number(data?.todayTokens || 0)} speedMultiplier={Number(data?.miningSpeedMultiplier || 1)}/>
          </div>
          <div className="cm-factory-shade"/>
          <div className="cm-factory-label"><span><Cpu size={16}/> MINING ENGINE</span><b className={hasActiveHashPowerPackage?"online":"offline"}><i aria-hidden="true"/>{hasActiveHashPowerPackage?"MINING STATUS ACTIVE":"MINING STATUS INACTIVE"}</b></div>
          <div className="cm-video-controls" role="group" aria-label="Mining engine hash-rate readouts and fullscreen control">
            <div className="cm-engine-hash-readouts">
              <div className="cm-engine-hash-stat" title="Signed-in account's current hash rate, including any active boost.">
                <span>CURRENT HASH RATE</span><strong>{currentHashRateDisplay} <small>TH/s</small></strong>
              </div>
              <div className="cm-engine-hash-stat" title="Global Hash Power configured by operations and shown consistently to every customer.">
                <span>GLOBAL HASH POWER</span><strong>{globalHashPowerDisplay} <small>TH/s</small></strong>
              </div>
              <div className="cm-engine-hash-stat" title="Operations mining-speed multiplier. It scales the animated fan/turbine speed and the CKI mined per eligible second.">
                <span>MINING SPEED</span><strong>{miningSpeedDisplay}</strong>
              </div>
            </div>
            <button type="button" className="cm-fullscreen-control" onClick={toggleFullscreen} aria-label="Toggle mining engine fullscreen" title="Toggle mining engine fullscreen">⛶</button>
          </div>
        </article>

        <div className="cm-side-stack">
          <article className="cm-glass cm-progress-card">
            <div className="cm-progress-copy">
              <div className="cm-progress-head"><span className="cm-eyebrow">HASH-POWER ENGINE</span><strong className="cm-status-time">{hasActiveHashPowerPackage?"ACTIVE":"IDLE"}</strong><small>{hasActiveHashPowerPackage?"Customer package is active":"No active package"}</small></div>
              <div className="cm-divider"/>
              <div className="cm-progress-metrics">
                <div className="cm-progress-metric"><span className="cm-eyebrow">{tokenSymbol||"CKI"} REWARDS CREDITED TODAY</span><strong className="cm-token-amount">{fmt(data?.todayTokens,4)} <small>{tokenSymbol}</small></strong></div>
                <div className="cm-progress-metric"><span className="cm-eyebrow">REWARD PROCESSING</span><strong className="cm-daily-amount">Enabled</strong><small className="cm-simulation-note">Configured CKI rates accrue by eligible time.</small></div>
              </div>
              <div className="cm-coin-display"><span className="cm-coin-glow"/><b><CoinMark iconUrl={tokenIconUrl}/></b><small>{tokenSymbol}</small></div>
              <div className="cm-mining-vault" aria-hidden="true"><span className="cm-vault-frame"/><span className="cm-vault-beam"/><span className="cm-vault-spark spark-a"/><span className="cm-vault-spark spark-b"/><span className="cm-vault-spark spark-c"/><div className="cm-vault-coin"><CoinMark iconUrl={tokenIconUrl}/></div><span className="cm-vault-platform"/><span className="cm-vault-orbit"/></div>
            </div>
          </article>
          <article className={`cm-glass cm-boost-card is-${boostPhase}`}>
            <div className="cm-boost-machine" role="img" aria-label="Package hash-power boost engine"><span className="cm-engine-aura"/><span className="cm-engine-pipe cm-engine-pipe-left"/><span className="cm-engine-pipe cm-engine-pipe-right"/><div className="cm-engine-shell"><span className="cm-engine-topcap"/><span className="cm-engine-front-glass"/><span className="cm-engine-rotor"><i/><i/><b/></span><span className="cm-engine-vents"/><span className="cm-engine-mark"/><span className="cm-engine-leds"><i/><i/><i/></span><span className="cm-engine-base"/></div></div>
            <div className="cm-boost-copy"><div className="cm-boost-topline"><b>HASH POWER ENGINE</b><span className="cm-boost-readout"><small>{boostStatusLabel}</small><strong>{boostCountdown}</strong></span></div><div className="cm-boost-bottomline"><small className="cm-boost-reward-note">+{fmt(boost?.boostRewardCkiPerDay, 6)} CKI / 24h while active</small><span className="cm-boost-charge" role="progressbar" aria-label={isBoostActive ? "Boost active time remaining" : isCoolingDown ? "Boost cooldown progress" : "Boost readiness"} aria-valuenow={boostCycleCharge} aria-valuemin={0} aria-valuemax={100} title={boost?.reason || (isBoostActive ? "The blue tube empties while the boost is active." : isCoolingDown ? "The blue tube refills until the boost is ready again." : "Boost is ready to activate.")}><i style={{width:`${boostCycleCharge}%`}}/></span></div></div>
            <button type="button" className="cm-glow-button" title={boost?.reason || "Activate Hash Power Boost"} aria-label="Activate Hash Power Boost" disabled={boostMutation.isPending || !boost?.ready} onClick={activateBoost}><ArrowDownUp size={15}/>{boostMutation.isPending?"Activating…":"Activate Boost"}</button>
          </article>
        </div>

      </section>

	      <MiningOperationsFlow
	        hasActivePackage={hasActiveHashPowerPackage}
	        activePackageName={activePackageNames}
	        hashPowerThs={activeHashPower}
	        walletCki={availableCki}
	        engineActivityIntervals={Number(data?.engineActivity?.intervalCount || 0)}
	        engineActivitySeconds={Number(data?.engineActivity?.eligibleSeconds || 0)}
	        latestRewardReference={latestReward?.reference}
	        latestRewardCreatedAt={latestReward?.createdAt}
	        nextRewardAt={data?.nextRewardAt}
      />

      <section className="cm-analytics" aria-label="Mining performance analytics and forecast">
        <div className="cm-analytics-head">
          <div className="cm-analytics-heading">
            <span className="cm-eyebrow"><BarChart3 size={13}/> MINING ANALYTICS</span>
            <h2>Performance &amp; forecast</h2>
            <p>Simulated package-estimate performance derived from your CKI ledger. Values are configured estimates, not pool-verified output or a guaranteed return.</p>
          </div>
          <span className="cm-analytics-pill"><TrendingUp size={13}/>{active.length?`${active.length} active package${active.length>1?"s":""}`:"No active package"}</span>
        </div>
        <div className="cm-analytics-kpis">
          <div className="cm-analytics-kpi kpi-today"><span className="cm-analytics-kpi-icon"><Zap size={15}/></span><small>MINED TODAY</small><strong>{fmt(data?.todayTokens,6)} <em>{tokenSymbol||"CKI"}</em></strong><span className="cm-analytics-kpi-note">Since 00:00 UTC</span></div>
          <div className="cm-analytics-kpi kpi-week"><span className="cm-analytics-kpi-icon"><BarChart3 size={15}/></span><small>MINED · 7 DAYS</small><strong>{fmt(mined7d,6)} <em>{tokenSymbol||"CKI"}</em></strong><span className="cm-analytics-kpi-note">Posted ledger rewards</span></div>
          <div className="cm-analytics-kpi kpi-daily"><span className="cm-analytics-kpi-icon"><Activity size={15}/></span><small>PROJECTED DAILY</small><strong>{projectedDailyTotal>0?fmt(projectedDailyTotal,6):"—"} <em>{tokenSymbol||"CKI"}</em></strong><span className="cm-analytics-kpi-note">{projectedDailyTotal>0?`≈ $${fmt(projectedDailyTotal*usdPerTokenValue,2)} / day`:"Configure a package rate"}</span></div>
          <div className="cm-analytics-kpi kpi-forecast"><span className="cm-analytics-kpi-icon"><Target size={15}/></span><small>REMAINING FORECAST</small><strong>{fmt(projectedRemainingTotal,4)} <em>{tokenSymbol||"CKI"}</em></strong><span className="cm-analytics-kpi-note">{projectedRemainingTotal>0?`≈ $${fmt(projectedRemainingUsd,2)} to end of active terms`:"No active term"}</span></div>
        </div>
        <div className="cm-analytics-body">
          <article className="cm-analytics-chart" aria-label="Rewards earned over the last seven days">
            <div className="cm-analytics-chart-head"><div><h3>Rewards · last 7 days</h3>{projectedTermTotal>0&&<small className="cm-analytics-chart-term">Term projection ≈ {fmt(projectedTermTotal,4)} {tokenSymbol||"CKI"}</small>}</div><span className="cm-analytics-chart-total">{fmt(mined7d,6)} {tokenSymbol||"CKI"}</span></div>
            <div className="cm-analytics-bars" role="img" aria-label={`Rewards over the last seven days; tallest day ${fmt(dayMax,6)} ${tokenSymbol||"CKI"}`}>
              {dayBuckets.map(bucket => <div className="cm-analytics-bar-col" key={bucket.key} title={`${bucket.label}: ${fmt(bucket.value,6)} ${tokenSymbol||"CKI"}`}><span className="cm-analytics-bar-track"><i style={{height:`${Math.max(bucket.value>0?6:3,Math.round((bucket.value/dayMax)*100))}%`}}/></span><small>{bucket.label}</small></div>)}
            </div>
          </article>
          <article className="cm-analytics-goal" aria-label="Mining reward goal tracker">
            <div className="cm-analytics-goal-head"><h3><Target size={14}/> Reward goal</h3><small>Set a personal target</small></div>
            <label className="cm-analytics-goal-input"><span>Target {tokenSymbol||"CKI"}</span><input value={goalTarget} inputMode="decimal" placeholder="e.g. 10000" onChange={e=>saveGoal(e.target.value)} aria-label={`Target ${tokenSymbol||"CKI"} reward goal`}/></label>
            <div className="cm-analytics-goal-meter" role="progressbar" aria-valuenow={goalProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress toward reward goal"><i style={{width:`${goalProgress}%`}}/><span className="cm-analytics-goal-meter-label">{goalValue>0?`${goalProgress}%`:"—"}</span></div>
            <div className="cm-analytics-goal-facts"><div><small>Current</small><b>{fmt(availableCki,4)} {tokenSymbol||"CKI"}</b></div><div><small>Remaining</small><b>{goalValue>0?`${fmt(goalRemaining,4)} ${tokenSymbol||"CKI"}`:"—"}</b></div><div><small>Est. days to goal</small><b>{goalEtaDays!=null?(goalEtaDays===0?"Reached":`≈ ${goalEtaDays}`):"—"}</b></div></div>
            {goalValue>0&&goalRemaining<=0&&<span className="cm-analytics-goal-done">Goal reached — keep mining to build your balance.</span>}
          </article>
        </div>
      </section>

      <section className="cm-wallet-hash-grid" aria-label="Mining wallet and hash rate">
        <article className="cm-glass cm-wallet-card"><div className="cm-wallet-total"><div className="cm-card-title"><span className="cm-icon-cyan"><WalletCards size={19}/></span><b>{tokenSymbol} WALLET BALANCE</b></div><div className="cm-wallet-value"><span className="cm-wallet-coin"><CoinMark iconUrl={tokenIconUrl}/></span><div><small>Total {tokenSymbol}</small><strong>{fmt(data?.balances?.CKI ?? data?.tokenBalance,6)} <small>{tokenSymbol}</small></strong><span className="cm-positive">Historical Mining ledger total</span></div></div></div><div className="cm-wallet-currencies"><div className="cm-currency-list">{TARGET_ASSETS.map(asset=><button type="button" key={asset} className={`cm-currency ${swapTarget===asset?"selected":""}`} onClick={()=>selectSwapTarget(asset)} aria-pressed={swapTarget===asset}><i className={`currency-${asset.toLowerCase()}`}>{currencyIcons[asset]}</i><small>{asset}</small></button>)}</div><small className="cm-swap-note">Selected main-wallet balance: {fmt(mainWalletAvailable(swapTarget),mainWalletScale(swapTarget))} {swapTarget||"—"}</small><button type="button" className="cm-glow-button cm-swap-all" disabled={!canSwapAll || swapQuoteMutation.isPending || swapMutation.isPending} onClick={startFullBalanceSwap}><ArrowDownUp size={15}/>{swapMutation.isPending?"Posting conversion…":`Swap All to ${swapTarget}`}</button>{!canSwapAll&&<small className="cm-swap-note">A positive available CKI balance and a selected main-wallet currency are required.</small>}</div></article>
        <article className="cm-glass cm-hash-card"><div className="cm-card-title"><span className="cm-icon-cyan"><Zap size={19}/></span><b>CURRENT HASH RATE</b></div><div className="cm-hash-content"><div><strong>{fmt(data?.activeThs,3)} <small>TH/s</small></strong><span className="cm-positive">Base {fmt(data?.baseThs,3)} · Boost {fmt(data?.boostThs,3)} TH/s</span></div><div className="cm-hash-details"><small>Total Power</small><b>{fmt(data?.activeThs,3)} TH/s</b><small>Package</small><b>{activePackageNames}</b></div><svg className="cm-sparkline" viewBox="0 0 170 70" preserveAspectRatio="none" aria-label="Illustrative hash rate trace"><defs><linearGradient id="cm-hash-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#10d9ff" stopOpacity=".35"/><stop offset="1" stopColor="#10d9ff" stopOpacity="0"/></linearGradient></defs><path d="M0 54 C12 47 12 24 25 32 S42 54 52 39 S66 11 78 28 S94 49 105 35 S124 52 135 25 S153 32 170 5 L170 70 L0 70Z" fill="url(#cm-hash-fill)"/><path d="M0 54 C12 47 12 24 25 32 S42 54 52 39 S66 11 78 28 S94 49 105 35 S124 52 135 25 S153 32 170 5" fill="none" stroke="#18dfff" strokeWidth="2"/></svg></div></article>
      </section>

      <section className="cm-glass cm-packages-panel">
        <div className="cm-packages-header"><div><h2>Mining Packages</h2><p>Choose from packages currently published by operations</p><p className="cm-purchase-disclosure">Select a package to open a secure purchase panel where you choose which main-wallet balance funds the purchase. A fresh exchange quote is shown before any charge; by confirming, you accept the package terms shown on each card. Capacity activates immediately according to that package’s stacking policy (add or replace); configured CKI rewards accrue automatically while reward processing is enabled.</p></div><div className="cm-package-tabs" role="tablist" aria-label="Filter packages">{[["all","All Packages"],["mine","My Packages"],["upgrade","Upgrade"],["downgrade","Downgrade"]].map(([id,label])=><button type="button" role="tab" aria-selected={packageTab===id} className={packageTab===id?"selected":""} key={id} onClick={()=>setPackageTab(id)}>{label}</button>)}</div></div>
        <div className="cm-packages-toolbar"><label className="cm-package-search"><span>Search</span><input type="search" value={packageSearch} onChange={e=>setPackageSearch(e.target.value)} placeholder="Search packages…" aria-label="Search mining packages"/></label><label className="cm-package-sort"><span>Sort</span><select value={packageSort} onChange={e=>setPackageSort(e.target.value)} aria-label="Sort mining packages">{[["recommended","Recommended"],["price-low","Price: low to high"],["price-high","Price: high to low"],["hashrate","Highest hash rate"],["name","Name (A–Z)"]].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button className="cm-refresh-button" type="button" onClick={()=>{void packages.refetch();void dashboard.refetch()}} aria-label="Refresh packages"><RefreshCw size={15}/></button></div>
        {active.length>0&&<div className="cm-active-note"><Cpu size={14}/><b>YOUR ACTIVE CAPACITY</b><span>{activePackageNames} · {fmt(activeBase,3)} TH/s</span></div>}
        <div className="cm-package-carousel">
          {packages.isLoading&&<div className="cm-empty">Loading published packages…</div>}
          {!packages.isLoading&&!packages.isError&&!filteredPackages.length&&<div className="cm-empty">{packageRows.length?"No packages match this filter.":"No mining packages are currently published. Package terms and prices will appear here after operations publishes them."}</div>}
          {filteredPackages.map((item:any)=>{
            const activeSame=active.some((current:any)=>current.code===item.code);
            const intent=Number(item.baseThs)>activeBase?"Add hash power":"Buy package";
            const theme=getMiningPackageTheme(item.themeKey);
            const canPurchase=item.purchaseAvailable===true;
            const purchaseInProgress=(quotePurchaseMutation.isPending||confirmPurchaseMutation.isPending)&&buyPackage?.versionId===item.versionId;
            const unavailableReason=String(item.purchaseUnavailableReason||"");
            const statusLabel=activeSame?"ACTIVE":item.alreadyPurchased?"PURCHASED":canPurchase?"AVAILABLE":item.status!=="published"?"PAUSED":"PURCHASES PAUSED";
            const buttonLabel=item.alreadyPurchased?"Purchased":purchaseInProgress?"Opening…":canPurchase?intent:item.status!=="published"?"Paused":"Purchases paused";
            return <article className={`cm-package-card theme-${theme.key} ${activeSame?"is-current":""}`} key={item.versionId} style={{"--package-accent":theme.accent,"--package-glow":theme.glow,"--package-surface-start":theme.surfaceStart,"--package-surface-end":theme.surfaceEnd,"--package-button-start":theme.buttonStart,"--package-button-end":theme.buttonEnd} as React.CSSProperties}>
              <div className="cm-package-art"><div className="cm-cube"><i/><i/><b><CoinMark iconUrl={tokenIconUrl}/></b></div><span className="cm-package-glow"/></div>
              <div className="cm-package-label"><h3>{item.name}</h3><span>{statusLabel}</span></div><small className="cm-package-theme-name">{theme.label} theme</small>
              <div className="cm-package-price"><strong>{fmt(item.priceAmount,assetScaleFor(item.priceAsset,mainWallet.data?.currencies))}</strong><small>{item.priceAsset}</small></div>
              <div className="cm-package-facts"><b>{fmt(item.baseThs,3)} <small>TH/s</small></b><span>Boost +{fmt(item.boostBonusThs,3)} TH/s</span><span>Term {item.durationMonths==null?(item.termDays?`≈ ${fmt(item.termDays,0)} days`:"not set"):`${item.durationMonths} months`}</span><span>{item.effectiveDailyRewardCki==null?"Daily CKI rate not configured":`≈ ${fmt(item.effectiveDailyRewardCki,8)} CKI/day${Number(item.miningSpeedMultiplier||1)!==1?` · ${fmt(item.miningSpeedMultiplier,4)}× speed`:""}`}</span><span className="cm-package-projection">{item.projectedTermTokens?`Projected term ≈ ${fmt(item.projectedTermTokens,4)} ${tokenSymbol||"CKI"}${item.projectedTermUsd?` · ≈ $${fmt(item.projectedTermUsd,2)}`:""}`:"Term projection unavailable until a duration is set"}</span>{item.remainingPurchases!=null&&<span className="cm-package-limit">Purchases remaining: {item.remainingPurchases}{Number(item.maxPerCustomer)>0?` of ${item.maxPerCustomer}`:""}</span>}</div>
              {item.termsText&&<details className="cm-package-terms"><summary>Review package terms</summary><p>{item.termsText}</p></details>}
              <div className="cm-package-actions">
                <button type="button" className={`cm-compare-toggle${compareIds.includes(item.versionId)?" is-selected":""}`} aria-pressed={compareIds.includes(item.versionId)} onClick={()=>toggleCompare(item.versionId)} title={compareIds.includes(item.versionId)?"Remove this package from the comparison panel":"Add this package to the comparison panel (up to 3)"}><Scale size={13}/>{compareIds.includes(item.versionId)?"Added":"Compare"}</button>
                <button type="button" className="cm-package-buy" disabled={!canPurchase||purchaseInProgress} title={canPurchase?"Open the purchase panel to review a live quote and choose which wallet balance funds this package.":(unavailableReason||"Unavailable")} aria-label={`Buy ${item.name}; opens the purchase panel to choose a wallet and review a live quote`} onClick={()=>{if(!canPurchase||purchaseInProgress)return;openBuyDialog(item)}}>{buttonLabel}<ArrowRight size={13}/></button>
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="cm-bottom-strip" aria-label="Mining platform features"><div><Cpu/><span><b>PACKAGE HASHPOWER</b><small>Active purchased capacity</small></span></div><div><Activity/><span><b>LIVE ACCOUNT DATA</b><small>Refreshes every few seconds</small></span></div><div><ArrowDownUp/><span><b>INTERNAL SWAPS</b><small>Quote and ledger guarded</small></span></div><div><Zap/><span><b>HASH POWER BOOST</b><small>{boost?.activeBoost?"Active now":"2-minute boost · 4-hour customer cooldown"}</small></span></div><div><ShieldCheck/><span><b>ACCOUNT SECURITY</b><small>Customer session protected</small></span></div></section>

      <details className="cm-advanced-conversion"><summary><span><Sparkles size={16}/><b>Automatic conversion preferences</b><small>Future rewards only · Version {data?.conversionPreference?.version||0}</small></span><ChevronDown size={16}/></summary><p>Optional background conversion for eligible future reward intervals. A failed or stale quote leaves CKI in your wallet. This preference does not convert your existing balance.</p><div className="cm-auto-controls"><label className="cm-checkbox"><input type="checkbox" checked={prefEnabled} onChange={e=>setPrefEnabled(e.target.checked)}/><span>Automatically convert eligible future rewards</span></label><label>Destination<select value={prefTarget} onChange={e=>setPrefTarget(e.target.value)}>{TARGET_ASSETS.map(asset=><option key={asset}>{asset}</option>)}</select></label><label>Minimum {tokenSymbol}<input value={prefThreshold} onChange={e=>setPrefThreshold(e.target.value)} inputMode="decimal"/></label><button type="button" className="cm-secondary-button" disabled={preferenceMutation.isPending} onClick={()=>preferenceMutation.mutate({enabled:prefEnabled,targetDenomination:prefTarget,minimumThreshold:prefThreshold})}>{preferenceMutation.isPending?"Saving…":"Save preference"}</button></div><div className="cm-queue-note"><Clock3 size={14}/> Pending conversion jobs: <strong>{data?.pendingConversionJobs||0}</strong></div></details>

      <section className="cm-glass cm-history">
        <div className="cm-history-heading">
          <div>
            <span className="cm-eyebrow">MINING ACCOUNT LEDGER</span>
            <h2>Mining activity</h2>
            <small className="cm-history-count">Latest 30 entries · 5 per page</small>
          </div>
          <button className="cm-refresh-button" type="button" onClick={() => history.refetch()} aria-label="Refresh activity"><RefreshCw size={15}/></button>
        </div>
        {history.isLoading ? <div className="cm-empty">Loading ledger history…</div> : history.isError ? <div className="cm-empty">Activity could not be loaded. Use Refresh activity to retry.</div> : !recent.length ? <div className="cm-empty">No Mining transactions have been recorded yet.</div> : <>
          <div className="cm-table-wrap">
            <table className="cm-table">
              <thead><tr><th>Event</th><th>Reference</th><th>Status</th><th>When</th></tr></thead>
              <tbody>{pagedRecent.map((row: any) => <tr key={row.id}>
                <td><strong>{String(row.type).replaceAll("_", " ")}</strong>{row.details?.destinationAmount && <small>{fmt(row.details.destinationAmount, 8)} {row.details.destinationAsset}</small>}</td>
                <td>{row.reference}</td>
                <td><span className="cm-history-status">{String(row.status).toLowerCase() === "posted" ? "Paid" : row.status}</span></td>
                <td>{dateText(row.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {recent.length > 5 && <nav className="cm-history-pagination" aria-label="Mining activity pages">
            <span>Showing {currentHistoryPage * 5 + 1}–{Math.min((currentHistoryPage + 1) * 5, recent.length)} of {recent.length} latest</span>
            <div className="cm-history-pagination-controls">
              <button className="cm-history-page-btn" type="button" onClick={() => setHistoryPage(Math.max(0, currentHistoryPage - 1))} disabled={currentHistoryPage === 0} aria-label="Previous activity page"><ChevronLeft size={14}/><span>Previous</span></button>
              <span className="cm-page-indicator">Page {currentHistoryPage + 1} of {historyPageCount}</span>
              <button className="cm-history-page-btn" type="button" onClick={() => setHistoryPage(Math.min(historyPageCount - 1, currentHistoryPage + 1))} disabled={currentHistoryPage >= historyPageCount - 1} aria-label="Next activity page"><span>Next</span><ChevronRight size={14}/></button>
            </div>
          </nav>}
        </>}
      </section>

      <footer className="cm-disclaimer"><ShieldCheck size={15}/><span>Configured package rewards are internal estimates, prorated by eligible contract time and recorded in the CKI ledger. They are not verified pool output, withdrawable funds, or a cash payout. CKI swaps credit the selected main wallet; no external transfer is initiated here.</span><b>Economics v{data?.economicsVersion||"—"}</b></footer>
    </main>

    {compareIds.length>0 && <div className="cm-compare-bar" role="region" aria-label="Package comparison selection">
      <span className="cm-compare-bar-lead"><Scale size={15}/><b>{compareIds.length}</b>selected<small>Pick 2–3 packages</small></span>
      <div className="cm-compare-bar-chips">{compareRows.map((item:any)=><button type="button" key={item.versionId} className="cm-compare-chip" onClick={()=>toggleCompare(item.versionId)} title={`Remove ${item.name} from comparison`}>{item.name} <span aria-hidden="true">×</span></button>)}</div>
      <div className="cm-compare-bar-actions">
        <button type="button" className="cm-secondary-button" onClick={()=>{setCompareIds([]);setCompareOpen(false);}}>Clear</button>
        <button type="button" className="cm-glow-button" disabled={compareIds.length<2} onClick={()=>setCompareOpen(true)} title={compareIds.length<2?"Select at least two packages to compare":undefined}><Scale size={15}/>Compare{compareIds.length>=2?` (${compareIds.length})`:""}</button>
      </div>
    </div>}

    {buyPackage && (()=>{
      const theme=getMiningPackageTheme(buyPackage.themeKey);
      const currencies=mainWallet.data?.currencies||[];
      const quote=buyQuote;
      const quoting=quotePurchaseMutation.isPending;
      const confirming=confirmPurchaseMutation.isPending;
      const insufficient=Boolean(quote&&!quote.sufficientBalance);
      return <div className="cm-buy-backdrop" role="presentation" onClick={()=>{if(!confirming){setBuyPackage(null);setBuyQuote(null);setBuyTerms(false);}}}>
        <div className={`cm-buy-dialog theme-${theme.key}`} role="dialog" aria-modal="true" aria-label={`Buy ${buyPackage.name}`} onClick={e=>e.stopPropagation()} style={{"--package-accent":theme.accent,"--package-glow":theme.glow,"--package-surface-start":theme.surfaceStart,"--package-surface-end":theme.surfaceEnd,"--package-button-start":theme.buttonStart,"--package-button-end":theme.buttonEnd} as React.CSSProperties}>
          <header className="cm-buy-head">
            <div className="cm-buy-heading"><span className="cm-package-theme-name">{theme.label} theme</span><h3>{buyPackage.name}</h3><small>{buyPackage.code}</small></div>
            <button type="button" className="cm-buy-close" onClick={()=>{setBuyPackage(null);setBuyQuote(null);setBuyTerms(false);}} aria-label="Close purchase panel" disabled={confirming}>×</button>
          </header>
          <div className="cm-buy-body">
            <div className="cm-buy-summary">
              <div className="cm-buy-summary-price"><span>Package price</span><strong>{fmt(buyPackage.priceAmount,assetScaleFor(buyPackage.priceAsset,mainWallet.data?.currencies))} <small>{buyPackage.priceAsset}</small></strong></div>
              <div className="cm-buy-facts"><span><b>{fmt(buyPackage.baseThs,3)}</b> TH/s hash rate</span><span>Boost +{fmt(buyPackage.boostBonusThs,3)} TH/s</span><span>Term {buyPackage.durationMonths==null?(buyPackage.termDays?`≈ ${fmt(buyPackage.termDays,0)} days`:"not set"):`${buyPackage.durationMonths} months`}</span><span>{buyPackage.effectiveDailyRewardCki==null?"Daily CKI rate not configured":`≈ ${fmt(buyPackage.effectiveDailyRewardCki,8)} CKI/day`}</span>{buyPackage.projectedTermTokens&&<span>Projected ≈ {fmt(buyPackage.projectedTermTokens,4)} {tokenSymbol||"CKI"}</span>}</div>
            </div>
            <div className="cm-buy-section">
              <h4>Pay from wallet</h4>
              <p className="cm-buy-hint">Select which of your main-wallet balances funds this purchase. A fresh exchange quote is calculated for your choice.</p>
              <div className="cm-buy-wallets" role="radiogroup" aria-label="Select payment wallet">
                {(currencies.length?currencies.map((c:any)=>c.code):TARGET_ASSETS).map((code:string)=>{
                  return <button type="button" role="radio" aria-checked={buyAsset===code} key={code} className={`cm-buy-wallet${buyAsset===code?" selected":""}`} onClick={()=>selectBuyAsset(code)} disabled={quoting||confirming}>
                    <i>{currencyIcons[code]||code.slice(0,1)}</i>
                    <b>{code}</b>
                    <small>{fmt(mainWalletAvailable(code),mainWalletScale(code)||assetScaleFor(code,currencies))} available</small>
                  </button>;
                })}
              </div>
            </div>
            <div className="cm-buy-quote">
              <div className="cm-buy-row"><span>Package price</span><b>{buyPackage.priceAsset} {fmt(buyPackage.priceAmount,assetScaleFor(buyPackage.priceAsset,mainWallet.data?.currencies))}</b></div>
              <div className="cm-buy-row"><span>Payment wallet</span><b>{buyAsset||"—"}</b></div>
              <div className="cm-buy-row"><span>Amount charged{buyQuote&&Number(buyQuote.fee)>0?" (incl. fee)":""}</span><b>{quoting?"Calculating…":quote?`${fmt(quote.sourceAmount,mainWalletScale(quote.paymentAsset))} ${quote.paymentAsset}`:"—"}</b></div>
              <div className="cm-buy-row"><span>Fee</span><b>{quote?`${fmt(quote.fee,mainWalletScale(quote.paymentAsset))} ${quote.paymentAsset}`:"—"}</b></div>
              <div className="cm-buy-row"><span>Available balance</span><b>{quote?`${fmt(quote.availableBalance,mainWalletScale(quote.paymentAsset))} ${quote.paymentAsset}`:fmt(mainWalletAvailable(buyAsset),mainWalletScale(buyAsset))+" "+buyAsset}</b></div>
              {quote&&<div className={`cm-buy-status${buyQuoteExpired?" expired":insufficient?" short":" ok"}`}>{buyQuoteExpired?"This quote expired — choose a wallet again to refresh.":insufficient?`Insufficient ${buyAsset} balance for this purchase.`:"Quote is valid and your balance is sufficient."}</div>}
              {quote&&!buyQuoteExpired&&!insufficient&&<div className="cm-buy-expiry">Quote valid until {dateText(quote.expiresAt)} · provider {quote.provider||"—"}</div>}
            </div>
            {buyPackage.termsText&&<details className="cm-buy-terms"><summary>Review package terms</summary><p>{buyPackage.termsText}</p></details>}
            <label className="cm-checkbox cm-buy-accept"><input type="checkbox" checked={buyTerms} onChange={e=>setBuyTerms(e.target.checked)} disabled={confirming}/><span>I have reviewed the package terms and accept the amount shown above.</span></label>
          </div>
          <footer className="cm-buy-actions">
            <button type="button" className="cm-secondary-button" onClick={()=>{setBuyPackage(null);setBuyQuote(null);setBuyTerms(false);}} disabled={confirming}>Cancel</button>
            <button type="button" className="cm-glow-button cm-buy-confirm" disabled={!buyCanConfirm} onClick={()=>{if(!buyQuote||!buyCanConfirm)return;confirmPurchaseMutation.mutate({quoteId:buyQuote.quoteId,idempotencyKey:requestId(),acceptedTerms:true});}}>{confirming?"Processing purchase…":"Confirm purchase"}<ArrowRight size={14}/></button>
          </footer>
        </div>
      </div>;
    })()}

    {compareOpen && compareRows.length>=2 && <div className="cm-buy-backdrop" role="presentation" onClick={()=>setCompareOpen(false)}>
      <div className="cm-compare-dialog" role="dialog" aria-modal="true" aria-label="Package comparison" onClick={e=>e.stopPropagation()}>
        <header className="cm-compare-head">
          <div><span className="cm-eyebrow"><Scale size={13}/> PACKAGE COMPARISON</span><h3>Compare {compareRows.length} packages</h3></div>
          <button type="button" className="cm-buy-close" onClick={()=>setCompareOpen(false)} aria-label="Close comparison">×</button>
        </header>
        <div className="cm-compare-scroll">
          <table className="cm-compare-table">
            <thead><tr><th scope="col">Metric</th>{compareRows.map((item:any,index:number)=><th scope="col" key={item.versionId} className={index===compareBestIdx?"is-best":""}>{item.name}{index===compareBestIdx&&<small className="cm-compare-best">Best value</small>}</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">Price</th>{compareRows.map((item:any)=><td key={item.versionId}>{fmt(item.priceAmount,assetScaleFor(item.priceAsset,mainWallet.data?.currencies))} <small>{item.priceAsset}</small></td>)}</tr>
              <tr><th scope="row">Base hash power</th>{compareRows.map((item:any)=><td key={item.versionId}>{fmt(item.baseThs,3)} TH/s</td>)}</tr>
              <tr><th scope="row">Boost bonus</th>{compareRows.map((item:any)=><td key={item.versionId}>+{fmt(item.boostBonusThs,3)} TH/s</td>)}</tr>
              <tr><th scope="row">Total hash power</th>{compareRows.map((item:any)=><td key={item.versionId}>{fmt(Number(item.baseThs||0)+Number(item.boostBonusThs||0),3)} TH/s</td>)}</tr>
              <tr><th scope="row">Daily {tokenSymbol||"CKI"}</th>{compareRows.map((item:any)=><td key={item.versionId}>{item.effectiveDailyRewardCki==null?"Not configured":`≈ ${fmt(item.effectiveDailyRewardCki,8)}`}</td>)}</tr>
              <tr><th scope="row">Term</th>{compareRows.map((item:any)=><td key={item.versionId}>{item.durationMonths==null?(item.termDays?`≈ ${fmt(item.termDays,0)} days`:"Not set"):`${item.durationMonths} months`}</td>)}</tr>
              <tr><th scope="row">Projected term {tokenSymbol||"CKI"}</th>{compareRows.map((item:any)=><td key={item.versionId}>{item.projectedTermTokens?fmt(item.projectedTermTokens,4):"—"}</td>)}</tr>
              <tr><th scope="row">Projected term value</th>{compareRows.map((item:any)=><td key={item.versionId}>{item.projectedTermUsd?`≈ $${fmt(item.projectedTermUsd,2)}`:"—"}</td>)}</tr>
              <tr><th scope="row">Entry cost / TH/s</th>{compareRows.map((item:any)=>{const perThs=comparePricePerThs(item);return <td key={item.versionId}>{compareSameAsset&&perThs!=null?`${fmt(perThs,assetScaleFor(item.priceAsset,mainWallet.data?.currencies))} ${item.priceAsset}`:"—"}</td>;})}</tr>
            </tbody>
          </table>
        </div>
        <footer className="cm-compare-foot"><small>Values are admin-configured package terms and simulated projections, not guaranteed returns. Inactive or paused packages cannot be purchased.</small></footer>
      </div>
    </div>}

  </div>;
}
