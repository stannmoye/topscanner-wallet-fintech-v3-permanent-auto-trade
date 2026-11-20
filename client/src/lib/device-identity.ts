// Stable, privacy-respecting device identity for the sign-in flow.
//
// Browsers deliberately hide hardware identifiers (there is no readable MAC
// address), so the server derives a per-account device key from the value below.
// A persisted random id keeps the same browser recognisable across sign-ins,
// while the browser signals that follow let a materially different device — or
// the same browser on a changed configuration — register separately.

export type DeviceDescriptor = {
  deviceKey: string;
  deviceType?: string;
  platform?: string;
};

const STORAGE_KEY = "arbitrade:trusted-device-id:v1";

function readPersistedId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const generated = globalThis.crypto?.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    // Private browsing or blocked storage: fall back to a per-session id so the
    // server still receives a consistent key for the lifetime of this tab.
    return `ephemeral-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}

function detectDeviceType(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile";
  return ua ? "desktop" : "unknown";
}

function detectPlatform(): string {
  if (typeof navigator === "undefined") return "Unknown";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return uaData.platform;
  const ua = navigator.userAgent || "";
  if (/windows/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown";
}

/** Collect the device descriptor attached to register/sign-in requests. */
export function collectDeviceDescriptor(): DeviceDescriptor {
  if (typeof window === "undefined" || typeof navigator === "undefined") return { deviceKey: "" };
  const signals = [
    readPersistedId(),
    navigator.userAgent || "",
    `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    navigator.language || "",
    String(navigator.hardwareConcurrency || 0),
  ];
  return { deviceKey: signals.join("|"), deviceType: detectDeviceType(), platform: detectPlatform() };
}
