import { describe, expect, it, vi } from "vitest";
import {
  acknowledgePopupDelivery,
  popupAcknowledgementBackoffMs,
  runPopupDeliveryAcknowledgement,
  POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS,
} from "./popup-delivery-acknowledgement";

describe("popup delivery receipt and rendering acknowledgements", () => {
  it("records receipt before rendered after the browser has displayed the notice", async () => {
    const order: string[] = [];
    const result = await acknowledgePopupDelivery({
      received: async () => { order.push("received"); },
      rendered: async () => { order.push("rendered"); },
      isCurrent: () => true,
      wait: async () => {},
    });
    expect(result).toBe("acknowledged");
    expect(order).toEqual(["received", "rendered"]);
  });

  it("retries a rendered acknowledgement whose response was interrupted after receipt", async () => {
    let receivedCalls = 0;
    let renderedCalls = 0;
    const result = await acknowledgePopupDelivery({
      received: async () => { receivedCalls += 1; },
      rendered: async () => { renderedCalls += 1; if (renderedCalls === 1) throw new Error("response lost"); },
      isCurrent: () => true,
      wait: async () => {},
    });
    expect(result).toBe("acknowledged");
    expect(receivedCalls).toBe(2);
    expect(renderedCalls).toBe(2);
  });

  it("repeats receipt when its response was lost, then safely proceeds to rendering", async () => {
    let receivedCalls = 0;
    let renderedCalls = 0;
    const result = await acknowledgePopupDelivery({
      received: async () => { receivedCalls += 1; if (receivedCalls === 1) throw new Error("receipt response lost"); },
      rendered: async () => { renderedCalls += 1; },
      isCurrent: () => true,
      wait: async () => {},
    });
    expect(result).toBe("acknowledged");
    expect(receivedCalls).toBe(2);
    expect(renderedCalls).toBe(1);
  });

  it("requests a later retry without reporting delivery failure after temporary outage", async () => {
    const received = vi.fn().mockRejectedValue(new Error("offline"));
    const rendered = vi.fn();
    const result = await acknowledgePopupDelivery({ received, rendered, isCurrent: () => true, wait: async () => {} });
    expect(result).toBe("retry");
    expect(received).toHaveBeenCalledTimes(3);
    expect(rendered).not.toHaveBeenCalled();
  });

  it("stops retries when the displayed popup is no longer the current delivery", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const received = vi.fn().mockRejectedValue(new Error("offline"));
    const rendered = vi.fn();
    const result = await acknowledgePopupDelivery({ received, rendered, isCurrent, wait: async () => {} });
    expect(result).toBe("cancelled");
    expect(received).toHaveBeenCalledTimes(1);
    expect(rendered).not.toHaveBeenCalled();
  });

  it("rejects invalid retry bounds", async () => {
    await expect(acknowledgePopupDelivery({
      received: async () => {}, rendered: async () => {}, isCurrent: () => true, maxAttempts: 0,
    })).rejects.toThrow("integer from 1 to 10");
  });
});

describe("bounded whole-job popup acknowledgement (item 34)", () => {
  it("acknowledges once and stops as soon as the receipt and render succeed", async () => {
    const received = vi.fn(async () => {});
    const rendered = vi.fn(async () => {});
    const onGiveUp = vi.fn();
    const result = await runPopupDeliveryAcknowledgement({ received, rendered, isCurrent: () => true, wait: async () => {}, onGiveUp });
    expect(result).toBe("acknowledged");
    expect(received).toHaveBeenCalledTimes(1);
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up after a bounded number of attempts and reports a terminal unconfirmed state once", async () => {
    const received = vi.fn().mockRejectedValue(new Error("offline"));
    const rendered = vi.fn();
    const onGiveUp = vi.fn();
    const result = await runPopupDeliveryAcknowledgement({
      received, rendered, isCurrent: () => true, now: () => 0, wait: async () => {}, onGiveUp,
    });
    expect(result).toBe("unconfirmed");
    expect(received).toHaveBeenCalledTimes(POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxAttempts);
    expect(rendered).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith({ attempts: POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxAttempts, elapsedMs: 0 });
  });

  it("stops before the attempt cap once the wall-clock budget is exhausted", async () => {
    let clock = 0;
    const received = vi.fn().mockRejectedValue(new Error("offline"));
    const onGiveUp = vi.fn();
    const result = await runPopupDeliveryAcknowledgement({
      received,
      rendered: vi.fn(),
      isCurrent: () => true,
      now: () => clock,
      wait: async () => { clock += 50_000; },
      onGiveUp,
    });
    expect(result).toBe("unconfirmed");
    expect(received).toHaveBeenCalledTimes(2);
    expect(received.mock.calls.length).toBeLessThan(POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxAttempts);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp.mock.calls[0][0].elapsedMs).toBeGreaterThanOrEqual(POPUP_ACKNOWLEDGEMENT_RETRY_LIMITS.maxDurationMs);
  });

  it("stops as cancelled without giving up when the popup is no longer current", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    const received = vi.fn().mockRejectedValue(new Error("offline"));
    const onGiveUp = vi.fn();
    const result = await runPopupDeliveryAcknowledgement({
      received, rendered: vi.fn(), isCurrent, wait: async () => {}, onGiveUp,
    });
    expect(result).toBe("cancelled");
    expect(received).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("never throws and never reports failure when acknowledgement keeps failing", async () => {
    const result = await runPopupDeliveryAcknowledgement({
      received: async () => { throw new Error("boom"); },
      rendered: async () => { throw new Error("boom"); },
      isCurrent: () => true,
      wait: async () => {},
      onGiveUp: () => {},
    });
    expect(result).toBe("unconfirmed");
  });
});

describe("bounded acknowledgement back-off", () => {
  it("doubles from the base delay and is capped at the ceiling", () => {
    expect(popupAcknowledgementBackoffMs(0)).toBe(1_000);
    expect(popupAcknowledgementBackoffMs(1)).toBe(2_000);
    expect(popupAcknowledgementBackoffMs(2)).toBe(4_000);
    expect(popupAcknowledgementBackoffMs(3)).toBe(8_000);
    expect(popupAcknowledgementBackoffMs(4)).toBe(15_000);
    expect(popupAcknowledgementBackoffMs(10)).toBe(15_000);
  });

  it("falls back to the base delay for an invalid index", () => {
    expect(popupAcknowledgementBackoffMs(-1)).toBe(1_000);
    expect(popupAcknowledgementBackoffMs(1.5)).toBe(1_000);
    expect(popupAcknowledgementBackoffMs(Number.NaN)).toBe(1_000);
  });
});
