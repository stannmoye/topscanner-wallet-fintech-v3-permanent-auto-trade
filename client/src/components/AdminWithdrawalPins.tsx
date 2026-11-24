import { useMemo, useState } from "react";
import { CalendarDays, Clock, Eye, EyeOff, KeyRound, RefreshCw, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Administrator console for customer withdrawal PINs.
 *
 * Lists every customer who has set a 6-digit withdrawal PIN. Each PIN is
 * masked (`******`) by default and only shown when the administrator clicks
 * “Reveal PIN” for that row. An administrator can also reset a compromised PIN,
 * which clears it so the customer must create a new one before withdrawing.
 * Customers set and reset their own PIN from the portal, and the PIN is
 * required for every withdrawal.
 */

const MASKED_PIN = "******";

/** One metric tile in the overview strip. */
type PinMetric = { key: string; label: string; value: number; hint: string; icon: typeof KeyRound };

type WithdrawalPinRow = {
  userId: number;
  name: string | null;
  email: string | null;
  pin: string;
  updatedAt: string | null;
};

export function AdminWithdrawalPins() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.withdrawalPins.useQuery(undefined, { refetchOnWindowFocus: true });
  const [search, setSearch] = useState("");
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const rows = useMemo(() => (query.data ?? []) as WithdrawalPinRow[], [query.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      String(row.userId).includes(term) ||
      (row.name ?? "").toLowerCase().includes(term) ||
      (row.email ?? "").toLowerCase().includes(term),
    );
  }, [rows, search]);

  // Overview metrics, derived from the rows already loaded (no extra request):
  // how many customers have a PIN and how recently PINs changed.
  const metrics = useMemo<PinMetric[]>(() => {
    const day = 86_400_000;
    const now = Date.now();
    let last24h = 0;
    let last7d = 0;
    for (const row of rows) {
      if (!row.updatedAt) continue;
      const changed = new Date(row.updatedAt).getTime();
      if (!Number.isFinite(changed)) continue;
      const age = now - changed;
      if (age <= day) last24h += 1;
      if (age <= 7 * day) last7d += 1;
    }
    return [
      { key: "total", label: "Customers with a PIN", value: rows.length, hint: "Masked until revealed", icon: KeyRound },
      { key: "last24h", label: "Changed in 24 hours", value: last24h, hint: "Set or reset recently", icon: Clock },
      { key: "last7d", label: "Changed in 7 days", value: last7d, hint: "Rolling week", icon: CalendarDays },
    ];
  }, [rows]);

  const reset = trpc.adminOperations.clearWithdrawalPin.useMutation({
    onSuccess: () => {
      setRevealed({});
      void utils.adminOperations.withdrawalPins.invalidate();
    },
  });

  const toggleReveal = (userId: number) => setRevealed((current) => ({ ...current, [userId]: !current[userId] }));

  const resetPin = (row: WithdrawalPinRow) => {
    const label = row.name || row.email || `Customer ${row.userId}`;
    if (!window.confirm(`Reset the withdrawal PIN for ${label}? It will be cleared and they must create a new 6-digit PIN before their next withdrawal.`)) return;
    reset.mutate({ userId: row.userId });
  };

  return (
    <div className="arb-page portal-page admin-withdrawal-pins">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Customers · Withdrawal security</div>
          <h1>Withdrawal PINs</h1>
          <p>Every customer&apos;s 6-digit withdrawal PIN. Each PIN is masked by default — click “Reveal PIN” to show it, or reset a compromised PIN. Customers set and reset their own PIN from the portal, and the PIN is required for every withdrawal.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {query.data && (
        <div className="admin-withdrawal-pin-metrics" role="list">
          {metrics.map((metric) => (
            <div className="admin-withdrawal-pin-metric" role="listitem" key={metric.key}>
              <span className="admin-withdrawal-pin-metric-icon"><metric.icon size={15} /></span>
              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="settings-card" aria-label="Withdrawal PIN list">
        <div className="api-access-section-heading">
          <h2>Customer PINs</h2>
          <div className="form-two">
            <label>
              <span className="sr-only">Search customers</span>
              <input type="search" value={search} placeholder="Search by name, email or customer ID" onChange={(event) => setSearch(event.target.value)} />
            </label>
            <span className="admin-live-chip"><Search size={13} /> {filtered.length} {filtered.length === 1 ? "customer" : "customers"}</span>
          </div>
        </div>

        {query.isLoading && <div role="status">Loading customer withdrawal PINs…</div>}
        {query.isError && <div className="admin-ops-empty error" role="alert">Withdrawal PINs could not be read. {query.error.message}</div>}
        {reset.isError && <div className="admin-ops-empty error" role="alert">The withdrawal PIN could not be reset. {reset.error.message}</div>}
        {reset.isSuccess && !reset.isPending && <div className="admin-withdrawal-pin-flash" role="status"><RotateCcw size={14} /> Withdrawal PIN cleared. The customer must create a new one before withdrawing.</div>}
        {query.data && rows.length === 0 && <div className="empty-records">No customer has set a withdrawal PIN yet.</div>}
        {query.data && rows.length > 0 && filtered.length === 0 && <div className="empty-records">No customer matches this search.</div>}

        {filtered.length > 0 && (
          <div className="admin-ops-table-wrap">
            <table className="admin-ops-table">
              <thead>
                <tr><th>Customer</th><th>Customer ID</th><th>Withdrawal PIN</th><th>Last changed</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isRevealed = revealed[row.userId] === true;
                  return (
                    <tr key={row.userId}>
                      <td>
                        <strong>{row.name || row.email || `Customer ${row.userId}`}</strong>
                        {row.email && <small>{row.email}</small>}
                      </td>
                      <td>{row.userId}</td>
                      <td><code className="admin-withdrawal-pin-value">{isRevealed ? row.pin : MASKED_PIN}</code></td>
                      <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}</td>
                      <td>
                        <div className="admin-withdrawal-pin-row-actions">
                          <button className="secondary-button" type="button" onClick={() => toggleReveal(row.userId)} aria-pressed={isRevealed}>
                            {isRevealed ? <><EyeOff size={14} /> Hide PIN</> : <><Eye size={14} /> Reveal PIN</>}
                          </button>
                          <button className="secondary-button admin-withdrawal-pin-reset" type="button" disabled={reset.isPending} onClick={() => resetPin(row)}>
                            <RotateCcw size={14} /> Reset PIN
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="admin-ops-note" role="note"><ShieldCheck size={14} /> This PIN is required for every withdrawal from any wallet. It is stored so it can be displayed here and revealed by the customer in the portal.</p>
      </section>

      <p className="admin-policy-note" role="note"><KeyRound size={14} /> Customers manage their own PIN from the portal&apos;s Withdrawal PIN menu, where it is masked as ****** until they click “Reveal PIN”. Resetting a PIN clears it; the customer creates a new one.</p>
    </div>
  );
}

export default AdminWithdrawalPins;
