import { describe, expect, it } from "vitest";
import { absoluteAppUrl, getAppUrl } from "./appUrl";

describe("getAppUrl", () => {
  it("prefers APP_URL and drops a trailing slash", () => {
    expect(
      getAppUrl({
        APP_URL: "https://example.com/testplanit/",
        NEXTAUTH_URL: "https://example.com/testplanit/api/auth",
      })
    ).toBe("https://example.com/testplanit");
  });

  it("falls back to NEXTAUTH_URL unchanged at the root", () => {
    expect(getAppUrl({ NEXTAUTH_URL: "https://example.com" })).toBe(
      "https://example.com"
    );
    expect(getAppUrl({ NEXTAUTH_URL: "https://example.com/" })).toBe(
      "https://example.com"
    );
  });

  it("strips NextAuth's own route from NEXTAUTH_URL under a subpath", () => {
    expect(
      getAppUrl({ NEXTAUTH_URL: "https://example.com/testplanit/api/auth" })
    ).toBe("https://example.com/testplanit");
    expect(
      getAppUrl({ NEXTAUTH_URL: "https://example.com/testplanit/api/auth/" })
    ).toBe("https://example.com/testplanit");
  });

  it("ignores blank values", () => {
    expect(getAppUrl({ APP_URL: "  ", NEXTAUTH_URL: "https://x.test" })).toBe(
      "https://x.test"
    );
    expect(getAppUrl({})).toBe("http://localhost:3000");
  });
});

describe("absoluteAppUrl", () => {
  const env = { APP_URL: "https://example.com" };

  it("joins a root-relative path onto the base", () => {
    expect(absoluteAppUrl("/en-US/projects", env)).toBe(
      "https://example.com/en-US/projects"
    );
    expect(absoluteAppUrl("en-US/projects", env)).toBe(
      "https://example.com/en-US/projects"
    );
  });

  it("returns absolute inputs untouched", () => {
    expect(absoluteAppUrl("https://other.test/x", env)).toBe(
      "https://other.test/x"
    );
    expect(absoluteAppUrl("//cdn.test/x", env)).toBe("//cdn.test/x");
  });
});
