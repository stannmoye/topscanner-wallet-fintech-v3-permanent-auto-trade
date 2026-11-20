// Stable, privacy-respecting device identity for the sign-in flow.
//
// Browsers deliberately hide hardware identifiers: JavaScript cannot read a
// hardware MAC address and there is no OS-level HWID API. So instead of a MAC we
// collect every device-descriptive signal the browser *does* expose — device
// model, operating system and version, CPU architecture, screen, GPU renderer,
// device memory and CPU cores — together with a persisted random client id, and
// the server derives a per-device key (plus a display "HW ID") from them.
//
// Blocking is keyed to that derived device key, never to the IP address, so two
// devices that share one IP (the same home or office network) stay independent:
// blocking one never affects the other.

export type DeviceDescriptor = {
  deviceKey: string;
  deviceType?: string;
  platform?: string;
  osName?: string;
  osVersion?: string;
  model?: string;
  vendor?: string;
  architecture?: string;
  screen?: string;
  gpu?: string;
  cpuCores?: number;
  deviceMemoryGb?: number;
  clientId?: string;
};

const STORAGE_KEY = "arbitrade:trusted-device-id:v1";

type UserAgentDataLike = {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
};

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

function detectDeviceType(ua: string): string {
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile";
  return ua ? "desktop" : "unknown";
}

/** Operating-system name and version from the user agent (plus a UA-CH fallback). */
function parseOperatingSystem(ua: string, uaPlatform?: string): { osName: string; osVersion: string } {
  if (/iphone|ipad|ipod/i.test(ua) || /^ios$/i.test(uaPlatform || "")) {
    const version = ua.match(/os (\d+)[_.](\d+)(?:[_.](\d+))?/i);
    return { osName: "iOS", osVersion: version ? [version[1], version[2], version[3]].filter(Boolean).join(".") : "" };
  }
  const android = ua.match(/android\s+([\d.]+)/i);
  if (android || /android/i.test(uaPlatform || "")) return { osName: "Android", osVersion: android?.[1] ?? "" };
  if (/windows nt 10\.0/i.test(ua)) return { osName: "Windows", osVersion: "10/11" };
  if (/windows nt 6\.3/i.test(ua)) return { osName: "Windows", osVersion: "8.1" };
  if (/windows nt 6\.1/i.test(ua)) return { osName: "Windows", osVersion: "7" };
  if (/windows/i.test(ua)) return { osName: "Windows", osVersion: "" };
  const mac = ua.match(/mac os x (\d+)[_.](\d+)(?:[_.](\d+))?/i);
  if (mac) return { osName: "macOS", osVersion: [mac[1], mac[2], mac[3]].filter(Boolean).join(".") };
  if (/macintosh|mac os x|cpu (iphone|ipad)/i.test(ua)) return { osName: "macOS", osVersion: "" };
  const chromeOs = ua.match(/cros [a-z0-9_]+ ([\d.]+)/i);
  if (/cros/i.test(ua)) return { osName: "ChromeOS", osVersion: chromeOs?.[1] ?? "" };
  if (/linux/i.test(ua)) return { osName: "Linux", osVersion: "" };
  return { osName: uaPlatform || "Unknown", osVersion: "" };
}

/** Concrete device model — the specific phone or laptop where the browser exposes it. */
function resolveModel(ua: string, highEntropyModel?: string): string {
  if (highEntropyModel?.trim()) return highEntropyModel.trim().slice(0, 60);
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/ipod/i.test(ua)) return "iPod";
  if (/macintosh|mac os x/i.test(ua)) return "Mac";
  // Android user agents embed the model right before "Build/", e.g. "SM-G991B Build/…".
  const android = ua.match(/;\s*([A-Za-z0-9][A-Za-z0-9 _.-]*?)\s+Build[/;]/i) ?? ua.match(/android[^;]*;\s*([^;)]+)\)/i);
  if (android?.[1]) {
    const candidate = android[1].replace(/\b(wv|mobile)\b/gi, "").trim();
    if (candidate && !/^(linux|android)$/i.test(candidate)) return candidate.slice(0, 60);
  }
  if (/windows/i.test(ua)) return "Windows PC";
  return "";
}

function resolveVendor(model: string, ua: string): string {
  const value = `${model} ${ua}`;
  if (/iphone|ipad|ipod|macintosh|mac os x/i.test(value)) return "Apple";
  if (/^sm-|samsung/i.test(model)) return "Samsung";
  if (/^pixel|google/i.test(model)) return "Google";
  if (/huawei|hmscore/i.test(value)) return "Huawei";
  if (/xiaomi|redmi|mi \d|poco/i.test(value)) return "Xiaomi";
  if (/oneplus/i.test(model)) return "OnePlus";
  if (/oppo|cph\d/i.test(value)) return "OPPO";
  if (/vivo|v\d{4}/i.test(value)) return "Vivo";
  if (/windows/i.test(value)) return "PC";
  return "";
}

/** GPU renderer string via WebGL — a strong, stable per-machine differentiator. */
function readGpuRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof renderer === "string" ? renderer.slice(0, 140) : "";
  } catch {
    return "";
  }
}

async function readUserAgentData(): Promise<{ platform?: string; architecture?: string; model?: string; platformVersion?: string }> {
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
  if (!uaData) return {};
  try {
    if (typeof uaData.getHighEntropyValues === "function") {
      const high = await uaData.getHighEntropyValues(["platform", "platformVersion", "model", "architecture", "bitness"]);
      const bitness = typeof high.bitness === "string" ? high.bitness : "";
      return {
        platform: typeof high.platform === "string" ? high.platform : uaData.platform,
        platformVersion: typeof high.platformVersion === "string" ? high.platformVersion : "",
        model: typeof high.model === "string" ? high.model : "",
        architecture: typeof high.architecture === "string" ? `${high.architecture}${bitness ? ` ${bitness}` : ""}` : "",
      };
    }
  } catch {
    // Some browsers gate the high-entropy call behind permissions; fall through
    // to the basic platform value rather than failing the sign-in.
  }
  return { platform: uaData.platform };
}

/**
 * Collect the device descriptor attached to register/sign-in requests. Async so
 * it can read the higher-entropy values (model, OS version, architecture) where
 * the browser exposes them; the lower-entropy signals always resolve.
 */
export async function collectDeviceDescriptor(): Promise<DeviceDescriptor> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return { deviceKey: "" };
  const clientId = readPersistedId();
  const ua = navigator.userAgent || "";
  const high = await readUserAgentData();
  const os = parseOperatingSystem(ua, high.platform);
  const deviceType = detectDeviceType(ua);
  const model = resolveModel(ua, high.model);
  const vendor = resolveVendor(model, ua);
  const architecture = high.architecture || "";
  const screen = `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`;
  const gpu = readGpuRenderer();
  const cpuCores = navigator.hardwareConcurrency || 0;
  const deviceMemoryGb = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 0;

  // The fingerprint that the server hashes into the device key. Every stable
  // signal we can read goes in, so two devices behind one IP resolve to
  // different keys and blocking one leaves the other untouched.
  const signals = [
    clientId,
    ua,
    screen,
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    navigator.language || "",
    String(cpuCores),
    String(deviceMemoryGb),
    gpu,
    architecture,
    model,
  ];

  return {
    deviceKey: signals.join("|"),
    deviceType,
    platform: os.osName,
    osName: os.osName,
    osVersion: os.osVersion || high.platformVersion || "",
    model,
    vendor,
    architecture,
    screen,
    gpu,
    cpuCores,
    deviceMemoryGb,
    clientId,
  };
}
