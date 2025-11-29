import { describe, it, expect } from "vitest";
import { toHumanReadable, toBusinessHours } from "./duration";

describe("toHumanReadable", () => {
  // Basic milliseconds tests
  it("should convert milliseconds to seconds", () => {
    expect(toHumanReadable(5000)).toBe("5 seconds");
  });

  it("should convert milliseconds to minutes and seconds", () => {
    expect(toHumanReadable(125 * 1000)).toBe("2 minutes, 5 seconds");
  });

  it("should convert milliseconds to hours, minutes, and seconds", () => {
    expect(toHumanReadable(3725 * 1000)).toBe("1 hour, 2 minutes, 5 seconds");
  });

  // Basic seconds tests
  it("should convert seconds correctly when isSeconds is true", () => {
    expect(toHumanReadable(125, { isSeconds: true })).toBe(
      "2 minutes, 5 seconds"
    );
  });

  // Rounding tests
  it("should round milliseconds by default", () => {
    expect(toHumanReadable(4999)).toBe("5 seconds"); // Default round=true
  });

  it("should not round when round is false", () => {
    expect(toHumanReadable(4999, { round: false })).toBe("4.999 seconds");
  });

  it("should round seconds by default when result is near an hour", () => {
    expect(toHumanReadable(3600001)).toBe("1 hour"); // Default round=true
  });

  it("should not round seconds when round is false and isSeconds is true", () => {
    expect(toHumanReadable(3600001, { round: false })).toBe(
      "1 hour, 0.001 seconds"
    );
  });

  // Locale tests
  it("should use default English locale if not specified", () => {
    expect(toHumanReadable(3600 * 1000)).toBe("1 hour");
  });

  it("should use specified locale (e.g., Spanish)", () => {
    expect(toHumanReadable(3600 * 1000, { locale: "es" })).toBe("1 hora");
  });

  it("should handle complex locale codes (e.g., en-US)", () => {
    expect(toHumanReadable(7200 * 1000, { locale: "en-US" })).toBe("2 hours");
  });

  it("should fallback to English for unsupported locales", () => {
    // Assuming 'xx' is not a supported language code by humanize-duration
    expect(toHumanReadable(3600 * 1000, { locale: "xx-XX" })).toBe("1 hour");
  });

  // Edge cases
  it("should handle zero duration", () => {
    expect(toHumanReadable(0)).toBe("0 seconds");
    expect(toHumanReadable(0, { isSeconds: true })).toBe("0 seconds");
  });
});

describe("toHumanReadable - additional options and edge cases", () => {
  it("should use custom units (hours and minutes only)", () => {
    expect(toHumanReadable(3660000, { units: ["h", "m"] })).toBe(
      "1 hour, 1 minute"
    );
  });

  it("should use the 'largest' option to limit output units", () => {
    expect(toHumanReadable(3661000, { largest: 1 })).toBe("1 hour");
    expect(toHumanReadable(3661000, { largest: 2 })).toBe("1 hour, 1 minute");
  });

  it("should use maxDecimalPoints option for smallest unit", () => {
    expect(toHumanReadable(4999, { round: false, maxDecimalPoints: 2 })).toBe(
      "4.99 seconds"
    );
  });

  it("should handle negative durations", () => {
    // humanize-duration returns "1 second" for -1000 ms
    expect(toHumanReadable(-1000)).toBe("1 second");
  });

  it("should handle very large durations (years)", () => {
    // 3 * 365 days is not exactly 3 years due to leap years; humanize-duration uses 365.25 days per year
    expect(toHumanReadable(3 * 365 * 24 * 3600 * 1000)).toContain("2 years");
  });
});

describe("toBusinessHours", () => {
  it("should return 0 if end <= start", () => {
    const start = new Date("2024-05-10T10:00:00Z");
    expect(toBusinessHours(start, start)).toBe(0);
    expect(toBusinessHours(start, new Date("2024-05-09T10:00:00Z"))).toBe(0);
  });

  it("should count only business hours on a single weekday", () => {
    const start = new Date("2024-05-13T10:00:00Z"); // Monday 10am
    const end = new Date("2024-05-13T15:00:00Z"); // Monday 3pm
    expect(toBusinessHours(start, end)).toBe(5);
  });

  it("should clamp to business hours if starting before 9am or after 5pm", () => {
    const start = new Date("2024-05-13T07:00:00Z"); // Monday 7am
    const end = new Date("2024-05-13T18:00:00Z"); // Monday 6pm
    expect(toBusinessHours(start, end)).toBe(8);
  });

  it("should skip weekends", () => {
    const start = new Date("2024-05-10T16:00:00Z"); // Friday 4pm
    const end = new Date("2024-05-13T11:00:00Z"); // Monday 11am
    // Friday: 4pm-5pm = 1h, Monday: 9am-11am = 2h
    expect(toBusinessHours(start, end)).toBe(3);
  });

  it("should handle multi-week spans and only count business hours", () => {
    const start = new Date("2024-05-06T09:00:00Z"); // Monday 9am
    const end = new Date("2024-05-17T17:00:00Z"); // Friday next week 5pm
    // 2 full workweeks = 10 days * 8h = 80h
    expect(toBusinessHours(start, end)).toBe(80);
  });

  it("should handle partial days at start and end", () => {
    const start = new Date("2024-05-06T13:00:00Z"); // Monday 1pm
    const end = new Date("2024-05-07T11:00:00Z"); // Tuesday 11am
    // Monday: 1pm-5pm = 4h, Tuesday: 9am-11am = 2h
    expect(toBusinessHours(start, end)).toBe(6);
  });

  it("should return 0 if the entire range is on a weekend", () => {
    const start = new Date("2024-05-11T10:00:00Z"); // Saturday
    const end = new Date("2024-05-12T15:00:00Z"); // Sunday
    expect(toBusinessHours(start, end)).toBe(0);
  });
});
