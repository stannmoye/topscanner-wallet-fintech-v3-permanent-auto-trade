/**
 * Tender Bid — best-effort country-name → ISO 3166-1 alpha-2 mapping.
 *
 * Supranational feeds (World Bank and similar) name a tender's country instead of
 * giving a code. This maps the covered countries plus common names so a
 * supranational tender can carry a country; an unknown name becomes an empty
 * string (kept, never guessed to a wrong country).
 */
const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "united kingdom": "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  canada: "CA",
  germany: "DE",
  france: "FR",
  netherlands: "NL",
  "the netherlands": "NL",
  belgium: "BE",
  spain: "ES",
  italy: "IT",
  poland: "PL",
  denmark: "DK",
  finland: "FI",
  ireland: "IE",
  norway: "NO",
  switzerland: "CH",
  australia: "AU",
  india: "IN",
  nigeria: "NG",
  kenya: "KE",
  "south africa": "ZA",
  ghana: "GH",
  "united arab emirates": "AE",
  "saudi arabia": "SA",
  turkey: "TR",
  "türkiye": "TR",
  brazil: "BR",
  mexico: "MX",
  china: "CN",
  japan: "JP",
  indonesia: "ID",
  philippines: "PH",
  vietnam: "VN",
  bangladesh: "BD",
  pakistan: "PK",
  egypt: "EG",
  morocco: "MA",
  tunisia: "TN",
  uganda: "UG",
  tanzania: "TZ",
  ethiopia: "ET",
  "sri lanka": "LK",
  nepal: "NP",
};

/** Resolve a country name to its ISO alpha-2 code, or "" when unknown. */
export function toIsoCountryCode(countryName: unknown): string {
  if (typeof countryName !== "string") return "";
  const key = countryName.trim().toLowerCase().replace(/[.,]/g, "");
  if (!key) return "";
  if (COUNTRY_NAME_TO_ISO2[key]) return COUNTRY_NAME_TO_ISO2[key];
  // Try the first segment of names like "India; Sri Lanka".
  const firstSegment = key.split(/[;/(]/)[0]?.trim() ?? "";
  return COUNTRY_NAME_TO_ISO2[firstSegment] ?? "";
}
