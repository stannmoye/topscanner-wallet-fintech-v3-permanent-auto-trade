import {describe,expect,it} from "vitest";
import {isPopupExecutionEligible} from "./popup-execution-policy";

describe("popup presentation and execution isolation",()=>{
  const delivered={deliveryStatus:"rendered",executionStatus:"READY"};
  it("keeps noticed, opened and dismissed popups eligible for automatic execution",()=>{
    expect(isPopupExecutionEligible({...delivered,eventStatus:"NOTICED"})).toBe(true);
    expect(isPopupExecutionEligible({...delivered,eventStatus:"OPENED"})).toBe(true);
    expect(isPopupExecutionEligible({...delivered,eventStatus:"DISMISSED"})).toBe(true);
  });
  it("keeps delivery status informational while failing closed for terminal, running, or unknown execution states",()=>{
    for (const deliveryStatus of ["queued", "in_progress", "retry_wait", "delivered", "received", "rendered", "failed", "dismissed", "expired", "unknown"]) {
      expect(isPopupExecutionEligible({ eventStatus: "DELIVERED", deliveryStatus, executionStatus: "READY" })).toBe(true);
    }
    expect(isPopupExecutionEligible({...delivered,eventStatus:"DISMISSED",executionStatus:"RETRYING"})).toBe(true);
    expect(isPopupExecutionEligible({eventStatus:"DISMISSED",deliveryStatus:"failed",executionStatus:"PENDING"})).toBe(false);
    expect(isPopupExecutionEligible({eventStatus:"DISMISSED",deliveryStatus:"rendered",executionStatus:"SUCCEEDED"})).toBe(false);
    expect(isPopupExecutionEligible({eventStatus:"DISMISSED",deliveryStatus:"rendered",executionStatus:"FAILED"})).toBe(false);
    expect(isPopupExecutionEligible({eventStatus:"DISMISSED",deliveryStatus:"rendered",executionStatus:"RUNNING"})).toBe(false);
    expect(isPopupExecutionEligible({eventStatus:"DISMISSED",deliveryStatus:"rendered",executionStatus:"PENDING"})).toBe(false);
    expect(isPopupExecutionEligible({eventStatus:"DISMISSED",deliveryStatus:"rendered",executionStatus:"UNKNOWN"})).toBe(false);
  });
  it("does not make an unrecognized lifecycle status eligible",()=>{
    expect(isPopupExecutionEligible({...delivered,eventStatus:"WITHDRAWN"})).toBe(false);
  });
  it("fails closed when the execution status is missing or blank (item 23)",()=>{
    for (const executionStatus of [undefined, null, "", "   ", "\t\n"]) {
      expect(isPopupExecutionEligible({ eventStatus: "DELIVERED", deliveryStatus: "rendered", executionStatus })).toBe(false);
      expect(isPopupExecutionEligible({ eventStatus: "DISMISSED", deliveryStatus: "rendered", executionStatus })).toBe(false);
    }
    // An explicit READY/RETRYING is still eligible.
    expect(isPopupExecutionEligible({ eventStatus: "DELIVERED", deliveryStatus: "rendered", executionStatus: "ready" })).toBe(true);
    expect(isPopupExecutionEligible({ eventStatus: "DELIVERED", deliveryStatus: "rendered", executionStatus: " RETRYING " })).toBe(true);
  });
});
