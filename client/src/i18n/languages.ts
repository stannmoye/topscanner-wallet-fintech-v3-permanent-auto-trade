/**
 * Supported interface languages for the customer "Language & time" preference.
 *
 * The whole workspace is authored in English and translated at runtime by a
 * free, key-less translation API (see `text-translation.ts`). This list is the
 * fixed set the customer can pick from. Only left-to-right scripts are
 * included: Arabic and other right-to-left scripts are intentionally excluded
 * because the layout is not mirrored for them yet.
 */

export type SupportedLanguage = {
  /** Stable code stored in localStorage and used as the picker value. */
  code: string;
  /** English name shown in the picker. */
  label: string;
  /** The language's own endonym, e.g. "Español". */
  nativeLabel: string;
  /** Translation-API target code (differs from `code` only for Chinese). */
  target: string;
};

/** English is the authoring language and the reset default. */
export const DEFAULT_LANGUAGE = "en";

/** localStorage key that survives sign-out so the choice applies site-wide. */
export const LANGUAGE_STORAGE_KEY = "wisebond-language";

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", target: "en" },
  { code: "es", label: "Spanish", nativeLabel: "Español", target: "es" },
  { code: "fr", label: "French", nativeLabel: "Français", target: "fr" },
  { code: "de", label: "German", nativeLabel: "Deutsch", target: "de" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", target: "pt" },
  { code: "it", label: "Italian", nativeLabel: "Italiano", target: "it" },
  { code: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "简体中文", target: "zh-CN" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", target: "ja" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", target: "ko" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", target: "hi" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", target: "ru" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe", target: "tr" },
];

const LANGUAGE_BY_CODE = new Map(SUPPORTED_LANGUAGES.map((language) => [language.code, language]));

/** Look up a supported language, returning null when the code is unknown. */
export function findLanguage(code: string | null | undefined): SupportedLanguage | null {
  return LANGUAGE_BY_CODE.get(String(code || "").trim()) || null;
}

/** Coerce any stored/selected value to a supported code, defaulting to English. */
export function normalizeLanguageCode(code: string | null | undefined): string {
  return findLanguage(code)?.code || DEFAULT_LANGUAGE;
}

/** The translation-API target code for a supported language code. */
export function targetCodeFor(code: string | null | undefined): string {
  return findLanguage(code)?.target || DEFAULT_LANGUAGE;
}

/** Read the persisted language from a Storage object (never throws). */
export function readStoredLanguage(storage: Pick<Storage, "getItem"> | null | undefined): string {
  try {
    return normalizeLanguageCode(storage?.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Persist the language so it survives refresh and sign-out (never throws). */
export function writeStoredLanguage(storage: Pick<Storage, "setItem"> | null | undefined, code: string): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguageCode(code));
  } catch {
    /* storage can be unavailable (private mode); the choice is session-only then */
  }
}
