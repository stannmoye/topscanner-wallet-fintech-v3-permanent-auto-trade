import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  Clock,
  Fingerprint,
  History,
  Laptop,
  LifeBuoy,
  MapPin,
  Monitor,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tablet,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

type DeviceRow = {
  id: number;
  deviceName: string;
  deviceType: string;
  platform: string | null;
  browser: string | null;
  deviceIdShort: string;
  status: "trusted" | "pending" | "blocked";
  isCurrent: boolean;
  blockedBy: "customer" | "admin" | null;
  blockedReason: string | null;
  blockedAt: Date | string | null;
  lastIpAddress: string | null;
  countryCode: string | null;
  loginCount: number;
  firstSeenAt: Date | string | null;
  lastSeenAt: Date | string | null;
};

type DeviceEvent = {
  id: number;
  deviceName: string | null;
  action: string;
  actorRole: string;
  detail: string | null;
  ipAddress: string | null;
  createdAt: Date | string | null;
};

function deviceIcon(type: string) {
  if (type === "mobile") return Smartphone;
  if (type === "tablet") return Tablet;
  if (type === "desktop") return Monitor;
  return Laptop;
}

function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

const EVENT_LABELS: Record<string, string> = {
  login: "Signed in",
  login_blocked: "Blocked sign-in attempt",
  device_first_seen: "New device signed in",
  blocked: "Device blocked",
  restored: "Device restored",
  renamed: "Device renamed",
  unblock_requested: "Restore requested",
};

export function CustomerTrustedDevicesPanel({ push }: { push?: (message: string) => void }) {
  const devicesQuery = trpc.customer.trustedDevices.useQuery(undefined, { refetchInterval: 20_000 });
  const eventsQuery = trpc.customer.deviceAccessEvents.useQuery(undefined, { refetchInterval: 30_000 });

  const rename = trpc.customer.renameTrustedDevice.useMutation({
    onSuccess: async () => {
      setRenamingId(null);
      setMessage("Device name updated.");
      await devicesQuery.refetch();
      push?.("Device renamed");
    },
    onError: (error) => setMessage(error.message),
  });
  const block = trpc.customer.blockTrustedDevice.useMutation({
    onSuccess: async () => {
      setBlockingId(null);
      setBlockReason("");
      setMessage("Device blocked and signed out. It cannot sign in again until an administrator restores it.");
      await Promise.all([devicesQuery.refetch(), eventsQuery.refetch()]);
      push?.("Device blocked");
    },
    onError: (error) => setMessage(error.message),
  });
  const requestRestore = trpc.customer.requestDeviceUnblock.useMutation({
    onSuccess: async (created: { ticketNumber?: string }) => {
      setRestoreId(null);
      setRestoreReason("");
      setMessage(`Restore request sent. Support ticket ${created?.ticketNumber ? `#${created.ticketNumber}` : ""} was opened for an administrator to review.`);
      await eventsQuery.refetch();
      push?.("Restore request sent to support");
    },
    onError: (error) => setMessage(error.message),
  });

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [blockingId, setBlockingId] = useState<number | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [message, setMessage] = useState("");

  const devices = (devicesQuery.data?.devices ?? []) as unknown as DeviceRow[];
  const summary = devicesQuery.data?.summary ?? { total: 0, trusted: 0, blocked: 0, pending: 0 };
  const events = (eventsQuery.data ?? []) as unknown as DeviceEvent[];
  const blockedDevices = devices.filter((device) => device.status === "blocked");
  const activeDevices = devices.filter((device) => device.status !== "blocked");

  const beginRename = (device: DeviceRow) => {
    setMessage("");
    setRenamingId(device.id);
    setRenameValue(device.deviceName);
  };
  const beginBlock = (device: DeviceRow) => {
    setMessage("");
    setRenamingId(null);
    setRestoreId(null);
    setBlockingId(device.id);
    setBlockReason("");
  };
  const beginRestore = (device: DeviceRow) => {
    setMessage("");
    setBlockingId(null);
    setRestoreId(device.id);
    setRestoreReason("");
  };

  return (
    <div className="trusted-devices-panel">
      <section className="trusted-devices-metrics" aria-label="Device access summary">
        <article className="trusted-device-metric">
          <span className="trusted-device-metric-icon"><Fingerprint size={17} /></span>
          <span className="trusted-device-metric-label">Known devices</span>
          <strong>{summary.total}</strong>
          <small>Distinct devices seen on this account</small>
        </article>
        <article className="trusted-device-metric">
          <span className="trusted-device-metric-icon"><ShieldCheck size={17} /></span>
          <span className="trusted-device-metric-label">Trusted</span>
          <strong>{summary.trusted}</strong>
          <small>Devices currently able to sign in</small>
        </article>
        <article className="trusted-device-metric trusted-device-metric-danger">
          <span className="trusted-device-metric-icon"><Ban size={17} /></span>
          <span className="trusted-device-metric-label">Blocked</span>
          <strong>{summary.blocked}</strong>
          <small>Sign-ins refused until an admin restores access</small>
        </article>
        <article className="trusted-device-metric">
          <span className="trusted-device-metric-icon"><ShieldAlert size={17} /></span>
          <span className="trusted-device-metric-label">This device</span>
          <strong>{devices.find((device) => device.isCurrent)?.deviceName ?? "Recognised"}</strong>
          <small>You are signed in from here now</small>
        </article>
      </section>

      <section className="settings-card trusted-device-registry">
        <div className="customer-panel-head">
          <div>
            <span className="eyebrow">Live access registry</span>
            <h2>Trusted devices</h2>
          </div>
          <button className="secondary-button" type="button" disabled={devicesQuery.isFetching} onClick={() => { void Promise.all([devicesQuery.refetch(), eventsQuery.refetch()]); }}>
            {devicesQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="settings-copy">
          Every browser and device that has signed in to your workspace is listed with the exact name, type and a
          device ID derived from that device. Block a device you do not recognise to sign it out immediately and stop it
          from signing in again.
        </p>

        {devicesQuery.isLoading && <div className="empty-state">Loading trusted devices…</div>}
        {devicesQuery.isError && <div className="empty-state" role="alert">Trusted devices could not be loaded. Refresh and try again.</div>}

        {!devicesQuery.isLoading && !devicesQuery.isError && (
          <div className="trusted-device-list">
            {activeDevices.map((device) => {
              const Icon = deviceIcon(device.deviceType);
              return (
                <article className={`trusted-device-row${device.isCurrent ? " is-current" : ""}`} key={device.id}>
                  <span className="trusted-device-icon"><Icon size={18} /></span>
                  <div className="trusted-device-body">
                    <div className="trusted-device-title">
                      {renamingId === device.id ? (
                        <form
                          className="trusted-device-rename"
                          onSubmit={(event) => { event.preventDefault(); if (renameValue.trim()) rename.mutate({ id: device.id, deviceName: renameValue.trim() }); }}
                        >
                          <input value={renameValue} maxLength={120} autoFocus onChange={(event) => setRenameValue(event.target.value)} aria-label="Device name" />
                          <button className="primary-button" type="submit" disabled={!renameValue.trim() || rename.isPending}>{rename.isPending ? "Saving…" : "Save"}</button>
                          <button className="secondary-button" type="button" onClick={() => setRenamingId(null)}>Cancel</button>
                        </form>
                      ) : (
                        <>
                          <strong>{device.deviceName}</strong>
                          {device.isCurrent && <span className="trusted-device-badge current">This device</span>}
                          <span className="trusted-device-badge trusted"><CheckCircle2 size={12} /> Trusted</span>
                        </>
                      )}
                    </div>
                    <div className="trusted-device-meta">
                      <span><Smartphone size={12} /> {device.deviceType}</span>
                      <span>{device.browser || "Browser"}{device.platform ? ` · ${device.platform}` : ""}</span>
                      <span><Fingerprint size={12} /> {device.deviceIdShort}</span>
                      <span><MapPin size={12} /> {device.lastIpAddress || "Unknown IP"}{device.countryCode ? ` · ${device.countryCode}` : ""}</span>
                      <span><Clock size={12} /> Last seen {formatWhen(device.lastSeenAt)}</span>
                      <span>First seen {formatWhen(device.firstSeenAt)}</span>
                      <span>{device.loginCount} sign-in{device.loginCount === 1 ? "" : "s"}</span>
                    </div>

                    {blockingId === device.id ? (
                      <form className="trusted-device-block-form" onSubmit={(event) => { event.preventDefault(); if (blockReason.trim().length >= 3) block.mutate({ id: device.id, reason: blockReason.trim() }); }}>
                        <label>
                          Why are you blocking this device?
                          <input value={blockReason} maxLength={255} placeholder="e.g. I don't recognise this device" onChange={(event) => setBlockReason(event.target.value)} />
                        </label>
                        <div className="trusted-device-form-actions">
                          <button className="primary-button danger" type="submit" disabled={blockReason.trim().length < 3 || block.isPending}>{block.isPending ? "Blocking…" : "Block and sign out"}</button>
                          <button className="secondary-button" type="button" onClick={() => { setBlockingId(null); setBlockReason(""); }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div className="trusted-device-actions">
                        <button className="secondary-button" type="button" onClick={() => beginRename(device)}><Pencil size={13} /> Rename</button>
                        <button className="secondary-button danger" type="button" onClick={() => beginBlock(device)}><Ban size={13} /> Block device</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {!activeDevices.length && <div className="empty-state">No active devices are recorded for this account.</div>}
          </div>
        )}

        {blockedDevices.length > 0 && (
          <div className="trusted-device-blocked">
            <h3><Ban size={16} /> Blocked devices</h3>
            <p>These devices cannot sign in. If you blocked one by mistake, request an administrator to restore it. The request opens a security ticket that administrators can review.</p>
            {blockedDevices.map((device) => {
              const Icon = deviceIcon(device.deviceType);
              return (
                <article className="trusted-device-row blocked" key={device.id}>
                  <span className="trusted-device-icon"><Icon size={18} /></span>
                  <div className="trusted-device-body">
                    <div className="trusted-device-title">
                      <strong>{device.deviceName}</strong>
                      <span className="trusted-device-badge blocked"><Ban size={12} /> Blocked</span>
                      {device.blockedBy && <span className="trusted-device-badge neutral">by {device.blockedBy}</span>}
                    </div>
                    <div className="trusted-device-meta">
                      <span><Fingerprint size={12} /> {device.deviceIdShort}</span>
                      <span>{device.browser || "Browser"}{device.platform ? ` · ${device.platform}` : ""}</span>
                      <span><MapPin size={12} /> {device.lastIpAddress || "Unknown IP"}</span>
                      <span>Blocked {formatWhen(device.blockedAt)}</span>
                      {device.blockedReason && <span>Reason: {device.blockedReason}</span>}
                    </div>
                    {restoreId === device.id ? (
                      <form className="trusted-device-block-form" onSubmit={(event) => { event.preventDefault(); if (restoreReason.trim().length >= 10) requestRestore.mutate({ deviceId: device.id, reason: restoreReason.trim() }); }}>
                        <label>
                          Explain to the administrator why this device should be restored
                          <textarea rows={3} maxLength={1000} value={restoreReason} placeholder="Describe why this device is trusted and should be allowed to sign in again." onChange={(event) => setRestoreReason(event.target.value)} />
                        </label>
                        <div className="trusted-device-form-actions">
                          <button className="primary-button" type="submit" disabled={restoreReason.trim().length < 10 || requestRestore.isPending}>{requestRestore.isPending ? "Sending…" : "Send restore request"}</button>
                          <button className="secondary-button" type="button" onClick={() => { setRestoreId(null); setRestoreReason(""); }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div className="trusted-device-actions">
                        <button className="secondary-button" type="button" onClick={() => beginRestore(device)}><LifeBuoy size={13} /> Request administrator restore</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="settings-card trusted-device-activity">
        <div className="customer-panel-head">
          <div>
            <span className="eyebrow">Audit trail</span>
            <h2><History size={16} /> Device activity</h2>
          </div>
          <span className="trusted-device-badge neutral">{events.length} recent event{events.length === 1 ? "" : "s"}</span>
        </div>
        {eventsQuery.isLoading && <div className="empty-state">Loading device activity…</div>}
        {!eventsQuery.isLoading && (
          <ul className="trusted-device-timeline">
            {events.map((event) => (
              <li key={event.id} className={`timeline-${event.action}`}>
                <span className="trusted-device-timeline-dot" aria-hidden="true" />
                <div>
                  <strong>{EVENT_LABELS[event.action] ?? event.action}{event.deviceName ? ` · ${event.deviceName}` : ""}</strong>
                  <small>{formatWhen(event.createdAt)} · {event.actorRole}{event.ipAddress ? ` · ${event.ipAddress}` : ""}</small>
                  {event.detail && <p>{event.detail}</p>}
                </div>
              </li>
            ))}
            {!events.length && <li className="empty-state">No device activity has been recorded yet.</li>}
          </ul>
        )}
      </section>

      {message && <p className="payout-feedback" role="status">{message}</p>}
      <div className="test-notice">
        <ShieldAlert size={14} />
        <span>Device identifiers are derived from browser signals — browsers never expose a hardware MAC address. Blocking a device signs out its sessions instantly and refuses future sign-ins until an administrator restores it.</span>
      </div>
    </div>
  );
}
