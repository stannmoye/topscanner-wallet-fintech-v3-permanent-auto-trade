import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalSession, verifyLocalSession } from "./localAuth";

const originalSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

describe("local session authentication version", () => {
  it("signs and returns the authentication version in a local session", () => {
    process.env.SESSION_SECRET = "local-auth-test-secret";
    const token = createLocalSession(42, 7);
    expect(verifyLocalSession(token)).toMatchObject({ userId: 42, authVersion: 7 });
  });

  it("rejects tampering with the signed authentication version", () => {
    process.env.SESSION_SECRET = "local-auth-test-secret";
    const token = createLocalSession(42, 7);
    const parts = token.split(".");
    parts[2] = "8";
    expect(verifyLocalSession(parts.join("."))).toBeNull();
  });

  it("rejects missing and malformed session tokens", () => {
    process.env.SESSION_SECRET = "local-auth-test-secret";
    expect(verifyLocalSession(undefined)).toBeNull();
    expect(verifyLocalSession("not-a-session")).toBeNull();
  });

  it("refuses to sign or verify sessions without a real SESSION_SECRET in any environment", () => {
    delete process.env.SESSION_SECRET;
    expect(() => createLocalSession(1, 0)).toThrow(/SESSION_SECRET/);
    // A missing secret must never be replaced by a shared public fallback.
    expect(() => verifyLocalSession("1.9999999999.0.deadbeef")).toThrow(/SESSION_SECRET/);
  });

  it("no longer ships the public development session-secret fallback or a production-only gate", () => {
    const localAuthSource = readFileSync(new URL("./localAuth.ts", import.meta.url), "utf8");
    const heartbeatSource = readFileSync(new URL("./heartbeat.ts", import.meta.url), "utf8");
    const serverSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    for (const source of [localAuthSource, heartbeatSource, serverSource]) {
      expect(source).not.toContain("development-only-session-secret");
    }
    // The startup guard must require the secret in every environment.
    expect(serverSource).toContain("if (!process.env.SESSION_SECRET?.trim())");
    expect(serverSource).toContain("Refusing to start.");
  });
});
