import { useMemo, useState } from "react";
import { CalendarClock, Globe2, LogIn, RefreshCw, Search, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Administrator console for sign-in activity.
 *
 * Shows every recorded customer and administrator sign-in (and every customer
 * registration) for the trailing seven-day window, newest first. The server
 * keeps only the last seven days: older records are cleared automatically, so
 * there is no stale sign-in log or residue left in the system.
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

type SignInMetric = { key: string; label: string; value: number; hint: string; icon: typeof LogIn };

export function AdminSignInActivity() {
  const query = trpc.adminOperations.signInActivity.useQuery({ limit: 200 }, { refetchOnWindowFocus: true });
  const [search, setSearch] = useState("");

  const report = query.data as SignInReport | undefined;
  const entries = useMemo(() => report?.entries ?? [], [report]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((row) =>
      String(row.userId ?? "").includes(term) ||
      (row.userName ?? "").toLowerCase().includes(term) ||
      (row.userEmail ?? "").toLowerCase().includes(term) ||
      (row.ipAddress ?? "").toLowerCase().includes(term) ||
      (row.deviceName ?? "").toLowerCase().includes(term) ||
      (row.countryCode ?? "").toLowerCase().includes(term),
    );
  }, [entries, search]);

  const metrics = useMemo<SignInMetric[]>(() => {
    const summary = report?.summary;
    return [
      { key: "total", label: "Sign-ins (7 days)", value: summary?.total ?? 0, hint: "Login and sign-up events", icon: LogIn },
      { key: "customers", label: "Distinct customers", value: summary?.distinctCustomers ?? 0, hint: "Customers who signed in", icon: Users },
      { key: "last24h", label: "Last 24 hours", value: summary?.last24h ?? 0, hint: `Today: ${summary?.today ?? 0}`, icon: CalendarClock },
      { key: "signups", label: "New sign-ups", value: summary?.signups ?? 0, hint: "Registrations in the window", icon: UserPlus },
    ];
  }, [report]);

  return (
    <div className="arb-page portal-page admin-sign-in-activity">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Verification &amp; Risk · Sign-in oversight</div>
          <h1>Sign in Activity</h1>
          <p>Every customer and administrator sign-in for all customers over the last {report?.retentionDays ?? 7} days, newest first. Records are kept for a rolling seven-day window and cleared automatically as they age out, so no stale sign-in log or residue is left behind.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {report && (
        <div className="admin-sign-in-metrics" role="list">
          {metrics.map((metric) => (
            <div className="admin-sign-in-metric" role="listitem" key={metric.key}>
              <span className="admin-sign-in-metric-icon"><metric.icon size={15} /></span>
              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="settings-card" aria-label="Sign-in activity log">
        <div className="api-access-section-heading">
          <h2>Recent Sign-ins</h2>
          <div className="form-two">
            <label>
              <span className="sr-only">Search sign-in activity</span>
              <input type="search" value={search} placeholder="Search by name, email, ID, IP or device" onChange={(event) => setSearch(event.target.value)} />
            </label>
            <span className="admin-live-chip"><Search size={13} /> {filtered.length} {filtered.length === 1 ? "record" : "records"}</span>
          </div>
        </div>

        {query.isLoading && <div role="status">Loading sign-in activity…</div>}
        {query.isError && <div className="admin-ops-empty error" role="alert">Sign-in activity could not be read. {query.error.message}</div>}
        {report && !report.sourceAvailable && <div className="admin-ops-empty error" role="alert">Sign-in activity storage is not available on this host yet. Records will appear once the add-in table is created.</div>}
        {report?.sourceAvailable && entries.length === 0 && <div className="empty-records">No sign-in activity recorded in the last {report.retentionDays} days.</div>}
        {report?.sourceAvailable && entries.length > 0 && filtered.length === 0 && <div className="empty-records">No sign-in record matches this search.</div>}

        {filtered.length > 0 && (
          <div className="admin-ops-table-wrap">
            <table className="admin-ops-table">
              <thead>
                <tr><th>When</th><th>Customer</th><th>Event</th><th>Source</th><th>Device</th><th>Location</th><th>IP</th></tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const label = row.userName || row.userEmail || (row.userId ? `User ${row.userId}` : "Unknown");
                  return (
                    <tr key={row.id}>
                      <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td>
                      <td>
                        <strong>{label}</strong>
                        {row.userEmail && row.userEmail !== label && <small>{row.userEmail}</small>}
                        {row.userId != null && <small>ID {row.userId}{row.userRole ? ` · ${row.userRole}` : ""}</small>}
                      </td>
                      <td>
                        <span className={row.eventType === "signup" ? "admin-sign-in-badge is-signup" : "admin-sign-in-badge"}>
                          {row.eventType === "signup" ? <><UserPlus size={12} /> Sign-up</> : <><LogIn size={12} /> Login</>}
                        </span>
                      </td>
                      <td>{row.source === "admin" ? "Admin" : "Customer"}</td>
                      <td>{row.deviceName || "—"}</td>
                      <td>{row.countryCode ? <><Globe2 size={12} /> {row.countryCode}</> : "—"}</td>
                      <td><code>{row.ipAddress || "—"}</code></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="admin-ops-note" role="note"><ShieldCheck size={14} /> Every sign-in records the account, device, location and network address. Records older than {report?.retentionDays ?? 7} days are cleared automatically.</p>
      </section>

      <p className="admin-policy-note" role="note"><Trash2 size={14} /> This log keeps a rolling {report?.retentionDays ?? 7}-day window only. The server clears expired sign-in records automatically, including any residue, so the system stays free of stale sign-in data.</p>
    </div>
  );
}

export default AdminSignInActivity;
