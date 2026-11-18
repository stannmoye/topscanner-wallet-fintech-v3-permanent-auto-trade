import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { updatePopupDeliveryStatus } from "./opportunityLifecycle";

const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

describe("popup delivery acknowledgement requires a lease token (item 24)", () => {
  it("requires leaseToken in the customer.popupDeliveryStatus input schema", () => {
    const start = routers.indexOf("popupDeliveryStatus:");
    expect(start).toBeGreaterThanOrEqual(0);
    const line = routers.slice(start, routers.indexOf("\n", start));
    expect(line).toContain("leaseToken: z.string().uuid()");
    expect(line).not.toContain("leaseToken: z.string().uuid().optional()");
  });

  it("rejects a missing or blank lease token with a clear error instead of a silent no-op", async () => {
    const blankTokens = ["", "   ", "\t\n", undefined as unknown as string, null as unknown as string];
    for (const token of blankTokens) {
      await expect(updatePopupDeliveryStatus(1, 1, "received", token)).rejects.toThrow(/delivery lease token/i);
      await expect(updatePopupDeliveryStatus(1, 1, "rendered", token)).rejects.toThrow(/delivery lease token/i);
    }
  });

  it("always sends the lease token from the customer client", () => {
    expect(app).toContain('const leaseToken=String(ackTarget?.leaseToken||"")');
    expect(app).toContain("if(eventId<=0||!leaseToken)return;");
    expect(app).toContain('status:"received",leaseToken');
    expect(app).toContain('status:"rendered",leaseToken');
  });
});
