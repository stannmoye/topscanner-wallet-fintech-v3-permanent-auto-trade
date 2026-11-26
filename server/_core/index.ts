import "dotenv/config";
import express from "express";
import { randomBytes } from "node:crypto";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerProviderOAuthRoutes } from "./providerOAuth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { catchUpDueAutomaticSettlements, closeDbPool, countOutstandingTrades, createLocalCustomer, createNotification, ensureWithdrawalPinSchema, getAppSetting, getCustomerTicket, getSettlementEvidenceUploadTarget, getUserByEmail, getUserById, processNotificationCampaignLifecycle, reconcileAllDueTradesAwaitingConfirmation, processAutomaticMarketSettlements, processConfirmedTradeCredits, repairLegacyTradeSettlementPolicy, resolveCustomerPackageName, runAutoTradeCycle, runTradingTierQualificationWorkerCycle } from "../db";
import { buildDeviceContext, isDeviceBlocked, recordDeviceLogin, safeLogDeviceEvent } from "../trusted-devices";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { configuredAuthRateLimitStore, createAuthRateLimiter } from "./authRateLimit";
import { resolveTrustedProxyHops } from "./trustedProxy";
import { isAllowedAttachmentRequest } from "./attachmentPolicy";
import { createLocalSession, passwordHash, verifyPassword, TIMING_DECOY_PASSWORD_HASH } from "./localAuth";
import { writeStorageObject } from "../storage";
import { getTicketUploadPolicy } from "../db";
import { ensureMarketDrivenOpportunities, refreshMarketData } from "../marketSync";
import { serveStatic, setupVite } from "./vite";
import { securityHeadersMiddleware } from "./securityHeaders";
import { csrfProtectionMiddleware } from "./csrfProtection";
import { openTransactionConsoleSession } from "../transactionConsole";
import { runOpportunityRetention } from "../opportunityLifecycle";
import { getLocalSessionFromRequest } from "./localAuth";
import { confirmEmailVerification, requestEmailVerification, requestPasswordReset, resetPasswordWithCode } from "../emailAuth";
import { startEmailWorkers } from "../emailQueue";
import { runDailyEmailReports } from "../emailAdmin";
import { startHeartbeatWorker } from "./heartbeat";
import { runMonitoredWorkerCycle, sanitizeWorkerErrorMessage, waitForMonitoredWorkerCycles } from "./workerHealth";
import { registerGracefulShutdown, registerWorkerInterval } from "./workerRuntime";
import { registerLocalStorageRoutes } from "./localStorageRoutes";
import { refreshMiningPriceFeeds } from "../mining-admin";
import { runMiningWorkerCycle } from "../mining";
import { ensureSessionSecret } from "../../installer/session-secret.mjs";
import { isValidSettlementEvidenceStorageKey, settlementEvidenceStorageKey, validateSettlementEvidenceUpload } from "../settlement-evidence";
import { normalizeVisitorKey, recordAnalyticsEvent, ensureVisitorAnalyticsSchema, VISITOR_COOKIE } from "../site-analytics";
import { ensureSignInActivitySchema, purgeSignInActivity, recordSignInActivity } from "../sign-in-activity";
import { ensureExampleLendingDesk } from "../lendingDossiers";
import { ensureCustomerApiSchema } from "../customer-api/schema";
import { registerCustomerApiRoutes } from "../customer-api/gateway";
import { runTenderIngestCycle } from "../modules/tender/ingest";
import { parse as parseCookieHeader } from "cookie";

const registrationRateLimit = createAuthRateLimiter({ windowMs: 60 * 60_000, max: 5, message: "Too many registration attempts. Try again later.", store: configuredAuthRateLimitStore, scope: "customer-register" });
const customerLoginRateLimit = createAuthRateLimiter({ windowMs: 15 * 60_000, max: 10, message: "Too many login attempts. Try again later.", store: configuredAuthRateLimitStore, scope: "customer-login" });
const adminLoginRateLimit = createAuthRateLimiter({ windowMs: 15 * 60_000, max: 8, message: "Too many administrator login attempts. Try again later.", store: configuredAuthRateLimitStore, scope: "admin-login" });
const supportAttachmentPrepareUploadRateLimit = createAuthRateLimiter({ windowMs: 60_000, max: 20, message: "Too many support attachment requests. Try again shortly.", store: configuredAuthRateLimitStore, scope: "support-attachment-prepare-upload" });
const settlementEvidenceUploadRateLimit = createAuthRateLimiter({ windowMs: 60_000, max: 30, message: "Too many settlement evidence upload requests. Try again shortly.", store: configuredAuthRateLimitStore, scope: "settlement-evidence-upload" });
const passwordResetRequestRateLimit = createAuthRateLimiter({ windowMs: 15 * 60_000, max: 5, message: "Too many password-reset requests. Try again later.", store: configuredAuthRateLimitStore, scope: "password-reset-request" });
const passwordResetConfirmRateLimit = createAuthRateLimiter({ windowMs: 15 * 60_000, max: 10, message: "Too many password-reset attempts. Try again later.", store: configuredAuthRateLimitStore, scope: "password-reset-confirm" });
const emailVerificationRequestRateLimit = createAuthRateLimiter({ windowMs: 15 * 60_000, max: 5, message: "Too many email-verification requests. Try again later.", store: configuredAuthRateLimitStore, scope: "email-verification-request" });
const emailVerificationConfirmRateLimit = createAuthRateLimiter({ windowMs: 15 * 60_000, max: 10, message: "Too many email-verification attempts. Try again later.", store: configuredAuthRateLimitStore, scope: "email-verification-confirm" });
const analyticsVisitRateLimit = createAuthRateLimiter({ windowMs: 60_000, max: 120, message: "Too many analytics requests. Try again shortly.", store: configuredAuthRateLimitStore, scope: "analytics-visit" });

/**
 * Edge/CDN headers that carry a resolved ISO country code. They are trusted only
 * when a trusted reverse proxy is actually terminating the request in front of
 * this app; when none is present the Accept-Language region is used as a
 * best-effort fallback and finally the country is recorded as unknown.
 */
const ANALYTICS_COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country", "x-country-code", "x-geo-country", "fly-client-ip-country"];

function normalizeCountryCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code === "XX" || code === "T1" || code === "ZZ" ? null : code;
}

function resolveRequestCountry(req: express.Request): string | null {
  for (const header of ANALYTICS_COUNTRY_HEADERS) {
    const raw = req.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const code = normalizeCountryCode(value);
    if (code) return code;
  }
  const acceptLanguage = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : "";
  const region = acceptLanguage.match(/[a-z]{2,3}-([A-Za-z]{2})\b/i);
  return region ? normalizeCountryCode(region[1]) : null;
}

function requestIpAddress(req: express.Request): string | undefined {
  return req.ip || req.socket?.remoteAddress || undefined;
}

async function startServer() {
  console.info("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "application-bootstrap-entered", nodeVersion: process.version, nodeEnv: process.env.NODE_ENV || "unset", portConfigured: Boolean(process.env.PORT), databaseUrlConfigured: Boolean(process.env.DATABASE_URL) }));
  if (process.env.NODE_ENV === "production") {
    console.info("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "session-secret-initialization-start" }));
    try {
      const result = await ensureSessionSecret({ root: process.cwd(), env: process.env });
      if (result.generated) {
        console.info("[Session] Generated and securely persisted the missing session secret.");
      }
    } catch {
      console.error("[Session] A stable session secret is missing and could not be persisted securely. Refusing to start.");
      throw new Error("Production session-secret initialization failed.");
    }
  }
  // Every environment requires a real, persistent session-signing secret. The
  // shared development fallback was removed because a public secret lets anyone
  // forge a session token; production provisions one above, any other
  // environment must supply one.
  if (!process.env.SESSION_SECRET?.trim()) {
    console.error("[Session] SESSION_SECRET is required to sign and verify sessions. Refusing to start.");
    throw new Error("SESSION_SECRET is required.");
  }
  console.info("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "session-secret-initialization-complete" }));
  const app = express();
  // Item 21: install the baseline browser security headers (CSP, HSTS, frame,
  // referrer, nosniff) before any route is registered so every response — API,
  // static asset and SPA fallback — carries them.
  app.use(securityHeadersMiddleware());
  // Item 22: reject cross-site state-changing requests (tRPC mutations and the
  // auth/upload endpoints) with a Sec-Fetch-Site + Origin/Referer check. Signed
  // heartbeat worker callbacks under /api/scheduled/… are exempt.
  app.use(csrfProtectionMiddleware());
  registerLocalStorageRoutes(app);
  if (process.env.NODE_ENV === "production" && !configuredAuthRateLimitStore) {
    console.warn("[AuthRateLimit] Using process-local counters. Configure AUTH_RATE_LIMIT_REDIS_REST_URL and AUTH_RATE_LIMIT_REDIS_REST_TOKEN for multi-instance deployments.");
  }
  // The installer defaults to direct-client mode because it cannot securely
  // infer the network topology. Trust forwarded headers only when an operator has
  // verified the actual reverse-proxy chain. Malformed values fail closed.
  const proxySetting = process.env.TRUST_PROXY_HOPS;
  const trustedProxyHops = resolveTrustedProxyHops(proxySetting);
  if (proxySetting?.trim() && trustedProxyHops === false && !/^0+$/.test(proxySetting.trim())) {
    console.warn("[Proxy] Invalid TRUST_PROXY_HOPS; using safe direct-client mode (0). Set an integer from 0 to 10 only when the trusted proxy topology is known.");
  }
  app.set("trust proxy", trustedProxyHops);
  const server = createServer(app);
  registerGracefulShutdown({ server, drainWorkers: waitForMonitoredWorkerCycles, closeDatabase: closeDbPool });
  // Rate-limit local upload preparation requests before JSON parsing so oversized request
  // bodies cannot consume parser resources before the route limiter runs.
  app.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/api/support/attachments/prepare-upload") {
      return supportAttachmentPrepareUploadRateLimit(req, res, next);
    }
    return next();
  });
  // Item 51: keep ordinary JSON and form bodies small. The only JSON route that
  // legitimately carries a large payload is the admin compose-email tRPC procedure
  // (base64 attachments), so it gets its own larger parser registered ahead of the
  // global one (body-parser skips a body that was already parsed). The binary upload
  // routes below use express.raw with their own limits and are unaffected, because
  // express.json only parses application/json, which those requests do not send. KYC
  // documents, ticket/support attachments and settlement evidence are uploaded as raw
  // bytes to those scoped routes, so none of them needs a larger JSON limit here.
  const LARGE_JSON_LIMIT = "50mb";
  const LARGE_JSON_PROCEDURE = "adminOperations.composeEmail";
  const largeJsonBodyParser = express.json({ limit: LARGE_JSON_LIMIT });
  app.use((req, res, next) => {
    if (req.method === "POST" && req.path.startsWith("/api/trpc/")) {
      const procedures = req.path.slice("/api/trpc/".length).split("?")[0].split(",");
      if (procedures.includes(LARGE_JSON_PROCEDURE)) return largeJsonBodyParser(req, res, next);
    }
    return next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  const setLocalSession = (req: express.Request, res: express.Response, user: { id: number; authVersion?: number }, deviceKey?: string | null) => {
    res.cookie(COOKIE_NAME, createLocalSession(user.id, user.authVersion || 0, deviceKey), { ...getSessionCookieOptions(req), maxAge: 30 * 24 * 60 * 60 * 1000 });
  };
  const requestDeviceContext = (req: express.Request, userId: number, device: unknown) =>
    buildDeviceContext(userId, (device && typeof device === "object" ? device : undefined) as never, {
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      ipAddress: req.ip || req.socket?.remoteAddress || undefined,
    });
  /**
   * Resolve (and lazily issue) the anonymous first-party visitor key used to
   * count distinct daily visitors. It is a random id in an httpOnly cookie and
   * carries no personal data.
   */
  const resolveVisitorKey = (req: express.Request, res: express.Response): string => {
    const existing = normalizeVisitorKey(parseCookieHeader(req.headers.cookie ?? "")[VISITOR_COOKIE]);
    if (existing) return existing;
    const key = randomBytes(16).toString("hex");
    res.cookie(VISITOR_COOKIE, key, { ...getSessionCookieOptions(req), httpOnly: true, maxAge: 400 * 24 * 60 * 60 * 1000 });
    return key;
  };
  /** Record one website analytics event for an auth outcome; never blocks the response. */
  const recordAuthAnalytics = (req: express.Request, res: express.Response, eventType: "login" | "signup", userId: number, source: string): void => {
    void recordAnalyticsEvent({
      eventType,
      visitorKey: resolveVisitorKey(req, res),
      userId,
      countryCode: resolveRequestCountry(req),
      source,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      ipAddress: requestIpAddress(req),
    });
  };
  /**
   * Record one sign-in activity row for a successful authentication so the
   * administrator console can list every customer sign-in. Never blocks the
   * response and is retained for a rolling seven-day window.
   */
  const recordSignInActivityEvent = (req: express.Request, user: { id: number; name?: string | null; email?: string | null; role?: string | null }, eventType: "login" | "signup", source: "customer" | "admin", deviceName?: string | null): void => {
    void recordSignInActivity({
      userId: user.id,
      userName: user.name ?? null,
      userEmail: user.email ?? null,
      userRole: user.role ?? null,
      eventType,
      source,
      deviceName: deviceName ?? null,
      countryCode: resolveRequestCountry(req),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      ipAddress: requestIpAddress(req),
    });
  };
  /**
   * Shared post-authentication device step. Refuses a blocked device and records
   * a first-seen or returning login. Returns the device key used to bind the
   * session cookie, or null when the sign-in must be refused.
   */
  const registerLoginDevice = async (req: express.Request, userId: number, device: unknown): Promise<{ deviceKey: string; deviceName: string; blocked: boolean }> => {
    const context = requestDeviceContext(req, userId, device);
    let blocked = false;
    try {
      blocked = await isDeviceBlocked(userId, context.deviceKey);
    } catch {
      blocked = false;
    }
    if (blocked) {
      await safeLogDeviceEvent(userId, { deviceKey: context.deviceKey, deviceName: context.deviceName, action: "login_blocked", actorRole: "system", detail: "Sign-in refused: this device is blocked for the account.", ipAddress: context.ipAddress, userAgent: context.userAgent });
      return { deviceKey: context.deviceKey, deviceName: context.deviceName, blocked: true };
    }
    const record = await recordDeviceLogin(userId, context);
    await safeLogDeviceEvent(userId, { deviceKey: context.deviceKey, deviceName: context.deviceName, action: record.isNew ? "device_first_seen" : "login", actorRole: "customer", actorId: userId, detail: record.isNew ? "New device signed in." : "Signed in from a recognised device.", ipAddress: context.ipAddress, userAgent: context.userAgent });
    if (record.isNew) {
      void createNotification(userId, "New device signed in", `A new device signed in to your account: ${context.deviceName}. If this was not you, open Account Settings → Trusted Devices to block it and change your password.`, { eventKey: `device-new:${record.id}`, category: "security", priority: "high", href: "/customer" })
        .catch((error) => console.error("[TrustedDevices] New-device notice failed:", error instanceof Error ? error.name : "UnknownError"));
    }
    return { deviceKey: context.deviceKey, deviceName: context.deviceName, blocked: false };
  };
  app.post("/api/customer/register", registrationRateLimit, async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body || {};
      if (typeof email !== "string" || typeof password !== "string" || password.length < 12) return res.status(400).json({ error: "Use an email and a password of at least 12 characters" });
      const user = await createLocalCustomer({ email, passwordHash: passwordHash(password), name: `${firstName || ""} ${lastName || ""}`.trim() || email });
      const device = await registerLoginDevice(req, user.id, req.body?.device);
      setLocalSession(req, res, user, device.deviceKey);
      recordAuthAnalytics(req, res, "signup", user.id, "customer");
      recordSignInActivityEvent(req, user, "signup", "customer", device.deviceName);
      void requestEmailVerification(user.id).catch(error => console.error("[Email] Registration verification enqueue failed:", error instanceof Error ? error.name : "UnknownError"));
      await openTransactionConsoleSession(req, res, user.id);
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return res.json({ user: { ...safeUser, packageName: await resolveCustomerPackageName(user.id) } });
    } catch (error) {
      // Generic response so a registration attempt never confirms whether an email
      // address is already registered. The real cause is logged server-side only.
      console.error("[Auth] Customer registration failed:", error instanceof Error ? error.name : "UnknownError");
      return res.status(400).json({ error: "We could not create your account with those details. If you already have an account, sign in or reset your password instead." });
    }
  });
  app.post("/api/customer/login", customerLoginRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const user = await getUserByEmail(String(email || ""));
      // Always run one password verification (against a decoy hash for an unknown email)
      // so response timing does not reveal whether the account exists.
      const passwordMatches = verifyPassword(String(password || ""), user?.passwordHash ?? TIMING_DECOY_PASSWORD_HASH);
      // Administrators may sign into their own customer workspace; authorization remains database-role based.
      if (!user || (user.role !== "user" && user.role !== "admin") || !passwordMatches) return res.status(401).json({ error: "Invalid email or password" });
      const device = await registerLoginDevice(req, user.id, req.body?.device);
      if (device.blocked) return res.status(403).json({ error: "This device has been blocked for this account. If you believe this is a mistake, contact support or ask an administrator to restore access." });
      setLocalSession(req, res, user, device.deviceKey);
      recordAuthAnalytics(req, res, "login", user.id, "customer");
      recordSignInActivityEvent(req, user, "login", "customer", device.deviceName);
      await openTransactionConsoleSession(req, res, user.id);
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return res.json({ user: { ...safeUser, packageName: await resolveCustomerPackageName(user.id) } });
    } catch {
      return res.status(503).json({ error: "Authentication service is not configured. Configure DATABASE_URL and run the migrations." });
    }
  });
  app.post("/api/admin/login", adminLoginRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const user = await getUserByEmail(String(email || ""));
      // Identical message and one password verification for every outcome (decoy hash for an
      // unknown email) so the response cannot reveal whether an administrator account exists.
      const passwordMatches = verifyPassword(String(password || ""), user?.passwordHash ?? TIMING_DECOY_PASSWORD_HASH);
      if (!user || user.role !== "admin" || !passwordMatches) return res.status(401).json({ error: "Invalid email or password" });
      const device = await registerLoginDevice(req, user.id, req.body?.device);
      if (device.blocked) return res.status(403).json({ error: "This device has been blocked for this account. If you believe this is a mistake, contact support or ask an administrator to restore access." });
      setLocalSession(req, res, user, device.deviceKey);
      recordAuthAnalytics(req, res, "login", user.id, "admin");
      recordSignInActivityEvent(req, user, "login", "admin", device.deviceName);
      await openTransactionConsoleSession(req, res, user.id);
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return res.json({ user: { ...safeUser, packageName: await resolveCustomerPackageName(user.id) } });
    } catch {
      return res.status(503).json({ error: "Authentication service is not configured. Configure DATABASE_URL and run the migrations." });
    }
  });
  app.post("/api/customer/password-reset/request", passwordResetRequestRateLimit, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    await requestPasswordReset(email);
    return res.status(202).json({ message: "If the account exists and email delivery is configured, a reset code will be sent." });
  });
  app.post("/api/customer/password-reset/confirm", passwordResetConfirmRateLimit, async (req, res) => {
    try {
      const { email, code, password } = req.body || {};
      if (typeof email !== "string" || typeof code !== "string" || typeof password !== "string") return res.status(400).json({ error: "Email, reset code and new password are required" });
      await resetPasswordWithCode(email, code, password);
      return res.json({ success: true });
    } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "The reset code is invalid or expired" }); }
  });
  app.post("/api/customer/email-verification/request", emailVerificationRequestRateLimit, async (req, res) => {
    const session = getLocalSessionFromRequest(req);
    if (!session) return res.status(401).json({ error: "Authentication required" });
    const user = await getUserById(session.userId);
    if (!user || Number(user.authVersion || 0) !== session.authVersion) return res.status(401).json({ error: "Authentication required" });
    await requestEmailVerification(session.userId);
    return res.status(202).json({ message: "If email delivery is configured, a verification code will be sent." });
  });
  app.post("/api/customer/email-verification/confirm", emailVerificationConfirmRateLimit, async (req, res) => {
    const session = getLocalSessionFromRequest(req);
    if (!session) return res.status(401).json({ error: "Authentication required" });
    try {
      const user = await getUserById(session.userId);
      if (!user || Number(user.authVersion || 0) !== session.authVersion) return res.status(401).json({ error: "Authentication required" });
      const code = typeof req.body?.code === "string" ? req.body.code : "";
      await confirmEmailVerification(session.userId, code);
      return res.json({ success: true });
    } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "The verification code is invalid or expired" }); }
  });
  /**
   * First-party page-view beacon. The client fires this once per page load so the
   * administrator dashboard can report total visits and distinct daily visitors.
   * It is deliberately same-origin, body-less and best-effort: it always answers
   * 204 so a tracking failure can never affect the customer experience.
   */
  const recordVisitBeacon = (req: express.Request, res: express.Response) => {
    const requestedPath = typeof req.query.path === "string" ? req.query.path : undefined;
    void recordAnalyticsEvent({
      eventType: "visit",
      visitorKey: resolveVisitorKey(req, res),
      countryCode: resolveRequestCountry(req),
      source: "site",
      path: requestedPath ? requestedPath : req.path,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      ipAddress: requestIpAddress(req),
    });
    return res.status(204).end();
  };
  app.get("/api/analytics/visit", analyticsVisitRateLimit, recordVisitBeacon);
  app.post("/api/analytics/visit", analyticsVisitRateLimit, recordVisitBeacon);
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  const resolveLocalSupportUser = async (req: express.Request, res: express.Response) => {
    const session = getLocalSessionFromRequest(req);
    if (!session) { res.status(401).json({ error: "Authentication required" }); return null; }
    const user = await getUserById(session.userId);
    if (!user || Number(user.authVersion ?? 0) !== Number(session.authVersion ?? 0) || user.loginMethod === "closed") {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    return user;
  };

  app.post("/api/support/attachments/prepare-upload", async (req, res) => {
    try {
      const user = await resolveLocalSupportUser(req, res);
      if (!user) return;
      const { ticketId, fileName, mimeType, sizeBytes } = req.body ?? {};
      if (!Number.isSafeInteger(ticketId) || ticketId < 1 || typeof fileName !== "string" || typeof mimeType !== "string" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
        return res.status(400).json({ error: "A valid support attachment is required" });
      }
      if (!(await getCustomerTicket(user.id, ticketId))) return res.status(404).json({ error: "Ticket not found" });
      const policy = await getTicketUploadPolicy();
      if (!isAllowedAttachmentRequest({ fileName, mimeType, sizeBytes }, policy)) {
        return res.status(400).json({ error: `Attachment rejected. Maximum ${policy.maxAttachmentMb} MB. Allowed: ${policy.allowedMimeTypes.join(", ")}` });
      }
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "attachment";
      const key = `support/${ticketId}/${randomBytes(24).toString("hex")}-${safeName}`;
      res.set("Cache-Control", "no-store, private");
      return res.json({ uploadUrl: `/api/support/attachments/upload?key=${encodeURIComponent(key)}`, storageKey: key, stableUrl: `/storage/${key}` });
    } catch (error) {
      console.error("[SupportAttachmentUpload] Could not prepare local upload", error instanceof Error ? error.name : "UnknownError");
      return res.status(503).json({ error: "Unable to prepare local upload. Please retry." });
    }
  });

  app.put("/api/support/attachments/upload", express.raw({ type: "*/*", limit: "100mb" }), async (req, res) => {
    try {
      const user = await resolveLocalSupportUser(req, res);
      if (!user) return;
      const key = typeof req.query.key === "string" ? req.query.key : "";
      const match = /^support\/(\d+)\/([a-f0-9]{48})-([A-Za-z0-9._-]{1,120})$/.exec(key);
      if (!match) return res.status(400).json({ error: "Invalid local storage key" });
      const ticketId = Number(match[1]);
      if (!(await getCustomerTicket(user.id, ticketId))) return res.status(404).json({ error: "Ticket not found" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 1) return res.status(400).json({ error: "The uploaded file is empty" });
      const mimeType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
      const fileName = match[3];
      const policy = await getTicketUploadPolicy();
      if (!isAllowedAttachmentRequest({ fileName, mimeType, sizeBytes: req.body.length }, policy)) {
        return res.status(400).json({ error: `Attachment rejected. Maximum ${policy.maxAttachmentMb} MB. Allowed: ${policy.allowedMimeTypes.join(", ")}` });
      }
      await writeStorageObject(key, req.body, mimeType);
      res.set("Cache-Control", "no-store, private");
      return res.status(201).json({ success: true, storageKey: key });
    } catch (error) {
      console.error("[SupportAttachmentUpload] Local disk write failed", error instanceof Error ? error.name : "UnknownError");
      const errorCode = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
      const message = errorCode === "EEXIST" ? "Upload key already exists" : "Unable to save the attachment";
      return res.status(500).json({ error: message });
    }
  });
  app.post("/api/admin/settlement-evidence/prepare-upload", settlementEvidenceUploadRateLimit, async (req, res) => {
    try {
      const user = await resolveLocalSupportUser(req, res);
      if (!user) return;
      if (user.role !== "admin") return res.status(403).json({ error: "Administrator access required" });
      const { tradeId, fileName, mimeType, sizeBytes } = req.body ?? {};
      if (!Number.isSafeInteger(tradeId) || tradeId < 1 || typeof fileName !== "string" || typeof mimeType !== "string" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) return res.status(400).json({ error: "A valid settlement evidence file is required" });
      const target = await getSettlementEvidenceUploadTarget(tradeId);
      if (!target || target.status !== "confirmed" || !["pending", "confirmed_awaiting_credit"].includes(String(target.settlementStatus))) return res.status(409).json({ error: "This trade is not accepting settlement evidence" });
      if (sizeBytes > 25_000_000) return res.status(400).json({ error: "Settlement evidence exceeds the 25 MB maximum" });
      const key = settlementEvidenceStorageKey(tradeId, fileName);
      res.set("Cache-Control", "no-store, private");
      return res.json({ uploadUrl: `/api/admin/settlement-evidence/upload?key=${encodeURIComponent(key)}`, storageKey: key, stableUrl: `/storage/${key}` });
    } catch (error) {
      console.error("[SettlementEvidenceUpload] Could not prepare upload", error instanceof Error ? error.name : "UnknownError");
      return res.status(503).json({ error: "Unable to prepare settlement evidence upload" });
    }
  });
  app.put("/api/admin/settlement-evidence/upload", express.raw({ type: "*/*", limit: "30mb" }), async (req, res) => {
    try {
      const user = await resolveLocalSupportUser(req, res);
      if (!user) return;
      if (user.role !== "admin") return res.status(403).json({ error: "Administrator access required" });
      const key = typeof req.query.key === "string" ? req.query.key : "";
      const match = /^settlement-evidence\/([1-9][0-9]*)\/[a-f0-9]{48}-([A-Za-z0-9._-]{1,120})$/.exec(key);
      if (!match || !isValidSettlementEvidenceStorageKey(key, Number(match[1]))) return res.status(400).json({ error: "Invalid settlement evidence storage key" });
      const target = await getSettlementEvidenceUploadTarget(Number(match[1]));
      if (!target || target.status !== "confirmed" || !["pending", "confirmed_awaiting_credit"].includes(String(target.settlementStatus))) return res.status(409).json({ error: "This trade is not accepting settlement evidence" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 1) return res.status(400).json({ error: "The uploaded evidence is empty" });
      const mimeType = String(req.headers["content-type"] || "application/octet-stream").split(";", 1)[0].trim();
      const validated = validateSettlementEvidenceUpload({ fileName: match[2], declaredMimeType: mimeType, sizeBytes: req.body.length, content: req.body });
      await writeStorageObject(key, req.body, validated.mimeType);
      res.set("Cache-Control", "no-store, private");
      return res.status(201).json({ success: true, storageKey: key, mimeType: validated.mimeType, sizeBytes: req.body.length, sha256: validated.sha256 });
    } catch (error) {
      console.error("[SettlementEvidenceUpload] Upload failed", error instanceof Error ? error.name : "UnknownError");
      return res.status(400).json({ error: "Settlement evidence upload was rejected" });
    }
  });
  registerProviderOAuthRoutes(app);
  // Customer API v1 — versioned public REST surface (scoped API keys + read
  // gateway) and the customer-portal key-management routes. Registered before
  // the tRPC/static fallback so /api/v1 is never shadowed by the SPA.
  registerCustomerApiRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      // tRPC maps unexpected failures to a generic INTERNAL_SERVER_ERROR and only
      // forwards the outer `message` to the client (the driver error is dropped from
      // the response, which is intentional). Without this hook the real database
      // cause — driver code, SQLSTATE, column/table and message — is lost entirely,
      // so a broken admin query such as `settlementIntegrityIssues` fails silently.
      // Log the underlying cause server-side (redacted) while leaving the client
      // response unchanged.
      onError({ error, path, type }) {
        const cause = (error as { cause?: unknown }).cause;
        if (cause == null) return;
        const details = cause && typeof cause === "object" ? (cause as Record<string, unknown>) : {};
        const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
        console.error("[trpc] procedure failed", {
          path: path ?? "unknown",
          type,
          name: text(details.name)?.slice(0, 80) ?? "UnknownCause",
          code: details.code == null ? undefined : String(details.code).replace(/[^A-Z0-9_]/gi, "").slice(0, 80),
          errno: details.errno == null ? undefined : details.errno,
          sqlState: details.sqlState == null ? undefined : String(details.sqlState).slice(0, 16),
          table: details.table == null ? undefined : String(details.table).replace(/[^A-Z0-9_]/gi, "").slice(0, 120),
          column: details.column == null ? undefined : String(details.column).replace(/[^A-Z0-9_]/gi, "").slice(0, 120),
          cause: sanitizeWorkerErrorMessage(details.sqlMessage ?? details.message ?? cause),
        });
      },
    })
  );
  // development mode uses Vite, production mode uses static files
  console.info("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "routes-registered-and-static-setup-start", nodeEnv: process.env.NODE_ENV || "unset" }));
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  console.info("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "routes-and-static-setup-complete" }));

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  if (process.env.DATABASE_URL) {
    // Guarantee the additive visitor-analytics table exists before serving, so
    // the administrator dashboard works even when this process is started
    // directly from dist/index.js (which skips the external startup wrapper).
    await ensureVisitorAnalyticsSchema();
    // Guarantee the additive Customer API tables exist before serving, so the
    // customer/admin key-management surface works on hosts that run only the
    // guarded main migrations (the additive portal migration is not on that path).
    await ensureCustomerApiSchema();
    // Guarantee the additive customer withdrawal-PIN table exists before serving,
    // so the PIN requirement on every withdrawal and the admin PIN viewer work on
    // hosts that run only the guarded main migrations.
    await ensureWithdrawalPinSchema();
    // Guarantee the additive sign-in activity table exists before serving, so the
    // administrator "Sign in Activity" console works on hosts that run only the
    // guarded main migrations.
    await ensureSignInActivitySchema();
    // Clear any sign-in activity older than the seven-day retention window and
    // then keep clearing it automatically so the system never accumulates stale
    // sign-in logs or residue.
    void purgeSignInActivity()
      .then(result => { if (result.deleted) console.log("[SignInActivity] cleared expired sign-in records on startup", { deleted: result.deleted, retentionDays: result.retentionDays }); })
      .catch(error => console.error("[SignInActivity] startup purge failed", error instanceof Error ? error.message : "UnknownError"));
    const signInActivityRetentionTimer = registerWorkerInterval(() => {
      void purgeSignInActivity()
        .then(result => { if (result.deleted) console.log("[SignInActivity] auto-cleared expired sign-in records", { deleted: result.deleted, retentionDays: result.retentionDays }); })
        .catch(error => console.error("[SignInActivity] retention sweep failed", error instanceof Error ? error.message : "UnknownError"));
    }, 60 * 60_000);
    signInActivityRetentionTimer.unref();
    // Publish the six demonstration loan auctions and lender reserves on boot so
    // the customer lending desk always has a working board after a rebuild. The
    // seed only touches rows whose id starts with `example-`, so real loans are
    // never modified.
    void ensureExampleLendingDesk()
      .then(() => console.log("[Lending] Example auctions ensured on startup"))
      .catch(error => console.error("[Lending] Startup example seed failed:", error instanceof Error ? error.message : "UnknownError"));
    startEmailWorkers();
    // Persist the durable daily report (`v5_reports` + `v5_email_jobs`) for every
    // customer once per UTC day after the administrator-configured close time.
    // The run is idempotent per customer and day, so this cheap periodic check is
    // safe to repeat and recovers the day if the host restarts before it ran.
    const runDailyReportCycle = () => runMonitoredWorkerCycle("daily-reports", () => runDailyEmailReports())
      .then(result => { if (!(result as any).skipped) console.log("[DailyReports] daily report run", result); })
      .catch(error => console.error("[DailyReports]", error instanceof Error ? error.message : error));
    const dailyReportTimer = registerWorkerInterval(() => { void runDailyReportCycle(); }, 60_000);
    dailyReportTimer.unref();
    void runDailyReportCycle();
    startHeartbeatWorker();
    // Durable queue polling is cheap while idle (indexed lookup only), processes
    // new qualifying credits promptly, and recovers jobs left by process restarts.
    let tradingTierQualificationCycleRunning=false;
    const runTradingTierQualificationCycle=async()=>{
      if(tradingTierQualificationCycleRunning)return;
      tradingTierQualificationCycleRunning=true;
      try{
        const result=await runMonitoredWorkerCycle("trading-tier-qualification",()=>runTradingTierQualificationWorkerCycle({batchSize:20}));
        if(result.claimed||result.retrying||result.dead)console.log("[TradingTierWorker] cycle",result);
      }catch(error){
        console.error("[TradingTierWorker] cycle failed",error instanceof Error?error.message:"UnknownError");
      }finally{
        tradingTierQualificationCycleRunning=false;
      }
    };
    const tradingTierQualificationTimer=registerWorkerInterval(()=>{void runTradingTierQualificationCycle();},5_000);
    tradingTierQualificationTimer.unref();
    void runTradingTierQualificationCycle();
    let notificationCampaignCycleRunning = false;
    const runNotificationCampaignCycle = async () => {
      if(notificationCampaignCycleRunning)return;
      notificationCampaignCycleRunning=true;
      try {
        const result=await runMonitoredWorkerCycle("notification-campaigns",()=>processNotificationCampaignLifecycle());
        if(result.expired||result.published||result.failed)console.log("[NotificationCampaigns] lifecycle",result);
      } catch(error) {
        const details = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; table?: unknown } : {};
        const message = typeof details.message === "string"
          ? details.message.replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]").slice(0, 500)
          : "No error message was provided";
        const code = details.code == null ? undefined : String(details.code).replace(/[^A-Z0-9_]/gi, "").slice(0, 80);
        const table = details.table == null ? undefined : String(details.table).replace(/[^A-Z0-9_]/gi, "").slice(0, 120);
        console.error("[NotificationCampaigns] lifecycle failed", {
          name: typeof details.name === "string" ? details.name.slice(0, 80) : "UnknownError",
          code,
          table,
          message,
        });
      } finally { notificationCampaignCycleRunning=false; }
    };
    const notificationCampaignTimer=registerWorkerInterval(()=>{void runNotificationCampaignCycle();},30_000);
    notificationCampaignTimer.unref();
    void runNotificationCampaignCycle();
    let miningCycleRunning = false;
    const runMiningCycle = async () => {
      if (miningCycleRunning) return;
      miningCycleRunning = true;
      try {
        const result = await runMonitoredWorkerCycle("mining-rewards", () => runMiningWorkerCycle());
        if (result.intervalsProcessed || result.conversionJobs.completed || result.conversionJobs.retrying) console.log("[MiningWorker] cycle", result);
      } catch (error) { console.error("[MiningWorker]", error instanceof Error ? error.message : error); }
      finally { miningCycleRunning = false; }
    };
    const miningWorkerTimer = registerWorkerInterval(() => { void runMiningCycle(); }, 30_000);
    miningWorkerTimer.unref();
    void runMiningCycle();
    const miningFeedTimer = registerWorkerInterval(() => { void runMonitoredWorkerCycle("mining-price-feeds", () => refreshMiningPriceFeeds()).then(result => console.log("[MiningFeeds] refreshed", result)).catch(error => console.error("[MiningFeeds]", error instanceof Error ? error.message : error)); }, 5 * 60_000);
    miningFeedTimer.unref();
    const popupRetentionTimer = registerWorkerInterval(() => { void runMonitoredWorkerCycle("popup-retention", () => runOpportunityRetention()).then(result => { if (result.expiredAssignments || result.deletedEvents || result.deletedDeliveryRows) console.log("[PopupRetention] expired generated assignments and archived old popup rows", result); }).catch(error => console.error("[PopupRetention]", error instanceof Error ? error.message : error)); }, 60 * 60_000);
    popupRetentionTimer.unref();
    void runMonitoredWorkerCycle("popup-retention", () => runOpportunityRetention()).catch(error => console.error("[PopupRetention]", error instanceof Error ? error.message : error));
    let tradeCycleRunning = false;
    let tradeCycleConsecutiveFailures = 0;
    let tradeCycleRetryAfterMs = 0;
    const tradeCycleBaseIntervalMs = 30_000;
    const tradeCycleMaximumBackoffMs = 5 * 60_000;
    const runTradeCycle = async () => {
      if (tradeCycleRunning || Date.now() < tradeCycleRetryAfterMs) return;
      tradeCycleRunning = true;
      try {
        let settlementReconciliation: Awaited<ReturnType<typeof reconcileAllDueTradesAwaitingConfirmation>> | null = null;
        let automaticMarketSettlement: Awaited<ReturnType<typeof processAutomaticMarketSettlements>> | null = null;
        let settlementCreditPosting: Awaited<ReturnType<typeof processConfirmedTradeCredits>> | null = null;
        try {
          settlementReconciliation = await runMonitoredWorkerCycle("settlement-reconciliation", () => reconcileAllDueTradesAwaitingConfirmation());
          if (settlementReconciliation.marked) console.log("[SettlementReconciliation] overdue trades marked for confirmation", settlementReconciliation);
        } catch (error) {
          console.error("[SettlementReconciliation] sweep failed", sanitizeWorkerErrorMessage(error));
        }
        try {
          automaticMarketSettlement = await runMonitoredWorkerCycle("automatic-market-settlement", () => processAutomaticMarketSettlements({ limit: 100 }));
          if (automaticMarketSettlement.settled) console.log("[AutomaticMarketSettlement] real market results recorded", automaticMarketSettlement);
        } catch (error) {
          console.error("[AutomaticMarketSettlement] sweep failed", sanitizeWorkerErrorMessage(error));
        }
        try {
          settlementCreditPosting = await runMonitoredWorkerCycle("settlement-credit-posting", () => processConfirmedTradeCredits({ limit: 100 }));
          if (settlementCreditPosting.credited) console.log("[TradeCreditPosting] confirmed wallet credits posted", settlementCreditPosting);
        } catch (error) {
          console.error("[TradeCreditPosting] confirmed wallet credit sweep failed", sanitizeWorkerErrorMessage(error));
        }
        const result = await runMonitoredWorkerCycle("trading-opportunities", async () => {
          const cycle = await runAutoTradeCycle();
          const outstandingTrades = await countOutstandingTrades();
          const marketReferenceOffers = await ensureMarketDrivenOpportunities(new Date());
          return { ...cycle, outstandingTrades, marketReferenceOffers };
        }, {
          degradedWhen: result => result.customerFailures > 0,
          degradedMessage: result => `Customer opportunity sub-cycle failures: ${result.customerFailures}`,
        });
        tradeCycleConsecutiveFailures = 0;
        tradeCycleRetryAfterMs = 0;
        console.log("[AutoTrade] cycle", { ...result, generationDiagnostics: result.generationDiagnostics, deliveryDiagnostics: result.deliveryDiagnostics, settlementReconciliation, automaticMarketSettlement, settlementCreditPosting });
      } catch (error) {
        tradeCycleConsecutiveFailures = Math.min(tradeCycleConsecutiveFailures + 1, 8);
        const backoffMs = Math.min(tradeCycleMaximumBackoffMs, tradeCycleBaseIntervalMs * (2 ** (tradeCycleConsecutiveFailures - 1)));
        tradeCycleRetryAfterMs = Date.now() + backoffMs;
        console.error("[AutoTrade] cycle failed; retry deferred", {
          event: "trading-cycle-failed",
          consecutiveFailures: tradeCycleConsecutiveFailures,
          retryDelayMs: backoffMs,
          retryAt: new Date(tradeCycleRetryAfterMs).toISOString(),
          error: sanitizeWorkerErrorMessage(error),
        });
        throw error;
      } finally {
        tradeCycleRunning = false;
      }
    };
    const autoTradeTimer = registerWorkerInterval(() => { void runTradeCycle().catch(() => undefined); }, 30_000);
    autoTradeTimer.unref();
    // Item 27: reads must not write. The repair of an invalid legacy
    // trade.settlementDelaySeconds value is an explicit one-time maintenance step that
    // runs once on startup (idempotent, lock-guarded), never from the policy read.
    void repairLegacyTradeSettlementPolicy()
      .then(repaired => { if (repaired) console.log("[TradeTimingPolicy] repaired invalid legacy settlement review delay to the immediate-settlement default of 0 seconds"); })
      .catch(error => console.error("[TradeTimingPolicy] startup repair failed", sanitizeWorkerErrorMessage(error)));
    // Item 19: one bounded startup catch-up clears any overdue automatic pop-up
    // trade before the periodic 30-second sweep takes over. It is idempotent
    // (row locks + unique settlement reference + walletUpdatedAt guard), so it is
    // safe alongside the immediate runTradeCycle() below and after any restart.
    void catchUpDueAutomaticSettlements({ limit: 250 })
      .then(result => {
        if (result.settlement.settled || result.credit.credited) {
          console.log("[SettlementCatchUp] credited overdue automatic trades on startup", result);
        }
      })
      .catch(error => console.error("[SettlementCatchUp] startup catch-up failed", sanitizeWorkerErrorMessage(error)));
    void runTradeCycle().catch(error => console.error("[AutoTrade]", sanitizeWorkerErrorMessage(error)));
    const refreshMinutes = Number(await getAppSetting("market.refreshIntervalMinutes", "120"));
    if (!Number.isFinite(refreshMinutes) || refreshMinutes < 1) { console.error("[MarketSync] Invalid market.refreshIntervalMinutes; using safe 120-minute fallback"); }
    const safeRefreshMinutes = Number.isFinite(refreshMinutes) && refreshMinutes >= 1 ? refreshMinutes : 120;
    const runMarketRefresh = async () => { const refreshed = await runMonitoredWorkerCycle("market-data-refresh", async () => { const result = await refreshMarketData(); const marketReferenceOffers = await ensureMarketDrivenOpportunities(result.refreshedAt); return { result, marketReferenceOffers }; }); console.log("[MarketSync] refreshed", { ...refreshed.result, marketReferenceOffers: refreshed.marketReferenceOffers }); };
    const marketSyncTimer = registerWorkerInterval(() => { void runMarketRefresh().catch(error => console.error("[MarketSync]", error instanceof Error ? error.message : error)); }, safeRefreshMinutes * 60_000);
    marketSyncTimer.unref();
    void runMarketRefresh().catch(error => console.error("[MarketSync]", error instanceof Error ? error.message : error));
    // Tender Bid: ingest the enabled government and private tender sources. A source
    // is only polled when it is due for its own configured interval, and the monitored
    // cycle prevents overlapping ticks. Per-source outcomes are recorded on
    // `tender_sources.lastStatus`; worker health is recorded in the health registry.
    const runTenderIngest = () => runMonitoredWorkerCycle("tender-ingest", () => runTenderIngestCycle(), {
      degradedWhen: result => result.sourcesFailed > 0,
      degradedMessage: result => `${result.sourcesFailed} tender source(s) failed during ingestion`,
    });
    const tenderIngestTimer = registerWorkerInterval(() => {
      void runTenderIngest()
        .then(result => { if (result.tendersUpserted || result.sourcesFailed) console.log("[TenderIngest] cycle", result); })
        .catch(error => console.error("[TenderIngest]", sanitizeWorkerErrorMessage(error)));
    }, 300_000);
    tenderIngestTimer.unref();
    void runTenderIngest().catch(error => console.error("[TenderIngest]", sanitizeWorkerErrorMessage(error)));
  } else {
    console.warn("[Database] DATABASE_URL is not configured; database workers are paused until production configuration is supplied.");
  }
  server.on("error", error => {
    console.error("[StartupDiagnostics] " + JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "http-server-error",
      name: error.name,
      code: (error as NodeJS.ErrnoException).code,
      syscall: (error as NodeJS.ErrnoException).syscall,
      address: (error as NodeJS.ErrnoException & { address?: string }).address,
      port: (error as NodeJS.ErrnoException & { port?: number }).port,
      message: String(error.message || "HTTP server error").replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]"),
      stack: String(error.stack || "").replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]").slice(0, 12000),
    }));
    process.exit(1);
  });
  console.info("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "http-listener-starting", host: "0.0.0.0", port }));
  server.listen(port, "0.0.0.0", () => {
    console.log("[StartupDiagnostics] " + JSON.stringify({ timestamp: new Date().toISOString(), event: "http-listener-ready", host: "0.0.0.0", port, healthPath: "/api/health" }));
    console.log(`Server listening on port ${port}`);
  });
}

startServer().catch(error => {
  const details = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown } : {};
  const redact = (value: unknown) => String(value ?? "").replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]");
  console.error("[StartupDiagnostics] " + JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "application-bootstrap-failed",
    name: typeof details.name === "string" ? details.name : "UnknownError",
    code: details.code == null ? undefined : String(details.code).replace(/[^A-Z0-9_]/gi, "").slice(0, 80),
    message: redact(details.message || "Startup failed without an error message").slice(0, 2000),
    stack: redact(details.stack || "").slice(0, 12000),
  }));
  process.exit(1);
});
