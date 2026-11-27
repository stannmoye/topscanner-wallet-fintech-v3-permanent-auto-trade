import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TENDER_CORRECTION_FIELDS,
  TENDER_CORRECTION_FIELD_MAP,
  TENDER_SOURCE_DERIVED_FIELDS,
  hasTenderFieldOverride,
  parseTenderCorrection,
  readTenderOverrides,
  tenderFieldDisplay,
  tenderFieldFromJson,
  tenderFieldToJson,
} from "./corrections";

/**
 * Stage 5 contract — the administrator tender console. It proves the corrections
 * catalogue fan-out (service, ingestion, read seam), the audited correction and
 * revert path, administrator overrides surviving re-ingestion, the source health
 * console, and the end-to-end wiring (tRPC → nav registry → App → admin CSS).
 *
 * Spec §11 Stage 5 "Done when": an administrator edits any tender field and a
 * `tender_field_history` row is written (old → new, administrator, note), the
 * change reflects on the customer side immediately, overrides survive
 * re-ingestion and can be reverted to the source value, the bid queue offers
 * charge/decline/outcome, and sources can be enabled/disabled with health.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** Strip comments so negative substring assertions test code, not prose. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const corrections = read("./corrections.ts");
const admin = read("./admin.ts");
const ingest = read("./ingest.ts");
const customerDesk = read("./customerDesk.ts");
const bidding = read("./bidding.ts");
const routers = read("../../routers.ts");
const componentPath = new URL("../../../client/src/components/AdminTenderBid.tsx", import.meta.url);
const component = readFileSync(componentPath, "utf8");
const css = readFileSync(new URL("../../../client/src/components/admin-tender.css", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../../../client/src/admin-navigation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../client/src/App.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../drizzle/0126_tender_admin_corrections.sql", import.meta.url), "utf8");

describe("Tender Bid Stage 5 — correction catalogue is the one source of truth", () => {
  it("lists every editable field and marks the administrator-owned qualification fields as not source-derived", () => {
    const fields = TENDER_CORRECTION_FIELDS.map((entry) => entry.field);
    for (const field of ["title", "buyer", "industry", "tenderType", "contractAmountUsdMinor", "bidOpenAt", "status", "descriptionText", "sourceUrl"]) {
      expect(fields).toContain(field);
    }
    expect(TENDER_CORRECTION_FIELD_MAP.get("status")?.kind).toBe("enum");
    expect(TENDER_CORRECTION_FIELD_MAP.get("descriptionText")?.kind).toBe("textarea");
    // The qualification fields are administrator-owned: ingestion never writes
    // them, so there is no source value to revert to.
    expect(TENDER_CORRECTION_FIELD_MAP.get("qualificationAmountUsdMinor")?.sourceDerived).toBe(false);
    expect(TENDER_CORRECTION_FIELD_MAP.get("qualificationPctBps")?.sourceDerived).toBe(false);
    expect(TENDER_SOURCE_DERIVED_FIELDS.has("qualificationAmountUsdMinor")).toBe(false);
    expect(TENDER_SOURCE_DERIVED_FIELDS.has("title")).toBe(true);
  });

  it("parses values fail-closed and would let a malformed edit through otherwise", () => {
    expect(parseTenderCorrection("title", "  Bridge replacement ")).toEqual({ ok: true, columnValue: "Bridge replacement", jsonValue: "Bridge replacement" });
    // Unknown field, cleared required field, malformed number, bad enum, bad link.
    expect(parseTenderCorrection("not_a_field", "x").ok).toBe(false);
    expect(parseTenderCorrection("title", "   ").ok).toBe(false);
    expect(parseTenderCorrection("contractAmountUsdMinor", "12.5").ok).toBe(false);
    expect(parseTenderCorrection("status", "exploded").ok).toBe(false);
    expect(parseTenderCorrection("sourceUrl", "javascript:alert(1)").ok).toBe(false);
    expect(parseTenderCorrection("sourceUrl", "https://example.gov/notice").ok).toBe(true);
    // A datetime is parsed to a Date; an integer to a number.
    const when = parseTenderCorrection("bidCloseAt", "2030-01-01T00:00:00.000Z");
    expect(when.ok && when.columnValue instanceof Date).toBe(true);
    expect(parseTenderCorrection("contractAmountMinor", "12345")).toEqual({ ok: true, columnValue: 12345, jsonValue: 12345 });
  });

  it("reads and checks the override map defensively", () => {
    expect(readTenderOverrides(null)).toEqual({});
    expect(readTenderOverrides(["nope"])).toEqual({});
    // Unknown keys survive in the row but are dropped from the parsed map.
    expect(readTenderOverrides({ title: "kept", bogus: 1 })).toEqual({ title: "kept" });
    expect(hasTenderFieldOverride({ title: "x" }, "title")).toBe(true);
    expect(hasTenderFieldOverride({ title: "x" }, "status")).toBe(false);
    expect(hasTenderFieldOverride({ bogus: 1 }, "bogus")).toBe(false);
    // On MariaDB (json → longtext) and any driver that does not parse JSON
    // columns, a read returns the raw JSON string, not an object. The reader
    // must parse it or every override reads back empty and cannot be reverted.
    expect(readTenderOverrides('{"title":"kept","bogus":1}')).toEqual({ title: "kept" });
    expect(readTenderOverrides("not json")).toEqual({});
    expect(readTenderOverrides("")).toEqual({});
    expect(hasTenderFieldOverride('{"title":"x"}', "title")).toBe(true);
    expect(hasTenderFieldOverride('{"title":"x"}', "status")).toBe(false);
  });

  it("round-trips a stored value between column and JSON forms", () => {
    const date = new Date("2030-05-01T00:00:00.000Z");
    const json = tenderFieldToJson("bidCloseAt", date);
    expect(json).toBe("2030-05-01T00:00:00.000Z");
    expect(tenderFieldFromJson("bidCloseAt", json)).toBeInstanceOf(Date);
    expect(tenderFieldFromJson("contractAmountMinor", 999)).toBe(999);
    expect(tenderFieldToJson("title", "x")).toBe("x");
    expect(tenderFieldDisplay(date)).toBe("2030-05-01T00:00:00.000Z");
    expect(tenderFieldDisplay(null)).toBeNull();
  });

  it("keeps the catalogue free of hard-coded values and untouched qualification shadow copies", () => {
    // The catalogue module must never itself invent a value or fetch a provider.
    const code = stripComments(corrections);
    expect(code).not.toContain("Math.random");
    expect(code).not.toContain("fetch(");
  });
});

describe("Tender Bid Stage 5 — audited corrections and revert-to-source", () => {
  it("requires a database and validates the note before any write", () => {
    expect(admin).toContain('throw new Error("Database is not available")');
    expect(admin).toContain("Provide a ${label} of 3–500 characters.");
    expect(admin).toContain("const note = validateNote(input.note, \"note\");");
  });

  it("writes an append-only tender_field_history row with old → new, administrator and note in one transaction", () => {
    expect(admin).toContain("db.transaction(async (tx) => {");
    expect(admin).toContain("tx.insert(tenderFieldHistory).values({");
    expect(admin).toContain("adminUserId: adminId,");
    expect(admin).toContain("oldValue: oldDisplay,");
    expect(admin).toContain("newValue: tenderFieldDisplay(parsed.jsonValue),");
    expect(admin).toContain("note,");
    // The old value is captured from the live row before the update.
    const capture = admin.indexOf("const oldDisplay = tenderFieldDisplay(");
    const update = admin.indexOf("tx.update(tenders).set(set)");
    expect(capture).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(capture);
  });

  it("captures the source value the first time a field is overridden so it can be reverted", () => {
    expect(admin).toContain("if (!Object.prototype.hasOwnProperty.call(overrides, field)) {");
    expect(admin).toContain("nextOverrides[field] = tenderFieldToJson(field, (row as Record<string, unknown>)[field]);");
    expect(admin).toContain("overridesJson: nextOverrides,");
    // A qualification correction also flips the dedicated admin-owned flag.
    expect(admin).toContain("QUALIFICATION_FIELDS.has(field)) set.qualificationOverridden = true;");
  });

  it("reverts only a genuinely overridden field and drops the override so ingestion resumes", () => {
    expect(admin).toContain("export async function revertTenderField");
    expect(admin).toContain('throw new Error("This field is not overridden, so there is nothing to revert.")');
    expect(admin).toContain("const sourceValue = tenderFieldFromJson(field, overrides[field]);");
    expect(admin).toContain("delete nextOverrides[field];");
    expect(admin).toContain("set.qualificationOverridden = qualificationOverriddenFor(nextOverrides);");
    expect(admin).toContain("Reverted to source value.");
  });

  it("bounds the correction list and the per-tender history", () => {
    expect(admin).toContain("TENDER_ADMIN_MAX_ROWS = 200");
    expect(admin).toContain("TENDER_CORRECTION_HISTORY_MAX_ROWS = 100");
    expect(admin).toContain(".limit(TENDER_ADMIN_MAX_ROWS)");
    expect(admin).toContain(".limit(TENDER_CORRECTION_HISTORY_MAX_ROWS)");
  });

  it("projects an explicit column set so a page of rows never pulls the heavy raw payload", () => {
    const adminCode = stripComments(admin);
    // The list and detail selects join the source but read only the desk columns;
    // the multi-hundred-KB `rawJson` payload is excluded so a 200-row page cannot
    // exhaust a small host's heap (the reported "Service is reconnecting…").
    expect(adminCode).toContain("getTableColumns(tenders)");
    expect(adminCode).toContain("tender: adminTenderColumns,");
    expect(adminCode).not.toContain("tender: tenders,");
  });

  it("makes an administrator-pinned status authoritative for the customer view", () => {
    expect(admin).toContain('if (hasTenderFieldOverride(row.overridesJson, "status")) return row.status;');
  });
});

describe("Tender Bid Stage 5 — overrides survive re-ingestion and reach the customer", () => {
  it("removes overridden source-derived fields from the ingestion update set", () => {
    expect(ingest).toContain('import { TENDER_SOURCE_DERIVED_FIELDS, readTenderOverrides } from "./corrections";');
    expect(ingest).toContain("const overrides = readTenderOverrides(existing?.overridesJson);");
    expect(ingest).toContain("if (TENDER_SOURCE_DERIVED_FIELDS.has(field) && field in update) delete update[field];");
    // Ingestion never writes the administrator-owned qualification fields.
    const ingestCode = stripComments(ingest);
    expect(ingestCode).not.toContain("qualificationAmountUsdMinor");
    expect(ingestCode).not.toContain("qualificationPctBps");
  });

  it("takes the pinned status through both the customer desk and the bid seam", () => {
    expect(customerDesk).toContain('import { hasTenderFieldOverride } from "./corrections";');
    expect(customerDesk).toContain('if (hasTenderFieldOverride(row.overridesJson, "status")) return row.status;');
    expect(bidding).toContain('if (hasTenderFieldOverride(row.overridesJson, "status")) return row.status;');
    // The recorded award path is preserved beneath the pin.
    expect(customerDesk).toContain('if (row.status === "awarded") return "awarded";');
  });

  it("persists the override map on the tenders table and in a guarded migration", () => {
    expect(schema).toContain('overridesJson: json("overridesJson"),');
    expect(migration).toContain("`overridesJson` json");
  });
});

describe("Tender Bid Stage 5 — sources health and audit", () => {
  it("returns each source with its health columns and a per-source tender count", () => {
    expect(admin).toContain("export async function listTenderSourcesForAdmin");
    expect(admin).toContain("lastSyncAt: iso(row.lastSyncAt),");
    expect(admin).toContain("lastStatus: row.lastStatus ?? null,");
    expect(admin).toContain("lastError: row.lastError ?? null,");
    expect(admin).toContain("tenderCount,");
    expect(admin).toContain("groupBy(tenders.sourceId)");
  });

  it("enables/disables a source and records the change in the shared audit trail", () => {
    expect(admin).toContain("export async function setTenderSourceEnabled");
    expect(admin).toContain('action: input.enabled ? "tender_source_enabled" : "tender_source_disabled",');
    expect(admin).toContain("entityType: \"tender_source\",");
    expect(admin).toContain("db.insert(v5AuditEvents).values({");
  });
});

describe("Tender Bid Stage 5 — server wiring", () => {
  it("exposes the corrections router with fields, list, detail, correct and revert", () => {
    expect(routers).toContain('import { correctTenderField, getTenderForAdmin, listTenderCorrectionFields, listTenderSourcesForAdmin, listTendersForAdmin, revertTenderField, runTenderIngestNow, setTenderSourceEnabled } from "./modules/tender/admin";');
    expect(routers).toContain("tenderCorrections: router({");
    expect(routers).toContain("fields: adminProcedure.query(() => listTenderCorrectionFields())");
    expect(routers).toContain("mutation(({ ctx, input }) => correctTenderField(ctx.user.id, input))");
    expect(routers).toContain("mutation(({ ctx, input }) => revertTenderField(ctx.user.id, input))");
  });

  it("exposes the sources router with list and setEnabled", () => {
    expect(routers).toContain("tenderSources: router({");
    expect(routers).toContain("list: adminProcedure.query(() => listTenderSourcesForAdmin())");
    expect(routers).toContain("mutation(({ ctx, input }) => setTenderSourceEnabled(ctx.user.id, input))");
  });

  it("keeps every console action administrator-gated", () => {
    const block = routers.slice(routers.indexOf("tenderCorrections: router({"), routers.indexOf("withdrawalPins:"));
    expect(block).toContain("adminProcedure");
    expect(block).not.toContain("publicProcedure");
    expect(block).not.toContain("protectedProcedure");
  });
});

describe("Tender Bid Stage 5 — administrator console UI", () => {
  it("exposes the three console surfaces and reads them from the admin API", () => {
    expect(component).toContain("export function AdminTenderBids");
    expect(component).toContain("export function AdminTenderCorrections");
    expect(component).toContain("export function AdminTenderSources");
    expect(component).toContain("trpc.adminOperations.tenderBids.list.useQuery");
    expect(component).toContain("trpc.adminOperations.tenderBids.applyCharge.useMutation");
    expect(component).toContain("trpc.adminOperations.tenderBids.decline.useMutation");
    expect(component).toContain("trpc.adminOperations.tenderBids.recordOutcome.useMutation");
    expect(component).toContain("trpc.adminOperations.tenderCorrections.correct.useMutation");
    expect(component).toContain("trpc.adminOperations.tenderCorrections.revert.useMutation");
    expect(component).toContain("trpc.adminOperations.tenderSources.setEnabled.useMutation");
  });

  it("requires an audited reason and confirms destructive admin actions", () => {
    expect(component).toContain("newIdempotencyKey");
    expect(component).toContain("Administrator reason (audited)");
    expect(component).toContain("window.confirm");
    expect(component).toContain("window.prompt");
    expect(component).toContain("Audit note (required for each change)");
  });

  it("puts a visible edit action beside each tender and jumps to its editable form", () => {
    expect(component).toContain("Edit tender");
    expect(component).toContain('aria-label={`Edit tender: ${row.title}`}');
    expect(component).toContain('detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(component).toContain('aria-label="Edit tender"');
    expect(component).toContain("<h2>Edit Tender</h2>");
  });

  it("renders only what the server returns (no client-side valuation)", () => {
    expect(component).not.toContain("getFreshTradingFxRate");
    expect(component).not.toContain("calculateCombinedBalanceSnapshot");
    expect(component).toContain('import "./admin-tender.css";');
  });
});

describe("Tender Bid Stage 5 — navigation and render wiring", () => {
  it("registers the three destinations in the admin nav registry", () => {
    expect(navigation).toContain('target: "tenderBids"');
    expect(navigation).toContain('target: "tenderCorrections"');
    expect(navigation).toContain('target: "tenderSources"');
  });

  it("lazy-loads, whitelists and renders each console", () => {
    expect(app).toContain('import("@/components/AdminTenderBid").then((module) => ({ default: module.AdminTenderBids }))');
    expect(app).toContain('import("@/components/AdminTenderBid").then((module) => ({ default: module.AdminTenderCorrections }))');
    expect(app).toContain('import("@/components/AdminTenderBid").then((module) => ({ default: module.AdminTenderSources }))');
    expect(app).toContain('"tenderBids","tenderCorrections","tenderSources"');
    expect(app).toContain('section==="tenderBids"&&');
    expect(app).toContain('section==="tenderCorrections"&&');
    expect(app).toContain('section==="tenderSources"&&');
  });
});

describe("Tender Bid Stage 5 — themed admin console styles", () => {
  it("defines the console surfaces and status chips on the portal theme tokens", () => {
    for (const cls of ["admin-tender-page", "tb-admin-chip", "tb-admin-actions", "tb-admin-action-buttons", "tb-admin-override-badge", "tb-admin-detail", "tb-admin-note-field", "tb-admin-fields", "tb-admin-field", "tb-admin-field-head", "tb-admin-field-row", "tb-admin-history", "tb-admin-error"]) {
      expect(css).toContain(`.${cls}`);
    }
    expect(css).toContain(".tb-admin-chip-placed");
    expect(css).toContain(".tb-admin-chip-charged");
    expect(css).toContain(".tb-admin-chip-cancelled");
    expect(css).toContain(".tb-admin-sync-ok");
    expect(css).toContain(".tb-admin-sync-error");
  });
});
