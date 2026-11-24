import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Administrator console for Customer API v1.
 *
 * Wraps `adminOperations.apiAccess`: aggregate overview, cross-customer key
 * management (create/update/revoke), the per-customer access policy and the
 * read-only request / webhook-delivery audit. No money movement lives here.
 */

/** The read scopes an administrator may grant in v1 (mirrors server scopes.ts). */
const READ_SCOPES: Array<{ id: string; label: string }> = [
  { id: "wallets:read", label: "Balances, per-currency wallets and FX rates" },
  { id: "ledger:read", label: "Wallet ledger history" },
  { id: "trading:read", label: "Trades and opportunity history" },
  { id: "positions:read", label: "Investment-module positions across every desk" },
  { id: "payouts:read", label: "Payout requests and their status" },
  { id: "kyc:read", label: "KYC status and stages (no document contents)" },
  { id: "notifications:read", label: "Notification history" },
  { id: "support:read", label: "Support tickets and their messages" },
];

interface AdminApiKeyRow {
  id: number;
  userId: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: "live" | "test";
  status: "active" | "revoked";
  rateLimitPerMinute: number | null;
  ipAllowlist: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  apiEnabled: boolean;
}

interface KeyDraft {
  name: string;
  scopes: string[];
  ipAllowlist: string;
  rateLimitPerMinute: string;
  status: "active" | "revoked";
  reason: string;
}

function formatValue(value: number | string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function parseAllowlist(text: string): string[] | undefined {
  const entries = text.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

export default function AdminCustomerApiAccess() {
  const api = (trpc.adminOperations as unknown as { apiAccess: any }).apiAccess;

  // — Key list filters and paging —
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "revoked">("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const overview = api.overview.useQuery(undefined, { refetchOnWindowFocus: true });
  const keys = api.keys.useQuery({ query: search.trim() || undefined, status: statusFilter || undefined, page, pageSize }, { refetchOnWindowFocus: true });

  // — Create form —
  const [customerSearch, setCustomerSearch] = useState("");
  const customerOptions = api.customerOptions.useQuery({ query: customerSearch.trim() || undefined });
  const [createUserId, setCreateUserId] = useState<number | "">("");
  const [createName, setCreateName] = useState("");
  const [createScopes, setCreateScopes] = useState<string[]>(["wallets:read"]);
  const [createEnv, setCreateEnv] = useState<"live" | "test">("live");
  const [createAllowlist, setCreateAllowlist] = useState("");
  const [createRateLimit, setCreateRateLimit] = useState("");
  const [createReason, setCreateReason] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const createKey = api.createKey.useMutation();
  const updateKey = api.updateKey.useMutation();
  const revokeKey = api.revokeKey.useMutation();
  const updateSettings = api.updateSettings.useMutation();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<KeyDraft | null>(null);
  const [rowMessage, setRowMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [formMessage, setFormMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // — Per-customer policy —
  const [policyUserId, setPolicyUserId] = useState<number | "">("");
  const policySettings = api.settings.useQuery({ userId: policyUserId as number }, { enabled: policyUserId !== "" });
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [policyScopes, setPolicyScopes] = useState<string[]>([]);
  const [policyFullCeiling, setPolicyFullCeiling] = useState(true);
  const [policyRateLimit, setPolicyRateLimit] = useState("");
  const [policyReason, setPolicyReason] = useState("");
  const [policyMessage, setPolicyMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const data = policySettings.data as { apiEnabled: boolean; defaultRateLimitPerMinute: number | null; allowedScopes: string[] | null } | null | undefined;
    if (policyUserId === "" || !data) return;
    setPolicyEnabled(data.apiEnabled);
    setPolicyFullCeiling(!data.allowedScopes || data.allowedScopes.length === 0);
    setPolicyScopes(data.allowedScopes ?? []);
    setPolicyRateLimit(data.defaultRateLimitPerMinute ? String(data.defaultRateLimitPerMinute) : "");
  }, [policyUserId, policySettings.data]);

  // — Read-only audit —
  const [requestsPage, setRequestsPage] = useState(1);
  const [deliveriesPage, setDeliveriesPage] = useState(1);
  const requests = api.requests.useQuery({ page: requestsPage, pageSize: 50 });
  const deliveries = api.deliveries.useQuery({ page: deliveriesPage, pageSize: 50 });

  const options = useMemo(() => (customerOptions.data ?? []) as Array<{ id: number; name: string | null; email: string | null }>, [customerOptions.data]);
  const keyRows = (keys.data?.items ?? []) as AdminApiKeyRow[];
  const totals = keys.data ? { total: keys.data.total as number, page: keys.data.page as number, pageSize: keys.data.pageSize as number } : null;
  const lastPage = totals ? Math.max(1, Math.ceil(totals.total / totals.pageSize)) : 1;

  const createValid = createUserId !== "" && createName.trim().length >= 2 && createScopes.length > 0 && createReason.trim().length >= 5;

  const resetCreate = () => {
    setCreateUserId("");
    setCreateName("");
    setCreateScopes(["wallets:read"]);
    setCreateEnv("live");
    setCreateAllowlist("");
    setCreateRateLimit("");
    setCreateReason("");
  };

  const submitCreate = async () => {
    setFormMessage(null);
    setIssuedKey(null);
    if (!createValid) {
      setFormMessage({ kind: "error", text: "Choose a customer, name the key (2+ characters), select at least one scope and record an audit reason (5+ characters)." });
      return;
    }
    try {
      const result = await createKey.mutateAsync({
        userId: createUserId as number,
        name: createName.trim(),
        scopes: createScopes,
        environment: createEnv,
        ipAllowlist: parseAllowlist(createAllowlist),
        rateLimitPerMinute: createRateLimit.trim() ? Number(createRateLimit) : undefined,
        reason: createReason.trim(),
      });
      setIssuedKey(String(result?.issued?.key ?? ""));
      setFormMessage({ kind: "success", text: `Key created for ${result?.record?.keyPrefix ?? "the customer"}. Copy it now — it is shown only once.` });
      resetCreate();
      await keys.refetch();
      await overview.refetch();
    } catch (error) {
      setFormMessage({ kind: "error", text: error instanceof Error ? error.message : "The key could not be created." });
    }
  };

  const beginEdit = (row: AdminApiKeyRow) => {
    setRowMessage(null);
    setEditingId(row.id);
    setDraft({
      name: row.name,
      scopes: [...row.scopes],
      ipAllowlist: (row.ipAllowlist ?? []).join(", "),
      rateLimitPerMinute: row.rateLimitPerMinute ? String(row.rateLimitPerMinute) : "",
      status: row.status,
      reason: "",
    });
  };

  const submitEdit = async () => {
    if (!draft || editingId === null) return;
    setRowMessage(null);
    if (draft.reason.trim().length < 5) {
      setRowMessage({ kind: "error", text: "Record an audit reason of at least 5 characters." });
      return;
    }
    try {
      await updateKey.mutateAsync({
        keyId: editingId,
        name: draft.name.trim(),
        scopes: draft.scopes,
        ipAllowlist: parseAllowlist(draft.ipAllowlist),
        rateLimitPerMinute: draft.rateLimitPerMinute.trim() ? Number(draft.rateLimitPerMinute) : null,
        status: draft.status,
        reason: draft.reason.trim(),
      });
      setRowMessage({ kind: "success", text: `Key ${editingId} updated.` });
      setEditingId(null);
      setDraft(null);
      await keys.refetch();
      await overview.refetch();
    } catch (error) {
      setRowMessage({ kind: "error", text: error instanceof Error ? error.message : "The key could not be updated." });
    }
  };

  const revoke = async (row: AdminApiKeyRow) => {
    const reason = window.prompt(`Reason for revoking “${row.name}” (5–500 characters):`, "") ?? "";
    if (reason.trim().length < 5) return;
    setRowMessage(null);
    try {
      const ok = await revokeKey.mutateAsync({ keyId: row.id, reason: reason.trim() });
      setRowMessage({ kind: ok ? "success" : "error", text: ok ? `Key ${row.keyPrefix} revoked.` : "The key was not found." });
      await keys.refetch();
      await overview.refetch();
    } catch (error) {
      setRowMessage({ kind: "error", text: error instanceof Error ? error.message : "The key could not be revoked." });
    }
  };

  const submitPolicy = async () => {
    setPolicyMessage(null);
    if (policyUserId === "") {
      setPolicyMessage({ kind: "error", text: "Choose a customer first." });
      return;
    }
    if (policyReason.trim().length < 5) {
      setPolicyMessage({ kind: "error", text: "Record an audit reason of at least 5 characters." });
      return;
    }
    try {
      await updateSettings.mutateAsync({
        userId: policyUserId as number,
        apiEnabled: policyEnabled,
        defaultRateLimitPerMinute: policyRateLimit.trim() ? Number(policyRateLimit) : null,
        allowedScopes: policyFullCeiling ? null : policyScopes,
        reason: policyReason.trim(),
      });
      setPolicyMessage({ kind: "success", text: "Customer API access policy saved." });
      setPolicyReason("");
      await policySettings.refetch();
      await overview.refetch();
    } catch (error) {
      setPolicyMessage({ kind: "error", text: error instanceof Error ? error.message : "The policy could not be saved." });
    }
  };

  const toggleScope = (list: string[], scope: string, setter: (next: string[]) => void) => {
    setter(list.includes(scope) ? list.filter((entry) => entry !== scope) : [...list, scope]);
  };

  return (
    <div className="arb-page portal-page trade-admin-surface">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Integrations · Customer API v1</div>
          <h1>Customer API Access</h1>
          <p>Create, update and revoke customer API keys, set each customer&apos;s access policy and review the read-only request and delivery audit. Keys never move funds — this surface only grants the scoped read endpoints.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => { void overview.refetch(); void keys.refetch(); }} disabled={overview.isFetching || keys.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      <section className="settings-card" aria-label="Customer API overview">
        {overview.isLoading && <div role="status">Loading API overview…</div>}
        {overview.isError && <div className="admin-ops-empty error" role="alert">The API overview could not be read. {overview.error.message}</div>}
        {overview.data && (
          <dl className="package-fee-current">
            <div><dt>Total keys</dt><dd>{overview.data.totalKeys}</dd></div>
            <div><dt>Active</dt><dd>{overview.data.activeKeys}</dd></div>
            <div><dt>Revoked</dt><dd>{overview.data.revokedKeys}</dd></div>
            <div><dt>Requests (24h)</dt><dd>{overview.data.requests24h}</dd></div>
            <div><dt>Failed deliveries</dt><dd>{overview.data.failedDeliveries}</dd></div>
            <div><dt>Disabled customers</dt><dd>{overview.data.disabledCustomers}</dd></div>
          </dl>
        )}
      </section>

      <section className="settings-card" aria-label="Create an API key">
        <div className="api-access-form-title">
          <span className="api-access-icon" aria-hidden="true"><KeyRound size={18} /></span>
          <div>
            <h2>Create a key for a customer</h2>
            <p>The plaintext key is shown once. Only the public prefix and a hashed secret are stored.</p>
          </div>
        </div>
        <div className="form-two">
          <label>Customer
            <input type="text" value={customerSearch} placeholder="Search by name or email" onChange={(event) => setCustomerSearch(event.target.value)} />
            <select value={createUserId} onChange={(event) => setCreateUserId(event.target.value ? Number(event.target.value) : "")}>
              <option value="">Select a customer…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name || option.email || `Customer ${option.id}`}{option.email ? ` · ${option.email}` : ""}</option>
              ))}
            </select>
          </label>
          <label>Key name
            <input type="text" value={createName} maxLength={64} placeholder="e.g. Accounting dashboard" onChange={(event) => setCreateName(event.target.value)} />
          </label>
        </div>
        <div className="form-two">
          <label>Environment
            <select value={createEnv} onChange={(event) => setCreateEnv(event.target.value as "live" | "test")}>
              <option value="live">Live</option>
              <option value="test">Test</option>
            </select>
          </label>
          <label>Rate limit override (requests/minute, optional)
            <input type="number" min={1} max={100000} inputMode="numeric" value={createRateLimit} placeholder="Uses the platform default" onChange={(event) => setCreateRateLimit(event.target.value)} />
          </label>
        </div>
        <label>IP allowlist (optional)
          <input type="text" value={createAllowlist} placeholder="Comma-separated addresses or CIDR, e.g. 203.0.113.4, 10.0.0.0/8" onChange={(event) => setCreateAllowlist(event.target.value)} />
        </label>
        <fieldset className="api-access-scopes">
          <legend>Scopes (read-only)</legend>
          {READ_SCOPES.map((scope) => (
            <label className={`api-access-scope${createScopes.includes(scope.id) ? " selected" : ""}`} key={scope.id}>
              <input type="checkbox" checked={createScopes.includes(scope.id)} onChange={() => toggleScope(createScopes, scope.id, setCreateScopes)} />
              <span className="api-access-scope-check" aria-hidden="true">{createScopes.includes(scope.id) ? <Check size={12} /> : null}</span>
              <span><strong>{scope.id}</strong><small>{scope.label}</small></span>
            </label>
          ))}
        </fieldset>
        <label>Reason for creating this key (required, audited)
          <textarea minLength={5} maxLength={500} value={createReason} onChange={(event) => setCreateReason(event.target.value)} />
        </label>
        {formMessage && <div className={formMessage.kind === "error" ? "admin-ops-empty error" : "test-notice"} role={formMessage.kind === "error" ? "alert" : "status"} aria-live="polite">{formMessage.text}</div>}
        {issuedKey && (
          <div className="api-access-secret" role="status">
            <h2>Copy this key now</h2>
            <p>This is the only time the full key is shown. Store it in the customer&apos;s secret manager.</p>
            <code>{issuedKey}</code>
            <div className="api-access-secret-actions">
              <button className="secondary-button" type="button" onClick={() => void navigator.clipboard?.writeText(issuedKey)}><Copy size={14} /> Copy</button>
              <button className="secondary-button" type="button" onClick={() => setIssuedKey(null)}>Dismiss</button>
            </div>
          </div>
        )}
        <button className="primary-button" type="button" disabled={!createValid || createKey.isPending} aria-busy={createKey.isPending} onClick={() => void submitCreate()}>
          {createKey.isPending ? "Creating key…" : "Create API key"}
        </button>
      </section>

      <section className="settings-card" aria-label="API keys">
        <div className="api-access-section-heading">
          <h2>API keys</h2>
          <div className="form-two">
            <input type="search" value={search} placeholder="Search name, prefix or customer" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "" | "active" | "revoked"); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </div>
        {rowMessage && <div className={rowMessage.kind === "error" ? "admin-ops-empty error" : "test-notice"} role={rowMessage.kind === "error" ? "alert" : "status"} aria-live="polite">{rowMessage.text}</div>}
        {keys.isLoading && <div role="status">Loading keys…</div>}
        {keys.isError && <div className="admin-ops-empty error" role="alert">Keys could not be read. {keys.error.message}</div>}
        {keys.data && keyRows.length === 0 && <div className="empty-records">No API keys match this filter.</div>}
        {keyRows.length > 0 && (
          <div className="api-access-key-list">
            {keyRows.map((row) => (
              <article className="api-access-key-row" key={row.id}>
                <span className="api-access-key-symbol" aria-hidden="true"><KeyRound size={16} /></span>
                <div className="api-access-key-main">
                  {editingId === row.id && draft ? (
                    <div className="api-access-create">
                      <div className="form-two">
                        <label>Name<input type="text" maxLength={64} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                        <label>Status
                          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as "active" | "revoked" })}>
                            <option value="active">Active</option>
                            <option value="revoked">Revoked</option>
                          </select>
                        </label>
                      </div>
                      <div className="form-two">
                        <label>Rate limit (requests/minute)<input type="number" min={1} max={100000} inputMode="numeric" value={draft.rateLimitPerMinute} placeholder="Account default" onChange={(event) => setDraft({ ...draft, rateLimitPerMinute: event.target.value })} /></label>
                        <label>IP allowlist<input type="text" value={draft.ipAllowlist} placeholder="Comma-separated addresses or CIDR" onChange={(event) => setDraft({ ...draft, ipAllowlist: event.target.value })} /></label>
                      </div>
                      <fieldset className="api-access-scopes">
                        <legend>Scopes</legend>
                        {READ_SCOPES.map((scope) => (
                          <label className={`api-access-scope${draft.scopes.includes(scope.id) ? " selected" : ""}`} key={scope.id}>
                            <input type="checkbox" checked={draft.scopes.includes(scope.id)} onChange={() => toggleScope(draft.scopes, scope.id, (next) => setDraft({ ...draft, scopes: next }))} />
                            <span className="api-access-scope-check" aria-hidden="true">{draft.scopes.includes(scope.id) ? <Check size={12} /> : null}</span>
                            <span><strong>{scope.id}</strong><small>{scope.label}</small></span>
                          </label>
                        ))}
                      </fieldset>
                      <label>Reason for this change (required, audited)<textarea minLength={5} maxLength={500} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
                      <div className="api-access-secret-actions">
                        <button className="primary-button" type="button" disabled={updateKey.isPending || draft.scopes.length === 0 || draft.reason.trim().length < 5} onClick={() => void submitEdit()}>{updateKey.isPending ? "Saving…" : "Save changes"}</button>
                        <button className="secondary-button" type="button" onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="api-access-key-title">
                        <h3>{row.name}</h3>
                        <span className={`api-access-status ${row.status}`}><i />{row.status}</span>
                        {row.apiEnabled ? null : <span className="api-access-status pending"><i />customer access disabled</span>}
                      </div>
                      <code>{row.keyPrefix} · {row.environment}</code>
                      <div className="api-access-key-meta">
                        <span>{row.customerName || row.customerEmail || `Customer ${row.userId}`}</span>
                        <span>Rate limit: {formatValue(row.rateLimitPerMinute)}</span>
                        <span>Created: {new Date(row.createdAt).toLocaleString()}</span>
                        <span>Last used: {row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "never"}</span>
                        {row.revokedAt ? <span>Revoked: {new Date(row.revokedAt).toLocaleString()}</span> : null}
                      </div>
                      <div className="api-access-key-scopes">
                        {row.scopes.map((scope) => <span key={scope}>{scope}</span>)}
                      </div>
                    </>
                  )}
                </div>
                <div className="api-access-secret-actions">
                  {editingId === row.id ? null : (
                    <>
                      <button className="secondary-button" type="button" onClick={() => beginEdit(row)}>Edit</button>
                      {row.status === "active" && <button className="api-access-revoke" type="button" onClick={() => void revoke(row)} disabled={revokeKey.isPending}><AlertTriangle size={14} /> Revoke</button>}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {totals && totals.total > 0 && (
          <div className="api-access-form-footer">
            <span>Page {totals.page} of {lastPage} · {totals.total} keys</span>
            <div className="api-access-secret-actions">
              <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button className="secondary-button" type="button" disabled={page >= lastPage} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-card" aria-label="Per-customer access policy">
        <div className="api-access-section-heading">
          <h2>Per-customer access policy</h2>
        </div>
        <p>A missing policy means the platform default: access enabled, platform rate limit and the full read-scope ceiling. Narrow the ceiling to restrict which scopes any of the customer&apos;s keys may hold.</p>
        <label>Customer
          <select value={policyUserId} onChange={(event) => setPolicyUserId(event.target.value ? Number(event.target.value) : "")}>
            <option value="">Select a customer…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>{option.name || option.email || `Customer ${option.id}`}{option.email ? ` · ${option.email}` : ""}</option>
            ))}
          </select>
        </label>
        {policyUserId !== "" && (
          <>
            {policySettings.isError && <div className="admin-ops-empty error" role="alert">The policy could not be read. {policySettings.error.message}</div>}
            <label className="api-access-scope">
              <input type="checkbox" checked={policyEnabled} onChange={(event) => setPolicyEnabled(event.target.checked)} />
              <span className="api-access-scope-check" aria-hidden="true">{policyEnabled ? <Check size={12} /> : null}</span>
              <span><strong>API access enabled</strong><small>When off, every key for this customer stops authenticating.</small></span>
            </label>
            <label>Default rate limit (requests/minute, blank = platform default)
              <input type="number" min={1} max={100000} inputMode="numeric" value={policyRateLimit} onChange={(event) => setPolicyRateLimit(event.target.value)} />
            </label>
            <label className="api-access-scope">
              <input type="checkbox" checked={policyFullCeiling} onChange={(event) => setPolicyFullCeiling(event.target.checked)} />
              <span className="api-access-scope-check" aria-hidden="true">{policyFullCeiling ? <Check size={12} /> : null}</span>
              <span><strong>Allow the full read-scope ceiling</strong><small>Uncheck to limit which read scopes this customer may use.</small></span>
            </label>
            {!policyFullCeiling && (
              <fieldset className="api-access-scopes">
                <legend>Allowed scopes (ceiling)</legend>
                {READ_SCOPES.map((scope) => (
                  <label className={`api-access-scope${policyScopes.includes(scope.id) ? " selected" : ""}`} key={scope.id}>
                    <input type="checkbox" checked={policyScopes.includes(scope.id)} onChange={() => toggleScope(policyScopes, scope.id, setPolicyScopes)} />
                    <span className="api-access-scope-check" aria-hidden="true">{policyScopes.includes(scope.id) ? <Check size={12} /> : null}</span>
                    <span><strong>{scope.id}</strong><small>{scope.label}</small></span>
                  </label>
                ))}
              </fieldset>
            )}
            <label>Reason for this policy change (required, audited)
              <textarea minLength={5} maxLength={500} value={policyReason} onChange={(event) => setPolicyReason(event.target.value)} />
            </label>
            {policyMessage && <div className={policyMessage.kind === "error" ? "admin-ops-empty error" : "test-notice"} role={policyMessage.kind === "error" ? "alert" : "status"} aria-live="polite">{policyMessage.text}</div>}
            <button className="primary-button" type="button" disabled={updateSettings.isPending || policyReason.trim().length < 5 || (!policyFullCeiling && policyScopes.length === 0)} onClick={() => void submitPolicy()}>
              {updateSettings.isPending ? "Saving policy…" : "Save access policy"}
            </button>
          </>
        )}
      </section>

      <section className="settings-card" aria-label="API request audit">
        <div className="api-access-section-heading"><h2>Recent requests</h2></div>
        {requests.isLoading && <div role="status">Loading requests…</div>}
        {requests.isError && <div className="admin-ops-empty error" role="alert">Requests could not be read. {requests.error.message}</div>}
        {requests.data && (requests.data.items as Array<{ id: number; method: string; path: string; status: number; latencyMs: number; createdAt: string | null; keyPrefix: string | null }>).length === 0 && <div className="empty-records">No API requests recorded yet.</div>}
        {requests.data && (requests.data.items as Array<{ id: number; method: string; path: string; status: number; latencyMs: number; createdAt: string | null; keyPrefix: string | null }>).length > 0 && (
          <table className="admin-table">
            <thead><tr><th>When</th><th>Method</th><th>Path</th><th>Status</th><th>Latency</th><th>Key</th></tr></thead>
            <tbody>
              {(requests.data.items as Array<{ id: number; method: string; path: string; status: number; latencyMs: number; createdAt: string | null; keyPrefix: string | null }>).map((row) => (
                <tr key={row.id}><td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td><td>{row.method}</td><td>{row.path}</td><td>{row.status}</td><td>{row.latencyMs} ms</td><td>{row.keyPrefix ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {requests.data && (requests.data.total as number) > 50 && (
          <div className="api-access-form-footer">
            <span>Page {requests.data.page} of {Math.max(1, Math.ceil((requests.data.total as number) / 50))}</span>
            <div className="api-access-secret-actions">
              <button className="secondary-button" type="button" disabled={requestsPage <= 1} onClick={() => setRequestsPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button className="secondary-button" type="button" disabled={requestsPage * 50 >= (requests.data.total as number)} onClick={() => setRequestsPage((current) => current + 1)}>Next</button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-card" aria-label="Webhook delivery audit">
        <div className="api-access-section-heading"><h2>Webhook deliveries</h2></div>
        <p>Read-only delivery audit. Populated once customer webhooks are enabled in phase 2.</p>
        {deliveries.isLoading && <div role="status">Loading deliveries…</div>}
        {deliveries.isError && <div className="admin-ops-empty error" role="alert">Deliveries could not be read. {deliveries.error.message}</div>}
        {deliveries.data && (deliveries.data.items as Array<{ id: number; eventType: string; status: string; attempts: number; responseStatus: number | null; createdAt: string | null }>).length === 0 && <div className="empty-records">No webhook deliveries recorded yet.</div>}
        {deliveries.data && (deliveries.data.items as Array<{ id: number; eventType: string; status: string; attempts: number; responseStatus: number | null; createdAt: string | null }>).length > 0 && (
          <table className="admin-table">
            <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Attempts</th><th>Response</th></tr></thead>
            <tbody>
              {(deliveries.data.items as Array<{ id: number; eventType: string; status: string; attempts: number; responseStatus: number | null; createdAt: string | null }>).map((row) => (
                <tr key={row.id}><td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td><td>{row.eventType}</td><td>{row.status}</td><td>{row.attempts}</td><td>{row.responseStatus ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="admin-policy-note" role="note"><ShieldCheck size={14} /> Keys grant scoped read access only. Every key change and policy change is recorded in the administrator audit trail with the acting administrator and the supplied reason.</p>
    </div>
  );
}
