import { useMemo, useState } from "react";
import { Activity, Globe2, LogIn, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Customer Sign-in Activity panel.
 *
 * Shows the current customer's own sign-in events (logins and sign-ups) for the
 * trailing seven-day window, newest first. The server keeps only the last seven
 * days: older records are cleared automatically so no stale sign-in log or
 * residue is left behind.
 */

type SignInEntry = {
  id: number;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  eventType: string;
  source: string | null;
  deviceName: string | null;
  countryCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type SignInReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  retentionDays: number;
  windowStart: string;
  summary: {
    total: number;
    logins: number;
    signups: number;
    distinctCustomers: number;
    today: number;
    last24h: number;
  };
  entries: SignInEntry[];
};

export function CustomerSignInActivity({ push }: { push?: (message: string) => void }) {
  const query = trpc.customer.signInActivity.useQuery({ limit: 100 }, { refetchOnWindowFocus: true });
  const [search, setSearch] = useState("");

  const report = query.data as SignInReport | undefined;
  const entries = useMemo(() => report?.entries ?? [], [report]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((row) =>
      (row.deviceName ?? "").toLowerCase().includes(term) ||
      (row.ipAddress ?? "").toLowerCase().includes(term) ||
      (row.countryCode ?? "").toLowerCase().includes(term) ||
      (row.source ?? "").toLowerCase().includes(term),
    );
  }, [entries, search]);

  return (
    <div className="customer-sign-in-activity">
      <div className="customer-sign-in-head">
        <div className="customer-sign-in-metric">
          <span className="customer-sign-in-metric-icon"><LogIn size={15} /></span>
          <div>
            <small>Sign-ins (7 days)</small>
            <strong>{report?.summary.total ?? 0}</strong>
            <span>{report?.summary.signups ? `${report.summary.signups} new sign-up${report.summary.signups === 1 ? "" : "s"}` : "Logins and sign-ups"}</span>
          </div>
        </div>
        <div className="customer-sign-in-metric">
          <span className="customer-sign-in-metric-icon"><Activity size={15} /></span>
          <div>
            <small>Last 24 hours</small>
            <strong>{report?.summary.last24h ?? 0}</strong>
            <span>Today: {report?.summary.today ?? 0}</span>
          </div>
        </div>
        <button className="secondary-button customer-sign-in-refresh" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <section className="settings-card customer-sign-in-log" aria-label="Your sign-in activity log">
        <div className="customer-sign-in-log-head">
          <h2>Recent sign-ins</h2>
          <div className="customer-sign-in-search">
            <Search size={13} />
            <input type="search" value={search} placeholder="Search by device, IP or country" onChange={(event) => setSearch(event.target.value)} />
            <span className="admin-live-chip">{filtered.length} {filtered.length === 1 ? "record" : "records"}</span>
          </div>
        </div>

        {query.isLoading && <div role="status">Loading your sign-in activity…</div>}
        {query.isError && <div className="test-notice" role="alert">Sign-in activity could not be read. {query.error.message}</div>}
        {report && !report.sourceAvailable && <div className="test-notice" role="alert">Sign-in activity storage is not available on this host yet. Records will appear once the activity log is created.</div>}
        {report?.sourceAvailable && entries.length === 0 && <div className="test-notice">No sign-in activity recorded for your account in the last {report.retentionDays} days.</div>}
        {report?.sourceAvailable && entries.length > 0 && filtered.length === 0 && <div className="test-notice">No sign-in record matches this search.</div>}

        {filtered.length > 0 && (
          <ul className="customer-sign-in-list">
            {filtered.map((row) => (
              <li key={row.id} className="customer-sign-in-item">
                <span className={row.eventType === "signup" ? "customer-sign-in-badge is-signup" : "customer-sign-in-badge"}>
                  {row.eventType === "signup" ? <><UserPlus size={12} /> Sign-up</> : <><LogIn size={12} /> Login</>}
                </span>
                <div className="customer-sign-in-main">
                  <strong>{row.deviceName || "Unknown device"}</strong>
                  <small>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}{row.source ? ` · ${row.source}` : ""}</small>
                </div>
                <div className="customer-sign-in-meta">
                  {row.countryCode ? <span><Globe2 size={12} /> {row.countryCode}</span> : <span aria-hidden="true">—</span>}
                  {row.ipAddress ? <code>{row.ipAddress}</code> : <span aria-hidden="true">—</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="test-notice"><ShieldCheck size={14} /><span>Every sign-in to your account records the device, location and network address. Records older than {report?.retentionDays ?? 7} days are cleared automatically.</span></p>
      </section>

      <p className="admin-policy-note customer-sign-in-note" role="note"><Trash2 size={14} /> This log keeps a rolling {report?.retentionDays ?? 7}-day window only. The server clears your expired sign-in records automatically, including any residue, so the system stays free of stale data.</p>
    </div>
  );
}

export default CustomerSignInActivity;
