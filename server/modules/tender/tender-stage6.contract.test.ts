import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TENDER_ADAPTERS,
  listImplementedAdapterKeys,
  resolveTenderAdapter,
} from "./registry";
import { TENDER_COUNTRY_SOURCES, TENDER_SOURCES, listTenderCountryCodes } from "./source-registry";
import { toIsoString } from "./normalise";
import {
  createHtmlListingProvider,
  externalIdFromQueryParam,
  extractListingLinks,
  normaliseHtmlListingRow,
} from "./adapters/html-listing";
import { doffinProvider } from "./adapters/doffin";
import { etendersProvider, normaliseEtendersRow } from "./adapters/etenders";
import { normaliseSimapProject } from "./adapters/simap";
import { normalisePpipTender } from "./adapters/ppip";
import { normaliseEtimadTender } from "./adapters/etimad";
import { normaliseEzamowieniaNotice } from "./adapters/ezamowienia";
import { normaliseAustenderRelease } from "./adapters/austender";
import { normaliseZaEtendersRelease } from "./adapters/za-etenders";
import { normaliseAnacRelease } from "./adapters/anac";
import { normaliseBoampRecord } from "./adapters/boamp";
import { normaliseTenderNedPublication } from "./adapters/tenderned";
import { normaliseUdbudNotice } from "./adapters/udbud";
import { normalisePlacspEntry } from "./adapters/placsp";
import {
  TENDER_INGEST_MAX_FETCH_ATTEMPTS,
  TENDER_INGEST_MAX_PAGES_PER_SOURCE,
  TENDER_INGEST_PAGE_DELAY_MS,
  TENDER_INGEST_RETRY_BASE_DELAY_MS,
} from "./ingest";
import { WORKER_HEALTH_REGISTRY } from "../../_core/workerHealth";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
/** Strip comments so negative substring assertions test code, not prose. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every adapter key the catalogue must register (23 original countries + 5 supranational + 27 stage-8 countries). */
const EXPECTED_ADAPTER_KEYS = [
  "adb", "afdb", "anac", "austender", "boamp", "canada_buys", "cppp", "doffin", "enotification",
  "etenders", "etimad", "ezamowienia", "find_a_tender", "ghaneps", "hilma", "nocopo",
  "oeffentlichevergabe", "placsp", "ppip", "sam_gov", "simap", "ted", "tenderned", "udbud",
  "ungm", "world_bank", "za_etenders",
  "bolpatra", "ccgp", "comprasmx", "egp_ethiopia", "egypt_etenders", "ekap", "eprocure_bd",
  "georgia_procurement", "goszakup", "gpp_uganda", "kkj", "koneps", "marchespublics",
  "mercado_publico", "mtender", "muasamcong", "nest", "oece", "pakistan_epms", "philgeps",
  "pncp", "prozorro", "rs_portal", "secop_ii", "spse", "treasury_lk", "tuneps",
] as const;

/** The shared factories plus the per-source modules in the adapters directory. */
const ADAPTER_FACTORY_FILES = new Set(["ocds.ts", "opendatasoft.ts", "html-listing.ts"]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tender Bid Stage 6 — full adapter catalogue", () => {
  it("registers exactly the expected adapter keys", () => {
    expect(listImplementedAdapterKeys().sort()).toEqual([...EXPECTED_ADAPTER_KEYS].sort());
    expect(Object.keys(TENDER_ADAPTERS).sort()).toEqual([...EXPECTED_ADAPTER_KEYS].sort());
  });

  it("backs every registered key with a real adapter module file", () => {
    const files = readdirSync(new URL("./adapters/", import.meta.url))
      .filter((file) => file.endsWith(".ts") && !ADAPTER_FACTORY_FILES.has(file))
      .map((file) => file.replace(/\.ts$/, "").replace(/-/g, "_"))
      .sort();
    expect(files).toEqual([...EXPECTED_ADAPTER_KEYS].sort());
  });

  it("resolves every source-registry row to an implemented adapter", () => {
    for (const source of TENDER_SOURCES) {
      const adapter = resolveTenderAdapter(source.adapter);
      expect(adapter, `${source.key} → ${source.adapter}`).toBeDefined();
      expect(typeof adapter!.provider.fetch).toBe("function");
      expect(typeof adapter!.normalise).toBe("function");
    }
  });

  it("routes each adapter to its source's country and kind", () => {
    for (const source of TENDER_SOURCES) {
      const adapter = TENDER_ADAPTERS[source.adapter];
      expect(adapter, source.adapter).toBeDefined();
      // The Etimad adapter is shared by the AE and SA rows and resolves the
      // country per row, so its provider country is intentionally empty.
      if (source.adapter !== "etimad") {
        expect(adapter.provider.countryCode, source.key).toBe(source.countryCode);
      } else {
        expect(adapter.provider.countryCode).toBe("");
      }
      expect(adapter.provider.kind, source.key).toBe(source.kind);
      expect(adapter.provider.key).toBe(source.adapter);
    }
  });

  it("covers all 50 countries", () => {
    expect(listTenderCountryCodes()).toHaveLength(50);
    expect(new Set(listTenderCountryCodes()).size).toBe(50);
    expect(TENDER_COUNTRY_SOURCES).toHaveLength(50);
  });

  it("grounds every adapter in a real, documented endpoint (nothing fabricated)", () => {
    const endpoints: Record<string, string> = {
      "adapters/sam-gov.ts": "https://api.sam.gov/opportunities/v2/search",
      "adapters/find-a-tender.ts": "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages",
      "adapters/canada-buys.ts": "https://open.canada.ca/data/api/3/action/package_show",
      "adapters/oeffentlichevergabe.ts": "https://oeffentlichevergabe.de/api/notice-exports",
      "adapters/boamp.ts": "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records",
      "adapters/tenderned.ts": "https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties",
      "adapters/enotification.ts": "https://www.publicprocurement.be/",
      "adapters/placsp.ts": "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom",
      "adapters/anac.ts": "https://dati.anticorruzione.it/opendata/api/ocds/releases",
      "adapters/ezamowienia.ts": "https://ezamowienia.gov.pl/mo-board/api/v1/notice",
      "adapters/udbud.ts": "https://udbud.dk/soegning/public/soegeresultat",
      "adapters/hilma.ts": "https://www.hankintailmoitukset.fi/en/tender-notices",
      "adapters/etenders.ts": "https://www.etenders.gov.ie/epps/cft/prepareCurrentOpportunities.do",
      "adapters/doffin.ts": "https://doffin.no/notices",
      "adapters/simap.ts": "https://www.simap.ch/api/publications/v2/project/project-search",
      "adapters/austender.ts": "https://api.tenders.gov.au/ocds/findByDates/contractPublished",
      "adapters/cppp.ts": "https://eprocure.gov.in/cppp/latestactivetenders",
      "adapters/nocopo.ts": "https://nocopo.bpp.gov.ng/",
      "adapters/ppip.ts": "https://tenders.go.ke/api/active-tenders",
      "adapters/za-etenders.ts": "https://ocds-api.etenders.gov.za/api/OCDSReleases",
      "adapters/ghaneps.ts": "https://ghaneps.gov.gh/epps/quickSearchAction.do",
      "adapters/etimad.ts": "https://tenders.etimad.sa/Tender/AllSupplierTendersForVisitorAsync",
      "adapters/ted.ts": "https://api.ted.europa.eu/v3/notices/search",
      "adapters/world-bank.ts": "https://search.worldbank.org/api/v2/procnotices",
      "adapters/ungm.ts": "https://www.ungm.org/Public/Notice",
      "adapters/afdb.ts": "https://www.afdb.org/en/documents/project-related-procurement/procurement-notices",
      "adapters/adb.ts": "https://data.adb.org/dataset/operational-procurement-database",
    };
    for (const [file, url] of Object.entries(endpoints)) {
      expect(read(file), file).toContain(url);
    }
  });
});

describe("Tender Bid Stage 6 — HTML-listing scraper fails closed", () => {
  it("throws on a first page with no notice links so the source is flagged unhealthy", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html><body>no links here</body></html>", { status: 200 })));
    await expect(doffinProvider.fetch({})).rejects.toThrow(/No notice links/);
  });

  it("extracts server-rendered notice links and derives ids from query parameters", async () => {
    const html =
      '<a href="/epps/cft/prepareViewCfTWS.do?resourceId=12345">Supply of office equipment for the department</a>';
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(html, { status: 200 })));
    const page = await etendersProvider.fetch({});
    expect(page.items).toHaveLength(1);
    expect((page.items[0] as { url: string }).url).toContain("resourceId=12345");
  });

  it("honours the declared href filter and derives an external id", () => {
    const pageUrl = "https://www.etenders.gov.ie/epps/cft/prepareCurrentOpportunities.do?currentType=cft";
    const html =
      '<a href="/epps/cft/prepareViewCfTWS.do?resourceId=777">Framework for maintenance services</a>' +
      '<a href="/epps/viewInfo.do?id=1">Navigation chrome</a>';
    const rows = extractListingLinks(html, { hrefIncludes: ["prepareViewCfTWS.do"], pageUrl });
    expect(rows).toHaveLength(1);
    expect(externalIdFromQueryParam(rows[0].url, "resourceId")).toBe("777");
    const tender = normaliseEtendersRow(rows[0]);
    expect(tender!.externalId).toBe("777");
    expect(tender!.countryCode).toBe("IE");
  });

  it("never invents fields for a scraped notice", () => {
    const tender = normaliseHtmlListingRow(
      { title: "Road resurfacing works", url: "https://example.org/notices/road-1" },
      { countryCode: "NO" },
    );
    expect(tender).not.toBeNull();
    expect(tender!.contractAmountMinor).toBeNull();
    expect(tender!.contractCurrency).toBeNull();
    expect(tender!.buyer).toBeNull();
    expect(tender!.bidCloseAt).toBeNull();
    expect(tender!.sourceUrl).toBe("https://example.org/notices/road-1");
  });

  it("defaults to fail-on-empty but can be relaxed for a genuinely optional listing", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html></html>", { status: 200 })));
    const lenient = createHtmlListingProvider({
      key: "test",
      countryCode: "ZZ",
      kind: "government",
      listingUrl: "https://example.org/notices",
      hrefIncludes: ["/notice/"],
      failOnEmpty: false,
    });
    await expect(lenient.fetch({})).resolves.toEqual({ items: [], nextCursor: null });
  });
});

describe("Tender Bid Stage 6 — country adapter normalisers", () => {
  it("normalises a simap.ch project", () => {
    const tender = normaliseSimapProject({
      projectNumber: "14514",
      projectType: "tender",
      projectSubType: "construction",
      processType: "open",
      publicationId: "c0876310",
      publicationDate: "2026-11-27",
      title: { de: "Erschliessung Hodelmatte", en: null },
      procOfficeName: { de: "Einwohnergemeinde Steffisburg", en: null },
    });
    expect(tender).not.toBeNull();
    expect(tender!.externalId).toBe("14514");
    expect(tender!.countryCode).toBe("CH");
    expect(tender!.title).toBe("Erschliessung Hodelmatte");
    expect(tender!.buyer).toBe("Einwohnergemeinde Steffisburg");
    expect(tender!.tenderType).toBe("tender");
    expect(tender!.procedure).toBe("open");
    expect(tender!.sourceUrl).toBe("https://www.simap.ch/en/project/14514");
    expect(tender!.publishedAt).not.toBeNull();
  });

  it("normalises a PPIP / e-GP tender and resolves relative document URLs", () => {
    const tender = normalisePpipTender({
      id: 314188,
      ocid: "ocds-5whusi-314188-Mbeere/N/NGCDF/002/2026-2027",
      title: "Basic Digital hub construction at Siakago/Nthawa",
      published_at: "2026-11-18 00:00:00",
      close_at: "2026-11-27 10:00:00",
      description: "Construction of a digital hub",
      pe: { name: "NGCDF Mbeere North Constituency" },
      procurement_category: { name: "Works" },
      documents: [{ url: "/storage/Documents/spec.pdf" }],
    });
    expect(tender).not.toBeNull();
    expect(tender!.externalId).toBe("ocds-5whusi-314188-Mbeere/N/NGCDF/002/2026-2027");
    expect(tender!.countryCode).toBe("KE");
    expect(tender!.buyer).toBe("NGCDF Mbeere North Constituency");
    expect(tender!.sourceUrl).toBe("https://tenders.go.ke/tender/314188");
    expect(tender!.bidCloseAt).not.toBeNull();
    expect(tender!.documents[0]?.url).toBe("https://tenders.go.ke/storage/Documents/spec.pdf");
  });

  it("normalises an Etimad tender and defers the country to the source row", () => {
    const tender = normaliseEtimadTender({
      tenderId: 123,
      tenderIdString: "abc-123",
      referenceNumber: "REF-1",
      tenderName: "Road maintenance",
      agencyName: "Ministry of Transport",
      tenderTypeName: "Competition",
      submissionDate: "2026-11-01",
      lastOfferPresentationDate: "2026-12-01",
    });
    expect(tender).not.toBeNull();
    expect(tender!.externalId).toBe("abc-123");
    expect(tender!.countryCode).toBe("");
    expect(tender!.buyer).toBe("Ministry of Transport");
    expect(tender!.sourceUrl).toBe("https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId=abc-123");
    expect(tender!.bidCloseAt).not.toBeNull();
  });

  it("normalises an e-Zamówienia notice and builds its notice page", () => {
    const tender = normaliseEzamowieniaNotice({
      noticeNumber: "2026/BZP 00001/01",
      bzpNumber: "2026/BZP 00001",
      orderObject: "Remont drogi gminnej",
      cpvCode: "45233120",
      organizationName: "Gmina Muster",
      publicationDate: "2026-11-10",
      submittingOffersDate: "2026-12-10",
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("PL");
    expect(tender!.sourceUrl).toContain("ezamowienia.gov.pl/mo-client-board/bzp/notice-details");
    expect(tender!.industry).toBe("Construction work");
    expect(tender!.contractAmountMinor).toBeNull();
  });

  it("normalises an AusTender contract release from its contracts block", () => {
    const tender = normaliseAustenderRelease({
      id: "CN4198910",
      ocid: "ocds-austender-CN4198910",
      date: "2026-11-01T00:00:00Z",
      contracts: [{ id: "CN4198910", title: "Provision of IT services", value: { amount: 100000, currency: "AUD" } }],
      parties: [{ roles: ["procuringEntity"], name: "Department of Finance" }],
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("AU");
    expect(tender!.sourceUrl).toContain("tenders.gov.au/cn/search");
    expect(tender!.contractAmountMinor).toBe(10_000_000);
    expect(tender!.contractCurrency).toBe("AUD");
  });

  it("normalises a South Africa eTenders release", () => {
    const tender = normaliseZaEtendersRelease({
      id: "ocds-9q2d2q-0001",
      ocid: "ocds-9q2d2q-0001",
      date: "2026-11-05T00:00:00Z",
      tender: {
        id: "0001",
        title: "Supply of stationery",
        description: "Stationery for the department",
        documents: [{ url: "https://www.etenders.gov.za/home/Download?blobName=abc" }],
        tenderPeriod: { endDate: "2026-12-05" },
      },
      buyer: { name: "National Treasury" },
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("ZA");
    expect(tender!.buyer).toBe("National Treasury");
    expect(tender!.sourceUrl).toBe("https://www.etenders.gov.za/home/Download?blobName=abc");
  });

  it("normalises an ANAC (Italy) release", () => {
    const tender = normaliseAnacRelease({
      id: "ANAC-1",
      ocid: "ocds-anac-1",
      date: "2026-11-02T00:00:00Z",
      tender: { title: "Fornitura di servizi", documents: [{ url: "https://dati.anticorruzione.it/doc/1" }] },
      buyer: { name: "Comune di Muster" },
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("IT");
    expect(tender!.sourceUrl).toBe("https://dati.anticorruzione.it/doc/1");
  });

  it("normalises a BOAMP record and a TenderNed publication", () => {
    const boamp = normaliseBoampRecord({
      idweb: "26-113929",
      objet: "Travaux de voirie",
      nomacheteur: "Ville de Muster",
      dateparution: "2026-11-02",
      datelimitereponse: "2026-12-02",
      type_marche_facette: "Travaux",
    });
    expect(boamp!.countryCode).toBe("FR");
    expect(boamp!.externalId).toBe("26-113929");
    expect(boamp!.contractAmountMinor).toBeNull();

    const tenderned = normaliseTenderNedPublication({
      publicatieId: "TN-1",
      aanbestedingNaam: "Schoonmaakdiensten",
      opdrachtgeverNaam: "Gemeente Muster",
      publicatieDatum: "2026-11-02",
      sluitingsDatum: "2026-12-02",
      procedure: { omschrijving: "Openbaar" },
      typeOpdracht: { omschrijving: "Diensten" },
      link: { href: "https://www.tenderned.nl/aankondigingen/overzicht/TN-1" },
    });
    expect(tenderned!.countryCode).toBe("NL");
    expect(tenderned!.tenderType).toBe("Diensten");
    expect(tenderned!.procedure).toBe("Openbaar");
  });

  it("normalises a udbud.dk notice and a PLACSP Atom entry", () => {
    const udbud = normaliseUdbudNotice({
      noticeId: "U-1",
      dataDa: { titel: "Indkøb af møbler", ordregiver: "Kommune Muster", publiceringsdato: "2026-11-02", cpvKode: "39100000" },
    });
    expect(udbud!.countryCode).toBe("DK");
    expect(udbud!.title).toBe("Indkøb af møbler");
    expect(udbud!.industry).toBe("Furniture and furnishings");

    const placsp = normalisePlacspEntry({
      id: "https://contrataciondelestado.es/1",
      title: "Obras de rehabilitación",
      link: "https://contrataciondelestado.es/1",
      updated: "2026-11-02T00:00:00Z",
    });
    expect(placsp!.countryCode).toBe("ES");
    expect(placsp!.sourceUrl).toBe("https://contrataciondelestado.es/1");
  });
});

describe("Tender Bid Stage 6 — hardening", () => {
  const ingest = read("./ingest.ts");
  const ingestCode = stripComments(ingest);

  it("retries a failed page fetch with bounded exponential back-off", () => {
    expect(ingest).toContain("fetchPageWithRetry");
    expect(TENDER_INGEST_MAX_FETCH_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(TENDER_INGEST_RETRY_BASE_DELAY_MS).toBeGreaterThan(0);
    expect(ingestCode).toContain("TENDER_INGEST_RETRY_BASE_DELAY_MS * 2 **");
  });

  it("paces page requests and bounds pages per source", () => {
    expect(TENDER_INGEST_PAGE_DELAY_MS).toBeGreaterThan(0);
    expect(ingestCode).toContain("TENDER_INGEST_PAGE_DELAY_MS");
    expect(TENDER_INGEST_MAX_PAGES_PER_SOURCE).toBeGreaterThan(0);
  });

  it("passes the source key and config to the adapter", () => {
    expect(ingestCode).toContain("readSourceConfig(source.configJson)");
    expect(ingestCode).toContain("sourceKey: source.key, config }");
  });

  it("retains data (never deletes tenders) and keeps the raw payload for audit", () => {
    expect(ingestCode).not.toMatch(/\.delete\(/);
    expect(ingest).toContain("rawJson: safeStringify(tender.raw)");
  });

  it("is registered as a monitored worker with a degraded state on source failure", () => {
    const worker = WORKER_HEALTH_REGISTRY.find((entry) => entry.key === "tender-ingest");
    expect(worker).toBeDefined();
    const index = read("../../_core/index.ts");
    expect(index).toContain('runMonitoredWorkerCycle("tender-ingest"');
    expect(index).toContain("sourcesFailed");
  });

  it("stores dates as UTC ISO instants regardless of the source's local format", () => {
    // A naive local timestamp, a date-only value, and a US-style date all normalise to UTC.
    expect(toIsoString("2026-11-27 10:00:00")).toBe("2026-11-27T10:00:00.000Z");
    expect(toIsoString("2026-11-27")).toBe("2026-11-27T00:00:00.000Z");
    expect(toIsoString("11/27/2026")).toBe("2026-11-27T00:00:00.000Z");
  });
});
