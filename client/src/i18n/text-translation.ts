/**
 * Runtime, key-less translation using free public APIs.
 *
 * The workspace has no hand-written translation catalogue: every page is
 * authored in English and translated on demand. Two free, no-API-key services
 * are tried, in order, so a single provider's outage or rate limit degrades to
 * the next rather than failing:
 *
 *   1. Google Translate public endpoint (client=gtx) — free, no key.
 *   2. MyMemory translation memory API — free, no key.
 *
 * When both fail (offline, blocked, rate-limited) the original English text is
 * returned unchanged, so the interface is never left blank or broken.
 */

/** Separator that cannot appear inside a UI string, used to build cache keys. */
const CACHE_KEY_SEPARATOR = "\u0000";

/**
 * Should this string be sent for translation? Only human-readable English text
 * qualifies; numbers, ids, currency symbols, and very long blobs are skipped so
 * we do not waste free-API quota or risk mangling machine values.
 */
export function shouldTranslateText(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (trimmed.length < 2) return false;
  if (trimmed.length > 1500) return false;
  // Must contain at least one letter — skips pure numbers, times, and ticks.
  if (!/[A-Za-z]/.test(trimmed)) return false;
  // Skip strings that are only digits, punctuation and currency symbols.
  if (/^[\d\s.,:;/\-–%$€£¥+=()#&@!'"*]+$/.test(trimmed)) return false;
  return true;
}

/** Stable key for a (source, target) pair. */
export function translationCacheKey(source: string, target: string): string {
  return `${target}${CACHE_KEY_SEPARATOR}${source}`;
}

export type TranslateFn = (text: string, target: string) => Promise<string>;

/** Extract the translated string from a Google `translate_a/single` payload. */
export function extractGoogleTranslation(payload: unknown): string {
  const first = Array.isArray(payload) ? (payload as unknown[])[0] : null;
  if (!Array.isArray(first)) return "";
  return (first as unknown[])
    .map((segment) => (Array.isArray(segment) ? String((segment as unknown[])[0] ?? "") : ""))
    .join("")
    .trim();
}

/** Extract the translated string from a MyMemory `get` payload. */
export function extractMyMemoryTranslation(payload: unknown): string {
  const data = payload && typeof payload === "object" ? (payload as { responseData?: { translatedText?: unknown } }) : null;
  const value = String(data?.responseData?.translatedText ?? "").trim();
  if (!value || /^MYMEMORY WARNING/i.test(value)) return "";
  return value;
}

type Fetcher = typeof fetch;

async function requestGenericTranslation(text: string, target: string, fetcher: Fetcher): Promise<string> {
  // 1. Google Translate public endpoint.
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetcher(url, { cache: "no-store" });
    if (response.ok) {
      const result = extractGoogleTranslation(await response.json());
      if (result) return result;
    }
  } catch {
    /* fall through to the next provider */
  }
  // 2. MyMemory translation memory.
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`en|${target}`)}`;
    const response = await fetcher(url, { cache: "no-store" });
    if (response.ok) {
      const result = extractMyMemoryTranslation(await response.json());
      if (result) return result;
    }
  } catch {
    /* fall back to the source text */
  }
  return text;
}

export type FreeTranslator = {
  translate: TranslateFn;
  cacheSize: () => number;
};

/**
 * Build a translator with a per-page in-memory cache and in-flight de-duping so
 * the same string is never requested twice while a request is pending.
 */
export function createFreeTranslator(fetcher: Fetcher = fetch): FreeTranslator {
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<string>>();

  const translate: TranslateFn = async (text, target) => {
    if (!target || target === "en") return text;
    const key = translationCacheKey(text, target);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const job = requestGenericTranslation(text, target, fetcher)
      .then((result) => {
        cache.set(key, result);
        return result;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, job);
    return job;
  };

  return { translate, cacheSize: () => cache.size };
}
