import { describe, expect, it, vi } from "vitest";
import type mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { recordDeliveryHistory } from "./opportunityLifecycle";

const lifecycleSource = readFileSync(new URL("./opportunityLifecycle.ts", import.meta.url), "utf8");

function failingConnection(error: unknown): mysql.PoolConnection {
  return { execute: vi.fn().mockRejectedValue(error) } as unknown as mysql.PoolConnection;
}

describe("recordDeliveryHistory fail-soft diagnostics (item 53)", () => {
  it("stays fail-soft: a history write failure never throws or changes the delivery decision", async () => {
    await expect(recordDeliveryHistory(failingConnection(Object.assign(new Error("write failed"), { code: "ER_NO_SUCH_TABLE" })), {
      userId: 12, offerId: 903, eventKey: "queue_created", eventType: "queue_created",
    })).resolves.toBeUndefined();
  });

  it("logs one bounded, rate-limited warning carrying the event id and the MySQL error code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const connection = failingConnection(Object.assign(new Error("Table 'arbitrade.opportunity_delivery_history' doesn't exist"), { code: "ER_NO_SUCH_TABLE" }));
      const input = { userId: 12, offerId: 903, eventKey: "queue_created", eventType: "history_warning_contract", observedStatus: "queued" };
      await recordDeliveryHistory(connection, input);
      // A repeat of the same failure signature within the bounded window is suppressed.
      await recordDeliveryHistory(connection, input);
      await recordDeliveryHistory(connection, input);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain("[OpportunityDeliveryHistory]");
      expect(message).toContain("history_warning_contract");
      expect(message).toContain("queue_created");
      expect(message).toContain("903");
      expect(message).toContain("ER_NO_SUCH_TABLE");
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back to the caller error code when the driver exposes none, and redacts credentials", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const connection = failingConnection(new Error("connect failed mysql://root:supersecret@db.internal/app"));
      await recordDeliveryHistory(connection, {
        userId: 5, offerId: 1, eventKey: "lease_expired:2", eventType: "history_warning_redact", errorCode: "DELIVERY_LEASE_EXPIRED",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain("DELIVERY_LEASE_EXPIRED");
      expect(message).toContain("[database-url-redacted]");
      expect(message).not.toContain("supersecret");
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps the catch bounded and inline so delivery behaviour is unchanged", () => {
    expect(lifecycleSource).toContain("logDeliveryHistoryFailure(input, error);");
    expect(lifecycleSource).toContain("DELIVERY_HISTORY_WARNING_INTERVAL_MS = 60_000");
    expect(lifecycleSource).toContain("[OpportunityDeliveryHistory] could not record");
  });
});
