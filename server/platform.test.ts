import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPlatformConfig, publicPlatformScript } from "./_core/publicConfig";
import { getSessionCookieOptions } from "./_core/cookies";
import { createLocalSession, passwordHash, verifyLocalSession, verifyPassword } from "./_core/localAuth";
import { listLLMModels } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { deleteStorageObject } from "./storage";
import { COOKIE_NAME } from "../shared/const";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("self-hosted platform integrations", () => {
  const VALID_MAPS_KEY = "AIza" + "b".repeat(35);

  it("exposes only a valid, browser-safe Google Maps key and never falls back to another variable", () => {
    const env = {
      GOOGLE_MAPS_BROWSER_KEY: VALID_MAPS_KEY,
      GOOGLE_MAPS_SERVER_KEY: "server-only-test",
      DATABASE_URL: "db-only-test",
      SESSION_SECRET: "session-only-test",
      PASSWORD_PEPPER: "pepper-only-test",
      AI_API_KEY: "ai-secret-test",
      EMAIL_CREDENTIAL_SECRET: "mail-secret-test",
    };
    expect(publicPlatformConfig(env)).toEqual({ googleMapsBrowserKey: VALID_MAPS_KEY });
    const script = publicPlatformScript(env);
    for (const value of [env.GOOGLE_MAPS_SERVER_KEY, env.DATABASE_URL, env.SESSION_SECRET, env.PASSWORD_PEPPER, env.AI_API_KEY, env.EMAIL_CREDENTIAL_SECRET]) {
      expect(script).not.toContain(value);
    }
    expect(script).toContain("window.__ARBITRADE_CONFIG__=");
  });

  it("never falls back to another variable and drops a malformed browser key", () => {
    expect(publicPlatformConfig({ GOOGLE_MAPS_SERVER_KEY: "server-only-test" })).toEqual({ googleMapsBrowserKey: "" });
    expect(publicPlatformConfig({ GOOGLE_MAPS_BROWSER_KEY: "public-browser-test" })).toEqual({ googleMapsBrowserKey: "" });
    expect(publicPlatformConfig({ GOOGLE_MAPS_BROWSER_KEY: "AIza-short" })).toEqual({ googleMapsBrowserKey: "" });
  });

  it("emits only a valid key and never lets non-key input reach the public script", () => {
    const payload = "</script><script>window.pwned=true</script>";
    const script = publicPlatformScript({ GOOGLE_MAPS_BROWSER_KEY: payload });
    expect(script).not.toContain("<");
    expect(script).toContain('"googleMapsBrowserKey":""');
    const fakeWindow: { __ARBITRADE_CONFIG__?: Record<string, string> } = {};
    new Function("window", script)(fakeWindow);
    expect(fakeWindow.__ARBITRADE_CONFIG__?.googleMapsBrowserKey).toBe("");

    const validScript = publicPlatformScript({ GOOGLE_MAPS_BROWSER_KEY: VALID_MAPS_KEY });
    const validWindow: { __ARBITRADE_CONFIG__?: Record<string, string> } = {};
    new Function("window", validScript)(validWindow);
    expect(validWindow.__ARBITRADE_CONFIG__?.googleMapsBrowserKey).toBe(VALID_MAPS_KEY);
  });

  it("fails closed when a remote AI provider has no key and never guesses a hosted endpoint", async () => {
    vi.stubEnv("AI_API_BASE_URL", "https://api.example/v1");
    vi.stubEnv("AI_API_KEY", "");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(listLLMModels()).rejects.toThrow("AI_API_KEY is required");
    expect(request).not.toHaveBeenCalled();
  });

  it("writes generated image bytes to local persistent storage, not an object-storage proxy", async () => {
    vi.stubEnv("IMAGE_API_BASE_URL", "http://127.0.0.1:11434/v1");
    vi.stubEnv("IMAGE_API_KEY", "");
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    const image = await generateImage({ prompt: "test", originalImages: [] });
    expect(image.url).toMatch(/^\/storage\/generated\//);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ prompt: "test", n: 1 });
    await deleteStorageObject(image.url!.slice("/storage/".length));
  });

  it("uses local password hashes and signed local sessions without hosted credentials", () => {
    vi.stubEnv("SESSION_SECRET", "unit-test-signing-key-never-deployed");
    const hash = passwordHash("test-password-123");
    expect(verifyPassword("test-password-123", hash)).toBe(true);
    expect(verifyPassword("not-the-password", hash)).toBe(false);
    const token = createLocalSession(123, 7);
    expect(verifyLocalSession(token)).toMatchObject({ userId: 123, authVersion: 7 });
    expect(verifyLocalSession(token + "tampered")).toBeNull();
  });

  it("uses production-safe application cookies without hosted preview cross-site settings", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(COOKIE_NAME).toBe("arbitrade_app_session");
    expect(getSessionCookieOptions({ protocol: "http", headers: {}, secure: false } as never)).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
    vi.stubEnv("NODE_ENV", "development");
    expect(getSessionCookieOptions({ protocol: "http", headers: {}, secure: false } as never)).toMatchObject({ secure: false, httpOnly: true, sameSite: "lax" });
  });

});
