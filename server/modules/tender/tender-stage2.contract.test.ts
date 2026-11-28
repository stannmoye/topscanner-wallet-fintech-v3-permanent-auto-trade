import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  TENDER_ADAPTERS,
  listImplementedAdapterKeys,
  resolveTenderAdapter,
} from "./registry";
import { computeTenderDedupeGroup } from "./dedupe";
import {
  TENDER_QUALIFICATION_CEILING_USD_MINOR,
  TENDER_QUALIFICATION_FLOOR_USD_MINOR,
  computeQualificationAmountUsdMinor,
  isContractValueInInclusionRange,
} from "./economics";
import { deriveTenderStatus } from "./normalise";
import { parseCsv, csvRowsToObjects, findCsvValue } from "./csv";
import { readZipEntries } from "./zip";
import {
  addGermanyDays,
  germanyDayString,
  latestAvailableGermanyDay,
  normaliseOeffentlichevergabeRelease,
  readOcdsReleases,
  resolveGermanyDay,
} from "./adapters/oeffentlichevergabe";
import { normaliseSamGovOpportunity } from "./adapters/sam-gov";
import { normaliseFindATenderRelease } from "./adapters/find-a-tender";
import { normaliseCanadaBuysRow } from "./adapters/canada-buys";
import { normaliseTedNotice } from "./adapters/ted";
import { normaliseWorldBankNotice } from "./adapters/world-bank";
import { TENDER_SOURCES, getTenderSource } from "./source-registry";
import { WORKER_HEALTH_REGISTRY } from "../../_core/workerHealth";
import { TENDER_INGEST_MAX_PAGES_PER_SOURCE, TENDER_INGEST_MAX_SOURCES_PER_CYCLE, TENDER_INGEST_UPSERT_BATCH_SIZE, TENDER_RAW_JSON_MAX_CHARS, selectTenderSourcesForCycle } from "./ingest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** Strip comments so negative substring assertions test code, not prose. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const FIRST_COHORT = ["sam_gov", "find_a_tender", "canada_buys", "oeffentlichevergabe", "ted", "world_bank"] as const;

describe("Tender Bid Stage 2 — adapter registry", () => {
  it("registers the first-cohort adapters", () => {
    // Stage 6 completes the catalogue, so the first cohort is now a required
    // subset of the registry rather than the whole of it (Stage 6 asserts the
    // full set).
    expect(listImplementedAdapterKeys()).toEqual(expect.arrayContaining([...FIRST_COHORT]));
    for (const key of FIRST_COHORT) {
      expect(Object.keys(TENDER_ADAPTERS), key).toContain(key);
    }
  });

  it("resolves each adapter with a provider and a normaliser", () => {
    for (const key of FIRST_COHORT) {
      const adapter = resolveTenderAdapter(key);
      expect(adapter, key).toBeDefined();
      expect(typeof adapter!.provider.fetch).toBe("function");
      expect(typeof adapter!.normalise).toBe("function");
    }
    expect(resolveTenderAdapter("not_implemented")).toBeUndefined();
  });

  it("routes each adapter to the country its source registry row declares", () => {
    for (const key of FIRST_COHORT) {
      const adapter = TENDER_ADAPTERS[key];
      const source = TENDER_SOURCES.find((entry) => entry.adapter === key);
      expect(source, key).toBeDefined();
      // A source row may share an adapter (Etimad), but the first cohort is one-to-one.
      expect(adapter.provider.countryCode).toBe(source!.countryCode);
      expect(adapter.provider.key).toBe(key);
    }
  });

  it("grounds every adapter in a real, documented endpoint (nothing fabricated)", () => {
    const endpoints: Record<string, string> = {
      "adapters/sam-gov.ts": "https://api.sam.gov/opportunities/v2/search",
      "adapters/find-a-tender.ts": "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages",
      "adapters/canada-buys.ts": "https://open.canada.ca/data/api/3/action/package_show",
      "adapters/oeffentlichevergabe.ts": "https://oeffentlichevergabe.de/api/notice-exports",
      "adapters/ted.ts": "https://api.ted.europa.eu/v3/notices/search",
      "adapters/world-bank.ts": "https://search.worldbank.org/api/v2/procnotices",
    };
    for (const [file, url] of Object.entries(endpoints)) {
      expect(read(file), file).toContain(url);
    }
  });
});

describe("Tender Bid Stage 2 — dedupe", () => {
  it("is a deterministic 64-character key", () => {
    const group = computeTenderDedupeGroup({ countryCode: "GB", buyer: "Council", title: "Cleaning services" });
    expect(group).toMatch(/^[0-9a-f]{64}$/);
    expect(computeTenderDedupeGroup({ countryCode: "GB", buyer: "Council", title: "Cleaning services" })).toBe(group);
  });

  it("ignores case, punctuation and whitespace noise", () => {
    const a = computeTenderDedupeGroup({ buyer: "City of London", title: "Road Works (Phase 1)" });
    const b = computeTenderDedupeGroup({ buyer: "city of london", title: "road works phase 1" });
    expect(a).toBe(b);
  });

  it("groups the same tender seen through two sources but separates different tenders", () => {
    const ted = computeTenderDedupeGroup({ countryCode: "GB", buyer: "Council", title: "Cleaning services" });
    const fts = computeTenderDedupeGroup({ countryCode: "GB", buyer: "Council", title: "Cleaning services" });
    const other = computeTenderDedupeGroup({ countryCode: "GB", buyer: "Council", title: "Cleaning services lot 2" });
    expect(ted).toBe(fts);
    expect(ted).not.toBe(other);
  });
});

describe("Tender Bid Stage 2 — economics bounds", () => {
  it("clamps the qualification amount to the owner-locked $1,000–$600,000 band", () => {
    expect(computeQualificationAmountUsdMinor(1_000_000 * 100, 100)).toBe(10_000 * 100); // 1% of $1M = $10k, in range, not clamped
    expect(computeQualificationAmountUsdMinor(100_000 * 100, 1)).toBe(TENDER_QUALIFICATION_FLOOR_USD_MINOR); // 0.01% would floor at $1,000
    expect(computeQualificationAmountUsdMinor(250_000_000 * 100, 10_000)).toBe(TENDER_QUALIFICATION_CEILING_USD_MINOR); // 100% ceiling
  });

  it("fails closed on missing or malformed inputs", () => {
    expect(computeQualificationAmountUsdMinor(null, 100)).toBeNull();
    expect(computeQualificationAmountUsdMinor(100_000 * 100, 0)).toBeNull();
    expect(computeQualificationAmountUsdMinor(100_000 * 100, null)).toBeNull();
    expect(computeQualificationAmountUsdMinor(100_000 * 100, 10_001)).toBeNull();
  });

  it("distinguishes an unknown contract value from an out-of-range one", () => {
    expect(isContractValueInInclusionRange(null)).toBeNull();
    expect(isContractValueInInclusionRange(50_000 * 100)).toBe(false);
    expect(isContractValueInInclusionRange(150_000 * 100)).toBe(true);
    expect(isContractValueInInclusionRange(300_000_000 * 100)).toBe(false);
  });
});

describe("Tender Bid Stage 2 — shared normalisation", () => {
  it("derives the status from the bidding window", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    expect(deriveTenderStatus({ bidOpenAt: "2026-07-01T00:00:00Z", bidCloseAt: "2026-08-01T00:00:00Z" }, now)).toBe("upcoming");
    expect(deriveTenderStatus({ bidOpenAt: "2026-06-01T00:00:00Z", bidCloseAt: "2026-09-01T00:00:00Z" }, now)).toBe("open");
    expect(deriveTenderStatus({ bidOpenAt: "2026-06-01T00:00:00Z", bidCloseAt: "2026-06-18T00:00:00Z" }, now)).toBe("closing");
    expect(deriveTenderStatus({ bidOpenAt: "2026-06-01T00:00:00Z", bidCloseAt: "2026-06-10T00:00:00Z" }, now)).toBe("closed");
    expect(deriveTenderStatus({ bidCloseAt: "2026-06-10T00:00:00Z", awardedAt: "2026-06-11T00:00:00Z" }, now)).toBe("awarded");
  });

  it("parses the CSV format the open-data portals publish", () => {
    const rows = parseCsv('a,b\r\n"x,1","line\nbreak"\r\n"he said ""hi"""');
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["x,1", "line\nbreak"]);
    expect(rows[2]).toEqual(['he said "hi"']);
    const records = csvRowsToObjects(parseCsv("Reference,Title-ENG\nREF-1,Roof repair"));
    expect(findCsvValue(records[0], "reference")).toBe("REF-1");
    expect(findCsvValue(records[0], "title")).toBe("Roof repair");
  });

  it("reads STORED and DEFLATE ZIP members", () => {
    const stored = buildZip([{ name: "notice.json", content: Buffer.from('{"ok":true}'), deflate: false }]);
    const deflated = buildZip([{ name: "notice.json", content: Buffer.from('{"ok":true}'), deflate: true }]);
    expect(readZipEntries(stored)[0].data.toString("utf8")).toBe('{"ok":true}');
    expect(readZipEntries(deflated)[0].data.toString("utf8")).toBe('{"ok":true}');
  });
});

describe("Tender Bid Stage 2 — source normalisers", () => {
  it("normalises a SAM.gov opportunity into USD minor units", () => {
    const tender = normaliseSamGovOpportunity({
      noticeId: "abc123",
      title: "Bridge repair services",
      solicitationNumber: "W123",
      organizationHierarchy: [{ name: "Department of Transport" }],
      naicsCode: "237310",
      type: "Solicitation",
      baseType: "Award Notice",
      postedDate: "2026-01-15",
      responseDeadLine: "2026-02-15T17:00:00-05:00",
      uiLink: "https://sam.gov/opp/abc123/view",
      award: { amount: "1250000", date: "2026-03-01" },
    });
    expect(tender).not.toBeNull();
    expect(tender!.externalId).toBe("abc123");
    expect(tender!.countryCode).toBe("US");
    expect(tender!.contractAmountMinor).toBe(125_000_000);
    expect(tender!.contractCurrency).toBe("USD");
    expect(tender!.industry).toBe("Construction");
    expect(tender!.sourceUrl).toBe("https://sam.gov/opp/abc123/view");
  });

  it("normalises a Find a Tender OCDS release", () => {
    const tender = normaliseFindATenderRelease({
      id: "2026-000001",
      ocid: "ocds-h6vhtk-0001",
      date: "2026-01-10T00:00:00Z",
      tender: {
        title: "Cleaning services",
        description: "Long description",
        value: { amount: 50000, currency: "GBP" },
        tenderPeriod: { startDate: "2026-01-10", endDate: "2026-02-10" },
        classification: { id: "90910000" },
        mainProcurementCategory: "services",
      },
      buyer: { name: "Example Council" },
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("GB");
    expect(tender!.contractAmountMinor).toBe(5_000_000);
    expect(tender!.contractCurrency).toBe("GBP");
    expect(tender!.industry).toBe("Sewage, refuse and environmental services");
  });

  it("normalises a CanadaBuys CSV row without inventing an amount", () => {
    const tender = normaliseCanadaBuysRow({
      "reference-number": "ABC-123",
      "title-eng": "Roof repair",
      "procurementcategory": "CNST",
      "contractingentityname": "Public Works",
      "closingdate": "2026-03-01",
      "publicationdate": "2026-02-01",
      "noticeurl": "https://canadabuys.canada.ca/en/tender-opportunities/ABC-123",
      "noticetype": "RFP",
      "description": "Repair the roof",
    });
    expect(tender).not.toBeNull();
    expect(tender!.externalId).toBe("ABC-123");
    expect(tender!.countryCode).toBe("CA");
    expect(tender!.industry).toBe("Construction");
    expect(tender!.contractAmountMinor).toBeNull();
    expect(tender!.contractCurrency).toBeNull();
  });

  it("normalises a German OCDS release and keeps the native EUR amount", () => {
    const tender = normaliseOeffentlichevergabeRelease({
      id: "ocds-mnwr74-0001",
      ocid: "ocds-mnwr74-0001",
      date: "2026-01-20T10:00:00Z",
      tender: {
        title: { deu: "Straßensanierung", eng: "Road renovation" },
        description: "Renovate the road",
        value: { amount: 2_000_000, currency: "EUR" },
        tenderPeriod: { startDate: "2026-01-20", endDate: "2026-02-20" },
        classification: { id: "45233120" },
        mainProcurementCategory: "works",
        documents: [{ url: "https://example.de/tender/documents.pdf" }],
      },
      buyer: { name: "Stadt Musterstadt", address: { countryName: "Germany" } },
      __exportUrl: "https://oeffentlichevergabe.de/api/notice-exports?pubDay=2026-01-20&format=ocds.zip",
    });
    expect(tender).not.toBeNull();
    expect(tender!.externalId).toBe("ocds-mnwr74-0001");
    expect(tender!.countryCode).toBe("DE");
    expect(tender!.title).toBe("Road renovation");
    expect(tender!.contractAmountMinor).toBe(200_000_000);
    expect(tender!.contractCurrency).toBe("EUR");
    expect(tender!.industry).toBe("Construction work");
    expect(tender!.sourceUrl).toBe("https://example.de/tender/documents.pdf");
  });

  it("flattens an OCDS release package into releases", () => {
    expect(readOcdsReleases({ releases: [{ id: "a" }, { id: "b" }] })).toHaveLength(2);
    expect(readOcdsReleases({ id: "solo", tender: {} })).toHaveLength(1);
    expect(readOcdsReleases(null)).toHaveLength(0);
  });

  it("normalises a TED notice and reads CPV into an industry", () => {
    const tender = normaliseTedNotice({
      "publication-number": "123456-2026",
      "notice-title": { eng: "IT support services" },
      "buyer-name": { eng: "Example Ministry" },
      "buyer-country": "FR",
      "classification-cpv": "72000000",
      "total-value": "300000",
      "publication-date": "2026-01-05",
      "deadline-receipt-tender-date-lot": "2026-02-05",
      "notice-type": "contract notice",
      "contract-nature": "services",
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("FR");
    expect(tender!.contractAmountMinor).toBe(30_000_000);
    expect(tender!.contractCurrency).toBe("EUR");
    expect(tender!.industry).toBe("IT services and software development");
  });

  it("normalises a World Bank notice and never fabricates a contract value", () => {
    const tender = normaliseWorldBankNotice({
      bid_reference_no: "WB-001",
      bid_description: "Water supply works",
      project_ctry_name: "Kenya",
      sector: "Water and Sanitation",
      notice_type: "IFB",
      submission_deadline_date: "2026-03-15",
      submission_deadline_time: "14:00",
      noticedate: "2026-02-01",
      url: "https://projects.worldbank.org/en/projects-operations/procurement-detail/WB-001",
    });
    expect(tender).not.toBeNull();
    expect(tender!.countryCode).toBe("KE");
    expect(tender!.contractAmountMinor).toBeNull();
    expect(tender!.contractCurrency).toBeNull();
    expect(tender!.bidCloseAt).not.toBeNull();
  });
});

describe("Tender Bid Stage 2 — Germany export window", () => {
  it("walks one day per page and never requests today or the future", () => {
    const now = new Date("2026-06-15T09:00:00Z");
    expect(latestAvailableGermanyDay(now)).toBe("2026-06-14");
    expect(germanyDayString(now)).toBe("2026-06-15");
    expect(addGermanyDays("2026-06-14", 1)).toBe("2026-06-15");
    expect(resolveGermanyDay({ since: new Date("2026-06-01T00:00:00Z") }, now)).toBe("2026-06-01");
    expect(resolveGermanyDay({ cursor: "2026-05-20" }, now)).toBe("2026-05-20");
    expect(resolveGermanyDay({}, now)).toBe("2026-06-14");
  });
});

describe("Tender Bid Stage 2 — ingestion worker guardrails", () => {
  const ingest = read("./ingest.ts");
  const ingestCode = stripComments(ingest);
  const index = read("../../_core/index.ts");

  it("is registered as a monitored worker and wired at startup", () => {
    expect(WORKER_HEALTH_REGISTRY.some((worker) => worker.key === "tender-ingest")).toBe(true);
    expect(index).toContain('runMonitoredWorkerCycle("tender-ingest"');
    expect(index).toContain("runTenderIngestCycle");
  });

  it("resolves USD only from a fresh FX quote and records the snapshot", () => {
    expect(ingest).toContain("getFreshTradingFxRate");
    expect(ingest).toContain("nativeMinorToUsdMinorExact");
    expect(ingest).toContain("fxRateSnapshots");
    // The stored registry rate must never be a calculation input.
    expect(ingestCode).not.toContain("usdRate");
  });

  it("upserts by (sourceId, externalId) and never writes administrator-owned qualification fields", () => {
    expect(ingest).toContain("onDuplicateKeyUpdate");
    expect(ingest).toContain("sourceId: source.id");
    expect(ingest).toContain("externalId: tender.externalId");
    expect(ingestCode).not.toContain("qualificationPctBps");
    expect(ingestCode).not.toContain("qualificationAmountUsdMinor");
  });

  it("fails closed rather than guessing when a source or tender cannot be read", () => {
    expect(ingest).toContain("no_adapter");
    expect(ingest).toContain("sanitizeWorkerErrorMessage");
    expect(TENDER_INGEST_MAX_PAGES_PER_SOURCE).toBeGreaterThan(0);
    expect(getTenderSource("sam_gov")?.adapter).toBe("sam_gov");
  });
});

describe("Tender Bid Stage 2 — ingestion source rotation", () => {
  it("rotates through every enabled source across repeated forced cycles instead of re-selecting the same first rows", () => {
    const limit = TENDER_INGEST_MAX_SOURCES_PER_CYCLE;
    expect(limit).toBeGreaterThan(0);
    // 55 enabled sources, more than one cycle's worth, mirroring the catalogue.
    const sources = Array.from({ length: 55 }, (_, index) => ({
      id: index + 1,
      key: `source-${index + 1}`,
      enabled: true,
      expectedIntervalMs: 604_800_000,
      lastSyncAt: null as Date | null,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    }));
    const nowMs = Date.UTC(2026, 5, 1);
    const seen = new Set<number>();
    let firstRun: number[] = [];
    // Simulate the cycle: each forced run attempts the selected sources and then
    // stamps `updatedAt` (exactly as runTenderIngestCycle does), so the following
    // run continues with the sources that have not yet been attempted.
    for (let run = 0; run < 4; run++) {
      const selected = selectTenderSourcesForCycle(sources as never, { force: true, nowMs, limit });
      const ids = selected.map((source) => source.id);
      if (run === 0) firstRun = ids;
      expect(ids.length).toBeLessThanOrEqual(limit);
      ids.forEach((id) => seen.add(id));
      const stamp = new Date(Date.UTC(2026, 6, 1, 0, 0, run + 1));
      for (const source of selected) source.updatedAt = stamp;
    }
    // One cycle never exceeds the bound and never selects the same source twice.
    expect(firstRun).toHaveLength(limit);
    expect(new Set(firstRun).size).toBe(limit);
    // Across the run of cycles every enabled source is reached — the bug was that
    // repeated forced cycles kept re-selecting the same first `limit` sources.
    expect(seen.size).toBe(55);
  });
});

describe("Tender Bid Stage 2 — ingestion memory hardening", () => {
  const ingest = read("./ingest.ts");
  const index = read("../../_core/index.ts");
  const worker = read("../../_core/tender-ingest-worker.ts");

  it("writes rows in bounded batches instead of one round trip per row", () => {
    expect(TENDER_INGEST_UPSERT_BATCH_SIZE).toBeGreaterThan(0);
    expect(TENDER_INGEST_UPSERT_BATCH_SIZE).toBeLessThanOrEqual(200);
    expect(ingest).toContain("writeTenderBatch");
    // A single override lookup per batch keeps the round-trip count down.
    expect(ingest).toContain("inArray(tenders.externalId, externalIds)");
    // The update set must reuse the multi-row VALUES() the batch was inserted with.
    expect(ingest).toContain("VALUES(");
  });

  it("stores a bounded rawJson excerpt rather than the whole payload for every row", () => {
    expect(TENDER_RAW_JSON_MAX_CHARS).toBeGreaterThan(0);
    expect(TENDER_RAW_JSON_MAX_CHARS).toBeLessThanOrEqual(64_000);
    expect(ingest).toContain("safeStringify");
    expect(ingest).toContain("rawJson: safeStringify(tender.raw)");
    // Every raw payload must flow through the bounded stringifier.
    expect(ingest).not.toContain("rawJson: JSON.stringify(tender.raw)");
  });

  it("runs the ingestion worker in a dedicated process when configured", () => {
    // The web process skips the worker when TENDER_INGEST_WORKER=dedicated, so a
    // page spike can never take the API down with it.
    expect(index).toContain("TENDER_INGEST_WORKER");
    expect(worker).toContain('runMonitoredWorkerCycle("tender-ingest"');
    expect(worker).toContain("runTenderIngestCycle");
  });
});

/** Build a minimal ZIP buffer (STORED or DEFLATE) for the reader contract test. */
function buildZip(files: { name: string; content: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = file.deflate ? deflateRawSync(file.content) : file.content;
    const method = file.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}
