/**
 * Application-wide language context.
 *
 * The chosen language lives in `localStorage`, so it applies to the entire
 * site — including the sign-in and sign-up pages — and survives sign-out. The
 * provider installs the DOM auto-translator once the app mounts and keeps the
 * <html lang> attribute in sync.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  normalizeLanguageCode,
  readStoredLanguage,
  writeStoredLanguage,
  type SupportedLanguage,
} from "./languages";
import { createFreeTranslator } from "./text-translation";
import { createDomTranslator, type DomTranslator } from "./dom-translator";

export type LanguageContextValue = {
  /** Currently active language code (a value from SUPPORTED_LANGUAGES). */
  language: string;
  /** Switch language; validated against the supported set. */
  setLanguage: (code: string) => void;
  /** Reset to English and clear the stored preference. */
  resetLanguage: () => void;
  /** True briefly while a freshly selected language is being applied. */
  translating: boolean;
  supported: SupportedLanguage[];
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): string {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    return readStoredLanguage(window.localStorage);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>(initialLanguage);
  const [translating, setTranslating] = useState(false);
  const translatorRef = useRef<DomTranslator | null>(null);

  // Create the DOM translator once, on mount, and tear it down on unmount.
  useEffect(() => {
    const freeTranslator = createFreeTranslator();
    const domTranslator = createDomTranslator(freeTranslator.translate);
    translatorRef.current = domTranslator;
    return () => {
      domTranslator.destroy();
      translatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language;
    const domTranslator = translatorRef.current;
    if (!domTranslator) return;
    domTranslator.setLanguage(language);
    if (language === DEFAULT_LANGUAGE) {
      setTranslating(false);
      return;
    }
    setTranslating(true);
    const timer = setTimeout(() => setTranslating(false), 500);
    return () => clearTimeout(timer);
  }, [language]);

  const setLanguage = useCallback((code: string) => {
    const next = normalizeLanguageCode(code);
    if (typeof window !== "undefined") writeStoredLanguage(window.localStorage, next);
    setLanguageState(next);
  }, []);

  const resetLanguage = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      } catch {
        /* ignore storage failures */
      }
    }
    setLanguageState(DEFAULT_LANGUAGE);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, resetLanguage, translating, supported: SUPPORTED_LANGUAGES }),
    [language, setLanguage, resetLanguage, translating],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Read the language context; safe to call outside the provider (falls back to English). */
export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  return (
    context || {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => undefined,
      resetLanguage: () => undefined,
      translating: false,
      supported: SUPPORTED_LANGUAGES,
    }
  );
}
