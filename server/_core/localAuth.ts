import crypto from "node:crypto";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
function secret() {
  const value = process.env.SESSION_SECRET?.trim();
  // No fallback in any environment: a shared public secret would let anyone
  // forge a session token. Startup fails fast when it is missing.
  if (!value) throw new Error("SESSION_SECRET is required to sign and verify local sessions.");
  return value;
}
function sign(value: string) { return crypto.createHmac("sha256", secret()).update(value).digest("base64url"); }
/**
 * Session token shapes (all HMAC-signed with SESSION_SECRET):
 *  - `userId.exp.signature`                          legacy, no auth version, no device
 *  - `userId.exp.authVersion.signature`              account-wide revocation only
 *  - `userId.exp.authVersion.deviceKey.signature`    bound to a trusted-device row
 *
 * The optional `deviceKey` binds a session to one registered device so a blocked
 * device can be signed out without revoking the customer's other sessions. It is
 * the pseudonymous device fingerprint from trusted_devices.deviceKey.
 */
const DEVICE_KEY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;
export function createLocalSession(userId: number, authVersion = 0, deviceKey?: string | null) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const device = deviceKey && DEVICE_KEY_TOKEN_PATTERN.test(deviceKey) ? deviceKey : undefined;
  const payload = device ? `${userId}.${exp}.${authVersion}.${device}` : `${userId}.${exp}.${authVersion}`;
  return `${payload}.${sign(payload)}`;
}
export function verifyLocalSession(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  const legacy = parts.length === 3;
  const hasDevice = parts.length === 5;
  if (!legacy && parts.length !== 4 && !hasDevice) return null;
  const userIdText = parts[0];
  const expText = parts[1];
  const versionText = legacy ? "0" : parts[2];
  const deviceKeyText = hasDevice ? parts[3] : undefined;
  const signature = parts[parts.length - 1];
  if (!userIdText || !expText || !versionText || !signature) return null;
  if (!/^\d+$/.test(userIdText) || !/^\d+$/.test(expText) || !/^\d+$/.test(versionText)) return null;
  if (deviceKeyText !== undefined && !DEVICE_KEY_TOKEN_PATTERN.test(deviceKeyText)) return null;
  const payload = legacy
    ? `${userIdText}.${expText}`
    : deviceKeyText !== undefined
      ? `${userIdText}.${expText}.${versionText}.${deviceKeyText}`
      : `${userIdText}.${expText}.${versionText}`;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expText) <= Math.floor(Date.now() / 1000)) return null;
  return {
    userId: Number(userIdText),
    expiresAt: Number(expText),
    authVersion: Number(versionText),
    ...(deviceKeyText ? { deviceKey: deviceKeyText } : {}),
  };
}
export function getLocalSessionFromRequest(req: Request) {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return verifyLocalSession(cookies[COOKIE_NAME]);
}
export function passwordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${digest}`;
}
/**
 * A valid scrypt hash of a random value. It is never a match for any password and is
 * not a secret; it exists only so a login attempt for an unknown email can still run a
 * full scrypt verification, keeping response timing independent of whether the account
 * exists (email-enumeration defense). Computed once per process.
 */
export const TIMING_DECOY_PASSWORD_HASH = passwordHash(crypto.randomBytes(32).toString("hex"));
export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) {
    const [, salt, expected] = stored.split("$");
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 32).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }
  const legacyPepper = process.env.PASSWORD_PEPPER || "arbitrade-local-pepper";
  const actual = crypto.scryptSync(password, legacyPepper, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(stored));
}
