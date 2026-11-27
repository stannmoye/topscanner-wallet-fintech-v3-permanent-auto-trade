import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR,
  TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR,
  TENDER_QUALIFICATION_CEILING_USD_MINOR,
  TENDER_QUALIFICATION_FLOOR_USD_MINOR,
  TENDER_QUALIFICATION_PCT_BPS_MAX,
  computeQualificationAmountUsdMinor,
  isContractValueInInclusionRange,
} from "./economics";
import { TENDER_DESK_MAX_ROWS } from "./customerDesk";
import { TENDER_BID_QUEUE_MAX_ROWS } from "./bidding";
import {
  TENDER_INGEST_MAX_FETCH_ATTEMPTS,
  TENDER_INGEST_MAX_PAGES_PER_SOURCE,
  TENDER_INGEST_RETRY_BASE_DELAY_MS,
} from "./ingest";
import { WORKER_HEALTH_REGISTRY } from "../../_core/workerHealth";

/**
 * Stage 7 contract — the final hardening/verification pass for the Tender Bid
 * desk, plus the interaction-and-motion system on both portal surfaces.
 *
 * Part A pins the spec §12 guardrails end-to-end across every module the desk
 * touches (real data only; fail-closed FX and qualification; admin-configured,
 * persisted and audited and never hard-coded; idempotent bids and charges;
 * ledger discipline with immutable history; attribution; labelling).
 *
 * Part B pins the master-roadmap "Stage 7 — Button Feedback, Animations and
 * Interaction Quality" work on the customer desk and the administrator console:
 * hover/focus/pressed states, in-flight loading indicators, clear success and
 * failure feedback, dialogs, reduced-motion respect, duplicate-request
 * prevention and non-hover touch feedback.
 *
 * The services are asserted on their source because they need a live database,
 * which the contract harness does not provide; every behavioural guarantee that
 * can be exercised without one (the qualification clamp, the fail-closed range
 * check) is called directly.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
/** Strip comments so negative substring assertions test code, not prose. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const economics = read("./economics.ts");
const ingest = read("./ingest.ts");
const ingestCode = stripComments(ingest);
const bidding = read("./bidding.ts");
const biddingCode = stripComments(bidding);
const customerDesk = read("./customerDesk.ts");
const customerDeskCode = stripComments(customerDesk);
const db = read("../../db.ts");
const routers = read("../../routers.ts");
const workerHealth = read("../../_core/workerHealth.ts");
const coreIndex = read("../../_core/index.ts");
const schema = readFileSync(new URL("../../../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../drizzle/0125_tender_bid.sql", import.meta.url), "utf8");
const customerComponent = readFileSync(new URL("../../../client/src/components/CustomerTenderBid.tsx", import.meta.url), "utf8");
const adminComponent = readFileSync(new URL("../../../client/src/components/AdminTenderBid.tsx", import.meta.url), "utf8");
const customerCss = readFileSync(new URL("../../../client/src/components/tender-bid.css", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../../../client/src/components/admin-tender.css", import.meta.url), "utf8");

describe("Tender Bid Stage 7 — guardrail: real data only", () => {
  it("reads the customer catalogue only through an inner join to a real source", () => {
    expect(customerDesk).toContain("innerJoin(tenderSources, eq(tenders.sourceId, tenderSources.id))");
    // An inner join (never a left join) means a tender with no source row is never returned.
    expect(customerDeskCode).not.toContain("leftJoin(tenderSources");
    expect(customerDesk).toContain('throw new Error("Database is not available")');
  });

  it("carries no synthetic, seeded or demo tender data anywhere in the tender modules", () => {
    const files = readdirSync(new URL("./", import.meta.url))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    expect(files.some((file) => /seed|fixture|sample|demo|mock/i.test(file))).toBe(false);
    for (const source of [customerDeskCode, ingestCode, biddingCode]) {
      expect(source).not.toContain("Math.random");
    }
  });
});

describe("Tender Bid Stage 7 — guardrail: fail closed", () => {
  it("treats an unknown or malformed contract value as unknown, never as out of range", () => {
    expect(isContractValueInInclusionRange(null)).toBeNull();
    expect(isContractValueInInclusionRange(undefined)).toBeNull();
    expect(isContractValueInInclusionRange(1234.5)).toBeNull();
    expect(isContractValueInInclusionRange(TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR)).toBe(true);
    expect(isContractValueInInclusionRange(TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR - 1)).toBe(false);
    expect(isContractValueInInclusionRange(TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR)).toBe(true);
    expect(isContractValueInInclusionRange(TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR + 1)).toBe(false);
  });

  it("returns no qualification amount when the value or the configured percentage is missing or malformed", () => {
    expect(computeQualificationAmountUsdMinor(null, 100)).toBeNull();
    expect(computeQualificationAmountUsdMinor(1_000_000_00, null)).toBeNull();
    expect(computeQualificationAmountUsdMinor(1_000_000_00, 0)).toBeNull();
    expect(computeQualificationAmountUsdMinor(1_000_000_00, -5)).toBeNull();
    expect(computeQualificationAmountUsdMinor(1_000_000_00, TENDER_QUALIFICATION_PCT_BPS_MAX + 1)).toBeNull();
    expect(computeQualificationAmountUsdMinor(0, 100)).toBeNull();
  });

  it("clamps the configured percentage to the owner-locked $1,000–$600,000 band and passes it through otherwise", () => {
    expect(computeQualificationAmountUsdMinor(TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR, 1)).toBe(TENDER_QUALIFICATION_FLOOR_USD_MINOR);
    expect(computeQualificationAmountUsdMinor(TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR, TENDER_QUALIFICATION_PCT_BPS_MAX)).toBe(TENDER_QUALIFICATION_CEILING_USD_MINOR);
    // A mid-band percentage applies the proportional amount unchanged.
    expect(computeQualificationAmountUsdMinor(10_000_000_00, 100)).toBe(100_000_00);
  });

  it("keeps the USD value null when no fresh FX rate resolves, never guessing from the stored snapshot", () => {
    expect(ingest).toContain('if (!config) return { usdMinor: null, snapshotId: null };');
    expect(ingest).toContain("usdMinor = nativeMinorToUsdMinorExact(tender.contractAmountMinor, config.scale, rate.rateUsdPerUnit);");
    expect(ingest).toContain("getFreshTradingFxRate");
    // The stored audit snapshot is never used as a calculation input: the snapshot field
    // is named only in prose, never read in the conversion code.
    expect(ingest).toContain("is an audit snapshot and is never used as a");
    expect(ingestCode).not.toContain("usdRate");
  });

  it("records no bid when the customer balance cannot be valued at a fresh rate", () => {
    expect(bidding).toContain('if (snapshot.balanceStatus === "unknown")');
    expect(bidding).toContain("availableUsdMinor: null, sufficient: false, shortfallUsdMinor: requiredMinor");
    // The bid row is only written after the sufficiency gate.
    const gate = bidding.indexOf("if (!valuation.sufficient)");
    const insert = bidding.indexOf(".insert(tenderBids)");
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
  });
});

describe("Tender Bid Stage 7 — guardrail: admin-configured, persisted, audited", () => {
  it("locks only the owner-approved band and takes the percentage as an argument, never a literal", () => {
    expect(TENDER_CONTRACT_INCLUSION_MIN_USD_MINOR).toBe(100_000 * 100);
    expect(TENDER_CONTRACT_INCLUSION_MAX_USD_MINOR).toBe(250_000_000 * 100);
    expect(TENDER_QUALIFICATION_FLOOR_USD_MINOR).toBe(1_000 * 100);
    expect(TENDER_QUALIFICATION_CEILING_USD_MINOR).toBe(600_000 * 100);
    expect(TENDER_QUALIFICATION_PCT_BPS_MAX).toBe(10_000);
    expect(economics).toContain("proportionalMinorAmount(contractUsdMinor, qualificationPctBps, TENDER_QUALIFICATION_PCT_BPS_MAX)");
  });

  it("persists the configured percentage, the computed amount and its override flag on the tender", () => {
    expect(schema).toContain('qualificationPctBps: int("qualificationPctBps"),');
    expect(schema).toContain('qualificationAmountUsdMinor: bigint("qualificationAmountUsdMinor", { mode: "number" }),');
    expect(schema).toContain('qualificationOverridden: boolean("qualificationOverridden")');
    expect(schema).toContain('overridesJson: json("overridesJson"),');
  });

  it("audits the charge through the classified manual-adjustment ledger, carrying the administrator and a reason", () => {
    expect(bidding).toContain("adjustCustomerBalance(adminId, {");
    expect(bidding).toContain("reason,");
    expect(db).toContain("`admin_${input.mode}`");
  });
});

describe("Tender Bid Stage 7 — guardrail: idempotent bids and charges", () => {
  it("hashes the key, enforces one bid per customer/tender and survives a duplicate-key race", () => {
    expect(bidding).toContain('crypto.createHash("sha256")');
    expect(bidding).toContain("eq(tenderBids.userId, userId), eq(tenderBids.tenderId, tenderId)");
    expect(bidding).toContain('code === "ER_DUP_ENTRY"');
    expect(bidding).toContain("alreadyPlaced: !created");
    // The uniqueness is enforced in storage, not only in code.
    expect(migration).toContain("tender_bids_user_tender_uq");
    expect(migration).toContain("tender_bids_idempotency_uq");
  });

  it("keys the administrative charge idempotently and locks the bid row before transitioning", () => {
    expect(bidding).toContain("tender-charge:${bidId}:");
    expect(bidding).toContain('.for("update")');
    expect(bidding).toContain("alreadyApplied: true");
  });

  it("validates the idempotency key shape on every mutating entry point", () => {
    expect(bidding).toContain("A valid idempotency key is required.");
    expect(routers).toContain("idempotencyKey: z.string().min(8).max(160),");
  });
});

describe("Tender Bid Stage 7 — guardrail: ledger discipline and immutable history", () => {
  it("posts the charge as a classified manual debit that resolves to a reversible admin entry", () => {
    expect(bidding).toContain('mode: "debit"');
    expect(bidding).toContain('debitClassification: "ordinary_debit"');
    expect(db).toContain("`admin_${input.mode}`");
  });

  it("never deletes or mutates historical bids or events; every transition appends an event row", () => {
    expect(biddingCode).not.toContain(".delete(");
    for (const type of ['type: "placed"', 'type: "charged"', 'type: "cancelled"', "type: input.outcome"]) {
      expect(bidding).toContain(type);
    }
    expect(bidding).toContain("tx.insert(tenderBidEvents)");
  });
});

describe("Tender Bid Stage 7 — guardrail: attribution and labelling", () => {
  it("gives every tender a real source URL and keeps every source link in a dedupe group", () => {
    expect(customerDesk).toContain("url: row.tender.sourceUrl,");
    expect(customerDesk).toContain("sourceCount: sources.length,");
    expect(customerDesk).toContain("if (!sources.length) sources.push(toSourceRef(canonical));");
  });

  it("labels every amount as a configured/contractual value and links the source in the UI", () => {
    expect(customerComponent).toContain("configured/contractual");
    expect(customerComponent).toContain("no award is guaranteed");
    expect(customerComponent).toContain('target="_blank"');
    expect(customerComponent).toContain('rel="noopener noreferrer"');
    // The desk links the customer to the source portal; it never submits to it.
    expect(customerComponent).not.toContain("submitBid");
  });
});

describe("Tender Bid Stage 7 — guardrail: monitored worker and bounded loading", () => {
  it("registers and monitors the ingestion worker", () => {
    expect(WORKER_HEALTH_REGISTRY.some((worker) => worker.key === "tender-ingest")).toBe(true);
    expect(workerHealth).toContain('key: "tender-ingest"');
    expect(coreIndex).toContain('runMonitoredWorkerCycle("tender-ingest"');
  });

  it("bounds every read and every ingestion cycle", () => {
    expect(TENDER_DESK_MAX_ROWS).toBe(500);
    expect(TENDER_BID_QUEUE_MAX_ROWS).toBe(500);
    expect(TENDER_INGEST_MAX_PAGES_PER_SOURCE).toBeGreaterThan(0);
    expect(TENDER_INGEST_MAX_FETCH_ATTEMPTS).toBe(3);
    expect(TENDER_INGEST_RETRY_BASE_DELAY_MS).toBe(500);
  });
});

describe("Tender Bid Stage 7 — customer desk interaction quality", () => {
  it("guards against a duplicate bid and shows an in-flight indicator", () => {
    expect(customerComponent).toContain("useRef");
    expect(customerComponent).toContain("bidLock");
    expect(customerComponent).toContain("tb-spinner");
    expect(customerComponent).toContain("aria-busy");
  });

  it("gives the bid panel clear success and failure feedback", () => {
    expect(customerComponent).toContain("tb-bid-feedback");
    expect(customerComponent).toContain('role={bidFeedback.kind === "error" ? "alert" : "status"}');
  });

  it("makes the tender pop-up a real dialog (Escape to close, focus on open)", () => {
    expect(customerComponent).toContain('event.key === "Escape"');
    expect(customerComponent).toContain("closeButtonRef.current?.focus()");
    expect(customerComponent).toContain('aria-modal="true"');
  });

  it("defines hover, focus, pressed, motion, touch and reduced-motion styles", () => {
    for (const token of ["--tb-motion-fast", "--tb-motion-slow", "--tb-motion-ease"]) expect(customerCss).toContain(token);
    expect(customerCss).toContain("@keyframes tb-spin");
    expect(customerCss).toContain(".tb-spinner");
    expect(customerCss).toContain(":focus-visible");
    expect(customerCss).toContain(":active");
    expect(customerCss).toContain("@media (hover: none)");
    expect(customerCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(customerCss).toContain(".tb-bid-feedback");
  });
});

describe("Tender Bid Stage 7 — admin console interaction quality", () => {
  it("guards against duplicate administrator requests and shows an in-flight indicator", () => {
    expect(adminComponent).toContain("useRef");
    expect(adminComponent).toContain("actionLock");
    expect(adminComponent).toContain("tb-admin-spinner");
    expect(adminComponent).toContain("aria-busy");
  });

  it("defines hover, focus, pressed, motion, touch and reduced-motion styles", () => {
    for (const token of ["--tb-admin-motion-fast", "--tb-admin-motion-slow", "--tb-admin-motion-ease"]) expect(adminCss).toContain(token);
    expect(adminCss).toContain("@keyframes tb-admin-spin");
    expect(adminCss).toContain(".tb-admin-spinner");
    expect(adminCss).toContain(":focus-visible");
    expect(adminCss).toContain(":active");
    expect(adminCss).toContain("@media (hover: none)");
    expect(adminCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
