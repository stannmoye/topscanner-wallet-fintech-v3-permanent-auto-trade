import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TENDER_COUNTRY_SOURCES,
  TENDER_SOURCES,
  TENDER_SUPRANATIONAL_SOURCES,
  getTenderSource,
  listTenderCountryCodes,
} from "./source-registry";
import { TENDER_BID_STATUSES, TENDER_SOURCE_KINDS, TENDER_STATUSES } from "./provider";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const schema = read("../../../drizzle/schema.ts");
const providerSource = read("./provider.ts");
const migration = read("../../../drizzle/0125_tender_bid.sql");
const journal = JSON.parse(read("../../../drizzle/meta/_journal.json"));

const NEW_TABLES = ["tender_sources", "tenders", "tender_field_history", "tender_bids", "tender_bid_events"] as const;

describe("Tender Bid Stage 1 — source registry", () => {
  it("covers exactly the 23 owner-approved countries", () => {
    expect(TENDER_COUNTRY_SOURCES).toHaveLength(23);
    expect(listTenderCountryCodes()).toEqual([
      "US", "GB", "CA", "DE", "FR", "NL", "BE", "ES", "IT", "PL",
      "DK", "FI", "IE", "NO", "CH", "AU", "IN", "NG", "KE", "ZA",
      "GH", "AE", "SA",
    ]);
    expect(new Set(listTenderCountryCodes()).size).toBe(23);
  });

  it("keeps registry keys unique and every definition well-formed", () => {
    const keys = TENDER_SOURCES.map((source) => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const source of TENDER_SOURCES) {
      expect(source.key).toMatch(/^[a-z0-9_]+$/);
      expect(source.label.length).toBeGreaterThan(0);
      expect(source.adapter.length).toBeGreaterThan(0);
      expect(TENDER_SOURCE_KINDS).toContain(source.kind);
      expect(source.countryCode === "" || /^[A-Z]{2}$/.test(source.countryCode)).toBe(true);
    }
  });

  it("includes both government and private sources", () => {
    const kinds = new Set(TENDER_SOURCES.map((source) => source.kind));
    expect(kinds.has("government")).toBe(true);
    expect(kinds.has("private")).toBe(true);
    expect(TENDER_SUPRANATIONAL_SOURCES.length).toBeGreaterThan(0);
  });

  it("resolves a source by key and no unknown key", () => {
    expect(getTenderSource("sam_gov")?.countryCode).toBe("US");
    expect(getTenderSource("does_not_exist")).toBeUndefined();
  });
});

describe("Tender Bid Stage 1 — Drizzle schema", () => {
  it("declares every tender table", () => {
    for (const table of NEW_TABLES) {
      expect(schema).toContain(`mysqlTable("${table}"`);
    }
  });

  it("stores money as integer USD minor units", () => {
    for (const column of [
      '"contractAmountMinor"',
      '"contractAmountUsdMinor"',
      '"qualificationAmountUsdMinor"',
      '"chargeAmountUsdMinor"',
    ]) {
      expect(schema).toContain(`bigint(${column}, { mode: "number" })`);
    }
  });

  it("enforces the key uniqueness that makes ingestion and bidding idempotent", () => {
    expect(schema).toContain('uniqueIndex("tender_sources_key_uq")');
    expect(schema).toContain('uniqueIndex("tenders_source_external_uq")');
    expect(schema).toContain('uniqueIndex("tender_bids_user_tender_uq")');
    expect(schema).toContain('uniqueIndex("tender_bids_idempotency_uq")');
  });

  it("uses the model enums the flow depends on", () => {
    expect(TENDER_STATUSES).toEqual(["upcoming", "open", "closing", "closed", "awarded"]);
    expect(TENDER_BID_STATUSES).toEqual(["placed", "charge_pending", "charged", "won", "lost", "cancelled"]);
  });
});

describe("Tender Bid Stage 1 — migration and journal", () => {
  it("is idempotent and additive", () => {
    expect(migration).toContain("Idempotent and additive, so it is safe to replay.");
    for (const table of NEW_TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    }
    expect(migration).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("seeds every registry source", () => {
    for (const source of TENDER_SOURCES) {
      expect(migration).toContain(`('${source.key}', '${source.label}', '${source.countryCode}', '${source.kind}', '${source.adapter}')`);
    }
  });

  it("appends a strictly-increasing forward journal entry", () => {
    const entries = journal.entries as Array<{ tag: string; when: number }>;
    const entry = entries.find((item) => item.tag === "0125_tender_bid");
    expect(entry).toBeDefined();
    expect(entry!.when).toBeGreaterThan(entries[entries.indexOf(entry!) - 1].when);
    const previousLast = entries.filter((item) => item.when < entry!.when).at(-1);
    expect(previousLast?.tag).toBe("0121_device_details");
    // Later tender stages may append newer migrations, so assert the tender
    // migration was appended immediately after the then-last entry rather than
    // pinning it as the global last.
    expect(entries.indexOf(entry!)).toBe(entries.indexOf(previousLast!) + 1);
  });
});

describe("Tender Bid Stage 1 — provider contract", () => {
  it("exports the provider interface and normalised model", () => {
    expect(providerSource).toContain("export interface TenderProvider");
    expect(providerSource).toContain("export type NormalizedTender");
    for (const field of [
      "externalId",
      "countryCode",
      "title",
      "buyer",
      "industry",
      "tenderType",
      "procedure",
      "contractAmountMinor",
      "contractCurrency",
      "bidOpenAt",
      "bidCloseAt",
      "payoutAt",
      "publishedAt",
      "summary",
      "descriptionText",
      "documents",
      "sourceUrl",
      "raw",
    ]) {
      expect(providerSource).toContain(field);
    }
    expect(providerSource).toContain("fetch(params: TenderFetchParams): Promise<RawTenderPage>");
  });
});
