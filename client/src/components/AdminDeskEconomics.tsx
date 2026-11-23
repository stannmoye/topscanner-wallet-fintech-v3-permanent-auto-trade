import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CalendarPlus, Check, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  DESK_KEYS,
  ECONOMICS_BOUNDS,
  currencyMinorToUsdMinor,
  deskLabel,
  type DeskEconomics,
  type DeskKey,
} from "@shared/investment-economics";
import "./desk-economics-admin.css";

/** Only this many rows render at once; the search narrows the rest into view. */
const VISIBLE_CAP = 200;

const localUnits = (minor: number, scale: number) => minor / Math.pow(10, scale);

const fmtLocal = (row: DeskEconomics) =>
  `${row.currencySymbol}${localUnits(row.fundingTargetMinor, row.currencyScale).toLocaleString(undefined, { maximumFractionDigits: row.currencyScale })}`;

const usdMinorOf = (row: DeskEconomics) => currencyMinorToUsdMinor(row.fundingTargetMinor, row.currency);
const fmtUsd = (minor: number) => `$${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

/**
 * Cross-desk economic console. The administrator picks a desk from the dropdown
 * to load that desk's stored offers, then edits one or many at once — set the
 * funding amount, the interest/profit rate, or extend the close and payout dates
 * by whole months. Every change is written as an administrator profile so the
 * automatic assignment can never overwrite it.
 */
export function AdminDeskEconomics() {
  const utils = trpc.useUtils();
  const [desk, setDesk] = useState<DeskKey>(DESK_KEYS[0]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [closeMonths, setCloseMonths] = useState("");
  const [payoutMonths, setPayoutMonths] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [profitPercent, setProfitPercent] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const query = trpc.adminOperations.deskEconomics.useQuery({ desk }, { refetchInterval: 20000 });
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.instrumentId.toLowerCase().includes(term));
  }, [rows, search]);

  const visible = filtered.slice(0, VISIBLE_CAP);
  const visibleIds = visible.map((row) => row.instrumentId);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const notify = (text: string, kind: "success" | "error" = "success") => { setMessageKind(kind); setMessage(text); };

  const bulk = trpc.adminOperations.bulkSetDeskEconomics.useMutation({
    onSuccess: (_data, variables) => {
      utils.adminOperations.deskEconomics.invalidate({ desk });
      setSelected([]);
      notify(`Updated ${variables.instrumentIds.length} ${variables.instrumentIds.length === 1 ? "offer" : "offers"} on ${deskLabel(desk)}.`);
    },
    onError: (error) => notify(`Bulk update failed: ${error.message}`, "error"),
  });

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const toggleAllVisible = () => setSelected((list) => (allVisibleSelected
    ? list.filter((id) => !visibleIds.includes(id))
    : [...new Set([...list, ...visibleIds])]));

  const applyBulk = () => {
    if (!selected.length) { notify("Select at least one offer first.", "error"); return; }
    const profit = profitPercent.trim() ? Math.round(Number(profitPercent) * 100) : undefined;
    if (profit !== undefined && (Number.isNaN(profit) || profit < ECONOMICS_BOUNDS.profitMinBps || profit > ECONOMICS_BOUNDS.profitMaxBps)) {
      notify(`Profit must be between ${ECONOMICS_BOUNDS.profitMinBps / 100}% and ${ECONOMICS_BOUNDS.profitMaxBps / 100}%.`, "error");
      return;
    }
    const amountMinor = amountUsd.trim() ? Math.round(Number(amountUsd) * 100) : undefined;
    if (amountMinor !== undefined && (!Number.isFinite(amountMinor) || amountMinor <= 0)) {
      notify("Enter a positive USD funding target.", "error");
      return;
    }
    const extendClose = closeMonths.trim() ? Number(closeMonths) : undefined;
    const extendPayout = payoutMonths.trim() ? Number(payoutMonths) : undefined;
    if (profit === undefined && amountMinor === undefined && !extendClose && !extendPayout) {
      notify("Enter at least one value (amount, interest, or a month extension) to apply.", "error");
      return;
    }
    bulk.mutate({
      desk,
      instrumentIds: selected,
      ...(profit !== undefined ? { profitBps: profit } : {}),
      amountUsdMinor: amountMinor,
      extendCloseMonths: extendClose,
      extendMaturityMonths: extendPayout,
    });
  };

  const quickExtend = (id: string) => bulk.mutate({ desk, instrumentIds: [id], extendCloseMonths: 1, extendMaturityMonths: 1 });

  return <div className="arb-page portal-page">
    <div className="portal-page-top">
      <div>
        <div className="eyebrow">Cross-desk economic profiles</div>
        <h1>Desk economics</h1>
        <p>Load any desk's offers from the dropdown, then edit one or many at once. Amounts, interest, close deadlines and payout dates are all administrator-controlled and audited.</p>
      </div>
    </div>

    <div className="settings-card de-bulk-card">
      <div className="de-bulk-row">
        <label>Desk
          <select value={desk} onChange={(event) => { setDesk(event.target.value as DeskKey); setSelected([]); setMessage(""); }}>
            {DESK_KEYS.map((key) => <option key={key} value={key}>{deskLabel(key)}</option>)}
          </select>
        </label>
        <label>Search offers
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by offer id" />
        </label>
      </div>

      <div className="de-bulk-heading">
        <span><SlidersHorizontal size={15}/> Bulk edit</span>
        <small>{selected.length} selected · {rows.length} stored offers on {deskLabel(desk)}</small>
      </div>

      <div className="de-bulk-grid">
        <label>Extend close by (months)
          <input type="number" min="0" max="60" value={closeMonths} onChange={(event) => setCloseMonths(event.target.value)} placeholder="e.g. 1"/>
        </label>
        <label>Extend payout by (months)
          <input type="number" min="0" max="60" value={payoutMonths} onChange={(event) => setPayoutMonths(event.target.value)} placeholder="e.g. 1"/>
        </label>
        <label>Set funding target (USD)
          <input type="number" min="0" step="1" value={amountUsd} onChange={(event) => setAmountUsd(event.target.value)} placeholder="e.g. 250000"/>
        </label>
        <label>Set interest / profit (%)
          <input type="number" min="25" max="38" step="0.25" value={profitPercent} onChange={(event) => setProfitPercent(event.target.value)} placeholder="e.g. 32"/>
        </label>
      </div>

      <div className="de-bulk-actions">
        <button className="primary-button" disabled={bulk.isPending || !selected.length} onClick={applyBulk}>
          {bulk.isPending ? "Applying…" : `Apply to ${selected.length} selected`} <Check size={14}/>
        </button>
        <button className="secondary-button" type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button>
        <span className="de-bulk-hint">Tick one offer for a single edit, or tick many to apply the same change in one action.</span>
      </div>

      {message && <div className={messageKind === "error" ? "auth-error" : "test-notice"} role={messageKind === "error" ? "alert" : "status"}>{message}</div>}
    </div>

    {query.isLoading && <div role="status">Loading desk offers…</div>}
    {query.isError && <div className="auth-error" role="alert">Could not read desk offers: {query.error.message}</div>}

    {!query.isLoading && !query.isError && <>
      <div className="de-table">
        <div className="de-table-head">
          <label className="de-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible offers"/></label>
          <span>Offer</span><span>Currency</span><span>Funding target</span><span>Interest</span><span>Term</span><span>Fee</span><span>Closes</span><span>Payout</span><span>Profile</span><span/>
        </div>
        {visible.map((row) => {
          const isSelected = selectedSet.has(row.instrumentId);
          return <div className={"de-table-row" + (isSelected ? " is-selected" : "")} key={row.instrumentId} role="button" tabIndex={0} aria-pressed={isSelected}
            onClick={() => toggle(row.instrumentId)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(row.instrumentId); } }}>
            <label className="de-check" onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(row.instrumentId)} aria-label={`Select ${row.instrumentId}`}/>
            </label>
            <span className="de-id" title={row.instrumentId}>{row.instrumentId}</span>
            <span>{row.currency}</span>
            <span><strong>{fmtLocal(row)}</strong><small>{fmtUsd(usdMinorOf(row))}</small></span>
            <span>{row.profitBps > 0 ? fmtPct(row.profitBps) : "—"}</span>
            <span>{row.termDays}d</span>
            <span>{fmtPct(row.platformFeeBps)}</span>
            <span>{row.closeDate}</span>
            <span>{row.maturityDate}{row.settlementDelayDays ? <small>+{row.settlementDelayDays}d delay</small> : null}</span>
            <span><b className={"de-badge " + (row.source === "ADMIN" ? "is-admin" : "is-auto")}>{row.source === "ADMIN" ? "Admin" : "Auto"}</b></span>
            <span className="de-row-actions">
              <button type="button" className="de-quick" disabled={bulk.isPending} title="Extend the close and payout dates by one month"
                onClick={(event) => { event.stopPropagation(); quickExtend(row.instrumentId); }}>
                Extend 1 mo
              </button>
            </span>
          </div>;
        })}
        {!visible.length && <div className="empty-state">
          <CalendarPlus size={22}/>
          <strong>No stored offers for this desk yet.</strong>
          <span>Offers appear here as soon as a customer loads that desk, or after an administrator publishes them.</span>
        </div>}
      </div>
      {filtered.length > visible.length && <p className="de-note">Showing {visible.length} of {filtered.length} matching offers. Narrow the search to reach the rest.</p>}
      <p className="de-note"><ShieldCheck size={13}/> Every change is written as an administrator profile and is never overwritten by the automatic assignment.</p>
    </>}
  </div>;
}
