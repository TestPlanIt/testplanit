import { describe, expect, it } from "vitest";
import { dateBoundSchema, parseDateBound } from "./dateBounds.js";

describe("dateBoundSchema", () => {
  it("accepts a calendar day and a timestamp with Z or offset", () => {
    expect(dateBoundSchema.safeParse("2026-10-01").success).toBe(true);
    expect(dateBoundSchema.safeParse("2026-10-01T00:00:00Z").success).toBe(true);
    expect(dateBoundSchema.safeParse("2026-10-01T08:30:00+02:00").success).toBe(true);
  });

  it("rejects malformed input and a timestamp without an offset", () => {
    expect(dateBoundSchema.safeParse("2026-10").success).toBe(false);
    expect(dateBoundSchema.safeParse("10/01/2026").success).toBe(false);
    expect(dateBoundSchema.safeParse("2026-10-01T00:00:00").success).toBe(false);
  });
});

describe("parseDateBound", () => {
  it("reads a date-only start as the beginning of that UTC day", () => {
    expect(parseDateBound("2026-10-01", "start").toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("reads a date-only end as the last instant of that UTC day", () => {
    expect(parseDateBound("2026-10-01", "end").toISOString()).toBe(
      "2026-10-01T23:59:59.999Z",
    );
  });

  it("passes a timestamp through unchanged", () => {
    expect(parseDateBound("2026-10-01T08:30:00+02:00", "end").toISOString()).toBe(
      "2026-10-01T06:30:00.000Z",
    );
  });
});
