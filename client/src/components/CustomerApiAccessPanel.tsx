import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";

/**
 * Customer-facing API Access panel.
 *
 * Wraps the session-authenticated REST routes exposed by the Customer API v1
 * gateway (`/api/customer/api-keys`). Customers can list, create and revoke
 * their own scoped read-only keys. The plaintext key is shown exactly once.
 */

interface PublicApiKey {
  id: number;
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
}

interface AvailableScope {
  scope: string;
  description: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function formatValue(value: number | string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function parseAllowlist(text: string): string[] | undefined {
  const entries = text.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

export function CustomerApiAccessPanel() {
  const [keys, setKeys] = useState<PublicApiKey[]>([]);
  const [availableScopes, setAvailableScopes] = useState<AvailableScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [ipAllowlist, setIpAllowlist] = useState("");
  const [rateLimit, setRateLimit] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const readScopes = useMemo(
    () => availableScopes.filter((scope) => scope.scope.endsWith(":read")),
    [availableScopes]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ keys: PublicApiKey[]; availableScopes: AvailableScope[] }>("/api/customer/api-keys");
      setKeys(data.keys);
      setAvailableScopes(data.availableScopes);
      if (selectedScopes.length === 0 && data.availableScopes.length > 0) {
        setSelectedScopes(data.availableScopes.filter((s) => s.scope === "wallets:read").map((s) => s.scope));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your API keys.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope]
    );
  };

  const createKey = async () => {
    if (name.trim().length < 2) {
      setError("Name the key with at least 2 characters.");
      return;
    }
    if (selectedScopes.length === 0) {
      setError("Select at least one scope for the key.");
      return;
    }
    setCreating(true);
    setError(null);
    setCreatedKey(null);
    try {
      const data = await fetchJson<{ key: string; record: PublicApiKey }>("/api/customer/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes: selectedScopes,
          environment,
          ipAllowlist: parseAllowlist(ipAllowlist),
          rateLimitPerMinute: rateLimit.trim() ? Number(rateLimit) : undefined,
        }),
      });
      setCreatedKey(data.key);
      setName("");
      setSelectedScopes([]);
      setIpAllowlist("");
      setRateLimit("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be created.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: PublicApiKey) => {
    const reason = window.prompt(`Reason for revoking “${key.name}” (optional):`, "") ?? "";
    try {
      await fetchJson<{ success: boolean }>(`/api/customer/api-keys/${key.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be revoked.");
    }
  };

  return (
    <div className="arb-page portal-page settings-page customer-preference-page">
      <div className="portal-page-top">
        <div>
          <div className="eyebrow">Developer settings</div>
          <h1>API Access</h1>
          <p>Create scoped read-only API keys to integrate your Arbitrade account with your own tools. Keys never move funds on their own.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <section className="preference-hero">
        <div className="preference-hero-icon"><KeyRound size={22} /></div>
        <div>
          <span className="eyebrow">WiseBond account controls</span>
          <h2>API Access</h2>
          <p>These controls are designed around clear ownership, secure access, and an auditable customer experience.</p>
        </div>
      </section>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <section className="settings-card api-access-create" aria-label="Create an API key">
        <div className="api-access-form-title">
          <span className="api-access-icon" aria-hidden="true"><KeyRound size={18} /></span>
          <div>
            <h2>Create a new API key</h2>
            <p>The full key is shown once after creation. Store it in a secret manager — we never keep the plaintext.</p>
          </div>
        </div>
        <div className="form-two">
          <label className="api-access-name-label">Key name
            <input type="text" value={name} maxLength={64} placeholder="e.g. Accounting dashboard" onChange={(event) => setName(event.target.value)} />
          </label>
          <label>Environment
            <select value={environment} onChange={(event) => setEnvironment(event.target.value as "live" | "test")}>
              <option value="live">Live</option>
              <option value="test">Test</option>
            </select>
          </label>
        </div>
        <div className="form-two">
          <label>IP allowlist (optional)
            <input type="text" value={ipAllowlist} placeholder="Comma-separated addresses or CIDR, e.g. 203.0.113.4, 10.0.0.0/8" onChange={(event) => setIpAllowlist(event.target.value)} />
          </label>
          <label>Rate limit (requests/minute, optional)
            <input type="number" min={1} max={100000} inputMode="numeric" value={rateLimit} placeholder="Uses the account default" onChange={(event) => setRateLimit(event.target.value)} />
          </label>
        </div>
        <div className="api-access-scope-heading"><strong>Scopes</strong><span>{selectedScopes.length} selected</span></div>
        <div className="api-access-scopes">
          {readScopes.map((scope) => (
            <label className={`api-access-scope${selectedScopes.includes(scope.scope) ? " selected" : ""}`} key={scope.scope}>
              <input type="checkbox" checked={selectedScopes.includes(scope.scope)} onChange={() => toggleScope(scope.scope)} />
              <span className="api-access-scope-check" aria-hidden="true">{selectedScopes.includes(scope.scope) ? <Check size={12} /> : null}</span>
              <span><strong>{scope.scope}</strong><small>{scope.description}</small></span>
            </label>
          ))}
        </div>
        {createdKey && (
          <div className="api-access-secret" role="status">
            <h2>Copy this key now</h2>
            <p>This is the only time the full key is shown. It will not be retrievable again.</p>
            <code>{createdKey}</code>
            <div className="api-access-secret-actions">
              <button className="secondary-button" type="button" onClick={() => void navigator.clipboard?.writeText(createdKey)}><Copy size={14} /> Copy</button>
              <button className="secondary-button" type="button" onClick={() => setCreatedKey(null)}>Dismiss</button>
            </div>
          </div>
        )}
        <div className="api-access-form-footer">
          <span><ShieldCheck size={14} /> Scoped read-only access · audited</span>
          <button className="primary-button" type="button" disabled={creating || name.trim().length < 2 || selectedScopes.length === 0} onClick={() => void createKey()}>
            {creating ? "Creating key…" : "Create API key"}
          </button>
        </div>
      </section>

      <section className="settings-card" aria-label="Your API keys">
        <div className="api-access-section-heading"><h2>Your keys</h2><p>{keys.length} key{keys.length === 1 ? "" : "s"} on this account.</p></div>
        {loading && <div role="status">Loading your API keys…</div>}
        {!loading && keys.length === 0 && (
          <div className="api-access-empty">
            <span className="api-access-empty-icon" aria-hidden="true"><KeyRound size={22} /></span>
            <h3>No API keys yet</h3>
            <p>Create your first key above to start reading your account data through the Customer API.</p>
          </div>
        )}
        {keys.length > 0 && (
          <div className="api-access-key-list">
            {keys.map((key) => (
              <article className="api-access-key-row" key={key.id}>
                <span className="api-access-key-symbol" aria-hidden="true"><KeyRound size={16} /></span>
                <div className="api-access-key-main">
                  <div className="api-access-key-title">
                    <h3>{key.name}</h3>
                    <span className={`api-access-status ${key.status}`}><i />{key.status}</span>
                  </div>
                  <code>{key.keyPrefix} · {key.environment}</code>
                  <div className="api-access-key-meta">
                    <span>Rate limit: {formatValue(key.rateLimitPerMinute)}</span>
                    <span>Created: {new Date(key.createdAt).toLocaleString()}</span>
                    <span>Last used: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "never"}</span>
                    {key.revokedAt ? <span>Revoked: {new Date(key.revokedAt).toLocaleString()}</span> : null}
                  </div>
                  <div className="api-access-key-scopes">
                    {key.scopes.map((scope) => <span key={scope}>{scope}</span>)}
                  </div>
                </div>
                {key.status === "active" && (
                  <button className="api-access-revoke" type="button" onClick={() => void revoke(key)}><AlertTriangle size={14} /> Revoke</button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="test-notice"><CheckCircle2 size={14} /><span>API access is enabled for your account. Disabling it requires an administrator change.</span></div>
    </div>
  );
}
