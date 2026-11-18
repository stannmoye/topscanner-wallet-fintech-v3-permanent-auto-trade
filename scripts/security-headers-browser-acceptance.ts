// Item 21 browser acceptance: load the built application in real Chromium with
// the Content-Security-Policy ENFORCED and fail if the app fails to boot or the
// browser reports any CSP violation.
//
// Production ships the same policy in Report-Only mode (see
// server/_core/securityHeaders.ts), so this script is the compatibility probe
// that must stay green before the policy is enforced in production.
//
// It serves dist/public from an in-process static server, so run it after
// `pnpm build:static` (or `pnpm build`). It deliberately exercises the whole
// built bundle — fonts, images, lazy route chunks and the SPA shell — because a
// blocked sub-resource is what a bad CSP looks like in practice.
//
// Run with:  pnpm exec tsx scripts/security-headers-browser-acceptance.ts
//
// Limitation: the authenticated customer and admin screens need a live database
// and a signed-in session, so this probe covers the application shell and every
// route the bundle loads for an anonymous visitor. Those authenticated screens
// are why the production CSP is Report-Only rather than enforcing.

import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../server/_core/securityHeaders";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist", "public");
const ROUTES = ["/", "/customer", "/ops-console-7f3a"];
const PORT = Number(process.env.SECURITY_HEADERS_PORT || 4174);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};

// The other headers are always enforced, so index them by their production name.
const securityHeaders = buildSecurityHeaders("production");
const policy = buildContentSecurityPolicy({ development: false });

function sendFile(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body?: unknown) => void }, filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    ...securityHeaders,
    // Enforce the policy for the probe even though production ships it report-only.
    "Content-Security-Policy": policy,
    "Content-Type": MIME[extension] || "application/octet-stream",
  });
  res.end(readFileSync(filePath));
}

const server = createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (requestPath === "/api/platform/config.js") {
    res.writeHead(200, { ...securityHeaders, "Content-Security-Policy": policy, "Content-Type": "application/javascript" });
    res.end('window.__ARBITRADE_CONFIG__={"googleMapsBrowserKey":""};');
    return;
  }
  const candidate = path.join(DIST, requestPath);
  try {
    if (statSync(candidate).isFile()) return sendFile(res, candidate);
  } catch {
    // fall through to the SPA shell
  }
  sendFile(res, path.join(DIST, "index.html"));
});

async function main() {
  try {
    statSync(path.join(DIST, "index.html"));
  } catch {
    throw new Error(`Missing ${DIST}/index.html — run the client build first (pnpm build:static).`);
  }

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({ headless: true });
  const failures: string[] = [];
  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      const violations: string[] = [];
      page.on("console", (message) => {
        const text = message.text();
        if (/content security policy/i.test(text) || /refused to (load|execute|connect|apply)/i.test(text)) violations.push(text);
      });
      page.on("pageerror", (error) => violations.push(`pageerror: ${error.message}`));
      await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForSelector("#root > *", { timeout: 15000 }).catch(() => undefined);
      const rootChildren = await page.evaluate(() => document.getElementById("root")?.childElementCount ?? 0);
      if (rootChildren === 0) failures.push(`${route}: the application shell did not render (empty #root)`);
      if (violations.length) failures.push(`${route}: CSP violations reported by the browser:\n    ${violations.join("\n    ")}`);
      console.log(`${failures.length ? "✗" : "✓"} ${route} — root children=${rootChildren}, violations=${violations.length}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  if (failures.length) {
    console.error(`\nSecurity-header browser acceptance failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nSecurity-header browser acceptance passed (${ROUTES.length} routes, zero CSP violations under the enforced policy).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
