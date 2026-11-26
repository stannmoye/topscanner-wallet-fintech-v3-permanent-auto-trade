import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Check, Gavel, Globe2, History, RefreshCw, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./admin-tender.css";

/**
 * Tender Bid — administrator console (Stage 5).
 *
 * Three surfaces over the same real, ingested tenders:
 *
 * - **Tender Bids** — the review queue. Apply the classified charge, decline a
 *   bid, or record an outcome; every action is audited server-side.
 * - **Tender corrections** — edit any tender field. Each change writes an
 *   append-only audit row, takes effect on the customer side immediately, and
 *   survives re-ingestion; a source-derived field can be reverted to the value
 *   the source last provided.
 * - **Sources health** — enable/disable each source and read its sync health and
 *   per-source tender count.
 *
 * No figure is computed here: the pages render only what the server returns.
 */

function newIdempotencyKey(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : "";
  return uuid || `tender-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function usd(minor: number | null | undefined): string {
  if (minor == null) return "Not valued";
  return `$${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateText(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** ISO instant → the value a `datetime-local` input expects (local wall clock). */
function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** A `datetime-local` value → an ISO instant, or "" when blank. */
function fromLocalDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

type TenderBidRow = {
  id: number;
  tenderId: number;
  status: string;
  qualificationAmountUsdMinor: number;
  chargeAmountUsdMinor: number | null;
  chargeLedgerId: number | null;
  createdAt: string;
  tenderTitle: string;
  tenderCountry: string;
  tenderSourceUrl: string;
  customerName: string | null;
  customerEmail: string | null;
  balanceAtBidUsdMinor: number | null;
};

const BID_STATUS_LABELS: Record<string, string> = {
  placed: "Placed",
  charge_pending: "Charge pending",
  charged: "Charged",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
};

function BidStatusChip({ status }: { status: string }) {
  return <span className={`tb-admin-chip tb-admin-chip-${status}`}>{BID_STATUS_LABELS[status] ?? status}</span>;
}

/** The administrator Tender Bids review queue. */
export function AdminTenderBids() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.tenderBids.list.useQuery(undefined, { refetchOnWindowFocus: true });
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const announce = (kind: "success" | "error", text: string) => {
    setMessageKind(kind);
    setMessage(text);
  };

  const refresh = () => void utils.adminOperations.tenderBids.list.invalidate();
  const onDone = (text: string) => () => {
    announce("success", text);
    refresh();
  };
  const onFail = (error: { message: string }) => announce("error", error.message);

  const charge = trpc.adminOperations.tenderBids.applyCharge.useMutation({
    onSuccess: onDone("Charge applied through the classified manual-adjustment ledger."),
    onError: onFail,
  });
  const decline = trpc.adminOperations.tenderBids.decline.useMutation({
    onSuccess: onDone("Bid declined. No funds moved."),
    onError: onFail,
  });
  const outcome = trpc.adminOperations.tenderBids.recordOutcome.useMutation({
    onSuccess: onDone("Outcome recorded."),
    onError: onFail,
  });

  const rows = useMemo(() => (query.data?.bids ?? []) as TenderBidRow[], [query.data]);
  const busy = charge.isPending || decline.isPending || outcome.isPending;

  const reasonFor = (bid: TenderBidRow) => reasons[bid.id] ?? "";
  const requireReason = (bid: TenderBidRow): string | null => {
    const reason = reasonFor(bid).trim();
    if (reason.length < 3) {
      announce("error", `Enter an administrator reason of at least 3 characters for bid #${bid.id}.`);
      return null;
    }
    return reason;
  };

  const applyCharge = (bid: TenderBidRow) => {
    const reason = requireReason(bid);
    if (!reason) return;
    if (!window.confirm(`Apply the ${usd(bid.qualificationAmountUsdMinor)} charge to ${bid.customerName || bid.customerEmail || `customer ${bid.id}`}? This posts a classified ledger debit.`)) return;
    charge.mutate({ bidId: bid.id, idempotencyKey: newIdempotencyKey(), reason });
  };
  const declineBid = (bid: TenderBidRow) => {
    const reason = requireReason(bid);
    if (!reason) return;
    if (!window.confirm(`Decline bid #${bid.id}? No funds will move.`)) return;
    decline.mutate({ bidId: bid.id, reason });
  };
  const recordOutcome = (bid: TenderBidRow, result: "won" | "lost") => {
    const reason = requireReason(bid);
    if (!reason) return;
    outcome.mutate({ bidId: bid.id, outcome: result, reason });
  };

  return (
    <div className="arb-page portal-page admin-tender-page">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Tender Bid · Administrator review</div>
          <h1>Tender Bids</h1>
          <p>Every customer bid on a real, ingested tender with the balance they held at bid time. Apply the configured qualification charge through the classified manual-adjustment ledger, decline the bid (no funds move), or record the administration outcome. Every action is audited.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {message && <div className={messageKind === "error" ? "test-notice error" : "test-notice"} role={messageKind === "error" ? "alert" : "status"}>{messageKind === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}<span>{message}</span></div>}

      <section className="settings-card" aria-label="Tender bids queue">
        <div className="api-access-section-heading"><h2>Bid queue</h2><span className="admin-live-chip"><Gavel size={13} /> {rows.length} {rows.length === 1 ? "bid" : "bids"}</span></div>
        {query.isLoading && <div role="status">Loading tender bids…</div>}
        {query.isError && <div className="admin-ops-empty error" role="alert">Tender bids could not be read. {query.error.message}</div>}
        {query.data && rows.length === 0 && <div className="empty-records">No tender bids have been placed yet.</div>}
        {rows.length > 0 && (
          <div className="admin-ops-table-wrap" role="region" tabIndex={0} aria-label="Tender bids">
            <table className="admin-ops-table">
              <thead>
                <tr><th>Customer</th><th>Tender</th><th>Qualification</th><th>Balance at bid</th><th>Status</th><th>Placed</th><th>Administrator action</th></tr>
              </thead>
              <tbody>
                {rows.map((bid) => {
                  const canChargeOrDecline = bid.status === "placed" || bid.status === "charge_pending";
                  const canOutcome = bid.status === "charged";
                  return (
                    <tr key={bid.id}>
                      <td>
                        <strong>{bid.customerName || bid.customerEmail || `Customer ${bid.id}`}</strong>
                        <small>{bid.customerEmail || "no email on file"}</small>
                      </td>
                      <td>
                        <strong>{bid.tenderTitle}</strong>
                        <small>{bid.tenderCountry || "—"} · <a href={bid.tenderSourceUrl} target="_blank" rel="noreferrer">source</a></small>
                      </td>
                      <td>{usd(bid.qualificationAmountUsdMinor)}{bid.chargeLedgerId ? <small>ledger #{bid.chargeLedgerId}</small> : null}</td>
                      <td>{usd(bid.balanceAtBidUsdMinor)}</td>
                      <td><BidStatusChip status={bid.status} /></td>
                      <td>{dateText(bid.createdAt)}</td>
                      <td>
                        <div className="tb-admin-actions">
                          <label>
                            <span className="sr-only">Administrator reason for bid {bid.id}</span>
                            <input
                              type="text"
                              value={reasonFor(bid)}
                              maxLength={500}
                              placeholder="Administrator reason (audited)"
                              onChange={(event) => setReasons((current) => ({ ...current, [bid.id]: event.target.value }))}
                            />
                          </label>
                          <div className="tb-admin-action-buttons">
                            <button className="primary-button" type="button" disabled={busy || !canChargeOrDecline} onClick={() => applyCharge(bid)}>Apply charge</button>
                            <button className="secondary-button" type="button" disabled={busy || !canChargeOrDecline} onClick={() => declineBid(bid)}>Decline</button>
                            <button className="secondary-button" type="button" disabled={busy || !canOutcome} onClick={() => recordOutcome(bid, "won")}>Record won</button>
                            <button className="secondary-button" type="button" disabled={busy || !canOutcome} onClick={() => recordOutcome(bid, "lost")}>Record lost</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-ops-note" role="note"><ShieldCheck size={14} /> The charge equals the configured qualification amount and posts a classified, reversible internal-ledger debit. Reversals are compensating entries; historical entries are never edited.</p>
      </section>
    </div>
  );
}

type CorrectionField = {
  field: string;
  label: string;
  kind: string;
  required: boolean;
  sourceDerived: boolean;
  maxLength?: number;
  options?: readonly string[];
  hint: string;
};

type CorrectionSummary = {
  id: number;
  title: string;
  countryCode: string;
  sourceLabel: string | null;
  sourceKind: string | null;
  status: string;
  storedStatus: string;
  contractAmountUsdMinor: number | null;
  qualificationAmountUsdMinor: number | null;
  bidCloseAt: string | null;
  lastSyncedAt: string | null;
  overrideCount: number;
};

type CorrectionDetail = CorrectionSummary & {
  buyer: string | null;
  buyerType: string | null;
  industry: string | null;
  tenderType: string | null;
  procedure: string | null;
  contractAmountMinor: number | null;
  contractCurrency: string | null;
  qualificationPctBps: number | null;
  qualificationOverridden: boolean;
  bidOpenAt: string | null;
  payoutAt: string | null;
  publishedAt: string | null;
  summary: string | null;
  descriptionText: string | null;
  sourceUrl: string;
  externalId: string;
  overrides: Record<string, unknown>;
  history: Array<{ id: number; field: string; oldValue: string | null; newValue: string | null; note: string | null; adminUserId: number; createdAt: string }>;
};

/** Build the editable string drafts for each field from a loaded detail record. */
function buildDrafts(detail: CorrectionDetail, fields: readonly CorrectionField[]): Record<string, string> {
  const source = detail as unknown as Record<string, unknown>;
  const drafts: Record<string, string> = {};
  for (const field of fields) {
    const value = source[field.field];
    if (field.kind === "datetime") drafts[field.field] = toLocalDateTime(value as string | null);
    else drafts[field.field] = value === null || value === undefined ? "" : String(value);
  }
  return drafts;
}

/** The administrator Tender corrections menu: edit any field, with history and revert. */
export function AdminTenderCorrections() {
  const utils = trpc.useUtils();
  const fieldsQuery = trpc.adminOperations.tenderCorrections.fields.useQuery();
  const sourcesQuery = trpc.adminOperations.tenderSources.list.useQuery();
  const [term, setTerm] = useState("");
  const [sourceId, setSourceId] = useState(0);
  const [countryCode, setCountryCode] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const listQuery = trpc.adminOperations.tenderCorrections.list.useQuery({
    query: term.trim() || undefined,
    sourceId: sourceId > 0 ? sourceId : undefined,
    countryCode: countryCode.trim() || undefined,
  });
  const detailQuery = trpc.adminOperations.tenderCorrections.detail.useQuery(
    { tenderId: selectedId ?? 0 },
    { enabled: Boolean(selectedId) },
  );

  const fields = useMemo(() => (fieldsQuery.data ?? []) as CorrectionField[], [fieldsQuery.data]);
  const rows = useMemo(() => (listQuery.data?.tenders ?? []) as CorrectionSummary[], [listQuery.data]);
  const detail = detailQuery.data as CorrectionDetail | null | undefined;

  useEffect(() => {
    if (!detail || !fields.length) return;
    setDrafts(buildDrafts(detail, fields));
  }, [detail, fields]);

  const announce = (kind: "success" | "error", text: string) => {
    setMessageKind(kind);
    setMessage(text);
  };
  const refreshAll = () => void utils.adminOperations.tenderCorrections.list.invalidate();
  const onSaved = () => {
    announce("success", "Correction saved and audited. It is live on the customer desk and will survive re-ingestion.");
    refreshAll();
    void detailQuery.refetch();
  };
  const onFail = (error: { message: string }) => announce("error", error.message);

  const correct = trpc.adminOperations.tenderCorrections.correct.useMutation({ onSuccess: onSaved, onError: onFail });
  const revert = trpc.adminOperations.tenderCorrections.revert.useMutation({
    onSuccess: () => {
      announce("success", "Field reverted to the source value.");
      refreshAll();
      void detailQuery.refetch();
    },
    onError: onFail,
  });
  const busy = correct.isPending || revert.isPending;

  const saveField = (field: CorrectionField) => {
    if (!detail) return;
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      announce("error", "Add a note of at least 3 characters describing the change (it is stored in the audit trail).");
      return;
    }
    const raw = drafts[field.field] ?? "";
    const value = field.kind === "datetime" ? fromLocalDateTime(raw) : raw;
    correct.mutate({ tenderId: detail.id, field: field.field, value, note: trimmed });
  };

  const revertField = (field: CorrectionField) => {
    if (!detail) return;
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      announce("error", "Add a note of at least 3 characters describing the revert.");
      return;
    }
    if (!window.confirm(`Revert “${field.label}” to the source value? The next ingestion cycle will resume writing this field.`)) return;
    revert.mutate({ tenderId: detail.id, field: field.field, note: trimmed });
  };

  const isOverridden = (field: string) => Boolean(detail && Object.prototype.hasOwnProperty.call(detail.overrides, field));

  const renderInput = (field: CorrectionField) => {
    const value = drafts[field.field] ?? "";
    const onChange = (next: string) => setDrafts((current) => ({ ...current, [field.field]: next }));
    if (field.kind === "enum") {
      return (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {!field.required && <option value="">— none —</option>}
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }
    if (field.kind === "textarea") {
      return <textarea value={value} maxLength={field.maxLength} onChange={(event) => onChange(event.target.value)} rows={4} />;
    }
    if (field.kind === "datetime") {
      return <input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} />;
    }
    if (field.kind === "integer") {
      return <input type="number" step="1" value={value} onChange={(event) => onChange(event.target.value)} />;
    }
    return <input type="text" value={value} maxLength={field.maxLength} onChange={(event) => onChange(event.target.value)} />;
  };

  return (
    <div className="arb-page portal-page admin-tender-page">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Tender Bid · Corrections</div>
          <h1>Tender Corrections</h1>
          <p>Edit any field on a real ingested tender. Each change writes an audit row (old → new, administrator, note) and is live on the customer desk immediately. An administrator override survives re-ingestion; a source-derived field can be reverted to the value the source last provided.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {message && <div className={messageKind === "error" ? "test-notice error" : "test-notice"} role={messageKind === "error" ? "alert" : "status"}>{messageKind === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}<span>{message}</span></div>}

      <section className="settings-card" aria-label="Find a tender">
        <div className="api-access-section-heading">
          <h2>Find a tender</h2>
          <span className="admin-live-chip"><Search size={13} /> {rows.length} {rows.length === 1 ? "tender" : "tenders"}</span>
        </div>
        <div className="form-two">
          <label><span>Search title, buyer or external id</span><input type="search" value={term} maxLength={160} placeholder="e.g. hospital, Ministry, 2024-…" onChange={(event) => setTerm(event.target.value)} /></label>
          <label><span>Source</span>
            <select value={sourceId} onChange={(event) => setSourceId(Number(event.target.value))}>
              <option value={0}>All sources</option>
              {((sourcesQuery.data?.sources ?? []) as Array<{ id: number; label: string }>).map((source) => (
                <option key={source.id} value={source.id}>{source.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label><span>Country code</span><input type="text" value={countryCode} maxLength={8} placeholder="e.g. GB" onChange={(event) => setCountryCode(event.target.value)} /></label>

        {listQuery.isLoading && <div role="status">Loading tenders…</div>}
        {listQuery.isError && <div className="admin-ops-empty error" role="alert">Tenders could not be read. {listQuery.error.message}</div>}
        {listQuery.data && rows.length === 0 && <div className="empty-records">No ingested tender matches these filters.</div>}
        {rows.length > 0 && (
          <div className="admin-ops-table-wrap" role="region" tabIndex={0} aria-label="Tenders">
            <table className="admin-ops-table">
              <thead><tr><th>Title</th><th>Country</th><th>Source</th><th>Status</th><th>USD value</th><th>Qualification</th><th>Overrides</th><th>Last synced</th><th aria-label="Select" /></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.id === selectedId ? "is-selected" : undefined}>
                    <td><strong>{row.title}</strong></td>
                    <td>{row.countryCode || "—"}</td>
                    <td>{row.sourceLabel ?? "—"}<small>{row.sourceKind ?? ""}</small></td>
                    <td>{row.status}</td>
                    <td>{usd(row.contractAmountUsdMinor)}</td>
                    <td>{usd(row.qualificationAmountUsdMinor)}</td>
                    <td>{row.overrideCount > 0 ? <span className="tb-admin-override-badge">{row.overrideCount}</span> : "—"}</td>
                    <td>{dateText(row.lastSyncedAt)}</td>
                    <td><button className="secondary-button" type="button" onClick={() => setSelectedId(row.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId && (
        <section className="settings-card tb-admin-detail" aria-label="Tender detail">
          {detailQuery.isLoading && <div role="status">Loading tender…</div>}
          {detailQuery.isError && <div className="admin-ops-empty error" role="alert">The tender could not be read. {detailQuery.error.message}</div>}
          {detail && (
            <>
              <div className="api-access-section-heading">
                <h2>{detail.title}</h2>
                <button className="secondary-button" type="button" onClick={() => setSelectedId(null)}>Close</button>
              </div>
              <p><span className="tb-admin-meta">{detail.countryCode || "—"} · {detail.sourceLabel ?? "—"} · {detail.externalId}</span> {detail.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer">source</a>}</p>
              {detail.qualificationOverridden && <p className="tb-admin-note"><AlertTriangle size={14} /> The qualification amount is overridden, so it is not changed by ingestion.</p>}

              <label className="tb-admin-note-field"><span>Audit note (required for each change)</span><textarea value={note} maxLength={500} rows={2} placeholder="Why is this being changed?" onChange={(event) => setNote(event.target.value)} /></label>

              <div className="tb-admin-fields">
                {fields.map((field) => (
                  <div className="tb-admin-field" key={field.field}>
                    <div className="tb-admin-field-head">
                      <span>{field.label}</span>
                      {isOverridden(field.field) && <span className="tb-admin-override-badge" title="Overridden by an administrator">Overridden</span>}
                    </div>
                    <div className="tb-admin-field-row">
                      {renderInput(field)}
                      <button className="primary-button" type="button" disabled={busy} onClick={() => saveField(field)}>Save</button>
                      {field.sourceDerived && isOverridden(field.field) && (
                        <button className="secondary-button" type="button" disabled={busy} onClick={() => revertField(field)}><RotateCcw size={14} /> Revert</button>
                      )}
                    </div>
                    <small>{field.hint}</small>
                  </div>
                ))}
              </div>

              <div className="tb-admin-history">
                <div className="api-access-section-heading"><h3><History size={15} /> Correction history</h3></div>
                {detail.history.length === 0 && <div className="empty-records">No corrections recorded for this tender.</div>}
                {detail.history.length > 0 && (
                  <div className="admin-ops-table-wrap" role="region" tabIndex={0} aria-label="Correction history">
                    <table className="admin-ops-table">
                      <thead><tr><th>When</th><th>Field</th><th>Old</th><th>New</th><th>Note</th><th>Administrator</th></tr></thead>
                      <tbody>
                        {detail.history.map((entry) => (
                          <tr key={entry.id}>
                            <td>{dateText(entry.createdAt)}</td>
                            <td>{entry.field}</td>
                            <td><code>{entry.oldValue ?? "—"}</code></td>
                            <td><code>{entry.newValue ?? "—"}</code></td>
                            <td>{entry.note ?? "—"}</td>
                            <td>{entry.adminUserId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

type SourceRow = {
  id: number;
  key: string;
  label: string;
  countryCode: string;
  kind: string;
  adapter: string;
  enabled: boolean;
  expectedIntervalMs: number;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  tenderCount: number;
};

/** The administrator Sources health console. */
export function AdminTenderSources() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.tenderSources.list.useQuery(undefined, { refetchOnWindowFocus: true });
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const toggle = trpc.adminOperations.tenderSources.setEnabled.useMutation({
    onSuccess: () => {
      setMessageKind("success");
      setMessage("Source updated and audited.");
      void utils.adminOperations.tenderSources.list.invalidate();
    },
    onError: (error) => {
      setMessageKind("error");
      setMessage(error.message);
    },
  });

  const rows = useMemo(() => (query.data?.sources ?? []) as SourceRow[], [query.data]);
  const enabledCount = rows.filter((row) => row.enabled).length;

  const setEnabled = (row: SourceRow, enabled: boolean) => {
    const verb = enabled ? "Enable" : "Disable";
    const reason = window.prompt(`${verb} “${row.label}”? Enter the administrator reason (3–500 characters).`, "");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setMessageKind("error");
      setMessage("Enter an administrator reason of at least 3 characters.");
      return;
    }
    toggle.mutate({ sourceId: row.id, enabled, reason: reason.trim() });
  };

  return (
    <div className="arb-page portal-page admin-tender-page">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Tender Bid · Ingestion health</div>
          <h1>Tender Sources</h1>
          <p>Each configured country and supranational source with its sync health and per-source tender count. A source is only polled while it is enabled; disabling stops future polling and leaves stored tenders in place. Enable and disable actions are audited.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {message && <div className={messageKind === "error" ? "test-notice error" : "test-notice"} role={messageKind === "error" ? "alert" : "status"}>{messageKind === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}<span>{message}</span></div>}

      <section className="settings-card" aria-label="Tender sources">
        <div className="api-access-section-heading"><h2>Sources</h2><span className="admin-live-chip"><Globe2 size={13} /> {enabledCount}/{rows.length} enabled</span></div>
        {query.isLoading && <div role="status">Loading sources…</div>}
        {query.isError && <div className="admin-ops-empty error" role="alert">Sources could not be read. {query.error.message}</div>}
        {query.data && rows.length === 0 && <div className="empty-records">No tender sources are configured.</div>}
        {rows.length > 0 && (
          <div className="admin-ops-table-wrap" role="region" tabIndex={0} aria-label="Tender sources">
            <table className="admin-ops-table">
              <thead><tr><th>Source</th><th>Country</th><th>Kind</th><th>Adapter</th><th>Tenders</th><th>Last sync</th><th>Status</th><th>Last error</th><th aria-label="Enabled" /></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.label}</strong><small>{row.key}</small></td>
                    <td>{row.countryCode || "—"}</td>
                    <td>{row.kind}</td>
                    <td>{row.adapter}</td>
                    <td>{row.tenderCount.toLocaleString()}</td>
                    <td>{dateText(row.lastSyncAt)}</td>
                    <td><span className={`tb-admin-chip tb-admin-sync-${row.lastStatus ?? "never"}`}>{row.lastStatus ?? "never run"}</span></td>
                    <td>{row.lastError ? <span className="tb-admin-error" title={row.lastError}>{row.lastError}</span> : "—"}</td>
                    <td>
                      <button className={row.enabled ? "primary-button" : "secondary-button"} type="button" disabled={toggle.isPending} onClick={() => setEnabled(row, !row.enabled)}>
                        {row.enabled ? "Enabled · disable" : "Disabled · enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-ops-note" role="note"><Activity size={14} /> The interval column is the polling cadence the worker respects; a source that has never run shows “never run”. Health is written by the ingestion worker after each cycle.</p>
      </section>
    </div>
  );
}

export default AdminTenderBids;
