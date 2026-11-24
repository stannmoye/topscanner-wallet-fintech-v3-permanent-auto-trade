import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDeviceContext, deriveDeviceKey, deriveHardwareId, describeUserAgent } from "./trusted-devices";
import { createLocalSession, verifyLocalSession } from "./_core/localAuth";

// The Trusted Devices menu lets a customer see every device that signed in,
// block a device they do not recognise, and ask an administrator to restore it.
// Blocking signs the device out immediately and refuses future sign-ins until an
// administrator restores it from the admin device-oversight queue.

const originalSessionSecret = process.env.SESSION_SECRET;
beforeAll(() => { process.env.SESSION_SECRET = "trusted-devices-contract-secret"; });
afterAll(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const routers = read("./routers.ts");
const loginRoutes = read("./_core/index.ts");
const context = read("./_core/context.ts");
const schema = read("../drizzle/schema.ts");
const migration = read("../drizzle/0120_trusted_devices.sql");
const deviceDetailsMigration = read("../drizzle/0121_device_details.sql");
const app = read("../client/src/App.tsx");
const adminNav = read("../client/src/admin-navigation.ts");

describe("trusted devices — device identity", () => {
  it("derives a stable, account-scoped device key that never embeds a hardware address", () => {
    const a = deriveDeviceKey(7, "fingerprint-abcdefgh", "Mozilla/5.0");
    const b = deriveDeviceKey(7, "fingerprint-abcdefgh", "Mozilla/5.0");
    const otherAccount = deriveDeviceKey(8, "fingerprint-abcdefgh", "Mozilla/5.0");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(otherAccount);
    expect(a).not.toContain(":");
  });

  it("falls back to the user-agent when no client fingerprint is supplied", () => {
    expect(deriveDeviceKey(1, "", "Agent-XYZ")).toBe(deriveDeviceKey(1, undefined, "Agent-XYZ"));
    expect(deriveDeviceKey(1, "short", "Agent-XYZ")).toBe(deriveDeviceKey(1, undefined, "Agent-XYZ"));
  });

  it("classifies device type, platform and browser from the user agent", () => {
    const mobile = describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1");
    expect(mobile).toMatchObject({ deviceType: "mobile", platform: "iOS" });
    const desktop = describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36");
    expect(desktop).toMatchObject({ deviceType: "desktop", platform: "Windows 10/11", browser: "Chrome" });
  });

  it("prefers client-provided names/types but still returns an exact name and type", () => {
    const built = buildDeviceContext(3, { deviceKey: "abcdefgh1234", deviceName: "My Work Laptop", deviceType: "desktop" }, { userAgent: "Mozilla/5.0 (Macintosh)", ipAddress: "203.0.113.7" });
    expect(built.deviceName).toBe("My Work Laptop");
    expect(built.deviceType).toBe("desktop");
    expect(built.platform).toBe("macOS");
    expect(built.ipAddress).toBe("203.0.113.7");
    const inferred = buildDeviceContext(3, undefined, { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" });
    expect(inferred.deviceName.length).toBeGreaterThan(0);
    expect(inferred.deviceType).toBe("mobile");
  });
});

describe("trusted devices — device detail enrichment", () => {
  it("derives a stable, device-level HW ID that differs per device but not per account", () => {
    const a = deriveHardwareId("fingerprint-abcdefgh", "Mozilla/5.0");
    const b = deriveHardwareId("fingerprint-abcdefgh", "Mozilla/5.0");
    const otherDevice = deriveHardwareId("a-different-fingerprint", "Mozilla/5.0");
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-F0-9]{4}(-[A-F0-9]{4})+$/);
    expect(a).not.toBe(otherDevice);
  });

  it("records OS, model, GPU, screen and HW ID while keeping the IP off the blocking key", () => {
    const built = buildDeviceContext(5, {
      deviceKey: "fingerprint-device-one",
      osName: "Android",
      osVersion: "14",
      model: "SM-G991B",
      vendor: "Samsung",
      architecture: "arm 64",
      screen: "1080x2340",
      gpu: "Mali-G78",
      cpuCores: 8,
      deviceMemoryGb: 8,
      clientId: "client-12345678",
    }, { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile", ipAddress: "198.51.100.9" });
    expect(built.osName).toBe("Android");
    expect(built.osVersion).toBe("14");
    expect(built.model).toBe("SM-G991B");
    expect(built.vendor).toBe("Samsung");
    expect(built.gpuRenderer).toBe("Mali-G78");
    expect(built.screen).toBe("1080x2340");
    expect(built.cpuCores).toBe(8);
    expect(built.hardwareId).toMatch(/^[A-F0-9]{4}(-[A-F0-9]{4})+$/);
    expect(built.deviceName).toBe("Samsung SM-G991B");
    // Two devices sharing one IP resolve to different keys, so blocking one is safe.
    const other = buildDeviceContext(5, { deviceKey: "fingerprint-device-two" }, { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile", ipAddress: "198.51.100.9" });
    expect(other.deviceKey).not.toBe(built.deviceKey);
    expect(other.ipAddress).toBe(built.ipAddress);
  });

  it("backfills the detail columns with an idempotent additive migration", () => {
    for (const column of ["osName", "osVersion", "model", "vendor", "architecture", "screen", "gpuRenderer", "cpuCores", "deviceMemoryGb", "clientId", "hardwareId"]) {
      expect(deviceDetailsMigration).toContain("ADD COLUMN IF NOT EXISTS `" + column + "`");
      expect(schema).toContain('"' + column + '"');
    }
  });
});

describe("trusted devices — session binding", () => {
  it("binds a device key into the session token and reads it back", () => {
    const token = createLocalSession(42, 0, "abcDEF123456");
    const parsed = verifyLocalSession(token);
    expect(parsed).toMatchObject({ userId: 42, authVersion: 0, deviceKey: "abcDEF123456" });
  });

  it("keeps issuing version-only and legacy tokens for backward compatibility", () => {
    expect(verifyLocalSession(createLocalSession(42, 5))).toMatchObject({ userId: 42, authVersion: 5 });
    expect(verifyLocalSession(createLocalSession(42, 5))).not.toHaveProperty("deviceKey");
  });

  it("rejects a tampered device segment", () => {
    const token = createLocalSession(42, 0, "abcDEF123456");
    const parts = token.split(".");
    parts[3] = "hackedHacked123";
    expect(verifyLocalSession(parts.join("."))).toBeNull();
  });
});

describe("trusted devices — enforcement and wiring", () => {
  it("enforces blocked devices at sign-in for customer and admin portals", () => {
    expect(loginRoutes).toContain("registerLoginDevice");
    expect(loginRoutes).toContain("device.blocked");
    expect((loginRoutes.match(/This device has been blocked/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a device-bound session the moment its device is blocked", () => {
    expect(context).toContain("isDeviceBlocked");
    expect(context).toContain("deviceKey");
  });

  it("backs the feature with an idempotent, additive migration", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `trusted_devices`");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `device_access_events`");
    expect(migration).toContain("UNIQUE KEY `trusted_devices_user_key_uq`");
    expect(migration).toContain("`blockedBy` enum('customer','admin')");
    expect(schema).toContain('uniqueIndex("trusted_devices_user_key_uq")');
  });

  it("exposes the customer device registry and admin oversight procedures", () => {
    for (const name of ["trustedDevices", "renameTrustedDevice", "blockTrustedDevice", "deviceAccessEvents", "requestDeviceUnblock"]) {
      expect(routers).toContain(`${name}:`);
    }
    for (const name of ["blockedDevices", "devices", "restoreDevice", "deviceOversightSummary"]) {
      expect(routers).toContain(`${name}:`);
    }
  });

  it("wires the customer panel, the account-centre destination and the admin page", () => {
    expect(app).toContain("CustomerTrustedDevicesPanel");
    // Devices & sessions on the account-centre rail merges the old Trusted Devices + Active Sessions entries.
    expect(app).toContain('{ id: "devices-sessions", label: "Devices & sessions"');
    expect(app).toContain('isDevicesSessions');
    expect(app).toContain('section==="deviceOversight"');
    expect(adminNav).toContain('target: "deviceOversight"');
  });
});
