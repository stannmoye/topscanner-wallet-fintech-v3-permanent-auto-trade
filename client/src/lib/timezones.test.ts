import { describe, expect, it } from "vitest";
import {
  TIMEZONE_ENTRIES,
  detectLocalTimezone,
  formatTimezoneClock,
  isKnownTimezone,
  timezoneCityLabel,
  timezoneOffsetLabel,
} from "./timezones";

describe("timezone reference data", () => {
  it("covers every country with unique zones", () => {
    expect(TIMEZONE_ENTRIES.length).toBeGreaterThan(300);
    const zones = TIMEZONE_ENTRIES.map((entry) => entry.tz);
    expect(new Set(zones).size).toBe(zones.length);
    for (const entry of TIMEZONE_ENTRIES) {
      expect(entry.tz).toContain("/");
      expect(entry.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("recognises known zones only", () => {
    expect(isKnownTimezone("Europe/London")).toBe(true);
    expect(isKnownTimezone("Not/AZone")).toBe(false);
    expect(isKnownTimezone(null)).toBe(false);
  });
});

describe("timezone formatting", () => {
  it("labels UTC as UTC±0", () => {
    expect(timezoneOffsetLabel("UTC")).toBe("UTC±0");
  });

  it("labels a zoned offset with a UTC prefix", () => {
    expect(timezoneOffsetLabel("Europe/London", new Date("2020-07-15T12:00:00Z"))).toBe("UTC+1");
    expect(timezoneOffsetLabel("America/New_York", new Date("2020-01-15T12:00:00Z"))).toBe("UTC-5");
  });

  it("formats a 24-hour wall clock in the requested zone", () => {
    const instant = new Date("2020-01-01T00:00:00Z");
    expect(formatTimezoneClock("UTC", instant)).toBe("00:00");
    expect(formatTimezoneClock("UTC", instant, true)).toBe("00:00:00");
    expect(formatTimezoneClock("America/New_York", instant)).toBe("19:00");
  });

  it("derives a readable city label", () => {
    expect(timezoneCityLabel("America/New_York")).toBe("New York");
    expect(timezoneCityLabel("UTC")).toBe("UTC");
  });

  it("detects a non-empty device timezone", () => {
    expect(typeof detectLocalTimezone()).toBe("string");
    expect(detectLocalTimezone().length).toBeGreaterThan(0);
  });

  it("falls back gracefully for an unknown zone", () => {
    expect(timezoneOffsetLabel("Not/AZone")).toBe("UTC");
    expect(formatTimezoneClock("Not/AZone")).toBe("--:--");
  });
});
