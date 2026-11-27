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
 * The country entries are the primary national source per country: the original
 * 23, plus 27 added in stage 8 — 50 in total. The supranational entries are
 * additional private/development-bank feeds that cover many of the same
 * countries and act as a resilient fallback.
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
  { key: "ua_prozorro", label: "Prozorro (Ukraine)", countryCode: "UA", kind: "government", adapter: "prozorro" },
  { key: "br_pncp", label: "PNCP Portal Nacional de Contratacoes Publicas (Brazil)", countryCode: "BR", kind: "government", adapter: "pncp" },
  { key: "cl_mercado_publico", label: "Mercado Publico (Chile)", countryCode: "CL", kind: "government", adapter: "mercado_publico" },
  { key: "co_secop_ii", label: "SECOP II (Colombia)", countryCode: "CO", kind: "government", adapter: "secop_ii" },
  { key: "kr_koneps", label: "KONEPS / nara-jangteo (South Korea)", countryCode: "KR", kind: "government", adapter: "koneps" },
  { key: "pe_oece", label: "OECE Contrataciones Abiertas (Peru)", countryCode: "PE", kind: "government", adapter: "oece" },
  { key: "kz_goszakup", label: "Goszakup (Kazakhstan)", countryCode: "KZ", kind: "government", adapter: "goszakup" },
  { key: "tr_ekap", label: "EKAP Elektronik Kamu Alimlari Platformu (Turkiye)", countryCode: "TR", kind: "government", adapter: "ekap" },
  { key: "mx_comprasmx", label: "ComprasMX (Mexico)", countryCode: "MX", kind: "government", adapter: "comprasmx" },
  { key: "cn_ccgp", label: "China Government Procurement (CCGP)", countryCode: "CN", kind: "government", adapter: "ccgp" },
  { key: "jp_kkj", label: "Kokusai Chotatsu Joho (KKJ, Japan)", countryCode: "JP", kind: "government", adapter: "kkj" },
  { key: "id_spse", label: "SPSE / LPSE (Indonesia)", countryCode: "ID", kind: "government", adapter: "spse" },
  { key: "ph_philgeps", label: "PhilGEPS (Philippines)", countryCode: "PH", kind: "government", adapter: "philgeps" },
  { key: "vn_muasamcong", label: "MuaSamCong (Vietnam)", countryCode: "VN", kind: "government", adapter: "muasamcong" },
  { key: "bd_eprocure", label: "e-Procurement (Bangladesh)", countryCode: "BD", kind: "government", adapter: "eprocure_bd" },
  { key: "pk_epms", label: "EPMS / PPRA (Pakistan)", countryCode: "PK", kind: "government", adapter: "pakistan_epms" },
  { key: "eg_etenders", label: "Government e-Tenders Portal (Egypt)", countryCode: "EG", kind: "government", adapter: "egypt_etenders" },
  { key: "ma_marchespublics", label: "MarchesPublics (Morocco)", countryCode: "MA", kind: "government", adapter: "marchespublics" },
  { key: "tn_tuneps", label: "TUNEPS (Tunisia)", countryCode: "TN", kind: "government", adapter: "tuneps" },
  { key: "ug_gpp", label: "Government Procurement Portal (Uganda)", countryCode: "UG", kind: "government", adapter: "gpp_uganda" },
  { key: "tz_nest", label: "NeST National e-Procurement System (Tanzania)", countryCode: "TZ", kind: "government", adapter: "nest" },
  { key: "et_egp", label: "Electronic Government Procurement (Ethiopia)", countryCode: "ET", kind: "government", adapter: "egp_ethiopia" },
  { key: "lk_treasury", label: "Treasury Procurement Notices (Sri Lanka)", countryCode: "LK", kind: "government", adapter: "treasury_lk" },
  { key: "np_bolpatra", label: "Bolpatra e-GP (Nepal)", countryCode: "NP", kind: "government", adapter: "bolpatra" },
  { key: "md_mtender", label: "MTender (Moldova)", countryCode: "MD", kind: "government", adapter: "mtender" },
  { key: "ge_procurement", label: "State Procurement Agency (Georgia)", countryCode: "GE", kind: "government", adapter: "georgia_procurement" },
  { key: "rs_portal", label: "Public Procurement Portal (Serbia)", countryCode: "RS", kind: "government", adapter: "rs_portal" },
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
