import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Activity, Antenna, Check, ChevronRight, Radio, ScanLine, ShieldCheck, Signal, Waves } from "lucide-react";

type ScannerOffer = { venueFrom?: string | null; venueTo?: string | null; exchange?: string | null; symbol?: string | null; popupEligible?: boolean; offerStatus?: string | null };
type ScannerFeed = { offers?: ScannerOffer[]; serverTime?: string | null };

type ScanState = "scanning" | "permitted";

const FALLBACK_NETWORK = [
  "NASDAQ", "NYSE", "LSE", "SSE", "HKEX", "XETRA", "TSX", "ASX",
];

function uniqueNetwork(feed?: ScannerFeed) {
  const fromFeed = (feed?.offers ?? []).flatMap((offer) => [offer.venueFrom, offer.venueTo, offer.exchange])
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter((value) => value && value !== "INFORMATIONAL");
  return Array.from(new Set([...fromFeed, ...FALLBACK_NETWORK])).slice(0, 10);
}

export function CustomerExchangeScanner({ feed, connectionStatus, compact = false }: { feed?: ScannerFeed; connectionStatus: "connected" | "updating" | "offline"; compact?: boolean }) {
  const network = useMemo(() => uniqueNetwork(feed), [feed]);
  const trades = trpc.customer.trades.useQuery(undefined, { refetchInterval: 5000, refetchOnWindowFocus: true });
  const [cursor, setCursor] = useState(0);
  const [popupVisible, setPopupVisible] = useState(false);

  useEffect(() => {
    const tick = window.setInterval(() => setCursor((value) => (value + 1) % Math.max(network.length, 1)), 1550);
    return () => window.clearInterval(tick);
  }, [network.length]);

  useEffect(() => {
    const onPopupState = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean }>).detail;
      setPopupVisible(Boolean(detail?.visible));
    };
    window.addEventListener("arbitrade:customer-popup-state", onPopupState);
    return () => window.removeEventListener("arbitrade:customer-popup-state", onPopupState);
  }, []);

  const eligibleOffers = (feed?.offers ?? []).filter((offer) => offer.popupEligible === true && String(offer.offerStatus ?? "").toLowerCase() === "open");
  const activeTrade = (trades.data ?? []).some((trade: any) => trade.status === "confirmed" || trade.status === "pending");
  // The tower yields completely while the customer is being shown an offer or while
  // that offer's trade is executing. It returns only after the server reports settlement.
  if (popupVisible || activeTrade) return null;
  const state: ScanState = popupVisible || eligibleOffers.length > 0 ? "permitted" : "scanning";
  const currentExchange = network[cursor] ?? "NETWORK";
  const nextExchange = network[(cursor + 1) % Math.max(network.length, 1)] ?? "ROUTE";
  const statusLabel = connectionStatus === "offline" ? "LOCAL REGISTRY" : connectionStatus === "updating" ? "SYNCING" : "NETWORK LINK";

  if (compact) {
    const compactStatus = connectionStatus === "offline" ? "OFFLINE" : state === "permitted" ? "READY" : connectionStatus === "updating" ? "SYNCING" : "SCANNING";
    return (
      <aside className={`customer-exchange-scanner customer-exchange-scanner--${state} customer-exchange-scanner--compact`} aria-label={`Exchange scanner: ${compactStatus.toLowerCase()}, ${eligibleOffers.length} eligible opportunities`}>
        <span className="customer-exchange-scanner__compact-icon" aria-hidden="true"><Antenna size={14} /></span>
        <strong className="customer-exchange-scanner__compact-title">SCANNER</strong>
        <span className="customer-exchange-scanner__compact-status"><i aria-hidden="true" />{compactStatus}</span>
        <b className="customer-exchange-scanner__compact-count">{eligibleOffers.length.toString().padStart(2, "0")}</b>
      </aside>
    );
  }
  return (
    <aside className={`customer-exchange-scanner customer-exchange-scanner--${state}`} aria-label="Exchange network scanner">
      <div className="customer-exchange-scanner__scanline" aria-hidden="true" />
      <div className="customer-exchange-scanner__head">
        <div className="customer-exchange-scanner__brand"><span className="customer-exchange-scanner__tower"><Antenna size={17} /><i /><i /><i /></span><span><b>EXCHANGE SCANNER</b><small>{statusLabel} · {network.length} VENUES</small></span></div>
        <span className="customer-exchange-scanner__led" aria-hidden="true" />
      </div>
      <div className="customer-exchange-scanner__visual" aria-hidden="true">
        <div className="customer-exchange-scanner__waves"><span /><span /><span /></div>
        <div className="customer-exchange-scanner__tower-body"><div className="customer-exchange-scanner__tower-core"><Signal size={17} /><b>{state === "permitted" ? "OK" : "SCAN"}</b></div><span /><span /><span /></div>
        <div className="customer-exchange-scanner__beam" />
      </div>
      <div className="customer-exchange-scanner__state"><span className="customer-exchange-scanner__state-icon">{state === "permitted" ? <Check size={13} /> : <ScanLine size={13} />}</span><div><strong>{state === "permitted" ? "PERMITTED" : "SCANNING NETWORK"}</strong><small>{state === "permitted" ? "Opportunity gate is open" : "Checking exchange routes"}</small></div><span className="customer-exchange-scanner__count">{eligibleOffers.length.toString().padStart(2, "0")}</span></div>
      <div className="customer-exchange-scanner__route"><Radio size={12} /><span>{currentExchange}</span><ChevronRight size={12} /><span>{nextExchange}</span><span className="customer-exchange-scanner__route-dot" /></div>
      <div className="customer-exchange-scanner__feed"><span><Waves size={11} /> WAVE LINK ACTIVE</span><span><Activity size={11} /> ROTATING READOUT</span></div>
      <div className="customer-exchange-scanner__note"><ShieldCheck size={11} /> Stored exchange registry animation · no live quote or trade is created here.</div>
    </aside>
  );
}

export default CustomerExchangeScanner;
