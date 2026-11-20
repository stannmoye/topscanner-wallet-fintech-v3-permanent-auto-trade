import { useMemo, useState } from "react";
import { Activity, Ban, Fingerprint, RotateCcw, Search, ShieldAlert, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";

type BlockedDevice = {
  id: number;
  userId: number;
  deviceKey: string;
  deviceName: string;
  deviceType: string;
  platform: string | null;
  browser: string | null;
  lastIpAddress: string | null;
  countryCode: string | null;
  status: string;
  blockedBy: "customer" | "admin" | null;
  blockedReason: string | null;
  blockedAt: Date | string | null;
  lastSeenAt: Date | string | null;
  loginCount: number;
  customerName: string | null;
  customerEmail: string | null;
};

type DeviceRecord = Omit<BlockedDevice, "customerName" | "customerEmail"> & { customerName?: string | null; customerEmail?: string | null };

const EVENT_HINT: Record<string, string> = {
  customer: "Blocked by the customer from their Trusted Devices page.",
  admin: "Blocked by an administrator.",
};

function shortKey(deviceKey: string) {
  return deviceKey.slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join("-") ?? deviceKey;
}

function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function AdminDeviceOversight() {
  const summary = trpc.adminOperations.deviceOversightSummary.useQuery(undefined, { refetchInterval: 15_000 });
  const blockedQuery = trpc.adminOperations.blockedDevices.useQuery(undefined, { refetchInterval: 15_000 });
  const allDevicesQuery = trpc.adminOperations.devices.useQuery({ limit: 200 }, { refetchInterval: 30_000 });
  const restore = trpc.adminOperations.restoreDevice.useMutation({
    onSuccess: async () => {
      setRestoreId(null);
      setRestoreNote("");
      await Promise.all([blockedQuery.refetch(), allDevicesQuery.refetch(), summary.refetch()]);
    },
  });

  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [restoreNote, setRestoreNote] = useState("");
  const [search, setSearch] = useState("");

  const blocked = (blockedQuery.data ?? []) as unknown as BlockedDevice[];
  const allDevices = (allDevicesQuery.data ?? []) as unknown as DeviceRecord[];

  const groupedByCustomer = useMemo(() => {
    const map = new Map<number, { name: string; email: string | null; devices: BlockedDevice[] }>();
    for (const device of blocked) {
      const entry = map.get(device.userId) ?? { name: device.customerName ?? `Account ${device.userId}`, email: device.customerEmail, devices: [] };
      entry.devices.push(device);
      map.set(device.userId, entry);
    }
    return Array.from(map.entries()).map(([userId, value]) => ({ userId, ...value }));
  }, [blocked]);

  const filteredDevices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allDevices;
    return allDevices.filter((device) =>
      [device.deviceName, device.customerName, device.customerEmail, device.platform, device.browser, device.lastIpAddress, device.deviceKey]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [allDevices, search]);

  const summaryData = summary.data ?? { total: 0, blocked: 0, pending: 0, trusted: 0, customersWithBlockedDevices: 0 };

  return (
    <div className="admin-ops-page arb-page">
      <header className="admin-ops-head">
        <div className="admin-ops-heading">
          <span className="admin-ops-kicker"><Fingerprint size={14} /> Security &amp; access</span>
          <h1>Device oversight</h1>
          <p>Every device registered against a customer workspace, with the devices each customer has blocked and a single-action restore for the ones they ask about.</p>
        </div>
      </header>

      <section className="admin-ops-metrics compact-metrics">
        <article className="admin-ops-metric"><span className="admin-ops-metric-icon"><Fingerprint size={17} /></span><span className="admin-ops-metric-label">Registered devices</span><strong>{summaryData.total}</strong><small>Across all customers</small></article>
        <article className="admin-ops-metric"><span className="admin-ops-metric-icon"><ShieldCheck size={17} /></span><span className="admin-ops-metric-label">Trusted</span><strong>{summaryData.trusted}</strong><small>Healthy devices</small></article>
        <article className="admin-ops-metric"><span className="admin-ops-metric-icon"><Ban size={17} /></span><span className="admin-ops-metric-label">Blocked</span><strong>{summaryData.blocked}</strong><small>Sign-ins refused</small></article>
        <article className="admin-ops-metric"><span className="admin-ops-metric-icon"><ShieldAlert size={17} /></span><span className="admin-ops-metric-label">Customers with blocks</span><strong>{summaryData.customersWithBlockedDevices}</strong><small>Awaiting review</small></article>
      </section>

      <section className="admin-ops-panel">
        <div className="admin-ops-panel-head">
          <div><span className="admin-ops-kicker">Customer-reported access</span><h2>Blocked devices by customer</h2></div>
          <span className="admin-ops-subtle">{blocked.length} blocked</span>
        </div>
        {blockedQuery.isLoading ? <div className="admin-ops-empty">Loading blocked devices…</div> : blockedQuery.isError ? <div className="admin-ops-empty error">Blocked devices could not be loaded.</div> : groupedByCustomer.length ? (
          groupedByCustomer.map((group) => (
            <div className="device-oversight-group" key={group.userId}>
              <div className="device-oversight-group-head">
                <span className="device-oversight-avatar"><UserRound size={15} /></span>
                <div><strong>{group.name}</strong><small>{group.email || `Account ${group.userId}`} · {group.devices.length} blocked device{group.devices.length === 1 ? "" : "s"}</small></div>
              </div>
              <div className="admin-ops-table-wrap" role="region" aria-label={`Blocked devices for ${group.name}`}>
                <table className="admin-ops-table device-oversight-table">
                  <thead><tr><th>Device</th><th>Type</th><th>Identifiers</th><th>Blocked</th><th>Reason</th><th className="admin-ops-col-action">Action</th></tr></thead>
                  <tbody>
                    {group.devices.map((device) => (
                      <tr key={device.id}>
                        <td><strong>{device.deviceName}</strong><small>Last seen {formatWhen(device.lastSeenAt)} · {device.loginCount} sign-in{device.loginCount === 1 ? "" : "s"}</small></td>
                        <td><span className="admin-ops-status neutral"><Smartphone size={12} /> {device.deviceType}</span><small>{device.browser || "Browser"}{device.platform ? ` · ${device.platform}` : ""}</small></td>
                        <td><small>ID {shortKey(device.deviceKey)}</small><small>{device.lastIpAddress || "Unknown IP"}{device.countryCode ? ` · ${device.countryCode}` : ""}</small></td>
                        <td><small>{formatWhen(device.blockedAt)}</small><small>{device.blockedBy ? `by ${device.blockedBy}` : "unknown source"}</small></td>
                        <td><small>{device.blockedReason || EVENT_HINT[device.blockedBy ?? ""] || "—"}</small></td>
                        <td className="admin-ops-col-action">
                          {restoreId === device.id ? (
                            <form className="device-oversight-restore" onSubmit={(event) => { event.preventDefault(); restore.mutate({ id: device.id, note: restoreNote.trim() || undefined }); }}>
                              <input value={restoreNote} maxLength={500} placeholder="Optional restore note" onChange={(event) => setRestoreNote(event.target.value)} />
                              <div className="device-oversight-restore-actions">
                                <button className="primary-button" type="submit" disabled={restore.isPending}>{restore.isPending ? "Restoring…" : "Confirm restore"}</button>
                                <button className="secondary-button" type="button" onClick={() => { setRestoreId(null); setRestoreNote(""); }}>Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <button className="secondary-button" type="button" onClick={() => { setRestoreId(device.id); setRestoreNote(""); }}>
                              <RotateCcw size={13} /> Restore
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : <div className="admin-ops-empty">No customer has blocked a device.</div>}
      </section>

      <section className="admin-ops-panel">
        <div className="admin-ops-panel-head">
          <div><span className="admin-ops-kicker">Full registry</span><h2>All registered devices</h2></div>
          <label className="device-oversight-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search device, customer, IP or ID" aria-label="Search registered devices" /></label>
        </div>
        <div className="admin-ops-table-wrap" role="region" tabIndex={0} aria-label="All registered devices">
          <table className="admin-ops-table device-oversight-table">
            <thead><tr><th>Customer</th><th>Device</th><th>Type</th><th>Identifiers</th><th>Status</th><th>Last seen</th></tr></thead>
            <tbody>
              {filteredDevices.map((device) => (
                <tr key={device.id}>
                  <td><strong>{device.customerName || `Account ${device.userId}`}</strong><small>{device.customerEmail || ""}</small></td>
                  <td><strong>{device.deviceName}</strong><small>{device.loginCount} sign-in{device.loginCount === 1 ? "" : "s"}</small></td>
                  <td><span className="admin-ops-status neutral"><Activity size={12} /> {device.deviceType}</span><small>{device.browser || "Browser"}{device.platform ? ` · ${device.platform}` : ""}</small></td>
                  <td><small>ID {shortKey(device.deviceKey)}</small><small>{device.lastIpAddress || "Unknown IP"}{device.countryCode ? ` · ${device.countryCode}` : ""}</small></td>
                  <td><span className={`admin-ops-status ${device.status === "blocked" ? "high" : device.status === "pending" ? "watch" : "good"}`}>{device.status}</span></td>
                  <td><small>{formatWhen(device.lastSeenAt)}</small></td>
                </tr>
              ))}
              {!filteredDevices.length && <tr><td colSpan={6} className="admin-ops-table-empty">No registered devices match this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-ops-note">
        <ShieldCheck size={16} />
        <span><strong>Restore is deliberate.</strong> Restoring a device re-enables sign-in for that exact device ID only. Every block and restore is written to the device audit trail — sessions rejected while a device is blocked cannot be resumed.</span>
      </div>
    </div>
  );
}
