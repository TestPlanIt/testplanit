import { describe, expect, it } from "vitest";

import { isSafeExternalUrl, safeExternalUrl } from "./externalUrl";

describe("isSafeExternalUrl", () => {
  it("accepts http and https in any casing", () => {
    expect(isSafeExternalUrl("https://example.atlassian.net/browse/AB-1")).toBe(
      true
    );
    expect(isSafeExternalUrl("http://tracker.internal/issue/7")).toBe(true);
    expect(isSafeExternalUrl("HTTPS://EXAMPLE.COM/x")).toBe(true);
  });

  it("rejects script-bearing and non-web schemes", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false
    );
    expect(isSafeExternalUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects schemeless and relative values", () => {
    expect(isSafeExternalUrl("//example.com/x")).toBe(false);
    expect(isSafeExternalUrl("/projects/1")).toBe(false);
    expect(isSafeExternalUrl("example.com")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });

  it("rejects a scheme that only appears later in the string", () => {
    expect(isSafeExternalUrl(" https://example.com")).toBe(false);
    expect(isSafeExternalUrl("javascript:void(0)#https://example.com")).toBe(
      false
    );
  });

  it("rejects non-string values", () => {
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(42)).toBe(false);
  });
});

describe("safeExternalUrl", () => {
  it("returns the URL when safe and null otherwise", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe(
      "https://example.com/a"
    );
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});
