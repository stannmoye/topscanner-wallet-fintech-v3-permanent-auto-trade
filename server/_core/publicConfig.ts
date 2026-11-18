// Only browser-safe configuration is exposed. Restrict the Maps browser key
// by HTTP referrer in the provider console; no server secret is serialized.
//
// Item 52: the file only ever serves an empty string or a syntactically valid
// Google Maps JavaScript API browser key. It reads the dedicated
// `GOOGLE_MAPS_BROWSER_KEY` variable and nothing else — it never falls back to
// the server-only key, a database URL or any other environment variable — and a
// value that does not match the Google browser-key format is dropped to "" so a
// misconfigured or hostile value is never emitted into a public script.
const GOOGLE_MAPS_BROWSER_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/;

function browserSafeMapsKey(value: string | undefined): string {
  const candidate = (value ?? "").trim();
  return GOOGLE_MAPS_BROWSER_KEY_PATTERN.test(candidate) ? candidate : "";
}

export function publicPlatformConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    googleMapsBrowserKey: browserSafeMapsKey(env.GOOGLE_MAPS_BROWSER_KEY),
  };
}

export function publicPlatformScript(env: NodeJS.ProcessEnv = process.env): string {
  const json = JSON.stringify(publicPlatformConfig(env)).replaceAll("<", "\\u003c");
  return `window.__ARBITRADE_CONFIG__=${json};`;
}
