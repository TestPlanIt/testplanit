import { describe, expect, it } from "vitest";
import { extractPasswordFromUrl, parseSentinels } from "./valkey";

describe("parseSentinels", () => {
  it("parses a single sentinel", () => {
    expect(parseSentinels("sentinel1:26379")).toEqual([
      { host: "sentinel1", port: 26379 },
    ]);
  });

  it("parses multiple sentinels", () => {
    expect(
      parseSentinels("sentinel1:26379,sentinel2:26380,sentinel3:26381")
    ).toEqual([
      { host: "sentinel1", port: 26379 },
      { host: "sentinel2", port: 26380 },
      { host: "sentinel3", port: 26381 },
    ]);
  });

  it("trims whitespace around entries", () => {
    expect(parseSentinels("  host1:26379 , host2:26380 ")).toEqual([
      { host: "host1", port: 26379 },
      { host: "host2", port: 26380 },
    ]);
  });

  it("defaults to port 26379 when port is omitted", () => {
    expect(parseSentinels("sentinel1")).toEqual([
      { host: "sentinel1", port: 26379 },
    ]);
  });

  it("defaults to port 26379 for non-numeric port", () => {
    expect(parseSentinels("sentinel1:abc")).toEqual([
      { host: "sentinel1", port: 26379 },
    ]);
  });

  it("handles IP addresses", () => {
    expect(parseSentinels("192.168.1.10:26379,10.0.0.5:26380")).toEqual([
      { host: "192.168.1.10", port: 26379 },
      { host: "10.0.0.5", port: 26380 },
    ]);
  });

  it("handles IPv6 addresses", () => {
    expect(parseSentinels("[::1]:26379")).toEqual([
      { host: "[::1]", port: 26379 },
    ]);
  });
});

describe("extractPasswordFromUrl", () => {
  it("extracts password from valkey:// URL", () => {
    expect(
      extractPasswordFromUrl("valkey://:mypassword@host:6379")
    ).toBe("mypassword");
  });

  it("extracts password from redis:// URL", () => {
    expect(
      extractPasswordFromUrl("redis://:secret123@host:6379")
    ).toBe("secret123");
  });

  it("extracts password with user:password format", () => {
    expect(
      extractPasswordFromUrl("redis://user:pass@host:6379")
    ).toBe("pass");
  });

  it("returns undefined when no password", () => {
    expect(extractPasswordFromUrl("valkey://host:6379")).toBeUndefined();
  });

  it("returns undefined for invalid URL", () => {
    expect(extractPasswordFromUrl("not-a-url")).toBeUndefined();
  });

  it("preserves URL-encoded characters in password", () => {
    // URL.password returns the raw encoded form; ioredis handles decoding
    expect(
      extractPasswordFromUrl("valkey://:p%40ss%23word@host:6379")
    ).toBe("p%40ss%23word");
  });
});
