import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  findLanguage,
  normalizeLanguageCode,
  readStoredLanguage,
  targetCodeFor,
  writeStoredLanguage,
} from "./languages";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("supported languages", () => {
  it("offers twelve popular languages with English as the default", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(12);
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(SUPPORTED_LANGUAGES[0].code).toBe("en");
  });

  it("uses unique codes and excludes Arabic / right-to-left scripts", () => {
    const codes = SUPPORTED_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain("ar");
    expect(codes).not.toContain("he");
    expect(codes).not.toContain("fa");
  });

  it("resolves codes, native labels and translation targets", () => {
    expect(findLanguage("es")?.nativeLabel).toBe("Español");
    expect(findLanguage("zh-CN")?.target).toBe("zh-CN");
    expect(targetCodeFor("zh-CN")).toBe("zh-CN");
    expect(findLanguage("nope")).toBeNull();
  });
});

describe("language normalisation and storage", () => {
  it("falls back to English for unknown codes", () => {
    expect(normalizeLanguageCode("xx")).toBe("en");
    expect(normalizeLanguageCode(null)).toBe("en");
    expect(normalizeLanguageCode("fr")).toBe("fr");
  });

  it("persists and reads the choice from storage", () => {
    const storage = fakeStorage();
    writeStoredLanguage(storage, "de");
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    expect(readStoredLanguage(storage)).toBe("de");
  });

  it("reads English when storage is empty or invalid", () => {
    expect(readStoredLanguage(fakeStorage())).toBe("en");
    expect(readStoredLanguage(fakeStorage({ [LANGUAGE_STORAGE_KEY]: "klingon" }))).toBe("en");
  });

  it("never throws when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredLanguage(broken)).toBe("en");
    expect(() => writeStoredLanguage({ setItem: () => { throw new Error("blocked"); } }, "es")).not.toThrow();
  });
});
