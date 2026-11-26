import type { TenderSourceKind } from "./provider";

/**
 * Tender Bid — source registry.
 *
 * The canonical, code-owned catalogue of tender sources. `drizzle/0125_tender_bid.sql`
 * seeds `tender_sources` from this list on migration; at runtime each row is
 * administrator-controlled (enabled/disabled, health). Keep this list and the
 * seed in the migration in lockstep — `tender-stage1.contract.test.ts` asserts
 * they match.
 *
 * The 23 country entries are the primary national source per country. The
 * supranational entries are additional private/development-bank feeds that cover
 * many of the same countries and act as a resilient fallback.
 */
export type TenderSourceDefinition = {
  /** Stable registry key, unique across the catalogue. */
  key: string;
  label: string;
  /** ISO 3166-1 alpha-2, or "" for supranational sources. */
  countryCode: string;
  kind: TenderSourceKind;
  /** Provider implementation name (see `TenderProvider.key` of the adapter). */
  adapter: string;
};

/** The 23 national sources, one primary source per covered country. */
export const TENDER_COUNTRY_SOURCES: readonly TenderSourceDefinition[] = [
  { key: "sam_gov", label: "SAM.gov Get Opportunities (United States)", countryCode: "US", kind: "government", adapter: "sam_gov" },
  { key: "uk_find_a_tender", label: "Find a Tender (United Kingdom)", countryCode: "GB", kind: "government", adapter: "find_a_tender" },
  { key: "canada_buys", label: "CanadaBuys (Canada)", countryCode: "CA", kind: "government", adapter: "canada_buys" },
  { key: "de_oeffentlichevergabe", label: "oeffentlichevergabe.de (Germany)", countryCode: "DE", kind: "government", adapter: "oeffentlichevergabe" },
  { key: "fr_boamp", label: "BOAMP / PLACE (France)", countryCode: "FR", kind: "government", adapter: "boamp" },
  { key: "nl_tenderned", label: "TenderNed (Netherlands)", countryCode: "NL", kind: "government", adapter: "tenderned" },
  { key: "be_enotification", label: "e-Notification (Belgium)", countryCode: "BE", kind: "government", adapter: "enotification" },
  { key: "es_placsp", label: "Plataforma de Contratacion del Sector Publico (Spain)", countryCode: "ES", kind: "government", adapter: "placsp" },
  { key: "it_anac", label: "ANAC / contratti pubblici (Italy)", countryCode: "IT", kind: "government", adapter: "anac" },
  { key: "pl_ezamowienia", label: "e-Zamowienia (Poland)", countryCode: "PL", kind: "government", adapter: "ezamowienia" },
  { key: "dk_udbud", label: "udbud.dk (Denmark)", countryCode: "DK", kind: "government", adapter: "udbud" },
  { key: "fi_hilma", label: "HILMA (Finland)", countryCode: "FI", kind: "government", adapter: "hilma" },
  { key: "ie_etenders", label: "eTenders (Ireland)", countryCode: "IE", kind: "government", adapter: "etenders" },
  { key: "no_doffin", label: "Doffin (Norway)", countryCode: "NO", kind: "government", adapter: "doffin" },
  { key: "ch_simap", label: "simap.ch (Switzerland)", countryCode: "CH", kind: "government", adapter: "simap" },
  { key: "au_austender", label: "AusTender (Australia)", countryCode: "AU", kind: "government", adapter: "austender" },
  { key: "in_cppp", label: "CPPP / eProcure (India)", countryCode: "IN", kind: "government", adapter: "cppp" },
  { key: "ng_nocopo", label: "NOCOPO / BPP (Nigeria)", countryCode: "NG", kind: "government", adapter: "nocopo" },
  { key: "ke_ppip", label: "PPIP / e-GP (Kenya)", countryCode: "KE", kind: "government", adapter: "ppip" },
  { key: "za_etenders", label: "eTenders National Treasury (South Africa)", countryCode: "ZA", kind: "government", adapter: "za_etenders" },
  { key: "gh_ghaneps", label: "GHANEPS (Ghana)", countryCode: "GH", kind: "government", adapter: "ghaneps" },
  { key: "ae_etimad", label: "Etimad / aggregator (United Arab Emirates)", countryCode: "AE", kind: "private", adapter: "etimad" },
  { key: "sa_etimad", label: "Etimad / aggregator (Saudi Arabia)", countryCode: "SA", kind: "private", adapter: "etimad" },
];

/** Additional supranational/private feeds used as resilient fallbacks. */
export const TENDER_SUPRANATIONAL_SOURCES: readonly TenderSourceDefinition[] = [
  { key: "eu_ted", label: "EU TED (Europe)", countryCode: "", kind: "private", adapter: "ted" },
  { key: "world_bank", label: "World Bank procurement (supranational)", countryCode: "", kind: "private", adapter: "world_bank" },
  { key: "ungm", label: "UNGM (United Nations)", countryCode: "", kind: "private", adapter: "ungm" },
  { key: "afdb", label: "African Development Bank (supranational)", countryCode: "", kind: "private", adapter: "afdb" },
  { key: "adb", label: "Asian Development Bank (supranational)", countryCode: "", kind: "private", adapter: "adb" },
];

/** The complete source catalogue seeded into `tender_sources`. */
export const TENDER_SOURCES: readonly TenderSourceDefinition[] = [
  ...TENDER_COUNTRY_SOURCES,
  ...TENDER_SUPRANATIONAL_SOURCES,
];

/** Look up a source definition by its registry key. */
export function getTenderSource(key: string): TenderSourceDefinition | undefined {
  return TENDER_SOURCES.find((source) => source.key === key);
}

/** The covered ISO 3166-1 alpha-2 country codes, in registry order. */
export function listTenderCountryCodes(): string[] {
  return TENDER_COUNTRY_SOURCES.map((source) => source.countryCode);
}
