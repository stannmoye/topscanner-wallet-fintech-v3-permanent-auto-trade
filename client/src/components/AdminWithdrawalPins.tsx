import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Administrator console for customer withdrawal PINs.
 *
 * Lists every customer who has set a 6-digit withdrawal PIN. Each PIN is
 * masked (`******`) by default and only shown when the administrator clicks
 * “Reveal PIN” for that row. Read-only — the customer sets or resets their own
 * PIN from the portal, and the PIN is required for every withdrawal.
 */

const MASKED_PIN = "******";

type WithdrawalPinRow = {
  userId: number;
  name: string | null;
  email: string | null;
  pin: string;
  updatedAt: string | null;
};

export function AdminWithdrawalPins() {
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

  const toggleReveal = (userId: number) => setRevealed((current) => ({ ...current, [userId]: !current[userId] }));

  return (
    <div className="arb-page portal-page">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Customers · Withdrawal security</div>
          <h1>Withdrawal PINs</h1>
          <p>Every customer&apos;s 6-digit withdrawal PIN. Each PIN is masked by default — click “Reveal PIN” to show it. Customers set and reset their own PIN from the portal, and the PIN is required for every withdrawal.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

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
                      <td><code className="customer-withdrawal-pin-value">{isRevealed ? row.pin : MASKED_PIN}</code></td>
                      <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}</td>
                      <td>
                        <button className="secondary-button" type="button" onClick={() => toggleReveal(row.userId)} aria-pressed={isRevealed}>
                          {isRevealed ? <><EyeOff size={14} /> Hide PIN</> : <><Eye size={14} /> Reveal PIN</>}
                        </button>
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

      <p className="admin-policy-note" role="note"><KeyRound size={14} /> Customers manage their own PIN from the portal&apos;s Withdrawal PIN menu, where it is masked as ****** until they click “Reveal PIN”.</p>
    </div>
  );
}

export default AdminWithdrawalPins;
