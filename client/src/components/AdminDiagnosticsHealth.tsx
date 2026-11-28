import { useMemo, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  Info,
  Loader2,
  Play,
  PlugZap,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./admin-diagnostics-health.css";

/**
 * Administrator console for crash, resource and API diagnostics.
 *
 * Three pages share this file because they form one diagnostics hub:
 *  - {@link AdminCrashDiagnostics} — why the application crashed, pinned to the
 *    exact error, stack and context, grouped by restart session and kept across
 *    restarts so the cause is still visible after the process comes back.
 *  - {@link AdminResourceHealth} — live memory/disk usage and a single list of
 *    improvements tiered as critical / major / minor.
 *  - {@link AdminApiHealth} — every outbound provider with its live status,
 *    measured resource use, and an on-demand "Test now" probe.
 */

/* ------------------------------------------------------------------ */
/* Shared types (mirror the server report shapes)                      */
/* ------------------------------------------------------------------ */

type IncidentEntry = {
  id: number;
  severity: string;
  category: string;
  processRole: string;
  eventCode: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  appVersion: string | null;
  sourceRevision: string | null;
  instanceId: string | null;
  bootId: string | null;
  exitCode: number | null;
  signal: string | null;
  occurredAt: string;
  isCurrentBoot: boolean;
};

type IncidentBootSummary = {
  bootId: string | null;
  firstAt: string | null;
  lastAt: string;
  incidents: number;
  fatal: number;
  error: number;
  isCurrent: boolean;
};

type IncidentReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  retentionDays: number;
  currentBootId: string;
  currentBootStartedAt: string;
  summary: {
    total: number;
    fatal: number;
    error: number;
    warning: number;
    info: number;
    last24h: number;
    last7d: number;
    categories: Record<string, number>;
  };
  boots: IncidentBootSummary[];
  incidents: IncidentEntry[];
};

type ImprovementTier = "critical" | "major" | "minor";

type Improvement = {
  tier: ImprovementTier;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
};

type ResourceReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    heapUsePercent: number;
    heapLimitBytes: number | null;
    heapLimitUsePercent: number | null;
    externalBytes: number;
    arrayBuffersBytes: number;
    limitBytes: number | null;
    availableBytes: number | null;
    limitUsePercent: number | null;
  };
  database: {
    connected: boolean;
    connectionLimit: number | null;
    totalConnections: number | null;
    idleConnections: number | null;
    activeConnections: number | null;
    queuedRequests: number | null;
  };
  disk: {
    target: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  } | null;
  improvementSummary: { critical: number; major: number; minor: number; total: number };
  improvements: Improvement[];
  notes: string[];
};

type ApiProbeStatus = "ok" | "degraded" | "fail" | "not_configured" | "not_tested" | "stale";
type ApiResourceClass = "low" | "moderate" | "high";

type ApiProviderReport = {
  id: string;
  label: string;
  category: string;
  kind: string;
  endpoint: string | null;
  probeMode: "data" | "reachability" | "none";
  probeSupported: boolean;
  requiresConfig: boolean;
  configured: boolean;
  passiveStatus: ApiProbeStatus;
  lastCheckedAt: string | null;
  lastStatus: ApiProbeStatus | null;
  statusCode: number | null;
  latencyMs: number | null;
  responseBytes: number | null;
  resourceClass: ApiResourceClass | null;
  errorCode: string | null;
  errorMessage: string | null;
  note: string;
  recommendation: string;
};

type ApiHealthReport = {
  sourceAvailable: boolean;
  generatedAt: string;
  staleAfterMs: number;
  summary: { total: number; working: number; failing: number; notConfigured: number; notTested: number; highResource: number };
  providers: ApiProviderReport[];
  recommendations: string[];
};

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

type IncidentSeverity = "info" | "warning" | "error" | "fatal";
type IncidentCategory =
  | "uncaught_exception"
  | "unhandled_rejection"
  | "startup_failure"
  | "unexpected_exit"
  | "resource_exhaustion"
  | "worker_failure"
  | "http_server_error";

const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  uncaught_exception: "Uncaught exception",
  unhandled_rejection: "Unhandled rejection",
  startup_failure: "Startup failure",
  unexpected_exit: "Unexpected exit",
  resource_exhaustion: "Resource exhaustion",
  worker_failure: "Worker failure",
  http_server_error: "HTTP server error",
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Math.round((bytes / Math.pow(1024, index)) * 10) / 10} ${units[index]}`;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function shortId(value: string | null | undefined): string {
  if (!value) return "unattributed";
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function MetricGrid({ metrics }: { metrics: { key: string; label: string; value: string | number; hint: string; icon: typeof Activity; tone?: string }[] }) {
  return (
    <div className="admin-sign-in-metrics" role="list">
      {metrics.map((metric) => (
        <div className="admin-sign-in-metric" role="listitem" key={metric.key}>
          <span className={metric.tone ? `admin-sign-in-metric-icon ${metric.tone}` : "admin-sign-in-metric-icon"}><metric.icon size={15} /></span>
          <div>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.hint}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Crash & Incident Diagnostics                                        */
/* ------------------------------------------------------------------ */

const SEVERITY_TONES: Record<string, string> = {
  fatal: "is-critical",
  error: "is-major",
  warning: "is-minor",
  info: "is-muted",
};

export function AdminCrashDiagnostics() {
  const utils = trpc.useUtils();
  const [severity, setSeverity] = useState<IncidentSeverity | "">("");
  const [category, setCategory] = useState<IncidentCategory | "">("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const reportQuery = trpc.adminOperations.incidents.useQuery({ limit: 150 }, { refetchOnWindowFocus: true });
  const listInput = useMemo(() => {
    const input: { limit: number; severity?: IncidentSeverity; category?: IncidentCategory } = { limit: 200 };
    if (severity) input.severity = severity;
    if (category) input.category = category;
    return input;
  }, [severity, category]);
  const listQuery = trpc.adminOperations.incidentList.useQuery(listInput, { refetchOnWindowFocus: true });
  const purge = trpc.adminOperations.purgeIncidents.useMutation();
  const deleteIncident = trpc.adminOperations.deleteIncident.useMutation();
  const clearIncidents = trpc.adminOperations.clearIncidents.useMutation();

  const report = reportQuery.data as IncidentReport | undefined;
  const incidents = (listQuery.data as IncidentEntry[] | undefined) ?? [];

  const summary = report?.summary;
  const metrics = [
    { key: "total", label: "Incidents retained", value: summary?.total ?? 0, hint: `Rolling ${report?.retentionDays ?? 90}-day window`, icon: ShieldAlert },
    { key: "fatal", label: "Fatal", value: summary?.fatal ?? 0, hint: "Crashes and OOM terminations", icon: AlertOctagon, tone: summary?.fatal ? "is-critical" : undefined },
    { key: "last24h", label: "Last 24 hours", value: summary?.last24h ?? 0, hint: `Errors: ${summary?.error ?? 0}`, icon: Clock },
    { key: "boots", label: "Restart sessions", value: report?.boots.length ?? 0, hint: `Current boot started ${formatWhen(report?.currentBootStartedAt)}`, icon: Server },
  ];

  const refreshAll = () => {
    void reportQuery.refetch();
    void listQuery.refetch();
  };

  const refreshIncidentData = async () => {
    await utils.adminOperations.incidents.invalidate();
    await utils.adminOperations.incidentList.invalidate();
  };

  const runPurge = async () => {
    await purge.mutateAsync({ olderThanDays: report?.retentionDays ?? 90 });
    await refreshIncidentData();
  };

  // Manual delete of a single crash report — the record that explains a crash the
  // administrator has already diagnosed, especially the fatal entry that caused a restart.
  const runDeleteIncident = async (incident: IncidentEntry) => {
    if (!window.confirm(`Permanently delete this ${incident.severity} incident record? This cannot be undone.`)) return;
    await deleteIncident.mutateAsync({ id: incident.id });
    if (expanded === incident.id) setExpanded(null);
    await refreshIncidentData();
  };

  // Manual delete of every retained incident, so crash residue can be cleared by hand.
  const runClearIncidents = async () => {
    if (!window.confirm("Permanently delete every retained incident record? This cannot be undone.")) return;
    await clearIncidents.mutateAsync({});
    setExpanded(null);
    await refreshIncidentData();
  };

  // Manual delete of one restart session's incidents (the crash that caused that boot).
  const runDeleteBoot = async (boot: IncidentBootSummary) => {
    if (!boot.bootId) return;
    if (!window.confirm("Permanently delete every incident recorded in this restart session? This cannot be undone.")) return;
    await clearIncidents.mutateAsync({ bootId: boot.bootId });
    await refreshIncidentData();
  };

  return (
    <div className="arb-page portal-page admin-diagnostics">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Diagnostics &amp; Health · Crash &amp; Incident diagnostics</div>
          <h1>Crash &amp; Incident Diagnostics</h1>
          <p>Every recorded crash and failure that led to a restart, pinned to the exact error, stack and context and kept for {report?.retentionDays ?? 90} days — so the cause is still visible after the application comes back.</p>
        </div>
        <div className="diag-header-actions">
          <button className="secondary-button" type="button" onClick={refreshAll} disabled={reportQuery.isFetching}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="secondary-button" type="button" onClick={() => void runPurge()} disabled={purge.isPending}>
            {purge.isPending ? <Loader2 size={14} className="diag-spin" /> : <Trash2 size={14} />} Clear expired
          </button>
          <button className="secondary-button diag-danger" type="button" onClick={() => void runClearIncidents()} disabled={clearIncidents.isPending}>
            {clearIncidents.isPending ? <Loader2 size={14} className="diag-spin" /> : <Trash2 size={14} />} Delete all incidents
          </button>
        </div>
      </header>

      {report && <MetricGrid metrics={metrics} />}

      {reportQuery.isError && <div className="admin-ops-empty error" role="alert">Incident history could not be read. {reportQuery.error.message}</div>}
      {report && !report.sourceAvailable && (
        <div className="admin-ops-empty error" role="alert">Incident storage is not available on this host yet. Records will appear once the incident log table is created.</div>
      )}

      {report?.sourceAvailable && (
        <section className="settings-card" aria-label="Current process boot">
          <div className="api-access-section-heading">
            <h2>This process</h2>
            <span className="admin-live-chip"><CheckCircle2 size={13} /> Running now</span>
          </div>
          <dl className="diag-kv">
            <div><dt>Boot id</dt><dd><code>{report.currentBootId}</code></dd></div>
            <div><dt>Started</dt><dd>{formatWhen(report.currentBootStartedAt)}</dd></div>
            <div><dt>Incidents in this boot</dt><dd>{report.incidents.filter((item) => item.isCurrentBoot).length}</dd></div>
          </dl>
          <p className="admin-ops-note" role="note"><Info size={14} /> Any incident below marked <strong>current boot</strong> happened since this process restarted; the rest explain an earlier restart.</p>
        </section>
      )}

      {report?.sourceAvailable && report.boots.length > 0 && (
        <section className="settings-card" aria-label="Restart sessions">
          <div className="api-access-section-heading"><h2>Restart sessions</h2></div>
          <div className="diag-boot-list">
            {report.boots.map((boot) => (
              <div className={boot.isCurrent ? "diag-boot-card is-current" : "diag-boot-card"} key={boot.bootId ?? "unattributed"}>
                <div className="diag-boot-head">
                  <code>{shortId(boot.bootId)}</code>
                  {boot.isCurrent ? <span className="diag-badge is-ok">Current boot</span> : <span className="diag-badge is-muted">Earlier boot</span>}
                </div>
                <div className="diag-boot-stats">
                  <span><strong>{boot.incidents}</strong> incidents</span>
                  <span><strong>{boot.fatal}</strong> fatal</span>
                  <span><strong>{boot.error}</strong> errors</span>
                </div>
                <small className="diag-boot-when">{formatWhen(boot.firstAt)} → {formatWhen(boot.lastAt)}</small>
                {boot.bootId && (
                  <button type="button" className="diag-incident-delete" onClick={() => void runDeleteBoot(boot)} disabled={clearIncidents.isPending}>
                    {clearIncidents.isPending ? <Loader2 size={11} className="diag-spin" /> : <Trash2 size={11} />} Delete session
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="settings-card" aria-label="Recorded incidents">
        <div className="api-access-section-heading">
          <h2>Recorded incidents</h2>
          <div className="form-two">
            <label>
              <span className="sr-only">Filter by severity</span>
              <select value={severity} onChange={(event) => setSeverity(event.target.value as IncidentSeverity | "")}>
                <option value="">All severities</option>
                <option value="fatal">Fatal</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as IncidentCategory | "")}>
                <option value="">All categories</option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {listQuery.isLoading && <div role="status">Loading incidents…</div>}
        {listQuery.isError && <div className="admin-ops-empty error" role="alert">Incidents could not be read. {listQuery.error.message}</div>}
        {(deleteIncident.isError || clearIncidents.isError) && (
          <div className="admin-ops-empty error" role="alert">The incident record could not be deleted. {(deleteIncident.error ?? clearIncidents.error)?.message}</div>
        )}
        {!listQuery.isLoading && !listQuery.isError && incidents.length === 0 && (
          <div className="empty-records">No recorded incidents match this filter. A healthy restart session records nothing here.</div>
        )}

        {incidents.length > 0 && (
          <ul className="diag-incident-list">
            {incidents.map((incident) => {
              const isOpen = expanded === incident.id;
              return (
                <li className={`diag-incident-card ${SEVERITY_TONES[incident.severity] ?? "is-muted"}`} key={incident.id}>
                  <button type="button" className="diag-incident-head" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : incident.id)}>
                    <span className={`diag-badge ${SEVERITY_TONES[incident.severity] ?? "is-muted"}`}>{incident.severity}</span>
                    <span className="diag-incident-title">{incident.message}</span>
                    <span className="diag-incident-when">{formatWhen(incident.occurredAt)}</span>
                  </button>
                  <div className="diag-incident-meta">
                    <span className="diag-chip">{CATEGORY_LABELS[incident.category as IncidentCategory] ?? incident.category}</span>
                    {incident.eventCode && <span className="diag-chip"><Zap size={11} /> {incident.eventCode}</span>}
                    <span className="diag-chip"><Server size={11} /> {incident.processRole}</span>
                    {incident.isCurrentBoot && <span className="diag-chip is-current">current boot</span>}
                    {incident.exitCode != null && <span className="diag-chip">exit {incident.exitCode}</span>}
                    {incident.signal && <span className="diag-chip">signal {incident.signal}</span>}
                  </div>
                  {isOpen && (
                    <div className="diag-incident-detail">
                      {incident.stack && (
                        <>
                          <h4>Stack trace</h4>
                          <pre className="diag-stack">{incident.stack}</pre>
                        </>
                      )}
                      {incident.context && (
                        <>
                          <h4>Context</h4>
                          <pre className="diag-stack">{JSON.stringify(incident.context, null, 2)}</pre>
                        </>
                      )}
                      <h4>Attribution</h4>
                      <dl className="diag-kv">
                        <div><dt>Boot</dt><dd><code>{shortId(incident.bootId)}</code></dd></div>
                        <div><dt>Instance</dt><dd>{incident.instanceId ?? "—"}</dd></div>
                        <div><dt>App version</dt><dd>{incident.appVersion ?? "—"}</dd></div>
                        <div><dt>Source revision</dt><dd>{incident.sourceRevision ?? "—"}</dd></div>
                      </dl>
                    </div>
                  )}
                  <div className="diag-incident-actions">
                    <button className="diag-incident-delete" type="button" onClick={() => void runDeleteIncident(incident)} disabled={deleteIncident.isPending}>
                      {deleteIncident.isPending ? <Loader2 size={12} className="diag-spin" /> : <Trash2 size={12} />} Delete report
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="admin-policy-note" role="note"><Trash2 size={14} /> Incidents are retained for {report?.retentionDays ?? 90} days and then cleared automatically. Use <strong>Delete report</strong> to remove one crash record by hand, or <strong>Delete all incidents</strong> to clear the whole history.</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resource & Improvement                                              */
/* ------------------------------------------------------------------ */

const TIER_META: Record<ImprovementTier, { label: string; icon: typeof Activity; hint: string }> = {
  critical: { label: "Critical improvements", icon: AlertOctagon, hint: "Fix first — these threaten availability" },
  major: { label: "Major improvements", icon: AlertTriangle, hint: "Fix soon — degraded or high usage" },
  minor: { label: "Minor improvements", icon: Info, hint: "Keep an eye on — no action needed yet" },
};

export function AdminResourceHealth() {
  const query = trpc.adminOperations.resourceReport.useQuery(undefined, { refetchOnWindowFocus: true });
  const report = query.data as ResourceReport | undefined;
  const improvements = report?.improvements ?? [];
  const memory = report?.memory;
  // Heap pressure is shown against the configured heap limit (not the committed
  // heap), and only the container/RSS ratio can make the tile critical — a high
  // committed-heap ratio on its own is not a fatal signal.
  const heapPressurePercent = memory?.heapLimitUsePercent ?? memory?.heapUsePercent ?? 0;
  const heapTone = (memory?.limitUsePercent ?? 0) >= 85 ? "is-critical" : heapPressurePercent >= 90 || (memory?.limitUsePercent ?? 0) >= 70 ? "is-major" : undefined;

  const metrics = [
    { key: "rss", label: "Resident memory", value: formatBytes(report?.memory.rssBytes), hint: report?.memory.limitBytes ? `Limit ${formatBytes(report.memory.limitBytes)}` : "No container limit detected", icon: Cpu },
    { key: "heap", label: "Heap used", value: `${heapPressurePercent}%`, hint: memory?.heapLimitBytes ? `of ${formatBytes(memory.heapLimitBytes)} heap limit` : `${formatBytes(memory?.heapUsedBytes)} of ${formatBytes(memory?.heapTotalBytes)} committed`, icon: Activity, tone: heapTone },
    { key: "disk", label: "Disk used", value: report?.disk ? `${report.disk.usedPercent}%` : "n/a", hint: report?.disk ? `${formatBytes(report.disk.freeBytes)} free on ${report.disk.target}` : "Disk usage unavailable on this host", icon: HardDrive, tone: report?.disk && report.disk.usedPercent >= 90 ? "is-critical" : undefined },
    { key: "improvements", label: "Improvements", value: report?.improvementSummary.total ?? 0, hint: `${report?.improvementSummary.critical ?? 0} critical · ${report?.improvementSummary.major ?? 0} major · ${report?.improvementSummary.minor ?? 0} minor`, icon: Zap },
  ];

  return (
    <div className="arb-page portal-page admin-diagnostics">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Diagnostics &amp; Health · Resource &amp; improvement</div>
          <h1>Resource &amp; Improvement</h1>
          <p>What is eating memory and disk right now, and a single prioritised list of what needs critical, major or minor improvement — derived from live usage, recorded incidents, outbound API health and background-worker health.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {report && <MetricGrid metrics={metrics} />}
      {query.isError && <div className="admin-ops-empty error" role="alert">Resource usage could not be read. {query.error.message}</div>}
      {query.isLoading && <div role="status">Loading resource usage…</div>}

      {report && (
        <>
          <section className="settings-card" aria-label="Memory usage">
            <div className="api-access-section-heading"><h2>Memory &amp; process</h2></div>
            <div className="diag-bars">
              <DiagBar label={report.memory.heapLimitBytes ? `Heap used — ${heapPressurePercent}% of ${formatBytes(report.memory.heapLimitBytes)} configured limit` : `Heap used — ${report.memory.heapUsePercent}% of ${formatBytes(report.memory.heapTotalBytes)} committed`} percent={heapPressurePercent} />
              {report.memory.limitUsePercent != null && (
                <DiagBar label={`Resident memory — ${report.memory.limitUsePercent}% of ${formatBytes(report.memory.limitBytes)} limit`} percent={report.memory.limitUsePercent} />
              )}
            </div>
            <dl className="diag-kv">
              <div><dt>Resident (RSS)</dt><dd>{formatBytes(report.memory.rssBytes)}</dd></div>
              <div><dt>Heap used</dt><dd>{formatBytes(report.memory.heapUsedBytes)}</dd></div>
              <div><dt>Heap limit (V8)</dt><dd>{report.memory.heapLimitBytes ? formatBytes(report.memory.heapLimitBytes) : "not detected"}</dd></div>
              <div><dt>Heap total</dt><dd>{formatBytes(report.memory.heapTotalBytes)}</dd></div>
              <div><dt>External</dt><dd>{formatBytes(report.memory.externalBytes)}</dd></div>
              <div><dt>Array buffers</dt><dd>{formatBytes(report.memory.arrayBuffersBytes)}</dd></div>
              <div><dt>Container limit</dt><dd>{report.memory.limitBytes ? formatBytes(report.memory.limitBytes) : "not detected"}</dd></div>
              <div><dt>Available memory</dt><dd>{report.memory.availableBytes ? formatBytes(report.memory.availableBytes) : "not reported"}</dd></div>
            </dl>
          </section>

          {report.database && (
            <section className="settings-card" aria-label="Database connections">
              <div className="api-access-section-heading"><h2>Database &amp; connections</h2></div>
              {report.database.connected ? (
                <dl className="diag-kv">
                  <div><dt>Pool limit</dt><dd>{report.database.connectionLimit ?? "not set"}</dd></div>
                  <div><dt>Active</dt><dd>{report.database.activeConnections ?? "n/a"}</dd></div>
                  <div><dt>Idle</dt><dd>{report.database.idleConnections ?? "n/a"}</dd></div>
                  <div><dt>Queued</dt><dd>{report.database.queuedRequests ?? "n/a"}</dd></div>
                </dl>
              ) : (
                <div className="empty-records">The pooled database client is not configured on this process.</div>
              )}
            </section>
          )}

          <section className="settings-card" aria-label="Disk usage">
            <div className="api-access-section-heading"><h2>Disk &amp; volume</h2></div>
            {report.disk ? (
              <>
                <div className="diag-bars">
                  <DiagBar label={`${report.disk.target} — ${report.disk.usedPercent}% used`} percent={report.disk.usedPercent} />
                </div>
                <dl className="diag-kv">
                  <div><dt>Volume</dt><dd><code>{report.disk.target}</code></dd></div>
                  <div><dt>Total</dt><dd>{formatBytes(report.disk.totalBytes)}</dd></div>
                  <div><dt>Used</dt><dd>{formatBytes(report.disk.usedBytes)}</dd></div>
                  <div><dt>Free</dt><dd>{formatBytes(report.disk.freeBytes)}</dd></div>
                </dl>
              </>
            ) : (
              <div className="empty-records">Disk usage is unavailable on this host.</div>
            )}
          </section>

          <section className="settings-card" aria-label="Improvements">
            <div className="api-access-section-heading">
              <h2>Improvements</h2>
              <span className="admin-live-chip"><Zap size={13} /> {improvements.length} {improvements.length === 1 ? "item" : "items"}</span>
            </div>
            {improvements.length === 0 && <div className="empty-records">No improvements are outstanding. Memory, disk, APIs, workers and incidents are all within their comfort bands.</div>}
            {(["critical", "major", "minor"] as ImprovementTier[]).map((tier) => {
              const items = improvements.filter((item) => item.tier === tier);
              if (items.length === 0) return null;
              const meta = TIER_META[tier];
              return (
                <div className={`diag-tier is-${tier}`} key={tier}>
                  <div className="diag-tier-head">
                    <span className={`diag-badge is-${tier}`}><meta.icon size={12} /> {meta.label}</span>
                    <small>{meta.hint}</small>
                  </div>
                  <ul className="diag-improvement-list">
                    {items.map((item, index) => (
                      <li className="diag-improvement" key={`${tier}-${index}`}>
                        <div className="diag-improvement-head">
                          <span className="diag-chip">{item.area}</span>
                          <strong>{item.title}</strong>
                        </div>
                        <p>{item.detail}</p>
                        <p className="diag-recommendation"><Zap size={12} /> {item.recommendation}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {report.notes.length > 0 && (
              <ul className="diag-notes">
                {report.notes.map((note, index) => <li key={index}><Info size={12} /> {note}</li>)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function DiagBar({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = clamped >= 90 ? "is-critical" : clamped >= 75 ? "is-major" : clamped >= 60 ? "is-minor" : "is-ok";
  return (
    <div className="diag-bar-row">
      <div className="diag-bar-track" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className={`diag-bar-fill ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="diag-bar-label">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* API Health & Providers                                              */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<ApiProbeStatus, { label: string; tone: string }> = {
  ok: { label: "Working", tone: "is-ok" },
  degraded: { label: "Degraded", tone: "is-major" },
  fail: { label: "Not working", tone: "is-critical" },
  not_configured: { label: "Not configured", tone: "is-muted" },
  not_tested: { label: "Not tested", tone: "is-info" },
  stale: { label: "Stale result", tone: "is-minor" },
};

const RESOURCE_META: Record<ApiResourceClass, { label: string; tone: string }> = {
  low: { label: "Low resource", tone: "is-ok" },
  moderate: { label: "Moderate resource", tone: "is-minor" },
  high: { label: "High resource", tone: "is-major" },
};

export function AdminApiHealth() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.apiHealth.useQuery(undefined, { refetchOnWindowFocus: true });
  const probe = trpc.adminOperations.probeApiProvider.useMutation();
  const [probeNotes, setProbeNotes] = useState<Record<string, string>>({});

  const report = query.data as ApiHealthReport | undefined;
  const providers = report?.providers ?? [];

  const metrics = [
    { key: "total", label: "Providers", value: report?.summary.total ?? 0, hint: "Outbound services the platform calls", icon: PlugZap },
    { key: "working", label: "Working", value: report?.summary.working ?? 0, hint: "Last result was healthy", icon: CheckCircle2, tone: "is-ok" },
    { key: "failing", label: "Failing", value: report?.summary.failing ?? 0, hint: `${report?.summary.notConfigured ?? 0} not configured`, icon: XCircle, tone: report?.summary.failing ? "is-critical" : undefined },
    { key: "resource", label: "High resource", value: report?.summary.highResource ?? 0, hint: "Latency or payload over threshold", icon: Activity, tone: report?.summary.highResource ? "is-major" : undefined },
  ];

  const runProbe = async (providerId: string) => {
    try {
      const outcome = await probe.mutateAsync({ providerId });
      const note = outcome.ran
        ? `Probe ran: ${outcome.result?.status ?? "unknown"}${outcome.result?.latencyMs != null ? ` in ${outcome.result.latencyMs} ms` : ""}.`
        : outcome.reason ?? "Probe did not run.";
      setProbeNotes((current) => ({ ...current, [providerId]: note }));
      await utils.adminOperations.apiHealth.invalidate();
    } catch (error) {
      setProbeNotes((current) => ({ ...current, [providerId]: error instanceof Error ? error.message : "Probe failed." }));
    }
  };

  return (
    <div className="arb-page portal-page admin-diagnostics">
      <header className="portal-page-top">
        <div>
          <div className="eyebrow">Diagnostics &amp; Health · API health &amp; providers</div>
          <h1>API Health &amp; Providers</h1>
          <p>Every outbound service the platform calls, whether it is working, and how much resource it pulls. Status is passive by default; run <strong>Test now</strong> to send one real probe and measure latency and payload size.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {report && <MetricGrid metrics={metrics} />}
      {query.isError && <div className="admin-ops-empty error" role="alert">API health could not be read. {query.error.message}</div>}
      {report && !report.sourceAvailable && (
        <div className="admin-ops-empty error" role="alert">API health storage is not available on this host yet. Live status is shown from provider configuration; probe results will persist once the table is created.</div>
      )}
      {query.isLoading && <div role="status">Loading API health…</div>}

      {report && report.recommendations.length > 0 && (
        <section className="settings-card" aria-label="Recommendations">
          <div className="api-access-section-heading"><h2>What to fix</h2></div>
          <ul className="diag-notes">
            {report.recommendations.map((item, index) => <li key={index}><Zap size={12} /> {item}</li>)}
          </ul>
        </section>
      )}

      <section className="settings-card" aria-label="Providers">
        <div className="api-access-section-heading">
          <h2>Providers</h2>
          <span className="admin-live-chip"><PlugZap size={13} /> {providers.length} providers</span>
        </div>

        {providers.length === 0 && !query.isLoading && <div className="empty-records">No providers are registered.</div>}

        <div className="diag-provider-list">
          {providers.map((provider) => {
            const status = STATUS_META[provider.passiveStatus];
            const resource = provider.resourceClass ? RESOURCE_META[provider.resourceClass] : null;
            return (
              <article className="diag-provider" key={provider.id}>
                <div className="diag-provider-head">
                  <div>
                    <h3>{provider.label}</h3>
                    <small>{provider.category} · {provider.kind} · {provider.probeMode === "none" ? "config check" : `${provider.probeMode} probe`}</small>
                  </div>
                  <span className={`diag-badge ${status.tone}`}>{status.label}</span>
                </div>

                <div className="diag-provider-meta">
                  <span className="diag-chip">configured: {provider.configured ? "yes" : "no"}</span>
                  {provider.statusCode != null && <span className="diag-chip">HTTP {provider.statusCode}</span>}
                  {provider.latencyMs != null && <span className="diag-chip">{provider.latencyMs} ms</span>}
                  {provider.responseBytes != null && <span className="diag-chip">{formatBytes(provider.responseBytes)}</span>}
                  {resource && <span className={`diag-chip ${resource.tone}`}>{resource.label}</span>}
                  <span className="diag-chip">last: {formatWhen(provider.lastCheckedAt)}</span>
                  {provider.errorCode && <span className="diag-chip is-major">{provider.errorCode}</span>}
                </div>

                {provider.endpoint && <p className="diag-provider-endpoint"><code>{provider.endpoint}</code></p>}
                <p className="diag-provider-note">{provider.note}</p>
                <p className="diag-recommendation"><Zap size={12} /> {provider.recommendation}</p>

                {provider.errorMessage && <p className="diag-provider-error"><AlertTriangle size={12} /> {provider.errorMessage}</p>}

                <div className="diag-provider-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void runProbe(provider.id)}
                    disabled={!provider.probeSupported || probe.isPending}
                    title={provider.probeSupported ? "Run one real probe now" : "This provider cannot be probed (not configured or credentials-only)"}
                  >
                    {probe.isPending && probe.variables?.providerId === provider.id ? <Loader2 size={13} className="diag-spin" /> : <Play size={13} />} Test now
                  </button>
                  {probeNotes[provider.id] && <small className="diag-probe-note">{probeNotes[provider.id]}</small>}
                </div>
              </article>
            );
          })}
        </div>

        <p className="admin-policy-note" role="note"><Info size={14} /> Passive status never makes an outbound call. "Test now" sends a single real request, is rate-limited, and never sends stored credentials.</p>
      </section>
    </div>
  );
}
