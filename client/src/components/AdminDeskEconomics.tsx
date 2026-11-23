import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CalendarPlus, Check, RefreshCw, ShieldCheck, Shuffle, SlidersHorizontal } from "lucide-react";
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
/** Sentinel for the "every menu in one table" view. */
const ALL_DESKS = "all";
type DeskMode = DeskKey | typeof ALL_DESKS;

const localUnits = (minor: number, scale: number) => minor / Math.pow(10, scale);

const fmtLocal = (row: DeskEconomics) =>
  `${row.currencySymbol}${localUnits(row.fundingTargetMinor, row.currencyScale).toLocaleString(undefined, { maximumFractionDigits: row.currencyScale })}`;

const usdMinorOf = (row: DeskEconomics) => currencyMinorToUsdMinor(row.fundingTargetMinor, row.currency);
const fmtUsd = (minor: number) => `$${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const rowKey = (row: DeskEconomics) => `${row.desk}:${row.instrumentId}`;

/**
 * Cross-desk economic console. The administrator picks a desk — or "All desks" to
 * see every menu in one table — then edits one or many at once: set the funding
 * amount, the interest rate, or extend the close and payout dates. The tools are
 * built to move fast without making everything identical: a relative interest
 * nudge, an optional ±scatter so a bulk edit lands varied, and a one-click re-roll
 * of the automatic profiles. Every change is written as an administrator profile
 * so the automatic assignment can never overwrite it.
 */
export function AdminDeskEconomics() {
  const utils = trpc.useUtils();
  const [deskMode, setDeskMode] = useState<DeskMode>(DESK_KEYS[0]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [closeMonths, setCloseMonths] = useState("");
  const [payoutMonths, setPayoutMonths] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [profitPercent, setProfitPercent] = useState("");
  const [adjustBps, setAdjustBps] = useState("");
  const [scatterPct, setScatterPct] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const queryInput = deskMode === ALL_DESKS ? {} : { desk: deskMode };
  const query = trpc.adminOperations.deskEconomics.useQuery(queryInput, { refetchInterval: 20000 });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const rowByKey = useMemo(() => new Map(rows.map((row) => [rowKey(row), row])), [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.instrumentId.toLowerCase().includes(term) || deskLabel(row.desk).toLowerCase().includes(term));
  }, [rows, search]);

  const visible = filtered.slice(0, VISIBLE_CAP);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selectedSet.has(rowKey(row)));
  const missingFromSelection = selected.filter((key) => !rowByKey.has(key)).length;

  const notify = (text: string, kind: "success" | "error" = "success") => { setMessageKind(kind); setMessage(text); };

  const bulk = trpc.adminOperations.bulkSetDeskEconomics.useMutation();
  const reroll = trpc.adminOperations.reassignDeskEconomicsBulk.useMutation();
  const sync = trpc.adminOperations.syncDeskEconomics.useMutation();
  const busy = bulk.isPending || reroll.isPending || sync.isPending;

  /** Group the current selection by desk, since one edit can span several menus. */
  const groupSelection = (): Map<DeskKey, string[]> => {
    const groups = new Map<DeskKey, string[]>();
    for (const key of selected) {
      const row = rowByKey.get(key);
      if (!row) continue;
      const list = groups.get(row.desk) ?? [];
      list.push(row.instrumentId);
      groups.set(row.desk, list);
    }
    return groups;
  };

  const runBulk = async (payloads: Array<Parameters<typeof bulk.mutateAsync>[0]>) => {
    const total = payloads.reduce((count, payload) => count + payload.instrumentIds.length, 0);
    await Promise.all(payloads.map((payload) => bulk.mutateAsync(payload)));
    utils.adminOperations.deskEconomics.invalidate();
    setSelected([]);
    return total;
  };

  const toggle = (key: string) => setSelected((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]));
  const toggleAllVisible = () => {
    const keys = visible.map(rowKey);
    setSelected((list) => (allVisibleSelected ? list.filter((key) => !keys.includes(key)) : [...new Set([...list, ...keys])]));
  };

  const applyBulk = async () => {
    const groups = groupSelection();
    if (!groups.size) { notify("Select at least one offer first.", "error"); return; }
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
    const adjust = adjustBps.trim() ? Math.round(Number(adjustBps)) : undefined;
    if (adjust !== undefined && (!Number.isFinite(adjust) || adjust < -2000 || adjust > 2000)) {
      notify("Interest nudge must be between -2,000 and +2,000 bps.", "error");
      return;
    }
    const variance = scatterPct.trim() ? Number(scatterPct) : undefined;
    if (variance !== undefined && (!Number.isFinite(variance) || variance < 0 || variance > 50)) {
      notify("Scatter must be between 0% and 50%.", "error");
      return;
    }
    const extendClose = closeMonths.trim() ? Number(closeMonths) : undefined;
    const extendPayout = payoutMonths.trim() ? Number(payoutMonths) : undefined;
    if (profit === undefined && amountMinor === undefined && !extendClose && !extendPayout && !adjust && !variance) {
      notify("Enter at least one value (amount, interest, nudge, scatter or a month extension) to apply.", "error");
      return;
    }
    try {
      const total = await runBulk([...groups].map(([desk, instrumentIds]) => ({
        desk,
        instrumentIds,
        ...(profit !== undefined ? { profitBps: profit } : {}),
        amountUsdMinor: amountMinor,
        extendCloseMonths: extendClose,
        extendMaturityMonths: extendPayout,
        adjustProfitBps: adjust,
        variancePct: variance,
      })));
      notify(`Updated ${total} ${total === 1 ? "offer" : "offers"}${variance ? ` with ±${variance}% scatter` : ""}.`);
    } catch (error) {
      notify(`Bulk update failed: ${error instanceof Error ? error.message : "UnknownError"}`, "error");
    }
  };

  const applyReroll = async (includeAdmin: boolean) => {
    const groups = groupSelection();
    if (!groups.size) { notify("Select at least one offer first.", "error"); return; }
    try {
      const total = groups.size ? [...groups].reduce((count, [, ids]) => count + ids.length, 0) : 0;
      await Promise.all([...groups].map(([desk, instrumentIds]) => reroll.mutateAsync({ desk, instrumentIds, includeAdmin })));
      utils.adminOperations.deskEconomics.invalidate();
      setSelected([]);
      notify(includeAdmin
        ? `Re-rolled ${total} ${total === 1 ? "profile" : "profiles"}, including administrator-set values.`
        : `Re-rolled ${total} automatic ${total === 1 ? "profile" : "profiles"}; administrator-set values were kept.`);
    } catch (error) {
      notify(`Re-roll failed: ${error instanceof Error ? error.message : "UnknownError"}`, "error");
    }
  };

  const quickExtend = async (row: DeskEconomics) => {
    try {
      await runBulk([{ desk: row.desk, instrumentIds: [row.instrumentId], extendCloseMonths: 1, extendMaturityMonths: 1 }]);
      notify(`Extended ${row.instrumentId} by one month.`);
    } catch (error) {
      notify(`Could not extend: ${error instanceof Error ? error.message : "UnknownError"}`, "error");
    }
  };

  const loadFromSource = async () => {
    try {
      if (deskMode === ALL_DESKS) {
        const lists = await Promise.all(DESK_KEYS.map((desk) => sync.mutateAsync({ desk })));
        const total = lists.reduce((count, list) => count + list.length, 0);
        utils.adminOperations.deskEconomics.invalidate();
        notify(`Loaded ${total} stored ${total === 1 ? "offer" : "offers"} across every desk from source.`);
      } else {
        const list = await sync.mutateAsync({ desk: deskMode });
        utils.adminOperations.deskEconomics.invalidate();
        notify(`Loaded ${list.length} ${list.length === 1 ? "offer" : "offers"} from ${deskLabel(deskMode)}'s live source.`);
      }
    } catch (error) {
      notify(`Could not load from source: ${error instanceof Error ? error.message : "UnknownError"}`, "error");
    }
  };

  const allDesks = deskMode === ALL_DESKS;

  return <div className="arb-page portal-page">
    <div className="portal-page-top">
      <div>
        <div className="eyebrow">Cross-desk economic profiles</div>
        <h1>Desk economics</h1>
        <p>Load a desk — or every menu at once — then edit one or many offers in a single action. Set amounts and interest, nudge or scatter values so they stay varied, re-roll the automatic profiles, or shift the close and payout dates. Everything is administrator-controlled and audited.</p>
      </div>
    </div>

    <div className="settings-card de-bulk-card">
      <div className="de-bulk-row">
        <label>Desk
          <select value={deskMode} onChange={(event) => { setDeskMode(event.target.value as DeskMode); setSelected([]); setMessage(""); }}>
            {DESK_KEYS.map((key) => <option key={key} value={key}>{deskLabel(key)}</option>)}
            <option value={ALL_DESKS}>All desks</option>
          </select>
        </label>
        <label>Search offers
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by offer id or desk"/>
        </label>
        <div className="de-load-source">
          <span>Live source</span>
          <button className="secondary-button" type="button" disabled={sync.isPending} onClick={loadFromSource}>
            {sync.isPending ? "Loading…" : allDesks ? "Load every desk" : "Load live from source"} <RefreshCw size={14}/>
          </button>
        </div>
      </div>

      <div className="de-bulk-heading">
        <span><SlidersHorizontal size={15}/> Bulk edit</span>
        <small>{selected.length} selected{missingFromSelection ? ` (${missingFromSelection} hidden by the current filter)` : ""} · {rows.length} stored {rows.length === 1 ? "offer" : "offers"}{allDesks ? " across all desks" : ` on ${deskLabel(deskMode)}`}</small>
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
        <label>Nudge interest (± bps)
          <input type="number" min="-2000" max="2000" step="25" value={adjustBps} onChange={(event) => setAdjustBps(event.target.value)} placeholder="e.g. 200 = +2%"/>
        </label>
        <label>Scatter ± (%)
          <input type="number" min="0" max="50" step="1" value={scatterPct} onChange={(event) => setScatterPct(event.target.value)} placeholder="e.g. 10 keeps them varied"/>
        </label>
      </div>

      <div className="de-bulk-actions">
        <button className="primary-button" disabled={busy || !selected.length} onClick={applyBulk}>
          {bulk.isPending ? "Applying…" : `Apply to ${selected.length} selected`} <Check size={14}/>
        </button>
        <button className="secondary-button" type="button" disabled={busy || !selected.length} onClick={() => applyReroll(false)} title="Give the selected offers fresh automatic numbers">
          {reroll.isPending ? "Re-rolling…" : "Re-roll profiles"} <Shuffle size={14}/>
        </button>
        <button className="secondary-button" type="button" disabled={busy || !selected.length} onClick={() => setSelected(filtered.map(rowKey))}>
          Select all matching ({filtered.length})
        </button>
        <button className="secondary-button" type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button>
      </div>

      <p className="de-bulk-hint">Tick one offer for a single edit, or tick many to apply the same change in one action. Use <strong>Nudge</strong> to move every rate by the same amount, and <strong>Scatter</strong> to keep the results varied instead of identical.</p>

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
          const key = rowKey(row);
          const isSelected = selectedSet.has(key);
          return <div className={"de-table-row" + (isSelected ? " is-selected" : "")} key={key} role="button" tabIndex={0} aria-pressed={isSelected}
            onClick={() => toggle(key)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(key); } }}>
            <label className="de-check" onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(key)} aria-label={`Select ${row.instrumentId}`}/>
            </label>
            <span className="de-offer-cell">
              <span className="de-id" title={row.instrumentId}>{row.instrumentId}</span>
              {allDesks && <small>{deskLabel(row.desk)}</small>}
            </span>
            <span>{row.currency}</span>
            <span><strong>{fmtLocal(row)}</strong><small>{fmtUsd(usdMinorOf(row))}</small></span>
            <span>{row.profitBps > 0 ? fmtPct(row.profitBps) : "—"}</span>
            <span>{row.termDays}d</span>
            <span>{fmtPct(row.platformFeeBps)}</span>
            <span>{row.closeDate}</span>
            <span>{row.maturityDate}{row.settlementDelayDays ? <small>+{row.settlementDelayDays}d delay</small> : null}</span>
            <span><b className={"de-badge " + (row.source === "ADMIN" ? "is-admin" : "is-auto")}>{row.source === "ADMIN" ? "Admin" : "Auto"}</b></span>
            <span className="de-row-actions">
              <button type="button" className="de-quick" disabled={busy} title="Extend the close and payout dates by one month"
                onClick={(event) => { event.stopPropagation(); quickExtend(row); }}>
                Extend 1 mo
              </button>
            </span>
          </div>;
        })}
        {!visible.length && <div className="empty-state">
          <CalendarPlus size={22}/>
          <strong>No stored offers {allDesks ? "yet" : "for this desk yet"}.</strong>
          <span>Use {allDesks ? "Load every desk" : "Load live from source"} to pull the current offers, or wait until a customer loads the desk.</span>
        </div>}
      </div>
      {filtered.length > visible.length && <p className="de-note">Showing {visible.length} of {filtered.length} matching offers. Narrow the search to reach the rest — Select all matching still covers every match.</p>}
      <p className="de-note"><ShieldCheck size={13}/> Every change is written as an administrator profile and is never overwritten by the automatic assignment. Re-roll leaves administrator profiles untouched.</p>
    </>}
  </div>;
}
