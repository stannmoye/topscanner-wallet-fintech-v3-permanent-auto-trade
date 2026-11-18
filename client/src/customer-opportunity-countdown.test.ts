import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createServerClockAnchor,
  remainingOpportunityMilliseconds,
  remainingOpportunityMillisecondsFromAnchor,
  remainingOpportunitySeconds,
  serverNowMilliseconds,
} from "./customer-opportunity-countdown";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("customer opportunity countdown", () => {
  const closesAt = "2030-01-01T00:02:08.000Z";

  it("continues from the same saved close timestamp after a refresh", () => {
    const firstReadAt = Date.parse("2030-01-01T00:01:00.000Z");
    const refreshedAt = Date.parse("2030-01-01T00:01:05.000Z");
    expect(remainingOpportunityMilliseconds(closesAt, firstReadAt)).toBe(68_000);
    expect(remainingOpportunityMilliseconds(closesAt, refreshedAt)).toBe(63_000);
    expect(remainingOpportunitySeconds(closesAt, refreshedAt)).toBe(63);
    expect(app).toContain("remainingOpportunityMilliseconds(popup.closesAt,clockNow,0)");
    expect(app).toContain("remainingOpportunityMilliseconds(popupRef.current?.closesAt,readServerNow(),0)");
    // The wall-clock offset ref is gone; nothing derives "now" from Date.now()
    // plus a one-time offset any more.
    expect(app).not.toContain("serverClockOffsetMs");
  });

  it("applies the server clock sample without changing the saved deadline", () => {
    const now = Date.parse("2030-01-01T00:01:00.000Z");
    expect(remainingOpportunityMilliseconds(closesAt, now, 2_000)).toBe(66_000);
  });

  it("does not invent a fallback countdown for an invalid close timestamp", () => {
    expect(remainingOpportunityMilliseconds("invalid", Date.now())).toBeNull();
    expect(remainingOpportunitySeconds(null, Date.now())).toBeNull();
    expect(app).toContain("if(remainingMs===null)return;");
    expect(app).not.toContain("configuredSeconds*1000");
  });
});

describe("server-anchored opportunity clock (item 36)", () => {
  const serverTime = "2030-01-01T00:01:00.000Z";
  const serverTimeMs = Date.parse(serverTime);
  const closesAt = "2030-01-01T00:02:08.000Z"; // 68 s after serverTime

  it("derives now from the server time plus monotonic elapsed time only", () => {
    const anchor = createServerClockAnchor(serverTime, 1_000);
    expect(anchor).not.toBeNull();
    expect(serverNowMilliseconds(anchor, 1_000)).toBe(serverTimeMs);
    // 5 s of monotonic elapsed time later, "now" is exactly 5 s past the
    // server time, regardless of any wall-clock change.
    expect(serverNowMilliseconds(anchor, 6_000)).toBe(serverTimeMs + 5_000);
    expect(remainingOpportunityMillisecondsFromAnchor(closesAt, anchor, 1_000)).toBe(68_000);
    expect(remainingOpportunityMillisecondsFromAnchor(closesAt, anchor, 6_000)).toBe(63_000);
    expect(remainingOpportunityMillisecondsFromAnchor(closesAt, anchor, 69_000)).toBe(0);
  });

  it("is unaffected by the browser wall clock moving forward or backward", () => {
    // The resolver never reads Date.now(), so a wall-clock jump cannot alter it.
    const anchor = createServerClockAnchor(serverTime, 500);
    const jumpingWallClock = () => Date.now() + 365 * 24 * 60 * 60 * 1_000;
    void jumpingWallClock();
    expect(remainingOpportunityMillisecondsFromAnchor(closesAt, anchor, 3_500)).toBe(65_000);
  });

  it("returns null for an invalid server time or a non-finite performance reading", () => {
    expect(createServerClockAnchor("not-a-date", 1_000)).toBeNull();
    expect(createServerClockAnchor("", 1_000)).toBeNull();
    expect(createServerClockAnchor(serverTime, Number.NaN)).toBeNull();
    expect(serverNowMilliseconds(null, 1_000)).toBeNull();
    expect(remainingOpportunityMillisecondsFromAnchor(closesAt, null, 1_000)).toBeNull();
  });

  it("wires the popup to the server-anchored clock and re-anchors on every feed", () => {
    expect(app).toContain("createServerClockAnchor(opportunityData?.serverTime");
    expect(app).toContain("serverNowMilliseconds(serverClockAnchorRef.current");
    expect(app).toContain("setClockNow(readServerNow())");
    expect(app).toContain("window.setInterval(()=>setClockNow(readServerNow()),1000)");
    expect(app).toContain("isFreshCustomerPopupCandidate(offer,readServerNow())");
  });
});
