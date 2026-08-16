import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedSubresource,
  resolveChromiumExecutable,
  screenshotKey,
  screenshotsEnabled,
} from "./urlScreenshots";

const publicResolve = async () => [{ address: "93.184.216.34" }];
const privateResolve = async () => [{ address: "10.0.0.5" }];
const dualStackResolve = async () => [
  { address: "93.184.216.34" },
  { address: "fd00::1" },
];

describe("isAllowedSubresource", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_PRIVATE_HOSTS", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows public http(s) hosts", async () => {
    expect(
      await isAllowedSubresource(
        "https://cdn.example.com/app.css",
        publicResolve
      )
    ).toBe(true);
    expect(
      await isAllowedSubresource("http://example.com/img.png", publicResolve)
    ).toBe(true);
  });

  it("blocks non-http protocols outright", async () => {
    expect(
      await isAllowedSubresource("file:///etc/passwd", publicResolve)
    ).toBe(false);
    expect(
      await isAllowedSubresource("ftp://example.com/x", publicResolve)
    ).toBe(false);
    expect(await isAllowedSubresource("not a url", publicResolve)).toBe(false);
  });

  it("blocks literal private/metadata IPs without resolving", async () => {
    const resolve = vi.fn();
    expect(
      await isAllowedSubresource(
        "http://169.254.169.254/latest/meta-data",
        resolve
      )
    ).toBe(false);
    expect(
      await isAllowedSubresource("http://10.0.0.5/internal", resolve)
    ).toBe(false);
    expect(await isAllowedSubresource("http://127.0.0.1:8080/", resolve)).toBe(
      false
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("blocks hostnames that resolve to private IPs (DNS rebinding shape)", async () => {
    expect(
      await isAllowedSubresource(
        "https://internal.example.com/x",
        privateResolve
      )
    ).toBe(false);
  });

  it("blocks hosts where ANY resolved address is private (dual-stack)", async () => {
    expect(
      await isAllowedSubresource("https://dual.example.com/x", dualStackResolve)
    ).toBe(false);
  });

  it("blocks hosts that resolve to an empty address list", async () => {
    expect(
      await isAllowedSubresource("https://empty.example.com/x", async () => [])
    ).toBe(false);
  });

  it("exempts ALLOWED_PRIVATE_HOSTS hostnames without resolving", async () => {
    vi.stubEnv("ALLOWED_PRIVATE_HOSTS", "staging.internal.corp");
    const resolve = vi.fn();
    expect(
      await isAllowedSubresource("https://staging.internal.corp/app", resolve)
    ).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    // Non-listed hosts still go through the normal check.
    expect(
      await isAllowedSubresource("https://other.corp/x", privateResolve)
    ).toBe(false);
  });

  it("blocks unresolvable hosts deterministically", async () => {
    expect(
      await isAllowedSubresource("https://nope.invalid/x", async () => {
        throw new Error("ENOTFOUND");
      })
    ).toBe(false);
  });

  it("handles bracketed IPv6 literals", async () => {
    expect(await isAllowedSubresource("http://[::1]/x", publicResolve)).toBe(
      false
    );
  });
});

describe("screenshotsEnabled / resolveChromiumExecutable", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off by default", () => {
    vi.stubEnv("CRAWL_SCREENSHOTS", "");
    expect(screenshotsEnabled()).toBe(false);
  });

  it("stays off when the flag is set but no chromium exists", () => {
    vi.stubEnv("CRAWL_SCREENSHOTS", "true");
    vi.stubEnv("CHROMIUM_EXECUTABLE_PATH", "/nonexistent/chromium");
    expect(resolveChromiumExecutable()).toBeNull();
    expect(screenshotsEnabled()).toBe(false);
  });

  it("resolves a configured executable that exists", () => {
    vi.stubEnv("CRAWL_SCREENSHOTS", "true");
    // process.execPath always exists — stands in for a chromium binary.
    vi.stubEnv("CHROMIUM_EXECUTABLE_PATH", process.execPath);
    expect(resolveChromiumExecutable()).toBe(process.execPath);
    expect(screenshotsEnabled()).toBe(true);
  });
});

describe("screenshotKey", () => {
  it("is job- and page-scoped", () => {
    expect(screenshotKey("42", 0)).toBe("generate-from-url:screenshot:42:0");
    expect(screenshotKey("42", 3)).toBe("generate-from-url:screenshot:42:3");
  });
});
