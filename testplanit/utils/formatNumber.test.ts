import { describe, expect, it } from "vitest";
import { durationTickFormat } from "./formatNumber";

describe("durationTickFormat", () => {
  const fmt = durationTickFormat();

  it("formats zero and sub-second values", () => {
    expect(fmt(0)).toBe("0s");
    expect(fmt(0.5)).toBe("0.5s");
    expect(fmt(0.25)).toBe("0.25s");
  });

  it("formats seconds, minutes, and hours compactly", () => {
    expect(fmt(45)).toBe("45s");
    expect(fmt(60)).toBe("1m");
    expect(fmt(310)).toBe("5m 10s");
    expect(fmt(3600)).toBe("1h");
    expect(fmt(7500)).toBe("2h 5m");
  });

  it("keeps at most two units", () => {
    expect(fmt(3661)).toBe("1h 1m"); // seconds dropped
  });

  it("handles negative values", () => {
    expect(fmt(-90)).toBe("-1m 30s");
  });
});
