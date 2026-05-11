import { describe, it, expect } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("throws when TESTPLANIT_API_TOKEN is missing", () => {
    expect(() => parseEnv({})).toThrow();
    try {
      parseEnv({});
    } catch (err: any) {
      // zod error mentions the missing field somewhere in the message tree.
      expect(JSON.stringify(err)).toMatch(/TESTPLANIT_API_TOKEN/);
    }
  });

  it("throws when token does not start with tpi_", () => {
    expect(() => parseEnv({ TESTPLANIT_API_TOKEN: "no-prefix" })).toThrow();
    try {
      parseEnv({ TESTPLANIT_API_TOKEN: "no-prefix" });
    } catch (err: any) {
      expect(JSON.stringify(err)).toMatch(/tpi_/);
    }
  });

  it("returns the default API URL when TESTPLANIT_API_URL is omitted", () => {
    const result = parseEnv({ TESTPLANIT_API_TOKEN: "tpi_x" });
    expect(result.apiToken).toBe("tpi_x");
    expect(result.apiUrl).toBe("https://app.testplanit.com");
  });

  it("strips the trailing slash from a custom TESTPLANIT_API_URL", () => {
    const result = parseEnv({
      TESTPLANIT_API_TOKEN: "tpi_x",
      TESTPLANIT_API_URL: "https://example.com/",
    });
    expect(result.apiUrl).toBe("https://example.com");
  });

  it("preserves a custom URL with no trailing slash unchanged", () => {
    const result = parseEnv({
      TESTPLANIT_API_TOKEN: "tpi_x",
      TESTPLANIT_API_URL: "https://example.com",
    });
    expect(result.apiUrl).toBe("https://example.com");
  });

  it("throws on an invalid TESTPLANIT_API_URL", () => {
    expect(() =>
      parseEnv({
        TESTPLANIT_API_TOKEN: "tpi_x",
        TESTPLANIT_API_URL: "not-a-url",
      }),
    ).toThrow();
  });

  it("uses the documented SaaS default URL when TESTPLANIT_API_URL is omitted", () => {
    // Pinned for the locked default — see env.ts DEFAULT_API_URL.
    const result = parseEnv({ TESTPLANIT_API_TOKEN: "tpi_x" });
    expect(result.apiUrl).toBe("https://app.testplanit.com");
  });
});
