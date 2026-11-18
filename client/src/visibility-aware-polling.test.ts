import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOMER_BALANCE_POLL_INTERVAL_MS,
  CUSTOMER_BALANCE_RIBBON_POLL_INTERVAL_MS,
  CUSTOMER_CONSOLE_POLL_INTERVAL_MS,
  CUSTOMER_CONSOLE_PULSE_INTERVAL_MS,
  CUSTOMER_OPPORTUNITY_POLL_INTERVAL_MS,
  POLL_BACKOFF_MAX_INTERVAL_MS,
  isPollingDocumentVisible,
  pollingBackoffInterval,
  visibilityAwareRefetchInterval,
} from "./visibility-aware-polling";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

const originalDocument = (globalThis as { document?: unknown }).document;

function setDocumentVisibility(state: "visible" | "hidden" | "prerender" | undefined) {
  (globalThis as { document?: unknown }).document =
    state === undefined ? undefined : { visibilityState: state };
}

afterEach(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

describe("visibility-aware polling policy (item 38)", () => {
  it("keeps today's live cadence while the tab is visible", () => {
    expect(CUSTOMER_BALANCE_RIBBON_POLL_INTERVAL_MS).toBe(1_500);
    expect(CUSTOMER_OPPORTUNITY_POLL_INTERVAL_MS).toBe(3_000);
    expect(CUSTOMER_CONSOLE_POLL_INTERVAL_MS).toBe(2_000);
    expect(CUSTOMER_CONSOLE_PULSE_INTERVAL_MS).toBe(1_800);
  });

  it("backs off exponentially after consecutive failures and caps the wait", () => {
    expect(pollingBackoffInterval(2_000, 0)).toBe(2_000);
    expect(pollingBackoffInterval(2_000, 1)).toBe(4_000);
    expect(pollingBackoffInterval(2_000, 2)).toBe(8_000);
    expect(pollingBackoffInterval(2_000, 3)).toBe(16_000);
    expect(pollingBackoffInterval(2_000, 50)).toBe(POLL_BACKOFF_MAX_INTERVAL_MS);
  });

  it("treats bad back-off input as the base interval", () => {
    expect(pollingBackoffInterval(Number.NaN, Number.NaN)).toBe(1);
    expect(pollingBackoffInterval(5_000, -3)).toBe(5_000);
  });

  it("pauses polling (returns false) while the tab is hidden", () => {
    setDocumentVisibility("hidden");
    expect(isPollingDocumentVisible()).toBe(false);
    expect(visibilityAwareRefetchInterval(5_000, 0)).toBe(false);
    expect(visibilityAwareRefetchInterval(5_000, 4)).toBe(false);
  });

  it("polls at the base rate when the tab is visible", () => {
    setDocumentVisibility("visible");
    expect(isPollingDocumentVisible()).toBe(true);
    expect(visibilityAwareRefetchInterval(5_000, 0)).toBe(5_000);
    expect(visibilityAwareRefetchInterval(5_000, 1)).toBe(10_000);
  });

  it("is safe where there is no document (SSR / headless tests)", () => {
    setDocumentVisibility(undefined);
    expect(isPollingDocumentVisible()).toBe(true);
    expect(visibilityAwareRefetchInterval(3_000, 0)).toBe(3_000);
  });

  it("wires every live customer poll through the shared policy", () => {
    // No raw numeric refetchInterval values remain on customer queries.
    expect(app).toContain("refetchInterval:(query)=>visibilityAwareRefetchInterval(CUSTOMER_BALANCE_RIBBON_POLL_INTERVAL_MS,query.state.fetchFailureCount)");
    expect(app).toContain("refetchInterval:(query)=>visibilityAwareRefetchInterval(CUSTOMER_OPPORTUNITY_POLL_INTERVAL_MS,query.state.fetchFailureCount)");
    expect(app).toContain("refetchInterval:(query)=>visibilityAwareRefetchInterval(CUSTOMER_CONSOLE_POLL_INTERVAL_MS,query.state.fetchFailureCount)");
  });

  it("keeps the opportunity and console intervals stable instead of resetting them", () => {
    expect(app).toContain("const id=window.setInterval(()=>{if(!isPollingDocumentVisible())return;attemptNextRef.current(opportunityOffersRef.current)},5000)");
    expect(app).toContain("const id=window.setInterval(()=>{if(!isPollingDocumentVisible())return;const current=pulseRef.current;if(!current.isPending)current.mutate()},CUSTOMER_CONSOLE_PULSE_INTERVAL_MS)");
    expect(app).not.toContain("window.setInterval(()=>{if(!pulse.isPending)pulse.mutate()},1800)");
    expect(app).not.toContain("window.setInterval(()=>attemptNext(opportunityData?.offers||[]),5000)");
  });

  it("refetches active queries immediately when the tab becomes visible again", () => {
    expect(main).toContain('document.addEventListener("visibilitychange"');
    expect(main).toContain('document.visibilityState === "visible"');
    expect(main).toContain('queryClient.refetchQueries({ type: "active" })');
  });
});
