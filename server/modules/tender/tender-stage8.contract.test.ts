import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TENDER_ADAPTERS, listImplementedAdapterKeys, resolveTenderAdapter } from "./registry";
import { TENDER_COUNTRY_SOURCES, getTenderSource } from "./source-registry";
import { ccgpProvider } from "./adapters/ccgp";
import { spseProvider } from "./adapters/spse";
import { bolpatraProvider } from "./adapters/bolpatra";
import { nestProvider } from "./adapters/nest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const journal = JSON.parse(read("../../../drizzle/meta/_journal.json")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

/** The 27 countries added in stage 8, with the source key and adapter for each. */
const EXPANDED_SOURCES: Array<{ country: string; key: string; adapter: string }> = [
  { country: "UA", key: "ua_prozorro", adapter: "prozorro" },
  { country: "BR", key: "br_pncp", adapter: "pncp" },
  { country: "CL", key: "cl_mercado_publico", adapter: "mercado_publico" },
  { country: "CO", key: "co_secop_ii", adapter: "secop_ii" },
  { country: "KR", key: "kr_koneps", adapter: "koneps" },
  { country: "PE", key: "pe_oece", adapter: "oece" },
  { country: "KZ", key: "kz_goszakup", adapter: "goszakup" },
  { country: "TR", key: "tr_ekap", adapter: "ekap" },
  { country: "MX", key: "mx_comprasmx", adapter: "comprasmx" },
  { country: "CN", key: "cn_ccgp", adapter: "ccgp" },
  { country: "JP", key: "jp_kkj", adapter: "kkj" },
  { country: "ID", key: "id_spse", adapter: "spse" },
  { country: "PH", key: "ph_philgeps", adapter: "philgeps" },
  { country: "VN", key: "vn_muasamcong", adapter: "muasamcong" },
  { country: "BD", key: "bd_eprocure", adapter: "eprocure_bd" },
  { country: "PK", key: "pk_epms", adapter: "pakistan_epms" },
  { country: "EG", key: "eg_etenders", adapter: "egypt_etenders" },
  { country: "MA", key: "ma_marchespublics", adapter: "marchespublics" },
  { country: "TN", key: "tn_tuneps", adapter: "tuneps" },
  { country: "UG", key: "ug_gpp", adapter: "gpp_uganda" },
  { country: "TZ", key: "tz_nest", adapter: "nest" },
  { country: "ET", key: "et_egp", adapter: "egp_ethiopia" },
  { country: "LK", key: "lk_treasury", adapter: "treasury_lk" },
  { country: "NP", key: "np_bolpatra", adapter: "bolpatra" },
  { country: "MD", key: "md_mtender", adapter: "mtender" },
  { country: "GE", key: "ge_procurement", adapter: "georgia_procurement" },
  { country: "RS", key: "rs_portal", adapter: "rs_portal" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tender Bid Stage 8 — expanded country catalogue", () => {
  it("registers an adapter for every one of the 27 expanded countries", () => {
    for (const { country, key, adapter } of EXPANDED_SOURCES) {
      const source = getTenderSource(key);
      expect(source, key).toBeDefined();
      expect(source!.countryCode).toBe(country);
      expect(source!.kind).toBe("government");
      expect(source!.adapter).toBe(adapter);

      const resolved = resolveTenderAdapter(adapter);
      expect(resolved, adapter).toBeDefined();
      expect(typeof resolved!.provider.fetch).toBe("function");
      expect(typeof resolved!.normalise).toBe("function");
      expect(resolved!.provider.countryCode).toBe(country);
      expect(resolved!.provider.kind).toBe("government");
      expect(resolved!.provider.key).toBe(adapter);
    }
  });

  it("adds exactly the 27 expanded countries to the 23 original ones", () => {
    const codes = TENDER_COUNTRY_SOURCES.map((source) => source.countryCode);
    expect(codes).toHaveLength(50);
    expect(new Set(codes).size).toBe(50);
    for (const { country } of EXPANDED_SOURCES) {
      expect(codes.filter((code) => code === country)).toHaveLength(1);
    }
  });

  it("registers every expanded adapter key against a real module", () => {
    const implemented = new Set(listImplementedAdapterKeys());
    for (const { adapter } of EXPANDED_SOURCES) {
      expect(implemented.has(adapter), adapter).toBe(true);
      expect(TENDER_ADAPTERS[adapter]).toBeDefined();
    }
  });

  it("grounds every expanded adapter in a real, documented endpoint (nothing fabricated)", () => {
    const endpoints: Record<string, string> = {
      "adapters/prozorro.ts": "https://public-api.prozorro.gov.ua/api/2.5/tenders",
      "adapters/pncp.ts": "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao",
      "adapters/mercado-publico.ts": "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json",
      "adapters/secop-ii.ts": "https://www.datos.gov.co/resource/p6dx-8zbt.json",
      "adapters/koneps.ts": "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThng",
      "adapters/oece.ts": "https://contratacionesabiertas.oece.gob.pe/api/releases",
      "adapters/goszakup.ts": "https://ows.goszakup.gov.kz/v2/ocds",
      "adapters/ekap.ts": "https://ekap.kik.gov.tr/EKAP/Ortak/IhaleArama/index.html",
      "adapters/comprasmx.ts": "https://comprasmx.buengobierno.gob.mx/sitiopublico/",
      "adapters/ccgp.ts": "https://www.ccgp.gov.cn/cggg/zygg/gkzb/",
      "adapters/kkj.ts": "https://www.kkj.go.jp/s/",
      "adapters/spse.ts": "https://spse.inaproc.id/nasional/lelang",
      "adapters/philgeps.ts": "https://notices.philgeps.gov.ph/",
      "adapters/muasamcong.ts": "https://muasamcong.mof.gov.vn/",
      "adapters/eprocure-bd.ts": "https://www.eprocure.gov.bd/resources/common/StdTenderSearch.jsp?h=t",
      "adapters/pakistan-epms.ts": "https://epms.ppra.gov.pk/public/tenders/active-tenders",
      "adapters/egypt-etenders.ts": "https://etenders.gov.eg/",
      "adapters/marchespublics.ts": "https://www.marchespublics.gov.ma/",
      "adapters/tuneps.ts": "https://www.tuneps.tn/portail/consultations",
      "adapters/gpp-uganda.ts": "https://gpp.ppda.go.ug/",
      "adapters/nest.ts": "https://nest.go.tz/tenders/published-tenders",
      "adapters/egp-ethiopia.ts": "https://production.egp.gov.et/egp/bids/all",
      "adapters/treasury-lk.ts": "https://www.treasury.gov.lk/procurement/procurement-notices",
      "adapters/bolpatra.ts": "https://www.bolpatra.gov.np/egp/searchOpportunity",
      "adapters/mtender.ts": "https://public.mtender.gov.md/tenders/",
      "adapters/georgia-procurement.ts": "https://tenders.procurement.gov.ge/",
      "adapters/rs-portal.ts": "https://jnportal.ujn.gov.rs/oglasi-svi",
    };
    for (const [file, url] of Object.entries(endpoints)) {
      expect(read(file), file).toContain(url);
    }
  });

  it("fails closed when a JavaScript-rendered portal yields no notice links", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html><body>app shell</body></html>", { status: 200 })));
    for (const provider of [ccgpProvider, spseProvider, bolpatraProvider, nestProvider]) {
      await expect(provider.fetch({}), provider.key).rejects.toThrow(/No notice links/);
    }
  });

  it("seeds the expanded sources and appends a strictly-increasing migration", () => {
    const sql = read("../../../drizzle/0127_tender_expansion.sql");
    for (const { country, key, adapter } of EXPANDED_SOURCES) {
      const source = getTenderSource(key)!;
      expect(sql).toContain(`('${key}', '${source.label}', '${country}', 'government', '${adapter}')`);
    }
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    const entry = journal.entries.find((item) => item.tag === "0127_tender_expansion")!;
    expect(entry).toBeDefined();
    const previousLast = journal.entries.filter((item) => item.when < entry.when).at(-1);
    expect(previousLast?.tag).toBe("0126_tender_admin_corrections");
    // Later tender stages may append newer migrations (e.g. the weekly ingest
    // cadence), so assert this migration was appended immediately after the
    // then-last entry rather than pinning it as the global last.
    expect(journal.entries.indexOf(entry)).toBe(journal.entries.indexOf(previousLast!) + 1);
    expect(entry.idx).toBe(journal.entries.indexOf(entry));
    expect(entry.when).toBeGreaterThan(previousLast!.when);
  });
});
