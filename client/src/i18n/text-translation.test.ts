import { describe, expect, it, vi } from "vitest";
import {
  createFreeTranslator,
  extractGoogleTranslation,
  extractMyMemoryTranslation,
  shouldTranslateText,
  translationCacheKey,
} from "./text-translation";

const googlePayload = (text: string) => [[[text, "source", null, null, 10]], null, "en"];

function jsonResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response;
}

describe("shouldTranslateText", () => {
  it("accepts human-readable English copy", () => {
    expect(shouldTranslateText("Welcome back")).toBe(true);
    expect(shouldTranslateText("Save changes")).toBe(true);
  });

  it("rejects numbers, currency, blanks and very long blobs", () => {
    expect(shouldTranslateText("")).toBe(false);
    expect(shouldTranslateText("   ")).toBe(false);
    expect(shouldTranslateText("12")).toBe(false);
    expect(shouldTranslateText("$1,200.00")).toBe(false);
    expect(shouldTranslateText("14:32:07")).toBe(false);
    expect(shouldTranslateText("a".repeat(2000))).toBe(false);
  });
});

describe("payload extraction", () => {
  it("joins Google Translate segments", () => {
    const payload = [[["Hola", "Hello"], [" mundo", " world"]], null, "en"];
    expect(extractGoogleTranslation(payload)).toBe("Hola mundo");
    expect(extractGoogleTranslation(null)).toBe("");
  });

  it("reads MyMemory translations and rejects warnings", () => {
    expect(extractMyMemoryTranslation({ responseData: { translatedText: "Bonjour" } })).toBe("Bonjour");
    expect(extractMyMemoryTranslation({ responseData: { translatedText: "MYMEMORY WARNING: quota" } })).toBe("");
    expect(extractMyMemoryTranslation(undefined)).toBe("");
  });

  it("builds stable, collision-free cache keys", () => {
    expect(translationCacheKey("Hello", "es")).toBe(translationCacheKey("Hello", "es"));
    expect(translationCacheKey("Hello", "es")).not.toBe(translationCacheKey("Hello", "fr"));
  });
});

describe("createFreeTranslator", () => {
  it("returns the source unchanged for English", async () => {
    const fetcher = vi.fn();
    const translator = createFreeTranslator(fetcher as unknown as typeof fetch);
    expect(await translator.translate("Hello", "en")).toBe("Hello");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the Google endpoint first and caches results", async () => {
    const fetcher = vi.fn(async () => jsonResponse(googlePayload("Hola")));
    const translator = createFreeTranslator(fetcher as unknown as typeof fetch);
    expect(await translator.translate("Hello", "es")).toBe("Hola");
    expect(await translator.translate("Hello", "es")).toBe("Hola");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(translator.cacheSize()).toBe(1);
  });

  it("falls back to MyMemory when Google fails", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("translate.googleapis")) throw new Error("blocked");
      return jsonResponse({ responseData: { translatedText: "Bonjour" } });
    });
    const translator = createFreeTranslator(fetcher as unknown as typeof fetch);
    expect(await translator.translate("Hello", "fr")).toBe("Bonjour");
  });

  it("returns the source text when every provider fails", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => null } as unknown as Response));
    const translator = createFreeTranslator(fetcher as unknown as typeof fetch);
    expect(await translator.translate("Hello", "de")).toBe("Hello");
  });

  it("de-duplicates concurrent requests for the same string", async () => {
    const fetcher = vi.fn(async () => jsonResponse(googlePayload("Ciao")));
    const translator = createFreeTranslator(fetcher as unknown as typeof fetch);
    const [a, b] = await Promise.all([translator.translate("Hello", "it"), translator.translate("Hello", "it")]);
    expect(a).toBe("Ciao");
    expect(b).toBe("Ciao");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
