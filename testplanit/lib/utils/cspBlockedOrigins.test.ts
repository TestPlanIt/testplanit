import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCspBlocked,
  recordCspViolation,
  resetCspBlocks,
  subscribeToCspBlocks,
} from "./cspBlockedOrigins";

const violation = (overrides: Record<string, string> = {}) => ({
  blockedURI: "https://old-bucket.example.com/uploads/a.pdf",
  disposition: "enforce" as const,
  effectiveDirective: "frame-src",
  ...overrides,
});

describe("cspBlockedOrigins", () => {
  beforeEach(() => resetCspBlocks());

  it("marks every file on a blocked host", () => {
    recordCspViolation(violation());
    expect(isCspBlocked("https://old-bucket.example.com/uploads/b.txt")).toBe(
      true
    );
    expect(isCspBlocked("https://other.example.com/uploads/b.txt")).toBe(false);
    expect(isCspBlocked("/api/storage/uploads/b.txt")).toBe(false);
  });

  it("records fetches as well as frames", () => {
    recordCspViolation(violation({ effectiveDirective: "connect-src" }));
    expect(isCspBlocked("https://old-bucket.example.com/x")).toBe(true);
  });

  it("ignores a policy that only reports", () => {
    recordCspViolation(violation({ disposition: "report" }));
    expect(isCspBlocked("https://old-bucket.example.com/x")).toBe(false);
  });

  it("ignores violations that are not file loads", () => {
    recordCspViolation(
      violation({ effectiveDirective: "script-src", blockedURI: "eval" })
    );
    recordCspViolation(violation({ effectiveDirective: "img-src" }));
    recordCspViolation(violation({ blockedURI: "inline" }));
    expect(isCspBlocked("https://old-bucket.example.com/x")).toBe(false);
  });

  it("notifies subscribers once per host", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToCspBlocks(listener);
    recordCspViolation(violation());
    recordCspViolation(violation());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    recordCspViolation(
      violation({ blockedURI: "https://third.example.com/x" })
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hears the browser's event", () => {
    const event = new Event("securitypolicyviolation");
    Object.assign(event, violation());
    document.dispatchEvent(event);
    expect(isCspBlocked("https://old-bucket.example.com/x")).toBe(true);
  });
});
