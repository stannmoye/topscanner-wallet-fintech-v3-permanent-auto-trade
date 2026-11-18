import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TIMING_DECOY_PASSWORD_HASH, passwordHash, verifyPassword } from "./_core/localAuth";

const indexSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
const database = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const localAuth = readFileSync(new URL("./_core/localAuth.ts", import.meta.url), "utf8");

// Item 45: registration and login must not reveal whether an email address is registered.
describe("auth enumeration hardening", () => {
  it("returns a generic registration error and never surfaces the underlying cause", () => {
    const start = indexSource.indexOf('app.post("/api/customer/register"');
    const end = indexSource.indexOf('app.post("/api/customer/login"', start);
    const handler = indexSource.slice(start, end);
    expect(handler).toContain("We could not create your account with those details. If you already have an account, sign in or reset your password instead.");
    // The response must be a fixed string, never the caught error's message.
    expect(handler).not.toContain("json({ error: error instanceof Error ? error.message");
    // The real cause is logged server-side only.
    expect(handler).toContain('console.error("[Auth] Customer registration failed:"');
    expect(database).not.toContain("An account with this email already exists");
  });

  it("uses one identical login failure message for customer and administrator logins", () => {
    const customerStart = indexSource.indexOf('app.post("/api/customer/login"');
    const adminStart = indexSource.indexOf('app.post("/api/admin/login"', customerStart);
    const adminEnd = indexSource.indexOf('app.post("/api/customer/password-reset/request"', adminStart);
    const customerLogin = indexSource.slice(customerStart, adminStart);
    const adminLogin = indexSource.slice(adminStart, adminEnd);
    expect(customerLogin).toContain('{ error: "Invalid email or password" }');
    expect(adminLogin).toContain('{ error: "Invalid email or password" }');
    expect(indexSource).not.toContain("Invalid administrator credentials");
  });

  it("equalizes login timing by verifying one password hash even for unknown emails", () => {
    expect(indexSource).toContain("TIMING_DECOY_PASSWORD_HASH");
    const uses = indexSource.match(/verifyPassword\(String\(password \|\| ""\), user\?\.passwordHash \?\? TIMING_DECOY_PASSWORD_HASH\)/g) ?? [];
    // One occurrence in the customer login and one in the administrator login.
    expect(uses).toHaveLength(2);
    expect(localAuth).toContain("export const TIMING_DECOY_PASSWORD_HASH");
  });

  it("provides a valid, non-matching decoy hash so unknown-email verification still performs real work", () => {
    expect(TIMING_DECOY_PASSWORD_HASH.startsWith("scrypt$")).toBe(true);
    const [scheme, salt, digest] = TIMING_DECOY_PASSWORD_HASH.split("$");
    expect(scheme).toBe("scrypt");
    expect(salt).toMatch(/^[a-f0-9]{32}$/);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    // It must never authenticate any supplied password.
    expect(verifyPassword("", TIMING_DECOY_PASSWORD_HASH)).toBe(false);
    expect(verifyPassword("password", TIMING_DECOY_PASSWORD_HASH)).toBe(false);
    // Sanity: a genuine hash still verifies and a wrong password still fails.
    const real = passwordHash("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", real)).toBe(true);
    expect(verifyPassword("wrong password", real)).toBe(false);
  });
});
